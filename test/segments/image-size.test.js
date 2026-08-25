/**
 * 图片控制增强段(F1):Pandoc 风格尾随尺寸属性 + figure 题注绑定。
 * 覆盖五类断言(零注册):
 * (a) 语法解析纯函数直测(core/markdown/image-size.ts:词法/校验范围/边界);
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
import { convert } from "../../dist/core/convert.js";
import { formatWarning, setLanguage } from "../../dist/core/i18n.js";
import {
  parseImageSizeAttrs,
  parseImageDim,
  resolveImageDisplaySize,
  isFigureParagraph,
  IMAGE_SIZE_PX_MAX,
  IMAGE_SIZE_PERCENT_MAX,
} from "../../dist/core/markdown/image-size.js";
import {
  DEFAULT_PAGE_SETUP,
  PAPER_SIZES_MM,
  mmToTwips,
  twipsToPx,
  mmToPx,
} from "../../dist/core/settings/settings-defaults.js";
import { FIXTURES_DIR } from "../common/paths.js";
import { unzipPart } from "../common/docx-utils.js";
import { saveArtifact } from "../common/artifacts.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`image-size 断言失败:${msg}`);
}

/** 内容区宽(px)契约值:A4 纵向默认边距(docx 与 pdf 各自换算链同源验证用) */
const CONTENT_WIDTH_MM =
  PAPER_SIZES_MM[DEFAULT_PAGE_SETUP.paper].width -
  DEFAULT_PAGE_SETUP.marginLeft -
  DEFAULT_PAGE_SETUP.marginRight; // 146mm
const DOCX_CONTENT_WIDTH_PX = twipsToPx(mmToTwips(CONTENT_WIDTH_MM)); // 8277/15 ≈ 551.8
const PDF_CONTENT_WIDTH_PX = mmToPx(CONTENT_WIDTH_MM); // ≈ 551.81

/** px → EMU(docx 库序列化契约:1px = 9525 EMU) */
const emu = (px) => px * 9525;

/** 测试用 resolver:fixtures 目录下的本地图片可读,其余失败 */
const resolver = async (src) => {
  if (src.startsWith("http")) return null;
  try {
    return await fs.readFile(path.resolve(FIXTURES_DIR, src));
  } catch {
    return null;
  }
};

