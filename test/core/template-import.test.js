// @ts-check
/**
 * docx 模板导入(字段级深导入)测试:
 * - 继承链取值:两种输入形态都要正确 —— ① 自家稿形态(无 Normal 样式,正文属性在
 *   docDefaults + 段落级)② 外部 Word 模板形态(Normal 带 rPr,覆盖 docDefaults)。
 * - 字段映射:字体/字号/行距/首行缩进/对齐/标题字号档位/标题间距档位/纸张朝向边距。
 * - 未映射清单:恒在的「本仓不接」六类(能力边界),以及本次的越界/判不出项(事实性)。
 * - 失败态:整包解不开(非 docx / 损坏)⇒ 可区分的失败态,不是「成功但空」;
 *   合法 docx 但没有可映射字段 ⇒ 仍是成功(空结果 ≠ 失败)。
 * 复用既有单 convert 通路,此测试锁定提取映射不被回归。
 */
import JSZip from "jszip";
import { importDocxTemplate } from "../../dist/core/docx/template-import.js";
import {
  ALWAYS_UNMAPPED_TEMPLATE_FIELDS,
  FACTUAL_UNMAPPED_TEMPLATE_FIELDS,
  isFactualUnmappedTemplateField,
} from "../../dist/core/docx/template-fields.js";
import { assert, createCaseSuite } from "../harness/case.js";

/** @typedef {import("../../dist/core/docx/template-fields.js").UnmappedTemplateField} UnmappedTemplateField */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/**
 * 打包最小 .docx。
 * @param {Record<string, string>} parts 部件名 → 文本
 * @returns {Promise<Uint8Array>} docx 字节
 */
export async function buildDocx(parts) {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(parts)) {
    zip.file(name, text);
  }
  return zip.generateAsync({ type: "uint8array" });
}

/**
 * 造 document.xml(正文段 + 末节 sectPr)。
 * @param {string[]} bodyXml 正文块(段落)XML
 * @param {number} pgSzW 页宽(twips)
 * @param {number} pgSzH 页高(twips)
 * @param {number} mar 四边边距(twips)
 * @returns {string} document.xml 文本
 */
function docXml(bodyXml, pgSzW, pgSzH, mar) {
  return `<?xml version="1.0"?>
<w:document ${W}>
  <w:body>
    ${bodyXml.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="${pgSzW}" w:h="${pgSzH}"/>
      <w:pgMar w:top="${mar}" w:bottom="${mar}" w:left="${mar}" w:right="${mar}"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

/** 自家稿形态的 styles.xml:无 Normal 样式,正文字体/字号在 docDefaults */
const OWN_STYLES_XML = `<?xml version="1.0"?>
<w:styles ${W}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:eastAsia="微软雅黑" w:hAnsi="Calibri"/>
      <w:sz w:val="24"/><w:szCs w:val="24"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault/>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:rPr><w:color w:val="2E74B5"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
</w:styles>`;

/** 自家稿形态的正文:目录题(居中)+ 一级标题 + 两段正文 */
const OWN_BODY_XML = [
  `<w:p><w:pPr><w:spacing w:after="480" w:before="240"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="36"/></w:rPr><w:t>目录</w:t></w:r></w:p>`,
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:after="240" w:before="0"/></w:pPr><w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>一级标题</w:t></w:r></w:p>`,
  `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200"/><w:jc w:val="both"/></w:pPr><w:r><w:t>第一段正文</w:t></w:r></w:p>`,
  `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200"/><w:jc w:val="both"/></w:pPr><w:r><w:t>第二段正文</w:t></w:r></w:p>`,
];

/** 外部 Word 模板形态的 styles.xml:Normal 带 rPr(覆盖 docDefaults)与 pPr */
const EXTERNAL_STYLES_XML = `<?xml version="1.0"?>
<w:styles ${W}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:eastAsia="微软雅黑"/>
      <w:sz w:val="22"/>
    </w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr>
    <w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200"/><w:jc w:val="both"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="44"/></w:rPr>
  </w:style>
</w:styles>`;

