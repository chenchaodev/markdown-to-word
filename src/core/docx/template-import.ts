/**
 * F9 docx 模板导入(浅导入 v1,ADR-008):
 * 用 jszip 解包用户 .docx,提取 Normal / Heading1 样式的 rPr(字体 ascii/eastAsia + 字号)
 * 与文档 sectPr(页面尺寸/边距),映射回现有 typography / pageSetup 设置字段。
 * 不做部件级深导入(Pandoc 式 styles 替换 + numbering 合并 + settings 白名单)。
 * 纯函数(零 IO、零 Electron 依赖),可直测;颜色字段当前设置模型无对应项,不在 v1 范围。
 */
import JSZip from "jszip";
import {
  PAPER_SIZES_MM,
  type PageSetup,
} from "../settings/settings-defaults.js";
import type { TypographySettings } from "../settings/typography.js";

/** 提取结果:仅含模板中实际存在的字段(其余保持用户现有设置) */
export interface TemplateExtracted {
  typography: Partial<TypographySettings>;
  pageSetup: Partial<PageSetup>;
}

/** 1 twip = 1/1440 inch;1 inch = 25.4mm */
const TWIPS_PER_MM = 1440 / 25.4;

function twipsToMm(twips: number): number {
  return Math.round((twips / TWIPS_PER_MM) * 10) / 10;
}

async function readEntry(zip: JSZip, name: string): Promise<string | null> {
  const entry = zip.file(name);
  if (!entry) return null;
  try {
    return await entry.async("string");
  } catch {
    return null;
  }
}

/** 取指定 styleId 的样式块(含其内部 rPr),无则 null */
function getStyleBlock(stylesXml: string, styleId: string): string | null {
  const re = new RegExp(`<w:style[^>]*\\sw:styleId="${styleId}"[^>]*>([\\s\\S]*?)</w:style>`);
  const m = stylesXml.match(re);
  return m ? m[1]! : null;
}

/** 从一段 XML 中取首个 rPr 内部文本 */
function getRPr(xml: string): string | null {
  const m = xml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
  return m ? m[1]! : null;
}

function attr(xml: string, name: string): number | undefined {
  const m = xml.match(new RegExp(`\\b${name}="(\\d+)"`));
  return m ? Number(m[1]) : undefined;
}

/** 解析字体/字号:优先 Heading1(标题常用独立字体),回退 Normal */
function extractTypography(stylesXml: string): Partial<TypographySettings> {
  const out: Partial<TypographySettings> = {};
  const normalBlock = getStyleBlock(stylesXml, "Normal");
  const headingBlock = getStyleBlock(stylesXml, "Heading1");
  const normalRPr = normalBlock ? getRPr(normalBlock) : null;
  const headingRPr = headingBlock ? getRPr(headingBlock) : null;

  // 字体:标题样式优先(若显式),否则取正文 Normal
  const fontRPr = headingRPr ?? normalRPr;
  if (fontRPr) {
    const asciiM = fontRPr.match(/w:ascii="([^"]+)"/);
    const eastM = fontRPr.match(/w:eastAsia="([^"]+)"/);
    if (asciiM) out.fontAscii = asciiM[1]!;
    if (eastM) out.fontEastAsia = eastM[1]!;
  }
  // 字号取 Normal(标题字号由 bodySizePt × 档位系数派生,不直接映射)
  if (normalRPr) {
    const szM = normalRPr.match(/<w:sz[^>]*\bw:val="(\d+)"/);
    if (szM) {
      const pt = Number(szM[1]) / 2;
      if (pt >= 8 && pt <= 24) out.bodySizePt = pt;
    }
  }
  return out;
}

/** 从文档/样式 sectPr 解析页面尺寸与边距;无则 null */
function extractPageSetup(xml: string): Partial<PageSetup> | null {
  // 取最后一个 sectPr(文档主体末尾的节属性)
  const all = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g);
  if (!all || all.length === 0) return null;
  const sectPr = all[all.length - 1]!;
  const pgSz = sectPr.match(/<w:pgSz[\s\S]*?\/?>/);
  const pgMar = sectPr.match(/<w:pgMar[\s\S]*?\/?>/);
  const out: Partial<PageSetup> = {};

  if (pgSz) {
    const w = attr(pgSz[0]!, "w:w");
    const h = attr(pgSz[0]!, "w:h");
    if (w !== undefined && h !== undefined) {
      const wMm = twipsToMm(w);
      const hMm = twipsToMm(h);
      // 匹配纸张(两种朝向均比):取尺寸差最小者,容差 3mm
      let best: PageSetup["paper"] | null = null;
      let bestDiff = 3;
      for (const paper of Object.keys(PAPER_SIZES_MM) as PageSetup["paper"][]) {
        const { width, height } = PAPER_SIZES_MM[paper];
        const diff = Math.min(
          Math.abs(wMm - width) + Math.abs(hMm - height),
          Math.abs(wMm - height) + Math.abs(hMm - width),
        );
        if (diff <= bestDiff) {
          bestDiff = diff;
          best = paper;
        }
      }
      if (best) out.paper = best;
      out.orientation = hMm >= wMm ? "portrait" : "landscape";
      if (out.paper === undefined) {
        // 未识别纸张:仍记录尺寸供后续扩展,但 v1 不写 paper(保留用户原值)
        delete out.paper;
      }
    }
  }
  if (pgMar) {
    const top = attr(pgMar[0]!, "w:top");
    const bottom = attr(pgMar[0]!, "w:bottom");
    const left = attr(pgMar[0]!, "w:left");
    const right = attr(pgMar[0]!, "w:right");
    if (top !== undefined) out.marginTop = twipsToMm(top);
    if (bottom !== undefined) out.marginBottom = twipsToMm(bottom);
    if (left !== undefined) out.marginLeft = twipsToMm(left);
    if (right !== undefined) out.marginRight = twipsToMm(right);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 主入口:解析 .docx 字节 → 提取可映射的样式/页面设置。
 * 任一部件缺失/解析失败均降级(返回已成功提取的部分,不抛错)。
 */
export async function importDocxTemplate(buffer: Uint8Array): Promise<TemplateExtracted> {
  const result: TemplateExtracted = { typography: {}, pageSetup: {} };
  try {
    const zip = await JSZip.loadAsync(buffer);
    const stylesXml = (await readEntry(zip, "word/styles.xml")) ?? "";
    if (stylesXml) result.typography = extractTypography(stylesXml);
    const docXml = (await readEntry(zip, "word/document.xml")) ?? "";
    const fromDoc = docXml ? extractPageSetup(docXml) : null;
    result.pageSetup = fromDoc ?? (stylesXml ? extractPageSetup(stylesXml) ?? {} : {});
  } catch {
    // 损坏/非 docx:返回空(调用方据此提示解析失败)
  }
  return result;
}
