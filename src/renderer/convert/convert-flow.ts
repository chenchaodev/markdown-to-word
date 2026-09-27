/**
 * 转换编排:单文件 / 批量 / 合并三种流程——状态守卫与 mode 置位、进度条启停、
 * 结果经 dialogs 展示(汇总条 + 弹窗)。只经 state.ts 读写状态。
 * 命令锁:isBackgroundCommandBlocked(转换中/模态向导)与 isConvertCommandBlocked
 * (再加预检中)为所有入口的唯一前置校验,预检链经 withPrecheck single-flight。
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
} from "../ui/dom-ops.js";
import { actionableError, baseName, errorMessage } from "../state/pure.js";
import {
  precheckFileLabels,
  showBatchDialog,
  showCompleteDialog,
  showPrecheckDialog,
  showSummary,
  type PrecheckWarningGroup,
} from "../ui/dialogs.js";
import { setCommandBusyProbe, updateActionButtons } from "./file-list.js";
import { t } from "../../core/i18n.js";
import { formatWarning, type ConvertWarning, type KeyedWarning } from "../../core/i18n.js";
import type { DocMetadata } from "../../core/pipeline/frontmatter.js";

/** 错误码 → 可操作文案(EBUSY/ENOENT/EACCES/ENOSPC/长路径;未识别透传)。 */
function displayError(message: string): string {
  return actionableError(message, translate);
}

/** 活动预检链:令牌 + Promise。重复入口复用同一条链,所有出口按令牌释放。 */
interface ActivePrecheck {
  token: symbol;
  promise: Promise<void>;
}

/** 预检中(命令锁的一部分):预检链存在期间新命令一律拒绝。 */
let activePrecheck: ActivePrecheck | null = null;

/**
 * 当前命令链已预检过的源文件;null = 没有链在执行 action 段。
 * 存在的理由:一条命令里可能连着发多次转换(成书向导「付印」docx+pdf 两格式),
 * 若每次转换各自预检一遍,一次付印就会弹两次一模一样的报告、也多发一倍 IPC。
 * 链内续作据此**只补未预检过的文件**,已覆盖的直接放行(并集累积,直到最外层链
 * 的 action 结束才清空)。
 * 安全前提(改动时必须守住):本集合只在某条链的 action 执行期间非 null,而
 * action 的首个同步段就置 state.mode —— 于是「无锁且无 mode」的窗口不存在,
 * 外部命令读到的永远是本链自己的覆盖情况。
 */
let chainCovered: Set<string> | null = null;

/** 令牌比对释放:已过期的旧链不得清掉后一条链的锁。 */
function releasePrecheck(token: symbol): void {
  if (activePrecheck === null || activePrecheck.token !== token) return;
  activePrecheck = null;
  updateActionButtons(); // 预检结束:按钮忙态随命令锁复位
}

// 预检期按钮置灰:探针注入使按钮忙态与本模块的命令锁同源(反向注册,避免 file-list 依赖本模块)
setCommandBusyProbe(isConvertCommandBlocked);

/** 模态/向导打开时禁止背景命令;转换结果弹窗同样复用 dialog-overlay 标记。 */
function isModalCommandBlocked(): boolean {
  return document.querySelector(".dialog-overlay:not(.hidden)") !== null;
}

/**
 * 统一前置校验(不含预检锁):转换中或模态/向导打开时拒绝新命令。
 * 预检链自身的续作(报告弹窗「继续转换」)不被自身预检锁拦住,只受本判定约束。
 */
export function isBackgroundCommandBlocked(): boolean {
  return state.mode !== null || isModalCommandBlocked();
}

/** renderer 活动命令锁:预检、转换、模态/向导任一存在时拒绝新命令。 */
export function isConvertCommandBlocked(): boolean {
  return activePrecheck !== null || isBackgroundCommandBlocked();
}

function isBusyResult(value: unknown): value is OperationBusyResult {
  return typeof value === "object" && value !== null && "busy" in value && value.busy === true;
}

/** 合并阻断信息:由预检链判定,交合并入口按其既有失败路径呈现。 */
export interface MergeBlockReport {
  /** 命中阻断的源文件(展示用文件名,与合并其余文案一致) */
  file: string;
  /** 未闭合围栏的起始行号(取自告警 params;告警没带则为 null) */
  lineNo: string | number | null;
  /** 除首个之外还有几个文件同样带阻断告警(0 = 只有这一个) */
  moreFiles: number;
}

