/**
 * docx 模板导入(字段级深导入):
 * 消费 src/core/ooxml/ 的部件解析层(部件解包 + 结构化),把 OOXML 的排版/页面字段
 * 逆映射进**现有**设置模型(typography / pageSetup),并把「吃不下」的字段类别报出来。
 *
 * 与浅导入 v1 的差别(ADR-086 决定 3/4):
 * - v1 自带 XML 正则读取(getStyleBlock / getRPr / attr / extractTypography / extractPageSetup),
 *   本文件**不再有任何 XML 读取原语** —— XML 一律经解析层取,本仓不留第二份 XML 读取逻辑。
 * - 正文取值走**继承链**(docDefaults → Normal → basedOn 逐层覆盖;父样式缺失要容忍),
 *   标题字号取**段落级 run** 的 w:sz,样式级只作兜底。
 * - 映射面从「字体/字号/纸张/边距」扩到「对齐/首行缩进/行距/标题字号档位/标题间距档位」。
 *
 * 不变量:
 * ① 纯函数:零 IO、零 Electron 依赖(读 .docx 文件在 main 侧做)。
 * ② 只映射进现有设置模型:**不新增任何设置键**,不动 schema / 预设 / TypographySettings 形状。
 * ③ 任一部件缺失或解析失败一律降级(返回已取到的部分),不抛错。
 * ④ 「未映射」= 本仓映射层吃不下(或判不出档位)的字段类别;元素是**稳定标识**不是文案,
 *    文案在 core/i18n(i18n 键末段与标识同名,见 renderer 侧的标签表)。
 * ⑤ 「未映射」分两种性质(ADR-086 实施约束四):恒不映射六类(本仓能力边界)恒在,
 *    事实性七类按本次模板的条件产出。标识的类型与常量单源在 template-fields.ts。
 * ⑥ **整包解不开**(非 zip / 损坏)是**失败态**,与「成功但什么都没吃下」是两件事 ——
 *    后者才是降级(不抛错),前者必须让界面显示失败而不是「已应用」。
 */
import {
  BODY_SIZE_MAX,
  BODY_SIZE_MIN,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  PAPER_SIZES_MM,
  type PageSetup,
} from "../settings/settings-defaults.js";
import {
  HEADING_SCALE_FACTORS,
  HEADING_SPACING_BASE_PT,
  HEADING_SPACING_MULTIPLIERS,
  type HeadingScale,
  type HeadingSpacingTier,
  type TypographySettings,
} from "../settings/typography.js";
import { openDocxPackage } from "../ooxml/parts.js";
import {
  defaultStyleId,
  parseStyles,
  resolveStyle,
  styleDisplayName,
  styleIds,
  styleOutlineLevel,
  type StyleTable,
} from "../ooxml/part-styles.js";
import { parseTheme, type ThemeInfo } from "../ooxml/part-theme.js";
import {
  paragraphsOf,
  parseDocument,
  type DocumentTree,
  type ParagraphItem,
} from "../ooxml/part-document.js";
import type { ParagraphIndent } from "../ooxml/properties.js";
// 未映射类别的类型与常量单源在零依赖模块(界面层也要取那份常量,不能经本文件拖进 jszip)
import {
  ALWAYS_UNMAPPED_TEMPLATE_FIELDS,
  type UnmappedTemplateField,
} from "./template-fields.js";

/* ---------- 结果形状 ---------- */

/** 提取结果:仅含模板中实际存在的字段(其余保持用户现有设置) */
export interface TemplateExtracted {
  typography: Partial<TypographySettings>;
  pageSetup: Partial<PageSetup>;
  /**
   * 没吃下的字段类别(稳定标识;文案在 i18n 层):**恒不映射六类 + 本次事实性项**。
   *
   * 六类是本仓能力边界(与本次模板无关),事实性项是本次导入的具体诊断 —— 界面把两者
   * 分开展示(六类走常量侧的那句固定说明,事实性项才经 IPC 上来)。
   */
  unmapped: UnmappedTemplateField[];
}

