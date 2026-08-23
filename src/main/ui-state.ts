/**
 * UI 状态持久化:userData/ui-state.json(批次 11 迭代 1「状态记忆」)。
 * 与 settings.ts 同款原子写(tmp + rename)与写队列串行化,但校验宽松:
 * UI 状态损坏只丢弃对应字段回默认值,不抛错、不影响 settings.json 契约。
 * 取舍:UI 状态是辅助记忆(窗口位置/最近文件),损坏不应影响主配置;
 * settings 是核心契约,非法宁可整体回退默认(见 settings.ts 头注释)。
 * 形状(UiState):
 * - recentFiles: 最近成功转换的文件 {path,name,format,ts}[] ≤10,按 ts 降序,path 去重
 * - lastSessionFiles: 上次会话的文件列表(renderer 恢复时逐项校验存在性)
 * - lastOpenDir: 对话框记忆目录(目录存在才作为 defaultPath 使用)
 * - windowBounds: 窗口位置 {x,y,width,height} | null(恢复时钳制到显示器工作区)
 * - panelOpen: 设置面板 details 展开态 {page, typography}(批次 N:单一设置面板,
 *   默认折叠以突出主流程;typography 为兼容保留字段,renderer 写镜像同值)
 * - suppressCompleteDialog: 转换完成弹窗「不再提示」(默认 false = 提示;批次 11 迭代 2)
 * 读时逐字段校验类型,非法/缺失 → 该字段默认值(不复用 settings 的整文件回退);
 * saveUiState 以 patch 合并当前状态,recentFiles 为「追加合并」语义
 * (同 path 保留 ts 最大者 → 重复转换自然置顶);空数组 = 清空(替换语义,
 * renderer「清空最近」传 { recentFiles: [] })。
 * 纯函数 pickWindowBounds 单独导出,供窗口创建(index.ts)与测试复用。
 */
import { app } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createJsonWriter } from "./atomic-json.js";

export interface RecentFile {
  path: string;
  name: string;
  format: "docx" | "pdf";
  ts: number;
}

export interface PanelOpen {
  page: boolean;
  typography: boolean;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UiState {
  recentFiles: RecentFile[];
  lastSessionFiles: string[];
  lastOpenDir: string;
  windowBounds: WindowBounds | null;
  panelOpen: PanelOpen;
  /** 转换完成弹窗「不再提示」(true = 跳过弹窗,汇总条照常;默认 false = 提示)。 */
  suppressCompleteDialog: boolean;
}

export const DEFAULT_UI_STATE: UiState = {
  recentFiles: [],
  lastSessionFiles: [],
  lastOpenDir: "",
  windowBounds: null,
  // 批次 N:设置收敛为单一面板,默认折叠(已记忆的展开态仍优先恢复)
  panelOpen: { page: false, typography: false },
  suppressCompleteDialog: false,
};

/** 最近文件上限(与 renderer 的 recent-files.ts 展示截断一致)。 */
export const MAX_RECENT_FILES = 10;

/** 显示器工作区(与 Electron Display.workArea 同形状,便于无 Electron 直测)。 */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const UI_STATE_FILE_NAME = "ui-state.json";

/** 模块级内存缓存:惰性加载(首次 loadUiState 读盘,之后读缓存)。 */
let uiCache: UiState | null = null;

/** 原子写 + 写队列(共享工具,见 atomic-json.ts;独立队列,与 settings 互不串扰) */
const writeUiStateJson = createJsonWriter();

function uiStateFilePath(): string {
  return path.join(app.getPath("userData"), UI_STATE_FILE_NAME);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFormat(value: unknown): value is "docx" | "pdf" {
  return value === "docx" || value === "pdf";
}

/** 布尔字段:仅接受 boolean,非法/缺失 → fallback(宽松校验统一入口)。 */
function sanitizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/* ---------- 逐字段清洗(宽松:非法/缺失 → 该字段默认值) ---------- */

/** recentFiles:过滤非法条目 → 去重(同 path 保留 ts 最大)→ ts 降序 → 截断上限。 */
function sanitizeRecentFiles(value: unknown): RecentFile[] {
  if (!Array.isArray(value)) return [];
  const entries: RecentFile[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.path !== "string" || item.path === "") continue;
    if (typeof item.name !== "string" || item.name === "") continue;
    if (!isFormat(item.format)) continue;
    if (!isFiniteNumber(item.ts)) continue;
    entries.push({ path: item.path, name: item.name, format: item.format, ts: item.ts });
  }
  return dedupeRecentFiles(entries);
}

/** 去重(同 path 保留 ts 最大者)+ 按 ts 降序 + 截断 MAX_RECENT_FILES。 */
function dedupeRecentFiles(entries: RecentFile[]): RecentFile[] {
  const byPath = new Map<string, RecentFile>();
  for (const entry of entries) {
    const prev = byPath.get(entry.path);
    if (!prev || entry.ts > prev.ts) byPath.set(entry.path, entry);
  }
  return [...byPath.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_RECENT_FILES);
}

/** lastSessionFiles:仅保留非空字符串。 */
function sanitizeSessionFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "");
}

/** lastOpenDir:仅接受非空字符串,非法/缺失 → 空串(默认)。 */
function sanitizeOpenDir(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "";
}

