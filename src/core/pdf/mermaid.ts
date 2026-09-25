/**
 * pdf Mermaid 占位替换:highlight 占位 → 内联 SVG / 降级代码块单源。
 * 取消:逐个占位设检查点,resolver 等待与取消竞速(回调不配合取消也能退出);
 * 取消不降级为 mermaid 渲染失败警告(否则转换会带着未渲染图表继续跑完并报成功)。
 */
import { decodeEntities, escapeHtml } from "../util/utils.js";
import { mermaidEmptyWarning, mermaidFailedWarning, type ConvertWarning } from "../i18n.js";
import type { MermaidResolver } from "../markdown/mermaid.js";
import { isConversionCanceled, type CancellationGuard } from "../cancel.js";

/**
  * Mermaid 占位替换:扫描 highlight 回调产出的 <div class="mermaid">…</div>
  * (内容为 escapeHtml 后的代码文本,占位内无原生 </div>,正则非贪婪匹配安全),
  * decodeEntities 还原原码后逐个 await mermaidResolver 渲染 → 成功替换为内联
  * SVG 容器;失败(null/抛错)→ 降级为 mermaid-fallback 等宽代码块 + 警告
  * (与 docx 侧降级语义一致,内容不丢失、不中断转换)。异步串行执行保持文档
  * 顺序;无占位(含未注入 resolver 时 highlight 不产占位)原样返回。
  * guard(可选)由 render 层注入:逐占位检查点 + 与 resolver 竞速。
  */
export async function replaceMermaidPlaceholders(
  html: string,
  resolver: MermaidResolver | undefined,
  warnings: ConvertWarning[],
  guard?: CancellationGuard,
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
    guard?.throwIfCanceled();
    out += html.slice(cursor, p.index);
    const code = decodeEntities(p.body);
    try {
      const pending = resolver?.(code);
      // 与取消竞速:隐藏窗口渲染服务若不配合取消,取消后立即退出而非等它回包
      const result = pending && guard ? await guard.race(pending) : await pending;
      if (result) {
        out += `<div class="mermaid-svg">${result.svg}</div>`;
      } else {
        warnings.push(mermaidEmptyWarning());
        out += fallback(code);
      }
    } catch (err) {
      if (isConversionCanceled(err)) throw err; // 取消不降级为渲染失败
      const reason = err instanceof Error ? err.message : String(err);
      warnings.push(mermaidFailedWarning(reason));
      out += fallback(code);
    }
    cursor = p.index + p.full.length;
  }
  out += html.slice(cursor);
  return out;
}
