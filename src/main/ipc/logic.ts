/**
 * 主进程 IPC 纯逻辑层:自 register.ts IPC handler 抽出的无 Electron 依赖纯函数
 * (解析/合并/校验/路径处理/数据变换),供直测。
 * 约定:只放不依赖 electron API 的纯逻辑;对话框/文件 IO/窗口/持久化留在 register.ts 薄壳。
 */
import path from "node:path";
import type { ConvertFormat } from "../../core/settings/settings-defaults.js";
import type { CustomPreset } from "../../core/settings/settings-defaults.js";
import type { OperationBusyResult, PrecheckResult, RecentFile } from "../../core/ipc-contract.js";
import type { ConvertWarning, KeyedWarning } from "../../core/i18n.js";
import { mergePresets, parsePresetsFile } from "../persist/settings.js";
import type { ConvertContext } from "../converter/index.js";
import { stripMarkdownExt } from "../converter/paths.js";

/** 错误归一:Error → message,其余 → String(err)(与 index.ts 原内联一致)。 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 版本比较:返回 -1/0/1 表示 a<b / a=b / a>b(仅 major.minor.patch,忽略 prerelease;
 * 段缺失按 0 补齐,非数字段按 0 计)。关于页更新提示与注册表版本比较共用。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/* ---------- convert 系 handler 共用样板(自 register.ts runWithCtx 抽出,行为等价):
 * context 注册/释放 + 错误归一化集中一处。Electron 触点(event.sender/BrowserWindow/
 * ConvertCanceledError 实例判定)经 deps 注入,本模块保持零 electron 运行时依赖可直测。
 * 取消语义(历史 bug 领域)不再分散在三个 handler:
 * - ctx 每次调用新建(「取消后复位」语义),由 registerCtx 按调用方键注册(多窗口隔离)
 * - registerCtx 失败表示同 key 已有活动操作 → onBusy(),不执行 task
 * - finally compare-and-delete 注销本 token(含异常/取消路径,避免悬挂或删掉后继任务)
 * - 取消错误 → onCanceled()(调用方给出取消结果形态);其他错误归一 { ok:false, error } ---------- */

/** runConvertTask 的环境依赖(由 register.ts 注入真实实现,测试注入 mock)。 */
export interface ConvertTaskDeps {
  /** 新建转换 context(每次调用新建,取消标志不复用)。 */
  createContext: () => ConvertContext;
  /** 按 key 原子注册 context;返回 false 表示已有活动操作。 */
  registerCtx: (ctx: ConvertContext) => boolean;
  /** compare-and-delete 注销本任务 token(finally 路径)。 */
  unregisterCtx: () => void;
  /** 取消错误判定(register.ts:err instanceof ConvertCanceledError)。 */
  isCanceledError: (err: unknown) => boolean;
}

export interface BusyResult {
  ok: false;
  busy: true;
  error: string;
}

/**
 * busy 结果单一构造点(形状单源):四个 convert 系 handler 的 onBusy 全走此处,
 * 保证 busy 恒为 { ok:false, busy:true, error } 三键(多/少键都属契约漂移,
 * renderer 依 busy===true 分流)。批量在其上并接计数字段(旧 renderer 兼容)。
 */
export function operationBusyResult(error: string): OperationBusyResult {
  return { ok: false, busy: true, error };
}

/**
 * 活动操作冲突判定(判定依据 busy===true,与 renderer 侧 convert-flow 的同名判定
 * 一致;契约形状单源在 core/ipc-contract.OperationBusyResult,两侧各自持有一份
 * 纯判定,不跨进程共享代码)。
 */
export function isOperationBusyResult(outcome: unknown): outcome is BusyResult {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    "busy" in outcome &&
    (outcome as BusyResult).busy === true
  );
}

/* ---------- 预检结果归一(异常不留空白) ----------
 * 预检通道的返回契约是 PrecheckResult(警告数组 | 活动操作冲突),由 core/ipc-contract
 * 单源定义;预检自身抛错(文件缺失/解码失败/读取异常)此前被折叠成空数组,用户与
 * 日志都看不到失败发生过。此处不扩契约(新增联合分支须改 core 契约文件,两侧
 * 同批回退),改以一条可观察的失败警告承载:renderer 走既有警告列表展示,
 * 用户可继续转换或取消;缺字典条目时回退 fallback 原文。 */