/**
 * 导入结果:**可判别的联合** —— 「解开了」与「解不开」是必须能分开的两件事。
 *
 * 为什么不用「空结果」表达失败:空结果 + 空未映射清单 = 「成功但什么都没吃下」,
 * 与「整包损坏」同形 ⇒ 界面会显示「已应用 Word 模板」而实际什么都没导入
 * (ADR-086 实施约束四:失败路径不得谎报成功)。
 */
export type TemplateImportResult =
  | ({ status: "ok" } & TemplateExtracted)
  | { status: "unreadable" };

/* ---------- 单位与阈值 ---------- */

/** 1 twip = 1/1440 inch;1 inch = 25.4mm */
const TWIPS_PER_MM = 1440 / 25.4;

/** 缇 → 磅(1pt = 20 twips,与 typography.ts 的 headingSpacingTwips 互逆) */
const TWIPS_PER_PT = 20;

/** 纸张匹配容差(mm):宽高差之和 ≤ 该值即认定(沿用浅导入 v1 的口径) */
const PAPER_MATCH_TOLERANCE_MM = 3;

/** 行距倍数:OOXML 的 w:line 以 1/240 行为单位(lineRule=auto) */
const LINE_UNITS_PER_LINE = 240;

/** 标题字号档位判定:与三档系数的平均比值误差上限 */
const HEADING_SCALE_MAX_ERROR = 0.2;

/** 标题字号档位判定:最优档与次优档的误差差下限(小于它判不出) */
const HEADING_SCALE_MIN_GAP = 0.02;

/** 标题间距档位判定:与三档基准的平均相对误差上限 */
const HEADING_SPACING_MAX_ERROR = 0.25;

/** 标题间距档位判定:最优档与次优档的相对误差差下限 */
const HEADING_SPACING_MIN_GAP = 0.05;

/** 三档枚举(与 typography.ts 的档位表同序;勿在此另立一份档位) */
const HEADING_TIERS = ["compact", "standard", "spacious"] as const;

/* ---------- 小工具 ---------- */

function twipsToMm(twips: number): number {
  return Math.round((twips / TWIPS_PER_MM) * 10) / 10;
}

function twipsToPt(twips: number): number {
  return twips / TWIPS_PER_PT;
}

/** 标题样式 id / 显示名形态(Word 的内建样式名恒为英文 "heading 1".."heading 6") */
const HEADING_STYLE_RE = /^heading\s*([1-6])$/i;

/** 「标题(Title)」样式形态:它常带 outlineLvl 0,但不是章节标题 */
const TITLE_STYLE_RE = /^title$/i;

/* ---------- 字体 ---------- */

/**
 * 解析一个字体名:主题引用优先,显式名兜底。
 *
 * OOXML 里 `w:asciiTheme` / `w:eastAsiaTheme` 这类引用压过同级的显式字体名
 * (properties.ts 的约定:两者并存留两处字段,「优先」要结合主题部件才能判)。
 * 引用解不出(主题部件缺失 / 该槽为空)时回落显式名,再取不到则不映射。
 *
 * @param explicit 显式字体名(w:ascii / w:eastAsia)
 * @param themeRef 主题引用(w:asciiTheme / w:eastAsiaTheme)
 * @param theme 主题部件解析结果
 * @param slot 主题字体槽(西文取 latin,中文取 ea)
 * @returns 字体名;取不到 ⇒ undefined
 */
function resolveFontName(
  explicit: string | undefined,
  themeRef: string | undefined,
  theme: ThemeInfo,
  slot: "latin" | "ea",
): string | undefined {
  if (themeRef !== undefined && themeRef !== "") {
    const lower = themeRef.toLowerCase();
    const set = lower.startsWith("major")
      ? theme.major
      : lower.startsWith("minor")
        ? theme.minor
        : undefined;
    const fromTheme = set?.[slot];
    if (fromTheme !== undefined && fromTheme !== "") return fromTheme;
  }
  return explicit !== undefined && explicit !== "" ? explicit : undefined;
}

/* ---------- 正文(继承链) ---------- */

