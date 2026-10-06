// @ts-check
/**
 * mermaid 工具函数单测
 */

/**
 * @param {boolean} cond
 * @param {string} msg
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败:${msg}`);
}

import { containsMermaidCode, MERMAID_LANG } from "../../dist/core/markdown/mermaid.js";
import { parseMarkdown } from "../../dist/core/pipeline/parse.js";

const mdWithMermaid = parseMarkdown("# Test\n\n```mermaid\ngraph TD; A-->B;\n```\n");
assert(containsMermaidCode(mdWithMermaid) === true, "应检测到 mermaid 代码块");

const mdWithoutMermaid = parseMarkdown("# Test\n\n```graph\nA-->B\n```\n");
assert(containsMermaidCode(mdWithoutMermaid) === false, "非 mermaid 语言不应匹配");

const mdNoCode = parseMarkdown("# Test\n\n正文内容\n");
assert(containsMermaidCode(mdNoCode) === false, "无代码块时应返回 false");

const mdNested = parseMarkdown("# Test\n\n> 引用\n\n```mermaid\ngraph TD\n```\n\n正文");
assert(containsMermaidCode(mdNested) === true, "嵌套在引用块中的 mermaid 也应被检测到");

assert(MERMAID_LANG === "mermaid", "常量应为 mermaid");

console.log("[ok] mermaid-utils:含 mermaid/不含/嵌套/常量 断言通过");

/**
 * @returns {Promise<void>}
 */
export async function run() {}

// 场景样例导出(gen-fixtures 落盘):本段测工具函数，无验收样例
export const fixtures = null;
