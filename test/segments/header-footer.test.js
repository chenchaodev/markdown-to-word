/**
 * 页眉页脚自定义验收:
 * docx 断言(custom 文字入 header XML / leftRight 右对齐制表位 / logo w:drawing /
 * none 无页眉部件 / footerEnabled=false 无页脚部件 / default 行为回归=标题居中);
 * pdf 断言模板字符串(headerTemplate 按模式构造、logo data URI、footer 开关),
 * 不依赖真打印;另断言 webp logo 降级警告与 keyed 警告工厂。
 */
import JSZip from "jszip";
import { convert } from "../../dist/core/convert.js";
import { DEFAULT_HEADER_FOOTER } from "../../dist/core/settings/settings-defaults.js";
import {
  buildPdfHeaderTemplate,
  PDF_EMPTY_CHROME_TEMPLATE,
  PDF_FOOTER_TEMPLATE,
} from "../../dist/core/pdf/template.js";
import { headerLogoLoadFailedWarning } from "../../dist/core/image/image-warning.js";
import { FIXTURES_DIR } from "../common/paths.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`header-footer 断言失败:${msg}`);
}

/** 收集 docx 中匹配部件名的全部文本(如 word/header*.xml) */
async function collectParts(buffer, prefix, suffix) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(
    (n) => n.startsWith(prefix) && n.endsWith(suffix),
  );
  const texts = [];
  for (const name of names) texts.push(await zip.file(name).async("string"));
  return { names, texts };
}

async function headerXmls(buffer) {
  return collectParts(buffer, "word/header", ".xml");
}

async function footerNames(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter(
    (n) => n.startsWith("word/footer") && n.endsWith(".xml"),
  );
}

/** 1×1 PNG(最小合法魔数 + IHDR 尺寸可解析) */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** RIFF/WEBP 魔数字节(sniffImageType 判定为 webp,docx 不支持内嵌) */
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
]);

/** 主样例:自定义页眉样例(gen-fixtures 落盘为 acceptance/header-footer.md) */
export const fixtures = {
  main: "# 页眉页脚测试\n\n本文档用于人工实测自定义页眉(文字 + Logo)与页脚开关。\n",
};

const md = fixtures.main;