/**
 * 取正文样式 id:优先 `Normal`(外部 Word 模板的常规形态),否则取该类型的默认样式
 * (w:default="1";部分模板把它叫 Standard / 正文)。
 *
 * 自家稿**没有** Normal 样式(正文字体与字号在 docDefaults),故两者都取不到时正文
 * 属性只落在 docDefaults 与段落级 —— 这两条路径都要正确(ADR-086 决定四)。
 *
 * @param table 样式表
 * @returns 正文样式 id;无 ⇒ undefined
 */
function bodyStyleId(table: StyleTable): string | undefined {
  if (table.styles.has("Normal")) return "Normal";
  return defaultStyleId(table, "paragraph");
}

/** 是否为首行缩进(字符单位 firstLineChars 或缇单位 firstLine) */
function hasFirstLineIndent(indent: ParagraphIndent): boolean {
  return (indent.firstLineChars ?? 0) > 0 || (indent.firstLine ?? 0) > 0;
}

/* ---------- 标题识别 ---------- */

/**
 * 取某样式对应的标题级别(1-6);不是标题样式 ⇒ undefined。
 *
 * 判据顺序:styleId / 显示名匹配 `heading N`(Word 与 LibreOffice 的内建写法)→
 * 兜底用大纲级别(w:outlineLvl 0..5)。「标题(Title)」样式被排除:它常带 outlineLvl 0,
 * 认成一级会把封面标题的字号算进标题档位。
 *
 * @param table 样式表
 * @param styleId 样式 id
 * @returns 标题级别;非标题 ⇒ undefined
 */
function headingLevelOfStyle(table: StyleTable, styleId: string): number | undefined {
  const byId = HEADING_STYLE_RE.exec(styleId);
  if (byId !== null) return Number(byId[1]);
  const name = styleDisplayName(table, styleId);
  if (name !== undefined) {
    const byName = HEADING_STYLE_RE.exec(name);
    if (byName !== null) return Number(byName[1]);
    if (TITLE_STYLE_RE.test(name)) return undefined;
  }
  const outline = styleOutlineLevel(table, styleId);
  if (outline !== undefined && outline >= 0 && outline <= 5) return outline + 1;
  return undefined;
}

/** 级别 → 标题样式 id(同级多个时取样式表里第一个) */
function buildHeadingStyleIndex(table: StyleTable): Map<number, string> {
  const out = new Map<number, string>();
  for (const id of styleIds(table)) {
    const level = headingLevelOfStyle(table, id);
    if (level === undefined) continue;
    if (!out.has(level)) out.set(level, id);
  }
  return out;
}

