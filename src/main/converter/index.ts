/**
 * 主进程转换编排层 —— 桶导出:实现按职责分模块(同目录单文件),本文件仅 re-export。
 *
 * 模块划分与依赖方向(单向无环):
 * - convert/run.ts(装配层,零 electron):emitConvertedArtifact(单文件/合并共用的输出骨架,
 *   消费点 2 处)+ persistArtifact;三个宿主能力经入参注入
 * - electron-side.ts(GUI 电子侧):renderPdf + runAfterConvert —— 装配层的**能力提供者**,
 *   持有 BrowserWindow / shell / pdf-lib 触点(与 run.ts 是注入方/被注入方关系,
 *   故 renderPdf 整体搬迁而非拆成「打印成字节」,见 run.ts 的 PdfPrinter JSDoc)
 * - single.ts:convertImpl(参数校验 + 读取 md + 注入三个宿主能力;转出 renderPdf/
 *   runAfterConvert 供 batch/测试的导入面零改动)
 * - batch.ts:batchConvertImpl(并发 2 池)
 * - merge.ts:mergeConvertImpl(多文件合并单次转换 + 注入同三个宿主能力)
 * 准备编排与路径解析/落盘提交住在装配层 src/convert/(preprocess.ts:解码 → frontmatter 隔离
 * → 渲染前变换 → 原样拼回,所有入口共用;paths.ts:resolveOutputPath(首选路径,不做存在性探测)
 * / collectMarkdownPaths / filterExistingPaths;artifact-writer.ts:commitArtifact(同目录临时文件 +
 * 硬链接独占提交,四种转换路径落盘唯一入口);cancellation.ts:取消语义
 * (ConversionHandle/ConvertCanceledError/throwIfCanceled)+ context.ts:createConvertContext 与
 * getImageResolver 缓存 + buildConvertContext 映射收敛),本桶只做再导出,实现不在本目录。
 * 定位 = 主进程编排层(非纯逻辑,纯逻辑在 src/core/):依赖 electron(app/BrowserWindow/shell)
 * 是允许的;converter 可 import convert/persist/services/core,反向(persist/services
 * import converter)禁止,index.ts import converter。
 * 取消语义:每次调用新建 ConversionHandle(取消标志不复用,根治历史 bug fd40480/f809c57
 * 全局可变状态跨调用残留)。
 */
// 批量契约类型(BatchItem/BatchProgressInfo/BatchResult)单源 core/ipc-contract.ts,
// 桶出口不再转手(消费方直连 core,避免双入口);本桶只导出实现。
export { batchConvertImpl } from "./batch.js";
// 取消语义与设置→上下文映射收敛住在装配层 src/convert/(ADR-060;取消部分见 cancellation.ts,
// ADR-064 处置表第 2 条):桶只做再导出,外部消费方(preview.ts / IPC / web-contents 注册表)
// 经此入口取用,导入面不随其位置变动。
export type { BuildConvertContextOptions } from "../../convert/context.js";
// 取消手柄类型住 cancellation.ts(ADR-064 处置表第 2 条):装配层那份 ConvertContext
// 已改名 ConversionHandle,与 core 的 ConvertContext 不再同名。
export type { ConversionHandle } from "../../convert/cancellation.js";
// throwIfCanceled 桶导出已删(消费方均直连装配层 cancellation.ts,桶出口无外部消费者)。
// commitArtifact 未入桶:消费方(single.ts)与测试经 dist 直连 dist/convert/artifact-writer.js。
export {
  buildConvertContext,
  createConvertContext,
  getImageResolver,
} from "../../convert/context.js";
export { ConvertCanceledError } from "../../convert/cancellation.js";
export type { ConvertResult } from "./merge.js";
export { mergeConvertImpl } from "./merge.js";
export { convertImpl } from "./single.js";
export { collectMarkdownPaths, filterExistingPaths, resolveOutputPath } from "../../convert/paths.js";
