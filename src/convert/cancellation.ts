/**
 * 装配层取消语义:手柄类型 + 取消错误 + 闸门(ADR-064 处置表第 2 条)。
 *
 * 为什么独立成文件:仓库里曾有两份都叫 `ConvertContext` 的类型 —— 装配层这份
 * (5 字段:取消标志 / cancel() / signal / deadline / skipAfterConvert)与 core 那份
 * (21 字段纯数据转换上下文,见 core/convert.ts)。字段集差一倍多,同名却类型系统
 * 完全区分不了,读代码的人只能靠猜。把装配层这份改名为 `ConversionHandle` 并独立
 * 落在这里后,两个同名类型不再同处一个 import 面,core 那份一个字都没动。
 *
 * 本文件**只装取消语义**(手柄类型 / 取消错误 / 取消闸门);上下文装配
 * (createConvertContext / buildConvertContext)与图片解析器(getImageResolver /
 * resolveHeaderLogo)仍住 context.ts。
 */
// 取消错误码单源于 core/cancel.ts:本层 ConvertCanceledError 继承之,
// 故 main 取消与 core 渲染期取消同码(ERR_CONVERSION_CANCELLED);消费方
// (IPC 取消分支、批量汇总)一律用 isConversionCanceled 判定,不认类引用。
import { ConversionCanceledError } from "../core/cancel.js";

/**
 * 转换调用上下文:取消标志随调用携带,根治全局可变状态(历史 bug fd40480/f809c57
 * 即全局标志跨调用残留导致误判取消)。每次新转换调用新建 context(cancelRequested
 * 初始 false),「取消后复位」语义天然成立;IPC 层经 ctxByWebContents 注册表
 * (windows/web-contents-registry.ts)接 convert:cancel——主窗「放弃转换并关闭」
 * 走同一入口(cancelWebContentsOperation),故关窗中止与用户取消在转换层同构。
 * 原独立 ConvertOptions(仅 skipAfterConvert 一字段、批量调用处
 * undefined 占位)并入 ctx,签名 5 参 → 4 参,行为不变。
 * 副作用所有权:导出后行为(runAfterConvert)由「本次转换的拥有者」触发——
 * 单文件每次转换一次、合并每次合并一次、批量整批一次(逐文件置
 * skipAfterConvert 让位,由 batchConvertImpl 收口),本字段即让位标记。
 */
export interface ConversionHandle {
  /** 已请求取消(检查点只读;取消经 cancel() 置位) */
  cancelRequested: boolean;
  /** 请求取消(convert:cancel / 关窗放弃经 ctxByWebContents 注册表定位 ctx 后调用) */
  cancel(): void;
  /**
   * 取消信号:供 core ConvertContext 透传,使取消能到达渲染层各检查点与
   * 图片/图表回调(取消不再只能等整篇渲染结束才生效)。cancel() 即置为 aborted。
   */
  signal: AbortSignal;
  /** 绝对截止时间(epoch ms,可选):传入后 core 在该时刻按取消处理 */
  deadline?: number;
  /** 让位:本次转换不触发导出后行为(批量逐文件调用置位,批次末尾由 batchConvertImpl 统一触发一次) */
  skipAfterConvert?: boolean;
}

/**
 * 转换已取消(装配层闸门抛出)。继承 core 的取消错误类型:
 * 错误码与渲染期取消一致(ERR_CONVERSION_CANCELLED),name 保持本层历史取值
 * (GUI 文案与既有测试按 name 判定),两者可互相替换。
 */
export class ConvertCanceledError extends ConversionCanceledError {
  constructor() {
    super("已取消");
    this.name = "ConvertCanceledError";
  }
}

export function throwIfCanceled(ctx: ConversionHandle): void {
  if (ctx.cancelRequested) throw new ConvertCanceledError();
}
