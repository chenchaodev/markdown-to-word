/**
 * main Markdown 准备链单测：解码、Obsidian/AI 预处理与 frontmatter 解析必须同源。
 * 该段不依赖 Electron 窗口，直接覆盖转换/预览/预检共同消费的 helper。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { DEFAULT_SETTINGS } from "../../dist/core/settings/settings-defaults.js";
import { prepareMarkdown, prepareMarkdownText } from "../../dist/main/converter/preprocess.js";
import { precheckMarkdown } from "../../dist/core/markdown/precheck.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`preprocess 断言失败:${msg}`);
}

export async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "m2w-preprocess-"));
  try {
    const mdPath = path.join(dir, "sample.md");
    await fs.writeFile(
      mdPath,
      "---\r\ntitle: [[原始标题]]\r\nauthor: 测试\r\n---\r\n\r\n# 标题\r\n\r\n[[目标]]\r\n",
      "utf8",
    );
    const settings = {
      ...DEFAULT_SETTINGS,
      aiCleanup: true,
      obsidianCompat: true,
      obsidianAttachmentFolder: "Attachments",
    };
    const prepared = await prepareMarkdown(mdPath, settings);
    assert(prepared.metadata.title === "[[原始标题]]", "frontmatter title 不应被 Obsidian 预处理改写");
    assert(prepared.metadata.author === "测试", "frontmatter CRLF 应完整解析");
    assert(
      prepared.markdown.startsWith("---\r\ntitle: [[原始标题]]\r\nauthor: 测试\r\n---\r\n"),
      "frontmatter 原文与 CRLF 应原样拼回",
    );
    assert(!prepared.body.startsWith("---"), "body 不应保留 frontmatter");
    assert(prepared.body.includes("# 标题"), "预处理后应保留正文标题");
    assert(!prepared.body.includes("[[目标]]"), "Obsidian 双链应走统一预处理链");

    // 开关关闭时保持解码文本字节语义；frontmatter 与正文的三种换行均不重写。
    for (const newline of ["\n", "\r\n", "\r"]) {
      const raw = `---${newline}title: [[原始标题]]${newline}---${newline}[[目标]]${newline}`;
      const untouched = prepareMarkdownText(raw, DEFAULT_SETTINGS);
      assert(untouched.markdown === raw, `关闭预处理开关时 ${newline === "\r" ? "CR" : newline === "\r\n" ? "CRLF" : "LF"} 应字节级不变`);
      assert(untouched.body === `[[目标]]${newline}`, "关闭预处理时 body 应保持原文");
      assert(untouched.metadata.title === "[[原始标题]]", "换行变体不应影响 frontmatter metadata");
    }

    const gbkPath = path.join(dir, "gbk.md");
    await fs.writeFile(gbkPath, iconv.encode("# 你好世界\n\n正文\n", "gbk"));
    const warnings = [];
    const gbkPrepared = await prepareMarkdown(gbkPath, settings, warnings);
    assert(gbkPrepared.markdown.includes("你好世界"), "GBK 应经统一解码链正确读取");
    assert(
      warnings.length === 1 && warnings[0].key === "warn.gbkEncoding",
      "GBK 准备应产生统一编码 warning",
    );
    const precheckWarnings = precheckMarkdown(
      "![缺失](./missing-image.png)\n",
      dir,
    );
    assert(
      precheckWarnings.some((warning) => warning.key === "warn.imageNotFound"),
      "准备后的正文仍应交给 precheck 做静态检查",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
