/**
 * renderer 结果展示(R8 自 renderer.ts 抽出,行为等价):
 * 常驻汇总条(成功/失败/取消三态 + 打开引导 + 可折叠警告)、转换完成弹窗(单文件/合并)、
 * 批量结果汇总弹窗与逐条渲染。只经 state.ts 读写状态。
 */
import {
  batchDialog,
  batchDialogCopyAll,
  batchDialogError,
  batchDialogOk,
  batchDialogRetry,
  batchDialogReveal,
  batchResultList,
  batchSummary,
  completeDialog,
  completeDialogCopy,
  completeDialogDesc,
  completeDialogError,
  completeDialogOk,
  completeDialogOpen,
  completeDialogReveal,
  completeDialogTitle,
  completeOutputPath,
  resultSummary,
  summaryDetailsBtn,
  summaryError,
  summaryIcon,
  summaryOpenBtn,
  summaryPath,
  summaryRevealBtn,
  summaryText,
  summaryWarnings,
  summaryWarningsList,
  summaryWarningsToggle,
} from "./dom.js";
import { state, type BatchItem, type BatchResult } from "./state.js";
import { baseName, focusActionButton, trapFocus } from "./utils.js";
import { batchSuccessPaths } from "./pure.js";
import { formatWarning, t } from "../core/i18n.js";
import type { ConvertWarning } from "../core/i18n.js";

/* 弹窗焦点陷阱句柄(批次 12:C9):打开时启用,关闭时解除 */
let completeDialogTrap: (() => void) | null = null;
let batchDialogTrap: (() => void) | null = null;

/* ---------- 转换结果汇总条(常驻,不依赖弹窗;成功/失败/取消三态 + 打开引导 + 可折叠警告) ---------- */
export interface SummaryOptions {
  kind: "ok" | "fail" | "canceled";
  title: string;
  outputPath?: string;
  error?: string;
  /** B6:keyed 警告,展示前经 formatWarning 按当前语言格式化。 */
  warnings?: ConvertWarning[];
  /** 批量场景:有失败详情可回看(「失败详情」按钮重开批量弹窗)。 */
  hasDetails?: boolean;
}

export function showSummary(opts: SummaryOptions): void {
  resultSummary.classList.remove("hidden");
  const ok = opts.kind === "ok";
  resultSummary.classList.toggle("result-summary--ok", ok);
  resultSummary.classList.toggle("result-summary--fail", !ok);
  summaryIcon
    .querySelector("path")
    ?.setAttribute("d", ok ? "M20 6L9 17l-5-5" : "M18 6L6 18M6 6l12 12");
  summaryText.textContent = opts.title;
  state.summaryOutputPath = opts.outputPath ?? "";
  summaryPath.classList.toggle("hidden", !opts.outputPath);
  if (opts.outputPath) {
    summaryPath.textContent = opts.outputPath;
    summaryPath.title = opts.outputPath;
  }
  summaryError.classList.toggle("hidden", !opts.error);
  if (opts.error) summaryError.textContent = opts.error;
  summaryRevealBtn.classList.toggle("hidden", !opts.outputPath);
  summaryOpenBtn.classList.toggle("hidden", !opts.outputPath);
  summaryDetailsBtn.classList.toggle("hidden", !opts.hasDetails);
  const warnings = opts.warnings ?? [];
  summaryWarnings.classList.toggle("hidden", warnings.length === 0);
  summaryWarningsToggle.textContent = t("summary.warnings", { count: warnings.length });
  summaryWarningsList.replaceChildren(
    ...warnings.map((warning) => {
      const li = document.createElement("li");
      li.className = "summary-warnings-item";
      li.textContent = formatWarning(warning); // B6:keyed 警告按当前语言格式化
      return li;
    }),
  );
}

/* ---------- 转换完成弹窗(单文件 / 合并) ---------- */
/**
 * 打开完成弹窗;error 非空时进入失败态(标题「转换失败」、路径行红色显示原因、
 * 隐藏复制/打开按钮),满足错误三要素:文件名(desc)+ 原因(路径行)+ 操作(确定)。
 */
