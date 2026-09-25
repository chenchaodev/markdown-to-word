/**
 * 转换取消与请求守卫契约单一来源:
 * - 取消错误码与错误类型(ConversionCanceledError):取消是独立终态,不与
 *   「图片加载失败」「公式降级」「IO 失败」等普通失败混用同一通道——降级通道
 *   不得吞掉取消(吞掉后转换会带着残缺产物报成功)。
 * - CancellationGuard:core ConvertContext 的 signal/deadline 在渲染层的唯一
 *   载体。检查点集中在 throwIfCanceled();race() 让「回调不配合取消」(如永不
 *   结算的图片 resolver)也能退出,不等回调自身结算。
 * - runImageRequest / createGuardedImageResolver:图片解析的请求级守卫——
 *   每次请求带独立 AbortController(signal 恒存在)、单请求时限、文档级预算,
 *   并保证超时按普通失败降级、取消按取消抛出。
 * 依赖方向单向:本模块 → resource-limits.ts(预算取值与台账)、image-resolver.ts(类型)。
 */
import {
  ImageBudgetLedger,
  resolveImageBudget,
  type ImageResourceBudget,
} from "./resource-limits.js";
import type { ImageResolver, ImageResolverRequest } from "./image/image-resolver.js";

/** 取消错误码:跨层稳定标识(测试与 IPC 消费方据此区分取消与普通失败) */
export const CONVERSION_CANCELED_CODE = "ERR_CONVERSION_CANCELLED";

/**
 * 转换已取消。抛出点覆盖:convert 入口检查点、各渲染阶段检查点、
 * 图片/图表回调等待处(经 race)、main 层取消闸门。
 * code 恒为 CONVERSION_CANCELED_CODE(main 层的 ConvertCanceledError 继承本类,
 * 故两侧错误同码:main 的取消经 isConversionCanceled 与 core 的取消不可区分)。
 */
export class ConversionCanceledError extends Error {
  readonly code = CONVERSION_CANCELED_CODE;

  constructor(message = "转换已取消") {
    super(message);
    this.name = "ConversionCanceledError";
  }
}

/** 取消判定(跨模块边界用:IPC/批量汇总只认错误码,不认类引用) */
export function isConversionCanceled(error: unknown): boolean {
  if (error instanceof ConversionCanceledError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === CONVERSION_CANCELED_CODE
  );
}

/** 取消入参:外部信号(IPC 取消 / 关窗放弃)与绝对截止时间(epoch ms),任一触发即取消 */
export interface CancellationOptions {
  signal?: AbortSignal;
  deadline?: number;
}

/** 渲染层取消守卫(由 createCancellationGuard 构造,勿手工实现) */
export interface CancellationGuard {
  /**
   * 合并后的取消信号(外部 signal 与 deadline 任一触发即 aborted);
   * 两者皆未提供时为 undefined(此时「无取消」,各守卫自行使用独立信号)。
   */
  readonly signal: AbortSignal | undefined;
  /** 是否已取消(检查点只读) */
  canceled(): boolean;
  /** 取消检查点:已取消即抛 ConversionCanceledError */
  throwIfCanceled(): void;
  /**
   * 与取消竞速:回调永不结算时也能在取消后立即退出。
   * 回调自身失败时优先判定取消(取消优先于普通失败,避免降级掩盖取消)。
   */
  race<T>(work: Promise<T>): Promise<T>;
  /** 距 deadline 的剩余毫秒(无 deadline 时返回 fallback) */
  remainingMs(fallback: number): number;
  /** 释放内部计时器(转换收尾调用;无计时器时为空操作,可重复调用) */
  dispose(): void;
}

const DEADLINE_EXCEEDED_MESSAGE = "转换已超过时间上限";

/**
 * 构造取消守卫。deadline 到期与外部 signal 触发合并为一个对外信号,
 * 渲染层各处只认这一个信号;已过期的 deadline 在构造时即置为已取消
 * (不建计时器),从而在入口检查点立即短路,不会启动任何 resolver。
 */
