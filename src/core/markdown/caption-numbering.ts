/**
 * 图/表题注计数的纯函数单源。
 *
 * 从 pdf/rules/xref.ts:141-151 抽出:该处原先同时持有「fig/tab 计数」「h1 处重置」
 * 与「章节号 + 序数」的文本拼接三件事。三处消费方(pdf 交叉引用登记、pdf 模板
 * CSS 显示、剪贴板字面编号)必须同口径,故把前两件与拼接拆成可复用纯函数:
 * - pdf xref 改为调用本模块,行为零变化;
 * - 剪贴板渲染器直接复用同一函数生成字面编号(不依赖 CSS counter / ::before)。
 *
 * 口径(与 xref.ts 原实现逐字一致):
 * - headingNumbering && hasH1 →「图 <h1 计数>.<序数>」;
 * - 否则纯序数「图 <序数>」;
 * - 序数按 kind 各自累计,由调用方在 h1 处(且 hasH1)重置。
 */
import type { CaptionKind } from "./cross-ref.js";

/** 图/表题注计数器(fig 与 tab 各占一条序号线) */
export interface CaptionCounters {
  fig: number;
  tab: number;
}

/** 新建全零题注计数器 */
export function createCaptionCounters(): CaptionCounters {
  return { fig: 0, tab: 0 };
}

/** 重置两条序号线(h1 处按 hasH1 条件调用,镜像原 xref 的两分支) */
export function resetCaptionCounters(counters: CaptionCounters): void {
  counters.fig = 0;
  counters.tab = 0;
}

/** 递增并返回该 kind 的当前序数(1 起) */
export function bumpCaptionCounter(counters: CaptionCounters, kind: CaptionKind): number {
  counters[kind] += 1;
  return counters[kind];
}

/** 编号文本拼接所需的上下文 */
export interface CaptionNumberContext {
  /** 章节编号开关(关闭时忽略 chapterNumber,纯序数) */
  headingNumbering: boolean;
  /** 文档是否存在任意 h1(决定是否输出章节号;镜像 pdf CSS 两分支) */
  hasH1: boolean;
  /** 最近一次 h1 的章节号(无 h1 / 首个 h1 之前为 0) */
  chapterNumber: number;
}

/**
 * 题注显示文本:「图 1.2」/「表 3」。
 *
 * 与 pdf/rules/xref.ts 原 `numberText` 表达式等价:仅当 headingNumbering && hasH1
 * 才输出 `<h1 计数>.` 前缀;首个 h1 之前 chapterNumber 为 0 时同样输出「图 0.N」
 * (既有行为,不是本函数引入的差异)。
 */
export function captionNumberText(
  kind: CaptionKind,
  seq: number,
  context: CaptionNumberContext,
): string {
  const label = kind === "fig" ? "图" : "表";
  const chapter = context.headingNumbering && context.hasH1 ? `${context.chapterNumber}.` : "";
  return `${label} ${chapter}${seq}`;
}
