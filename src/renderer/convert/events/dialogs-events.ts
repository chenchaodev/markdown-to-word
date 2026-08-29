/**
 * 事件域·弹窗交互与菜单转发:
 * - 完成弹窗:打开所在文件夹 / 打开文件 / 复制路径 / 确定 / 遮罩点击 /
 *   「不再提示」与设置面板同字段双向同步;
 * - 批量汇总弹窗:打开所在文件夹(定位第一个成功项)/ 重试失败项 /
 *   复制全部路径 / 确定 / 遮罩点击;
 * - 常驻汇总条:打开所在文件夹 / 打开文件 / 失败详情(重开批量弹窗);
 * - Esc 关闭:另存为预设 → 完成 → 批量,按可见性互斥处理;
 * - 菜单转发:「文件 → 打开文件…」复用 selection.openDialog(false) 链路。
 * 依赖方向单向:本模块 → dom/state/utils/dialogs/file-list/convert-flow/
 * settings-panel/同目录 selection(仅 openDialog),无环。
 */
import {
  batchDialog,
  batchDialogCopyAll,
  batchDialogOk,
  batchDialogReveal,
  batchDialogRetry,
  completeDialog,
  completeDialogCopy,
  completeDialogOk,
  completeDialogOpen,
  completeDialogReveal,
  completeDialogSuppressInput,
  completeOutputPath,
  presetSaveDialog,
  summaryDetailsBtn,
  summaryOpenBtn,
  summaryRevealBtn,
} from "../../dom/refs.js";
import { state } from "../../state/state.js";
import { setError } from "../../state/utils.js";
import { batchRetryPaths, batchSuccessPaths, errorMessage } from "../../state/pure.js";
import {
  hideBatchDialog,
  hideCompleteDialog,
  showBatchDialog,
  showBatchDialogError,
  showDialogError,
} from "../../ui/dialogs.js";
import { applySelection } from "../file-list.js";
import { runBatch } from "../convert-flow.js";
import { closeSettingsDrawer, isSettingsDrawerOpen } from "../../settings/settings-drawer.js";
import { closeBookWizard } from "../../wizard/book-wizard.js";
import { closePresetSaveDialog, setSuppressCompleteDialog } from "../../settings/settings-panel.js";
import { openDialog } from "./selection.js";
import { t } from "../../../core/i18n.js";

/** 复制成功反馈文案恢复时长(「已复制」→ 原文案)。 */
const COPY_FEEDBACK_MS = 1500;

