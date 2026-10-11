/**
 * 事件域·弹窗交互与菜单转发:
 * - 完成弹窗:打开所在文件夹 / 打开文件 / 复制路径 / 确定 / 遮罩点击 /
 *   「不再提示」与设置面板同字段双向同步;
 * - 批量汇总弹窗:打开所在文件夹(定位第一个成功项)/ 重试失败项 /
 *   复制全部路径 / 确定 / 遮罩点击;
 * - 常驻汇总条:打开所在文件夹 / 打开文件 / 失败详情(重开批量弹窗);
 * - Esc 关闭:另存为预设 → 完成 → 批量,按可见性互斥处理;
 * - 菜单转发:「文件 → 打开文件…」复用 selection.openDialog(false) 链路。
 * 依赖方向单向:本模块 → dom/dom-ops/refs/file-list/convert-flow/同目录 selection
 * (仅 openDialog),无环。
 *
 * ⚠ 跨功能协作面(ui/dialogs · settings/settings-drawer · settings/settings-panel ·
 * settings/settings-preset-actions · wizard/book-wizard)自 REQ-218 #10 阶段④ 起
 * 经 `DialogEventsDeps` 注入(ADR-075 §四:组合根组装 · feature 侧接形参),本域零
 * 跨功能静态 import。**closePresetSave / closeWizard 是零参闭包** —— 组合根已把
 * ui 侧的 deps 绑好,本域与 Esc 链都不必知道 `afterModalClosed` 的 deps 形状;若让
 * 本域自己 import 那个类型,会造出一条新的 type-only 跨 feature 边(ADR-075 后果
 * 节点名的两侧分叉口:src 侧数得到、产物侧被编译期擦除,两侧读数对不上)。
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
import { setError } from "../../dom/dom-ops.js";
import { batchRetryPaths, batchSuccessPaths, errorMessage } from "../../state/pure.js";
import { applySelection, type FileListDeps } from "../file-list.js";
import {
  isConvertCommandBlocked,
  runBatch,
  type ConvertFlowDeps,
} from "../convert-flow.js";
import { openDialog } from "./selection.js";
import { t } from "../../../core/i18n/index.js";

/**
 * 本域注入的端口全集。ui/dialogs 的呈现面复用 convert-flow 那份
 * (`ConvertFlowDeps`:本域要 showBatchDialog,而它是 convert-flow 的呈现端口之一);
 * 选择管线复用 file-list 那份(`FileListDeps`:本域有两处改选择 —— 批量弹窗重试
 * 失败项、菜单转发「打开文件…」);
 * 其余按本域实际调用点自报。传函数本身,不传模块命名空间(ADR-075 §四)。
 *
 * **不许给任一项设默认值/可选参数**:port 缺失必须在 typecheck 处编译不过。
 *
 * ⚠ 本域的关闭动作一律**同步调用**(ADR-075 §二 禁令 4):Esc 链的「谁是末位」靠
 * 参数装配顺序与 `else if` 的求值顺序共同决定,改成惰性(port 返回 Promise / 微任务)
 * 会静默改掉末位语义而没有任何测试变红。
 */
export interface DialogEventsDeps extends ConvertFlowDeps, FileListDeps {
  /** ui/dialogs:完成弹窗关闭(组合根已绑好 ui 侧 deps,此处是零参闭包)。 */
  hideCompleteDialog: () => void;
  /** ui/dialogs:批量弹窗关闭(同上)。 */
  hideBatchDialog: () => void;
  /** ui/dialogs:预检报告关闭并结算 Promise(同上)。 */
  closePrecheckDialog: (ok: boolean) => void;
  /** ui/dialogs:弹窗内错误提示(完成 / 批量两个入口)。 */
  showDialogError: (message: string) => void;
  showBatchDialogError: (message: string) => void;
  /** ui/dialogs:复制成功的标签/反馈切换与读屏播报。 */
  showCopyFeedback: () => void;
  /** settings/settings-drawer:抽屉是否开着(Esc 链的判据面之一)。 */
  isSettingsDrawerOpen: () => boolean;
  /** settings/settings-drawer:关闭抽屉(Esc 链在向导之前)。 */
  closeSettingsDrawer: () => void;
  /** settings/settings-panel:「不再提示」与设置面板同字段双向同步。 */
  setSuppressCompleteDialog: (checked: boolean) => void;
  /** settings/settings-preset-actions:关闭「另存为预设」弹窗(零参闭包)。 */
  closePresetSave: () => void;
  /** wizard/book-wizard:关闭成书向导(零参闭包;Esc 链末位)。 */
  closeWizard: () => void;
}

/** 复制成功反馈的恢复由 ui/dialogs 统一管理(单实例计时器 + 打开即复位),
 *  本域只负责写剪贴板与调用 showCopyFeedback——不改写按钮文案。 */

