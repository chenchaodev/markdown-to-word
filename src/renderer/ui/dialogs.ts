/**
 * renderer 结果展示:常驻汇总条(成功/失败/取消三态 + 打开引导 + 可折叠警告)、
 * 转换完成弹窗(单文件/合并)、批量结果汇总弹窗与逐条渲染。只经 state.ts 读写状态。
 * 模态关闭的唯一收尾入口 afterModalClosed 见文件末「模态关闭后的统一收尾」。
 *
 * 跨功能协作面(遮罩显隐变化后的动作按钮重算在 convert 侧)经 `ModalCloseDeps`
 * 注入,由组合根组装(ADR-075 §四:组合根组装 · feature 侧接形参 · 类型本模块自报)。
 * 全部关闭路径因此**都**要收 deps —— 这正是「遮罩显隐一变的唯一重算入口」
 * 这条不变量在解耦后的样子:该重算只经 afterModalClosed 发生一次。
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
  copyLiveEl,
  precheckDialog,
  precheckDialogDesc,
  precheckList,
  precheckContinue,
  precheckCancel,
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
} from "../dom/refs.js";
import { state, type BatchItem, type BatchResult } from "../state/state.js";
import { baseName } from "../state/pure.js";
import {
  focusActionButton,
  rememberFocusOrigin,
  restoreFocusOrigin,
  trapFocus,
} from "../dom/dom-ops.js";
import { batchSuccessPaths } from "../state/pure.js";
import { formatWarning, t } from "../../core/i18n/index.js";
import type { ConvertWarning } from "../../core/i18n/index.js";

/* 弹窗焦点陷阱句柄:打开时启用,关闭时解除。
 * 防御:show* 均先解除旧句柄再启用新陷阱(二次调用防御)——弹窗未 hide
 * 就被再次 show 时,旧 keydown 监听句柄若被直接覆盖会泄漏(当前流程互斥不会
 * 触发,防御性兜底)。 */
let completeDialogTrap: (() => void) | null = null;
let batchDialogTrap: (() => void) | null = null;

/* ---------- 复制反馈(标签/反馈两枚 i18n 节点 + 一条常驻读屏播报位) ----------
 * 契约:反馈不改写标签 textContent(改写会抹掉 data-i18n,语言切换后不再本地化);
 * 单实例 timer(后一次复制顶替前一次);弹窗打开前复位,不得跨弹窗残留。
 * 读屏播报:按钮内的显隐互换靠不住 —— 反馈节点是 display:none→flex 且文本
 * 不变,live region 收不到内容变更。故另设一条常驻 sr-only region(#copyLive)
 * 承接「已复制」,视觉仍由按钮内的显隐表达。
 * 失败不重复播报:失败走弹窗内 role=alert 错误块(showDialogError /
 * showBatchDialogError),那里已是即时打断位,再播一次会双重念白。 */
const COPY_FEEDBACK_MS = 1500;

const COPY_FEEDBACK_IDS = [
  { labelId: "completeDialogCopyLabel", okId: "completeDialogCopyOk" },
  { labelId: "batchDialogCopyAllLabel", okId: "batchDialogCopyAllOk" },
] as const;

let copyFeedbackTimer: number | undefined;

function setCopyFeedbackVisible(visible: boolean): void {
  for (const { labelId, okId } of COPY_FEEDBACK_IDS) {
    // 反馈可见时:标签隐藏、反馈节点显示;复位时相反
    document.getElementById(labelId)?.classList.toggle("hidden", visible);
    document.getElementById(okId)?.classList.toggle("hidden", !visible);
  }
}

/** 写入读屏播报位:先清空再写,保证「连续复制同一路径」也构成一次内容变更
 *  (文本不变时部分读屏会跳过播报)。#copyLive 是 index.html 的常驻契约节点,
 *  与其余 refs 同级,不设存在性兜底。 */
function announceCopyResult(message: string): void {
  copyLiveEl.textContent = "";
  copyLiveEl.textContent = message;
}

