/**
 * 主进程转换编排层 —— 桶导出:实现按职责分模块(同目录单文件),本文件仅 re-export。
 *
 * 模块划分与依赖方向(单向无环):
 * - context.ts:取消语义(ConvertContext/createConvertContext/ConvertCanceledError/
 *   throwIfCanceled)+ getImageResolver 缓存 + buildConvertContext 映射收敛
 * - output-skeleton.ts:emitConvertedArtifact(单文件/合并共用的输出骨架,消费点 2 处)
 *   + renderPdf + runAfterConvert(同模块是避免 single ↔ output-skeleton 成环的必要条件)
 * - single.ts:convertImpl(参数校验 + 读取 md;渲染之后交给骨架,转出 renderPdf/
 *   runAfterConvert 供 batch/测试的导入面零改动)
 * - batch.ts:batchConvertImpl(并发 2 池)
 * - merge.ts:mergeConvertImpl(多文件合并单次转换)
 * 路径解析与落盘提交住在装配层 src/convert/(paths.ts:resolveOutputPath(首选路径,不做存在性探测)
 * / collectMarkdownPaths / filterExistingPaths;artifact-writer.ts:commitArtifact(同目录临时文件 +
 * 硬链接独占提交,四种转换路径落盘唯一入口)),本桶只做再导出,实现不在本目录。
 * 定位 = 主进程编排层(非纯逻辑,纯逻辑在 src/core/):依赖 electron(app/BrowserWindow/shell)
 * 是允许的;converter 可 import convert/persist/services/core,反向(persist/services
 * import converter)禁止,index.ts import converter。
 * 取消语义:每次调用新建 ConvertContext(取消标志不复用,根治历史 bug fd40480/f809c57
 * 全局可变状态跨调用残留)。
 */
// 批量契约类型(BatchItem/BatchProgressInfo/BatchResult)单源 core/ipc-contract.ts,
// 桶出口不再转手(消费方直连 core,避免双入口);本桶只导出实现。
export { batchConvertImpl } from "./batch.js";
export type { BuildConvertContextOptions, ConvertContext } from "./context.js";
// throwIfCanceled 桶导出已删(消费方均直连 ./context.js,桶出口无外部消费者)。
// commitArtifact 未入桶:消费方(single.ts)与测试经 dist 直连 dist/convert/artifact-writer.js。
export {
  buildConvertContext,
  ConvertCanceledError,
  createConvertContext,
  getImageResolver,
} from "./context.js";
export type { ConvertResult } from "./merge.js";
export { mergeConvertImpl } from "./merge.js";
export { convertImpl } from "./single.js";
export { collectMarkdownPaths, filterExistingPaths, resolveOutputPath } from "../../convert/paths.js";
