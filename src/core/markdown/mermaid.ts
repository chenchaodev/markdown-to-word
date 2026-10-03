/**
 * Mermaid 图表渲染契约:
 * 渲染发生在 main 进程隐藏 BrowserWindow,core 层经注入 resolver
 * 获取结果(仿 imageResolver / katexDir 注入模式,保持 core 纯逻辑无 Electron)。
 * - svg:完整 SVG 字符串(pdf 端直接内联进正文 HTML,免脚本免等待)
 * - png:2x 像素密度 PNG(docx 端内嵌,供 Word/WPS 显示)
 * - width/height:逻辑像素(1x),docx transformation 直接用
 *   (宽 > 400 由 docx 侧等比缩放,与行内图片共用缩放逻辑)
 * resolver 返回 null = 渲染失败,调用方按各自降级策略处理
 * (docx:等宽代码块原文 + 警告;pdf:mermaid-fallback 代码块 + 警告)。
 *
 * 信任边界假设:svg/png 均来自本地 Mermaid 渲染服务
 * (main 进程隐藏 BrowserWindow,输入为用户自己的 markdown 围栏代码),
 * 属受信输入——core 层不做消毒/校验,svg 直接内联进 pdf 正文 HTML、
 * png 直接内嵌 docx;若未来渲染服务改为接收不可信来源,须先在服务侧补消毒。
 */
import type { Root } from "mdast";

export interface MermaidResult {
  svg: string;
  png: Buffer;
  width: number;
  height: number;
}

/** Mermaid 渲染回调:给定代码块原文,返回渲染结果;null/抛错 = 渲染失败需降级 */
export type MermaidResolver = (code: string) => Promise<MermaidResult | null>;

/**
 * 代码块语言标记单源(docx / pdf 两个渲染器与 `containsMermaidCode` 共用)。
 *
 * 为什么要有这个常量:不注入 resolver 时 core **静默**把 mermaid 围栏按普通代码块渲染
 * (renderCode 的既有契约),**不产生任何警告**。于是「这份文档有没有 mermaid」这件事
 * 只有渲染器内部知道。而 MCP 交付面必须把降级**对 agent 声明**(返回值带
 * `degraded: ["mermaid"]`),否则就是一台「同样输入、偶尔产出不同」的工具 ——
 * 声明方和渲染方各自写一份 `lang === "mermaid"` 字面量,改一处忘另一处就会
 * 出现「声明降级但其实渲染了图」或反之。故收敛到此。
 */
export const MERMAID_LANG = "mermaid";

/**
 * 文档是否含 mermaid 代码块 —— 不注入 resolver 的交付面据此声明降级。
 *
 * 只做「有没有」的判定,不统计、不定位:声明方需要的是布尔,细节交给
 * 产物本身(降级后的围栏以原文出现在文档里,agent 自己看得到)。
 *
 * 遍历用显式栈而非递归:深层嵌套的 markdown(引用块套列表套引用块)下
 * 递归深度不可控,而本函数要跑在长驻的 MCP server 里。
 *
 * @param root parseMarkdown 的产物
 */
export function containsMermaidCode(root: Root): boolean {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as { type?: unknown; lang?: unknown; children?: unknown };
    if (node === null || typeof node !== "object") continue;
    if (node.type === "code" && node.lang === MERMAID_LANG) return true;
    if (Array.isArray(node.children)) stack.push(...node.children);
  }
  return false;
}
