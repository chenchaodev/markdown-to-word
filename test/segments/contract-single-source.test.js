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
 * - 沙箱副本闭包(源码文本判定;判定纯函数层在 test/common/copy-closure.js,
 *   本段只做遍历、装配与断言 —— 见文件末 (e) 节):
 *   被**逐字节复制**进沙箱并在沙盒内解析的模块,其 import 必须闭合 —— 只允许 `node:`
 *   内建,相对 specifier 的目标必须同在副本集合内。原因:复制点只复制被点名的那几个文件,
 *   不会连带复制它的同目录依赖;一旦给 test/common/userdata.js 加一句
 *   `import … from "./temp-resource.js"`,install-smoke 段的沙盒里那份副本就解析不到该模块,
 *   且报错发生在沙盒子进程内,极难定位。
 *   另一面同样要守:不得出现「复制了却没人用」的死副本 —— 复制点与引用一旦脱节
 *   (典型:使用方的相对 import 被删或改成绝对路径),该副本承载的清理/校验语义会静默消失。
 *   沙盒入口(复制进来就是为了被执行、没有上游 import 的脚本)凭 SANDBOX_ENTRY_EVIDENCE 登记,
 *   登记项受机械抽查(必须在复制行之外被真实提及),不能靠登记把死副本洗白。
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
import {
  COPY_MECHANISMS,
  JS_SOURCE_RE,
  SANDBOX_ENTRY_EVIDENCE,
  auditCopySet,
  auditEntryEvidence,
  blankComments,
  classifySpecifier,
  collectSpecifiers,
  resolveRelativeSpecifier,
  scanCopySites,
} from "../common/copy-closure.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(repoRoot, "src");
/** @param {string} rel 相对 src 的 POSIX 路径 */
const readSrc = (rel) => fs.readFileSync(path.join(srcRoot, rel), "utf8");

/**
 * 断言辅助(本段 (e) 节用;前缀与本段既有内联 throw 保持一致)。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`contract 断言失败:${msg}`);
}

/**
 * 相等断言(附实际/期望,避免「不等」三个字无处可查)。
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @param {string} what 断言项名
 * @returns {void}
 */
