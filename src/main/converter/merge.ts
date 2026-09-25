/**
 * 合并转换实现:
 * 读全部文件 → mergeMarkdowns(首文件 frontmatter 保留、后续剥离、图片绝对化)→ 单次 convert。
 */
import path from "node:path";
import { convert } from "../../core/convert.js";
import type { ConvertFormat } from "../../core/settings/settings-defaults.js";
import type { DocMetadata } from "../../core/pipeline/frontmatter.js";
import type { ConvertWarning } from "../../core/i18n.js";
import { t } from "../../core/i18n.js";
import { mergeMarkdowns } from "../../core/pipeline/merge.js";
import { renderMermaid } from "../services/mermaid-service.js";
import { loadSettings } from "../persist/settings.js";
import {
  buildConvertContext,
  createConvertContext,
  getImageResolver,
  throwIfCanceled,
  type ConvertContext,
} from "./context.js";
import { stripMarkdownExt } from "./paths.js";
import { persistArtifact, runAfterConvert } from "./single.js";
import { prepareMarkdown } from "./preprocess.js";

export interface ConvertResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
  /** 非致命警告(如缺失本地图片),成功时可能携带;元素为 ConvertWarning(keyed) */
  warnings?: ConvertWarning[];
  /** 用户主动取消(非错误) */
  canceled?: boolean;
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
  // 每次调用使用新建 context(取消标志初始 false),上次取消不再残留:
  // 否则二次合并立即被 throwIfCanceled 误判取消(历史 bug fd40480)。
  throwIfCanceled(ctx);
  const settings = await loadSettings();
  const warnings: ConvertWarning[] = [];
  onProgress?.("read");
  // 每个输入独立收集准备 warning,再按 files 顺序合并,避免并发读取完成顺序
  // 决定 warning 顺序;正文/图片仍保留各输入的 baseDir 供 mergeMarkdowns 重定位。
  const preparedInputs = await Promise.all(
    files.map(async (file) => {
      const fileWarnings: ConvertWarning[] = [];
      const prepared = await prepareMarkdown(file, settings, fileWarnings, "warn.gbkEncodingFile");
      return {
        content: prepared.markdown,
        baseDir: path.dirname(file),
        warnings: fileWarnings,
      };
    }),
  );
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
  const artifact = await convert(
    md,
    format,
    await buildConvertContext({
      baseDir: mergeBaseDir,
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
