// @ts-check
/**
 * 「单文件转换只解析一次 frontmatter」的可执行判据段。
 *
 * 被守护的决定(见 docs/adr/ 的对应条目):`core/convert.ts` 的第 1 参由裸字符串
 * 改为阶段产物 `PreprocessedMarkdown = { body, metadata }`。frontmatter 的隔离与
 * 解析只在**上游准备阶段**(`convert/preprocess.ts`)做一次,core 只取用。
 *
 * 三条断言,各自防一种回归:
 * - ① **结构**:core 源码零 `parseFrontmatter` 引用。这是「core 不再解析」的**直接**
 *   证据 —— ESM 下无法给 `parseFrontmatter` 打计数桩(core 改后根本不再 import 它,
 *   桩会退化成永不触发的空断言),故结构面必须有一道。
 * - ② **计数**:真跑一次单文件转换链(prepareMarkdownText → convert),用 ESM loader
 *   就地改写 `dist/core/pipeline/frontmatter.js` 的 `parseFrontmatter`,自增全局计数。
 *   断言计数**恰好为 1** —— 0 说明准备阶段没解析(metadata 丢失),2 说明 core 又解析了
 *   一次(本步要消灭的重复)。这是「只解析一次」的可执行事实,不是读代码的结论。
 * - ③ **行为**:产物无 frontmatter 残留(两侧管线都只消费 body),且 `context.metadata`
 *   覆盖语义不变(向导封面通道)。补「改形状没顺手改坏渲染」这一面。
 *
 * 负向探针:把 ① 的判据改坏(让 core 退回自己 `parseFrontmatter`),② 的计数会变成 2
 * 并把段判红 —— 计数断言不是恒真的摆设。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { asPdfArtifact, convertWithFs, docxBufferOf } from "../harness/convert-helpers.js";
import { unzipPart } from "../harness/docx-utils.js";
import { FIXTURES_DIR, ROOT } from "../harness/paths.js";
import { cleanupTempResources, createTempResource } from "../harness/temp-resource.js";

/**
 * 断言辅助。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`frontmatter-once 断言失败:${msg}`);
}

/** 解析 node 可执行文件:验收入口跑在 Electron 里(process.execPath 是 electron.exe)。 */
function resolveNode() {
  for (const candidate of [process.env.npm_node_execpath, process.execPath]) {
    if (candidate && /node(\.exe)?$/i.test(candidate)) return candidate;
  }
  return process.platform === "win32" ? "node.exe" : "node";
}

const NODE = resolveNode();

/**
 * 剥掉注释与字符串字面量,只留**代码骨架**。
 *
 * 为什么需要:判据要判的是「core 有没有调用 parseFrontmatter」,即**代码**事实。
 * 若直接对源文本做正则,一句解释这次改动的注释里提到 `parseFrontmatter` 就会把段
 * 判红 —— 判据因此变成「不许在注释里提这个词」,与它要守护的东西无关。
 * 逐字符扫(而非正则)是为了不误伤字符串里的 `//`(如 URL)与代码里的除法。
 *
 * @param {string} src TypeScript 源文本
 * @returns {string} 注释与字符串内容已置空、长度不变的骨架
 */
function codeSkeleton(src) {
  const out = src.split("");
  let i = 0;
  /** @param {string} quote 引号字符(' 或 " 或 `) */
  const blankUntil = (quote) => {
    while (i < src.length && src[i] !== quote) {
      if (src[i] === "\n") i++;
      else {
        out[i] = " ";
        i++;
      }
    }
    i++; // 收尾引号
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "/*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== "*/") {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < src.length) {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
      }
    } else if (two === "//") {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
    } else if (src[i] === "'" || src[i] === '"' || src[i] === "`") {
      blankUntil(/** @type {string} */ (src[i]));
    } else {
      i++;
    }
  }
  return out.join("");
}

/** 结构断言的被测源文件(core 侧,相对仓库根) */
const CONVERT_SRC_REL = "src/core/convert.ts";

/**
 * ESM loader:把 `parseFrontmatter` 的函数体首行插入一个全局自增。
 *
 * 为什么用 loader 而不是打桩导出:ESM 的导出绑定对导入方是只读的,测试无法替换
 * `parseFrontmatter` 本身;而在**解析阶段**改写源文本是唯一能在不改生产代码的前提下
 * 观测到真实调用次数的办法。改写点不命中即抛错(否则会静默退化成「计数恒 0」的
 * 假通过 —— 那正是本段要防的失效形态)。
 */
