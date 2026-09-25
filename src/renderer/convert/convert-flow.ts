/**
 * 转换编排:单文件 / 批量 / 合并三种流程——状态守卫与 mode 置位、进度条启停、
 * 结果经 dialogs 展示(汇总条 + 弹窗)。只经 state.ts 读写状态。
 * 不变量:转换成功后经 state.recentRefreshHandler 回调刷新最近区块(组合根接线),
 * 不 import recent-files,避免 ESM 环。
 */
import { statusEl } from "../dom/refs.js";
import { state } from "../state/state.js";
import type { OperationBusyResult } from "../../core/ipc-contract.js";
import {
  hideProgress,
  setError,
  setProgress,
  setStatus,
  setStatusTone,
  showProgress,
  translate,
} from "../state/utils.js";
import { actionableError, baseName, errorMessage } from "../state/pure.js";
import { showBatchDialog, showCompleteDialog, showPrecheckDialog, showSummary } from "../ui/dialogs.js";
import { updateActionButtons } from "./file-list.js";
import { t } from "../../core/i18n.js";
import type { ConvertWarning } from "../../core/i18n.js";
import type { DocMetadata } from "../../core/pipeline/frontmatter.js";

/** 错误码 → 可操作文案(EBUSY/ENOENT/EACCES/ENOSPC/长路径;未识别透传)。 */
function displayError(message: string): string {
  return actionableError(message, translate);
}

/** 模态/向导打开时禁止背景命令;转换结果弹窗同样复用 dialog-overlay 标记。 */
function isModalCommandBlocked(): boolean {
  return document.querySelector(".dialog-overlay:not(.hidden)") !== null;
}

/** renderer 活动命令锁:转换、预检、模态/向导任一存在时拒绝新命令。 */
export function isConvertCommandBlocked(): boolean {
  return activePrecheckPromise !== null || state.mode !== null || isModalCommandBlocked();
}

function isBusyResult(value: unknown): value is OperationBusyResult {
  return typeof value === "object" && value !== null && "busy" in value && value.busy === true;
}

/** 当前预检/命令链;重复入口返回同一 Promise,所有出口 finally 清理。 */
let activePrecheckPromise: Promise<void> | null = null;
let activePrecheckToken: symbol | null = null;

/**
 * 转换前预检 + renderer command single-flight。聚合各文件警告,无问题静默继续;
 * 有问题弹报告对话。预检/用户决策/实际 action 视为同一命令,重复点击不启动第二条链。
 */
export function withPrecheck(
  filePaths: string[],
  action: () => void | Promise<void>,
): Promise<void> {
  if (activePrecheckPromise !== null) return activePrecheckPromise;
  if (state.mode !== null || isModalCommandBlocked()) return Promise.resolve();

  const token = Symbol("precheck-operation");
  const operation: Promise<void> = (async (): Promise<void> => {
    const warnings: ConvertWarning[] = [];
    for (const filePath of filePaths) {
      try {
        const ws = await window.api.precheck(filePath);
        if (isBusyResult(ws)) {
          setError(ws.error);
          return;
        }
        if (ws.length > 0) warnings.push(...ws);
      } catch {
        // 预检失败不阻断主流程
      }
    }
    if (warnings.length > 0) {
      const ok = await showPrecheckDialog(warnings);
      if (!ok) return;
    }
    // action 的首个同步段会置 state.mode;先释放预检锁,让受控 action 通过统一守卫。
    if (activePrecheckToken === token) {
      activePrecheckToken = null;
      activePrecheckPromise = null;
    }
    await action();
  })();
  activePrecheckToken = token;
  activePrecheckPromise = operation;
  void operation.then(
    () => {
      if (activePrecheckToken === token) {
        activePrecheckToken = null;
        activePrecheckPromise = null;
      }
    },
    () => {
      if (activePrecheckToken === token) {
        activePrecheckToken = null;
        activePrecheckPromise = null;
      }
    },
  );
  return operation;
}

/** 单文件转换(与旧版行为一致)。 */
export async function runConvert(
  filePath: string,
  format: "docx" | "pdf",
): Promise<void> {
  if (isConvertCommandBlocked()) return;
  state.mode = "single";
  updateActionButtons(); // 禁用选择入口与转换按钮,防止重复点击
  setStatus(t("convert.stage.converting"));
  setStatusTone("busy");
  showProgress();
  try {
    const result = await window.api.convert(filePath, format);
    if (isBusyResult(result)) {
      setError(result.error);
    } else if (result.canceled) {
      setStatus(t("common.canceled"));
      setStatusTone("");
      showSummary({ kind: "canceled", title: t("convert.canceled.title") });
    } else if (result.ok) {
      const outputPath = result.outputPath ?? "";
      setProgress(100);
      setStatus(t("convert.done.status", { outputPath }));
      setStatusTone("ok");
      statusEl.title = outputPath; // 长路径悬停可看完整
      showSummary({
        kind: "ok",
        title: t("convert.done.title"),
        outputPath,
        warnings: result.warnings,
      });
      // 用户勾选「不再提示」后跳过弹窗(汇总条常驻展示结果)
      if (!state.suppressCompleteDialog) {
        showCompleteDialog(outputPath); // 弹窗展示完整路径,便于复制
      }
      void state.recentRefreshHandler?.(); // 成功后刷新最近转换区块(经 state 回调,不再 import recent-files)
    } else {
      const error = displayError(result.error ?? t("common.unknownError"));
      setError(t("convert.failed.status", { error }));
      showSummary({ kind: "fail", title: t("convert.failed.title"), error });
      // 用户勾选「不再提示」后失败弹窗同样跳过(汇总条已展示错误)
      if (!state.suppressCompleteDialog) {
        showCompleteDialog("", error, baseName(filePath)); // 失败弹窗:错误三要素
      }
    }
  } catch (err) {
    const message = errorMessage(err);
    const error = displayError(message);
    setError(t("convert.failed.status", { error }));
    showSummary({ kind: "fail", title: t("convert.failed.title"), error });
  } finally {
    state.mode = null;
    hideProgress();
    updateActionButtons();
  }
}

