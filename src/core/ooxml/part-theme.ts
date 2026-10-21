/**
 * 主题部件(word/theme/theme1.xml)解析:读字体方案(major/minor 的 latin/ea/cs 与按语种脚本字体)与配色槽。
 * 本轮配色不进设置模型(ADR-086 决定五),但解析层照样读出来备用:步 #02 决定丢弃还是保留时
 * 不必再动解析层 —— 「读出来」与「用不用」是两件事,合成一处就会让放弃一个字段变成改解析器。
 * 不变量:
 * ① 缺部件/畸形 ⇒ 返回空结果,不抛(降级口径:读不到就保留用户原值)。
 * ② 颜色值记原始十六进制串(不带 #);sysClr 取 lastClr(缺则取 val)。
 * ③ 元素按本地名匹配(a:latin / a:ea / a:cs / a:font …),前缀不写死。
 * 互指:主题里的字体名是「主题引用」的落地处,样式部件里的 asciiTheme/eastAsiaTheme 由消费方
 * (步 #02)拿本文件的结果去解;本文件不认样式部件,也不反向解析它。
 */
import { attrOf, childOf, childrenOf, parseXml } from "./xml.js";

/** 一组主题字体(latin/ea/cs + 按语种脚本的补充字体) */
export interface ThemeFontSet {
  latin?: string;
  ea?: string;
  cs?: string;
  /** 按 script 记的补充字体(如 Hans → 等线);无则缺省 */
  scripts?: Record<string, string>;
}

/** 配色槽(十六进制串,不带 #) */
export interface ThemeColorSlots {
  dk1?: string;
  lt1?: string;
  dk2?: string;
  lt2?: string;
  accent1?: string;
  accent2?: string;
  accent3?: string;
  accent4?: string;
  accent5?: string;
  accent6?: string;
  hlink?: string;
  folHlink?: string;
}

/** 主题解析结果 */
export interface ThemeInfo {
  major: ThemeFontSet;
  minor: ThemeFontSet;
  colors: ThemeColorSlots;
}

/** 配色槽的固定次序(读时按名取,不依赖属性顺序) */
const COLOR_SLOTS = [
  "dk1",
  "lt1",
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
] as const;

/**
 * 读一组主题字体(majorFont / minorFont)。
 * @param el 该字体组元素(可空)
 * @returns 字体组(缺则空)
 */
function readFontSet(el: ReturnType<typeof childOf>): ThemeFontSet {
  const out: ThemeFontSet = {};
  if (!el) return out;
  const latin = attrOf(childOf(el, "latin"), "typeface");
  const ea = attrOf(childOf(el, "ea"), "typeface");
  const cs = attrOf(childOf(el, "cs"), "typeface");
  if (latin !== undefined && latin !== "") out.latin = latin;
  if (ea !== undefined && ea !== "") out.ea = ea;
  if (cs !== undefined && cs !== "") out.cs = cs;
  /** @type {Record<string, string>} */
  const scripts: Record<string, string> = {};
  for (const font of childrenOf(el, "font")) {
    const script = attrOf(font, "script");
    const typeface = attrOf(font, "typeface");
    if (script === undefined || typeface === undefined || typeface === "") continue;
    scripts[script] = typeface;
  }
  if (Object.keys(scripts).length > 0) out.scripts = scripts;
  return out;
}

/**
 * 读一个配色槽的值(srgbClr 取 val;sysClr 取 lastClr,缺则取 val)。
 * @param slotEl 槽元素(可空)
 * @returns 颜色值或 undefined
 */
function readSlot(slotEl: ReturnType<typeof childOf>): string | undefined {
  if (!slotEl) return undefined;
  const srgb = childOf(slotEl, "srgbClr");
  if (srgb) {
    const value = attrOf(srgb, "val");
    return value === undefined ? undefined : value;
  }
  const sys = childOf(slotEl, "sysClr");
  if (sys) {
    const last = attrOf(sys, "lastClr");
    if (last !== undefined) return last;
    return attrOf(sys, "val");
  }
  return undefined;
}

/**
 * 解析主题部件。
 * @param xml word/theme/theme1.xml 文本(缺部件时传 null/空串 ⇒ 空结果)
 * @returns 主题(缺部件/畸形 ⇒ 空结果)
 */
export function parseTheme(xml: string | null | undefined): ThemeInfo {
  const theme: ThemeInfo = { major: {}, minor: {}, colors: {} };
  const root = parseXml(xml);
  if (!root) return theme;
  const elements = childOf(root, "themeElements");
  if (!elements) return theme;
  const fontScheme = childOf(elements, "fontScheme");
  if (fontScheme) {
    theme.major = readFontSet(childOf(fontScheme, "majorFont"));
    theme.minor = readFontSet(childOf(fontScheme, "minorFont"));
  }
  const clrScheme = childOf(elements, "clrScheme");
  if (clrScheme) {
    for (const slot of COLOR_SLOTS) {
      const value = readSlot(childOf(clrScheme, slot));
      if (value !== undefined) theme.colors[slot] = value;
    }
  }
  return theme;
}
