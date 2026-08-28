/**
 * 通用文本工具直测:src/core/util/utils.ts 单分支补齐。
 * - decodeNumeric 非法码点(20-21 行):数值实体码点越界(> 0x10FFFF)返回原样不抛;
 *   合法码点正常解码(含增补平面代理对)。
 * - escapeRegExp(35-36 行):正则特殊字符全部转义,结果可安全字面匹配。
 * 纯函数段,无产物输出。
 */
import { decodeEntities, escapeRegExp } from "../../dist/core/util/utils.js";

export async function run() {
  // decodeNumeric 非法码点:越界(0x110000 / 1114112)返回原样(不抛、不解码)
  for (const [input, label] of [
    ["&#x110000;", "十六进制越界码点"],
    ["&#1114112;", "十进制越界码点"],
  ]) {
    const out = decodeEntities(input);
    if (out !== input) {
      throw new Error(`utils 断言失败:${label}(${input})应原样返回,实际 ${out}`);
    }
  }
  // 合法码点正控:增补平面(代理对)与 BMP 正常解码
  if (decodeEntities("&#x1F600;") !== "😀") {
    throw new Error("utils 断言失败:合法增补平面码点 &#x1F600; 应解码为 😀");
  }
  if (decodeEntities("&#65;") !== "A") {
    throw new Error("utils 断言失败:合法 BMP 码点 &#65; 应解码为 A");
  }
  console.log("[ok] utils:decodeNumeric 非法码点原样返回 + 合法码点解码 断言通过");

  // escapeRegExp:全部特殊字符转义(.*+?^${}()|[]\)
  const escaped = escapeRegExp("a.b*c+d?e(f)g[h]i{j}k|l\\m^n$");
  const expected = "a\\.b\\*c\\+d\\?e\\(f\\)g\\[h\\]i\\{j\\}k\\|l\\\\m\\^n\\$";
  if (escaped !== expected) {
    throw new Error(`utils 断言失败:escapeRegExp 转义结果不符\n期望:${expected}\n实际:${escaped}`);
  }
  // 转义后可安全用于 new RegExp 字面匹配原串
  if (!new RegExp(escaped).test("a.b*c+d?e(f)g[h]i{j}k|l\\m^n$")) {
    throw new Error("utils 断言失败:escapeRegExp 结果应能字面匹配原串");
  }
  console.log("[ok] utils:escapeRegExp 特殊字符全转义 + 字面匹配 断言通过");
}