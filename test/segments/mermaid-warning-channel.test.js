// @ts-check
/**
 * Mermaid 失败原因上屏段(本批健壮性加固的跨域守护段;被测为
 * src/main/services/mermaid-service.ts + src/main/converter/{single,merge}.ts 的接线,
 * 经 dist/ 真实实现,electron 环境):
 *
 * 问题:渲染失败原因此前只进 console(`[mermaid-service] render failed: …`),
 * UI 侧只能看到 core 依「返回 null」生成的 warn.mermaidEmpty
 * ——「渲染服务返回空结果」,用户与排障者都拿不到真因(语法错误 / 超时 / 窗口崩溃 / 脚本加载失败)。
 * 修法:服务导出严格模式 renderMermaidStrict(失败抛错并带 reason),转换链路把它作为
 * core 的 mermaidResolver 注入,由 core **既有** warning 通道(warn.mermaidFailed + ${reason},
 * 字典已注册,无新措辞)把原因呈现在 UI 上;降级语义不变(仍渲染为代码块、不中断转换)。
 * 断言面:
 * 1. 严格模式对真实失败(语法错误)抛 MermaidRenderError 且 reason 非空;
 * 2. core warning 通道收到带 reason 的 warn.mermaidFailed,且 formatWarning 渲染出的
 *    文案确实含该 reason(= renderer 展示层拿到的那份文本);
 * 3. 对照组:只降级的 renderMermaid 走同一通道但只有 warn.mermaidEmpty(无原因)——
 *    证明差异来自接线,不是 core 行为变化;
 * 4. 降级不回归:docx 产物无内嵌图片、代码原文保留、转换未失败;
 * 5. main 转换链路端到端:convertImpl 返回的 warnings 里就是这条带原因的警告
 *    (证明 single.ts 真的注入了严格模式,而不只是服务里多了一个导出);
 * 6. 会话换代导致的主动放弃仍返回 null 而非抛错(退出路径不制造假警告)。
 * 产物/样例落 os.tmpdir() 独立目录,finally 整体删除;段末 dispose 隐藏渲染窗口。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { convert } from "../../dist/core/convert.js";
import { formatWarning } from "../../dist/core/i18n.js";
import {
  disposeMermaidService,
  MermaidRenderError,
  renderMermaid,
  renderMermaidStrict,
} from "../../dist/main/services/mermaid-service.js";
import { convertImpl, createConvertContext } from "../../dist/main/converter/index.js";
import { getKatexDir } from "../../dist/main/services/resource-dirs.js";
import { updateSettings } from "../../dist/main/persist/settings.js";
import { backupSettings } from "../common/settings.js";
import { asDocxArtifact } from "../common/convert-helpers.js";
import { unzipPart } from "../common/docx-utils.js";
import { FIXTURES_DIR } from "../common/paths.js";

/** @typedef {import("../../src/core/i18n.js").ConvertWarning} Warning */
/** @typedef {import("../../src/core/i18n.js").KeyedWarning} KeyedWarning */

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`mermaid-warning-channel 断言失败:${msg}`);
}

/** 语法不闭合的 mermaid 围栏:页面内 parse 预检必失败(真实失败,非构造) */
const MD_BAD_MERMAID = "# 图表\n\n```mermaid\ngraph TD;\nA[unclosed\n```\n";

/**
 * 取 warnings 中指定 key 的那一条(只认 keyed 警告,字符串警告不含 key)。
 * @param {Warning[]} warnings 警告数组
 * @param {string} key 字典 key
 * @returns {KeyedWarning | null} 命中的警告或 null
 */
function pickKeyed(warnings, key) {
  for (const w of warnings) {
    if (typeof w !== "string" && w.key === key) return w;
  }
  return null;
}

