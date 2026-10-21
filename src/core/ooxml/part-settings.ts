/**
 * 设置部件(word/settings.xml)解析:读默认制表位、兼容设置与主题语言标记。
 * 本轮不把这些值映射进设置模型(ADR-086 决定五:不接颜色、不接管模板编号;设置类字段的取舍归步 #02),
 * 但解析层照样读出来备用 —— 与主题配色同理,「读出来」与「用不用」分开,放弃一个字段就不必改解析器。
 * 不变量:
 * ① 缺部件/畸形 ⇒ 返回空结果,不抛。
 * ② 兼容设置只取能读的(w:compatSetting 的 name/uri/val),其余 w:compat 子项不猜。
 * ③ 数值保留 OOXML 原单位(缇),换算归消费方。
 * 互指:与主题部件同在本层,两者都不产设置值(值由步 #02 决定)。
 */
import { attrOf, childOf, childrenOf, numAttr, parseXml, toggleOf } from "./xml.js";

/** 一条兼容设置(w:compatSetting) */
export interface CompatSetting {
  name: string;
  uri?: string;
  value?: string;
}

/** 主题语言标记(w:themeFontLang) */
export interface ThemeFontLang {
  /** w:val(主语言) */
  value?: string;
  eastAsia?: string;
  bidi?: string;
}

/** 设置部件解析结果 */
export interface OoxmlSettings {
  /** 默认制表位(缇,w:defaultTabStop 的 val) */
  defaultTabStopTwips?: number;
  /** 缩放百分比(w:zoom 的 percent) */
  zoomPercent?: number;
  /** 是否奇偶页不同页眉页脚(w:evenAndOddHeaders) */
  evenAndOddHeaders: boolean;
  compatSettings: CompatSetting[];
  themeFontLang?: ThemeFontLang;
}

/**
 * 解析设置部件。
 * @param xml word/settings.xml 文本(缺部件时传 null/空串 ⇒ 空结果)
 * @returns 设置解析结果(部件缺失/畸形 ⇒ 空结果)
 */
export function parseSettings(xml: string | null | undefined): OoxmlSettings {
  const settings: OoxmlSettings = {
    evenAndOddHeaders: false,
    compatSettings: [],
  };
  const root = parseXml(xml);
  if (!root) return settings;
  const defaultTabStop = numAttr(childOf(root, "defaultTabStop"), "val");
  if (defaultTabStop !== undefined) settings.defaultTabStopTwips = defaultTabStop;
  const zoom = numAttr(childOf(root, "zoom"), "percent");
  if (zoom !== undefined) settings.zoomPercent = zoom;
  const evenAndOdd = childOf(root, "evenAndOddHeaders");
  if (evenAndOdd) {
    // 无 val ⇒ 元素本身即开关(OOXML 的 on/off 形态);有 val ⇒ 按 val 判
    const flag = toggleOf(evenAndOdd);
    settings.evenAndOddHeaders = flag === undefined ? true : flag;
  }
  const compat = childOf(root, "compat");
  for (const el of childrenOf(compat, "compatSetting")) {
    const name = attrOf(el, "name");
    if (name === undefined || name === "") continue;
    const setting: CompatSetting = { name };
    const uri = attrOf(el, "uri");
    const value = attrOf(el, "val");
    if (uri !== undefined) setting.uri = uri;
    if (value !== undefined) setting.value = value;
    settings.compatSettings.push(setting);
  }
  const themeFontLangEl = childOf(root, "themeFontLang");
  if (themeFontLangEl) {
    const lang: ThemeFontLang = {};
    const value = attrOf(themeFontLangEl, "val");
    const eastAsia = attrOf(themeFontLangEl, "eastAsia");
    const bidi = attrOf(themeFontLangEl, "bidi");
    if (value !== undefined) lang.value = value;
    if (eastAsia !== undefined) lang.eastAsia = eastAsia;
    if (bidi !== undefined) lang.bidi = bidi;
    settings.themeFontLang = lang;
  }
  return settings;
}
