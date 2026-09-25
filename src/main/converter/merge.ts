/**
 * 合并转换实现:
 * 读全部文件 → mergeMarkdowns(首文件 frontmatter 保留、后续剥离、图片绝对化)→ 单次 convert。
 * 读取阶段为有界并发(非 Promise.all 全开):合并源数量由用户选择,无界并发读盘
 * 会瞬间打满句柄与内存;合并体积另有单文件/总量上限(见 preprocess.ts 与本文件常量)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { convert } from "../../core/convert.js";
import type { ConvertFormat } from "../../core/settings/settings-defaults.js";
import type { DocMetadata } from "../../core/pipeline/frontmatter.js";
import type { ConvertResult } from "../../core/ipc-contract.js";
// ConvertResult 契约单源 core/ipc-contract.ts(跨进程数据形状);此处 re-export
// 保持 converter/index.ts 与既有导入面不变,勿在本文件重复声明。
export type { ConvertResult } from "../../core/ipc-contract.js";
import type { ConvertWarning } from "../../core/i18n.js";
import { t } from "../../core/i18n.js";
import { mergeMarkdowns } from "../../core/pipeline/merge.js";
import { renderMermaid } from "../services/mermaid-service.js";
import { loadSettings } from "../persist/settings.js";
import {
  buildConvertContext,
  ConvertCanceledError,
  createConvertContext,
  getImageResolver,
  throwIfCanceled,
  type ConvertContext,
} from "./context.js";
import { isConversionCanceled } from "../../core/cancel.js";
import { stripMarkdownExt } from "./paths.js";
import { persistArtifact, runAfterConvert } from "./single.js";
import { prepareMarkdown } from "./preprocess.js";

/** 合并源文件数上限:超限直接拒绝,不静默截断(截断会让用户以为全文已合并) */
export const MAX_MERGE_FILES = 200;
/** 合并源总体积上限:合并后整篇进内存渲染,总量无界会拖垮会话(错误文案 i18n 化列入后续字典维护项) */
export const MAX_MERGE_TOTAL_BYTES = 128 * 1024 * 1024;
/** 合并阶段读盘并发上限(有界并发,非 Promise.all 全开) */
export const MERGE_READ_CONCURRENCY = 4;

/**
 * 有界并发映射(保序):结果数组与入参等长且顺序一致,
 * 使「并发读取完成顺序」不影响 warning 合并顺序与合并正文顺序。
 * 单个任务抛错立即上抛;已在途任务继续跑完但结果被忽略。
 */
async function mapWithConcurrency<T>(
  items: readonly string[],
  concurrency: number,
  task: (item: string, index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]!, index); // 循环上界刚检查下标有效
    }
  };
  const width = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/** 合并源总体积:逐个 stat 累加(缺失/不可访问的文件计入 0,读取阶段再报错) */
async function totalSourceBytes(files: readonly string[]): Promise<number> {
  let total = 0;
  for (const file of files) {
    try {
      total += (await fs.stat(file)).size;
    } catch {
      /* 缺失/不可访问:读取阶段 prepareMarkdown 会抛,此处不重复报错 */
    }
  }
  return total;
}

/** 取输入源目录的公共祖先,作为合并文档的逻辑图片基准。 */
function commonBaseDir(dirs: string[]): string {
  const first = path.resolve(dirs[0] ?? process.cwd());
  let common = first;
  for (const dir of dirs.slice(1)) {
    const candidate = path.resolve(dir);
    while (true) {
      const relative = path.relative(common, candidate);
      if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
        break;
      }
      const parent = path.dirname(common);
      if (parent === common) return first;
      common = parent;
    }
  }
  return common;
}

/**
 * 合并转换:读全部文件 → mergeMarkdowns(首文件 frontmatter 保留、后续剥离、图片相对公共 baseDir 重定位)→ 单次 convert。
 * 输出与 files[0] 同目录,`{basename}-合并.{ext}`;导出后行为由本函数触发一次
 * (单输出,与单文件一致;批量调用方经 skipAfterConvert 让位),落盘后仍有最终取消检查。
 * 任一步失败直接抛(调用方 catch 为 { ok:false, error };取消抛 ConvertCanceledError)。
 * 进度经 onProgress 上报(与单文件同构;pdf 细分
 * parse/inline/mermaid/katex/print,docx 保持 read/render/done)。
 * 预算:文件数与源总体积超限直接拒绝;读取为有界并发并保序。
 */
