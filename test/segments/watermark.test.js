// @ts-check
/**
 * 文字水印验收:
 * docx 断言(watermark text 进入 header XML / 浅灰配色 #999999 / 旋转量取自
 * watermarkDmlRotation / 不透明度经 w14:textFill 真消费 / 空 text 不生成水印头);
 * pdf 断言(html 含 .wm 覆盖层元素与旋转/不透明度 CSS / 空 text 无水印元素);
 * 不依赖真打印。另断言默认配置下 watermark.text 为空(零渲染)。
 *
 * 另断言形状 spPr 显式声明无填充/无描边(断言落在 spPr 本体,不靠整篇 includes),
 * 以及水印 run 带 <w:noProof/>(装饰内容不参与拼写/语法校对,断言落在 run 的 rPr 本体)。
 * 两者都不依赖整篇 includes:前者守「不继承渲染器默认形状格式」,后者守「装饰内容
 * 不被校对」—— 均与用户实测那条红线的成因无关(该归因已被 1c/1d 注释记为证伪/未证实)。
 *
 * 角度与不透明度两项自 adr-030 6-B1/6-B2 起两侧对齐:docx 侧不再靠调浅灰近似
 * 不透明度,也不再在渲染层自带取负 —— 故此处断言的是「消费单源换算的结果」,
 * 而不是某个硬编码的 rot 值。
 *
 * 水印不透明度的**方向**由 5c 的两个端点(opacity 0 / 1)锁定:真实 Word/WPS 把
 * w14:alpha 当「透明度」消费,故 alpha = (1 − opacity) × 100000,与规范字面读法
 * 相反(依据是用户实测三档,详见 chrome.ts 的 WatermarkTextRun 注释)。
 * 中点 0.5 两语义同值、查不出反转,故端点不可省。
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

/**
 * 取 header XML 里水印形状的 <wps:spPr> 片段。
 * 断言要落在 spPr 本体(而非整篇 includes):整篇匹配分不清「显式声明」
 * 与「恰好出现在别处」,这两种必须区分 —— 本段守护的就是这一点。
 * @param {string} xml header XML 文本
 * @returns {string} spPr 元素片段
 */
function spPrOf(xml) {
  const m = /<wps:spPr\b[\s\S]*?<\/wps:spPr>/.exec(xml);
  if (!m) throw new Error("header XML 中未找到 <wps:spPr>(水印形状不存在或结构已变)");
  return m[0];
}

/**
 * 取 header XML 里 w14:alpha 的数值。
 * 断言改用取正则比 includes(字面串)更稳,也让失败消息能报出实际值。
 * @param {string} xml header XML 文本
 * @returns {number} alpha 值
 */
function alphaOf(xml) {
  const m = /<w14:alpha w14:val="(\d+)"\/>/.exec(xml);
  if (!m) throw new Error("header XML 中未找到 w14:alpha(水印未产出 w14 文字填充)");
  return Number(m[1]);
}

/**
 * 取水印文字 run 的 <w:rPr> 片段(先收窄到 w:txbxContent,再取其中第一个 w:rPr)。
 * 收窄的理由与 spPrOf 同源:整篇 includes 分不清「水印 run 上有」与「别处恰好有」,
 * 而本段守护的正是「标记落在水印 run 的 rPr 上」这一点。
 * @param {string} xml header XML 文本
 * @returns {string} 水印 run 的 rPr 元素片段
 */
function watermarkRunRPrOf(xml) {
  const txbx = /<w:txbxContent>[\s\S]*?<\/w:txbxContent>/.exec(xml);
  if (!txbx) throw new Error("header XML 中未找到 <w:txbxContent>(水印文本框不存在或结构已变)");
  const m = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(txbx[0]);
  if (!m) throw new Error(`水印文本框内未找到 <w:rPr>,实际: ${txbx[0]}`);
  return m[0];
}