const LOADER_SOURCE = `import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MARK = "?fm-count";

export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  if (resolved.url.includes("core/pipeline/frontmatter.js")) {
    return { ...resolved, url: resolved.url + MARK, shortCircuit: true };
  }
  return resolved;
}

export async function load(url, context, next) {
  if (url.endsWith(MARK)) {
    const file = fileURLToPath(url.split("?")[0]);
    const source = readFileSync(file, "utf8");
    const anchor = "export function parseFrontmatter(md) {";
    if (!source.includes(anchor)) {
      throw new Error("frontmatter-once 探针:未命中 parseFrontmatter 锚点,源文件形状已变");
    }
    const patched = source.replace(
      anchor,
      anchor + " globalThis.__fmCount = (globalThis.__fmCount || 0) + 1;",
    );
    return { format: "module", shortCircuit: true, source: patched };
  }
  return next(url, context);
}
`;

/** 计数探针的被测脚本:走真实单文件转换链,只报计数与产物形态(不引入生产代码) */
const PROBE_SOURCE = `import { readFileSync, realpathSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const loaderUrl = process.argv[2];
const root = process.argv[3];
register(loaderUrl, import.meta.url);

const load = (rel) => import(pathToFileURL(root + rel).href);

const { prepareMarkdownText } = await load("/dist/convert/preprocess.js");
const { convert } = await load("/dist/core/convert.js");
const { DEFAULT_SETTINGS } = await load("/dist/core/settings/settings-defaults.js");

const md = "---\\ntitle: 探针标题\\nauthor: 探针作者\\n---\\n\\n# 正文\\n\\n一段。\\n";

const prepared = prepareMarkdownText(md, DEFAULT_SETTINGS);
const afterPrepare = globalThis.__fmCount || 0;
const docx = await convert(
  { body: prepared.body, metadata: prepared.metadata },
  "docx",
  { baseDir: root, warnings: [] },
);
const afterDocx = globalThis.__fmCount || 0;
const pdf = await convert(
  { body: prepared.body, metadata: prepared.metadata },
  "pdf",
  { baseDir: root, warnings: [], title: "探针", fs: {
    realpathSync: (p) => realpathSync(p),
    readTextFile: (f) => readFileSync(f, "utf8"),
  } },
);
const afterPdf = globalThis.__fmCount || 0;

process.stdout.write(JSON.stringify({
  afterPrepare, afterDocx, afterPdf,
  docxBytes: docx.buffer.length,
  pdfKind: pdf.kind,
  metadataTitle: prepared.metadata.title,
}));
`;

/**
 * 跑一次计数探针(子进程内跑,故 ESM loader 与全局计数不污染本段其余断言)。
 * @returns {{ afterPrepare: number, afterDocx: number, afterPdf: number, docxBytes: number, pdfKind: string, metadataTitle?: string }} 计数与产物形态
 */
function runCountProbe() {
  const dir = createTempResource({ label: "frontmatter-once-probe" }).path;
  const loaderPath = path.join(dir, "fm-count-loader.mjs");
  const probePath = path.join(dir, "probe.mjs");
  try {
    fs.writeFileSync(loaderPath, LOADER_SOURCE, "utf8");
    fs.writeFileSync(probePath, PROBE_SOURCE, "utf8");
    const result = spawnSync(NODE, [probePath, `file:///${loaderPath.split(path.sep).join("/")}`, ROOT], {
      encoding: "utf8",
      timeout: 120_000,
    });
    assert(result.status === 0, `计数探针子进程失败(status=${result.status}):${result.stderr}`);
    return JSON.parse(result.stdout);
  } finally {
    cleanupTempResources();
  }
}