/** 取段落内首个带显式字号的游程(半点);没有 ⇒ undefined */
function firstRunSizeHalfPoints(items: readonly ParagraphItem[]): number | undefined {
  for (const item of items) {
    if (item.kind === "run") {
      const size = item.run.properties.sizeHalfPoints;
      if (size !== undefined) return size;
      continue;
    }
    if (item.kind === "hyperlink" || item.kind === "field" || item.kind === "revision") {
      const nested = firstRunSizeHalfPoints(item.items);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

/* ---------- 正文段落事实(众数) ---------- */

/** 正文候选段落的排版事实(某项为空 = 该段没写这项) */
interface BodyFacts {
  align?: string;
  line?: number;
  lineRule?: string;
  firstLineIndent?: boolean;
}

/** 一个事实签名及其计数 */
interface FactsEntry {
  facts: BodyFacts;
  count: number;
  /** 定义了几项(用于并列时的次级排序) */
  defined: number;
  /** 首次出现的文档序(并列时的末级排序) */
  firstIndex: number;
}

/** 事实签名的键(同样的键即同样的事实组合) */
function factsKey(facts: BodyFacts): string {
  const align = facts.align ?? "";
  const line = facts.line !== undefined ? `${facts.line}:${facts.lineRule ?? "auto"}` : "";
  const indent = facts.firstLineIndent !== undefined ? String(facts.firstLineIndent) : "";
  return `${align}|${line}|${indent}`;
}

/** 事实里定义了的项数 */
function definedCount(facts: BodyFacts): number {
  let count = 0;
  if (facts.align !== undefined) count += 1;
  if (facts.line !== undefined) count += 1;
  if (facts.firstLineIndent !== undefined) count += 1;
  return count;
}

/**
 * 选正文事实:取**出现次数最多**的签名(并列时取定义项更多的、再并列取文档序更靠前的)。
 *
 * 为什么用众数而不是「第一段」:模板正文里常混着封面标题、目录项、题注等非正文段落
 * (它们也带 w:jc / w:spacing),取第一段会把它们当正文。众数反映的是模板的实际用法。
 * 完全没写排版事实的段落不参与(它们没有发言权)。
 *
 * @param entries 候选签名(按首次出现顺序)
 * @returns 胜出的事实;无候选 ⇒ undefined
 */
function pickDominantFacts(entries: readonly FactsEntry[]): BodyFacts | undefined {
  let best: FactsEntry | undefined;
  for (const entry of entries) {
    if (best === undefined) {
      best = entry;
      continue;
    }
    if (entry.count > best.count) {
      best = entry;
      continue;
    }
    if (entry.count === best.count) {
      if (entry.defined > best.defined) {
        best = entry;
        continue;
      }
      if (entry.defined === best.defined && entry.firstIndex < best.firstIndex) best = entry;
    }
  }
  return best?.facts;
}

/* ---------- 档位判定 ---------- */

/**
 * 标题字号档位:用模板实际的 h1..h6 字号 ÷ 正文字号得比值,与三档系数比对取最接近的一档。
 *
 * 判不出(误差超阈值,或最优与次优的差距小于阈值)⇒ 不映射,由调用方计入「未映射」。
 *
 * @param ratios 级别 → 字号/正文 的比值
 * @returns 档位;判不出 ⇒ undefined
 */
function pickHeadingScale(ratios: ReadonlyMap<number, number>): HeadingScale | undefined {
  if (ratios.size === 0) return undefined;
  const scored = HEADING_TIERS.map((tier) => {
    let sum = 0;
    for (const [level, ratio] of ratios) {
      const expected = HEADING_SCALE_FACTORS[tier][level - 1]!;
      sum += Math.abs(ratio - expected);
    }
    return { tier, error: sum / ratios.size };
  });
  scored.sort((a, b) => a.error - b.error);
  const best = scored[0]!;
  const second = scored[1]!;
  if (best.error > HEADING_SCALE_MAX_ERROR) return undefined;
  if (second.error - best.error < HEADING_SCALE_MIN_GAP) return undefined;
  return best.tier;
}

/**
 * 标题段前段后档位:与三档基准表(HEADING_SPACING_BASE_PT × 倍数)比对取最接近的一档。
 *
 * 误差取**相对值**(与基准比),故与 pt 绝对值无关;某个维度在三档里同值(如 h1 的段前
 * 恒为 0)时不参与判别 —— 那一维在所有档位上误差相同,计进去只会整体抬高误差、把所有
 * 档位都判成「判不出」。
 *
 * @param values 级别 → 实际的段前/段后(pt;缺项表示模板没写这一维)
 * @returns 档位;判不出 ⇒ undefined
 */
function pickHeadingSpacing(
  values: ReadonlyMap<number, { before?: number; after?: number }>,
): HeadingSpacingTier | undefined {
  if (values.size === 0) return undefined;
  const scored = HEADING_TIERS.map((tier) => {
    const multiplier = HEADING_SPACING_MULTIPLIERS[tier];
    let sum = 0;
    let samples = 0;
    for (const [level, actual] of values) {
      const base = HEADING_SPACING_BASE_PT[level - 1]!;
      const actualDims = [actual.before, actual.after];
      for (let index = 0; index < 2; index += 1) {
        const reference = base[index]!;
        const value = actualDims[index];
        if (reference <= 0 || value === undefined) continue; // 同值维度不判别 / 模板没写
        sum += Math.abs(value - reference * multiplier) / reference;
        samples += 1;
      }
    }
    return { tier, error: samples > 0 ? sum / samples : Number.POSITIVE_INFINITY };
  });
  scored.sort((a, b) => a.error - b.error);
  const best = scored[0]!;
  const second = scored[1]!;
  if (best.error > HEADING_SPACING_MAX_ERROR) return undefined;
  if (second.error - best.error < HEADING_SPACING_MIN_GAP) return undefined;
  return best.tier;
}

/* ---------- 页面设置 ---------- */

/**
 * 页面设置:取文档的**最后一节**(多节时以末节为准,与浅导入 v1 同口径)。
 *
 * @param tree 文档树
 * @param pageSetup 出参(就地写入)
 * @param unmapped 未映射清单(就地追加)
 */
function mapPageSetup(
  tree: DocumentTree,
  pageSetup: Partial<PageSetup>,
  unmapped: UnmappedTemplateField[],
): void {
  const sections = tree.sections;
  if (sections.length === 0) return;
  const section = sections[sections.length - 1]!;
  if (section.pageWidthTwips !== undefined && section.pageHeightTwips !== undefined) {
    const widthMm = twipsToMm(section.pageWidthTwips);
    const heightMm = twipsToMm(section.pageHeightTwips);
    let best: PageSetup["paper"] | undefined;
    let bestDiff = PAPER_MATCH_TOLERANCE_MM;
    for (const paper of Object.keys(PAPER_SIZES_MM) as PageSetup["paper"][]) {
      const { width, height } = PAPER_SIZES_MM[paper];
      // 两种朝向都比:横放 A4 与竖放 A4 的宽高对调,取尺寸差最小者
      const diff = Math.min(
        Math.abs(widthMm - width) + Math.abs(heightMm - height),
        Math.abs(widthMm - height) + Math.abs(heightMm - width),
      );
      if (diff <= bestDiff) {
        bestDiff = diff;
        best = paper;
      }
    }
    if (best !== undefined) pageSetup.paper = best;
    else unmapped.push("paperUnrecognized");
  }
  if (section.orientation !== undefined) pageSetup.orientation = section.orientation;
  if (section.marginTopTwips !== undefined) pageSetup.marginTop = twipsToMm(section.marginTopTwips);
  if (section.marginBottomTwips !== undefined) {
    pageSetup.marginBottom = twipsToMm(section.marginBottomTwips);
  }
  if (section.marginLeftTwips !== undefined) pageSetup.marginLeft = twipsToMm(section.marginLeftTwips);
  if (section.marginRightTwips !== undefined) {
    pageSetup.marginRight = twipsToMm(section.marginRightTwips);
  }
}

/* ---------- 主入口 ---------- */

/**
 * 主入口:解析 .docx 字节 → 字段级映射出 typography / pageSetup,并报出未映射的字段类别。
 *
 * 任一部件缺失/解析失败均降级(返回已成功提取的部分,不抛错);**整包解不开**(非 zip /
 * 已损坏)时返回**失败态** `{ status: "unreadable" }` —— 与「解开了但没有可映射字段」
 * (那仍是成功,只是没吃下东西)严格分开。
 *
 * @param buffer .docx 字节
 * @returns 映射结果(ok)或失败态(unreadable)
 */
export async function importDocxTemplate(buffer: Uint8Array): Promise<TemplateImportResult> {
  const pkg = await openDocxPackage(buffer);
  if (pkg === null) {
    // 不是 zip / 已损坏:整包解不开 ⇒ 失败态(不是「成功但什么都没映射」)
    return { status: "unreadable" };
  }
  const [stylesXml, documentXml, themeXml] = await Promise.all([
    pkg.readText("word/styles.xml"),
    pkg.readText("word/document.xml"),
    pkg.readText("word/theme/theme1.xml"),
  ]);
  // 解开了但没有主文档部件 ⇒ 不是 Word 文档(常见形态:改了扩展名的 zip / odt / epub)。
  // 归入失败态而非「成功但没吃下东西」——否则用户看到「已应用」却什么都没导入。
  if (documentXml === null) {
    return { status: "unreadable" };
  }
  const table = parseStyles(stylesXml);
  const theme = parseTheme(themeXml);
  const tree = parseDocument(documentXml);

  const typography: Partial<TypographySettings> = {};
  const pageSetup: Partial<PageSetup> = {};
  // 恒不映射的六类(能力边界)恒在;事实性项按本次模板的条件追加
  const unmapped: UnmappedTemplateField[] = [...ALWAYS_UNMAPPED_TEMPLATE_FIELDS];

  /* ---- 正文:继承链取值(docDefaults → Normal → basedOn 逐层覆盖) ---- */
  const bodyStyle = bodyStyleId(table);
  const resolvedBody = bodyStyle !== undefined ? resolveStyle(table, bodyStyle) : null;
  const bodyRun = resolvedBody?.run ?? table.docDefaults.run;
  const bodyParagraph = resolvedBody?.paragraph ?? table.docDefaults.paragraph;

  // 字体(显式名 + 主题引用)
  const fonts = bodyRun.fonts;
  if (fonts !== undefined) {
    const ascii = resolveFontName(fonts.ascii, fonts.asciiTheme, theme, "latin");
    const eastAsia = resolveFontName(fonts.eastAsia, fonts.eastAsiaTheme, theme, "ea");
    if (ascii !== undefined) typography.fontAscii = ascii;
    if (eastAsia !== undefined) typography.fontEastAsia = eastAsia;
  }

  // 正文字号(半点 → 磅);越界则丢弃并计入未映射
  if (bodyRun.sizeHalfPoints !== undefined) {
    const sizePt = bodyRun.sizeHalfPoints / 2;
    if (sizePt >= BODY_SIZE_MIN && sizePt <= BODY_SIZE_MAX) typography.bodySizePt = sizePt;
    else unmapped.push("bodySizeOutOfRange");
  }

  /* ---- 文档段落事实:正文候选段与标题段分开取 ---- */
  const paragraphs = paragraphsOf(tree);
  const headingStyleIndex = buildHeadingStyleIndex(table);
  /** 文档里出现过的标题级别(只有这些级别参与标题档位判定) */
  const headingLevels = new Set<number>();
  /** 级别 → 标题字号(pt);段落级 run 优先,样式级兜底 */
  const headingSizePt = new Map<number, number>();
  /** 级别 → 标题段的段前/段后(缇) */
  const headingSpacing = new Map<number, { before?: number; after?: number }>();
  /** 正文事实签名表(键 → 计数与首见序) */
  const bodyFacts = new Map<string, FactsEntry>();
  /** 正文候选段落的文档序(并列时的末级排序依据) */
  let bodyIndex = 0;

  for (const paragraph of paragraphs) {
    const level =
      paragraph.style !== undefined ? headingLevelOfStyle(table, paragraph.style) : undefined;
    if (level !== undefined) {
      headingLevels.add(level);
      if (!headingSizePt.has(level)) {
        const halfPoints = firstRunSizeHalfPoints(paragraph.items);
        if (halfPoints !== undefined) headingSizePt.set(level, halfPoints / 2);
      }
      if (!headingSpacing.has(level)) {
        const before = paragraph.spacing?.before;
        const after = paragraph.spacing?.after;
        if (before !== undefined || after !== undefined) headingSpacing.set(level, { before, after });
      }
      continue;
    }
    const facts: BodyFacts = {};
    if (paragraph.align !== undefined) facts.align = paragraph.align;
    if (paragraph.spacing?.line !== undefined) {
      facts.line = paragraph.spacing.line;
      facts.lineRule = paragraph.spacing.lineRule ?? "auto";
    }
    if (paragraph.indent !== undefined) facts.firstLineIndent = hasFirstLineIndent(paragraph.indent);
    if (definedCount(facts) === 0) continue; // 没写排版事实的段落不参与投票
    const key = factsKey(facts);
    const entry = bodyFacts.get(key);
    if (entry === undefined) {
      bodyFacts.set(key, { facts, count: 1, defined: definedCount(facts), firstIndex: bodyIndex });
    } else {
      entry.count += 1;
    }
    bodyIndex += 1;
  }

  // 标题样式兜底:段落级 run 没写字号时取样式级;段前段后同理。
  // ⚠ 只对「文档里出现过的标题级别」兜底 —— 没出现过的级别若也取样式级字号,
  // 会把 docx 库的默认标题字号混进档位判定(自家稿的 Heading2 样式字号就不是本仓档位值)。
  for (const level of headingLevels) {
    const styleId = headingStyleIndex.get(level);
    const resolved = styleId !== undefined ? resolveStyle(table, styleId) : null;
    if (!headingSizePt.has(level)) {
      const halfPoints = resolved?.run.sizeHalfPoints;
      if (halfPoints !== undefined) headingSizePt.set(level, halfPoints / 2);
    }
    const spacing = headingSpacing.get(level);
    if (spacing === undefined) {
      const styleSpacing = resolved?.paragraph.spacing;
      if (styleSpacing !== undefined) {
        headingSpacing.set(level, { before: styleSpacing.before, after: styleSpacing.after });
      }
    } else if (spacing.before === undefined || spacing.after === undefined) {
      const styleSpacing = resolved?.paragraph.spacing;
      if (styleSpacing !== undefined) {
        headingSpacing.set(level, {
          before: spacing.before ?? styleSpacing.before,
          after: spacing.after ?? styleSpacing.after,
        });
      }
    }
  }

  /* ---- 正文段落级字段:文档实际用法优先,文档没写则回落样式继承链 ---- */
  const dominant = pickDominantFacts([...bodyFacts.values()]);

  // 行距(倍数)
  const lineValue =
    dominant?.line !== undefined
      ? { line: dominant.line, rule: dominant.lineRule ?? "auto" }
      : bodyParagraph.spacing?.line !== undefined
        ? { line: bodyParagraph.spacing.line, rule: bodyParagraph.spacing.lineRule ?? "auto" }
        : undefined;
  if (lineValue !== undefined) {
    if (lineValue.rule.toLowerCase() === "auto") {
      const multiple = lineValue.line / LINE_UNITS_PER_LINE;
      if (multiple >= LINE_SPACING_MIN && multiple <= LINE_SPACING_MAX) {
        typography.lineSpacing = Math.round(multiple * 100) / 100;
      } else {
        unmapped.push("lineSpacingOutOfRange");
      }
    } else {
      // exact / atLeast 是绝对行距,与本仓的「倍数」语义对不上
      unmapped.push("lineSpacingRule");
    }
  }

  // 首行缩进(布尔):有缩进才写 true —— 「模板没这项」与「模板显式关掉」不同,后者不写
  const indentValue =
    dominant?.firstLineIndent !== undefined
      ? dominant.firstLineIndent
      : bodyParagraph.indent !== undefined
        ? hasFirstLineIndent(bodyParagraph.indent)
        : undefined;
  if (indentValue === true) typography.firstLineIndent = true;

  // 对齐(只有 left / justify 两档)
  const alignValue = dominant?.align ?? bodyParagraph.align;
  if (alignValue !== undefined) {
    const normalized = alignValue.toLowerCase();
    if (normalized === "both" || normalized === "distribute") typography.align = "justify";
    else if (normalized === "left" || normalized === "start") typography.align = "left";
    else unmapped.push("alignUnsupported");
  }

  /* ---- 标题档位 ---- */
  const bodySizePt = bodyRun.sizeHalfPoints !== undefined ? bodyRun.sizeHalfPoints / 2 : undefined;
  const ratios = new Map<number, number>();
  if (bodySizePt !== undefined && bodySizePt > 0) {
    for (const [level, sizePt] of headingSizePt) ratios.set(level, sizePt / bodySizePt);
  }
  const scale = pickHeadingScale(ratios);
  if (scale !== undefined) typography.headingScale = scale;
  else unmapped.push("headingScaleUndetermined");

  const spacingValues = new Map<number, { before?: number; after?: number }>();
  for (const [level, spacing] of headingSpacing) {
    spacingValues.set(level, {
      before: spacing.before !== undefined ? twipsToPt(spacing.before) : undefined,
      after: spacing.after !== undefined ? twipsToPt(spacing.after) : undefined,
    });
  }
  const spacingTier = pickHeadingSpacing(spacingValues);
  if (spacingTier !== undefined) typography.headingSpacing = spacingTier;
  else unmapped.push("headingSpacingUndetermined");

  /* ---- 页面设置 ---- */
  mapPageSetup(tree, pageSetup, unmapped);

  return { status: "ok", typography, pageSetup, unmapped };
}
