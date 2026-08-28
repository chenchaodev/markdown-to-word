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
export interface MermaidResult {
  svg: string;
  png: Buffer;
  width: number;
  height: number;
}

/** Mermaid 渲染回调:给定代码块原文,返回渲染结果;null/抛错 = 渲染失败需降级 */
export type MermaidResolver = (code: string) => Promise<MermaidResult | null>;