export function createCancellationGuard(options: CancellationOptions = {}): CancellationGuard {
  const { signal, deadline } = options;
  const deadlineController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (deadline !== undefined) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      deadlineController.abort(new ConversionCanceledError(DEADLINE_EXCEEDED_MESSAGE));
    } else {
      timer = setTimeout(
        () => deadlineController.abort(new ConversionCanceledError(DEADLINE_EXCEEDED_MESSAGE)),
        remaining,
      );
      timer.unref?.(); // 计时器不持有事件循环:无转换在跑时不得拖住进程退出
    }
  }
  const parts: AbortSignal[] = [];
  if (signal) parts.push(signal);
  if (deadline !== undefined) parts.push(deadlineController.signal);
  const combined = parts.length === 0 ? undefined : parts.length === 1 ? parts[0]! : AbortSignal.any(parts);
  const canceled = (): boolean => combined?.aborted === true;
  const guard: CancellationGuard = {
    signal: combined,
    canceled,
    throwIfCanceled() {
      if (canceled()) throw new ConversionCanceledError();
    },
    async race<T>(work: Promise<T>): Promise<T> {
      return await raceCancel(work, guard);
    },
    remainingMs(fallback: number): number {
      if (deadline === undefined) return fallback;
      return Math.max(0, deadline - Date.now());
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
  return guard;
}

/** 源信号 → 目标控制器 的单向联动;返回解除联动函数(移除监听,防监听器泄漏) */
function linkAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined;
  if (source.aborted) {
    target.abort(source.reason);
    return () => undefined;
  }
  const onAbort = (): void => target.abort(source.reason);
  source.addEventListener("abort", onAbort, { once: true });
  return () => source.removeEventListener("abort", onAbort);
}

/**
 * 与守卫的取消信号竞速;work 失败时优先判定取消。
 * 取消优先是必须的:渲染层普遍「catch 后降级为警告」,若不先判定取消,
 * 取消会被降级通道吞成普通失败,转换带着半成品继续往下走。
 */
async function raceCancel<T>(work: Promise<T>, guard: CancellationGuard): Promise<T> {
  const signal = guard.signal;
  if (guard.canceled()) throw new ConversionCanceledError();
  if (!signal) {
    try {
      return await work;
    } catch (err) {
      if (guard.canceled()) throw new ConversionCanceledError();
      throw err;
    }
  }
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        onAbort = (): void => reject(new ConversionCanceledError());
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } catch (err) {
    if (guard.canceled()) throw new ConversionCanceledError();
    throw err;
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** 图片请求的结算结果:失败区分「超时」与「一般失败」,两者都按普通降级处理 */
export type ImageRequestOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "timeout" | "failed"; error?: unknown };

/** 单次图片请求的守卫入参 */
export interface ImageRequestOptions<T> {
  /** 取消来源(超时只作用于本次请求,取消才中止整次转换) */
  guard: CancellationGuard;
  /** 预算默认值(本次请求的时限与字节上限来源) */
  budget: ImageResourceBudget;
  /** 覆盖本次请求的字节上限 */
  maxBytes?: number;
  /** 覆盖本次请求时限 */
  timeoutMs?: number;
  /** 实际解析动作(收到 request 即须自行遵守 signal 与 maxBytes) */
  run: (request: ImageResolverRequest) => Promise<T>;
}

/**
 * 跑一次带守卫的图片请求:
 * - 每次请求独立 AbortController → request.signal 恒存在,到期即中止;
 * - 超时(含回调永不结算)按「超时失败」返回,由调用方走既有图片失败降级;
 * - 外部取消 / deadline 到达抛 ConversionCanceledError,不得降级;
 * - 回调抛错不归一(经 outcome.error 原样带回),保留 fs 错误码供文案细分。
 */
