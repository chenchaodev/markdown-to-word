// @ts-check
/**
 * 契约单源恒等性断言:
 * - CROSS_REF_KINDS:docx/pdf 两侧渲染模块 re-export 的常量与 core/cross-ref.ts
 *   单源为同一对象引用(ESM live binding,两侧 import 同源即恒等);
 * - 章节 label 正则族(SEC_LABEL_RE / kindLabelRegex / stripSecLabelSuffix):
 *   行为断言(label 提取、剥离、fig/tab/sec 构造);
 * - 白名单标签集恒等:INLINE_TAG_STYLES + br ↔ ALLOWED_INLINE_TAGS
 *   键集一致,防两处平行表漂移;
 * - 跨进程类型单源(源码文本判定:类型编译期擦除、产物无痕迹):
 *   ConvertResult 只在 core/ipc-contract.ts 声明,preload / ipc logic / renderer /
 *   converter 侧均不重复声明;preload 的类型依赖只来自 core 契约。
 * 纯断言段,无产物输出。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CROSS_REF_KINDS,
  SEC_LABEL_RE,
  kindLabelRegex,
  stripSecLabelSuffix,
} from "../../dist/core/markdown/cross-ref.js";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
/** @param {string} rel 相对 src 的 POSIX 路径 */
const readSrc = (rel) => fs.readFileSync(path.join(srcRoot, rel), "utf8");