/** 外部模板形态的正文:段落不带 pPr(属性全继承自 Normal) */
const EXTERNAL_BODY_XML = [
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>一级标题</w:t></w:r></w:p>`,
  `<w:p><w:r><w:t>第一段正文</w:t></w:r></w:p>`,
  `<w:p><w:r><w:t>第二段正文</w:t></w:r></w:p>`,
];

/** 恒在的「本仓不接」六类(能力边界声明):单源在 core/docx/template-fields.ts(界面层也取这一份) */
const ALWAYS_UNMAPPED = ALWAYS_UNMAPPED_TEMPLATE_FIELDS;

/**
 * 取成功态的导入结果:失败态直接抛错(用例走到这里本就期望成功)。
 *
 * 为什么需要它:导入结果是**可判别的联合**(ok / unreadable),判别式收窄要在
 * TS 里显式做一次 —— 不收窄就读不到 typography / pageSetup。
 *
 * @param {Awaited<ReturnType<typeof importDocxTemplate>>} result 导入结果
 * @returns {Extract<Awaited<ReturnType<typeof importDocxTemplate>>, { status: "ok" }>} 成功态结果
 */
function okResult(result) {
  if (result.status !== "ok") {
    throw new Error(`导入应成功,实得 ${result.status}`);
  }
  return result;
}

export const meta = {
  description:
    "docx 模板导入(字段级深导入)测试:继承链取值 + 排版/页面字段映射 + 两类未映射划分 + 失败态",
};
export const fixtures = { main: OWN_STYLES_XML };

export async function run() {
  const suite = createCaseSuite();

  /* ---------- 案例 1:自家稿形态(无 Normal,正文属性在 docDefaults + 段落级) ---------- */
  const own = okResult(await importDocxTemplate(
    new Uint8Array(
      await buildDocx({
        "word/styles.xml": OWN_STYLES_XML,
        "word/document.xml": docXml(OWN_BODY_XML, 11906, 16838, 1440),
      }),
    ),
  ));
  await suite.case("案例1 正文字体取 docDefaults(自家稿没有 Normal 样式)", () => {
    assert(
      own.typography.fontAscii === "Calibri",
      `西文字体应为 Calibri,实得 ${own.typography.fontAscii}`,
    );
    assert(
      own.typography.fontEastAsia === "微软雅黑",
      `中文字体应为 微软雅黑,实得 ${own.typography.fontEastAsia}`,
    );
  });
  await suite.case("案例1 正文字号取 docDefaults 的 24 半点 → 12pt", () => {
    assert(
      own.typography.bodySizePt === 12,
      `正文字号应为 12pt,实得 ${own.typography.bodySizePt}`,
    );
  });
  await suite.case("案例1 行距取段落级 w:line=360/auto → 1.5 倍", () => {
    assert(
      own.typography.lineSpacing === 1.5,
      `行距应为 1.5,实得 ${own.typography.lineSpacing}`,
    );
  });
  await suite.case("案例1 首行缩进取 w:firstLineChars=200 → true", () => {
    assert(
      own.typography.firstLineIndent === true,
      `首行缩进应为 true,实得 ${own.typography.firstLineIndent}`,
    );
  });
  await suite.case("案例1 对齐取 w:jc=both → justify(众数,不吃目录题的 center)", () => {
    assert(
      own.typography.align === "justify",
      `对齐应为 justify,实得 ${own.typography.align}`,
    );
  });
  await suite.case("案例1 标题字号档位:段落级 run 的 22pt/正文 12pt → standard", () => {
    assert(
      own.typography.headingScale === "standard",
      `标题字号档位应为 standard,实得 ${own.typography.headingScale}`,
    );
  });
  await suite.case("案例1 标题间距档位:段前 0 / 段后 12pt → standard", () => {
    assert(
      own.typography.headingSpacing === "standard",
      `标题间距档位应为 standard,实得 ${own.typography.headingSpacing}`,
    );
  });
  await suite.case("案例1 页面:纵向 A4 + 四边 25.4mm", () => {
    assert(own.pageSetup.paper === "A4", `纸张应为 A4,实得 ${own.pageSetup.paper}`);
    assert(
      own.pageSetup.orientation === "portrait",
      `朝向应为 portrait,实得 ${own.pageSetup.orientation}`,
    );
    const keys = /** @type {("marginTop" | "marginBottom" | "marginLeft" | "marginRight")[]} */ ([
      "marginTop",
      "marginBottom",
      "marginLeft",
      "marginRight",
    ]);
    for (const key of keys) {
      const value = /** @type {number} */ (own.pageSetup[key]);
      assert(
        Math.abs(value - 25.4) < 0.2,
        `边距 ${key} 应为 ~25.4mm,实得 ${value}`,
      );
    }
  });
  await suite.case("案例1 未映射清单只含恒在的六类(本仓不接的项)", () => {
    const list = own.unmapped.join(",");
    assert(
      list === ALWAYS_UNMAPPED.join(","),
      `未映射清单应为 [${ALWAYS_UNMAPPED.join(",")}],实得 [${list}]`,
    );
  });

  /* ---------- 案例 2:外部 Word 模板形态(Normal 带 rPr,覆盖 docDefaults) ---------- */
  const external = okResult(await importDocxTemplate(
    new Uint8Array(
      await buildDocx({
        "word/styles.xml": EXTERNAL_STYLES_XML,
        "word/document.xml": docXml(EXTERNAL_BODY_XML, 11906, 16838, 1440),
      }),
    ),
  ));
  await suite.case("案例2 字体取 Normal(不是 docDefaults 的 Calibri)", () => {
    assert(
      external.typography.fontAscii === "Times New Roman",
      `西文字体应为 Times New Roman,实得 ${external.typography.fontAscii}`,
    );
    assert(
      external.typography.fontEastAsia === "宋体",
      `中文字体应为 宋体,实得 ${external.typography.fontEastAsia}`,
    );
  });
  await suite.case("案例2 正文字号取 Normal 的 24 半点(docDefaults 的 22 半点被覆盖)", () => {
    assert(
      external.typography.bodySizePt === 12,
      `正文字号应为 12pt,实得 ${external.typography.bodySizePt}`,
    );
  });
  await suite.case("案例2 段落属性回落 Normal 的 pPr(文档段落没写)", () => {
    assert(
      external.typography.lineSpacing === 1.5,
      `行距应为 1.5,实得 ${external.typography.lineSpacing}`,
    );
    assert(
      external.typography.firstLineIndent === true,
      `首行缩进应为 true,实得 ${external.typography.firstLineIndent}`,
    );
    assert(
      external.typography.align === "justify",
      `对齐应为 justify,实得 ${external.typography.align}`,
    );
  });
  await suite.case("案例2 标题档位按段落级 run 的 22pt/正文 12pt → standard", () => {
    assert(
      external.typography.headingScale === "standard",
      `标题字号档位应为 standard,实得 ${external.typography.headingScale}`,
    );
    assert(
      external.typography.headingSpacing === "standard",
      `标题间距档位应为 standard,实得 ${external.typography.headingSpacing}`,
    );
  });

  /* ---------- 案例 3:横向 Letter(宽高对调)+ 12.7mm 边距 ---------- */
  const letter = okResult(await importDocxTemplate(
    new Uint8Array(
      await buildDocx({
        "word/styles.xml": OWN_STYLES_XML,
        "word/document.xml": docXml(OWN_BODY_XML, 15840, 12240, 720),
      }),
    ),
  ));
  await suite.case("案例3 纸张识别为 Letter 且朝为 landscape", () => {
    assert(letter.pageSetup.paper === "Letter", `纸张应为 Letter,实得 ${letter.pageSetup.paper}`);
    assert(
      letter.pageSetup.orientation === "landscape",
      `朝向应为 landscape,实得 ${letter.pageSetup.orientation}`,
    );
    assert(
      Math.abs(/** @type {number} */ (letter.pageSetup.marginTop) - 12.7) < 0.2,
      `边距应为 ~12.7mm,实得 ${letter.pageSetup.marginTop}`,
    );
  });

  /* ---------- 案例 4:边界项各进「未映射」 ---------- */
  const edgeStyles = `<?xml version="1.0"?>
<w:styles ${W}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="60"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
</w:styles>`;
  const edgeBody = [
    `<w:p><w:pPr><w:spacing w:line="600" w:lineRule="exact"/><w:jc w:val="center"/></w:pPr><w:r><w:t>正文</w:t></w:r></w:p>`,
  ];
  const edge = okResult(await importDocxTemplate(
    new Uint8Array(
      await buildDocx({
        "word/styles.xml": edgeStyles,
        "word/document.xml": docXml(edgeBody, 10000, 10000, 1440),
      }),
    ),
  ));
  await suite.case("案例4 越界/判不出的项逐条进未映射清单", () => {
    const expected = [
      ...ALWAYS_UNMAPPED,
      "bodySizeOutOfRange",
      "lineSpacingRule",
      "alignUnsupported",
      "headingScaleUndetermined",
      "headingSpacingUndetermined",
      "paperUnrecognized",
    ];
    const actual = edge.unmapped.join(",");
    assert(
      actual === expected.join(","),
      `未映射清单应为 [${expected.join(",")}],实得 [${actual}]`,
    );
  });
  await suite.case("案例4 越界项不吃进设置(字号/纸张/对齐保持未映射)", () => {
    assert(edge.typography.bodySizePt === undefined, `正文字号不应被映射,实得 ${edge.typography.bodySizePt}`);
    assert(edge.pageSetup.paper === undefined, `纸张不应被映射,实得 ${edge.pageSetup.paper}`);
    assert(edge.typography.align === undefined, `对齐不应被映射,实得 ${edge.typography.align}`);
    assert(edge.typography.lineSpacing === undefined, `行距不应被映射,实得 ${edge.typography.lineSpacing}`);
    assert(
      edge.typography.headingScale === undefined,
      `标题字号档位不应被映射,实得 ${edge.typography.headingScale}`,
    );
  });
  await suite.case("案例4 纸张未识别时朝向与边距仍映射", () => {
    assert(
      edge.pageSetup.orientation === "portrait",
      `朝向应为 portrait,实得 ${edge.pageSetup.orientation}`,
    );
    assert(
      Math.abs(/** @type {number} */ (edge.pageSetup.marginLeft) - 25.4) < 0.2,
      `边距应为 ~25.4mm,实得 ${edge.pageSetup.marginLeft}`,
    );
  });

  /* ---------- 案例 5:主题引用字体(经 theme 部件解引用) ---------- */
  const themeStyles = `<?xml version="1.0"?>
<w:styles ${W}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia"/>
    </w:rPr></w:rPrDefault>
  </w:docDefaults>
</w:styles>`;
  const themeXml = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements>
    <a:fontScheme>
      <a:majorFont><a:latin typeface="Cambria"/><a:ea typeface="黑体"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="宋体"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;
  const themed = okResult(await importDocxTemplate(
    new Uint8Array(
      await buildDocx({
        "word/styles.xml": themeStyles,
        "word/theme/theme1.xml": themeXml,
        "word/document.xml": docXml(OWN_BODY_XML, 11906, 16838, 1440),
      }),
    ),
  ));
  await suite.case("案例5 主题引用解成主题字体(major 的 latin / ea)", () => {
    assert(
      themed.typography.fontAscii === "Cambria",
      `西文字体应为 Cambria,实得 ${themed.typography.fontAscii}`,
    );
    assert(
      themed.typography.fontEastAsia === "黑体",
      `中文字体应为 黑体,实得 ${themed.typography.fontEastAsia}`,
    );
  });

  /* ---------- 案例 6:非 docx / 损坏输入 ⇒ **失败态**(不是「成功但空」) ---------- */
  const broken = await importDocxTemplate(new Uint8Array([1, 2, 3, 4, 5]));
  await suite.case("案例6 非 docx 字节 ⇒ 失败态 status=unreadable(不谎报成功)", () => {
    assert(
      broken.status === "unreadable",
      `非 docx 必须返回可区分的失败态,实得 ${broken.status}`,
    );
  });
  await suite.case("案例6 失败态不与「成功但没吃下东西」同形(无空清单可混淆)", () => {
    assert(
      !("unmapped" in broken),
      `失败态不应带未映射清单(空清单是「成功」的信号),实得 ${JSON.stringify(broken)}`,
    );
  });

  /* ---------- 案例 6b:是 zip 但不是 docx(改了扩展名的 zip / odt) ⇒ 同样失败态 ---------- */
  // 为什么单列:能解开 zip 只证明「是个 zip」,不证明「是 Word 文档」;主文档部件缺失
  // 时若按「成功但没吃下东西」处理,用户会看到「已应用」却什么都没导入(谎报成功)。
  const zipButNotDocx = await importDocxTemplate(
    new Uint8Array(
      await buildDocx({
        "word/styles.xml": `<?xml version="1.0"?>\n<w:styles ${W}></w:styles>`,
      }),
    ),
  );
  await suite.case("案例6b 是 zip 但无 word/document.xml ⇒ 失败态(不谎报成功)", () => {
    assert(
      zipButNotDocx.status === "unreadable",
      `缺主文档部件必须返回可区分的失败态,实得 ${zipButNotDocx.status}`,
    );
  });

  /* ---------- 案例 7:合法 docx 但没有可映射字段 ⇒ 仍是成功(空结果 ≠ 失败) ---------- */
  const blank = okResult(await importDocxTemplate(
    new Uint8Array(
      await buildDocx({
        "word/styles.xml": `<?xml version="1.0"?>\n<w:styles ${W}></w:styles>`,
        "word/document.xml": `<?xml version="1.0"?>\n<w:document ${W}><w:body></w:body></w:document>`,
      }),
    ),
  ));
  await suite.case("案例7 合法 docx 但无可映射字段 ⇒ status=ok(空结果仍是成功)", () => {
    assert(blank.status === "ok", `合法 docx 必须是成功态,实得 ${blank.status}`);
    assert(
      Object.keys(blank.typography).length === 0,
      `无正文属性时不应有排版映射,实得 ${JSON.stringify(blank.typography)}`,
    );
    assert(
      Object.keys(blank.pageSetup).length === 0,
      `无节属性时不应有页面映射,实得 ${JSON.stringify(blank.pageSetup)}`,
    );
  });
  await suite.case("案例7 空结果的未映射清单仍带六类能力边界(恒在)", () => {
    const head = blank.unmapped.slice(0, ALWAYS_UNMAPPED.length).join(",");
    assert(
      head === ALWAYS_UNMAPPED.join(","),
      `未映射清单前六项应为能力边界六类,实得 [${head}]`,
    );
  });

  /* ---------- 案例 8:两类「未映射」在 core 侧分得开(能力边界 ≠ 本次诊断) ---------- */
  await suite.case("案例8 能力边界六类恒定且顺序固定", () => {
    assert(
      ALWAYS_UNMAPPED_TEMPLATE_FIELDS.join(",") ===
        "color,themeColor,numbering,settingsCompat,characterStyle,latentStyles",
      `能力边界六类应为固定六项,实得 [${ALWAYS_UNMAPPED_TEMPLATE_FIELDS.join(",")}]`,
    );
  });
  await suite.case("案例8 六类不判成事实性(界面据此分开呈现)", () => {
    for (const field of ALWAYS_UNMAPPED_TEMPLATE_FIELDS) {
      // 六类在类型上就属「恒不映射」,问「是不是事实性」答案恒为 false —— 这里把该边界锁住
      const asUnmapped = /** @type {UnmappedTemplateField} */ (field);
      assert(
        !isFactualUnmappedTemplateField(asUnmapped),
        `${field} 属能力边界,不该被判成事实性未映射`,
      );
    }
  });
  await suite.case("案例8 事实性七类全判成事实性(经 IPC 上来的只有这些)", () => {
    assert(
      FACTUAL_UNMAPPED_TEMPLATE_FIELDS.join(",") ===
        "bodySizeOutOfRange,lineSpacingRule,lineSpacingOutOfRange,alignUnsupported,headingScaleUndetermined,headingSpacingUndetermined,paperUnrecognized",
      `事实性类别应为固定七项,实得 [${FACTUAL_UNMAPPED_TEMPLATE_FIELDS.join(",")}]`,
    );
    for (const field of FACTUAL_UNMAPPED_TEMPLATE_FIELDS) {
      assert(
        isFactualUnmappedTemplateField(field),
        `${field} 属本次模板的事实性问题,应判成事实性未映射`,
      );
    }
  });
  await suite.case("案例8 两类不重叠(能力边界与事实性互斥)", () => {
    /** @type {Set<string>} */
    const factual = new Set(FACTUAL_UNMAPPED_TEMPLATE_FIELDS);
    for (const field of ALWAYS_UNMAPPED_TEMPLATE_FIELDS) {
      assert(!factual.has(field), `${field} 不该同时出现在两类里`);
    }
  });

  console.log(
    "[ok] 模板导入(adr-086) 字段级深导入:继承链 + 排版/页面字段 + 两类未映射 + 失败态 断言通过",
  );
  return { cases: suite.results };
}
