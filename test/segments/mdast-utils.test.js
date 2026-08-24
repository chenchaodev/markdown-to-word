/**
 * mdast 工具直测段(src/core/util/mdast-utils.ts 纯函数,TEST-4 覆盖缺口补测:
 * 此前仅经 toc/captions 间接触达,无专属段):
 * 实现事实(读源码确认):
 * - collectPlainText:递归拼接子树 value(text/inlineCode 等含 value 的节点);
 * - comment 节点(批次 11 批注扩展):只累加 anchor(锚定文本)行内节点,
 *   content(批注内容)为元数据不计入——标题 slug / 目录条目 / 题注前缀识别
 *   均以本函数为纯文本来源,批注内容混入会污染锚文本;
 * - 无 value 且无 children 的节点 → "";空 children → ""。
 */
import { collectPlainText } from "../../dist/core/util/mdast-utils.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`mdast-utils 断言失败:${msg}`);
}

/** 纯 Node 段(零 Electron API) */
export async function run() {
  // ---- 1. 叶子节点:value 直取 ----
  assert(collectPlainText({ type: "text", value: "Hello" }) === "Hello", "text 节点应返回 value");
  assert(collectPlainText({ type: "inlineCode", value: "x=1" }) === "x=1", "inlineCode value 应计入纯文本");

  // ---- 2. 容器节点:children 递归拼接(保序) ----
  const para = {
    type: "paragraph",
    children: [
      { type: "text", value: "见" },
      { type: "emphasis", children: [{ type: "text", value: "第" }] },
      { type: "strong", children: [{ type: "text", value: "三章" }] },
    ],
  };
  assert(collectPlainText(para) === "见第三章", "嵌套 children 应保序拼接(样式标志剥除)");

  // ---- 3. comment 节点:只计 anchor,content(批注内容)不入纯文本 ----
  const comment = {
    type: "comment",
    anchor: [{ type: "text", value: "结果" }],
    content: [{ type: "text", value: "此处批注:数据待核对" }],
  };
  assert(
    collectPlainText(comment) === "结果",
    `comment 节点应只累加 anchor 文本,实际 ${JSON.stringify(collectPlainText(comment))}`,
  );
  // 混合场景:anchor 内含样式节点,与前后文本节点共存于段落
  const mixed = {
    type: "paragraph",
    children: [
      { type: "text", value: "前" },
      {
        type: "comment",
        anchor: [{ type: "emphasis", children: [{ type: "text", value: "锚" }] }],
        content: [{ type: "text", value: "机密内容" }],
      },
      { type: "text", value: "后" },
    ],
  };
  assert(collectPlainText(mixed) === "前锚后", "comment 混排应保留锚文本、剔除批注内容");

  // ---- 4. 边界:空节点 / 空 children ----
  assert(collectPlainText({ type: "break" }) === "", "无 value 无 children 的节点应返回空串");
  assert(collectPlainText({ type: "paragraph", children: [] }) === "", "空 children 应返回空串");

  console.log("[ok] mdast-utils:collectPlainText value 直取/递归拼接/comment 只计 anchor/空边界 断言通过");
}