export function showCompleteDialog(
  outputPath: string,
  error?: string,
  fileName?: string,
): void {
  state.dialogOutputPath = outputPath;
  const ok = !error;
  completeDialogTitle.textContent = ok ? t("dialog.complete.title") : t("dialog.failed.title");
  completeDialogDesc.textContent = ok
    ? t("dialog.complete.desc")
    : t("dialog.failed.desc", { name: fileName ?? "" });
  completeOutputPath.textContent = ok ? outputPath : (error ?? "");
  completeOutputPath.title = completeOutputPath.textContent;
  completeOutputPath.classList.toggle("dialog-path--error", !ok);
  completeDialogCopy.classList.toggle("hidden", !ok);
  completeDialogError.classList.add("hidden");
  completeDialogError.textContent = "";
  completeDialogReveal.classList.toggle("hidden", !ok);
  completeDialogOpen.classList.toggle("hidden", !ok);
  completeDialog.classList.remove("hidden");
  completeDialogOk.focus(); // 焦点落在默认操作(确定)上
  completeDialogTrap = trapFocus(completeDialog); // 批次 12(C9):Tab 循环不逃逸到背景页
}

export function hideCompleteDialog(): void {
  completeDialogTrap?.(); // 先解除陷阱,再归还焦点(不受循环限制)
  completeDialogTrap = null;
  completeDialog.classList.add("hidden");
  focusActionButton(); // 焦点还给触发按钮,便于键盘继续操作
}

/** 弹窗内错误提示(打开文件失败等非致命错误,不打断弹窗)。 */
export function showDialogError(message: string): void {
  completeDialogError.textContent = message;
  completeDialogError.classList.remove("hidden");
}

/* ---------- 批量结果汇总弹窗 ---------- */
export function showBatchDialog(result: BatchResult): void {
  const canceledText =
    result.canceledCount > 0
      ? t("batch.canceledSuffix", { count: result.canceledCount })
      : "";
  batchSummary.textContent = t("batch.summary", {
    ok: result.okCount,
    fail: result.failCount,
    canceled: canceledText,
  });
  batchSummary.classList.toggle("batch-summary--fail", result.failCount > 0);
  batchResultList.replaceChildren(...result.items.map(renderBatchItem));
  batchDialogReveal.classList.toggle("hidden", result.okCount === 0);
  // 批次 11 迭代 2:有失败项才显示「重试失败项」;无成功项禁用「复制全部路径」
  batchDialogRetry.classList.toggle("hidden", result.failCount === 0);
  batchDialogCopyAll.disabled = batchSuccessPaths(result.items).length === 0;
  batchDialogError.classList.add("hidden");
  batchDialogError.textContent = "";
  batchDialog.classList.remove("hidden");
  batchDialogOk.focus(); // 焦点落在默认操作(确定)上
  batchDialogTrap = trapFocus(batchDialog); // 批次 12(C9):Tab 循环不逃逸到背景页
}

export function hideBatchDialog(): void {
  batchDialogTrap?.(); // 先解除陷阱,再归还焦点(不受循环限制)
  batchDialogTrap = null;
  batchDialog.classList.add("hidden");
  focusActionButton();
}

/** 逐条结果:文件名 + 成功/失败/取消图标 + 警告(黄)/错误(红)/取消(灰)信息。 */
export function renderBatchItem(item: BatchItem): HTMLLIElement {
  const li = document.createElement("li");
  li.className = item.canceled
    ? "batch-item batch-item--canceled"
    : `batch-item batch-item--${item.ok ? "success" : "fail"}`;

  const head = document.createElement("div");
  head.className = "batch-item-head";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "batch-item-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2.5");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    item.canceled
      ? "M6 12h12" // 取消:横线
      : item.ok
        ? "M20 6L9 17l-5-5"
        : "M18 6L6 18M6 6l12 12",
  );
  icon.appendChild(path);
  head.appendChild(icon);

  const name = document.createElement("span");
  name.className = "batch-item-name";
  name.textContent = baseName(item.file);
  name.title = item.file; // 截断展示,悬停看完整路径
  head.appendChild(name);
  li.appendChild(head);

  // 信息行:警告在前(黄),错误(红)/取消(灰)在后
  const msgs = document.createElement("div");
  msgs.className = "batch-item-msgs";
  let hasMsgs = false;
  for (const warning of item.warnings ?? []) {
    const p = document.createElement("p");
    p.className = "batch-item-msg batch-item-msg--warning";
    p.textContent = t("batch.warningPrefix", { warning: formatWarning(warning) });
    msgs.appendChild(p);
    hasMsgs = true;
  }
  if (item.canceled) {
    const p = document.createElement("p");
    p.className = "batch-item-msg batch-item-msg--canceled";
    p.textContent = t("batch.canceledMsg");
    msgs.appendChild(p);
    hasMsgs = true;
  } else if (item.error) {
    const p = document.createElement("p");
    p.className = "batch-item-msg batch-item-msg--error";
    p.textContent = item.error;
    msgs.appendChild(p);
    hasMsgs = true;
  }
  if (hasMsgs) li.appendChild(msgs);

  return li;
}
