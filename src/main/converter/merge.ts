/**
 * 合并转换实现(目录重组批⑤自 converter.ts 拆出):
 * 读全部文件 → mergeMarkdowns(首文件 frontmatter 保留、后续剥离、图片绝对化)→ 单次 convert。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { convert, type ConvertFormat } from "../../core/convert.js";
import { decodeMarkdown } from "../../core/util/encoding.js";
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
import { resolveOutputPath } from "./paths.js";
import { renderPdf, runAfterConvert } from "./single.js";

export interface ConvertResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
  /** 非致命警告(如缺失本地图片),成功时可能携带;B6 起元素为 ConvertWarning(keyed) */
  warnings?: ConvertWarning[];
  /** 用户主动取消(非错误) */
  canceled?: boolean;
}

/**
 * 合并转换:读全部文件 → mergeMarkdowns(首文件 frontmatter 保留、后续剥离、图片绝对化)→ 单次 convert。
 * 输出与 files[0] 同目录,`{basename}-合并.{ext}`;执行 runAfterConvert(单输出,与单文件一致)。
 * 任一步失败直接抛(调用方 catch 为 { ok:false, error })。
 * 批次 7 补:进度经 onProgress 上报(与单文件同构;B9 起 pdf 细分
 * parse/inline/mermaid/katex/print,docx 保持 read/render/done),修复合并进度条不动。
 */
export async function mergeConvertImpl(
  files: string[],
  format: ConvertFormat,
  onProgress?: (stage: string) => void,
  ctx: ConvertContext = createConvertContext(),
  katexDir?: string,
): Promise<ConvertResult> {
  if (files.length === 0) {
    // 生成期本地化(B6 决策):同 convertImpl,throw 文案无法显示层重映射,抛出点用 t()。
    throw new Error(t("convert.noFilesSelected"));
  }
  const firstFile = files[0]!; // 上方长度守卫保证非空数组,首文件必存在
  // 每次调用使用新建 context(取消标志初始 false),上次取消不再残留:
  // 否则二次合并立即被 throwIfCanceled 误判取消(历史 bug fd40480)。
  throwIfCanceled(ctx);
  const settings = await loadSettings();
  const warnings: ConvertWarning[] = [];
  onProgress?.("read");
  const inputs = await Promise.all(
    files.map(async (file) => {
      const { text, encoding } = decodeMarkdown(await fs.readFile(file));
      if (encoding === "gbk") {
        warnings.push({
          key: "warn.gbkEncodingFile",
          params: { file: path.basename(file) },
          fallback: `已按 GBK 编码读取:${path.basename(file)}`,
        });
      }
      return { content: text, baseDir: path.dirname(file) };
    }),
  );
  const mergedMd = mergeMarkdowns(inputs);
  const baseName = path.basename(firstFile).replace(/\.(md|markdown)$/i, "");
  // B9 进度分阶段:与 convertImpl 同构——docx 粗粒度 render,pdf 由 onStage 细分
  if (format === "docx") onProgress?.("render");
  const artifact = await convert(
    mergedMd,
    format,
    buildConvertContext({
      baseDir: path.dirname(firstFile),
      title: baseName,
      warnings,
      settings,
      imageResolver: getImageResolver(path.dirname(firstFile)),
      katexDir,
      mermaidResolver: renderMermaid,
      ...(format === "pdf" ? { onStage: (stage: string) => onProgress?.(stage) } : {}),
    }),
  );
  throwIfCanceled(ctx);
  const { outputPath, warnings: outWarnings } = await resolveOutputPath(
    firstFile,
    format,
    settings.outputDir,
    `${baseName}-合并`,
  );
  warnings.push(...outWarnings);
  if (artifact.kind === "docx") {
    await fs.writeFile(outputPath, artifact.buffer);
    onProgress?.("done");
  } else {
    await renderPdf(artifact, outputPath, ctx, onProgress);
    onProgress?.("done");
  }
  // B2:与 convertImpl 对齐尊重 skipAfterConvert(同抽象层行为一致)
  if (!ctx.skipAfterConvert) await runAfterConvert(settings.afterConvert, outputPath);
  return { ok: true, outputPath, warnings };
}