/** 带 frontmatter 的样例:frontmatter 行不得出现在产物正文里 */
const MD = `---
title: frontmatter标题
author: frontmatter作者
date: 2026-01-01
---

# 正文标题

正文内容。
`;

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ---- ① 结构:core 源码零 parseFrontmatter **代码**引用(「core 不再解析」的直接证据) ----
  // 判在代码骨架上(注释/字符串已剥):注释里解释这次改动不算引用,`parseFrontmatter(md)`
  // 这种真实调用才算 —— 判据才不会退化成「不许提这个词」。
  const convertSrc = codeSkeleton(fs.readFileSync(path.join(ROOT, CONVERT_SRC_REL), "utf8"));
  const fmRefs = [...convertSrc.matchAll(/\bparseFrontmatter\b/g)];
  assert(
    fmRefs.length === 0,
    `${CONVERT_SRC_REL} 仍引用 parseFrontmatter ${fmRefs.length} 次 —— core 应只取用阶段产物,不再解析 frontmatter`,
  );
  // DocMetadata 的 type 导入允许(只是类型),但值导入(真去调那个函数)不允许
  assert(
    !/import\s*\{[^}]*\bparseFrontmatter\b[^}]*\}\s*from/.test(convertSrc),
    `${CONVERT_SRC_REL} 仍从 frontmatter 模块值导入 parseFrontmatter(DocMetadata 的 type 导入不受限)`,
  );
  console.log(`[ok] frontmatter-once:${CONVERT_SRC_REL} 代码零 parseFrontmatter 引用`);

  // ---- ② 计数:单文件转换链上 frontmatter 恰好解析一次 ----
  const probe = runCountProbe();
  assert(
    probe.afterPrepare === 1,
    `准备阶段应解析 1 次 frontmatter,实际 ${probe.afterPrepare}(0 = metadata 丢失,>1 = 上游内部已有重复)`,
  );
  assert(
    probe.afterDocx === 1,
    `docx 转换后计数应仍为 1,实际 ${probe.afterDocx}(core 又解析了一次 —— 本步要消灭的重复回归)`,
  );
  assert(
    probe.afterPdf === 1,
    `pdf 转换后计数应仍为 1,实际 ${probe.afterPdf}(core 又解析了一次 —— 本步要消灭的重复回归)`,
  );
  assert(probe.docxBytes > 0, "docx 产物应非空");
  assert(probe.pdfKind === "pdf", `pdf 产物 kind 应为 pdf,实际 ${probe.pdfKind}`);
  assert(
    probe.metadataTitle === "探针标题",
    `阶段产物 metadata.title 应为「探针标题」(metadata 真的传下去了),实际 ${String(probe.metadataTitle)}`,
  );
  console.log(
    `[ok] frontmatter-once:计数 prepare=${probe.afterPrepare} → docx=${probe.afterDocx} → pdf=${probe.afterPdf}(恰好 1 次)`,
  );

  // ---- ③ 行为:两侧产物无 frontmatter 残留 + context.metadata 覆盖语义不变 ----
  const docxBuffer = docxBufferOf(await convertWithFs(MD, "docx", { baseDir: FIXTURES_DIR, warnings: [] }));
  const docxXml = await unzipPart(docxBuffer, "word/document.xml");
  assert(!docxXml.includes("author: frontmatter作者"), "docx 正文不应残留 frontmatter 原文行");
  assert(docxXml.includes("frontmatter标题"), "docx 封面应消费阶段产物的 metadata.title");
  console.log("[ok] frontmatter-once:docx 无 frontmatter 残留且封面消费 metadata.title");

  const pdf = asPdfArtifact(await convertWithFs(MD, "pdf", { baseDir: FIXTURES_DIR, title: "文件名", warnings: [] }));
  assert(!pdf.html.includes("author: frontmatter作者"), "PDF HTML 不应残留 frontmatter 原文行");
  assert(
    pdf.html.includes('<div class="cover-title">frontmatter标题</div>'),
    "PDF 封面应消费阶段产物的 metadata.title",
  );
  console.log("[ok] frontmatter-once:PDF 无 frontmatter 残留且封面消费 metadata.title");

  const overridden = asPdfArtifact(
    await convertWithFs(MD, "pdf", {
      baseDir: FIXTURES_DIR,
      title: "文件名",
      warnings: [],
      metadata: { title: "向导标题" },
    }),
  );
  assert(
    overridden.html.includes('<div class="cover-title">向导标题</div>'),
    "context.metadata 覆盖语义应不变(向导封面通道)",
  );
  assert(
    !overridden.html.includes("frontmatter标题"),
    "context.metadata 覆盖后不应再出现 frontmatter title",
  );
  console.log("[ok] frontmatter-once:context.metadata 覆盖 frontmatter 的语义不变");
}