/**
 * 预检处置口径。判别联合:只有 kind="merge" 会因 blocksMerge 告警阻断,且
 * **必须**同时给出呈现回调(阻断是合并专属的失败形态,单文件/批量没有对应物);
 * single/batch 不接受该回调 —— 它们永不阻断,给了即为误用。
 */
type PrecheckPolicy =
  | { kind: "single" | "batch" }
  | { kind: "merge"; onBlocked: (report: MergeBlockReport) => void };

/** blocksMerge 信号:字面量 true 才是阻断信号(字符串告警与无该键的告警一律不算)。 */
function isMergeBlocking(warning: ConvertWarning): warning is KeyedWarning {
  return typeof warning !== "string" && warning.blocksMerge === true;
}

/**
 * 逐文件预检并汇总告警(按源文件分组,报告里能看出每条来自哪份稿子);
 * 无告警静默放行,有告警弹报告对话框。返回是否放行。
 * 口径(不放行的几种,均沿用既有语义):预检返回 busy → 提示并中止;用户点「取消」
 * → 中止;报告决策期间出现别的转换/模态 → 中止;**合并命中 blocksMerge → 走
 * onBlocked 呈现阻断并中止**(不弹报告框:那个框的「继续转换」对阻断是假按钮)。
 * 逐文件预检抛错 → 该文件跳过(不阻断主流程,见 catch 注记)。
 */
async function confirmPrecheck(
  filePaths: readonly string[],
  policy: PrecheckPolicy,
): Promise<boolean> {
  const groups: PrecheckWarningGroup[] = [];
  for (const filePath of filePaths) {
    try {
      const ws = await window.api.precheck(filePath);
      if (isBusyResult(ws)) {
        setError(ws.error);
        return false;
      }
      if (ws.length > 0) groups.push({ path: filePath, warnings: ws });
    } catch {
      // 预检失败不阻断主流程
    }
  }
  if (groups.length === 0) return true;
  if (policy.kind === "merge") {
    // 只详报第一个出问题的文件(避免把一长串文件名塞进状态行),其余只给个数
    const blocking = groups.flatMap((group) =>
      group.warnings.filter(isMergeBlocking).map((warning) => ({ group, warning })),
    );
    const first = blocking[0];
    if (first !== undefined) {
      // 显示名与报告弹窗同一判据(同名回退全路径):候选集取**本次预检的全部源文件**
      // —— 同名的干净孪生文件同样会让「intro.md」指代不明,而阻断是硬阻断、用户
      // 没有「点继续」这条路可走,指代不清就得来回试错。
      const labels = precheckFileLabels(filePaths);
      const firstIndex = filePaths.indexOf(first.group.path);
      policy.onBlocked({
        file: labels[firstIndex] ?? baseName(first.group.path),
        lineNo: first.warning.params?.lineNo ?? null,
        moreFiles: new Set(blocking.slice(1).map((hit) => hit.group.path)).size,
      });
      return false;
    }
  }
  if (!(await showPrecheckDialog(groups))) return false;
  // 决策等待期间可能已进入转换或新模态打开:续作与其他入口共用同一前置校验
  return !isBackgroundCommandBlocked();
}

/**
 * 转换前预检 + renderer command single-flight。逐文件聚合告警,无问题静默继续;
 * 有问题弹报告对话。预检/用户决策/实际 action 视为同一命令,重复点击不启动第二条链。
 * 返回的 Promise 必定结算(取消/忙碌/决策后受阻/异常均收敛),调用方 void 启动即可。
 * @param policy 处置口径;缺省按 single(不阻断)。成书向导只借锁、传空文件列表,
 *   故不传该参;真正的转换一律经 precheckedCommand 显式传自己的 kind。
 */
export function withPrecheck(
  filePaths: string[],
  action: () => void | Promise<void>,
  policy: PrecheckPolicy = { kind: "single" },
): Promise<void> {
  if (activePrecheck !== null) return activePrecheck.promise;
  if (isBackgroundCommandBlocked()) return Promise.resolve();

  const token = Symbol("precheck-command");
  const operation = runPrecheckChain(token, filePaths, action, policy);
  // ⚠️ 登记顺序:链体的**第一个语句必须含 await**(现为 confirmPrecheck)。
  // 链体在第一个 await 处挂起后本行才执行,故 activePrecheck 一定先于链内任何
  // 动作生效。若日后把链体改成同步起步,本行的登记会晚于链内动作,出现
  // 「锁尚未登记就被自己的动作重入/覆盖」→ 命令锁释放不掉、界面此后不响应。
  activePrecheck = { token, promise: operation };
  updateActionButtons(); // 预检进行中:按钮置灰(与点击守卫一致)
  return operation;
}

