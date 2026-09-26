// @ts-check
/**
 * 文字水印验收:
 * docx 断言(watermark text 进入 header XML / 浅灰配色 #999999 / 空 text 不生成水印头);
 * pdf 断言(html 含 .wm 覆盖层元素与旋转/不透明度 CSS / 空 text 无水印元素);
 * 不依赖真打印。另断言默认配置下 watermark.text 为空(零渲染)。
 */
import JSZip from "jszip";
import { convert } from "../../dist/core/convert.js";
import { DEFAULT_WATERMARK, DEFAULT_HEADER_FOOTER } from "../../dist/core/settings/settings-defaults.js";
import { WATERMARK_GRAY, WATERMARK_INK } from "../../dist/core/style/colors.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { asPdfArtifact, docxBufferOf } from "../common/convert-helpers.js";

/**
 * 断言辅助。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`watermark 断言失败:${msg}`);
}

/**
 * 取 docx 内的 header 部件名与其 XML 文本。
 * @param {Buffer} buffer docx 字节
 * @returns {Promise<{ names: string[], texts: string[] }>} header 部件名与内容
 */
async function headerXmls(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(
    (n) => n.startsWith("word/header") && n.endsWith(".xml"),
  );
  /** @type {string[]} */
  const texts = [];
  for (const name of names) {
    // zip.file(name) 对已枚举出的 header 部件恒存在;缺失即 zip 结构异常,显式抛错
    const entry = zip.file(name);
    if (!entry) throw new Error(`header 部件缺失: ${name}`);
    texts.push(await entry.async("string"));
  }
  return { names, texts };
}

const md = "# 水印测试\n\n本文档用于人工实测文字水印。\n";

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ---- 1. docx:水印文字进入 header XML(gray=true → #999999) ----
  const wmGray = { ...DEFAULT_WATERMARK, text: "机密文档", angle: 45, opacity: 0.15, gray: true };
  const grayDocx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    title: "标题占位",
    headerFooter: { ...DEFAULT_HEADER_FOOTER, headerMode: "none" },
    watermark: wmGray,
  });
  const grayHeaders = await headerXmls(docxBufferOf(grayDocx));
  const grayXml = grayHeaders.texts.join("\n");
  assert(grayHeaders.names.length > 0, "水印应生成 header part");
  assert(grayXml.includes("机密文档"), "水印文字应写入 header XML");
  assert(grayXml.includes(WATERMARK_GRAY), `gray=true 应使用共享常量浅灰配色 ${WATERMARK_GRAY}`);
  assert(grayXml.includes("wps:wsp"), "水印应使用 DML 文本框(wps:wsp)");
  assert(grayXml.includes('rot="2700000"'), "默认角度 45 应渲染为 DML rot=2700000(逆时针 45°)");
  assert(grayXml.includes('anchor="ctr"'), "DML wps:bodyPr 应垂直居中(anchor=ctr)");

  // ---- 2. docx:gray=false → 正文字色 #1F2328 ----
  const wmColor = { ...DEFAULT_WATERMARK, text: "彩色水印", gray: false };
  const colorDocx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    headerFooter: { ...DEFAULT_HEADER_FOOTER, headerMode: "none" },
    watermark: wmColor,
  });
  const colorXml = (await headerXmls(docxBufferOf(colorDocx))).texts.join("\n");
  assert(colorXml.includes(WATERMARK_INK), `gray=false 应使用共享常量正文字色 ${WATERMARK_INK}`);

  // ---- 3. docx:空 text 不生成水印头(none 模式 + 空 text = 无任何 header) ----
  const emptyDocx = await convert(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    headerFooter: { ...DEFAULT_HEADER_FOOTER, headerMode: "none" },
    watermark: { ...DEFAULT_WATERMARK, text: "" },
  });
  assert((await headerXmls(docxBufferOf(emptyDocx))).names.length === 0, "空 text 不应生成任何 header part");

  // ---- 4. docx:默认配置 text 为空(零渲染) ----
  assert(DEFAULT_WATERMARK.text === "", "默认 wateromark.text 应为空(关闭)");

  // ---- 5. pdf:html 含 .wm 覆盖层 + 旋转/不透明度 CSS ----
  const pdfDoc = asPdfArtifact(
    await convert(md, "pdf", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      watermark: wmGray,
    }),
  );
  assert(pdfDoc.kind === "pdf", "pdf 分支产物类型");
  assert(pdfDoc.html.includes('class="wm"'), "PDF html 应含水印覆盖层元素");
  assert(pdfDoc.html.includes(">机密文档</div>"), "PDF 水印元素应含文字");
  assert(pdfDoc.html.includes("rotate(45deg)"), "PDF 水印 CSS 应含旋转角度");
  assert(pdfDoc.html.includes(`color: #${WATERMARK_GRAY}`), `PDF 水印 CSS 应与 docx 同源取色(#${WATERMARK_GRAY})`);
  assert(pdfDoc.html.includes("opacity: 0.15"), "PDF 水印 CSS 应含不透明度");

  // ---- 6. pdf:空 text 无水印元素 ----
  const pdfEmpty = asPdfArtifact(
    await convert(md, "pdf", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      watermark: { ...DEFAULT_WATERMARK, text: "" },
    }),
  );
  assert(!pdfEmpty.html.includes('class="wm"'), "空 text 的 PDF 不应含水印元素");

  console.log("[ok] watermark:docx 文字/配色/空 text 零渲染 + pdf 覆盖层/旋转/不透明度 断言通过");
}
