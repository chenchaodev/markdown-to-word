/**
 * 转换前文本预处理编排：按设置开关组合 Obsidian 兼容与 AI 清理。
 * 纯逻辑（仅依赖 core 纯函数 + 设置类型），供 main 转换入口在
 * readMarkdownDecoded 之后、convert 之前调用；双格式共用、零重复。
 */
import type { AppSettings } from "../../core/settings/settings-defaults.js";
import { cleanupMarkdown } from "../../core/markdown/ai-cleanup.js";
import { normalizeObsidian } from "../../core/markdown/obsidian.js";

/**
 * 对原始 markdown 做转换前规整。
 * 顺序：先 Obsidian 语法归一（产出标准 Markdown），再 AI 清理（规整格式）。
 * 两开关独立，仅启用项生效；均未启用时原样返回（零开销）。
 */
export function preprocessMarkdown(md: string, settings: AppSettings): string {
  let out = md;
  if (settings.obsidianCompat) {
    out = normalizeObsidian(out, { attachmentFolder: settings.obsidianAttachmentFolder });
  }
  if (settings.aiCleanup) {
    out = cleanupMarkdown(out);
  }
  return out;
}
