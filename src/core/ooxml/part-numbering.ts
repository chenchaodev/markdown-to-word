/**
 * 编号部件(word/numbering.xml)解析:读 w:abstractNum 的各级定义与 w:num 到抽象编号的引用。
 * 为什么读它:自家导出的稿子带自生成 numbering,回读(步 #03)要能还原「有序/无序 + 层级」——
 * 没有这份结构,列表在回读后会散成一堆普通段落。
 * 不变量:
 * ① 级别按 w:ilvl 索引(不是数组下标:缺级的稿子很常见,下标假设会把第 2 级读成第 1 级)。
 * ② numId → abstractNumId 的引用经 w:num/w:abstractNumId 逐级解,不解 ⇒ 返回 null。
 * ③ w:lvlOverride 的 startOverride 与自带 w:lvl 覆盖抽象级别(覆盖层字段级生效)。
 * 互指:级别里的缩进形状用 src/core/ooxml/properties.ts 的 ParagraphIndent,不另立一份。
 */
import type { ParagraphIndent } from "./properties.js";
import { attrOf, childOf, childrenOf, numAttr, parseXml } from "./xml.js";

/** 一个级别(w:lvl) */
export interface NumberingLevel {
  /** 级别序号(w:ilvl) */
  ilvl: number;
  /** 编号格式(w:numFmt 的 val:decimal / bullet / lowerLetter …) */
  numFmt?: string;
  /** 级别文本(w:lvlText 的 val,如 "%1.") */
  lvlText?: string;
  /** 起始值(w:start 的 val) */
  start?: number;
  indent?: ParagraphIndent;
}

/** 一个抽象编号(w:abstractNum) */
export interface AbstractNumbering {
  abstractNumId: string;
  /** 级别表:键 = w:ilvl */
  levels: Map<number, NumberingLevel>;
}

/** w:lvlOverride 携带的覆盖内容 */
export interface NumberingOverride {
  /** w:startOverride 的 val */
  start?: number;
  /** 覆盖用的 w:lvl(若有) */
  level?: NumberingLevel;
}

/** 一个编号实例(w:num) */
export interface NumberingInstance {
  numId: string;
  abstractNumId: string;
  /** 覆盖表:键 = w:ilvl */
  overrides: Map<number, NumberingOverride>;
}

/** 编号表 */
export interface NumberingTable {
  abstracts: Map<string, AbstractNumbering>;
  nums: Map<string, NumberingInstance>;
}

/**
 * 读一个 w:lvl 元素。
 * @param el w:lvl 元素
 * @returns 级别定义
 */
function readLevel(el: ReturnType<typeof childOf>): NumberingLevel {
  const level: NumberingLevel = { ilvl: numAttr(el, "ilvl") ?? 0 };
  const numFmt = attrOf(childOf(el, "numFmt"), "val");
  if (numFmt !== undefined) level.numFmt = numFmt;
  const lvlText = attrOf(childOf(el, "lvlText"), "val");
  if (lvlText !== undefined) level.lvlText = lvlText;
  const start = numAttr(childOf(el, "start"), "val");
  if (start !== undefined) level.start = start;
  const indEl = childOf(childOf(el, "pPr"), "ind");
  if (indEl) {
    const indent: ParagraphIndent = {};
    const left = numAttr(indEl, "left");
    const right = numAttr(indEl, "right");
    const firstLine = numAttr(indEl, "firstLine");
    const hanging = numAttr(indEl, "hanging");
    const firstLineChars = numAttr(indEl, "firstLineChars");
    if (left !== undefined) indent.left = left;
    if (right !== undefined) indent.right = right;
    if (firstLine !== undefined) indent.firstLine = firstLine;
    if (hanging !== undefined) indent.hanging = hanging;
    if (firstLineChars !== undefined) indent.firstLineChars = firstLineChars;
    if (Object.keys(indent).length > 0) level.indent = indent;
  }
  return level;
}

/**
 * 解析编号部件。
 * @param xml word/numbering.xml 文本(缺部件时传 null/空串 ⇒ 空表)
 * @returns 编号表(部件缺失/畸形 ⇒ 空表)
 */
export function parseNumbering(xml: string | null | undefined): NumberingTable {
  const table: NumberingTable = { abstracts: new Map(), nums: new Map() };
  const root = parseXml(xml);
  if (!root) return table;
  for (const el of childrenOf(root, "abstractNum")) {
    const abstractNumId = attrOf(el, "abstractNumId");
    if (abstractNumId === undefined || abstractNumId === "") continue;
    const levels = new Map<number, NumberingLevel>();
    for (const lvlEl of childrenOf(el, "lvl")) {
      const level = readLevel(lvlEl);
      levels.set(level.ilvl, level);
    }
    table.abstracts.set(abstractNumId, { abstractNumId, levels });
  }
  for (const el of childrenOf(root, "num")) {
    const numId = attrOf(el, "numId");
    const abstractNumId = attrOf(childOf(el, "abstractNumId"), "val");
    if (numId === undefined || numId === "") continue;
    const overrides = new Map<number, NumberingOverride>();
    for (const ovEl of childrenOf(el, "lvlOverride")) {
      const ilvl = numAttr(ovEl, "ilvl") ?? 0;
      const override: NumberingOverride = {};
      const startOverride = numAttr(childOf(ovEl, "startOverride"), "val");
      if (startOverride !== undefined) override.start = startOverride;
      const ownLevel = childOf(ovEl, "lvl");
      if (ownLevel) override.level = readLevel(ownLevel);
      overrides.set(ilvl, override);
    }
    table.nums.set(numId, {
      numId,
      abstractNumId: abstractNumId ?? "",
      overrides,
    });
  }
  return table;
}

/**
 * 按 numId + 级别取该级的编号定义(含 lvlOverride 覆盖)。
 * @param table 编号表
 * @param numId 编号实例 id
 * @param ilvl 级别序号
 * @returns 级别定义;引用链断掉或该级不存在 ⇒ null
 */
export function resolveNumberingLevel(table: NumberingTable, numId: string, ilvl: number): NumberingLevel | null {
  const instance = table.nums.get(numId);
  if (!instance) return null;
  const abstract = table.abstracts.get(instance.abstractNumId);
  if (!abstract) return null;
  const level = abstract.levels.get(ilvl);
  if (!level) return null;
  const override = instance.overrides.get(ilvl);
  if (!override) return { ...level };
  const merged: NumberingLevel = { ...level };
  if (override.start !== undefined) merged.start = override.start;
  if (override.level) {
    const own = override.level;
    if (own.numFmt !== undefined) merged.numFmt = own.numFmt;
    if (own.lvlText !== undefined) merged.lvlText = own.lvlText;
    if (own.start !== undefined) merged.start = own.start;
    if (own.indent) merged.indent = { ...(merged.indent ?? {}), ...own.indent };
  }
  return merged;
}
