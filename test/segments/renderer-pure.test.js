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
}