function assertEq(actual, expected, what) {
  assert(actual === expected, `${what}:实际 ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
}

/**
 * 违规清单的可读渲染(行号必须出现在里面,否则等于「只知道有问题」)。
 * @param {{ rel: string; line: number; spec: string; detail: string }[]} violations 违规清单
 * @returns {string}
 */
const renderViolations = (violations) =>
  violations.map((v) => `${v.rel}:${v.line} 「${v.spec}」→ ${v.detail}`).join("; ");


// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;


/**
 * 递归列出目录下的 JS/MJS/CJS 源文件(仓库相对 POSIX 路径,按路径排序保证幂序)。
 * 遍历与读文件留在段内(它已有 fs/path):判定层 test/common/copy-closure.js 刻意零 I/O 依赖。
 * @param {string} root 仓库根绝对路径
 * @param {string[]} relDirs 相对目录数组
 * @returns {import("../common/copy-closure.js").SourceFile[]}
 */
function listJsSources(root, relDirs) {
  /** @type {import("../common/copy-closure.js").SourceFile[]} */
  const files = [];
  /**
   * @param {string} absDir 绝对目录
   * @param {string} relDir 相对目录(POSIX)
   * @returns {void}
   */
  const walk = (absDir, relDir) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules") continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(absDir, entry.name), rel);
      else if (JS_SOURCE_RE.test(entry.name)) {
        files.push({ path: rel, text: fs.readFileSync(path.join(absDir, entry.name), "utf8") });
      }
    }
  };
  for (const relDir of relDirs) walk(path.join(root, ...relDir.split("/")), relDir);
  return files;
}

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

  // ================= (e) 沙箱副本闭包:逐字节复制的模块,其 import 必须闭合 =================
  // 0. 判定原语的正/负锚点:先证明这套判定真会抓违规(否则真实文件树上的「全绿」无意义)
  const synthetic = [
    "// import x from './commented-out.js'", // 1 注释里的 import 不该被抽到
    "const url = 'https://example.com/a'; // import y from './in-url-comment.js'", // 2 字符串里的 // 不是注释起点
    "import fs from 'node:fs';", // 3 内建
    "import { rmSync } from './sibling.mjs';", // 4 相对
    "const lazy = await import('../shared/util.mjs');", // 5 动态相对
    "const legacy = require(\"./legacy.cjs\");", // 6 CJS 相对
    "import 'side-effect-only.mjs';", // 7 副作用导入
  ].join("\n");
  const syntheticSpecs = collectSpecifiers(blankComments(synthetic));
  assertEq(
    syntheticSpecs.map((s) => `${s.line}:${classifySpecifier(s.spec)}`).join(","),
    "3:node,4:relative,5:relative,6:relative,7:bare",
    "specifier 抽取/分类锚点(注释行不算、字符串里的 // 不误判、行号对齐原文本)",
  );
  assertEq(
    resolveRelativeSpecifier("scripts/smoke-proc.mjs", "../test/common/userdata.js"),
    "test/common/userdata.js",
    "相对解析锚点:上跳一级",
  );
  assertEq(
    resolveRelativeSpecifier("test/common/userdata.js", "./temp-resource.js"),
    "test/common/temp-resource.js",
    "相对解析锚点:同目录",
  );
  assertEq(resolveRelativeSpecifier("a.mjs", "../outside.mjs"), "../outside.mjs", "相对解析锚点:越出仓库根须保留上行前缀");
  console.log("[ok] contract:副本闭包判定原语锚点(specifier 抽取/分类/相对解析) 断言通过");

  // 1. 扫出被逐字节复制进沙箱的文件:事实源 = 代码里的复制调用(不硬编码任何文件名)
  const sources = listJsSources(repoRoot, ["test", "scripts"]);
  const scan = scanCopySites(sources);
  /** 仓库相对 POSIX 路径 → 文本 */
  const texts = new Map(sources.map((f) => [f.path, f.text]));
  const copiedRels = [...new Set(scan.copies.map((c) => c.rel))].sort();
  assert(copiedRels.length >= 1, `未扫出任何逐字节复制的模块(复制机制=${COPY_MECHANISMS.map((m) => m.call).join("/")},walker 可能失效)`);
  for (const rel of copiedRels) {
    assert(fs.existsSync(path.join(repoRoot, ...rel.split("/"))), `扫出的副本在磁盘上不存在:${rel}(解析器与事实脱节)`);
  }
  assert(
    scan.unresolved.length + scan.treeMirrors.length > 0,
    "登记类复制点应为非空(若解析器退化成「什么都不报」,这段断言会先红,提示覆盖面被悄悄缩小)",
  );
  // 说明:复制点扫描跑在「抹注释、留字符串」的文本上,所以字符串里出现的 `copyFileSync(`
  // (含本段下面自测夹具用的那行)也会被登记 —— 后果只是多一条「未静态解析」登记项,不会误判红。
  console.log(
    `[ok] contract:沙箱副本清单(${copiedRels.length} 个:${copiedRels.join(", ")};登记不判红:未静态解析 ${scan.unresolved.length} 处 / 整树镜像 ${scan.treeMirrors.length} 处)`,
  );

  // 2. 负向锚点:给某个「当前零依赖」的副本注入一句相对 import,同一套判定必须判红并点名行号
  //    (夹具对象由扫描结果挑,不写死文件名 —— 守护对象将来会变,判定不能跟着变)
  const dependencyFree = scan.copies.find((c) =>
    collectSpecifiers(blankComments(texts.get(c.rel) ?? "")).every((s) => classifySpecifier(s.spec) === "node"),
  );
  assert(dependencyFree !== undefined, `负向夹具缺失:应至少有一个「只依赖 node: 内建」的副本(实际副本 ${copiedRels.length} 个)`);
  const fixture = /** @type {import("../common/copy-closure.js").CopySite} */ (dependencyFree);
  const baseText = /** @type {string} */ (texts.get(fixture.rel));
  const relativeInjection = `${baseText}\nimport { TEMP_PREFIX } from "./temp-resource.js";\n`;
  /** @type {Map<string, string>} */
  const injectedTexts = new Map(texts);
  injectedTexts.set(fixture.rel, relativeInjection);
  const relativeRed = auditCopySet([fixture], injectedTexts);
  assertEq(relativeRed.violations.length, 1, `注入相对 import 后应恰好判出一条违规(实际 ${renderViolations(relativeRed.violations)})`);
  assertEq(relativeRed.violations[0]?.rel, fixture.rel, "违规须点名副本文件");
  assertEq(relativeRed.violations[0]?.line, relativeInjection.split("\n").length - 1, "违规须命中注入那一行");
  assertEq(
    relativeRed.violations[0]?.kind,
    "relative-outside-copy-set",
    "违规种类:相对目标不在副本集合内",
  );
  const bareInjection = `${baseText}\nimport { something } from "some-bare-package";\n`;
  /** @type {Map<string, string>} */
  const bareTexts = new Map(texts);
  bareTexts.set(fixture.rel, bareInjection);
  const bareRed = auditCopySet([fixture], bareTexts);
  assertEq(bareRed.violations.length, 1, `注入裸包名后应恰好判出一条违规(实际 ${renderViolations(bareRed.violations)})`);
  assertEq(bareRed.violations[0]?.kind, "bare-specifier", "违规种类:裸包名(沙盒内无 node_modules)");
  assertEq(bareRed.violations[0]?.line, bareInjection.split("\n").length - 1, "裸包名违规须命中注入那一行");
  // 死副本负向:入边与入口登记都没了 → 必须判红(对应「使用方的相对 import 被删 / 改成绝对路径」)
  const copyCallLine = `fs.copyFileSync(path.join(ROOT, ${JSON.stringify(fixture.rel)}), target);`;
  const orphanRed = auditCopySet(
    [{ rel: fixture.rel, via: fixture.via, line: 1 }],
    new Map([[fixture.rel, baseText], [fixture.via, copyCallLine]]),
  );
  assertEq(orphanRed.orphans.length, 1, "无入边且无入口登记时必须判为死副本");
  assertEq(orphanRed.orphans[0]?.rel, fixture.rel, "死副本须点名副本文件");
  // 死副本的正向对照:登记为沙盒入口后不再判红(否则「复制 + 执行」的正常脚本会被误杀)
  const entryOk = auditCopySet(
    [{ rel: fixture.rel, via: fixture.via, line: 1 }],
    new Map([[fixture.rel, baseText], [fixture.via, copyCallLine]]),
    [{ rel: fixture.rel, via: fixture.via, how: "自测夹具:沙盒内执行" }],
  );
  assertEq(entryOk.orphans.length, 0, "登记为沙盒入口后不应判为死副本");
  // 登记本身的负向锚点:登记项若已不在副本集合里(复制点被删/复制范围变了)必须报失效,
  // 否则登记会变成「过期也继续生效」的免罪符
  const staleEntry = auditEntryEvidence(
    [fixture],
    injectedTexts,
    [{ rel: "test/common/not-copied-anymore.mjs", via: fixture.via, how: "自测夹具:构造一条过期登记" }],
  );
  assertEq(staleEntry.length, 1, "登记项不在副本集合内时必须报失效");
  // 入口证据的负向锚点:只有「提及」没有「执行」的复制点文件不算数
  // (否则复制点上方拼路径的那一行、或段自身对它的 import,都能把死副本洗白)
  const mentionOnly = auditEntryEvidence(
    [fixture],
    new Map([
      [fixture.rel, baseText],
      [fixture.via, `${copyCallLine}\nconst p = path.join(ROOT, ${JSON.stringify(fixture.rel)});\nimport x from ${JSON.stringify(fixture.rel)};`],
    ]),
    [{ rel: fixture.rel, via: fixture.via, how: "自测夹具:只有提及没有执行" }],
  );
  assertEq(mentionOnly.length, 1, "复制行之外只有「提及」而无执行类调用时,入口登记必须报失效");
  console.log("[ok] contract:副本闭包负向锚点(相对越界/裸包名/死副本判红,入口登记对照不误杀/过期登记与无执行证据判失效) 断言通过");

  // 3. 真实文件树:副本集合必须闭合,且入口登记必须仍然有效
  const audit = auditCopySet(scan.copies, texts, SANDBOX_ENTRY_EVIDENCE);
  assertEq(audit.violations.length, 0, `沙箱副本 import 闭包违规:${renderViolations(audit.violations)}`);
  assertEq(
    audit.orphans.length,
    0,
    `沙箱副本存在死副本:${audit.orphans.map((o) => `${o.rel}(复制于 ${o.via})`).join("; ")}`,
  );
  const entryProblems = auditEntryEvidence(scan.copies, texts, SANDBOX_ENTRY_EVIDENCE);
  assertEq(entryProblems.length, 0, `沙盒入口登记失效:${entryProblems.join("; ")}`);
  // 入边必须真实存在(否则「闭合」可能是空集自洽):既要求总体有边,也要求测试树内的副本确有入边
  assert(audit.edges.length >= 1, "副本之间应存在相对 import 入边(全 0 说明提取或判定失效)");
  assert(
    audit.edges.some((e) => e.to.startsWith("test/")),
    `应有指向 test/ 下副本的相对入边(实测边:${audit.edges.map((e) => `${e.from} → ${e.to}`).join("; ") || "无"})`,
  );
  console.log(
    `[ok] contract:沙箱副本闭包(${copiedRels.length} 个副本 / ${audit.edges.length} 条相对入边:${audit.edges.map((e) => `${e.from} → ${e.to}`).join("; ")} / 沙盒入口登记 ${SANDBOX_ENTRY_EVIDENCE.length} 项:${SANDBOX_ENTRY_EVIDENCE.map((e) => `${e.rel}[${e.how}]`).join(" | ")}) 断言通过`,
  );
}
