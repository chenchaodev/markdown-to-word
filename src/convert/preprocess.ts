/**
 * Markdown 准备编排:解码 → frontmatter 隔离 → 渲染前变换 → 原样拼回。
 * 所有转换、预览与预检入口共用此 helper,避免各入口对编码与 frontmatter 的理解漂移。
 *
 * 薄壳的边界(见 adr-027 决定要点三):本文件只做两件事 —— frontmatter 的隔离与
 * 拼回、IO(读文件 / 解码 / warning 收集)。「渲染前变换」阶段的分派在 core
 * (markdown/preprocess-body.ts),故此处不出现任何变换类键名:新增一个变换键组时
 * 本文件无须改动。文件 IO 仍只发生在此处,消费端拿到的 markdown 可直接交给 core;
 * body/metadata 同时作为预检等消费者的统一契约。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { AppSettings } from "../core/settings/settings-defaults.js";
import type { ConvertWarning } from "../core/i18n.js";
import { parseFrontmatter, type DocMetadata } from "../core/pipeline/frontmatter.js";
import { decodeMarkdown } from "../core/text/encoding.js";
import { preprocessBody } from "../core/markdown/preprocess-body.js";

/** 准备结果:markdown 保留完整 frontmatter,body/metadata 是其解析契约。 */
export interface PreparedMarkdown {
  /** 预处理后的完整 Markdown(交给 convert/merge)。 */
  markdown: string;
  /** 去除 frontmatter 后的正文(交给 precheck/其它静态检查)。 */
  body: string;
  /** 解析出的 frontmatter 元数据。 */
  metadata: DocMetadata;
}

/**
 * 单个 markdown 源文件的体积上限:整篇进内存做 AST/HTML 渲染,超过此量级
 * 单文件即可拖垮会话(批量与合并另有总量上限)。32MB 远超正常文档。
 */
// 刻意非用户可配:环境/资源类硬边界,进设置面板即成「调坏即出事」的旋钮。
export const MAX_SOURCE_FILE_BYTES = 32 * 1024 * 1024;

/** 读源文件字节:读前 stat 与读后长度双检,任一超限即拒绝。 */
async function readSourceBytes(filePath: string): Promise<Buffer> {
  let size: number | null = null;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    size = null; // 缺失/不可访问:交由 readFile 抛出原始错误码(错误文案依赖它)
  }
  if (size !== null && size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(
      `文件体积超过上限(${(MAX_SOURCE_FILE_BYTES / 1024 / 1024).toFixed(0)}MB):${path.basename(filePath)}`,
    );
  }
  const data = await fs.readFile(filePath);
  if (data.length > MAX_SOURCE_FILE_BYTES) {
    throw new Error(
      `文件体积超过上限(${(MAX_SOURCE_FILE_BYTES / 1024 / 1024).toFixed(0)}MB):${path.basename(filePath)}`,
    );
  }
  return data;
}

/**
 * 对原始 markdown 做转换前准备:隔离 frontmatter → 交给 core 的变换分派 → 原样拼回。
 * `AppSettings` 结构上即满足 core 的窄阶段契约(它是该契约的超集),故直接传入而
 * 不在此逐键投影 —— 投影会把变换键名复制到 main 侧,枚举点随之从两处变三处,
 * 正是 adr-026 决定要点三要守的上限。
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

/** 文本准备链:与文件准备入口共用,确保内存调用也不绕过 frontmatter 契约。 */
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
 * 文件准备链:读取字节并解码,再走唯一的文本准备链。
 * gbkKey 由调用方给出:单文件/预览使用通用警告,合并按文件给出文件名。
 * 体积闸门:单文件超过 MAX_SOURCE_FILE_BYTES 直接拒绝(读前 stat 拦截,
 * 避免把超大文件整个读进内存;读后再核一次长度,覆盖 stat 之后被替换的情况)。
 * 拒绝而非截断——静默截断会产出缺尾的文档。错误文案 i18n 化列入后续字典维护项。
 */
export async function prepareMarkdown(
  filePath: string,
  settings: AppSettings,
  warnings?: ConvertWarning[],
  gbkKey: "warn.gbkEncoding" | "warn.gbkEncodingFile" = "warn.gbkEncoding",
): Promise<PreparedMarkdown> {
  const { text, encoding } = decodeMarkdown(await readSourceBytes(filePath));
  if (encoding === "gbk" && warnings) {
    warnings.push(
      gbkKey === "warn.gbkEncodingFile"
        ? {
            key: gbkKey,
            params: { file: path.basename(filePath) },
            fallback: `已按 GBK 编码读取:${path.basename(filePath)}`,
          }
        : { key: "warn.gbkEncoding", fallback: "已按 GBK 编码读取:文件编码非 UTF-8" },
    );
  }
  return prepareMarkdownText(text, settings);
}
