/**
 * 主进程转换编排层 —— 桶导出(目录重组批⑤自 570 行单文件拆分):
 * 实现按职责分模块(converter/ 子目录),本文件仅 re-export,既有 import 面不变
 * (src 内 ../converter.js 与测试 dist/main/converter.js 均无需改动)。
 * 模块划分与依赖方向(单向无环):
 * - context.ts:取消语义(ConvertContext/createConvertContext/ConvertCanceledError/
 *   throwIfCanceled)+ getImageResolver 缓存 + buildConvertContext 映射收敛
 * - single.ts:convertImpl + renderPdf + runAfterConvert(batch/merge 复用后两者)
 * - batch.ts:batchConvertImpl(并发 2 池)
 * - merge.ts:mergeConvertImpl(多文件合并单次转换)
 * - paths.ts:resolveOutputPath / collectMarkdownPaths / filterExistingPaths
 * 定位 = 主进程编排层(非纯逻辑,纯逻辑在 src/core/):依赖 electron(app/BrowserWindow/shell)
 * 是允许的;converter 可 import settings/image-downloader/core,反向(settings/image-downloader
 * import converter)禁止,index.ts import converter。
 * 取消语义:每次调用新建 ConvertContext(取消标志不复用,根治历史 bug fd40480/f809c57
 * 全局可变状态跨调用残留)。
 */
export type { BatchItem, BatchProgressInfo, BatchResult } from "./converter/batch.js";
export { batchConvertImpl } from "./converter/batch.js";
export type { BuildConvertContextOptions, ConvertContext } from "./converter/context.js";
export {
  buildConvertContext,
  ConvertCanceledError,
  createConvertContext,
  getImageResolver,
  throwIfCanceled,
} from "./converter/context.js";
export type { ConvertResult } from "./converter/merge.js";
export { mergeConvertImpl } from "./converter/merge.js";
export { convertImpl } from "./converter/single.js";
export { collectMarkdownPaths, filterExistingPaths, pathExists, resolveOutputPath } from "./converter/paths.js";