/** 复制成功:隐藏标签、显示「已复制」;到期复原(单实例计时器)并播报一次。 */
export function showCopyFeedback(): void {
  setCopyFeedbackVisible(true);
  announceCopyResult(t("common.copied"));
  if (copyFeedbackTimer !== undefined) window.clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = window.setTimeout(() => {
    copyFeedbackTimer = undefined;
    setCopyFeedbackVisible(false);
  }, COPY_FEEDBACK_MS);
}

/** 复位复制反馈:由 show* 弹窗入口调用,清掉上一次的反馈、计时器与播报残留。 */
export function resetCopyFeedback(): void {
  if (copyFeedbackTimer !== undefined) {
    window.clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = undefined;
  }
  setCopyFeedbackVisible(false);
  copyLiveEl.textContent = "";
}

/* ---------- 转换结果汇总条(常驻,不依赖弹窗;成功/失败/取消三态 + 打开引导 + 可折叠警告) ---------- */
/** 三态图标路径:成功勾 / 失败叉 / 取消横杠(取消为中性,不用红也不用绿)。 */
const SUMMARY_ICON_PATHS = {
  ok: "M20 6L9 17l-5-5",
  fail: "M18 6L6 18M6 6l12 12",
  canceled: "M6 12h12",
} as const;

export interface SummaryOptions {
  kind: "ok" | "fail" | "canceled";
  title: string;
  outputPath?: string;
  error?: string;
  /** keyed 警告,展示前经 formatWarning 按当前语言格式化。 */
  warnings?: ConvertWarning[];
  /** 批量场景:有失败详情可回看(「失败详情」按钮重开批量弹窗)。 */
  hasDetails?: boolean;
}

export function showSummary(opts: SummaryOptions): void {
  resultSummary.classList.remove("hidden");
  const kind = opts.kind;
  // 三态互斥:取消既不是成功也不是失败,不加 ok/fail 修饰类(视觉回归到中性纸面)
  resultSummary.classList.toggle("result-summary--ok", kind === "ok");
  resultSummary.classList.toggle("result-summary--fail", kind === "fail");
  resultSummary.classList.toggle("result-summary--canceled", kind === "canceled");
  summaryIcon
    .querySelector("path")
    ?.setAttribute("d", SUMMARY_ICON_PATHS[kind]);
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
       li.textContent = formatWarning(warning); // keyed 警告按当前语言格式化
      return li;
    }),
  );
  // 完成态收束重放:汇总条常驻、不再回 hidden,动画只会在首次显示时跑一次;
  // 摘挂 + 读一次 offsetWidth(强制样式重算)+ 挂回,让每一次完成都重新播一拍。
  // 读布局是本文件唯一一次强制重排,每次转换一次,代价可忽略。
  resultSummary.classList.remove("res-beat");
  void resultSummary.offsetWidth;
  resultSummary.classList.add("res-beat");
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
  resetCopyFeedback(); // 打开即复位:上一次的「已复制」不得跨弹窗残留
  completeDialog.classList.remove("hidden");
  rememberFocusOrigin(); // 记下触发元素(主操作钮 / 汇总条「失败详情」/ 快捷键)
  completeDialogOk.focus(); // 焦点落在默认操作(确定)上
  completeDialogTrap?.(); // 二次调用防御:先解除旧陷阱
  completeDialogTrap = trapFocus(completeDialog); // Tab 循环不逃逸到背景页
}

export function hideCompleteDialog(deps: DialogsDeps): void {
  completeDialogTrap?.(); // 先解除陷阱,再归还焦点(不受循环限制)
  completeDialogTrap = null;
  completeDialog.classList.add("hidden");
  afterModalClosed(deps); // 必须重算(见文件末「模态关闭后的统一收尾」);且在归还焦点之前
  restoreFocusOrigin(focusActionButton); // 焦点还给触发元素;失效则退到主操作钮
}

/** 弹窗内错误提示(打开文件失败等非致命错误,不打断弹窗)。 */
export function showDialogError(message: string): void {
  completeDialogError.textContent = message;
  completeDialogError.classList.remove("hidden");
}

