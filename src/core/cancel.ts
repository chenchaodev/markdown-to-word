/**
 * 转换**取消原语**的单一来源(ADR-064 拆分后本文件零 import):
 * - 取消错误码与错误类型(ConversionCanceledError):取消是独立终态,不与
 *   「图片加载失败」「公式降级」「IO 失败」等普通失败混用同一通道——降级通道
 *   不得吞掉取消(吞掉后转换会带着残缺产物报成功)。
 * - CancellationGuard:core ConvertContext 的 signal/deadline 在渲染层的唯一
 *   载体。检查点集中在 throwIfCanceled();race() 让「回调不配合取消」(如永不
 *   结算的图片 resolver)也能退出,不等回调自身结算。
 * 原先同处此文件的图片请求级守卫(runImageRequest / createGuardedImageResolver 等
 * 五份导出)已搬到 image/request-guard.ts:它们判的是一次图片请求的时限与预算,与
 * 「取消」只是共用一个 AbortController。搬走之后依赖方向单向 —— 本模块不再反向依赖
 * image/、也不依赖 resource-limits.ts,故它可被任何目录放心复用。
 */

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

/**
 * 与守卫的取消信号竞速;work 失败时优先判定取消。
 * 取消优先是必须的:渲染层普遍「catch 后降级为警告」,若不先判定取消,
 * 取消会被降级通道吞成普通失败,转换带着半成品继续往下走。
 *
 * 本原语是**模块私有**:对外只经 CancellationGuard.race() 这一个门面暴露 ——
 * image/request-guard.ts 需要同一段时序语义时走该门面即可,故不导出,更不外抄一份
 * (见 image/request-guard.ts 文件头)。
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