/* ---------- 本域事件绑定(index 组合入口逐域调用) ---------- */
export function bindDialogEvents(deps: DialogEventsDeps): void {
  // 完成弹窗:打开所在文件夹 / 打开文件(失败在弹窗内提示,不打断)
  completeDialogReveal.addEventListener("click", () => {
    if (!state.dialogOutputPath) return;
    window.api
      .revealInFolder(state.dialogOutputPath)
      .then((result) => {
        // 白名单外路径主进程返回 { ok:false, error },走同一错误提示通道
        if (!result.ok) deps.showDialogError(t("common.revealFailed", { error: result.error ?? "" }));
      })
      .catch((err) =>
        deps.showDialogError(t("common.revealFailed", { error: errorMessage(err) })),
      );
  });

  completeDialogOpen.addEventListener("click", () => {
    if (!state.dialogOutputPath) return;
    window.api
      .openFile(state.dialogOutputPath)
      .then((result) => {
        if (!result.ok) deps.showDialogError(result.error ?? t("common.openFailedPlain"));
      })
      .catch((err) =>
        deps.showDialogError(t("common.openFailed", { error: errorMessage(err) })),
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
        if (!result.ok) deps.showBatchDialogError(t("common.revealFailed", { error: result.error ?? "" }));
      })
      .catch((err) => {
        deps.showBatchDialogError(t("common.revealFailed", { error: errorMessage(err) }));
      });
  });

  batchDialogOk.addEventListener("click", deps.hideBatchDialog);
  batchDialog.addEventListener("click", (event) => {
    // 只响应遮罩本身,点卡片内部不关闭
    if (event.target === batchDialog) deps.hideBatchDialog();
  });

  // 批量弹窗「重试失败项」:失败(非取消)项替换当前列表并立即重转,
  // 按原格式(lastBatchFormat)执行;允许单个失败文件单独重转
  batchDialogRetry.addEventListener("click", () => {
    if (state.mode !== null || !state.lastBatchResult) return;
    const failed = batchRetryPaths(state.lastBatchResult.items);
    if (failed.length === 0) return;
    deps.hideBatchDialog();
    applySelection(deps, failed);
    void runBatch(deps, failed, state.lastBatchFormat); // 预检由 runBatch 内部收口(只查重试的这一批)
  });

  // 批量弹窗「复制全部路径」:成功项输出路径换行拼接复制到剪贴板
  batchDialogCopyAll.addEventListener("click", () => {
    void (async () => {
      if (!state.lastBatchResult) return;
      const paths = batchSuccessPaths(state.lastBatchResult.items);
      if (paths.length === 0) return;
      try {
        await navigator.clipboard.writeText(paths.join("\n"));
        deps.showCopyFeedback();
      } catch {
        deps.showBatchDialogError(t("common.copyFailed"));
      }
    })();
  });

  // 完成弹窗「不再提示」:与设置面板「转换完成弹窗提示」同字段双向同步
  completeDialogSuppressInput.addEventListener("change", () => {
    deps.setSuppressCompleteDialog(completeDialogSuppressInput.checked);
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
    if (state.lastBatchResult) deps.showBatchDialog(state.lastBatchResult);
  });

  // 完成弹窗「复制路径」(仅成功态显示;失败态隐藏该按钮)
  completeDialogCopy.addEventListener("click", () => {
    void (async () => {
      const text = completeOutputPath.textContent ?? "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        deps.showCopyFeedback();
      } catch {
        deps.showDialogError(t("common.copyFailed"));
      }
    })();
  });

  // 应用菜单「文件 → 打开文件…」→ 复用现有选择链路(替换选择,与「选择文件」按钮一致)
  window.api.onMenuOpen(() => {
    if (!isConvertCommandBlocked()) void openDialog(deps, false);
  });

  // 弹窗关闭:确定按钮 / 点击遮罩 / Esc 三种方式
  completeDialogOk.addEventListener("click", deps.hideCompleteDialog);
  completeDialog.addEventListener("click", (event) => {
    // 只响应遮罩本身,点卡片内部不关闭
    if (event.target === completeDialog) deps.hideCompleteDialog();
  });
  // Esc 关闭链(ADR-075 §二 禁令 4):六段顺序即「末位语义」本身 ——
  // 预检 → 另存为预设 → 完成 → 批量 → 设置抽屉 → 成书向导(最后的 else,按 id 查询)。
  // 弹窗优先于抽屉,抽屉优先于向导;**每一段都是同步调用**,任一段改成惰性
  // (void / 微任务 / 回调)都会静默改掉「谁在末位」而没有任何测试变红。
  // 锚定:本块逐字结构由 test/renderer/convert-command-lock.test.js 的
  // 「Esc 链六段顺序」断言钉住(源文本层),运行期的末位前提(向导与抽屉互斥)由
  // test/renderer/wizard-command-guard.test.js 钉住。
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!document.getElementById("precheckDialog")?.classList.contains("hidden")) {
      deps.closePrecheckDialog(false);
    } else if (!presetSaveDialog.classList.contains("hidden")) {
      // 另存为预设弹窗:统一走 closePresetSave 以解除焦点陷阱,不再直接操作 DOM
      deps.closePresetSave();
    } else if (!completeDialog.classList.contains("hidden")) {
      deps.hideCompleteDialog();
    } else if (!batchDialog.classList.contains("hidden")) {
      deps.hideBatchDialog();
    } else if (deps.isSettingsDrawerOpen()) {
      // 抽屉在向导之前(弹窗优先);关闭后焦点由 drawer 模块归还 ⚙ 按钮
      deps.closeSettingsDrawer();
    } else {
      // 成书向导:弹窗/抽屉之后,是 Esc 链**末位**;元素动态创建,按 id 查询;
      // 关闭后焦点归还触发按钮
      const bookWizardEl = document.getElementById("bookWizard");
      if (bookWizardEl && !bookWizardEl.classList.contains("hidden")) deps.closeWizard();
    }
  });
}
