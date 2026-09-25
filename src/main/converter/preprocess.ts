/**
 * Markdown 准备编排：解码 → frontmatter 隔离 → Obsidian/AI 预处理 → 原样拼回。
 * 所有转换、预览与预检入口共用此 helper，避免各入口对编码、开关和
 * frontmatter 的理解漂移。文件 IO 仍只发生在此处，消费端拿到的 markdown
 * 可直接交给 core；body/metadata 同时作为预检等消费者的统一契约。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { AppSettings } from "../../core/settings/settings-defaults.js";
import type { ConvertWarning } from "../../core/i18n.js";
import { parseFrontmatter, type DocMetadata } from "../../core/pipeline/frontmatter.js";
import { decodeMarkdown } from "../../core/util/encoding.js";
import { cleanupMarkdown } from "../../core/markdown/ai-cleanup.js";
import { normalizeObsidian } from "../../core/markdown/obsidian.js";

/** 准备结果：markdown 保留完整 frontmatter，body/metadata 是其解析契约。 */
export interface PreparedMarkdown {
  /** 预处理后的完整 Markdown（交给 convert/merge）。 */
  markdown: string;
  /** 去除 frontmatter 后的正文（交给 precheck/其它静态检查）。 */
  body: string;
  /** 解析出的 frontmatter 元数据。 */
  metadata: DocMetadata;
}

/**
 * 对原始 markdown 做转换前规整。
 * 顺序：先解析并隔离 frontmatter，再只对正文执行 Obsidian 语法归一与 AI 清理，
 * 最后原样拼回 frontmatter。两开关独立，仅启用项生效；均未启用时正文与 frontmatter
 * 均保持解码后的原文。
 */
export function preprocessMarkdown(md: string, settings: AppSettings): string {
  const parsed = splitFrontmatter(md);
  return parsed.frontmatter + preprocessBody(parsed.body, settings);
}

interface SplitMarkdown {
  frontmatter: string;
  body: string;
  metadata: DocMetadata;
}

/** 先用正式 frontmatter parser 隔离原文前缀,再把正文交给预处理。 */
function splitFrontmatter(md: string): SplitMarkdown {
  const parsed = parseFrontmatter(md);
  return {
    // parseFrontmatter 的 body 是原文后缀;解析失败时 body===md,前缀自然为空。
    frontmatter: md.slice(0, md.length - parsed.body.length),
    body: parsed.body,
    metadata: parsed.metadata,
  };
}

/** 只处理正文,避免把 frontmatter 的 metadata 送进 Obsidian/AI 规则。 */
function preprocessBody(body: string, settings: AppSettings): string {
  let out = body;
  if (settings.obsidianCompat) {
    out = normalizeObsidian(out, { attachmentFolder: settings.obsidianAttachmentFolder });
  }
  if (settings.aiCleanup) {
    out = cleanupMarkdown(out);
  }
  return out;
}

/** 文本准备链：与文件准备入口共用，确保内存调用也不绕过 frontmatter 契约。 */
export function prepareMarkdownText(md: string, settings: AppSettings): PreparedMarkdown {
  const parsed = splitFrontmatter(md);
  const body = preprocessBody(parsed.body, settings);
  return {
    markdown: parsed.frontmatter + body,
    body,
    metadata: parsed.metadata,
  };
}

/**
 * 文件准备链：读取字节并解码，再走唯一的文本准备链。
 * gbkKey 由调用方给出：单文件/预览使用通用警告，合并按文件给出文件名。
 */
export async function prepareMarkdown(
  filePath: string,
  settings: AppSettings,
  warnings?: ConvertWarning[],
  gbkKey: "warn.gbkEncoding" | "warn.gbkEncodingFile" = "warn.gbkEncoding",
): Promise<PreparedMarkdown> {
  const { text, encoding } = decodeMarkdown(await fs.readFile(filePath));
  if (encoding === "gbk" && warnings) {
    warnings.push(
      gbkKey === "warn.gbkEncodingFile"
        ? {
            key: gbkKey,
            params: { file: path.basename(filePath) },
            fallback: `已按 GBK 编码读取:${path.basename(filePath)}`,
          }
        : { key: gbkKey, fallback: "已按 GBK 编码读取:文件编码非 UTF-8" },
    );
  }
  return prepareMarkdownText(text, settings);
}
