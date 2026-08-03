/**
 * 应用设置持久化:userData/settings.json(手写实现,不引 electron-store)。
 * 模块级内存缓存 + 惰性加载:首次 loadSettings 读盘,之后读缓存;
 * 因此 app.getPath("userData") 天然只在 app.whenReady 之后才被调用。
 * 文件损坏(JSON parse 失败或形状非法)→ 返回默认值,不写盘。
 */
import { app } from "electron";
import { readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageSetup } from "../core/convert.js";
import { DEFAULT_PAGE_SETUP } from "../core/convert.js";

export interface AppSettings {
  version: 1;
  format: "docx" | "pdf";
  pageSetup: PageSetup;
  /** H1 前分页(默认关) */
  breakBeforeH1: boolean;
  /** 导出后行为(默认不自动执行) */
  afterConvert: "none" | "show-in-folder" | "open";
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  format: "docx",
  pageSetup: { ...DEFAULT_PAGE_SETUP },
  breakBeforeH1: false,
  afterConvert: "none",
};

const SETTINGS_FILE_NAME = "settings.json";
const FORMATS = ["docx", "pdf"] as const;
const AFTER_CONVERT_ACTIONS = ["none", "show-in-folder", "open"] as const;
const PAPERS = ["A4", "A3", "A5", "Letter", "Legal"] as const;
const ORIENTATIONS = ["portrait", "landscape"] as const;
const MARGIN_MIN_MM = 0;
const MARGIN_MAX_MM = 1000;
const SETTING_KEYS = ["version", "format", "pageSetup", "breakBeforeH1", "afterConvert"] as const;

/** 模块级内存缓存:惰性加载(首次 loadSettings 读盘,之后读缓存) */
let settingsCache: AppSettings | null = null;

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 整文件形状校验:任一字段非法即视为损坏,整体回退默认 */
function isValidSettings(value: unknown): value is AppSettings {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (s.version !== 1) return false;
  if (!isOneOf(s.format, FORMATS)) return false;
  if (!isOneOf(s.afterConvert, AFTER_CONVERT_ACTIONS)) return false;
  if (typeof s.breakBeforeH1 !== "boolean") return false;
  const ps = s.pageSetup as Record<string, unknown> | undefined;
  if (typeof ps !== "object" || ps === null) return false;
  if (!isOneOf(ps.paper, PAPERS)) return false;
  if (!isOneOf(ps.orientation, ORIENTATIONS)) return false;
  if (
    !isFiniteNumber(ps.marginTop) ||
    !isFiniteNumber(ps.marginBottom) ||
    !isFiniteNumber(ps.marginLeft) ||
    !isFiniteNumber(ps.marginRight)
  ) {
    return false;
  }
  return true;
}

export function loadSettings(): AppSettings {
  if (settingsCache) return settingsCache;
  let loaded: AppSettings = DEFAULT_SETTINGS;
  try {
    const raw = readFileSync(settingsFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isValidSettings(parsed)) loaded = parsed;
  } catch {
    // 缺文件 / 读取失败 / parse 失败 → 默认值(不写盘)
  }
  settingsCache = loaded;
  return loaded;
}

/** 原子写:临时文件 + rename(Windows 下 rename 可覆盖已存在文件) */
export async function saveSettings(next: AppSettings): Promise<void> {
  const filePath = settingsFilePath();
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
  settingsCache = next;
}

/** 合并 + 持久化 + 返回;patch 按 DEFAULT_SETTINGS 键白名单校验,非法值回退默认 */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next: AppSettings = { ...loadSettings(), ...sanitizePatch(patch) };
  await saveSettings(next);
  return next;
}

function sanitizePatch(patch: unknown): Partial<AppSettings> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return {};
  const src = patch as Record<string, unknown>;
  const out: Partial<AppSettings> = {};
  for (const key of SETTING_KEYS) {
    if (!(key in src)) continue;
    switch (key) {
      case "version":
        out.version = src.version === 1 ? 1 : DEFAULT_SETTINGS.version;
        break;
      case "format":
        out.format = isOneOf(src.format, FORMATS) ? src.format : DEFAULT_SETTINGS.format;
        break;
      case "afterConvert":
        out.afterConvert = isOneOf(src.afterConvert, AFTER_CONVERT_ACTIONS)
          ? src.afterConvert
          : DEFAULT_SETTINGS.afterConvert;
        break;
      case "breakBeforeH1":
        out.breakBeforeH1 =
          typeof src.breakBeforeH1 === "boolean" ? src.breakBeforeH1 : DEFAULT_SETTINGS.breakBeforeH1;
        break;
      case "pageSetup": {
        const pageSetup = sanitizePageSetup(src.pageSetup);
        if (pageSetup) out.pageSetup = pageSetup;
        break;
      }
    }
  }
  return out;
}

/** pageSetup 逐字段校验:paper/orientation 枚举,数值钳制 0-1000mm,非法字段回退默认 */
function sanitizePageSetup(value: unknown): PageSetup | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const ps = value as Record<string, unknown>;
  const out: PageSetup = { ...DEFAULT_PAGE_SETUP };
  if (isOneOf(ps.paper, PAPERS)) out.paper = ps.paper;
  if (isOneOf(ps.orientation, ORIENTATIONS)) out.orientation = ps.orientation;
  const clamp = (v: unknown, fallback: number): number =>
    isFiniteNumber(v) ? Math.min(MARGIN_MAX_MM, Math.max(MARGIN_MIN_MM, v)) : fallback;
  out.marginTop = clamp(ps.marginTop, DEFAULT_PAGE_SETUP.marginTop);
  out.marginBottom = clamp(ps.marginBottom, DEFAULT_PAGE_SETUP.marginBottom);
  out.marginLeft = clamp(ps.marginLeft, DEFAULT_PAGE_SETUP.marginLeft);
  out.marginRight = clamp(ps.marginRight, DEFAULT_PAGE_SETUP.marginRight);
  return out;
}
