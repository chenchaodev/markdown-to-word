/**
 * renderer 纯函数层(B1 自 utils.ts 拆出,零 DOM 依赖,可 Node 直测):
 * - 来源:R8 自 renderer.ts 抽出(utils.ts);B1 再拆纯函数层——isMarkdown /
 *   baseName / truncateMiddle / STAGE_TEXT / stageText / STAGE_PERCENT 均不触碰
 *   DOM 与 state,原被 utils.ts 的 dom.ts 顶层 import 挡住无法 Node 直测,
 *   现可经 dist/renderer/pure.js 直接导入断言
 * - 本文件零 import(纯函数,契约语义与注释随代码搬移不精简);
 *   utils.ts re-export 保持 renderer 内部 import 路径不变
 *   (renderer.ts 等仍从 ./utils.js 导入)
 */
export function isMarkdown(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath);
}

export function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** 超长路径中间截断,保留首尾(尾部含文件名,信息价值最高)。 */
export function truncateMiddle(text: string, max = 88): string {
  if (text.length <= max) return text;
  const head = Math.ceil(max * 0.62);
  const tail = max - head - 1;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

/* ---------- 转换进度 ---------- */
/** 阶段文案:主进程可能发「read」等键名,也可能是现成中文文案,原样兜底。 */
export const STAGE_TEXT: Record<"read" | "render" | "done", string> = {
  read: "正在读取文件…",
  render: "正在渲染文档…",
  done: "正在完成…",
};

export function stageText(stage: string): string {
  return STAGE_TEXT[stage as keyof typeof STAGE_TEXT] ?? stage;
}

/** 阶段 → 进度百分比(主进程只发阶段键,映射近似进度:读取 15% / 渲染 70% / 完成 95%)。 */
export const STAGE_PERCENT: Record<string, number> = { read: 15, render: 70, done: 95 };