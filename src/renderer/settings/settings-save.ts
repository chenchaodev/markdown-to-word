/**
 * 设置保存流水线(写路径单源 + **跨模块共享的失败重试台账**)。
 *
 * 为什么从 settings-panel.ts 拆出:「设置写回」是一条**流水线**,不是「设置面板」的
 * 职责 —— 成书向导(`wizard/`)也要实时写盘并共享同一套失败重试语义。此前向导只能
 * `import { persistSettings } from "../settings/settings-panel.js"`,把一个模态向导的
 * 写路径挂在「设置抽屉的 DOM + 持久化模块」上;而 persistSettings 本身内联回填 22 个
 * 控件、读 `statusEl.textContent`,确实不是一个可搬走的纯函数。
 *
 * 拆法(保持行为等价,不牺牲任何语义):
 * 1. **台账上移**:保存修订号、待重试草稿、失败文案原文三份模块级状态搬到这里。
 *    它们是**跨模块共享**的 —— 抽屉写的字段与向导写的字段必须落在同一份草稿上,
 *    否则「失败过的字段随下一次保存一并重试」会在跨模块写入时丢字段。
 * 2. **DOM 反馈以 hooks 注入**:面板在模块初始化时 `registerSettingsSaveHooks` 交出
 *    自己的三个 DOM 触点(回填控件 / 落 main 权威值 / 刷抽屉副标题)与两个状态区触点。
 *    向导调 `persistSettings` 时**不再 import 面板**,但因为台账与 hooks 都是共享的,
 *    它写盘后的抽屉回填、状态区提示、失败重试行为与从前逐字一致。
 * 3. **零 hooks 时降级**:若面板尚未加载(理论上不会 —— 设置抽屉随应用启动),写盘照常
 *    执行,只是跳过 UI 反馈。刻意不抛错:保存是 essential 行为,不该因 UI 未就位而丢。
 *
 * DOM-free 部分(`mergePendingSavePatch` / `normalizePageSetup` / `reconcileSettingsSave`)
 * 仍在 settings-logic.ts,本模块只做编排。
 */
import { t } from "../../core/i18n/index.js";
import type { AppSettings } from "../../core/settings/settings-defaults.js";
import { state, type SettingsSaveHooks } from "../state/state.js";
import { mergePendingSavePatch, normalizePageSetup, reconcileSettingsSave } from "./settings-logic.js";

/** 设置抽屉交给本流水线的 DOM 触点(由 settings-panel 注册;缺失即零触点)。
 *  类型声明在 state/(store 持这个槽,槽的类型与槽同处)。 */
function hooks(): SettingsSaveHooks {
  return state.settingsSave.hooks ?? NOOP_HOOKS;
}

const NOOP_HOOKS: SettingsSaveHooks = {
  applyControls: () => {},
  applyAuthoritative: () => {},
  setError: () => {},
  isStatusMine: () => false,
  clearStatus: () => {},
  refreshDrawerMeta: () => {},
};

/** 由设置面板在模块初始化时调用,交出它的 DOM 触点(见文件头「拆法」第 2 条)。 */
export function registerSettingsSaveHooks(next: SettingsSaveHooks): void {
  state.settingsSave.hooks = next;
}

/* ---------- 跨模块共享的失败重试台账(ADR-065 §决定 ③:已收敛进 store) ----------
 * 四处原先是本文件的模块级可变状态(`hooks` / 修订号 / 待重试草稿 / 失败原文),
 * 现按 ADR-065 §决定 ③ 整组搬进 `state.settingsSave`。**整组搬**而非拆三家:
 * 抽屉与向导写同一份草稿,而「失败要不要落可见提示」的判定就落在修订号与失败
 * 原文上 —— 台账与反馈触点拆成两处,会让两者各说各话。 */

/** 保存失败反馈:状态区可见提示 + 留痕;编辑内容与控件值一律保留(草稿),
 *  提示持续显示直到下一次成功保存 —— 期间它就是「未保存」状态的唯一可见标记。 */
function reportSettingsSaveFailure(error: unknown): void {
  console.error("[settings] 设置写盘失败(保留当前编辑内容,待下次保存重试)", error);
  state.settingsSave.failureText = t("preset.saveFailed");
  hooks().setError(state.settingsSave.failureText);
}

/** 成功保存后复位未保存提示:仅当状态区仍是本模块写入的失败原文才清空,
 *  避免抹掉转换/复制等其他流程刚写入的状态文案。 */
function clearSettingsSaveFailure(): void {
  const written = state.settingsSave.failureText;
  if (!written) return;
  const writtenByUs = hooks().isStatusMine(written);
  state.settingsSave.failureText = null;
  if (writtenByUs) hooks().clearStatus();
}

/**
 * 写回设置(面板与向导共用的唯一写路径)。
 *
 * 语义要点:① 页面设置先规范化,被纠正时回填控件并给出可见错误;② 失败过的字段
 * 留在草稿里,随**下一次**保存一并提交,故失败期间编辑的内容不丢;③ 成功才清草稿
 * 并刷新预览窗口(预览刷新失败不伪装成设置保存失败)。
 *
 * @param patch 要写入的设置片段
 */
export function persistSettings(patch: Partial<AppSettings>): void {
  let nextPatch = patch;
  if (Object.prototype.hasOwnProperty.call(patch, "pageSetup")) {
    const candidate = { ...state.settings.pageSetup, ...(patch.pageSetup ?? {}) };
    const normalized = normalizePageSetup(candidate, state.settings.pageSetup);
    if (normalized.corrected) {
      state.settings.pageSetup = normalized.pageSetup;
      if (normalized.error) hooks().setError(normalized.error);
      hooks().applyControls();
      nextPatch = { ...patch, pageSetup: normalized.pageSetup };
    }
  }
  hooks().refreshDrawerMeta();
  state.settingsSave.revision += 1;
  const revision = state.settingsSave.revision;
  // 待重试草稿 + 本次编辑:失败过的字段必须随下一次保存落盘,否则只活在内存里
  const attempt = mergePendingSavePatch(state.settingsSave.pendingPatch, nextPatch);
  void reconcileSettingsSave({
    save: () => window.api.settingsSet(attempt),
    isCurrent: () => revision === state.settingsSave.revision,
    apply: hooks().applyAuthoritative,
    onFailure: (error) => {
      state.settingsSave.pendingPatch = attempt;
      reportSettingsSaveFailure(error);
    },
  }).then((outcome) => {
    if (outcome === "saved") {
      state.settingsSave.pendingPatch = {};
      clearSettingsSaveFailure();
    }
    if (outcome !== "failed") {
      void window.api.previewRefresh().catch(() => undefined);
    }
  }).catch((error: unknown) => {
    // 回填/清理环节异常(如控件回填抛错):按未提交处理 —— 草稿保留并给出可见
    // 反馈,下次保存仍会带上它重试;不静默吞错。
    state.settingsSave.pendingPatch = attempt;
    reportSettingsSaveFailure(error);
  });
}