/** 批量弹窗内错误提示(与 showDialogError 对称;reveal/复制失败等非致命
 *  错误统一走封装,不再直接操作 textContent——原两套写法归一)。 */
export function showBatchDialogError(message: string): void {
  batchDialogError.textContent = message;
  batchDialogError.classList.remove("hidden");
}

/* ---------- 批量结果汇总弹窗 ---------- */
/** 批量弹窗标题(按结果取语义,不恒写「完成」):失败走失败标题,全取消走中性取消,
 *  其余(含部分取消)走完成标题。语言切换后由 data-i18n 复位为完成标题。 */
function batchDialogTitleFor(result: BatchResult): string {
  if (result.failCount > 0) return t("convert.batch.failedTitle");
  if (result.okCount === 0 && result.canceledCount > 0) return t("common.canceled");
  return t("dialog.batch.title");
}

export function showBatchDialog(result: BatchResult): void {
  const titleEl = document.getElementById("batchDialogTitle");
  if (titleEl) titleEl.textContent = batchDialogTitleFor(result);
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
  // 有失败项才显示「重试失败项」;无成功项禁用「复制全部路径」
  batchDialogRetry.classList.toggle("hidden", result.failCount === 0);
  batchDialogCopyAll.disabled = batchSuccessPaths(result.items).length === 0;
  batchDialogError.classList.add("hidden");
  batchDialogError.textContent = "";
  resetCopyFeedback(); // 同完成弹窗:打开即复位复制反馈
  batchDialog.classList.remove("hidden");
  rememberFocusOrigin(); // 同完成弹窗:记下触发元素(批量钮 / 汇总条「失败详情」)
  batchDialogOk.focus(); // 焦点落在默认操作(确定)上
  batchDialogTrap?.(); // 二次调用防御:先解除旧陷阱
  batchDialogTrap = trapFocus(batchDialog); // Tab 循环不逃逸到背景页
}

export function hideBatchDialog(deps: DialogsDeps): void {
  batchDialogTrap?.(); // 先解除陷阱,再归还焦点(不受循环限制)
  batchDialogTrap = null;
  batchDialog.classList.add("hidden");
  afterModalClosed(deps); // 必须重算(见文件末「模态关闭后的统一收尾」);且在归还焦点之前
  restoreFocusOrigin(focusActionButton);
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

/* ---------- 转换预检报告弹窗 ---------- */
let precheckTrap: (() => void) | null = null;
let precheckResolve: ((ok: boolean) => void) | null = null;
let precheckPromise: Promise<boolean> | null = null;

/**
 * 预检报告的一组:一个源文件 + 它的全部告警。
 * 逐文件预检(convert-flow 的 withPrecheck 链)按此形状上送,故每条告警都能说清
 * 「来自哪个文件」——多文件场景下这层归属是报告的全部价值所在(此前是扁平列表,
 * 合并时无法判断哪份稿子的围栏没闭合)。
 */
export interface PrecheckWarningGroup {
  /** 源文件绝对路径(IPC 边界处的原值;界面只展示文件名,完整路径挂 title) */
  path: string;
  /** 该文件的告警(顺序与主进程返回一致) */
  warnings: ConvertWarning[];
}

/** 一条告警行(与既有形态同款:朱砂警示符 + 文字)。 */
function renderPrecheckItem(warning: ConvertWarning): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "precheck-item";
  const icon = document.createElement("span");
  icon.className = "precheck-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "!";
  const text = document.createElement("span");
  text.className = "precheck-text";
  text.textContent = formatWarning(warning);
  li.append(icon, text);
  return li;
}

/**
 * 预检相关的**文件显示名**:默认只给文件名(界面窄,全路径会挤掉正文;完整路径由
 * 载体挂 title 或落在可滚动区)。**同名文件例外**:候选集里出现重名时这些文件一律
 * 回退全路径 —— 两个条目显示同一个名字等于没区分,用户照着名字找不到自己那份稿。
 *
 * 判据单源:报告弹窗的分组标题(groups 的 path 列表)与合并阻断信息
 * (本次预检的 filePaths 列表)共用本函数,两处口径不得分叉。
 * @param paths 候选源文件路径(顺序即返回顺序)
 * @returns 与入参等长的显示名列表
 */
