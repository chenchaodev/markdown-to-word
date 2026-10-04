// @ts-check
/**
 * main Markdown 准备链单测：解码、Obsidian/AI 预处理与 frontmatter 解析必须同源。
 * 该段不依赖 Electron 窗口，直接覆盖转换/预览/预检共同消费的 helper。
 * AI 清理的档位开关（保守规整 / 结构改写）也在此段断言：档位 → per-rule 开关
 * 的映射，以及「总开关开 + 结构改写关」时产物与该档引入前逐字节一致。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { DEFAULT_SETTINGS } from "../../dist/core/settings/settings-defaults.js";
import {
  prepareMarkdown,
  prepareMarkdownText,
  preprocessMarkdown,
} from "../../dist/convert/preprocess.js";
// 档位 → per-rule 的映射已下沉 core,故从新落点断言(总开关/产物仍经 main 侧断言)。
import { aiCleanupOptions } from "../../dist/core/markdown/ai-cleanup.js";
import { precheckMarkdown } from "../../dist/core/pipeline/precheck.js";
import { removeTree } from "../harness/temp-resource.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`preprocess 断言失败:${msg}`);
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

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
      aiCleanup: { ...DEFAULT_SETTINGS.aiCleanup, enabled: true },
      obsidian: { compat: true, attachmentFolder: "Attachments" },
    };
    const prepared = /** @type {import("../../src/convert/preprocess.js").PreparedMarkdown} */ (
      await prepareMarkdown(mdPath, settings)
    );
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
      const untouched = /** @type {import("../../src/convert/preprocess.js").PreparedMarkdown} */ (
        prepareMarkdownText(raw, DEFAULT_SETTINGS)
      );
      assert(untouched.markdown === raw, `关闭预处理开关时 ${newline === "\r" ? "CR" : newline === "\r\n" ? "CRLF" : "LF"} 应字节级不变`);
      assert(untouched.body === `[[目标]]${newline}`, "关闭预处理时 body 应保持原文");
      assert(untouched.metadata.title === "[[原始标题]]", "换行变体不应影响 frontmatter metadata");
    }

    const gbkPath = path.join(dir, "gbk.md");
    await fs.writeFile(gbkPath, iconv.encode("# 你好世界\n\n正文\n", "gbk"));
    const warnings = /** @type {import("../../src/core/i18n/index.js").KeyedWarning[]} */ ([]);
    const gbkPrepared = await prepareMarkdown(gbkPath, settings, warnings);
    assert(gbkPrepared.markdown.includes("你好世界"), "GBK 应经统一解码链正确读取");
    assert(
      warnings.length === 1 && warnings[0]?.key === "warn.gbkEncoding",
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

    /* ---- AI 清理两档:档位 → per-rule 开关的映射与产物 ---- */
    // 夹具同时含三条保守档输入特征(智能引号/缺空格列表标记/行尾空白)与
    // 三条结构改写档输入特征([1] 引用标记 / emoji / 无 h1 的 ## 标题)。
    const tierMd = ["## 小节 🎉", "", "正文见[1]与 “引号”   ", "-项一"].join("\n");
    /**
     * 档位组合 → 送进 preprocessMarkdown 的设置(总开关恒开)。
     * @param {boolean} tidy 保守规整档
     * @param {boolean} rewrite 结构改写档
     */
    const tierSettings = (tidy, rewrite) => ({
      ...DEFAULT_SETTINGS,
      aiCleanup: { ...DEFAULT_SETTINGS.aiCleanup, enabled: true, tidy, rewrite },
    });

    // (1) 映射:两档 → 六个 per-rule 布尔(分类断言,逐字段)
    const tidyOnlyOpts = aiCleanupOptions({ tidy: true, rewrite: false });
    assert(
      tidyOnlyOpts.normalizeQuotes === true &&
        tidyOnlyOpts.fixListMarkers === true &&
        tidyOnlyOpts.trimBlankLines === true,
      "保守规整档应打开引号/列表/空行三条规则",
    );
    assert(
      tidyOnlyOpts.stripCitationMarkers === false &&
        tidyOnlyOpts.stripEmoji === false &&
        tidyOnlyOpts.fixHeadingLevels === false,
      "结构改写档关闭时,引用标记/emoji/标题层级三条规则必须为 false",
    );
    const rewriteOnlyOpts = aiCleanupOptions({ tidy: false, rewrite: true });
    assert(
      rewriteOnlyOpts.normalizeQuotes === false &&
        rewriteOnlyOpts.fixListMarkers === false &&
        rewriteOnlyOpts.trimBlankLines === false,
      "保守规整档关闭时,引号/列表/空行三条规则必须为 false",
    );
    assert(
      rewriteOnlyOpts.stripCitationMarkers === true &&
        rewriteOnlyOpts.stripEmoji === true &&
        rewriteOnlyOpts.fixHeadingLevels === true,
      "结构改写档应打开引用标记/emoji/标题层级三条规则",
    );
    console.log("[ok] preprocess:AI 清理两档 → 六个 per-rule 开关的映射分类断言通过");

    // (2) 产物:总开关开 + 结构改写关 → 与结构改写档引入前逐字节一致
    //     (结构改写档的三类痕迹 [1] / emoji / ## 全部原样保留,只余保守档规整)
    const tidyOnlyOut = preprocessMarkdown(tierMd, tierSettings(true, false));
    assert(
      tidyOnlyOut === '## 小节 🎉\n\n正文见[1]与 "引号"\n- 项一',
      `总开关开 + 结构改写关的产物应逐字节等于结构改写档引入前,实际 ${JSON.stringify(tidyOnlyOut)}`,
    );
    assert(
      tidyOnlyOut.includes("[1]") && tidyOnlyOut.includes("🎉") && tidyOnlyOut.startsWith("## "),
      "结构改写关时,引用标记/emoji/标题井号都应原样保留",
    );
    // 总开关开 + 两档全关 → 全部规则关闭的零改动契约(cleanupMarkdown 的短路分支)
    const noTierOut = preprocessMarkdown(tierMd, tierSettings(false, false));
    assert(noTierOut === tierMd, "两档全关时正文应字节级不变");
    // 总开关关 → 整段跳过,即便两档皆开也不生效(子开关不得绕过总开关)
    const masterOffOut = preprocessMarkdown(tierMd, {
      ...DEFAULT_SETTINGS,
      aiCleanup: { enabled: false, tidy: true, rewrite: true },
    });
    assert(
      masterOffOut === tierMd,
      "总开关关闭时,即便两个分档皆开也不得改写正文(分档不是旁路)",
    );

    // (3) 反向对照:结构改写开时三类痕迹确实被改写(证明传参是活的,不是恒 false)
    const bothOnOut = preprocessMarkdown(tierMd, tierSettings(true, true));
    assert(
      bothOnOut === '# 小节\n\n正文见与 "引号"\n- 项一',
      `两档全开时结构改写档应生效(清 [1]/emoji、标题上移一级),实际 ${JSON.stringify(bothOnOut)}`,
    );
    assert(bothOnOut !== tidyOnlyOut, "结构改写开关必须真的改变产物(否则传参是死的)");
    console.log("[ok] preprocess:总开关开 + 结构改写关 → 产物与结构改写档引入前逐字节一致(总开关关/两档全关的零改动对照)");
  } finally {
    // 清理失败刻意吞掉:finally 里的清理不得盖过段内真正的断言失败(助手只负责吸收 Windows 上的瞬时占用)
    removeTree(dir);
  }
}