export async function mergeConvertImpl(
  files: string[],
  format: ConvertFormat,
  onProgress?: (stage: string) => void,
  ctx: ConvertContext = createConvertContext(),
  katexDir?: string,
  metadata?: DocMetadata,
): Promise<ConvertResult> {
  if (files.length === 0) {
    // 生成期本地化:同 convertImpl,throw 文案无法显示层重映射,抛出点用 t()。
    throw new Error(t("convert.noFilesSelected"));
  }
  const firstFile = files[0]!; // 上方长度守卫保证非空数组,首文件必存在
  if (files.length > MAX_MERGE_FILES) {
    throw new Error(`合并文件数超过上限(${MAX_MERGE_FILES} 个):${files.length}`);
  }
  // 总量闸门置于读取之前:合并结果整篇进内存,超限直接拒绝(不先读完再报)
  const totalBytes = await totalSourceBytes(files);
  if (totalBytes > MAX_MERGE_TOTAL_BYTES) {
    throw new Error(
      `合并源总体积超过上限(${(MAX_MERGE_TOTAL_BYTES / 1024 / 1024).toFixed(0)}MB):${(totalBytes / 1024 / 1024).toFixed(1)}MB`,
    );
  }
  // 每次调用使用新建 context(取消标志初始 false),上次取消不再残留:
  // 否则二次合并立即被 throwIfCanceled 误判取消(历史 bug fd40480)。
  throwIfCanceled(ctx);
  const settings = await loadSettings();
  const warnings: ConvertWarning[] = [];
  onProgress?.("read");
  // 每个输入独立收集准备 warning,再按 files 顺序合并,避免并发读取完成顺序
  // 决定 warning 顺序;正文/图片仍保留各输入的 baseDir 供 mergeMarkdowns 重定位。
  // 读取为有界并发(MERGE_READ_CONCURRENCY),并保序返回。
  const preparedInputs = await mapWithConcurrency(files, MERGE_READ_CONCURRENCY, async (file) => {
    const fileWarnings: ConvertWarning[] = [];
    const prepared = await prepareMarkdown(file, settings, fileWarnings, "warn.gbkEncodingFile");
    return {
      content: prepared.markdown,
      baseDir: path.dirname(file),
      warnings: fileWarnings,
    };
  });
  throwIfCanceled(ctx); // 读取完成后再查一次:长批次读取期间用户可能已取消
  const inputs = preparedInputs.map(({ content, baseDir }) => ({ content, baseDir }));
  for (const input of preparedInputs) warnings.push(...input.warnings);
  // 合并文档的逻辑解析 baseDir 取所有输入目录的公共祖先;允许读取的根
  // 单独显式传入各输入源目录,解析基准不隐式扩大 trusted roots。
  const mergeBaseDir = commonBaseDir(inputs.map((input) => input.baseDir));
  const trustedRoots = [...new Set(inputs.map((input) => path.resolve(input.baseDir)))];
  const md = mergeMarkdowns(inputs, { outputBaseDir: mergeBaseDir });
  const baseName = stripMarkdownExt(path.basename(firstFile));
  // 进度分阶段:与 convertImpl 同构——docx 粗粒度 render,pdf 由 onStage 细分
  if (format === "docx") onProgress?.("render");
  let artifact: Awaited<ReturnType<typeof convert>>;
  try {
    artifact = await convert(
      md,
      format,
      await buildConvertContext({
        baseDir: mergeBaseDir,
        // 取消与时间上限透传 core:合并渲染(整篇单次 convert)可被中途取消
        convert: ctx,
        title: baseName,
        metadata,
        warnings,
        settings,
        imageResolver: getImageResolver(mergeBaseDir, { trustedRoots }),
        katexDir,
        mermaidResolver: renderMermaid,
        ...(format === "pdf" ? { onStage: (stage: string) => onProgress?.(stage) } : {}),
      }),
    );
  } catch (err) {
    // 渲染期取消归一为本层 ConvertCanceledError:main 面的取消判定(IPC 取消分支
    // 与调用方 catch)只认本层类型,不归一会把「用户取消」上报为转换失败
    if (isConversionCanceled(err)) throw new ConvertCanceledError();
    throw err;
  }
  throwIfCanceled(ctx);
  const { outputPath, warnings: outWarnings } = await persistArtifact(
    artifact,
    firstFile,
    format,
    settings.outputDir,
    ctx,
    onProgress,
    `${baseName}-合并`,
  );
  warnings.push(...outWarnings);
  // 副作用所有权:合并只有单个产物,由本函数触发一次(与单文件同构;批量调用方
  // 经 skipAfterConvert 让位)。最终取消检查落在「产物已落盘 → 打开产物」的最后
  // 窗口:此处取消(用户取消或关窗放弃)则抛 ConvertCanceledError,调用方回「已取消」,
  // 绝不打开产物——与 convertImpl 的闸门位置对齐(勿只依赖落盘前的检查点)。
  if (!ctx.skipAfterConvert) {
    throwIfCanceled(ctx);
    await runAfterConvert(settings.afterConvert, outputPath, ctx);
  }
  return { ok: true, outputPath, warnings };
}