export function precheckFileLabels(paths: readonly string[]): string[] {
  const names = paths.map((path) => baseName(path));
  const duplicated = new Set(names.filter((name) => names.indexOf(name) !== names.lastIndexOf(name)));
  return paths.map((path, index) =>
    duplicated.has(names[index] ?? "") ? path : (names[index] ?? ""),
  );
}

/**
 * 展示预检报告;返回单实例 Promise<boolean>:用户点「继续转换」= true,「取消」= false。
 * 重复调用复用现有 Promise,防止后一次覆盖 resolver 令前一次永久悬挂。
 * 单文件(只有一组)时按扁平列表渲染——分组标题只服务于「多文件」这一种场景,
 * 单文件不额外多出一行标识(与引入分组前的形态逐字一致)。
 */
export function showPrecheckDialog(groups: PrecheckWarningGroup[]): Promise<boolean> {
  if (precheckPromise !== null) return precheckPromise;
  const total = groups.reduce((sum, group) => sum + group.warnings.length, 0);
  if (groups.length <= 1) {
    precheckList.replaceChildren(...groups.flatMap((group) => group.warnings.map(renderPrecheckItem)));
  } else {
    const labels = precheckFileLabels(groups.map((group) => group.path));
    precheckList.replaceChildren(
      ...groups.map((group, index) => {
        const li = document.createElement("li");
        li.className = "precheck-group";
        // 标题用 h3(dialog 标题是 h2):读屏按标题层级播报,用户能听出「下面这组属于
        // 哪个文件」,而视觉上靠 mono + 弱化色 + 无警示符,不会被误读成又一条告警
        const title = document.createElement("h3");
        title.className = "precheck-group-title";
        title.textContent = labels[index] ?? "";
        title.title = group.path; // 截断展示,悬停看完整路径
        const items = document.createElement("ul");
        items.className = "precheck-group-items";
        items.replaceChildren(...group.warnings.map(renderPrecheckItem));
        li.append(title, items);
        return li;
      }),
    );
  }
  precheckDialogDesc.textContent = t("precheck.desc", { count: total });
  precheckDialog.classList.remove("hidden");
  rememberFocusOrigin(); // 记下发起转换的那个动作,关闭后回到它
  precheckContinue.focus();
  precheckTrap?.(); // 二次调用防御:先解除旧陷阱
  precheckTrap = trapFocus(precheckDialog);
  precheckPromise = new Promise<boolean>((resolve) => {
    precheckResolve = resolve;
  });
  return precheckPromise;
}

/** 释放陷阱并归还焦点(关闭路径共用;焦点陷阱持有者已失效时不重复解除)。 */
function releasePrecheck(deps: DialogsDeps): void {
  precheckTrap?.();
  precheckTrap = null;
  precheckDialog.classList.add("hidden");
  afterModalClosed(deps); // 必须重算(见文件末「模态关闭后的统一收尾」);且在归还焦点之前
  restoreFocusOrigin(focusActionButton);
}

/** 预检报告所有关闭路径统一走此函数,确保 resolver 与 Promise 必定结算。 */
export function closePrecheckDialog(ok: boolean, deps: DialogsDeps): void {
  releasePrecheck(deps);
  precheckResolve?.(ok);
  precheckResolve = null;
  precheckPromise = null;
}

/** 预检弹窗按钮与遮罩。**绑定不留在模块加载期**:关闭路径要经 `DialogsDeps` 拿
 *  convert 侧的动作按钮重算端口,而端口只能由组合根给(ADR-075 §四:组合根组装 ·
 *  feature 侧接形参)——模块加载期没有 deps 可用。调用顺序不变:组合根在本文件
 *  其他模块的 bind 之前调本函数,故四条关闭路径(按钮 / 遮罩 / Esc(dialogs-events 域)
 * / 窗口关闭)仍全部经过 closePrecheckDialog 结算,任一路径遗漏都会让预检链与
 *  命令锁永久悬挂,表现为界面此后不再响应任何转换命令。
 */
