/**
 * pdf Mermaid 占位替换(B8 拆分自 render.ts,行为零变化):
 * highlight 占位 → 内联 SVG / 降级代码块单源。语义注释随代码搬移不精简。
 */
import { decodeEntities, escapeHtml } from "../util/utils.js";
import type { ConvertWarning } from "../i18n.js";
import type { MermaidResolver } from "../markdown/mermaid.js";

/**
 * Mermaid 占位替换(8c):扫描 highlight 回调产出的 <div class="mermaid">…</div>
 * (内容为 escapeHtml 后的代码文本,占位内无原生 </div>,正则非贪婪匹配安全),
 * decodeEntities 还原原码后逐个 await mermaidResolver 渲染 → 成功替换为内联
 * SVG 容器;失败(null/抛错)→ 降级为 mermaid-fallback 等宽代码块 + 警告
 * (与 docx 侧降级语义一致,内容不丢失、不中断转换)。异步串行执行保持文档
 * 顺序;无占位(含未注入 resolver 时 highlight 不产占位)原样返回。
 */
export async function replaceMermaidPlaceholders(
  html: string,
  resolver: MermaidResolver | undefined,
  warnings: ConvertWarning[],
): Promise<string> {
  const placeholderRe = /<div class="mermaid">([\s\S]*?)<\/div>/g;
  const matches: { index: number; full: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = placeholderRe.exec(html)) !== null) {
    matches.push({ index: m.index, full: m[0], body: m[1]! }); // 捕获组结构保证
  }
  if (matches.length === 0) return html;
  const fallback = (code: string): string =>
    `<pre class="mermaid-fallback"><code>${escapeHtml(code)}</code></pre>`;
  let out = "";
  let cursor = 0;
  for (const p of matches) {
    out += html.slice(cursor, p.index);
    const code = decodeEntities(p.body);
    try {
      const result = await resolver?.(code);
      if (result) {
        out += `<div class="mermaid-svg">${result.svg}</div>`;
      } else {
        warnings.push({
          key: "warn.mermaidEmpty",
          fallback: "Mermaid 渲染失败: 渲染服务返回空结果,已降级为代码块",
        });
        out += fallback(code);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      warnings.push({
        key: "warn.mermaidFailed",
        params: { reason },
        fallback: `Mermaid 渲染失败: ${reason},已降级为代码块`,
      });
      out += fallback(code);
    }
    cursor = p.index + p.full.length;
  }
  out += html.slice(cursor);
  return out;
}
