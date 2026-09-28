/**
 * 单文件转换实现:参数校验 → 读取 md → 输出骨架(渲染 → 落盘 → 导出后行为)。
 * 校验与读取留在本模块(判据与合并不同:此处查扩展名,合并查空数组与上限,
 * 合成一个校验器只会造出语义模糊的判据,见 adr-029 决定要点五);
 * 渲染之后的一切经 output-skeleton.ts 的 emitConvertedArtifact(与合并共用)。
 * 本文件是批量的唯一单文件入口,故 ctx.skipAfterConvert 在共用骨架里是真分支
 * (批量逐文件经它让位,批次末尾由 batchConvertImpl 统一触发一次)。
 */
import path from "node:path";
import type { ConvertFormat } from "../../core/settings/settings-defaults.js";
import type { ConvertWarning } from "../../core/i18n.js";
import { t } from "../../core/i18n.js";
import { loadSettings, type AppSettings } from "../persist/settings.js";
import { createConvertContext, throwIfCanceled, type ConvertContext } from "./context.js";
import { MARKDOWN_EXT_RE } from "./paths.js";
import { prepareMarkdown } from "./preprocess.js";
import { emitConvertedArtifact } from "./output-skeleton.js";

// 渲染产物落盘(persistArtifact/renderPdf)与导出后行为(runAfterConvert)随输出骨架
// 同迁至 output-skeleton.ts;本模块继续转出 renderPdf/runAfterConvert,是为了让批量
// 与直连本模块的测试保持零改动(勿改它们的导入面,理由见
// docs/adr/adr-029-main侧输出骨架抽函数.md)。
export { renderPdf, runAfterConvert } from "./output-skeleton.js";

/**
 * 转换实现:读取 md → core 注册表渲染 → 落盘(同目录同名换扩展名)。
 * 纯函数便于冒烟自测与未来 CLI 复用;进度经 onProgress 上报。
 * pdf 链路:core 产出 HTML → 写临时文件 → 隐藏窗口 loadFile → printToPDF。
 * 取消:ctx 默认新建(「取消后复位」语义);skipAfterConvert 经 ctx 携带(见 ConvertContext)。
 * ctx 的 signal/deadline 透传给 core(见 buildConvertContext 的 convert 入参):渲染层各
 * 检查点与图片/图表回调都能感知取消,不必等整篇渲染结束;渲染期抛出的 core 取消错误在
 * 骨架层归一为 ConvertCanceledError(main 面取消判定只认本层类型,与 merge 同构)。
 * settingsSnapshot 仅供批量在批次开始时传入 immutable 快照;单文件/合并未传时各自读取当前设置。
 * katexDir(pdf 公式资源目录)由调用方(main 入口层)传入,本函数不依赖 electron app。
 */
export async function convertImpl(
  filePath: string,
  format: ConvertFormat,
  onProgress?: (stage: string) => void,
  ctx: ConvertContext = createConvertContext(),
  katexDir?: string,
  settingsSnapshot?: AppSettings,
): Promise<{ outputPath: string; warnings: ConvertWarning[] }> {
  if (!MARKDOWN_EXT_RE.test(filePath)) {
    // 生成期本地化:throw 文案经 error.message 单次字符串通道到 GUI,
    // 显示层无法重映射,只能在抛出点用 t()(main 进程启动时已 setLanguage)。
    throw new Error(t("file.onlyMarkdown"));
  }
  throwIfCanceled(ctx);
  const settings = settingsSnapshot ?? loadSettings();
  onProgress?.("read");
  const warnings: ConvertWarning[] = [];
  const prepared = await prepareMarkdown(filePath, settings, warnings, "warn.gbkEncoding");
  // 渲染 → 落盘 → 导出后行为:与合并共用输出骨架。本函数是「单文件转换」这个副作用
  // 的拥有者,是否让位由 ctx.skipAfterConvert 表达(骨架读该标志,批量构造该标志)。
  return emitConvertedArtifact(
    { markdown: prepared.markdown, sourcePath: filePath, baseDir: path.dirname(filePath) },
    { format, settings, ctx, warnings, katexDir, onProgress },
  );
}