/** 预检失败警告(携带失败原因;renderer 按警告展示,不阻断主流程)。 */
export function precheckFailedWarning(error: string): KeyedWarning {
  return {
    key: "warn.precheckFailed",
    params: { error },
    fallback: `预检失败,已跳过预检:${error}`,
  };
}

/** runConvertTask 在预检通道的三种出口(警告数组 / busy / 归一错误)。 */
export type PrecheckOutcome = ConvertWarning[] | BusyResult | { ok: false; error: string };

/** 预检失败出口判定(非数组且非 busy 即为异常归一结果)。 */
export function isPrecheckFailureOutcome(
  outcome: PrecheckOutcome,
): outcome is { ok: false; error: string } {
  return !Array.isArray(outcome) && !isOperationBusyResult(outcome);
}

/**
 * 预检结果归一(纯函数,可直测):
 * - 警告数组 → 原样返回(成功语义不变)
 * - 活动操作冲突 → 经 operationBusyResult 重建,形状稳定(renderer 走既有 busy 通道)
 * - 异常归一 { ok:false, error } → 单条失败警告(可见且兼容 PrecheckResult)
 * 取消出口(空数组)与既有语义一致,不在此改写。
 */
export function normalizePrecheckOutcome(outcome: PrecheckOutcome): PrecheckResult {
  if (Array.isArray(outcome)) return [...outcome];
  if (isOperationBusyResult(outcome)) return operationBusyResult(outcome.error);
  return [precheckFailedWarning(outcome.error)];
}

export async function runConvertTask<T>(
  deps: ConvertTaskDeps,
  task: (ctx: ConvertContext) => Promise<T>,
  onCanceled: () => T | { ok: false; error: string },
  onBusy: () => T | BusyResult,
): Promise<T | BusyResult | { ok: false; error: string }> {
  const ctx = deps.createContext();
  if (!deps.registerCtx(ctx)) return onBusy();
  try {
    return await task(ctx);
  } catch (err) {
    if (deps.isCanceledError(err)) return onCanceled();
    return { ok: false, error: errorMessage(err) };
  } finally {
    deps.unregisterCtx();
  }
}

/* ---------- IPC 入参类型守卫:renderer 传参异常时快速失败,
    不让脏值流入业务层(此前 convert/shell/preview 无校验,format 非法静默落 pdf 分支)。 ---------- */

export function isString(v: unknown): v is string {
  return typeof v === "string";
}

/** 字符串数组严格校验(元素逐一检查;拒绝含非字符串元素的数组,不做静默过滤——
 *  元素缺失会让用户看到「少转了文件」却无解释,宁可显式失败)。 */
export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function isConvertFormat(v: unknown): v is ConvertFormat {
  return v === "docx" || v === "pdf";
}

/** 最近文件条目构建(recordRecentFiles 的数据变换):过滤非字符串/空串,name 取 basename。 */
export function buildRecentFileEntries(
  filePaths: string[],
  format: ConvertFormat,
  ts: number,
): RecentFile[] {
  return filePaths
    .filter((p) => typeof p === "string" && p !== "")
    .map((p) => ({ path: p, name: path.basename(p), format, ts }));
}

/** 预览标题/基础名:去 .md/.markdown 扩展(大小写不敏感),其余原样;扩展名判定单源 converter/paths.ts(stripMarkdownExt)。 */
export function baseNameFromMdPath(mdPath: string): string {
  return stripMarkdownExt(path.basename(mdPath));
}

/** 预设导入纯逻辑结果:解析失败 → 原错误文案;成功 → 合并结果(含 presets 供持久化)。 */
export type ImportPresetsMergeResult =
  | { ok: false; error: string }
  | { ok: true; presets: CustomPreset[]; imported: number; overridden: number };

/** 预设导入纯逻辑(解析+合并+整形;对话框/读文件/持久化在 register.ts)。 */
export function importPresetsFromText(
  text: string,
  existing: readonly CustomPreset[],
): ImportPresetsMergeResult {
  const parsed = parsePresetsFile(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const merged = mergePresets(existing, parsed.presets);
  return { ok: true, presets: merged.presets, imported: merged.imported, overridden: merged.overridden };
}

/** 预设导出载荷序列化:schemaVersion:1 包装 + 2 空格缩进 + 末尾换行。 */
export function buildPresetsExportPayload(presets: readonly CustomPreset[]): string {
  return `${JSON.stringify({ schemaVersion: 1, presets }, null, 2)}\n`;
}
