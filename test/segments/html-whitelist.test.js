/**
 * 内联格式白名单单一实现测试(重构 R1,契约收敛 H1):
 * - isAllowedInlineHtml 判定规则直测(合法/非法矩阵);
 * - ALLOWED_INLINE_TAGS 集合完整性快照。
 * 双格式端到端一致性由 raw-html.test.js 覆盖,此段只验证共享实现本身。
 */
import { ALLOWED_INLINE_TAGS, isAllowedInlineHtml } from "../../dist/core/html-whitelist.js";

export async function run() {
  const valid = [
    ["纯文本", "普通文本"],
    ["空串", ""],
    ["纯空白", "   "],
    ["单标签", "<strong>粗体</strong>"],
    ["嵌套", "<strong>粗<em>斜</em></strong>"],
    ["br 空标签", "a<br>b"],
    ["br 自闭合(B3)", "a<br/>b"],
    ["br 自闭合带空格(B3)", "a<br />b"],
    ["开标签尾随空格", "<strong >粗体</strong>"],
    ["多段独立标签", "<i>a</i><b>b</b>"],
    ["大小写", "<STRONG>粗</STRONG>"],
    ["混合文本", "<code>x()</code> 与 x<sub>1</sub> 和 y<sup>2</sup>"],
  ];
  for (const [label, input] of valid) {
    if (!isAllowedInlineHtml(input)) {
      throw new Error(`白名单判定失败:${label} 应合法(${JSON.stringify(input)})`);
    }
  }

  const invalid = [
    ["带属性", '<strong class="x">a</strong>'],
    ["未闭合", "<strong>a"],
    ["无开标签闭", "</strong>"],
    ["错配嵌套", "<strong><em></strong></em>"],
    ["非白名单标签", "<div>a</div>"],
    ["脚本标签", "<script>alert(1)</script>"],
    ["文本段含 <", "a < b"],
    ["br 闭标签", "</br>"],
    ["闭标签带属性", "</strong class='x'>"],
    ["空开标签", "<>a</>"],
    ["非空标签自闭合(B3:仍非法)", "<em/>a"],
    ["自闭合带属性伪装", '<img src="x" />'],
  ];
  for (const [label, input] of invalid) {
    if (isAllowedInlineHtml(input)) {
      throw new Error(`白名单判定失败:${label} 应非法(${JSON.stringify(input)})`);
    }
  }

  const expected = new Set([
    "strong", "b", "em", "i", "u", "s", "del", "code", "kbd", "sub", "sup", "mark", "br", "span",
  ]);
  if (ALLOWED_INLINE_TAGS.size !== expected.size) {
    throw new Error(`ALLOWED_INLINE_TAGS 数量不符:${ALLOWED_INLINE_TAGS.size} != ${expected.size}`);
  }
  for (const tag of expected) {
    if (!ALLOWED_INLINE_TAGS.has(tag)) throw new Error(`ALLOWED_INLINE_TAGS 缺少 ${tag}`);
  }

  console.log(`[ok] html-whitelist:判定矩阵 ${valid.length} 合法 + ${invalid.length} 非法 + 集合完整性 全部通过`);
}
