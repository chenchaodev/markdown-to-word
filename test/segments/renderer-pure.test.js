/**
 * renderer 纯函数层直测(B1,R8 收尾评审缺口):
 * - isMarkdown/baseName/truncateMiddle/stageText/STAGE_PERCENT 原在 utils.ts,
 *   被 dom.ts 顶层 import 挡住无法 Node 直测;R8 收尾评审定为缺口,
 *   B1 拆出 src/renderer/pure.ts(零 import)后经 dist/renderer/pure.js 直接断言
 * - 契约:utils.ts re-export 保持 renderer 内部 import 路径不变
 *   (renderer.ts 等仍从 ./utils.js 导入),本段直测 pure.js 即测同一实现
 */
import {
  isMarkdown,
  baseName,
  truncateMiddle,
  STAGE_TEXT,
  stageText,
  STAGE_PERCENT,
  formatRecentTime,
  batchRetryPaths,
  batchSuccessPaths,
} from "../../dist/renderer/pure.js";

/** renderer 纯函数单测(纯 Node 段,零 Electron API) */
export async function run() {
  // ---------- isMarkdown ----------
  const passCases = [
    "a.md",
    "a.MD", // 大写扩展名
    "a.Md",
    "a.markdown",
    "a.MARKDOWN",
    "dir/a.md", // posix 路径
    "dir\\a.md", // win32 路径
    "dir.with.dot/a.markdown", // 目录名含点不影响扩展名判定
  ];
  for (const input of passCases) {
    if (!isMarkdown(input)) {
      throw new Error(`isMarkdown 断言失败: ${JSON.stringify(input)} 应通过`);
    }
  }
  const rejectCases = [
    "a.txt",
    "a.docx",
    "a.pdf",
    "a", // 无扩展名
    "a.md.txt", // 扩展名非 md/markdown 结尾
    "a.mdx", // .md 前缀但不以 .md 结尾
    "", // 空串
    "a.md ", // 尾部空白不算扩展名
  ];
  for (const input of rejectCases) {
    if (isMarkdown(input)) {
      throw new Error(`isMarkdown 断言失败: ${JSON.stringify(input)} 应拒绝`);
    }
  }
  console.log(`[ok] isMarkdown:${passCases.length} 通过 + ${rejectCases.length} 拒绝(.md/.markdown 大小写变体/非 md/无扩展名)`);

  // ---------- baseName ----------
  const baseCases = [
    // win32 反斜杠路径
    ["C:\\Users\\chenc\\docs\\a.md", "a.md"],
    // posix 正斜杠路径
    ["/home/user/docs/a.md", "a.md"],
    // 无分隔符文件名
    ["a.md", "a.md"],
    // 混合分隔符:取最后一个分隔符之后
    ["dir/sub\\a.md", "a.md"],
    // 根路径结尾(空文件名兜底返回原文)
    ["/home/", ""],
  ];
  for (const [input, expected] of baseCases) {
    const actual = baseName(input);
    if (actual !== expected) {
      throw new Error(`baseName 断言失败: ${JSON.stringify(input)} → ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
    }
  }
  console.log(`[ok] baseName:${baseCases.length} 组断言通过(win32 反斜杠/posix 正斜杠/无分隔符)`);

  // ---------- truncateMiddle ----------
  // 短文本(含恰好 max 长度)原样返回
  const shortCases = ["hello", "a".repeat(88)];
  for (const input of shortCases) {
    if (truncateMiddle(input) !== input) {
      throw new Error(`truncateMiddle 断言失败:短文本 ${input.length} 字符应原样返回`);
    }
  }
  // 长文本:默认 max=88 → head=ceil(88*0.62)=55,tail=88-55-1=32
  const longText = "a".repeat(100);
  const truncated = truncateMiddle(longText);
  const expectedHead = 55;
  const expectedTail = 32;
  if (truncated.length !== 88) {
    throw new Error(`truncateMiddle 断言失败:长文本结果应为 88 字符,实际 ${truncated.length}`);
  }
  if (!truncated.startsWith("a".repeat(expectedHead)) || !truncated.endsWith("a".repeat(expectedTail))) {
    throw new Error(`truncateMiddle 断言失败:首部 ${expectedHead} 字符与尾部 ${expectedTail} 字符应保留,实际 ${JSON.stringify(truncated)}`);
  }
  if (truncated[expectedHead] !== "…") {
    throw new Error(`truncateMiddle 断言失败:中间应为省略号,实际 ${JSON.stringify(truncated[expectedHead])}`);
  }
  // 自定义 max=20 → head=ceil(20*0.62)=13,tail=20-13-1=6
  const customMax = 20;
  const truncatedCustom = truncateMiddle("x".repeat(30), customMax);
  if (truncatedCustom.length !== customMax) {
    throw new Error(`truncateMiddle 断言失败:自定义 max=${customMax} 结果长度应等于 max,实际 ${truncatedCustom.length}`);
  }
  if (!truncatedCustom.startsWith("x".repeat(13)) || !truncatedCustom.endsWith("x".repeat(6))) {
    throw new Error(`truncateMiddle 断言失败:自定义 max 首部 13/尾部 6 保留,实际 ${JSON.stringify(truncatedCustom)}`);
  }
  // 中文长文本(BMP 单码元,slice 按码元计)
  const truncatedCn = truncateMiddle("中".repeat(100));
  if (truncatedCn.length !== 88 || !truncatedCn.endsWith("中".repeat(32))) {
    throw new Error(`truncateMiddle 断言失败:中文长文本首尾保留异常,实际 ${truncatedCn.length} 字符`);
  }
  console.log("[ok] truncateMiddle:短文本原样/长文本首 55 尾 32 保留+省略号/自定义 max=20/中文 断言通过");

  // ---------- stageText ----------
  const stageCases = [
    ["read", "正在读取文件…"],
    ["render", "正在渲染文档…"],
    ["done", "正在完成…"],
  ];
  for (const [input, expected] of stageCases) {
    const actual = stageText(input);
    if (actual !== expected) {
      throw new Error(`stageText 断言失败: ${JSON.stringify(input)} → ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
    }
  }
  // 未知键/现成中文文案原样兜底
  const fallbackCases = ["unknown", "正在处理中…", ""];
  for (const input of fallbackCases) {
    if (stageText(input) !== input) {
      throw new Error(`stageText 断言失败:未知键 ${JSON.stringify(input)} 应原样兜底`);
    }
  }
  console.log(`[ok] stageText:${stageCases.length} 组映射 + ${fallbackCases.length} 组未知键原样兜底 断言通过`);

  // ---------- STAGE_PERCENT ----------
  const percentCases = [
    ["read", 15],
    ["render", 70],
    ["done", 95],
  ];
  for (const [key, expected] of percentCases) {
    if (STAGE_PERCENT[key] !== expected) {
      throw new Error(`STAGE_PERCENT 断言失败: ${key} 应为 ${expected},实际 ${STAGE_PERCENT[key]}`);
    }
  }
  // 契约:STAGE_TEXT 与 STAGE_PERCENT 键集一致(阶段键一一对应)
  for (const key of Object.keys(STAGE_TEXT)) {
    if (!(key in STAGE_PERCENT)) {
      throw new Error(`STAGE_PERCENT 断言失败:缺 ${key} 键(STAGE_TEXT 与 STAGE_PERCENT 键集应一致)`);
    }
  }
  console.log("[ok] STAGE_PERCENT:read=15/render=70/done=95 + 与 STAGE_TEXT 键集一致 断言通过");

  // ---------- formatRecentTime(批次 11:最近转换相对时间) ----------
  // 固定 now = 2026-08-13 15:00(本地时间构造,避免时区波动;全部断言注入 now)
  const NOW = new Date(2026, 7, 13, 15, 0).getTime();
  const cases = [
    // [ts, now, 期望]
    [new Date(2026, 7, 13, 9, 5).getTime(), NOW, "今天 09:05"], // 当天:补零
    [new Date(2026, 7, 13, 0, 0).getTime(), NOW, "今天 00:00"], // 当天零点
    [new Date(2026, 7, 12, 23, 59).getTime(), NOW, "昨天 23:59"], // 昨天
    [new Date(2026, 0, 5, 8, 0).getTime(), NOW, "1月5日"], // 今年内(跨月):仅日期
    [new Date(2025, 11, 31, 10, 30).getTime(), NOW, "2025年12月31日"], // 跨年:带年份
  ];
  for (const [ts, now, expected] of cases) {
    const actual = formatRecentTime(ts, now);
    if (actual !== expected) {
      throw new Error(`formatRecentTime 断言失败:ts=${ts} → ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
    }
  }
  // 跨月边界:now = 2026-03-02,ts = 2026-02-28 → 昨天是 03-01,28 日应为「2月28日」
  const NOW_MAR = new Date(2026, 2, 2, 0, 0).getTime();
  const feb28 = new Date(2026, 1, 28, 12, 0).getTime();
  if (formatRecentTime(feb28, NOW_MAR) !== "2月28日") {
    throw new Error(`formatRecentTime 断言失败:跨月边界应为「2月28日」,实际 ${JSON.stringify(formatRecentTime(feb28, NOW_MAR))}`);
  }
  // 昨天边界:ts = now 前一天同一时刻 → 昨天
  const prevSame = new Date(2026, 7, 12, 15, 0).getTime();
  if (formatRecentTime(prevSame, NOW) !== "昨天 15:00") {
    throw new Error(`formatRecentTime 断言失败:前一天同一时刻应为「昨天 15:00」,实际 ${JSON.stringify(formatRecentTime(prevSame, NOW))}`);
  }
  // 默认 now 参数:不注入时不应抛错(实际值随运行时刻,仅断言格式骨架)
  const auto = formatRecentTime(new Date().getTime());
  if (!/^(今天|昨天|\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月\d{1,2}日)/.test(auto)) {
    throw new Error(`formatRecentTime 断言失败:默认 now 输出格式异常,实际 ${JSON.stringify(auto)}`);
  }
  console.log("[ok] formatRecentTime:今天/昨天/今年日期/跨年日期/跨月边界/前一天同一时刻/补零/默认 now 断言通过");

  // ---------- batchRetryPaths / batchSuccessPaths(批次 11 迭代 2:重试失败项 / 复制全部路径) ----------
  const items = [
    { ok: true, file: "C:\\ok1.md", outputPath: "C:\\out1.docx" },
    { ok: false, file: "C:\\bad.md", error: "boom" }, // 失败 → 重试目标
    { ok: false, canceled: true, file: "C:\\canceled.md" }, // 取消 → 不重试
    { ok: true, file: "C:\\ok2.md" }, // 成功但无输出路径 → 不复制
    { ok: false, file: "C:\\bad2.md" }, // 失败(无 canceled)→ 重试目标
  ];
  const retry = batchRetryPaths(items);
  if (JSON.stringify(retry) !== JSON.stringify(["C:\\bad.md", "C:\\bad2.md"])) {
    throw new Error(`batchRetryPaths 断言失败:应取失败非取消项且保序,实际 ${JSON.stringify(retry)}`);
  }
  if (batchRetryPaths([]).length !== 0) {
    throw new Error("batchRetryPaths 断言失败:空列表应返回空数组");
  }
  const copied = batchSuccessPaths(items);
  if (JSON.stringify(copied) !== JSON.stringify(["C:\\out1.docx"])) {
    throw new Error(`batchSuccessPaths 断言失败:应取成功且有输出路径项且保序,实际 ${JSON.stringify(copied)}`);
  }
  if (batchSuccessPaths([]).length !== 0) {
    throw new Error("batchSuccessPaths 断言失败:空列表应返回空数组");
  }
  console.log("[ok] batchRetryPaths/batchSuccessPaths:失败非取消项与成功输出路径提取(保序/取消排除/缺路径排除/空列表)断言通过");
}