export const meta = { description: "Mermaid 渲染失败原因经既有 warning 通道在 UI 可见" };
// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-mermaid-warning-${process.pid}`);
  await fs.mkdir(dir, { recursive: true });
  const backup = await backupSettings();
  try {
    // ---- 1. 严格模式:真实语法错误 → 抛 MermaidRenderError 且带非空 reason ----
    /** @type {string} */
    let reason = "";
    try {
      await renderMermaidStrict("graph TD;\nA[unclosed");
    } catch (err) {
      assert(err instanceof MermaidRenderError, `失败应抛 MermaidRenderError,实际 ${String(err)}`);
      reason = err.reason;
    }
    assert(reason.length > 0, "严格模式失败必须带非空 reason(否则 UI 拿不到真因)");
    console.log(`[ok] mermaid-warning-channel:严格模式失败抛 MermaidRenderError(reason=${JSON.stringify(reason)})`);

    // ---- 2+3+4. core 既有 warning 通道:严格模式带原因,只降级模式不带;降级不回归 ----
    /** @type {Warning[]} */
    const strictWarnings = [];
    const strictDocx = asDocxArtifact(
      await convert(MD_BAD_MERMAID, "docx", {
        baseDir: FIXTURES_DIR,
        warnings: strictWarnings,
        mermaidResolver: renderMermaidStrict,
      }),
    );
    const strictWarn = pickKeyed(strictWarnings, "warn.mermaidFailed");
    assert(strictWarn !== null, `严格模式应产生 warn.mermaidFailed,实际 ${JSON.stringify(strictWarnings)}`);
    assert(
      strictWarn.params?.reason === reason,
      `警告应携带服务给出的真实原因,实际 ${JSON.stringify(strictWarn.params)}`,
    );
    const rendered = formatWarning(strictWarn);
    assert(
      rendered.includes(reason),
      `formatWarning 渲染出的文案(展示层拿到的文本)应含原因,实际 ${JSON.stringify(rendered)}`,
    );
    assert(
      pickKeyed(strictWarnings, "warn.mermaidEmpty") === null,
      "严格模式失败不应再产生「返回空结果」这条无原因警告",
    );

    // ---- 3. 对照组:同一份文档走只降级模式 → 同一通道,但只有无原因的 warn.mermaidEmpty ----
    /** @type {Warning[]} */
    const looseWarnings = [];
    await convert(MD_BAD_MERMAID, "docx", {
      baseDir: FIXTURES_DIR,
      warnings: looseWarnings,
      mermaidResolver: renderMermaid,
    });
    const looseWarn = pickKeyed(looseWarnings, "warn.mermaidEmpty");
    assert(looseWarn !== null, `对照组:只降级模式应产生 warn.mermaidEmpty,实际 ${JSON.stringify(looseWarnings)}`);
    assert(
      pickKeyed(looseWarnings, "warn.mermaidFailed") === null,
      "对照组:只降级模式不产生带原因的警告(差异确实来自接线)",
    );

    // ---- 4. 降级不回归:无内嵌图片、代码原文保留、转换未失败 ----
    const documentXml = await unzipPart(strictDocx.buffer, "word/document.xml");
    assert(!documentXml.includes("a:blip"), "渲染失败的 mermaid 不应内嵌图片");
    assert(documentXml.includes("A[unclosed"), "降级后代码原文应保留在产物里");
    console.log(
      `[ok] mermaid-warning-channel:既有通道带原因上屏(warn.mermaidFailed,文案含 reason);对照组仅 warn.mermaidEmpty`,
    );

    // ---- 5. main 转换链路端到端:convertImpl 的 warnings 就是这条带原因的警告 ----
    // 输出目录置空(落源文件同目录)+ afterConvert none(不触发打开产物),保证断言确定
    await updateSettings({ outputDir: "", afterConvert: "none" });
    const mdPath = path.join(dir, "bad-mermaid.md");
    await fs.writeFile(mdPath, MD_BAD_MERMAID, "utf8");
    const result = await convertImpl(mdPath, "docx", undefined, createConvertContext(), getKatexDir());
    const mainWarn = pickKeyed(result.warnings, "warn.mermaidFailed");
    assert(
      mainWarn !== null,
      `main 转换链路应注入严格模式 resolver,warnings=${JSON.stringify(result.warnings)}`,
    );
    assert(
      formatWarning(mainWarn).includes("Mermaid"),
      `main 链路警告应走既有 Mermaid 措辞,实际 ${JSON.stringify(formatWarning(mainWarn))}`,
    );
    assert(
      path.basename(result.outputPath).startsWith("bad-mermaid"),
      `产物应落盘成功,实际 ${result.outputPath}`,
    );
    console.log(
      `[ok] mermaid-warning-channel:main convertImpl 端到端 warnings 含 warn.mermaidFailed(严格模式已在链路生效)`,
    );

    // ---- 6. 会话换代导致的主动放弃:返回 null 而非抛错(退出路径不制造假警告) ----
    const inflight = renderMermaidStrict("DISPOSE_INFLIGHT_SENTINEL", 5000);
    disposeMermaidService(); // 换代:提交时记下的代号失效
    const skipped = await inflight;
    assert(skipped === null, "换代期间放弃的渲染应返回 null(不得抛错生成假警告)");
    assert(
      (await renderMermaidStrict("graph TD; A-->B")) !== null,
      "换代后应能重建会话并恢复渲染(放弃不等于服务不可用)",
    );
    console.log("[ok] mermaid-warning-channel:换代放弃返回 null 不抛错,之后可重建恢复");
  } finally {
    await backup.restore().catch(() => undefined);
    disposeMermaidService();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
