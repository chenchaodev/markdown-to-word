/**
 * renderer 转换编排(R8 自 renderer.ts 抽出,行为等价):
 * 单文件 / 批量 / 合并三种转换流程——状态守卫与 mode 置位、进度条启停、
 * 结果经 dialogs 展示(汇总条 + 弹窗)。只经 state.ts 读写状态。
 * 批次 15(R5):转换成功后刷新最近区块改经 state.recentRefreshHandler 回调
 * (组合根 renderer.ts 接线),不再 import recent-files,打破 ESM 环。
 */
import { statusEl } from "./dom.js";
import { state } from "./state.js";
import {
  baseName,
  hideProgress,
  setError,
  setProgress,
  setStatus,
  showProgress,
} from "./utils.js";
import { showBatchDialog, showCompleteDialog, showSummary } from "./dialogs.js";
import { updateActionButtons } from "./file-list.js";

/** 单文件转换(与旧版行为一致)。 */
export async function runConvert(
  filePath: string,
  format: "docx" | "pdf",
): Promise<void> {
  state.mode = "single";
  state.converting = true;
  updateActionButtons(); // 禁用选择入口与转换按钮,防止重复点击
  setStatus("正在转换…");
  showProgress();
  try {
    const result = await window.api.convert(filePath, format);
    if (result.canceled) {
      setStatus("已取消");
      showSummary({ kind: "canceled", title: "转换已取消" });
    } else if (result.ok) {
      const outputPath = result.outputPath ?? "";
      setProgress(100);
      setStatus(`转换完成:${outputPath}`);
      statusEl.title = outputPath; // 长路径悬停可看完整
      showSummary({
        kind: "ok",
        title: "转换完成",
        outputPath,
        warnings: result.warnings,
      });
      // 批次 11 迭代 2:用户勾选「不再提示」后跳过弹窗(汇总条常驻展示结果)
      if (!state.suppressCompleteDialog) {
        showCompleteDialog(outputPath); // 弹窗展示完整路径,便于复制
      }
      void state.recentRefreshHandler?.(); // 批次 11:成功后刷新最近转换区块(批次 15 R5:经 state 回调,不再 import recent-files)
    } else {
      const error = result.error ?? "未知错误";
      setError(`转换失败:${error}`);
      showSummary({ kind: "fail", title: "转换失败", error });
      // 批次 11 迭代 2:用户勾选「不再提示」后失败弹窗同样跳过(汇总条已展示错误)
      if (!state.suppressCompleteDialog) {
        showCompleteDialog("", error, baseName(filePath)); // 失败弹窗:错误三要素
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`转换失败:${message}`);
    showSummary({ kind: "fail", title: "转换失败", error: message });
  } finally {
    state.mode = null;
    state.converting = false;
    hideProgress();
    updateActionButtons();
  }
}

/**
 * 批量转换:每文件独立输出,完成弹汇总弹窗逐条展示。
 * @param files 显式目标列表(批次 11 迭代 2「重试失败项」入口);缺省用当前选中列表。
 * @param format 显式格式(重试按原格式);缺省用当前格式选择。
 */
export async function runBatch(
  files?: string[],
  format?: "docx" | "pdf",
): Promise<void> {
  const targets = files ?? state.selectedFiles;
  // 主入口(不传文件)沿用「≥2 个文件」规则;重试失败项入口允许单个失败文件单独重转
  if (targets.length < (files === undefined ? 2 : 1)) return;
  const fmt = format ?? state.selectedFormat;
  state.lastBatchFormat = fmt; // 重试失败项按原格式重转
  state.mode = "batch";
  state.converting = true;
  updateActionButtons();
  setStatus(`正在批量转换 ${targets.length} 个文件…`);
  showProgress();
  try {
    const result = await window.api.convertBatch(targets, fmt);
    state.lastBatchResult = result;
    setProgress(100);
    const canceledText =
      result.canceledCount > 0 ? `,取消 ${result.canceledCount}` : "";
    const title =
      result.failCount > 0
        ? `批量完成:成功 ${result.okCount} / 失败 ${result.failCount}${canceledText}`
        : `批量完成:成功 ${result.okCount} 个文件${canceledText}`;
    setStatus(title, false, result.failCount > 0);
    showSummary({
      kind: result.failCount > 0 ? "fail" : "ok",
      title,
      hasDetails: result.failCount > 0,
      warnings: result.items.flatMap((item) => item.warnings ?? []),
    });
    showBatchDialog(result); // 成败均弹窗,逐条可见
    void state.recentRefreshHandler?.(); // 批次 11:批量结束刷新(主进程已记录成功项;批次 15 R5:经 state 回调)
  } catch (err) {
    state.lastBatchResult = null;
    const message = err instanceof Error ? err.message : String(err);
    setError(`批量转换失败:${message}`);
    showSummary({ kind: "fail", title: "批量转换失败", error: message });
  } finally {
    state.mode = null;
    state.converting = false;
    hideProgress();
    updateActionButtons();
  }
}

/** 合并转换:所有文件合成一个文档,复用完成弹窗。 */
export async function runMerge(): Promise<void> {
  if (state.selectedFiles.length < 2) return;
  state.mode = "merge";
  state.converting = true;
  updateActionButtons();
  setStatus("正在合并转换…");
  showProgress();
  try {
    const result = await window.api.convertMerge(
      state.selectedFiles,
      state.selectedFormat,
    );
    if (result.canceled) {
      setStatus("已取消");
      showSummary({ kind: "canceled", title: "合并已取消" });
    } else if (result.ok) {
      const outputPath = result.outputPath ?? "";
      setProgress(100);
      setStatus(`合并完成:${outputPath}`);
      statusEl.title = outputPath;
      showSummary({
        kind: "ok",
        title: "合并完成",
        outputPath,
        warnings: result.warnings,
      });
      // 批次 11 迭代 2:勾选「不再提示」后跳过弹窗(汇总条常驻展示结果)
      if (!state.suppressCompleteDialog) {
        showCompleteDialog(outputPath);
      }
      void state.recentRefreshHandler?.(); // 批次 11:成功后刷新最近转换区块(批次 15 R5:经 state 回调,不再 import recent-files)
    } else {
      const error = result.error ?? "未知错误";
      setError(`合并失败:${error}`);
      showSummary({ kind: "fail", title: "合并失败", error });
      // 批次 11 迭代 2:勾选「不再提示」后失败弹窗同样跳过(汇总条已展示错误)
      if (!state.suppressCompleteDialog) {
        showCompleteDialog("", error, `${baseName(state.selectedFiles[0])}-合并`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setError(`合并失败:${message}`);
    showSummary({ kind: "fail", title: "合并失败", error: message });
  } finally {
    state.mode = null;
    state.converting = false;
    hideProgress();
    updateActionButtons();
  }
}