/**
 * 预检链主体:逐文件预检 → 报告决策 → 交接 action。
 * 锁与 state.mode 的交接在 action 首个同步段的前后完成(其间无 await),
 * 两条命令链不会同时处于「无锁且无 mode」的空档。
 */
async function runPrecheckChain(
  token: symbol,
  filePaths: string[],
  action: () => void | Promise<void>,
  policy: PrecheckPolicy,
): Promise<void> {
  try {
    if (!(await confirmPrecheck(filePaths, policy))) return;
    // action 的首个同步段会置 state.mode;先释放预检锁,让受控 action 通过统一守卫。
    // 覆盖集在本段交接给 action(action 期间非 null,供链内续作免重复预检)。
    const covered = new Set(filePaths);
    releasePrecheck(token);
    chainCovered = covered;
    try {
      await action();
    } finally {
      chainCovered = null;
    }
  } catch (err) {
    // 链自身异常不外泄为未处理拒绝(各入口均 void 启动):命令未执行,按失败提示
    setError(errorMessage(err));
  } finally {
    releasePrecheck(token);
  }
}

/**
 * 预检收口(批量 / 合并的入口用):链外走完整预检链;链内续作(同一条命令里的后续
 * 转换,如成书向导付印 docx+pdf)只补本链尚未预检过的文件,已覆盖的直接放行。
 * 链内路径**不再起新链**:外层链的锁正被其 action 使用,再起一条会与它互相覆盖
 * 登记(内层链释放不掉 → 命令锁悬挂,界面此后不再响应任何命令)。
 * @param filePaths 本次转换的源文件
 * @param action 受控执行段(首个同步段即置 state.mode)
 * @param policy 处置口径(决定 blocksMerge 告警是否阻断本次命令)
 */
async function precheckedCommand(
  filePaths: string[],
  action: () => Promise<void>,
  policy: PrecheckPolicy,
): Promise<void> {
  const covered = chainCovered;
  if (covered === null) return withPrecheck(filePaths, action, policy);
  const pending = filePaths.filter((filePath) => !covered.has(filePath));
  for (const filePath of pending) covered.add(filePath);
  if (pending.length > 0) {
    if (!(await confirmPrecheck(pending, policy))) return;
    // 补检期间(此处有 await,而外层链的锁已交给 action)若有别的命令起链,
    // 统一守卫拦下本次续作,避免两条命令并发。
    if (isBackgroundCommandBlocked()) return;
  }
  await action();
}

/**
 * 单文件转换:先预检这一个源文件(与批量/合并同一道防线),再转换。
 * 预检收口在本函数内部 —— 故任何入口(转换按钮 / 快捷键 / 粘贴直转 / 最近记录
 * 行内重转)直接调用本函数即可,既不必自带 withPrecheck,也不会漏掉预检。
 * @param filePath 源文件绝对路径
 * @param format 目标格式
 */
export function runConvert(filePath: string, format: "docx" | "pdf"): Promise<void> {
  return precheckedCommand([filePath], () => runConvertAction(filePath, format), {
    kind: "single", // 单文件里未闭合围栏只影响本文件,维持「警告 + 可继续」
  });
}

/**
 * 单文件转换的受控执行段:首个同步段即置 state.mode(理由同 runBatchConvert)。
 */