/**
 * 批量转换:每文件独立输出,完成弹汇总弹窗逐条展示。
 * @param files 显式目标列表(「重试失败项」入口);缺省用当前选中列表。
 * @param format 显式格式(重试按原格式);缺省用当前格式选择。
 */
export async function runBatch(
  files?: string[],
  format?: "docx" | "pdf",
): Promise<void> {
  const targets = files ?? state.selectedFiles;
  // 主入口(不传文件)沿用「≥2 个文件」规则;重试失败项入口允许单个失败文件单独重转
  if (targets.length < (files === undefined ? 2 : 1)) return;
  if (state.mode !== null || isModalCommandBlocked()) return;
  const fmt = format ?? state.selectedFormat;
  state.lastBatchFormat = fmt; // 重试失败项按原格式重转
  state.mode = "batch";
  updateActionButtons();
  setStatus(t("convert.batch.stage", { count: targets.length }));
  setStatusTone("busy");
  showProgress();
  try {
    const result = await window.api.convertBatch(targets, fmt);
    if ("busy" in result) {
      setError(result.error);
      showSummary({ kind: "fail", title: t("convert.batch.failedTitle"), error: result.error });
      return;
    }
    state.lastBatchResult = result;
    setProgress(100);
    const canceledText =
      result.canceledCount > 0
        ? t("convert.batch.canceledSuffix", { count: result.canceledCount })
        : "";
    const title =
      result.failCount > 0
        ? t("convert.batch.doneMixed", {
            ok: result.okCount,
            fail: result.failCount,
            canceled: canceledText,
          })
        : t("convert.batch.doneAll", { count: result.okCount, canceled: canceledText });
    setStatus(title, false, result.failCount > 0);
    setStatusTone(result.failCount > 0 ? "" : "ok");
    showSummary({
      kind: result.failCount > 0 ? "fail" : "ok",
      title,
      hasDetails: result.failCount > 0,
      warnings: result.items.flatMap((item) => item.warnings ?? []),
    });
    showBatchDialog(result); // 成败均弹窗,逐条可见
    void state.recentRefreshHandler?.(); // 批量结束刷新(主进程已记录成功项;经 state 回调)
  } catch (err) {
    state.lastBatchResult = null;
    const message = errorMessage(err);
    setError(t("convert.batch.failed", { error: message }));
    showSummary({ kind: "fail", title: t("convert.batch.failedTitle"), error: message });
  } finally {
    state.mode = null;
    hideProgress();
    updateActionButtons();
  }
}

export async function runMerge(
  opts?: { files?: string[]; format?: "docx" | "pdf"; metadata?: DocMetadata },
): Promise<void> {
  const files = opts?.files ?? state.selectedFiles;
  const format = opts?.format ?? state.selectedFormat;
  const metadata = opts?.metadata;
  if (files.length < 2) return;
  if (state.mode !== null || isModalCommandBlocked()) return;
  state.mode = "merge";
  updateActionButtons();
  setStatus(t("convert.merge.stage"));
  setStatusTone("busy");
  showProgress();
  try {
    const result = await window.api.convertMerge(
      files,
      format,
      metadata ? { metadata } : undefined,
    );
    if (isBusyResult(result)) {
      setError(result.error);
    } else if (result.canceled) {
      setStatus(t("common.canceled"));
      setStatusTone("");
      showSummary({ kind: "canceled", title: t("convert.merge.canceledTitle") });
    } else if (result.ok) {
      const outputPath = result.outputPath ?? "";
      setProgress(100);
      setStatus(t("convert.merge.done", { outputPath }));
      setStatusTone("ok");
      statusEl.title = outputPath;
      showSummary({
        kind: "ok",
        title: t("convert.merge.doneTitle"),
        outputPath,
        warnings: result.warnings,
      });
      // 勾选「不再提示」后跳过弹窗(汇总条常驻展示结果)
      if (!state.suppressCompleteDialog) {
        showCompleteDialog(outputPath);
      }
      void state.recentRefreshHandler?.(); // 成功后刷新最近转换区块(经 state 回调,不再 import recent-files)
    } else {
      const error = displayError(result.error ?? t("common.unknownError"));
      setError(t("convert.merge.failed", { error }));
      showSummary({ kind: "fail", title: t("convert.merge.failedTitle"), error });
      // 勾选「不再提示」后失败弹窗同样跳过(汇总条已展示错误)
      // 入口已守卫 selectedFiles.length ≥ 2,首项必存在
      if (!state.suppressCompleteDialog) {
        showCompleteDialog(
          "",
          error,
          t("convert.merge.nameSuffix", { name: baseName(state.selectedFiles[0]!) }),
        );
      }
    }
  } catch (err) {
    const message = errorMessage(err);
    const error = displayError(message);
    setError(t("convert.merge.failed", { error }));
    showSummary({ kind: "fail", title: t("convert.merge.failedTitle"), error });
  } finally {
    state.mode = null;
    hideProgress();
    updateActionButtons();
  }
}