/** windowBounds:四字段均须有限数且宽高 > 0;否则 → null。 */
function sanitizeWindowBounds(value: unknown): WindowBounds | null {
  if (typeof value !== "object" || value === null) return null;
  const b = value as Record<string, unknown>;
  if (
    !isFiniteNumber(b.x) ||
    !isFiniteNumber(b.y) ||
    !isFiniteNumber(b.width) ||
    !isFiniteNumber(b.height)
  ) {
    return null;
  }
  if (b.width <= 0 || b.height <= 0) return null;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

/** panelOpen:page/typography 逐字段布尔校验,非法/缺失 → 回落 DEFAULT_UI_STATE.panelOpen(缺省折叠=false)。 */
function sanitizePanelOpen(value: unknown): PanelOpen {
  const src =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    page: typeof src.page === "boolean" ? src.page : DEFAULT_UI_STATE.panelOpen.page,
    typography:
      typeof src.typography === "boolean" ? src.typography : DEFAULT_UI_STATE.panelOpen.typography,
  };
}

/** 整状态清洗:逐字段独立校验,任一字段非法只影响该字段(不复用 settings 整文件回退)。 */
function sanitizeUiState(value: unknown): UiState {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_UI_STATE, panelOpen: { ...DEFAULT_UI_STATE.panelOpen } };
  }
  const s = value as Record<string, unknown>;
  return {
    recentFiles: sanitizeRecentFiles(s.recentFiles),
    lastSessionFiles: sanitizeSessionFiles(s.lastSessionFiles),
    lastOpenDir: sanitizeOpenDir(s.lastOpenDir),
    windowBounds: sanitizeWindowBounds(s.windowBounds),
    panelOpen: sanitizePanelOpen(s.panelOpen),
    suppressCompleteDialog: sanitizeBool(s.suppressCompleteDialog, DEFAULT_UI_STATE.suppressCompleteDialog),
  };
}

/**
 * 读取 UI 状态:缺文件 / 读取失败 / parse 失败 / 字段非法 → 该字段回默认(不写盘)。
 * 模块级缓存:首次读盘,之后读缓存。
 */
export function loadUiState(): UiState {
  if (uiCache) return uiCache;
  let loaded: UiState = { ...DEFAULT_UI_STATE, panelOpen: { ...DEFAULT_UI_STATE.panelOpen } };
  try {
    const raw = readFileSync(uiStateFilePath(), "utf8");
    loaded = sanitizeUiState(JSON.parse(raw));
  } catch {
    // 缺文件 / 读取失败 / parse 失败 → 默认值(不写盘)
  }
  uiCache = loaded;
  return loaded;
}

/**
 * 原子写(tmp + rename)+ 写队列串行化(仿 settings.ts):
 * patch 与当前状态合并后整体落盘,recentFiles 为追加合并语义
 * (去重保留 ts 最大 → 重复转换置顶;上限 10);空数组 = 清空(替换语义)。
 * 写失败(如磁盘错误)向上抛出,由调用方决定是否静默。
 */
export async function saveUiState(patch: Partial<UiState>): Promise<UiState> {
  const current = loadUiState();
  const next: UiState = {
    ...current,
    recentFiles: current.recentFiles,
    lastSessionFiles: current.lastSessionFiles,
    lastOpenDir: current.lastOpenDir,
    windowBounds: current.windowBounds,
    panelOpen: { ...current.panelOpen },
  };
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    if (Array.isArray(patch.recentFiles)) {
      // 空数组 = 清空(替换语义,renderer「清空最近」传 { recentFiles: [] });
      // 非空 = 追加合并(转换成功后追加新条目,index.ts:280 调用不受影响)
      next.recentFiles =
        patch.recentFiles.length === 0
          ? []
          : dedupeRecentFiles([
              ...current.recentFiles,
              ...sanitizeRecentFiles(patch.recentFiles),
            ]);
    }
    if (Array.isArray(patch.lastSessionFiles)) {
      next.lastSessionFiles = sanitizeSessionFiles(patch.lastSessionFiles);
    }
    if (patch.lastOpenDir !== undefined) next.lastOpenDir = sanitizeOpenDir(patch.lastOpenDir);
    if (patch.windowBounds !== undefined) next.windowBounds = sanitizeWindowBounds(patch.windowBounds);
    if (patch.panelOpen !== undefined) next.panelOpen = sanitizePanelOpen(patch.panelOpen);
    if (patch.suppressCompleteDialog !== undefined) {
      next.suppressCompleteDialog = sanitizeBool(
        patch.suppressCompleteDialog,
        DEFAULT_UI_STATE.suppressCompleteDialog,
      );
    }
  }
  await writeUiStateJson(uiStateFilePath(), next, () => {
    uiCache = next;
  });
  return next;
}

/**
 * 窗口位置钳制:仅当 x/y 落在任一显示器工作区内时采用(全屏外/多屏摘除后丢弃);
 * 尺寸非法或 ≤0 同样丢弃。返回 null 表示用默认窗口尺寸。
 */
export function pickWindowBounds(
  bounds: WindowBounds | null,
  workAreas: WorkArea[],
): WindowBounds | null {
  if (!bounds) return null;
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const inside = workAreas.some(
    (area) =>
      bounds.x >= area.x &&
      bounds.x < area.x + area.width &&
      bounds.y >= area.y &&
      bounds.y < area.y + area.height,
  );
  return inside ? bounds : null;
}
