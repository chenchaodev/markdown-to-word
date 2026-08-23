/**
 * 主进程 IPC 纯逻辑层(批次 15 R6):自 index.ts IPC handler 抽出的无 Electron 依赖
 * 纯函数(解析/合并/校验/路径处理/数据变换),供直测。
 * 约定:只放不依赖 electron API 的纯逻辑;对话框/文件 IO/窗口/持久化留在 index.ts 薄壳。
 */
import path from "node:path";
import type { ConvertFormat } from "../core/convert.js";
import type { CustomPreset } from "../core/settings-defaults.js";
import { mergePresets, parsePresetsFile } from "./settings.js";
import type { RecentFile } from "./ui-state.js";

/** 错误归一:Error → message,其余 → String(err)(与 index.ts 原内联一致)。 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ---------- IPC 入参类型守卫(B1 安全审计):renderer 传参异常时快速失败,
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

/** 预览标题/基础名:去 .md/.markdown 扩展(大小写不敏感),其余原样。 */
export function baseNameFromMdPath(mdPath: string): string {
  return path.basename(mdPath).replace(/\.(md|markdown)$/i, "");
}

/** 预设导入纯逻辑结果:解析失败 → 原错误文案;成功 → 合并结果(含 presets 供持久化)。 */
export type ImportPresetsMergeResult =
  | { ok: false; error: string }
  | { ok: true; presets: CustomPreset[]; imported: number; overridden: number };

/** 预设导入纯逻辑(批次 13 流程的解析+合并+整形;对话框/读文件/持久化在 index.ts)。 */
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