export async function run() {
  // ---- 恒等性:docx/pdf 两侧导入同源(同一对象引用) ----
  const { CROSS_REF_KINDS: docxKinds } = await import("../../dist/core/docx/render.js");
  const { CROSS_REF_KINDS: pdfKinds } = await import("../../dist/core/pdf/render.js");
  if (docxKinds !== CROSS_REF_KINDS || pdfKinds !== CROSS_REF_KINDS) {
    throw new Error("contract 断言失败:docx/pdf 侧 CROSS_REF_KINDS 应与 core/cross-ref.ts 单源为同一对象");
  }
  console.log("[ok] contract:CROSS_REF_KINDS docx/pdf 两侧与单源同一对象 断言通过");

  // ---- 契约形状:fig/tab/sec 三类,文案与占位 ----
  for (const [kind, def] of Object.entries(CROSS_REF_KINDS)) {
    if (typeof def.defaultText !== "string" || typeof def.danglingText !== "string" || typeof def.kindName !== "string") {
      throw new Error(`contract 断言失败:CROSS_REF_KINDS.${kind} 缺 defaultText/danglingText/kindName`);
    }
  }
  if (Object.keys(CROSS_REF_KINDS).sort().join(",") !== "fig,sec,tab") {
    throw new Error("contract 断言失败:CROSS_REF_KINDS 应恰为 fig/sec/tab 三类");
  }
  console.log("[ok] contract:CROSS_REF_KINDS 形状(fig/tab/sec + 文案字段) 断言通过");

  // ---- SEC_LABEL_RE:label 提取(parse.ts 场景)与尾部匹配 ----
  const m = SEC_LABEL_RE.exec("第三章 结果 {#sec:results}");
  if (m === null || m[1] !== "results" || m.index !== "第三章 结果".length) {
    throw new Error(`contract 断言失败:SEC_LABEL_RE 应提取 label=results 且锚定尾部,实际 ${m?.[1]}`);
  }
  if (SEC_LABEL_RE.exec("普通标题") !== null) {
    throw new Error("contract 断言失败:无 label 标题不应命中 SEC_LABEL_RE");
  }
  console.log("[ok] contract:SEC_LABEL_RE 尾部 label 提取 断言通过");

  // ---- stripSecLabelSuffix:纯文本剥离(docx 目录条目 / pdf inline.content 场景) ----
  if (stripSecLabelSuffix("引言 {#sec:intro}") !== "引言") {
    throw new Error("contract 断言失败:stripSecLabelSuffix 应剥离尾部 label 后缀");
  }
  if (stripSecLabelSuffix("**加粗** {#sec:bold}") !== "**加粗**") {
    throw new Error("contract 断言失败:stripSecLabelSuffix 不应改动 label 前文本");
  }
  console.log("[ok] contract:stripSecLabelSuffix 纯文本剥离 断言通过");

  // ---- kindLabelRegex:fig/tab/sec 按 kind 构造(每次新建实例) ----
  for (const kind of ["fig", "tab", "sec"]) {
    const re = kindLabelRegex(kind);
    const hit = re.exec(`x {#${kind}:a-1}`);
    if (hit === null || hit[1] !== "a-1") {
      throw new Error(`contract 断言失败:kindLabelRegex(${kind}) 应命中并捕获 a-1`);
    }
    const other = kind === "fig" ? "tab" : "fig";
    if (re.exec(`x {#${other}:a}`) !== null) {
      throw new Error(`contract 断言失败:kindLabelRegex(${kind}) 不应命中 #${other}: 前缀`);
    }
  }
  console.log("[ok] contract:kindLabelRegex 按 kind 构造与隔离 断言通过");

  // ---- 白名单标签集恒等:ALLOWED_INLINE_TAGS ↔ INLINE_TAG_STYLES(+br) ----
  const { assertInlineTagStylesMatchWhitelist } = await import("../../dist/core/docx/handlers/inline-html.js");
  assertInlineTagStylesMatchWhitelist();
  console.log("[ok] contract:白名单标签集恒等(ALLOWED_INLINE_TAGS ↔ INLINE_TAG_STYLES+br) 断言通过");

  // ---- 跨进程类型单源:ConvertResult 只在 core/ipc-contract.ts 声明 ----
  // 类型声明编译期擦除,产物无痕迹,故按源码文本判定(re-export/import 不算声明)。
  const declRe = /\b(?:interface|type)\s+ConvertResult\b/;
  const contractSrc = readSrc("core/ipc-contract.ts");
  if (!declRe.test(contractSrc)) {
    throw new Error("contract 断言失败:ConvertResult 应在 core/ipc-contract.ts 单源声明");
  }
  const noRedeclare = [
    "main/preload.cts",
    "main/ipc/logic.ts",
    "main/ipc/types.ts",
    "main/converter/merge.ts",
    "main/converter/index.ts",
    "main/persist/settings.ts",
    "main/persist/preset-file.ts",
    "renderer/renderer.ts",
  ];
  for (const file of noRedeclare) {
    if (declRe.test(readSrc(file))) {
      throw new Error(`contract 断言失败:${file} 重复声明 ConvertResult(应经 core/ipc-contract.ts 取用)`);
    }
  }
  console.log(`[ok] contract:ConvertResult 仅 core/ipc-contract.ts 声明(${noRedeclare.length} 个消费方无重复声明) 断言通过`);

  // ---- preload 类型依赖只来自 core 契约(不 type-only 反向引用 main 实现路径) ----
  const preloadSrc = readSrc("main/preload.cts");
  for (const m of preloadSrc.matchAll(/from\s*["']([^"']+)["']/g)) {
    const spec = m[1] ?? "";
    // 相对路径写法(./ 或 ../main/)即指向 main 侧模块;core 走 ../core/,裸包名不算
    if (spec.startsWith("../main/") || spec.startsWith("./")) {
      throw new Error(`contract 断言失败:preload 仍引用 main 侧路径「${spec}」(契约类型应取自 core)`);
    }
  }
  if (!/import type \{[^}]*\bConvertResult\b[^}]*\} from "\.\.\/core\/ipc-contract\.js"/.test(preloadSrc)) {
    throw new Error("contract 断言失败:preload 应自 core/ipc-contract.ts type-only 取用 ConvertResult");
  }
  console.log("[ok] contract:preload 类型依赖仅来自 core 契约(ConvertResult 自 core/ipc-contract 取用) 断言通过");
}