export async function runImageRequest<T>(options: ImageRequestOptions<T>): Promise<ImageRequestOutcome<T>> {
  const { guard, budget } = options;
  const maxBytes = options.maxBytes ?? budget.maxImageBytes;
  const timeoutMs = Math.max(1, options.timeoutMs ?? budget.requestTimeoutMs);
  guard.throwIfCanceled();
  const controller = new AbortController();
  const detach = linkAbort(guard.signal, controller);
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 时限与取消都靠竞速:回调永不结算时也能退出(时限 → 普通失败降级;取消 → 上抛)
  const timeoutPromise = new Promise<{ ok: false; reason: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(); // 通知实现方:本次请求的 signal 到达时限
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);
    timer.unref?.(); // 计时器不持有事件循环
  });
  const request: ImageResolverRequest = { signal: controller.signal, maxBytes, timeoutMs };
  try {
    const work = Promise.resolve()
      .then(() => options.run(request))
      .then(
        (value) => ({ ok: true, value }) as const,
        (error: unknown) => ({ ok: false, reason: "failed", error }) as const,
      );
    const settled = await raceCancel(Promise.race([work, timeoutPromise]), guard);
    // 请求自身已失败但时限同时到达:统一按超时归类(超时是调用方可预期的降级路径)
    if (timedOut && !settled.ok) return { ok: false, reason: "timeout" };
    return settled;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    detach();
  }
}

/** 图片解析守卫包装入参 */
export interface GuardedImageResolverOptions {
  /** 原始 resolver(main 侧实现);缺省返回 undefined(保持「无 resolver」语义) */
  resolver?: ImageResolver;
  /** 取消守卫;缺省新建无外部取消的守卫 */
  guard?: CancellationGuard;
  /** 预算;缺省取默认值 */
  budget?: ImageResourceBudget;
  /** 文档级额度台账;缺省不记账(docx 嵌图记账,存在性检查不记账) */
  ledger?: ImageBudgetLedger;
  /** 字节结算口径(默认原始字节;pdf 外链按内联 data URL 长度结算) */
  costOf?: (data: Buffer) => number;
}

/**
 * 包装图片 resolver:注入请求契约(signal/maxBytes/timeoutMs)、单请求时限、
 * 文档级数量与字节预算,并保证取消不被降级通道吞掉。
 * exists 轻量通道一并包装(不计入字节/数量预算:存在性检查不产出嵌入字节)。
 */
export function createGuardedImageResolver(options: GuardedImageResolverOptions): ImageResolver | undefined {
  const { resolver, ledger } = options;
  if (!resolver) return undefined;
  const guard = options.guard ?? createCancellationGuard();
  const budget = options.budget ?? resolveImageBudget();
  const costOf = options.costOf ?? ((data: Buffer) => data.length);
  const load = async (src: string): Promise<Buffer | null> => {
    if (ledger && !ledger.tryBegin()) return null; // 数量预算耗尽:不发起请求
    const outcome = await runImageRequest({
      guard,
      budget,
      run: (request) => resolver(src, request),
    });
    // 失败分类口径(与既有实现一致,勿改):
    // - 超时 = 普通失败,归 null(既有下载器超时即返回 null);
    // - resolver 抛错原样上抛,保留 fs 错误码,供调用方按 ENOENT/EACCES 细分文案;
    // - 取消不在此归一,由 runImageRequest 抛取消错误直达调用方。
    if (!outcome.ok) {
      if (outcome.reason === "timeout") return null;
      throw outcome.error;
    }
    if (outcome.value === null) return null;
    if (ledger && !ledger.tryCharge(costOf(outcome.value))) return null; // 字节预算耗尽
    return outcome.value;
  };
  const existsChannel = resolver.exists;
  // 无 exists 通道时不凭空补一个:调用方据此回退完整解析(返回 null 与 exists=false
  // 的警告文案不同,凭空补齐会把「加载失败」误报为「文件不存在」)
  if (!existsChannel) return load;
  const exists = async (src: string, request?: ImageResolverRequest): Promise<boolean> => {
    const outcome = await runImageRequest({
      guard,
      budget,
      maxBytes: request?.maxBytes,
      timeoutMs: request?.timeoutMs,
      run: (guardedRequest) => existsChannel(src, guardedRequest),
    });
    if (!outcome.ok) {
      if (outcome.reason === "timeout") return false;
      throw outcome.error;
    }
    return outcome.value;
  };
  return Object.assign(load, { exists });
}