const md = "# 水印测试\n\n本文档用于人工实测文字水印。\n";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
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
  // 方向:真实渲染器把 w14:alpha 当「透明度」消费(0=全不透明,100000=全透明),
  // 故 alpha = (1 − opacity) × 100000,不是字面读法的 opacity × 100000。
  // 依据与维护须知见 src/core/docx/chrome.ts 的 WatermarkTextRun 注释。
  assert(
    alphaOf(grayXml) === 85_000,
    `docx 水印 alpha 应等于 (1 − opacity 0.15) × 100000 = 85000(近不透明),实际 ${alphaOf(grayXml)}`,
  );

  // ---- 1c. docx:形状显式「无填充 + 无描边」(不带就是继承渲染器默认形状格式) ----
  // 背景:水印形状本来就不该有填充与描边,靠「省略即无」是继承渲染器的默认形状格式,
  // 不是声明 —— 故显式写出。断言落在 spPr 本体:两个声明都是 DrawingML 本体
  // (无 wps: 前缀),<wps:spPr> 只是容器 —— 若把 <a:noFill/> 误写成 <wps:noFill/>,
  // 下面的断言应当判红。
  //
  // ⚠️ 勿把这两条当成「用户实测那条红线」的修复凭据:该声明在真实产物里**确实生效**
  // (解包核实 <a:noFill/> 与 <a:ln><a:noFill/></a:ln> 都在),而红线**依旧**,
  // 即「红线来自形状默认描边」这个归因已被证伪(见 1d)。两条断言守的是
  // 「不依赖渲染器默认值」这一条不变式,与红线的成因无关。
  const graySpPr = spPrOf(grayXml);
  assert(
    /<a:noFill\s*\/>/.test(graySpPr),
    `形状 spPr 应显式声明无填充 <a:noFill/>(不依赖渲染器默认形状格式),实际: ${graySpPr}`,
  );
  assert(
    /<a:ln\b[^>]*>\s*<a:noFill\s*\/>\s*<\/a:ln>/.test(graySpPr),
    `形状 spPr 应显式声明无描边 <a:ln><a:noFill/></a:ln>(不依赖渲染器默认形状格式),实际: ${graySpPr}`,
  );

  // ---- 1d. docx:水印 run 标记为「不参与拼写/语法校对」(<w:noProof/>) ----
  // 水印是**装饰内容,不是正文**,本就不该被校对 —— 这一条独立成立,与外观/透明度/
  // 形状设置都无关。
  //
  // 背景(观察,非结论):用户实测导出页面上有一条与水印同向的细红线。解包用户那份
  // 产物核实过 —— 全包无红色字面量、无 <w:u>、无 <w:pBdr>、无 theme1.xml,即文档内
  // 不存在能画出那条线的声明,故判定它是渲染器自加的标记。「渲染器侧的校对标记」是与
  // 全部证据相容但**尚未证实**的假设(需用户关掉校对后复验),所以本断言守护的是
  // 「装饰内容不参与校对」这个可独立验证的声明式行为,不是「红线已被修掉」。
  //
  // 断言取 rPr 本体(先收窄到 w:txbxContent 再取 w:rPr):整篇 includes 分不清标记落在
  // 水印 run 上还是别处。正则要求**裸** <w:noProof/> —— 库对 noProof:false 产出的是
  // <w:noProof w:val="false"/>,带上 w:val 形态会被下面的断言判红(那正是「标记被显式关掉」
  // 的失败形态)。
  const grayRunRPr = watermarkRunRPrOf(grayXml);
  assert(
    /<w:noProof\s*\/>/.test(grayRunRPr),
    `水印是装饰内容,不该被拼写/语法校对标记 —— 缺了 <w:noProof/> 会被渲染器标记;水印 run 的 rPr 应含裸 <w:noProof/>(带 w:val 形态即 noProof 被显式关掉),实际: ${grayRunRPr}`,
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
  //
  // ⚠️ 中点是**两种语义给出同一数值**的那一档:0.5 取反与否都是 50000。
  // 所以「只断言中点」在结构上就查不出语义反转 —— 上一版反转 bug 正是这样漏过去的
  // (断言写死 50000,而按字面读法实现也产出 50000,测试永远绿)。
  // 方向只能由 5c 的两个**端点**锁死。
  const wmHalf = { ...DEFAULT_WATERMARK, text: "半透明", angle: DEFAULT_WATERMARK_ANGLE, opacity: 0.5, gray: true };
  const halfDocx = await convertWithFs(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    headerFooter: { ...DEFAULT_HEADER_FOOTER, headerMode: "none" },
    watermark: wmHalf,
  });
  const halfXml = (await headerXmls(docxBufferOf(halfDocx))).texts.join("\n");
  assert(
    alphaOf(halfXml) === 50_000,
    `docx opacity=0.5 应写 w14:alpha=50000(半透明;注意该值取反与否相同,不是方向证据),实际 ${alphaOf(halfXml)}`,
  );
  const halfPdf = asPdfArtifact(await convertWithFs(md, "pdf", { baseDir: FIXTURES_DIR, warnings: [], watermark: wmHalf }));
  assert(halfPdf.html.includes("opacity: 0.5"), "PDF opacity=0.5 应写 CSS opacity: 0.5");

  // ---- 5c. 不透明度端点:方向锁(反转回归的唯一守护点) ----
  // 真实渲染器把 w14:alpha 当「透明度」消费(0 = 全不透明,100000 = 全透明),
  // 故映射为 alpha = (1 − opacity) × 100000。断言按这个方向书写:
  //   opacity 0   → alpha 100000 → 水印全透明(看不见)
  //   opacity 0.5 → alpha 50000  → 半透明(中点,两语义同值,查不出反转)
  //   opacity 1   → alpha 0     → 水印全不透明(最实)
  // 若有人把 chrome.ts 的映射改回字面读法(去掉取反),端点两档会得到 0 / 100000,
  // 与下面断言正好互换 —— 即反转回归必然让本段判红。
  /**
   * @param {string} text 水印文字
   * @param {number} opacity 不透明度设置值
   * @returns {Promise<string>} 该配置下 header XML
   */
  const headerXmlFor = async (text, opacity) => {
    const artifact = await convertWithFs(md, "docx", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      headerFooter: { ...DEFAULT_HEADER_FOOTER, headerMode: "none" },
      watermark: { ...DEFAULT_WATERMARK, text, angle: DEFAULT_WATERMARK_ANGLE, opacity, gray: true },
    });
    return (await headerXmls(docxBufferOf(artifact))).texts.join("\n");
  };

  const zeroXml = await headerXmlFor("全透", 0);
  assert(
    alphaOf(zeroXml) === 100_000,
    `docx opacity=0 应写 w14:alpha=100000(全透明=看不见);若得 0 即映射被改回字面读法,实际 ${alphaOf(zeroXml)}`,
  );
  const opaqueXml = await headerXmlFor("全实", 1);
  assert(
    alphaOf(opaqueXml) === 0,
    `docx opacity=1 应写 w14:alpha=0(全不透明=最实);若得 100000 即映射被改回字面读法,实际 ${alphaOf(opaqueXml)}`,
  );

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
    "[ok] watermark:角度单点(315/同号) + docx 文字/配色/rot 换算/w14:alpha 不透明度(取反语义,端点锁方向)/形状显式无填充无描边(不继承默认形状格式)/水印 run 带 <w:noProof/>(装饰内容不参与校对)/空 text 零渲染 + pdf 覆盖层/旋转/不透明度 断言通过",
  );
}
