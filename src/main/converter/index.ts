/**
 * 主进程转换编排层 —— 桶导出:实现按职责分模块(同目录单文件),本文件仅 re-export。
 *
 * 模块划分与依赖方向(单向无环):
 * - context.ts:取消语义(ConvertContext/createConvertContext/ConvertCanceledError/
 *   throwIfCanceled)+ getImageResolver 缓存 + buildConvertContext 映射收敛
 * - single.ts:convertImpl + renderPdf + runAfterConvert(batch/merge 复用后两者)
 * - batch.ts:batchConvertImpl(并发 2 池)
 * - merge.ts:mergeConvertImpl(多文件合并单次转换)
 * - paths.ts:resolveOutputPath / collectMarkdownPaths / filterExistingPaths
 * 定位 = 主进程编排层(非纯逻辑,纯逻辑在 src/core/):依赖 electron(app/BrowserWindow/shell)
 * 是允许的;converter 可 import persist/services/core,反向(persist/services
 * import converter)禁止,index.ts import converter。
 * 取消语义:每次调用新建 ConvertContext(取消标志不复用,根治历史 bug fd40480/f809c57
 * 全局可变状态跨调用残留)。
 */
export type { BatchItem, BatchProgressInfo, BatchResult } from "./batch.js";
export { batchConvertImpl } from "./batch.js";
export type { BuildConvertContextOptions, ConvertContext } from "./context.js";
// throwIfCanceled 桶导出已删(消费方均直连 ./context.js,桶出口无外部消费者);
// pathExists 同(paths.ts 内部使用,无外部消费者)。
export {
  buildConvertContext,
  ConvertCanceledError,
  createConvertContext,
  getImageResolver,
} from "./context.js";
export type { ConvertResult } from "./merge.js";
export { mergeConvertImpl } from "./merge.js";
export { convertImpl } from "./single.js";
export { collectMarkdownPaths, filterExistingPaths, resolveOutputPath } from "./paths.js";
