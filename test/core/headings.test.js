// @ts-check
/**
 * extractHeadings 直测(PDF 目录/书签共用的提取逻辑):
 * - h1-h3 + id 提取为 {level, id, text}(id 与正文锚点一一对应);
 * - h4 不提取、无 id 不提取、顺序保持;
 * - 文本剥行内标签(<code>/<strong> 等)+ 实体解码(decodeEntities);
 * - 与书签段互补:彼测注入端到端(htmlToPdf + setOutline),此测提取逻辑本身。
 * 注:标题 id 由渲染侧 overrideHeadingIdRule 生成,本段直接构造带 id 的 HTML。
 */
import { extractHeadings } from "../../dist/core/pdf/postprocess.js";
import { createCaseSuite } from "../harness/case.js";

/**
 * 断言辅助:统一报错格式(与 slug 段同风格)。
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @param {string} label 断言标签
 * @returns {void}
 */
function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} 断言失败: ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
  }
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ---------- 基本提取:h1-h3 + id,顺序保持 ----------
  const body = [
    '<h1 id="sec-1">第一章</h1>',
    "<p>正文</p>",
    '<h2 id="sec-1-1">1.1 小节</h2>',
    '<h3 id="sec-1-1-1">1.1.1 子节</h3>',
    '<h4 id="sec-ignored">h4 不提取</h4>', // 只提取 h1-h3
    '<h2>无 id 不提取</h2>',
  ].join("\n");
  const suite = createCaseSuite();
  const headings = extractHeadings(body);
  // 取数留在 case 之外:下面三条按位置取值依赖「提取数量为 3」这条判定成立,
  // 拆进 case 后长度判红会连带变成解构 undefined 的 TypeError,盖掉真因
  const [h1, h2, h3] = /** @type {[typeof headings[0], typeof headings[0], typeof headings[0]]} */ (headings);
  // case 名逐字复用 assertEq 的 label 形参:断言的失败文案与 case 名同源,不必两份清单同步维护
  await suite.case("提取数量(h4/无 id 排除)", () => {
    assertEq(headings.length, 3, "提取数量(h4/无 id 排除)");
  });
  await suite.case("首条 level", () => {
    assertEq(h1.level, 1, "首条 level");
  });
  await suite.case("首条 id", () => {
    assertEq(h1.id, "sec-1", "首条 id");
  });
  await suite.case("首条文本(中文)", () => {
    assertEq(h1.text, "第一章", "首条文本(中文)");
  });
  await suite.case("第二条 level", () => {
    assertEq(h2.level, 2, "第二条 level");
  });
  await suite.case("第二条文本", () => {
    assertEq(h2.text, "1.1 小节", "第二条文本");
  });
  await suite.case("第三条 level", () => {
    assertEq(h3.level, 3, "第三条 level");
  });
  console.log("[ok] extractHeadings:h1-h3 + id 提取、h4/无 id 排除、顺序保持 断言通过");

  // ---------- 文本净化:行内标签剥离 + 实体解码 ----------
  const rich = [
    '<h2 id="r1">含 <code>inline</code> 与 <strong>加粗</strong> 的标题</h2>',
    '<h1 id="r2">a &amp; b &lt;c&gt;</h1>',
    '<h3 id="r3"><span>嵌套<span>标签</span></span></h3>',
  ].join("\n");
  const cleaned = extractHeadings(rich);
  const [rich1, rich2, rich3] = /** @type {[typeof cleaned[0], typeof cleaned[0], typeof cleaned[0]]} */ (cleaned);
  await suite.case("行内标签剥离", () => {
    assertEq(rich1.text, "含 inline 与 加粗 的标题", "行内标签剥离");
  });
  await suite.case("实体解码(&amp; &lt; &gt;)", () => {
    assertEq(rich2.text, "a & b <c>", "实体解码(&amp; &lt; &gt;)");
  });
  await suite.case("嵌套标签递归剥离", () => {
    assertEq(rich3.text, "嵌套标签", "嵌套标签递归剥离");
  });
  console.log("[ok] extractHeadings:行内标签剥离 + 实体解码 + 嵌套标签 断言通过");

  // ---------- 边界:空输入 / 无标题 ----------
  await suite.case("空输入返回空数组", () => {
    assertEq(extractHeadings("").length, 0, "空输入返回空数组");
  });
  await suite.case("无标题返回空数组", () => {
    assertEq(extractHeadings("<p>只有正文</p>").length, 0, "无标题返回空数组");
  });
  console.log("[ok] extractHeadings:空输入/无标题 → 空数组 断言通过");
  return { cases: suite.results };
}