async function runConvertAction(filePath: string, format: "docx" | "pdf"): Promise<void> {
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
 * 批量转换:先逐文件预检(与单文件同一道防线),再每文件独立输出,完成弹汇总弹窗逐条展示。
 * 预检收口在本模块内部,故各入口直接调本函数即可,不再自带 withPrecheck 包裹。
 * @param files 显式目标列表(「重试失败项」入口);缺省用当前选中列表。
 * @param format 显式格式(重试按原格式);缺省用当前格式选择。
 */
export function runBatch(files?: string[], format?: "docx" | "pdf"): Promise<void> {
  const targets = files ?? state.selectedFiles;
  // 主入口(不传文件)沿用「≥2 个文件」规则;重试失败项入口允许单个失败文件单独重转
  if (targets.length < (files === undefined ? 2 : 1)) return Promise.resolve();
  return precheckedCommand(targets, () => runBatchConvert(targets, format), {
    kind: "batch", // 批量每份各自成文,围栏不跨文件,维持「警告 + 可继续」
  });
}

/**
 * 批量转换的受控执行段:首个同步段即置 state.mode。
 * 不得在本段开头插入任何 await —— 预检链恰在调用 action 之前释放预检锁,靠这段
 * 同步前缀把锁交接成 mode,中间一旦让出微任务就会留下「无锁且无 mode」的空档。
 */
async function runBatchConvert(targets: string[], format?: "docx" | "pdf"): Promise<void> {
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
    // 三态归类:取消是中性态——全取消不得显示成功勾/绿态;有失败才走失败,
    // 其余(含部分取消)按成功处理。状态行 tone 与汇总条 kind 用同一判定。
    const allCanceled =
      result.failCount === 0 && result.okCount === 0 && result.canceledCount > 0;
    const summaryKind: "ok" | "fail" | "canceled" =
      result.failCount > 0 ? "fail" : allCanceled ? "canceled" : "ok";
    setStatus(title, false, result.failCount > 0);
    setStatusTone(summaryKind === "ok" ? "ok" : "");
    showSummary({
      kind: summaryKind,
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

/**
 * 合并转换:先逐文件预检(与单文件同一道防线),再合并为一份文档。
 * 成书向导的「付印」也走本函数 —— 它此前经 withPrecheck([]) 只借锁、并不发预检,
 * 合并路径实际是零预检的,现在由本函数内部统一收口。
 * @param opts 显式文件/格式/封面元数据;缺省用当前选中与当前格式。
 */
export function runMerge(
  opts?: { files?: string[]; format?: "docx" | "pdf"; metadata?: DocMetadata },
): Promise<void> {
  const files = opts?.files ?? state.selectedFiles;
  if (files.length < 2) return Promise.resolve();
  return precheckedCommand(files, () => runMergeConvert(files, opts), {
    kind: "merge", // 合并跨文件:未闭合围栏会吞掉后续所有文件,故直接阻断
    onBlocked: reportMergeBlocked,
  });
}

/**
 * 合并阻断的呈现:完全复用合并既有的失败路径(状态行 setError + 汇总条
 * showSummary fail),不新造模态 —— 阻断没有可决策的动作,弹一个带「继续转换」
 * 按钮的框反而是假的。
 * 两处各说一半、长文本只出现一次(用户实测 2026-09-27):状态行是一行字的语汇,
 * 只放短句(几个文件);完整长文本(哪个文件 / 第几行 / 后果 / 还有几个)进汇总卡。
 * 两处同长文本既冗余,又各自撑成多行、把 96px 固定槽里的对方挤出可视区(裁切根因,
 * 见 base.css .status--error 的 white-space:normal 与 .status 缺 flex:none)。
 * 标题用「未执行」而非既有的「合并失败」:这次转换根本没开始(预检段就被拦下),
 * 说「失败」会让人以为转换跑过。真正的失败(拿 result.error 那条)仍用旧标题。
 * 阻断发生在预检段(state.mode 尚未置位、进度条未起),故这里无需任何收尾:
 * 预检链的 finally 会释放命令锁,按钮随之恢复可用(不留「永久忙碌」)。
 */
function reportMergeBlocked(report: MergeBlockReport): void {
  const detail = formatWarning({
    key: "convert.merge.blockedUnclosedFence",
    params: { file: report.file, lineNo: report.lineNo ?? "?" },
    // 兜底文案只在「当前语言与 en 都缺该键」时露出,与 core 的 fallback 同角色
    fallback: `合并转换已阻止:${report.file} 第 ${report.lineNo ?? "?"} 行的代码围栏没有闭合 —— 合并后本文件剩余部分与后续所有文件都会变成一个代码块。请先修好该文件再合并。`,
  });
  const error =
    report.moreFiles > 0
      ? `${detail} ${t("convert.merge.blockedUnclosedFenceMore", { count: report.moreFiles })}`
      : detail;
  // 短句的 count = 带阻断告警的文件总数(含详报的那个);卡片里的「另有 N 个」是
  // 「除首个之外」的同一组事实,两个数不要混用
  setError(t("convert.merge.blockedStatus", { count: report.moreFiles + 1 }));
  showSummary({ kind: "fail", title: t("convert.merge.blockedTitle"), error });
}

/**
 * 合并转换的受控执行段:首个同步段即置 state.mode(理由同 runBatchConvert)。
 */
async function runMergeConvert(
  files: string[],
  opts?: { files?: string[]; format?: "docx" | "pdf"; metadata?: DocMetadata },
): Promise<void> {
  const format = opts?.format ?? state.selectedFormat;
  const metadata = opts?.metadata;
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

