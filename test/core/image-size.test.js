// @ts-check
/**
 * 图片控制增强段:Pandoc 风格尾随尺寸属性 + figure 题注绑定。
 * 覆盖五类断言(零注册):
 * (a) 语法解析纯函数直测(core/image/image-size.ts:词法/校验范围/边界);
 * (b) docx 产物断言(EMU 尺寸换算 / figure 居中 jc / 属性文本剥除);
 * (c) pdf 产物断言(style 注入 / fig-image 类 / 属性文本剥除);
 * (d) 非法值警告断言(keyed 警告 zh/en 双语言 + 默认尺寸降级);
 * (e) 无属性回归断言(scaleToFit 行为不变 / 行内图片不居中)+ 题注绑定
 *     (「图: xxx」前缀行保持在图下方,编号机制不变)。
 * 百分比语义:相对正文内容宽度(A4 纵向默认边距下 = 210 − 32×2 = 146mm;
 * docx 换算链 mm→twips→px(96dpi)、pdf 换算链 mm→px,期望值经同一契约函数计算)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseMarkdown } from "../../dist/core/pipeline/parse.js";
import { renderDocx } from "../../dist/core/docx/render.js";
import { formatWarning, setLanguage } from "../../dist/core/i18n/index.js";
import {
  parseImageSizeAttrs,
  parseImageDim,
  resolveImageDisplaySize,
  isFigureParagraph,
  IMAGE_SIZE_PX_MAX,
  IMAGE_SIZE_PERCENT_MAX,
} from "../../dist/core/image/image-size.js";
import {
  DEFAULT_PAGE_SETUP,
  PAPER_SIZES_MM,
  mmToTwips,
  twipsToPx,
  mmToPx,
} from "../../dist/core/settings/settings-defaults.js";
import { FIXTURES_DIR } from "../harness/paths.js";
import { unzipPart } from "../harness/docx-utils.js";
import { saveArtifact } from "../harness/artifacts.js";
import { asDocxArtifact, asPdfArtifact, convertWithFs } from "../harness/convert-helpers.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

/** @typedef {import("../../dist/core/i18n/index.js").ConvertWarning} Warning */
/** @typedef {import("../../dist/core/i18n/index.js").KeyedWarning} KeyedWarning */
/** @typedef {import("../../dist/core/image/image-size.js").ImageSizeAttrs} ImageSizeAttrs */

// convertTyped = 共享包装 convertWithFs(= dist 的 convert 注入宿主文件系统能力 fs)。
// 运行期与渲染行为不变;此前在此手写返回类型是因为 dist 不带 .d.ts,
// ADR-069 起产物已自带声明,故直接用之。
const convertTyped = convertWithFs;

const { assert: harnessAssert } = createAsserter("image-size");

/**
 * 窄化壳:harness 的 assert 刻意不声明 `asserts cond`(TS2775 禁从解构模式调断言函数),
 * 而本段下游依赖收窄 ⇒ 这里保留一层带窄化签名的壳,函数体只委派、不自带判定逻辑。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败说明
 * @returns {asserts cond} 条件不成立即抛错(供后续行收窄)
 */
function assert(cond, msg) {
  harnessAssert(cond, msg);
}

/**
 * 取 markdown 首段的 phrasing children(本段只判定「图片是否独立成段」)。
 *
 * 返回类型即 isFigureParagraph 的入参形状 `readonly { type; value? }[]` —— 该函数
 * 只读这两项(见 src/core/image/image-size.ts),与 mdast 的 PhrasingContent 兼容:
 * 每个 mdast 节点都有 `type: string`,`value` 仅 Literal 子类有、其余为可选缺失。
 * @param {string} md markdown 源(单段样例)
 * @returns {readonly { type: string; value?: string }[]} 首段 children
 */
function firstParagraphChildren(md) {
  const first = parseMarkdown(md).children[0];
  if (first === undefined || !("children" in first)) {
    throw new Error(`image-size 断言失败:样例首块应为段落,实际 ${first === undefined ? "无内容" : first.type}`);
  }
  return /** @type {readonly { type: string; value?: string }[]} */ (first.children);
}

