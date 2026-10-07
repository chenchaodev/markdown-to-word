// @ts-check
/**
 * 渲染选项默认值解析验收(adr-030 6-D1 与 6-D2 配套的「逐键断言」半边)。
 *
 * 为什么单独一段而不是并进双管线矩阵:矩阵守的是**双侧语义是否一致**,本段守的是
 * **默认值只有一处来源**。两件事的判据不同 —— 矩阵允许两侧默认值不同(那是
 * allowedDiff 的登记对象),本段不允许任何一侧自己写默认值。
 *
 * 为什么必须有这一段(6-D2 单独做无效的实证依据):类型系统对可选字段**没有
 * 默认值检查**。交叉继承只让 JSDoc 单源,漏传一个开关既不报错也不留痕,只静默
 * 用默认值 —— 与 6-B2/6-B3 关掉的「设置项在一侧静默失效」是同一类病。唯有把
 * 「每个键在两侧都解析成什么」写成可执行断言,这个洞才被堵住。
 *
 * 覆盖:resolveRenderSwitches 的 8 个键 + resolveHeaderFooter / resolveTocMode,
 * 逐键断言「空输入 → 期望默认值」与「显式值 → 原样透传」,并断言两侧渲染层
 * 确实经这个函数(源码级:渲染层里不得再出现 `options.X ?? 字面量` 形态)。
 */
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_HEADER_FOOTER,
  DEFAULT_PAGE_SETUP,
  DEFAULT_WATERMARK,
} from "../../dist/core/settings/settings-defaults.js";
import { DEFAULT_TYPOGRAPHY } from "../../dist/core/settings/typography.js";
import {
  DEFAULT_TOC_MODE,
  resolveHeaderFooter,
  resolveRenderSwitches,
  resolveTocMode,
} from "../../dist/core/settings/render-options.js";
import { asDocxArtifact, asPdfArtifact, HOST_FS, prepareForConvert } from "../harness/convert-helpers.js";
import { ROOT } from "../harness/paths.js";
import { createAsserter } from "../harness/assert.js";

/** 契约类型的只读引用(编译期擦除) */
/** @typedef {import("../../dist/core/i18n/index.js").ConvertWarning} Warning */

export const meta = {
  description: "渲染选项默认值解析:逐键断言 8 个共有开关 + 页眉页脚 + 目录模式,且两侧渲染层不再自带默认值字面量",
};
// 本段无验收样例:断言对象是默认值解析函数与其调用点,不是某份 markdown 的产物
export const fixtures = null;

const { assert } = createAsserter("render-defaults");

/**
 * 逐键深比较(不用 JSON.stringify 比字符串:键序不同的两个同值对象会被误判为不等)。
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @returns {boolean} 是否逐键相等
 */
