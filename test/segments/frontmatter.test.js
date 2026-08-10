/**
 * frontmatter 解析测试(src/core/frontmatter.ts 纯逻辑;测试经 dist/core/frontmatter.js):
 * 实现事实(读源码确认,未改动):
 * - 仅当 md 首行(可带前后空格)为 `---` 才解析,到下一个 `---` 行(可带尾随空格/行尾)结束;
 *   `---` 不闭合 / 首行非 --- → 空 metadata + 原 md 为 body(不抛错、不丢内容)
 * - 块内逐行:trim 后空行与 `#` 注释跳过;无冒号行忽略;key 转小写,仅 title/author/date 生效
 * - value:取首个冒号后内容 trim;首尾成对单/双引号则剥离(未闭合引号原样保留);
 *   空值(含 `""` 剥离后)→ 不写入
 * - body = md.slice(match[0].length)(frontmatter 块整体剥除,含其后的换行)
 */
import { parseFrontmatter } from "../../dist/core/frontmatter.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`frontmatter 断言失败:${msg}`);
}

export async function run() {
  // ---- 1. 正常 title/author/date ----
  const r1 = parseFrontmatter(`---
title: 完整标题
author: 作者甲
date: 2026-08-10
---

正文第一段。
`);
  assert(r1.metadata.title === "完整标题", "title 应解析");
  assert(r1.metadata.author === "作者甲", "author 应解析");
  assert(r1.metadata.date === "2026-08-10", "date 应解析(原样字符串)");
  assert(r1.body === "\n正文第一段。\n", "body 应剥除 frontmatter 块(含其后换行)");

  // ---- 2. 引号剥离(双/单);未闭合引号原样保留 ----
  const r2 = parseFrontmatter("---\ntitle: \"带引号标题\"\nauthor: '单引号作者'\n---\n\n正文");
  assert(r2.metadata.title === "带引号标题", "双引号应剥离");
  assert(r2.metadata.author === "单引号作者", "单引号应剥离");
  const r3 = parseFrontmatter('---\ntitle: "未闭合\n---\n');
  assert(r3.metadata.title === '"未闭合', "未闭合引号应原样保留(不剥离)");

  // ---- 3. 注释行与空行跳过 ----
  const r4 = parseFrontmatter(`---
# 这是注释行
title: 标题X

# 又一行注释
author: 作者
---
正文`);
  assert(r4.metadata.title === "标题X" && r4.metadata.author === "作者", "注释行/空行应跳过,键仍生效");

  // ---- 4. key 大小写不敏感 + date 原样字符串 ----
  const r5 = parseFrontmatter("---\nTITLE: 大写键\ndate: 2026/08/10\n---\n");
  assert(r5.metadata.title === "大写键", "key 应转小写后匹配(TITLE → title)");
  assert(r5.metadata.date === "2026/08/10", "date 非标准格式应原样保留");

  // ---- 5. 值内含冒号:取首个冒号后全部 ----
  const r6 = parseFrontmatter("---\ntitle: 标题:带冒号\n---\n");
  assert(r6.metadata.title === "标题:带冒号", "值内冒号应保留");

  // ---- 6. 非白名单 key / 无冒号行忽略 ----
  const r7 = parseFrontmatter("---\ntags: a,b\nplain line\nkeywords: [x]\n---\n");
  assert(Object.keys(r7.metadata).length === 0, "非白名单 key 与无冒号行应忽略");

  // ---- 7. 空值跳过(title: / author: "") ----
  const r8 = parseFrontmatter('---\ntitle:\nauthor: ""\n---\n');
  assert(!("title" in r8.metadata) && !("author" in r8.metadata), "空值(含空引号剥离后)不应写入 metadata");

  // ---- 8. `---` 不闭合 → 整块当正文,不抛错 ----
  const r9 = parseFrontmatter("---\ntitle: 未闭合\n正文继续");
  assert(Object.keys(r9.metadata).length === 0, "不闭合 frontmatter 不应产生 metadata");
  assert(r9.body === "---\ntitle: 未闭合\n正文继续", "不闭合时 body 应为原 md(不丢内容)");

  // ---- 9. 首行非 --- → 不解析 ----
  const r10 = parseFrontmatter("正文\n---\ntitle: x\n---\n");
  assert(
    Object.keys(r10.metadata).length === 0 && r10.body === "正文\n---\ntitle: x\n---\n",
    "首行非 --- 应整体视为正文(不解析)",
  );

  // ---- 10. 空 frontmatter 块(按实现实际行为断言) ----
  // 正则 ^[ \t]*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$):关闭定界后仅剥除
  // 一个换行;定界相邻时内容组后缺 \r?\n → 整体不匹配(整块当 body,不抛错)。
  // 定界行相邻(---\n---,无空行)→ 不识别为 frontmatter(整块原样为 body)
  const r11a = parseFrontmatter("---\n---\n正文");
  assert(Object.keys(r11a.metadata).length === 0, "相邻 --- 不应产生 metadata");
  assert(r11a.body === "---\n---\n正文", "相邻 ---(无空行)不识别为 frontmatter,整块为 body");
  // 空行分隔(---\n\n---)→ 识别为空 frontmatter 块并剥除
  const r11b = parseFrontmatter("---\n\n---\n正文");
  assert(Object.keys(r11b.metadata).length === 0, "空行分隔的空 frontmatter 不应产生 metadata");
  assert(r11b.body === "正文", "空 frontmatter 块应剥除");
  // 关闭定界后再空行(---\n\n---\n\n正文)→ 仅剥除一个换行,body 保留前导 \n
  // (与普通 frontmatter 一致:---\ntitle: x\n---\n\n正文 → body="\n正文";前导换行
  // 对 markdown 解析惰性,属既有实现行为)
  const r11c = parseFrontmatter("---\n\n---\n\n正文");
  assert(Object.keys(r11c.metadata).length === 0, "关闭定界后空行仍为空 frontmatter(无 metadata)");
  assert(r11c.body === "\n正文", "关闭定界后仅剥除一个换行,body 保留前导换行");

  // ---- 11. 仅元数据无正文 ----
  const r12 = parseFrontmatter("---\ntitle: 只有元数据\n---\n");
  assert(r12.metadata.title === "只有元数据", "仅元数据也应解析");
  assert(r12.body === "", "无正文时 body 应为空串");

  // ---- 12. 开头/结尾 --- 带空格 ----
  const r13 = parseFrontmatter("  ---\ntitle: 带空格定界\n---  \n");
  assert(r13.metadata.title === "带空格定界", "开头/结尾 --- 带空格应正常解析");

  // ---- 13. CRLF 行尾 ----
  const r14 = parseFrontmatter("---\r\ntitle: CRLF标题\r\n---\r\n\r\n正文");
  assert(r14.metadata.title === "CRLF标题", "CRLF 行尾应正常解析");
  assert(r14.body === "\r\n正文", "CRLF 下 body 应剥除块与换行");

  // ---- 14. 无 frontmatter 的普通 md ----
  const r15 = parseFrontmatter("# 标题\n正文");
  assert(
    Object.keys(r15.metadata).length === 0 && r15.body === "# 标题\n正文",
    "无 frontmatter 时原样返回",
  );

  // ---- 15. value 前后空格 trim ----
  const r16 = parseFrontmatter("---\ntitle:    带前导空格值   \n---\n");
  assert(r16.metadata.title === "带前导空格值", "value 应 trim 后取值");

  console.log("[ok] frontmatter:引号剥离/注释跳过/大小写/异常格式兜底 断言通过");
}