/* ---------- 本域事件绑定(index 组合入口逐域调用) ---------- */
export function bindDialogEvents(): void {
  // 完成弹窗:打开所在文件夹 / 打开文件(失败在弹窗内提示,不打断)
  completeDialogReveal.addEventListener("click", () => {
    if (!state.dialogOutputPath) return;
    window.api
      .revealInFolder(state.dialogOutputPath)
      .then((result) => {
        // 白名单外路径主进程返回 { ok:false, error },走同一错误提示通道
        if (!result.ok) showDialogError(t("common.revealFailed", { error: result.error ?? "" }));
      })
      .catch((err) =>
        showDialogError(t("common.revealFailed", { error: errorMessage(err) })),
      );
  });

  completeDialogOpen.addEventListener("click", () => {
    if (!state.dialogOutputPath) return;
    window.api
      .openFile(state.dialogOutputPath)
      .then((result) => {
        if (!result.ok) showDialogError(result.error ?? t("common.openFailedPlain"));
      })
      .catch((err) =>
        showDialogError(t("common.openFailed", { error: errorMessage(err) })),
      );
  });

  // 批量汇总弹窗:打开所在文件夹(定位第一个成功项)/ 确定
  batchDialogReveal.addEventListener("click", () => {
    const target = state.lastBatchResult?.items.find(
      (item) => item.ok && item.outputPath,
    )?.outputPath;
    if (!target) return;
    window.api
      .revealInFolder(target)
      .then((result) => {
        // 白名单外路径主进程返回 { ok:false, error },走 showBatchDialogError 封装
        if (!result.ok) showBatchDialogError(t("common.revealFailed", { error: result.error ?? "" }));
      })
      .catch((err) => {
        showBatchDialogError(t("common.revealFailed", { error: errorMessage(err) }));
      });
  });

  batchDialogOk.addEventListener("click", hideBatchDialog);
  batchDialog.addEventListener("click", (event) => {
    // 只响应遮罩本身,点卡片内部不关闭
    if (event.target === batchDialog) hideBatchDialog();
  });

  // 批量弹窗「重试失败项」:失败(非取消)项替换当前列表并立即重转,
  // 按原格式(lastBatchFormat)执行;允许单个失败文件单独重转
  batchDialogRetry.addEventListener("click", () => {
    if (state.mode !== null || !state.lastBatchResult) return;
    const failed = batchRetryPaths(state.lastBatchResult.items);
    if (failed.length === 0) return;
    hideBatchDialog();
    applySelection(failed);
    void runBatch(failed, state.lastBatchFormat);
  });

  // 批量弹窗「复制全部路径」:成功项输出路径换行拼接复制到剪贴板
  batchDialogCopyAll.addEventListener("click", () => {
    void (async () => {
      if (!state.lastBatchResult) return;
      const paths = batchSuccessPaths(state.lastBatchResult.items);
      if (paths.length === 0) return;
      try {
        await navigator.clipboard.writeText(paths.join("\n"));
        batchDialogCopyAll.textContent = t("common.copied");
        window.setTimeout(() => {
          batchDialogCopyAll.textContent = t("batch.copyAll");
        }, COPY_FEEDBACK_MS);
      } catch {
        showBatchDialogError(t("common.copyFailed"));
      }
    })();
  });

  // 完成弹窗「不再提示」:与设置面板「转换完成弹窗提示」同字段双向同步
  completeDialogSuppressInput.addEventListener("change", () => {
    setSuppressCompleteDialog(completeDialogSuppressInput.checked);
  });

  // 汇总条「打开所在文件夹 / 打开文件 / 失败详情」
  summaryRevealBtn.addEventListener("click", () => {
    if (!state.summaryOutputPath) return;
    window.api.revealInFolder(state.summaryOutputPath).then((result) => {
        // 白名单外路径主进程返回 { ok:false, error },走同一错误提示通道
        if (!result.ok) setError(t("common.revealFailed", { error: result.error ?? "" }));
    }).catch((err) => {
      setError(t("common.revealFailed", { error: errorMessage(err) }));
    });
  });

  summaryOpenBtn.addEventListener("click", () => {
    if (!state.summaryOutputPath) return;
    window.api
      .openFile(state.summaryOutputPath)
      .then((result) => {
        if (!result.ok) setError(result.error ?? t("common.openFailedPlain"));
      })
      .catch((err) =>
        setError(t("common.openFailed", { error: errorMessage(err) })),
      );
  });

  summaryDetailsBtn.addEventListener("click", () => {
    if (state.lastBatchResult) showBatchDialog(state.lastBatchResult);
  });

  // 完成弹窗「复制路径」(仅成功态显示;失败态隐藏该按钮)
  completeDialogCopy.addEventListener("click", () => {
    void (async () => {
      const text = completeOutputPath.textContent ?? "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        completeDialogCopy.textContent = t("common.copied");
        window.setTimeout(() => {
          completeDialogCopy.textContent = t("common.copyPath");
        }, COPY_FEEDBACK_MS);
      } catch {
        showDialogError(t("common.copyFailed"));
      }
    })();
  });

  // 应用菜单「文件 → 打开文件…」→ 复用现有选择链路(替换选择,与「选择文件」按钮一致)
  window.api.onMenuOpen(() => void openDialog(false));

  // 弹窗关闭:确定按钮 / 点击遮罩 / Esc 三种方式
  completeDialogOk.addEventListener("click", hideCompleteDialog);
  completeDialog.addEventListener("click", (event) => {
    // 只响应遮罩本身,点卡片内部不关闭
    if (event.target === completeDialog) hideCompleteDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!presetSaveDialog.classList.contains("hidden")) {
      // 另存为预设弹窗:统一走 closePresetSaveDialog 以解除焦点陷阱,不再直接操作 DOM
      closePresetSaveDialog();
    } else if (!completeDialog.classList.contains("hidden")) {
      hideCompleteDialog();
    } else if (!batchDialog.classList.contains("hidden")) {
      hideBatchDialog();
    } else if (isSettingsDrawerOpen()) {
      // 抽屉在 Esc 链末位(弹窗优先);关闭后焦点由 drawer 模块归还 ⚙ 按钮
      closeSettingsDrawer();
    } else {
      // 成书向导:弹窗/抽屉之后;元素动态创建,按 id 查询;关闭后焦点归还触发按钮
      const bookWizardEl = document.getElementById("bookWizard");
      if (bookWizardEl && !bookWizardEl.classList.contains("hidden")) closeBookWizard();
    }
  });
}
