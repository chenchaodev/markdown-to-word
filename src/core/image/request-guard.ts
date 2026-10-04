/**
 * 图片解析的**请求级守卫**:每次请求一份独立 AbortController(signal 恒存在)、
 * 单请求时限、文档级预算,并保证「超时按普通失败降级、取消按取消抛出」。
 * 放在 core/image/ 而不是 core/cancel.ts(ADR-064):这三份导出与「取消」只是共用一个
 * AbortController,它们判的是一次图片请求的时限与预算 —— 改图片超时的人第一反应是来
 * image/,让他在 cancel.ts 里找到才是负担。
 *
 * **raceCancel 为何不经 import 而走 guard.race()**:raceCancel 是 cancel.ts 的模块私有
 * 原语(不被导出,故它没有第二个调用方);CancellationGuard.race() 就是它对本文件的公开
 * 门面(实现即 `return await raceCancel(work, guard)`),语义逐字相同。因此这里不导出
 * raceCancel、不复制它,也不从 cancel.ts 引一个只为绕开私有性的导出 —— 原语留在它的
 * 归属文件里由消费方经既有门面调用。「在 image/request-guard.ts 里另抄一份」是明确禁止
 * 的:那正是「原语被两个目录各持一份」,与 ADR-064 的方向相反。
 *
 * **linkAbort 为何一并搬来**:它的唯一调用方就是 runImageRequest(实测 cancel.ts 内仅
 * 两处提及:定义与那一处调用),它是随这段时序逻辑走的私有辅助,留在 cancel.ts 会变成
 * 一个「本文件内无人调用」的孤儿。
 *
 * 依赖方向单向:本模块 → cancel.ts(取消原语)、../resource-limits.ts(预算取值与台账)、
 * ./image-resolver.js(类型)。本模块不引 markdown / docx / pdf(判据 core-image-no-markdown)。
 */
import {
  ImageBudgetLedger,
  resolveImageBudget,
  type ImageResourceBudget,
} from "../resource-limits.js";
import { createCancellationGuard, type CancellationGuard } from "../cancel.js";
import type { ImageResolver, ImageResolverRequest } from "./image-resolver.js";

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
    // guard.race 即 cancel.ts 的 raceCancel(work, guard)(见文件头),取消优先于普通失败
    const settled = await guard.race(Promise.race([work, timeoutPromise]));
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