export async function run() {
  // ---- 1. docx custom 居中:文字入 header XML 且居中 ----
  const hfCustom = {
    ...DEFAULT_HEADER_FOOTER,
    headerMode: "custom",
    headerText: "机密文档 · 内部资料",
  };
  const customDocx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    title: "标题占位",
    headerFooter: hfCustom,
  });
  const customHeaders = await headerXmls(customDocx.buffer);
  const customXml = customHeaders.texts.join("\n");
  assert(customHeaders.names.length > 0, "custom 模式应生成 header part");
  assert(customXml.includes("机密文档 · 内部资料"), "custom 页眉文字应写入 header XML");
  assert(customXml.includes('w:jc w:val="center"'), "center 布局应为居中对齐");
  assert(!customXml.includes("标题占位"), "custom 模式不应再显示文档标题");

  // ---- 2. docx leftRight:右对齐制表位(TabStopType.RIGHT),非居中 ----
  const lrDocx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    title: "标题占位",
    headerFooter: { ...hfCustom, headerLayout: "leftRight" },
  });
  const lrXml = (await headerXmls(lrDocx.buffer)).texts.join("\n");
  assert(lrXml.includes('w:tab w:val="right"'), "leftRight 布局应有右对齐制表位");
  assert(!lrXml.includes('w:jc w:val="center"'), "leftRight 布局不应居中");

  // ---- 3. docx logo:png 数据 → w:drawing + media part;webp → 警告降级 ----
  const logoDocx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    title: "标题占位",
    headerFooter: hfCustom,
    headerLogo: { data: PNG_1X1, extension: "png" },
  });
  const logoZip = await JSZip.loadAsync(logoDocx.buffer);
  const logoHeader = (await headerXmls(logoDocx.buffer)).texts.join("\n");
  assert(logoHeader.includes("<w:drawing>"), "logo 应以 w:drawing 写入 header XML");
  assert(
    Object.keys(logoZip.files).some((n) => n.startsWith("word/media/")),
    "logo 图片字节应进入 word/media/",
  );
  const webpWarnings = [];
  const webpDocx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: webpWarnings,
    title: "标题占位",
    headerFooter: hfCustom,
    headerLogo: { data: WEBP_BYTES, extension: "webp" },
  });
  const webpHeader = (await headerXmls(webpDocx.buffer)).texts.join("\n");
  assert(!webpHeader.includes("<w:drawing>"), "webp logo 应降级为无 logo(无 w:drawing)");
  assert(
    webpWarnings.some((w) => typeof w === "object" && w.key === "warn.webpSkipped"),
    "webp logo 降级应产生 warn.webpSkipped keyed 警告",
  );

  // ---- 4. docx none:无页眉部件 ----
  const noneDocx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    title: "标题占位",
    headerFooter: { ...DEFAULT_HEADER_FOOTER, headerMode: "none" },
  });
  const noneHeaders = await headerXmls(noneDocx.buffer);
  assert(noneHeaders.names.length === 0, "none 模式不应生成任何 header part");

  // ---- 5. docx footerEnabled=false:无页脚部件 ----
  const noFooterDocx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    title: "标题占位",
    headerFooter: { ...DEFAULT_HEADER_FOOTER, footerEnabled: false },
  });
  assert((await footerNames(noFooterDocx.buffer)).length === 0, "footerEnabled=false 不应生成 footer part");

  // ---- 6. default 行为回归:标题居中 + 页码页脚存在 ----
  const defDocx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    title: "回归标题",
    headerFooter: undefined, // 缺省 = 默认配置(现状行为)
  });
  const defHeaders = await headerXmls(defDocx.buffer);
  const defXml = defHeaders.texts.join("\n");
  assert(defHeaders.names.length > 0, "default 模式应有标题页眉");
  assert(defXml.includes("回归标题") && defXml.includes('w:jc w:val="center"'), "default 页眉应为文档标题居中");
  assert((await footerNames(defDocx.buffer)).length > 0, "默认应有页码页脚 part");

  // ---- 7. pdf 模板:custom 渲染文字/logo/布局,default 与 none 空模板 ----
  const customPdf = await convert(md, "pdf", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    headerFooter: hfCustom,
    headerLogo: { data: PNG_1X1, extension: "png" },
  });
  assert(customPdf.kind === "pdf", "pdf 分支产物类型");
  assert(customPdf.headerTemplate.includes("机密文档 · 内部资料"), "PDF 自定义页眉应含转义后文字");
  assert(customPdf.headerTemplate.includes("font-size:7pt"), "PDF 页眉字号应与 docx 对齐(7pt)");
  assert(customPdf.headerTemplate.includes("#888888"), "PDF 页眉灰度应与 docx MUTED_TEXT_GRAY 一致(#888888)");
  assert(customPdf.headerTemplate.includes("data:image/png;base64,"), "PDF logo 应内嵌为 data URI");
  assert(customPdf.footerTemplate === PDF_FOOTER_TEMPLATE, "默认页脚模板不变");
  const lrPdf = buildPdfHeaderTemplate({ ...hfCustom, headerLayout: "leftRight" }, { data: PNG_1X1, extension: "png" });
  assert(lrPdf.includes("float:left") && lrPdf.includes("float:right"), "leftRight 布局应为 float 左右分栏");
  const lrNoLogo = buildPdfHeaderTemplate({ ...hfCustom, headerLayout: "leftRight" });
  assert(lrNoLogo.includes("text-align:left"), "leftRight 无 logo 时文字应靠左");
  const defHf = buildPdfHeaderTemplate(DEFAULT_HEADER_FOOTER);
  assert(defHf === PDF_EMPTY_CHROME_TEMPLATE, "default 模式 PDF 维持现状(空页眉模板)");
  const noneHf = buildPdfHeaderTemplate({ ...DEFAULT_HEADER_FOOTER, headerMode: "none" });
  assert(noneHf === PDF_EMPTY_CHROME_TEMPLATE, "none 模式 PDF 空页眉模板");
  const noFooterPdf = await convert(md, "pdf", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    headerFooter: { ...DEFAULT_HEADER_FOOTER, footerEnabled: false },
  });
  assert(noFooterPdf.footerTemplate === PDF_EMPTY_CHROME_TEMPLATE, "footerEnabled=false 页脚为空模板");

  // ---- 8. keyed 警告工厂:读取失败文案形状 ----
  const w = headerLogoLoadFailedWarning("C:\\img\\logo.png");
  assert(w.key === "warn.headerLogoLoadFailed", "警告 key 应为 warn.headerLogoLoadFailed");
  assert(w.params && w.params.src === "C:\\img\\logo.png", "警告应携带 src 参数");
  assert(typeof w.fallback === "string" && w.fallback.includes("logo.png"), "fallback 应含路径便于定位");

  console.log("[ok] header-footer:docx custom/leftRight/logo/none/footer 开关/default 回归 + pdf 模板 + keyed 警告 断言通过");
}