/** 内容区宽(px)契约值:A4 纵向默认边距(docx 与 pdf 各自换算链同源验证用) */
// paper 的类型由产物声明给出(PageSetup["paper"]),已是 PAPER_SIZES_MM 的键,直接索引
const CONTENT_WIDTH_MM =
  PAPER_SIZES_MM[DEFAULT_PAGE_SETUP.paper].width -
  DEFAULT_PAGE_SETUP.marginLeft -
  DEFAULT_PAGE_SETUP.marginRight; // 146mm
const DOCX_CONTENT_WIDTH_PX = twipsToPx(mmToTwips(CONTENT_WIDTH_MM)); // 8277/15 ≈ 551.8
const PDF_CONTENT_WIDTH_PX = mmToPx(CONTENT_WIDTH_MM); // ≈ 551.81

/**
 * px → EMU(docx 库序列化契约:1px = 9525 EMU)。
 * @param {number} px 像素值
 * @returns {number} EMU 值
 */
const emu = (px) => px * 9525;

/** 测试用 resolver:fixtures 目录下的本地图片可读,其余失败 */
const resolver = async (/** @type {string} */ src) => {
  if (src.startsWith("http")) return null;
  try {
    return await fs.readFile(path.resolve(FIXTURES_DIR, src));
  } catch {
    return null;
  }
};

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  // ================= (a) 语法解析纯函数直测 =================
  // 合法:百分比 / 像素 / 组合 / 宽容空白 / 小数
  await suite.case("(a) 合法属性:百分比 / 像素 / 组合 / 空白小数 / 键名大小写", () => {
    assert(parseImageSizeAttrs("{width=50%}").attrs.width?.unit === "%", "{width=50%} 应解析为 %");
    assert(parseImageSizeAttrs("{width=300}").attrs.width?.unit === "px", "{width=300} 应解析为 px");
    const combo = parseImageSizeAttrs("{width=50% height=30%}");
    assert(combo.attrs.width?.value === 50 && combo.attrs.height?.value === 30, "组合属性应双维解析");
    assert(parseImageSizeAttrs("{ width = 12.5 }").attrs.width?.value === 12.5, "空白与小数应容忍");
    assert(parseImageSizeAttrs("{WIDTH=50%}").attrs.width?.value === 50, "键名大小写归一");
  });
  // 非法:负数 / 非数值 / 超范围 / 零
  await suite.case("(a) 非法属性逐形态判非法并产出一条 invalid 记录", () => {
    for (const bad of ["{width=-3}", "{height=abc}", "{width=150%}", "{width=0}", `{width=${IMAGE_SIZE_PX_MAX + 1}}`]) {
      const parsed = parseImageSizeAttrs(bad);
      assert(parsed.hasSizeKeys && Object.keys(parsed.attrs).length === 0, `${bad} 应判非法且无合法维度`);
      assert(parsed.invalid.length === 1, `${bad} 应产出一条 invalid 记录`);
    }
    assert(IMAGE_SIZE_PERCENT_MAX === 100, "百分比上限应为 100");
  });
  // 边界:非属性块 / 无尺寸键花括号文本原样保留(hasSizeKeys=false 不剥除)
  await suite.case("(a) 非属性块不识别;未知键静默忽略", () => {
    assert(!parseImageSizeAttrs("普通文本").hasSizeKeys, "普通文本不应识别为属性块");
    assert(!parseImageSizeAttrs("{}").hasSizeKeys, "空花括号不应识别(hasSizeKeys=false)");
    assert(!parseImageSizeAttrs("{foo=bar}").hasSizeKeys, "无尺寸键的花括号文本不应识别");
    assert(parseImageSizeAttrs("{width=50% #id}").invalid.length === 0, "未知键静默忽略不告警");
  });
  // parseImageDim 边界直测
  await suite.case("(a) parseImageDim 词法边界:小数合法、负数与科学计数法非法", () => {
    assert(parseImageDim("99.9%")?.value === 99.9, "小数百分比应合法");
    assert(parseImageDim("-5") === null, "负数应非法");
    assert(parseImageDim("1e3") === null, "科学计数法应非法(词法不含 e)");
  });
  // resolveImageDisplaySize:一维等比 / 两维不保持比例 / 百分比基准
  // (入参/返回值类型均由产物声明给出,此处不再手写标注)
  await suite.case("(a) resolveImageDisplaySize:一维等比缩放", () => {
    const disp = resolveImageDisplaySize(
      { width: 800, height: 400 },
      { width: { unit: "px", value: 200 } },
      500,
    );
    assert(disp.width === 200 && disp.height === 100, "只给宽应按原图比例缩高");
  });
  await suite.case("(a) resolveImageDisplaySize:两维都给不保持比例(Pandoc 一致)", () => {
    const disp2 = resolveImageDisplaySize(
      { width: 800, height: 400 },
      { width: { unit: "px", value: 200 }, height: { unit: "px", value: 300 } },
      500,
    );
    assert(disp2.width === 200 && disp2.height === 300, "两维都给不保持比例(Pandoc 一致)");
  });
  await suite.case("(a) resolveImageDisplaySize:百分比相对内容区宽 + 一维等比", () => {
    const disp3 = resolveImageDisplaySize(
      { width: 800, height: 400 },
      { height: { unit: "%", value: 20 } },
      500,
    );
    assert(disp3.height === 100 && disp3.width === 200, "百分比相对内容区宽 + 一维等比");
  });
  // isFigureParagraph:独立成段图片(+尾随属性块)/ 非独立段落
  await suite.case("(a) isFigureParagraph 正向:纯图片段与图片+属性块为 figure", () => {
    const astFig = firstParagraphChildren("![a](x.png){width=50%}\n");
    assert(isFigureParagraph(astFig) === true, "图片+尾随属性块应为 figure");
    const astPlain = firstParagraphChildren("![a](x.png)\n");
    assert(isFigureParagraph(astPlain) === true, "纯图片段落应为 figure");
  });
  await suite.case("(a) isFigureParagraph 负向:前有文本 / 尾随文本均非 figure", () => {
    const astText = firstParagraphChildren("前文 ![a](x.png)\n");
    assert(isFigureParagraph(astText) === false, "图片前有文本不应为 figure");
    const astTail = firstParagraphChildren("![a](x.png) 尾随文字\n");
    assert(isFigureParagraph(astTail) === false, "尾随普通文本不应为 figure");
  });
  console.log("[ok] image-size:(a) 语法解析纯函数直测(词法/校验范围/等比与两维语义/figure 判定)断言通过");

  // ================= (b) docx 产物断言 =================
  // 样例:g1-tiny.png 为 1×1 图。{width=200} → 200×200(一维等比);
  // {width=50%} → round(0.5×内容区宽) 见方;{width=300 height=100} → 两维按给定值。
  const docxMd = [
    "![宽二百](./input/g1-tiny.png){width=200}",
    "",
    "![半宽](./input/g1-tiny.png){width=50%}",
    "",
    "![两维](./input/g1-tiny.png){width=300 height=100}",
    "",
    "正文行内 ![内联](./input/g1-tiny.png){width=40%}",
    "",
  ].join("\n");
  /** @type {Warning[]} */
  const docxWarnings = [];
  const buffer = await renderDocx(parseMarkdown(docxMd), { imageResolver: resolver, warnings: docxWarnings });
  const xml = await unzipPart(buffer, "word/document.xml");

  const expectW200 = emu(200); // 一维等比:1×1 图高比 1:1 → 200×200
  await suite.case("(b1) docx 尺寸属性 EMU 换算:px / 百分比 / 两维 / 行内", () => {
    assert(xml.includes(`<wp:extent cx="${expectW200}" cy="${expectW200}"/>`), "{width=200} 应为 200×200(EMU)");
    const halfPx = Math.round(DOCX_CONTENT_WIDTH_PX * 0.5); // round(551.8×0.5)=276
    assert(
      xml.includes(`<wp:extent cx="${emu(halfPx)}" cy="${emu(halfPx)}"/>`),
      `{width=50%} 应为 ${halfPx}px 见方(相对内容区宽 ${DOCX_CONTENT_WIDTH_PX.toFixed(1)}px)`,
    );
    assert(xml.includes(`<wp:extent cx="${emu(300)}" cy="${emu(100)}"/>`), "{width=300 height=100} 应按给定值(不保持比例)");
    // 行内图片(非独立段落)尾随属性同样生效(属性块须为图片后直到段尾的全部文本)
    const inlinePx = Math.round(DOCX_CONTENT_WIDTH_PX * 0.4); // round(551.8×0.4)=221
    assert(xml.includes(`<wp:extent cx="${emu(inlinePx)}"`), `行内图片 {width=40%} 应为 ${inlinePx}px`);
  });
  // 显式尺寸绕过 scaleToFit 上限(400):width=200 的 1×1 小图被放大到 200(用户意图优先)
  console.log("[ok] image-size:(b1) docx 尺寸属性 EMU 换算(px/百分比/两维/绕过上限)断言通过");

  // figure 居中:三个独立成段图片段落均挂 w:jc center;行内图片段落不居中
  await suite.case("(b2) docx 三个 figure 段落各含一处居中(w:jc center)", () => {
    const centerCount = (xml.match(/<w:jc w:val="center"/g) || []).length;
    assert(centerCount === 3, `三个 figure 段落应各含一处居中(w:jc center),实际 ${centerCount}`);
  });
  // 属性文本剥除:document.xml 不再出现属性块字面量
  await suite.case("(b2) docx 属性块文本从输出中剥除", () => {
    assert(!xml.includes("{width=") && !xml.includes("{height="), "docx 属性块文本应从输出中剥除");
  });
  console.log("[ok] image-size:(b2) docx figure 居中(w:jc center)+ 属性文本剥除断言通过");

  // ================= (c) pdf 产物断言 =================
  /** @type {Warning[]} */
  const pdfWarnings = [];
  const pdfMd = [
    "![半宽](./input/g1-tiny.png){width=50%}",
    "",
    "![两维](./input/g1-tiny.png){width=300 height=200}",
    "",
    "![高三成](./input/g1-tiny.png){height=30%}",
    "",
    "正文行内 ![内联](./input/g1-tiny.png){width=40%}",
    "",
    "无属性独立图:",
    "",
    "![素图](./input/g1-tiny.png)",
    "",
  ].join("\n");
  const pdf = asPdfArtifact(await convertTyped(pdfMd, "pdf", { baseDir: FIXTURES_DIR, warnings: pdfWarnings }));
  // width 百分比原样注入(CSS 相对容器宽);两维 px 注入;height 百分比按内容宽换算 px
  await suite.case("(c) pdf style 注入:width 百分比 / 两维 px / height 换算 / 行内", () => {
    assert(pdf.html.includes('style="width:50%"'), "pdf width 百分比应原样注入 style");
    assert(pdf.html.includes('style="width:300px;height:200px"'), "pdf 两维 px 应注入 style");
    const h30 = Math.round(PDF_CONTENT_WIDTH_PX * 0.3); // round(551.81×0.3)=166
    assert(pdf.html.includes(`style="height:${h30}px"`), `pdf height 百分比应换算 px(${h30}px)`);
    // 行内图片(非独立段落)同样消费属性(属性紧跟图片即生效)
    assert(pdf.html.includes('style="width:40%"'), "pdf 行内图片尾随属性应同样生效");
  });
  // 属性文本剥除 + figure 类挂载
  await suite.case("(c) pdf 属性块剥除 + 四个独立段落各挂 fig-image 类", () => {
    assert(!pdf.html.includes("{width=") && !pdf.html.includes("{height="), "pdf 属性块文本应从输出中剥除");
    const figCount = (pdf.html.match(/class="fig-image"/g) || []).length;
    assert(figCount === 4, `四个独立成段图片段落应各挂 fig-image 类,实际 ${figCount}`);
  });
  // 无属性回归:img 无 style 注入;独立成段仍居中(fig-image)
  await suite.case("(c) pdf 无属性图片不注入 style", () => {
    const h30 = Math.round(PDF_CONTENT_WIDTH_PX * 0.3); // round(551.81×0.3)=166
    assert(!/<img[^>]*style=/i.test(pdf.html.replace('style="width:50%"', "").replace('style="width:300px;height:200px"', "").replace(`style="height:${h30}px"`, "").replace('style="width:40%"', "")), "无属性图片不应注入 style");
  });
  console.log("[ok] image-size:(c) pdf style 注入(%/px/height 换算)+ fig-image 类 + 属性剥除 断言通过");

  // ================= (d) 非法值警告断言(docx/pdf 双侧) =================
  /** @type {("docx" | "pdf")[]} */
  const formats = ["docx", "pdf"];
  for (const fmt of formats) {
    // 两侧各一整块:警告产生、params、zh/en 文案、降级尺寸是同一场景的四个面,
    // 分开会让「无警告」这一前置的失败报在别的 case 名下
    await suite.case(`(d) ${fmt} 非法尺寸属性产生 keyed 警告(zh/en 文案)+ 默认尺寸降级`, async () => {
      /** @type {Warning[]} */
      const badWarnings = [];
      const artifact =
        fmt === "docx"
          ? asDocxArtifact(
              await convertTyped("![坏图](./input/g1-tiny.png){width=-3}", "docx", {
                baseDir: FIXTURES_DIR,
                imageResolver: resolver,
                warnings: badWarnings,
              }),
            )
          : asPdfArtifact(
              await convertTyped("![坏图](./input/g1-tiny.png){width=-3}", "pdf", {
                baseDir: FIXTURES_DIR,
                imageResolver: resolver,
                warnings: badWarnings,
              }),
            );
      const hit = badWarnings.find(
        /**
         * @param {Warning} w 警告条目
         * @returns {w is KeyedWarning} 是否为目标 keyed 警告
         */
        (w) => typeof w === "object" && w.key === "warn.imageAttrInvalid",
      );
      assert(hit !== undefined, `${fmt} 非法尺寸属性应产生 warn.imageAttrInvalid keyed 警告`);
      assert(hit.params?.src === "./input/g1-tiny.png" && hit.params?.attr === "width=-3", `${fmt} 警告 params 应含 src 与原始键值对`);
      // zh 文案(fallback 口径)
      assert(formatWarning(hit) === "图片尺寸属性无效,已忽略: width=-3(./input/g1-tiny.png)", `${fmt} zh 文案应逐字匹配`);
      // en 字典命中(satisfies 全量锁定)
      setLanguage("en");
      assert(formatWarning(hit) === "Invalid image size attribute, ignored: width=-3 (./input/g1-tiny.png)", `${fmt} en 文案应逐字匹配`);
      setLanguage("zh");
      // 分支按产物判别式而非 fmt:同一循环里产物与 fmt 一一对应,判别式同时完成类型收窄
      if (artifact.kind === "docx") {
        const badXml = await unzipPart(artifact.buffer, "word/document.xml");
        // 降级:非法属性忽略后走默认 scaleToFit(1×1 不放大 → 9525 EMU)
        assert(badXml.includes('<wp:extent cx="9525" cy="9525"/>'), "docx 非法属性应回退默认尺寸(1×1 不放大)");
        assert(!badXml.includes("{width="), "docx 非法属性块同样剥除(不残留字面量)");
      } else {
        assert(!artifact.html.includes("width:-3") && !artifact.html.includes("{width="), "pdf 非法属性不应注入 style 且剥除字面量");
      }
    });
  }
  console.log("[ok] image-size:(d) 非法值 keyed 警告(zh/en)+ 默认尺寸降级(docx/pdf 对齐)断言通过");

  // (d2) 非法属性去重:同一 src 同一非法属性出现 N 次 → 双侧各只报 1 条
  // (docx/pdf 均经共享 i18n.pushWarningOnce,键 = key + JSON(params))
  for (const fmt of formats) {
    await suite.case(`(d2) ${fmt} 同一非法属性 ×2 去重为 1 条(共享 pushWarningOnce)`, async () => {
      /** @type {Warning[]} */
      const dupWarnings = [];
      const dupMd = "![坏图](./input/g1-tiny.png){width=-3}\n\n重复 ![坏图](./input/g1-tiny.png){width=-3}\n";
      await convertTyped(dupMd, fmt, { baseDir: FIXTURES_DIR, imageResolver: resolver, warnings: dupWarnings });
      const dupCount = dupWarnings.filter(
        /**
         * @param {Warning} w 警告条目
         * @returns {w is KeyedWarning} 是否为目标 keyed 警告
         */
        (w) => typeof w === "object" && w.key === "warn.imageAttrInvalid",
      ).length;
      assert(dupCount === 1, `${fmt} 同一非法属性 ×2 应去重为 1 条,实际 ${dupCount}`);
    });
  }
  console.log("[ok] image-size:(d2) 非法属性重复出现去重(docx/pdf 各 1 条,共享 pushWarningOnce)断言通过");

  // ================= (e) 无属性回归 + 题注绑定 =================
  // 无属性:行内图片不居中、尺寸走原 scaleToFit(1×1 不放大);独立成段图片居中(figure 语义)
  const plainDocx = await renderDocx(parseMarkdown("前文 ![内联](./input/g1-tiny.png) 后文\n\n![独图](./input/g1-tiny.png)\n"), {
    imageResolver: resolver,
    warnings: [],
  });
  const plainXml = await unzipPart(plainDocx, "word/document.xml");
  const plainPdf = asPdfArtifact(
    await convertTyped("前文 ![内联](./input/g1-tiny.png) 后文", "pdf", { baseDir: FIXTURES_DIR, warnings: [] }),
  );
  await suite.case("(e1) docx 无属性:1×1 小图不放大、仅独立成段图片居中", () => {
    assert(plainXml.includes('<wp:extent cx="9525" cy="9525"/>'), "无属性 1×1 小图不放大(回归)");
    const plainCenters = (plainXml.match(/<w:jc w:val="center"/g) || []).length;
    assert(plainCenters === 1, `仅独立成段图片段落居中(行内图片不受影响),实际 ${plainCenters}`);
  });
  await suite.case("(e1) pdf 无属性:行内图片不挂 fig-image、无 style 注入", () => {
    assert(!plainPdf.html.includes('class="fig-image"'), "pdf 行内图片段落不挂 fig-image(回归)");
    assert(!/<img[^>]*style=/i.test(plainPdf.html), "pdf 无属性图片无 style 注入(回归)");
  });
  // 容器内图片不识别 figure(与 docx 侧只遍历顶层段落同契约)
  const listDocx = await renderDocx(parseMarkdown("- ![列表图](./input/g1-tiny.png)\n"), { imageResolver: resolver, warnings: [] });
  const listXml = await unzipPart(listDocx, "word/document.xml");
  const listPdf = asPdfArtifact(
    await convertTyped("- ![列表图](./input/g1-tiny.png)\n", "pdf", { baseDir: FIXTURES_DIR, warnings: [] }),
  );
  await suite.case("(e1) 容器内(列表项)图片两侧均不识别为 figure", () => {
    assert(!listXml.includes('<w:jc w:val="center"'), "docx 列表项内图片不居中(容器内不识别 figure)");
    assert(!listPdf.html.includes('class="fig-image"'), "pdf 列表项内图片不挂 fig-image(容器内不识别)");
  });
  console.log("[ok] image-size:(e1) 无属性回归(scaleToFit 不变/行内不居中/无 style 注入)断言通过");

  // 题注绑定:独立成段图片后紧跟「图: xxx」前缀行 → 题注保持在图下方,编号机制不变
  const capMd = "# 章节\n\n![示意图](./input/g1-tiny.png)\n\n图: 示意图标题\n";
  const capDocx = await renderDocx(parseMarkdown(capMd), { imageResolver: resolver, warnings: [] });
  const capXml = await unzipPart(capDocx, "word/document.xml");
  const capPdf = asPdfArtifact(await convertTyped(capMd, "pdf", { baseDir: FIXTURES_DIR, warnings: [] }));
  await suite.case("(e2) 题注绑定:编号机制不变 + figure 段落居中 / 挂 fig-image", () => {
    assert(capXml.includes(">图 1.1 示意图标题<"), "题注自动编号机制不变(h1 章节号.序数 + 题注文本)");
    assert(capXml.includes('<w:jc w:val="center"/>'), "figure 段落居中(题注绑定场景)");
    assert(capPdf.html.includes('class="fig-image"'), "pdf figure 段落挂 fig-image(题注绑定场景)");
  });
  await suite.case("(e2) 题注绑定:pdf 题注识别不变(fig-caption + 题注文本)", () => {
    assert(capPdf.html.includes("fig-caption") && capPdf.html.includes("示意图标题"), "pdf 题注识别不变(fig-caption + 题注文本)");
  });
  console.log("[ok] image-size:(e2) figure 题注绑定(题注保持在图下方,编号机制不变,docx/pdf 对齐)断言通过");

  await saveArtifact("image-size", { docx: buffer });
  return { cases: suite.results };
}