export async function run() {
  // ================= (a) 语法解析纯函数直测 =================
  // 合法:百分比 / 像素 / 组合 / 宽容空白 / 小数
  assert(parseImageSizeAttrs("{width=50%}").attrs.width?.unit === "%", "{width=50%} 应解析为 %");
  assert(parseImageSizeAttrs("{width=300}").attrs.width?.unit === "px", "{width=300} 应解析为 px");
  const combo = parseImageSizeAttrs("{width=50% height=30%}");
  assert(combo.attrs.width?.value === 50 && combo.attrs.height?.value === 30, "组合属性应双维解析");
  assert(parseImageSizeAttrs("{ width = 12.5 }").attrs.width?.value === 12.5, "空白与小数应容忍");
  assert(parseImageSizeAttrs("{WIDTH=50%}").attrs.width?.value === 50, "键名大小写归一");
  // 非法:负数 / 非数值 / 超范围 / 零
  for (const bad of ["{width=-3}", "{height=abc}", "{width=150%}", "{width=0}", `{width=${IMAGE_SIZE_PX_MAX + 1}}`]) {
    const parsed = parseImageSizeAttrs(bad);
    assert(parsed.hasSizeKeys && Object.keys(parsed.attrs).length === 0, `${bad} 应判非法且无合法维度`);
    assert(parsed.invalid.length === 1, `${bad} 应产出一条 invalid 记录`);
  }
  assert(IMAGE_SIZE_PERCENT_MAX === 100, "百分比上限应为 100");
  // 边界:非属性块 / 无尺寸键花括号文本原样保留(hasSizeKeys=false 不剥除)
  assert(!parseImageSizeAttrs("普通文本").hasSizeKeys, "普通文本不应识别为属性块");
  assert(!parseImageSizeAttrs("{}").hasSizeKeys, "空花括号不应识别(hasSizeKeys=false)");
  assert(!parseImageSizeAttrs("{foo=bar}").hasSizeKeys, "无尺寸键的花括号文本不应识别");
  assert(parseImageSizeAttrs("{width=50% #id}").invalid.length === 0, "未知键静默忽略不告警");
  // parseImageDim 边界直测
  assert(parseImageDim("99.9%")?.value === 99.9, "小数百分比应合法");
  assert(parseImageDim("-5") === null, "负数应非法");
  assert(parseImageDim("1e3") === null, "科学计数法应非法(词法不含 e)");
  // resolveImageDisplaySize:一维等比 / 两维不保持比例 / 百分比基准
  const disp = resolveImageDisplaySize({ width: 800, height: 400 }, { width: { unit: "px", value: 200 } }, 500);
  assert(disp.width === 200 && disp.height === 100, "只给宽应按原图比例缩高");
  const disp2 = resolveImageDisplaySize(
    { width: 800, height: 400 },
    { width: { unit: "px", value: 200 }, height: { unit: "px", value: 300 } },
    500,
  );
  assert(disp2.width === 200 && disp2.height === 300, "两维都给不保持比例(Pandoc 一致)");
  const disp3 = resolveImageDisplaySize({ width: 800, height: 400 }, { height: { unit: "%", value: 20 } }, 500);
  assert(disp3.height === 100 && disp3.width === 200, "百分比相对内容区宽 + 一维等比");
  // isFigureParagraph:独立成段图片(+尾随属性块)/ 非独立段落
  const astFig = parseMarkdown("![a](x.png){width=50%}\n").children[0].children;
  assert(isFigureParagraph(astFig) === true, "图片+尾随属性块应为 figure");
  const astPlain = parseMarkdown("![a](x.png)\n").children[0].children;
  assert(isFigureParagraph(astPlain) === true, "纯图片段落应为 figure");
  const astText = parseMarkdown("前文 ![a](x.png)\n").children[0].children;
  assert(isFigureParagraph(astText) === false, "图片前有文本不应为 figure");
  const astTail = parseMarkdown("![a](x.png) 尾随文字\n").children[0].children;
  assert(isFigureParagraph(astTail) === false, "尾随普通文本不应为 figure");
  console.log("[ok] image-size:(a) 语法解析纯函数直测(词法/校验范围/等比与两维语义/figure 判定)断言通过");

  // ================= (b) docx 产物断言 =================
  // 样例:g1-tiny.png 为 1×1 图。{width=200} → 200×200(一维等比);
  // {width=50%} → round(0.5×内容区宽) 见方;{width=300 height=100} → 两维按给定值。
  const docxMd = [
    "![宽二百](./g1-tiny.png){width=200}",
    "",
    "![半宽](./g1-tiny.png){width=50%}",
    "",
    "![两维](./g1-tiny.png){width=300 height=100}",
    "",
    "正文行内 ![内联](./g1-tiny.png){width=40%}",
    "",
  ].join("\n");
  const docxWarnings = [];
  const buffer = await renderDocx(parseMarkdown(docxMd), { imageResolver: resolver, warnings: docxWarnings });
  const xml = await unzipPart(buffer, "word/document.xml");

  const expectW200 = emu(200); // 一维等比:1×1 图高比 1:1 → 200×200
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
  // 显式尺寸绕过 scaleToFit 上限(400):width=200 的 1×1 小图被放大到 200(用户意图优先)
  console.log("[ok] image-size:(b1) docx 尺寸属性 EMU 换算(px/百分比/两维/绕过上限)断言通过");

  // figure 居中:三个独立成段图片段落均挂 w:jc center;行内图片段落不居中
  const centerCount = (xml.match(/<w:jc w:val="center"/g) || []).length;
  assert(centerCount === 3, `三个 figure 段落应各含一处居中(w:jc center),实际 ${centerCount}`);
  // 属性文本剥除:document.xml 不再出现属性块字面量
  assert(!xml.includes("{width=") && !xml.includes("{height="), "docx 属性块文本应从输出中剥除");
  console.log("[ok] image-size:(b2) docx figure 居中(w:jc center)+ 属性文本剥除断言通过");

  // ================= (c) pdf 产物断言 =================
  const pdfWarnings = [];
  const pdfMd = [
    "![半宽](./g1-tiny.png){width=50%}",
    "",
    "![两维](./g1-tiny.png){width=300 height=200}",
    "",
    "![高三成](./g1-tiny.png){height=30%}",
    "",
    "正文行内 ![内联](./g1-tiny.png){width=40%}",
    "",
    "无属性独立图:",
    "",
    "![素图](./g1-tiny.png)",
    "",
  ].join("\n");
  const pdf = await convert(pdfMd, "pdf", { baseDir: FIXTURES_DIR, warnings: pdfWarnings });
  // width 百分比原样注入(CSS 相对容器宽);两维 px 注入;height 百分比按内容宽换算 px
  assert(pdf.html.includes('style="width:50%"'), "pdf width 百分比应原样注入 style");
  assert(pdf.html.includes('style="width:300px;height:200px"'), "pdf 两维 px 应注入 style");
  const h30 = Math.round(PDF_CONTENT_WIDTH_PX * 0.3); // round(551.81×0.3)=166
  assert(pdf.html.includes(`style="height:${h30}px"`), `pdf height 百分比应换算 px(${h30}px)`);
  // 行内图片(非独立段落)同样消费属性(属性紧跟图片即生效)
  assert(pdf.html.includes('style="width:40%"'), "pdf 行内图片尾随属性应同样生效");
  // 属性文本剥除 + figure 类挂载
  assert(!pdf.html.includes("{width=") && !pdf.html.includes("{height="), "pdf 属性块文本应从输出中剥除");
  const figCount = (pdf.html.match(/class="fig-image"/g) || []).length;
  assert(figCount === 4, `四个独立成段图片段落应各挂 fig-image 类,实际 ${figCount}`);
  // 无属性回归:img 无 style 注入;独立成段仍居中(fig-image)
  assert(!/<img[^>]*style=/i.test(pdf.html.replace('style="width:50%"', "").replace('style="width:300px;height:200px"', "").replace(`style="height:${h30}px"`, "").replace('style="width:40%"', "")), "无属性图片不应注入 style");
  console.log("[ok] image-size:(c) pdf style 注入(%/px/height 换算)+ fig-image 类 + 属性剥除 断言通过");

  // ================= (d) 非法值警告断言(docx/pdf 双侧) =================
  for (const fmt of ["docx", "pdf"]) {
    const badWarnings = [];
    const artifact =
      fmt === "docx"
        ? await convert("![坏图](./g1-tiny.png){width=-3}", "docx", { baseDir: FIXTURES_DIR, imageResolver: resolver, warnings: badWarnings })
        : await convert("![坏图](./g1-tiny.png){width=-3}", "pdf", { baseDir: FIXTURES_DIR, imageResolver: resolver, warnings: badWarnings });
    const hit = badWarnings.find((w) => typeof w === "object" && w.key === "warn.imageAttrInvalid");
    assert(hit !== undefined, `${fmt} 非法尺寸属性应产生 warn.imageAttrInvalid keyed 警告`);
    assert(hit.params.src === "./g1-tiny.png" && hit.params.attr === "width=-3", `${fmt} 警告 params 应含 src 与原始键值对`);
    // zh 文案(fallback 口径)
    assert(formatWarning(hit) === "图片尺寸属性无效,已忽略: width=-3(./g1-tiny.png)", `${fmt} zh 文案应逐字匹配`);
    // en 字典命中(satisfies 全量锁定)
    setLanguage("en");
    assert(formatWarning(hit) === "Invalid image size attribute, ignored: width=-3 (./g1-tiny.png)", `${fmt} en 文案应逐字匹配`);
    setLanguage("zh");
    if (fmt === "docx") {
      const badXml = await unzipPart(artifact.buffer, "word/document.xml");
      // 降级:非法属性忽略后走默认 scaleToFit(1×1 不放大 → 9525 EMU)
      assert(badXml.includes('<wp:extent cx="9525" cy="9525"/>'), "docx 非法属性应回退默认尺寸(1×1 不放大)");
      assert(!badXml.includes("{width="), "docx 非法属性块同样剥除(不残留字面量)");
    } else {
      assert(!artifact.html.includes("width:-3") && !artifact.html.includes("{width="), "pdf 非法属性不应注入 style 且剥除字面量");
    }
  }
  console.log("[ok] image-size:(d) 非法值 keyed 警告(zh/en)+ 默认尺寸降级(docx/pdf 对齐)断言通过");

  // ================= (e) 无属性回归 + 题注绑定 =================
  // 无属性:行内图片不居中、尺寸走原 scaleToFit(1×1 不放大);独立成段图片居中(F1 figure 语义)
  const plainDocx = await renderDocx(parseMarkdown("前文 ![内联](./g1-tiny.png) 后文\n\n![独图](./g1-tiny.png)\n"), {
    imageResolver: resolver,
    warnings: [],
  });
  const plainXml = await unzipPart(plainDocx.buffer, "word/document.xml");
  assert(plainXml.includes('<wp:extent cx="9525" cy="9525"/>'), "无属性 1×1 小图不放大(回归)");
  const plainCenters = (plainXml.match(/<w:jc w:val="center"/g) || []).length;
  assert(plainCenters === 1, `仅独立成段图片段落居中(行内图片不受影响),实际 ${plainCenters}`);
  const plainPdf = await convert("前文 ![内联](./g1-tiny.png) 后文", "pdf", { baseDir: FIXTURES_DIR, warnings: [] });
  assert(!plainPdf.html.includes('class="fig-image"'), "pdf 行内图片段落不挂 fig-image(回归)");
  assert(!/<img[^>]*style=/i.test(plainPdf.html), "pdf 无属性图片无 style 注入(回归)");
  // 容器内图片不识别 figure(与 docx 侧只遍历顶层段落同契约)
  const listDocx = await renderDocx(parseMarkdown("- ![列表图](./g1-tiny.png)\n"), { imageResolver: resolver, warnings: [] });
  const listXml = await unzipPart(listDocx.buffer, "word/document.xml");
  assert(!listXml.includes('<w:jc w:val="center"'), "docx 列表项内图片不居中(容器内不识别 figure)");
  const listPdf = await convert("- ![列表图](./g1-tiny.png)\n", "pdf", { baseDir: FIXTURES_DIR, warnings: [] });
  assert(!listPdf.html.includes('class="fig-image"'), "pdf 列表项内图片不挂 fig-image(容器内不识别)");
  console.log("[ok] image-size:(e1) 无属性回归(scaleToFit 不变/行内不居中/无 style 注入)断言通过");

  // 题注绑定:独立成段图片后紧跟「图: xxx」前缀行 → 题注保持在图下方,编号机制不变
  const capMd = "# 章节\n\n![示意图](./g1-tiny.png)\n\n图: 示意图标题\n";
  const capDocx = await renderDocx(parseMarkdown(capMd), { imageResolver: resolver, warnings: [] });
  const capXml = await unzipPart(capDocx.buffer, "word/document.xml");
  assert(capXml.includes(">图 1.1 示意图标题<"), "题注自动编号机制不变(h1 章节号.序数 + 题注文本)");
  assert(capXml.includes('<w:jc w:val="center"/>'), "figure 段落居中(题注绑定场景)");
  const capPdf = await convert(capMd, "pdf", { baseDir: FIXTURES_DIR, warnings: [] });
  assert(capPdf.html.includes('class="fig-image"'), "pdf figure 段落挂 fig-image(题注绑定场景)");
  assert(capPdf.html.includes("fig-caption") && capPdf.html.includes("示意图标题"), "pdf 题注识别不变(fig-caption + 题注文本)");
  console.log("[ok] image-size:(e2) figure 题注绑定(题注保持在图下方,编号机制不变,docx/pdf 对齐)断言通过");

  await saveArtifact("image-size", { docx: buffer });
}