export function bindPrecheckDialogEvents(deps: DialogsDeps): void {
  precheckContinue.addEventListener("click", () => closePrecheckDialog(true, deps));
  precheckCancel.addEventListener("click", () => closePrecheckDialog(false, deps));
  precheckDialog.addEventListener("click", (event) => {
    // 只响应遮罩本身,点卡片内部不关闭
    if (event.target === precheckDialog) closePrecheckDialog(false, deps);
  });
}
window.addEventListener("unload", () => {
  // 窗口关闭:不再归还焦点(页面即将销毁),只解除陷阱并按取消结算
  if (precheckPromise === null) return;
  precheckTrap?.();
  precheckTrap = null;
  precheckResolve?.(false);
  precheckResolve = null;
  precheckPromise = null;
});

/* ---------- 模态关闭后的统一收尾(遮罩显隐改变的唯一重算入口) ---------- */
/**
 * 本模块的跨功能协作面(ADR-075 §四:组合根组装 · feature 侧接形参 · 类型本模块自报;
 * 不新建共享 ports 文件 —— 四个功能根是平铺协作的 peer,共用一份等于给 peer mesh
 * 装枢纽,边数不降反增)。传函数本身(不传模块命名空间):传模块等于换一种形式把
 * 跨 feature 面全量暴露出去,拆边就白做了。
 *
 * **不许给任一项设默认值/可选参数**:port 缺失必须在 typecheck 处编译不过,
 * 而静默不生效(fail-open)比编译不过更糟 —— 它让接线错误在运行期无声溜过。
 */
export interface DialogsDeps {
  /**
   * convert/file-list:遮罩显隐一变后的动作按钮重算(原为 ui → convert 的静态 import,
   * 语义留在 ui、convert 的解法作为端口注入)。**同步调用**,不得改成惰性
   * (ADR-075 §二 禁令 4:Esc 关闭链的末位语义不许交给惰性 port)。
   */
  recomputeActionButtons: () => void;
}

/**
 * 遮罩显隐一变就重算动作按钮可用性。**所有**关闭路径必经本函数。
 *
 * 为什么关闭路径必须重算(真实卡死,用户实测 2026-09-29:批量转换完成后转换/批量/
 * 合并/追加文件/清空/选择六枚按钮永久灰态,界面像卡死):动作按钮的忙态判据
 * isBusy() → isConvertCommandBlocked() → isModalCommandBlocked() 是**纯 DOM 派生**
 * 的 —— 它读 `.dialog-overlay:not(.hidden)`,不读任何 JS 状态,故「弹窗开着」这件事
 * 只有 DOM 知道。而结果弹窗(showBatchDialog / showCompleteDialog)在受控执行段的
 * `endControlledRun()` **之前**打开,那次收尾重算读到的正是「弹窗还开着」,于是按钮
 * 停在灰态;此后若再无路径重算,用户关掉弹窗也回不来 —— 灰态被永久钉死。
 * 反过来也成立:打开弹窗同样是一次显隐变化,同样该重算(否则「看着能点、点了没反应」)。
 * 本函数幂等(只是重写 disabled / 显隐 / 提示文案),重复调用无副作用。
 *
 * 顺序要求:必须在 `restoreFocusOrigin` **之前**调用 —— 归还焦点要靠
 * isFocusableTarget / focusActionButton 挑一个「未 disabled」的主操作钮,按钮还停在
 * 灰态时它们会跳过全部候选,把焦点丢给舞台容器。
 *
 * 覆盖面对照:本模块三条关闭路径(完成 / 批量 / 预检报告)已经接上。dialogs 之外
 * 自带遮罩的模块(settings 的「另存为预设」presetSaveDialog、wizard 的成书向导
 * bookWizard,两者同样是 .dialog-overlay)也必须调本函数 —— 它们的 closeXxx 不在本
 * 模块内,漏调就是同一个坑(向导的「付印」转换结束即复现)。
 */
export function afterModalClosed(deps: DialogsDeps): void {
  deps.recomputeActionButtons();
}