function deepEqual(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/** 显式值透传用的 typography:与 DEFAULT_TYPOGRAPHY 每一项都不同
 *  (align 是字面量联合,裸对象字面量会推成 string 而与 TypographySettings 不兼容
 *   —— 整对象标注一次即可,不必逐字段断言) */
/** @type {import("../../dist/core/settings/typography.js").TypographySettings} */
const EXPLICIT_TYPOGRAPHY = {
  ...DEFAULT_TYPOGRAPHY,
  fontAscii: "Consolas",
  fontEastAsia: "宋体",
  bodySizePt: 15,
  lineSpacing: 2.0,
  firstLineIndent: false,
  align: "left",
  headingNumbering: false,
  captionNumbering: false,
};

/** 期望的默认值表(逐键写死:这是「默认值是什么」的可执行定义) */
const EXPECTED_DEFAULTS = {
  pageSetup: DEFAULT_PAGE_SETUP,
  typography: DEFAULT_TYPOGRAPHY,
  breakBeforeH1: false,
  headingNumbering: DEFAULT_TYPOGRAPHY.headingNumbering,
  captionNumbering: DEFAULT_TYPOGRAPHY.captionNumbering,
  toc: true,
  equationNumbering: true,
  watermark: DEFAULT_WATERMARK,
};

export async function run() {
  // ---- 1. 空输入:8 个键逐键落回期望默认值 ----
  const empty = resolveRenderSwitches({});
  // EXPECTED_DEFAULTS 的键是动态的(`Object.entries` 出 string),而 ResolvedRenderSwitches
  // 是 interface(无隐式索引签名),故经 unknown 取 Record 视图后按键取值。
  // 为什么走 unknown 中转:interface 不能直接断言成 Record<string, unknown>(两者无足够重叠),
  // 而 unknown 中转不会丢检查 —— 断言目标仍是 Record<string, unknown>。
  const emptyView = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (empty));
  for (const [key, expected] of Object.entries(EXPECTED_DEFAULTS)) {
    assert(
      deepEqual(emptyView[key], expected),
      `空输入时 ${key} 应解析为默认值(实际 ${JSON.stringify(emptyView[key])})`,
    );
  }
  // 键集合本身也要锁:新增键忘了在此登记即判红(默认值台账的机械化守卫)
  assert(
    Object.keys(empty).sort().join(",") === Object.keys(EXPECTED_DEFAULTS).sort().join(","),
    `resolveRenderSwitches 的键集合应与逐键断言表一致(实际 ${Object.keys(empty).sort().join(",")})`,
  );

  // ---- 2. 空输入 + 关掉 typography 里的两个编号开关:那两个键应跟随 typography ----
  // 这一条单独断言的原因:headingNumbering/captionNumbering 的默认值**不是字面量**
  // 而是 typography 的同名键,「逐键断言默认值」若只断言结果值,发现不了「改成硬编码
  // true」这类改动 —— 故同时断言来源。
  const withTypo = resolveRenderSwitches({ typography: { ...DEFAULT_TYPOGRAPHY, headingNumbering: false, captionNumbering: false } });
  assert(withTypo.headingNumbering === false, "headingNumbering 应跟随 typography.headingNumbering");
  assert(withTypo.captionNumbering === false, "captionNumbering 应跟随 typography.captionNumbering");

  // ---- 3. 显式值逐键原样透传(含优先级:显式项压过 typography) ----
  const explicit = resolveRenderSwitches({
    pageSetup: { ...DEFAULT_PAGE_SETUP, paper: "A5" },
    typography: EXPLICIT_TYPOGRAPHY,
    breakBeforeH1: true,
    headingNumbering: true, // 显式压过 EXPLICIT_TYPOGRAPHY 的 false
    captionNumbering: true,
    toc: false,
    equationNumbering: false,
    watermark: { ...DEFAULT_WATERMARK, text: "机密" },
  });
  assert(explicit.pageSetup.paper === "A5", "pageSetup 显式值应原样透传");
  assert(explicit.typography === EXPLICIT_TYPOGRAPHY, "typography 显式值应原样透传");
  assert(explicit.breakBeforeH1 === true, "breakBeforeH1 显式值应原样透传");
  assert(explicit.headingNumbering === true, "headingNumbering 显式项应压过 typography");
  assert(explicit.captionNumbering === true, "captionNumbering 显式项应压过 typography");
  assert(explicit.toc === false, "toc 显式值应原样透传");
  assert(explicit.equationNumbering === false, "equationNumbering 显式值应原样透传");
  assert(explicit.watermark.text === "机密", "watermark 显式值应原样透传");

  // ---- 4. 水印的部分字段:缺省字段补默认,给定字段不被覆盖 ----
  // 契约上 SharedRenderOptions.watermark 是 WatermarkSettings(四字段全必填),
  // 而本用例要测的正是 resolveRenderSwitches 里 `{ ...DEFAULT_WATERMARK, ...x }`
  // 那一层的「缺省补默认」—— 局部缺字段是被测行为,不是夹具写错。
  // 处置沿用本文件下方 resolveHeaderFooter 同一口径(never 中转):只放宽这一个
  // 「局部缺字段」事实,不打穿其他检查。
  const partial = resolveRenderSwitches({
    watermark: /** @type {never} */ ({ text: "仅文字" }),
  });
  assert(partial.watermark.text === "仅文字", "水印给定字段应保留");
  assert(
    partial.watermark.angle === DEFAULT_WATERMARK.angle,
    `水印缺省角度应补 ${DEFAULT_WATERMARK.angle}`,
  );
  assert(
    partial.watermark.opacity === DEFAULT_WATERMARK.opacity,
    `水印缺省不透明度应补 ${DEFAULT_WATERMARK.opacity}`,
  );
  assert(partial.watermark.gray === DEFAULT_WATERMARK.gray, "水印缺省配色应补默认值");

  // ---- 5. 页眉页脚与目录模式的解析单源 ----
  const hf = resolveHeaderFooter(undefined);
  assert(deepEqual(hf, DEFAULT_HEADER_FOOTER), "页眉页脚缺省应等于 DEFAULT_HEADER_FOOTER");
  const hfPartial = resolveHeaderFooter(/** @type {never} */ ({ headerMode: "none" }));
  assert(hfPartial.headerMode === "none", "页眉页脚显式字段应保留");
  assert(
    hfPartial.headerText === DEFAULT_HEADER_FOOTER.headerText,
    "页眉页脚缺省字段应补默认",
  );
  assert(resolveTocMode(undefined) === DEFAULT_TOC_MODE, `目录模式缺省应为 ${DEFAULT_TOC_MODE}`);
  assert(resolveTocMode("field") === "field", "目录模式显式值应原样透传");

  // ---- 6. 两侧渲染层不再自带默认值字面量(源码级守护) ----
  // 这是 6-D1 的真正约束:解析收进一个纯函数之后,渲染层里若还留着
  // `options.X ?? 字面量`,就等于默认值又有了第二个来源,而类型系统不会报。
  for (const relPath of ["src/core/docx/render.ts", "src/core/pdf/render.ts", "src/core/convert.ts"]) {
    const src = fs.readFileSync(path.join(ROOT, relPath), "utf8");
    // 去掉注释行再看:注释里允许讨论默认值(它们解释的正是这个约定)
    const code = src
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("/*"))
      .join("\n");
    for (const opt of [
      "breakBeforeH1",
      "headingNumbering",
      "captionNumbering",
      "equationNumbering",
      "tocMode",
      "headerFooter",
      "watermark",
    ]) {
      assert(
        !new RegExp(`options\\.${opt}\\s*\\?\\?`).test(code),
        `${relPath} 仍出现 options.${opt} ?? ... —— 默认值解析应统一走 resolveRenderSwitches/resolveHeaderFooter/resolveTocMode`,
      );
    }
    // 显式解构后的本地变量( switches.toc 等)不算,只拦「直接读 options 再兜默认」
    assert(
      !/context\.(headerFooter|watermark|tocMode)\s*\?\?/.test(code),
      `${relPath} 仍出现 context.X ?? ... —— convert 层的默认补全也应走 render-options 单源`,
    );
  }

  // ---- 7. 产物级:两侧在「不传任何开关」时产出的形态一致(证明默认值真的一致) ----
  // 类型层断言到此为止;这一条补上「默认值在两侧真的落到产物里」的可执行事实。
  const { convert } = await import("../../dist/core/convert.js");
  const { unzipPart } = await import("../harness/docx-utils.js");
  const md = "# 默认值样例\n\n正文一段。\n\n$$\nE = mc^2\n$$\n";
  const docx = asDocxArtifact(await convert(prepareForConvert(md), "docx", { fs: HOST_FS, baseDir: ROOT, warnings: [], title: "标题" }));
  const pdf = asPdfArtifact(await convert(prepareForConvert(md), "pdf", { fs: HOST_FS, baseDir: ROOT, title: "标题", warnings: [] }));
  // docx 断言必须解包:zip 内条目是 deflate 压缩的,裸 buffer 扫不出 XML 文本
  // (裸扫只有部件名可见 —— 那正是 docx-utils.zipContains 唯一能判的事)
  const docxXml = await unzipPart(docx.buffer, "word/document.xml");
  // breakBeforeH1 缺省 false → 两侧都不分页;toc 缺省 true → 两侧都出目录
  assert(!docxXml.includes("<w:pageBreakBefore/>"), "docx 缺省不应有 h1 前分页");
  assert(!pdf.html.includes("h1 { break-before: page; }"), "PDF 缺省不应有 h1 前分页");
  assert(docxXml.includes('w:dirty="false"'), "docx 缺省 toc=true 应出静态目录(dirty=false)");
  assert(pdf.html.includes('<li class="toc-l1">'), "PDF 缺省 toc=true 应出目录");
  // equationNumbering 缺省 true → 两侧都编号
  assert(docxXml.includes("<m:oMath"), "docx 缺省应输出公式 MathML");
  assert(pdf.html.includes('class="eq-num"'), "PDF 缺省应输出公式编号");
  // watermark 缺省 text 空 → 两侧都零渲染
  assert(!docxXml.includes("wps:wsp"), "docx 缺省水印应零渲染");
  assert(!pdf.html.includes('class="wm"'), "PDF 缺省水印应零渲染");
  // headerFooter 缺省 default + 有标题 → 两侧都出「文档标题」页眉(6-B3 统一后的形态)
  const headerXml = await unzipPart(docx.buffer, "word/header1.xml");
  assert(headerXml.includes("标题"), "docx 缺省页眉应含文档标题");
  assert(headerXml.includes('<w:jc w:val="center"/>'), "docx 缺省页眉应居中");
  assert(pdf.headerTemplate.includes("标题"), "PDF 缺省页眉应含文档标题(与 docx 同口径)");
  assert(pdf.footerTemplate.includes("pageNumber"), "PDF 缺省应有页码页脚");

  console.log(
    "[ok] render-defaults:8 个共有开关 + 页眉页脚 + 目录模式逐键默认值断言通过,两侧渲染层无自带默认值字面量",
  );
}
