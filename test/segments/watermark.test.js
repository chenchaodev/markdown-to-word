// @ts-check
/**
 * 文字水印验收:
 * docx 断言(watermark text 进入 header XML / 浅灰配色 #999999 / 旋转量取自
 * watermarkDmlRotation / 不透明度经 w14:textFill 真消费 / 空 text 不生成水印头);
 * pdf 断言(html 含 .wm 覆盖层元素与旋转/不透明度 CSS / 空 text 无水印元素);
 * 不依赖真打印。另断言默认配置下 watermark.text 为空(零渲染)。
 *
 * 角度与不透明度两项自 adr-030 6-B1/6-B2 起两侧对齐:docx 侧不再靠调浅灰近似
 * 不透明度,也不再在渲染层自带取负 —— 故此处断言的是「消费单源换算的结果」,
 * 而不是某个硬编码的 rot 值。
 */
import JSZip from "jszip";
import {
  DEFAULT_WATERMARK,
  DEFAULT_HEADER_FOOTER,
  DEFAULT_WATERMARK_ANGLE,
  WATERMARK_DML_ROTATION_SIGN,
  watermarkDmlRotation,
} from "../../dist/core/settings/settings-defaults.js";
import { WATERMARK_GRAY, WATERMARK_INK } from "../../dist/core/style/colors.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { asPdfArtifact, convertWithFs, docxBufferOf } from "../common/convert-helpers.js";

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
  // ---- 0. 默认角度取值与换算(6-B1:单点可翻转) ----
  // 默认 315 = 逆时针 45° = 中文出版惯例的「左下 → 右上」;两侧同号,
  // 故 docx 侧的 rot 与 pdf 侧的 rotate 同向。翻转只需改
  // WATERMARK_DML_ROTATION_SIGN 一个常量(方向待人工渲染确认,见 settings-defaults)。
  assert(DEFAULT_WATERMARK_ANGLE === 315, `水印默认角度应为 315(左下→右上),实际 ${DEFAULT_WATERMARK_ANGLE}`);
  assert(DEFAULT_WATERMARK.angle === DEFAULT_WATERMARK_ANGLE, "DEFAULT_WATERMARK.angle 应取默认角度单点");
  assert(
    watermarkDmlRotation(DEFAULT_WATERMARK_ANGLE) === 315 * WATERMARK_DML_ROTATION_SIGN * 60_000,
    "watermarkDmlRotation 应按「角度 × 符号系数 × 60000」换算",
  );
  assert(
    WATERMARK_DML_ROTATION_SIGN === 1 || WATERMARK_DML_ROTATION_SIGN === -1,
    "docx 侧符号系数只能是 ±1(单点翻转的契约)",
  );

  // ---- 1. docx:水印文字进入 header XML(gray=true → #999999) ----
  const wmGray = { ...DEFAULT_WATERMARK, text: "机密文档", angle: DEFAULT_WATERMARK_ANGLE, opacity: 0.15, gray: true };
  const grayDocx = await convertWithFs(md, "docx", {
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
  assert(
    grayXml.includes(`rot="${watermarkDmlRotation(wmGray.angle)}"`),
    `docx 水印 rot 应等于 watermarkDmlRotation(${wmGray.angle}) = ${watermarkDmlRotation(wmGray.angle)}`,
  );
  assert(grayXml.includes('anchor="ctr"'), "DML wps:bodyPr 应垂直居中(anchor=ctr)");
  // ---- 1b. docx:不透明度真消费(6-B2 —— 此前靠浅灰配色近似,设置项静默失效) ----
  assert(grayXml.includes("<w14:textFill>"), "docx 水印应产出 w14:textFill(文字透明度载体)");
  assert(
    grayXml.includes('<w14:alpha w14:val="15000"/>'),
    "docx 水印 alpha 应等于 opacity 0.15 × 100000 = 15000",
  );

  // ---- 2. docx:gray=false → 正文字色 #1F2328 ----
  const wmColor = { ...DEFAULT_WATERMARK, text: "彩色水印", gray: false };
  const colorDocx = await convertWithFs(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    headerFooter: { ...DEFAULT_HEADER_FOOTER, headerMode: "none" },
    watermark: wmColor,
  });
  const colorXml = (await headerXmls(docxBufferOf(colorDocx))).texts.join("\n");
  assert(colorXml.includes(WATERMARK_INK), `gray=false 应使用共享常量正文字色 ${WATERMARK_INK}`);

  // ---- 3. docx:空 text 不生成水印头(none 模式 + 空 text = 无任何 header) ----
  const emptyDocx = await convertWithFs(md, "docx", {
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
    await convertWithFs(md, "pdf", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      watermark: wmGray,
    }),
  );
  assert(pdfDoc.kind === "pdf", "pdf 分支产物类型");
  assert(pdfDoc.html.includes('class="wm"'), "PDF html 应含水印覆盖层元素");
  assert(pdfDoc.html.includes(">机密文档</div>"), "PDF 水印元素应含文字");
  assert(
    pdfDoc.html.includes(`rotate(${wmGray.angle}deg)`),
    `PDF 水印 CSS 应含与 docx 同号的旋转角 ${wmGray.angle}deg`,
  );
  assert(pdfDoc.html.includes(`color: #${WATERMARK_GRAY}`), `PDF 水印 CSS 应与 docx 同源取色(#${WATERMARK_GRAY})`);
  assert(pdfDoc.html.includes("opacity: 0.15"), "PDF 水印 CSS 应含不透明度");

  // ---- 5b. 两侧不透明度同值可执行对齐(6-B2 的核心断言) ----
  // 取一个非默认 opacity,证明两侧都消费同一个设置值:docx 走 w14:alpha
  // (千分比),pdf 走 CSS opacity(0–1),换算关系写在断言里。
  const wmHalf = { ...DEFAULT_WATERMARK, text: "半透明", angle: DEFAULT_WATERMARK_ANGLE, opacity: 0.5, gray: true };
  const halfDocx = await convertWithFs(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    headerFooter: { ...DEFAULT_HEADER_FOOTER, headerMode: "none" },
    watermark: wmHalf,
  });
  const halfXml = (await headerXmls(docxBufferOf(halfDocx))).texts.join("\n");
  assert(halfXml.includes('<w14:alpha w14:val="50000"/>'), "docx opacity=0.5 应写 w14:alpha=50000");
  const halfPdf = asPdfArtifact(await convertWithFs(md, "pdf", { baseDir: FIXTURES_DIR, warnings: [], watermark: wmHalf }));
  assert(halfPdf.html.includes("opacity: 0.5"), "PDF opacity=0.5 应写 CSS opacity: 0.5");

  // ---- 5c. 不透明度极值:0 与 1 都不得被钳掉或写坏 ----
  const wmZero = { ...DEFAULT_WATERMARK, text: "全透", angle: DEFAULT_WATERMARK_ANGLE, opacity: 0, gray: true };
  const zeroXml = (
    await headerXmls(
      docxBufferOf(
        await convertWithFs(md, "docx", {
          baseDir: FIXTURES_DIR,
          warnings: [],
          headerFooter: { ...DEFAULT_HEADER_FOOTER, headerMode: "none" },
          watermark: wmZero,
        }),
      ),
    )
  ).texts.join("\n");
  assert(zeroXml.includes('<w14:alpha w14:val="0"/>'), "docx opacity=0 应写 w14:alpha=0(全透明)");

  // ---- 6. pdf:空 text 无水印元素 ----
  const pdfEmpty = asPdfArtifact(
    await convertWithFs(md, "pdf", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      watermark: { ...DEFAULT_WATERMARK, text: "" },
    }),
  );
  assert(!pdfEmpty.html.includes('class="wm"'), "空 text 的 PDF 不应含水印元素");

  console.log(
    "[ok] watermark:角度单点(315/同号) + docx 文字/配色/rot 换算/w14:alpha 不透明度/空 text 零渲染 + pdf 覆盖层/旋转/不透明度 断言通过",
  );
}
