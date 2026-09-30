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
 * - 沙箱副本闭包(源码文本判定;判定纯函数层在 test/common/ 的两个文件,
 *   本段只做遍历、装配与断言 —— 见文件末 (e) 节):
 *   被**逐字节复制**进沙箱并在沙盒内解析的模块,其 import 必须闭合 —— 只允许 `node:`
 *   内建,相对 specifier 的目标必须同在副本集合内。原因:复制点只复制被点名的那几个文件,
 *   不会连带复制它的同目录依赖;一旦给 test/common/userdata.js 加一句
 *   `import … from "./temp-resource.js"`,install-smoke 段的沙盒里那份副本就解析不到该模块,
 *   且报错发生在沙盒子进程内,极难定位。
 *   另一面同样要守:不得出现「复制了却没人用」的死副本 —— 复制点与引用一旦脱节
 *   (典型:使用方的相对 import 被删或改成绝对路径),该副本承载的清理/校验语义会静默消失。
 *   沙盒入口(复制进来就是为了被执行、没有上游 import 的脚本)凭 SANDBOX_ENTRY_EVIDENCE 登记,
 *   登记项受机械抽查(必须在复制行之外存在「提及它 + 带执行类调用」的代码行),不能靠登记把死副本洗白。
 *   判定分两层、都在 test/common/ 且零 node: 依赖(判定口径单源,勿在段内重抄):
 *   - test/common/copy-closure.js:纯文本层(剥注释 / 抽 specifier / 分类 / 相对解析 / 表达式求值);
 *   - test/common/copy-closure-audit.js:扫描 + 审计层(复制点提取 / 闭包审计 / 入口登记抽查);
 *   依赖方向单向:本段 → 审计层 → 文本层。目录遍历与读文件只在本段(它已有 fs/path)。
 * - 测试扫描面单源(test/common/test-common-surface.js)与它的两条完整性判据,见文件末 (f) 节:
 *   段目录集合与门禁扫描面同源;完整性判据是**等式**(声明目录集合 == 磁盘上真实存在的
 *   测试子目录)+ **下限**(walker 整体失效兜底)两条,各管一件事,双向锚点在本段内。
 *
 * ---- 沙盒副本闭包 · 已知覆盖边界(不是「已完全覆盖」,改判定前先读这段)----
 * 静态求值只认写在源码里的形状。以下三类复制源**解析不出**,只登记、不判红:
 * 1) 运行时拼装的列表(如从配置里解析出的 configFiles 之类的 for-of 目标);
 * 2) 多层别名链(一层 const 别名可解,两层以上保守放弃);
 * 3) 跨目录整树复制(cpSync 目录 + node_modules 联接,见审计层 COPY_MECHANISMS 的 tree-mirror):
 *    整棵树都在沙盒里,相对依赖天然闭合,不适用逐文件闭包。
 * 后果:若将来有人用「运行时拼装列表」的方式复制一个 JS 模块,本守护**不会自动纳入**它。
 * 那时需人工扩 copy-closure.js 的 resolveCopySource 支持该形态,或给该复制机制新增一个
 * COPY_MECHANISMS scope;在此之前,这类复制点只出现在 scanCopySites() 的
 * unresolved / treeMirrors 登记里(本段的 [ok] 行会打印数量)。
 *
 * 4) **正则字面量里的 import 形状**(2026-09-30 登记):字符串掩码把「引号是词法记号」与
 *    「引号在字符串内部」区分开了(文档串里的 `require("fs")` 不再被抽成裸包名依赖),
 *    但 lexSource 对正则字面量走 skipRegex、**不**把其中内容标为字符串内部。于是形如
 *    `/import "x"/` 的正则若出现在某个副本里,仍会被抽成 specifier 而判红。
 *    为何不修:正则里出现完整的 import 语句形状在真实代码里极罕见(至今 0 例),而正确
 *    处理需要区分「除号」与「正则起始」在更多上下文里的歧义,收益远小于误伤风险。
 *    后果:这类写法会被判红(保守方向 —— 假红而非假绿)。真出现时人工改写该正则即可。
 *
 * 5) **`writeFileSync` 写出的脚本副本,复制点扫描器看不见**(2026-09-30 登记,ADR-040):
 *    scanCopySites 只认 `copyFileSync`/`copyFile`/`cpSync` 三个机制(COPY_MECHANISMS)。
 *    `test/segments/clean-artifacts-gate.test.js` 把 `clean-artifacts.mjs` 的源码用
 *    **writeFileSync** 写进沙盒(还要按用例改写其中一行),故它**不在副本集合里**。
 *    后果:该沙盒若漏写 `shared/paths.js`,`relative-outside-copy-set` **结构上抓不到**
 *    (它压根不在 copies 里),per-via 断言同样覆盖不到(同样因为不在 copies 里)。
 *    唯一的兜底是 `test:coverage` 运行时红(脚本起不来 ⇒ 段失败)。
 *    为何保留 writeFileSync:该段需要对副本**逐字节改写一行**再跑,copyFileSync 做不到。
 *    真要根治需给审计层新增「源码写出」复制机制,届时本条与 ADR-040 的 per-via 断言一并覆盖。
 *
 * 纯断言段,无产物输出。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CROSS_REF_KINDS,
  SEC_LABEL_RE,
  kindLabelRegex,
  stripSecLabelSuffix,
} from "../../dist/core/markdown/cross-ref.js";
import {
  COPY_MECHANISMS,
  SANDBOX_ENTRY_EVIDENCE,
  auditCopySet,
  auditEntryEvidence,
  auditViaCoverage,
  scanCopySites,
} from "../common/copy-closure-audit.js";
import {
  JS_SOURCE_RE,
  classifySpecifier,
  collectSpecifiers,
  lexSource,
  resolveRelativeSpecifier,
} from "../../shared/copy-closure.js";
import { removeTree } from "../common/temp-resource.js";
import {
  MIN_SCAN_FILES,
  SCAN_TARGETS,
  checkSurfaceEquality,
  formatSurfaceMismatch,
  judgeScanFloor,
  listScanFiles,
} from "../../shared/test-common-surface.js";

/**
 * 抽 specifier 的固定入口:code 与掩码必须同源于一次 lexSource,故合成一个返回元组。
 * 写成 `collectSpecifiers(...lexOf(text))` 是为了让「掩码必填」在调用点一眼可见 ——
 * 漏传会直接抛错,不会退回不判引号来处的旧行为。
 * @param {string} text 源文本
 * @returns {[string, Uint8Array]} (code, inString)
 */
const lexOf = (text) => {
  const { code, inString } = lexSource(text);
  return [code, inString];
};
import { ROOT } from "../common/paths.js";

const repoRoot = ROOT;
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
 * @returns {import("../../shared/copy-closure.js").SourceFile[]}
 */
function listJsSources(root, relDirs) {
  /** @type {import("../../shared/copy-closure.js").SourceFile[]} */
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

/**
 * 造一棵最小夹具测试树:给定的 test/ 子目录,每个目录下 filesPerDir 个文件。
 * 文件名按 SCAN_TARGETS 里该目录的 accept 谓词挑(不写死扩展名)—— 谓词改了夹具自动跟着变,
 * 不会造出一个「谓词已经不收这种扩展名」的假树(那会让等式夹具测不到真东西)。
 * @param {string[]} dirs 仓库相对目录(如 `test/perf`)
 * @param {number} filesPerDir 每个目录下的文件数
 * @returns {string} 夹具根绝对路径
 */
function makeFixtureTree(dirs, filesPerDir = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-surface-"));
  for (const rel of dirs) {
    const target = SCAN_TARGETS.find((t) => t.dir === rel);
    const matched = target === undefined ? undefined : ["case-0.test.js", "case-0.js", "case-0.mjs"].find((n) => target.accept(n));
    const name = matched ?? "case-0.test.js";
    for (let i = 0; i < filesPerDir; i += 1) {
      const abs = path.join(root, ...rel.split("/"), name.replace("case-0", `case-${i}`));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "export const x = 1;\n", "utf8");
    }
  }
  return root;
}

export async function run() {
  // ---- 恒等性:docx/pdf 两侧导入同源(同一对象引用) ----
  const { CROSS_REF_KINDS: docxKinds } = await import("../../dist/core/docx/render.js");
  const { CROSS_REF_KINDS: pdfKinds } = await import("../../dist/core/pdf/render.js");
  if (docxKinds !== CROSS_REF_KINDS || pdfKinds !== CROSS_REF_KINDS) {
    throw new Error("contract 断言失败:docx/pdf 侧 CROSS_REF_KINDS 应与 core/cross-ref.ts 单源为同一对象");
  }
  console.log("[ok] contract:CROSS_REF_KINDS docx/pdf 两侧与单源同一对象 断言通过");

  // ---- 契约形状:fig/tab/sec/eq 四类,文案与占位 ----
  // eq 于 adr-030 6-D3 并入本表(此前公式的默认文本集与悬空文案在两侧各写一份,
  // 是本表唯一未覆盖的引用种类);其编号带括号包裹,故多一个 numberSuffix 字段。
  for (const [kind, def] of Object.entries(CROSS_REF_KINDS)) {
    if (typeof def.defaultText !== "string" || typeof def.danglingText !== "string" || typeof def.kindName !== "string") {
      throw new Error(`contract 断言失败:CROSS_REF_KINDS.${kind} 缺 defaultText/danglingText/kindName`);
    }
    if (!Array.isArray(def.defaultTexts) || def.defaultTexts.length === 0) {
      throw new Error(`contract 断言失败:CROSS_REF_KINDS.${kind} 缺 defaultTexts(默认文本集)`);
    }
    if (!def.defaultTexts.includes(def.defaultText)) {
      throw new Error(`contract 断言失败:CROSS_REF_KINDS.${kind} 的 defaultTexts 应含 defaultText`);
    }
  }
  if (Object.keys(CROSS_REF_KINDS).sort().join(",") !== "eq,fig,sec,tab") {
    throw new Error("contract 断言失败:CROSS_REF_KINDS 应恰为 eq/fig/sec/tab 四类");
  }
  if (CROSS_REF_KINDS.eq.numberSuffix !== " (") {
    throw new Error(`contract 断言失败:CROSS_REF_KINDS.eq.numberSuffix 应为「 (」,实际 ${CROSS_REF_KINDS.eq.numberSuffix}`);
  }
  if ("numberSuffix" in CROSS_REF_KINDS.fig || "numberSuffix" in CROSS_REF_KINDS.tab || "numberSuffix" in CROSS_REF_KINDS.sec) {
    throw new Error("contract 断言失败:numberSuffix 是 eq 独有条目,其余三类不应带该字段");
  }
  console.log("[ok] contract:CROSS_REF_KINDS 形状(eq/fig/sec/tab + 文案字段 + 默认文本集) 断言通过");

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
  const syntheticSpecs = collectSpecifiers(...lexOf(synthetic));
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

  // 0b. 字符串掩码锚点(修 check-temp-cleanup.mjs 那条假阳性的判据)。
  //     起因:白名单的 why 字段用文档串记了历史写法 require("fs").rmSync(…),在
  //     「抹注释、留字符串」的文本上与真 import 完全同形,被抽成裸包名依赖 → 闭包门禁判红。
  //     掩码把「引号是词法记号」与「引号在字符串内部」区分开,以下两条锚点守这个区分。
  //
  //     正向锚点:文档串里的 import/require 形状必须一个都抽不到。
  {
    const docOnly = [
      `const doc = 'require("fs").rmSync(…)';`,
      `const doc2 = "…改从 './x.js' 取值…";`,
      `const doc3 = \`import { a } from "./y.js";\`;`,
    ].join("\n");
    assertEq(
      collectSpecifiers(...lexOf(docOnly)).length,
      0,
      "掩码正向锚点:文档串里的 import/require 形状不得被抽成 specifier(否则副本闭包门禁会被自家注释判红)",
    );
  }
  //     同区域共存的负向锚点:掩码只排「字符串内部」,不能把整行/整块一起抹掉 ——
  //     同一段文本里既有诱饵又有真 import 时,必须恰好抽到真 import 那一个。
  //     这条是「掩码恒为 true」的探针:若掩码失效成全 1,这里会抽到 0 而非 1。
  {
    const mixed = ['const doc = \'require("fs")\';', 'import x from "./real.mjs";'].join("\n");
    const mixedSpecs = collectSpecifiers(...lexOf(mixed));
    assertEq(mixedSpecs.length, 1, "掩码负向锚点:同块内诱饵与真 import 共存时,须恰好抽到真 import 那一个");
    assertEq(mixedSpecs[0]?.spec, "./real.mjs", "掩码负向锚点:抽到的必须是真 import 的 specifier");
    assertEq(classifySpecifier(mixedSpecs[0]?.spec ?? ""), "relative", "掩码负向锚点:真 import 仍按原口径分类为 relative");
  }
  console.log("[ok] contract:副本闭包判定原语锚点(specifier 抽取/分类/相对解析/字符串掩码) 断言通过");

  // 1. 扫出被逐字节复制进沙箱的文件:事实源 = 代码里的复制调用(不硬编码任何文件名)
  //    扫描面含 shared:项目根单源 shared/paths.js 如今被 6 处复制点复制进沙盒
  //    (ADR-040),漏了它会让这些副本判「源文件不可读」(texts 里查不到)。
  const sources = listJsSources(repoRoot, ["test", "scripts", "shared"]);
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
    collectSpecifiers(...lexOf(texts.get(c.rel) ?? "")).every((s) => classifySpecifier(s.spec) === "node"),
  );
  assert(dependencyFree !== undefined, `负向夹具缺失:应至少有一个「只依赖 node: 内建」的副本(实际副本 ${copiedRels.length} 个)`);
  const fixture = /** @type {import("../common/copy-closure-audit.js").CopySite} */ (dependencyFree);
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
  assertEq(staleEntry.length, 1, "登记项不在副本集合内时必须报失效");  // 入口证据的负向锚点:只有「提及」没有「执行」的复制点文件不算数
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

  // 2b. per-via 断言的双向锚点(ADR-040 核心防护)。
  //     auditCopySet 的 relSet 是**所有复制点副本的并集**,所以「A 复制点带了 shared/paths.js」
  //     会让全局变绿,而「B 复制点忘了带」看不出来。本断言按 via 分组逐个查。
  //     正向:某个 via 复制了依赖脚本、也复制了 shared/paths.js → 判绿。
  {
    const scriptText = `import { ROOT } from "../shared/paths.js";\nexport const r = ROOT;\n`;
    const okCopies = [
      { rel: "scripts/probe.mjs", via: "scripts/probe.selftest.mjs", line: 1 },
      { rel: "shared/paths.js", via: "scripts/probe.selftest.mjs", line: 2 },
    ];
    const okTexts = new Map([
      ["scripts/probe.mjs", scriptText],
      ["shared/paths.js", "export const ROOT = 1;\n"],
      ["scripts/probe.selftest.mjs", "copyFileSync(...)"],
    ]);
    assertEq(
      auditViaCoverage(okCopies, okTexts).length,
      0,
      "per-via 正向锚点:复制点既复制了依赖脚本也复制了 shared/paths.js,须判绿",
    );
  }
  //     负向:A 复制点带齐了 shared/paths.js、B 复制点漏了 —— 全局并集因此被「填满」而判绿,
  //     但 B 的沙盒实际会断。这才是 auditCopySet 真正的 fail-open 形态(ADR-040 背景一),
  //     也正是本断言存在的理由。per-via 必须只点名 B。
  {
    const scriptText = `import { ROOT } from "../shared/paths.js";\nexport const r = ROOT;\n`;
    // A:复制了 scripts/probe-a.mjs 与 shared/paths.js(带齐);B:只复制了 scripts/probe-b.mjs(漏带)
    const twoViaCopies = [
      { rel: "scripts/probe-a.mjs", via: "scripts/a.selftest.mjs", line: 1 },
      { rel: "shared/paths.js", via: "scripts/a.selftest.mjs", line: 2 },
      { rel: "scripts/probe-b.mjs", via: "scripts/b.selftest.mjs", line: 1 },
    ];
    const twoViaTexts = new Map([
      ["scripts/probe-a.mjs", scriptText],
      ["scripts/probe-b.mjs", scriptText],
      ["shared/paths.js", "export const ROOT = 1;\n"],
      ["scripts/a.selftest.mjs", "copyFileSync(...)"],
      ["scripts/b.selftest.mjs", "copyFileSync(...)"],
    ]);
    // 关键对照:全局并集口径对同一份数据**判绿** —— A 已把 shared/paths.js 放进并集,
    // 于是 B 的漏带被完全掩盖。这条对照若哪天不再为绿,说明 auditCopySet 已改成真
    // per-sandbox,届时本断言可退役(断言会失败提醒你)。
    const unionGreen = auditCopySet(twoViaCopies, twoViaTexts);
    assertEq(
      unionGreen.violations.length,
      0,
      "对照:全局并集口径对「A 带齐 / B 漏带」判绿 —— 这正是 auditCopySet 的 fail-open,也是 per-via 断言要补的洞",
    );
    // per-via 必须抓到,且只点名漏带的那个 via(A 不该被牵连)
    const gaps = auditViaCoverage(twoViaCopies, twoViaTexts);
    assertEq(gaps.length, 1, "per-via 负向锚点:A 带齐 / B 漏带时,须恰好判一条红");
    assertEq(gaps[0]?.via, "scripts/b.selftest.mjs", "per-via 负向锚点:须点名漏带的那个复制点 B");
    assertEq(gaps[0]?.missing, "shared/paths.js", "per-via 负向锚点:须点名缺的那个文件");
    assertEq(gaps[0]?.neededBy, "scripts/probe-b.mjs", "per-via 负向锚点:须点名需要它的那个副本");
  }
  console.log("[ok] contract:per-via 覆盖断言双向锚点(带齐判绿/漏带判红并点名 via) 断言通过");

  // 3. 真实文件树:副本集合必须闭合,且入口登记必须仍然有效
  const audit = auditCopySet(scan.copies, texts, SANDBOX_ENTRY_EVIDENCE);
  assertEq(audit.violations.length, 0, `沙箱副本 import 闭包违规:${renderViolations(audit.violations)}`);
  const viaGaps = auditViaCoverage(scan.copies, texts);
  assertEq(
    viaGaps.length,
    0,
    `沙箱复制点漏带项目根单源(每个 via 各自检查):${viaGaps.map((g) => `${g.via} 缺 ${g.missing}(${g.neededBy} 需要它)`).join("; ")}`,
  );
  assertEq(
    audit.orphans.length,
    0,
    `沙箱副本存在死副本:${audit.orphans.map((o) => `${o.rel}(复制于 ${o.via})`).join("; ")}`,
  );
  const entryProblems = auditEntryEvidence(scan.copies, texts, SANDBOX_ENTRY_EVIDENCE);
  assertEq(entryProblems.length, 0, `沙盒入口登记失效:${entryProblems.join("; ")}`);
  // 入边必须真实存在(否则「闭合」可能是空集自洽):既要求总体有边,也要求有边指向
  // shared/ 下的副本 —— 那些是 ADR-040 起必须随门禁带进沙盒的跨树机制,若没有任何边
  // 指向它们,「复制 shared/」这件事就没有对象、闭包判定也就无从证明。
  assert(audit.edges.length >= 1, "副本之间应存在相对 import 入边(全 0 说明提取或判定失效)");
  assert(
    audit.edges.some((e) => e.to.startsWith("shared/")),
    `应有指向 shared/ 下副本的相对入边(实测边:${audit.edges.map((e) => `${e.from} → ${e.to}`).join("; ") || "无"})`,
  );
  console.log(
    `[ok] contract:沙箱副本闭包(${copiedRels.length} 个副本 / ${audit.edges.length} 条相对入边:${audit.edges.map((e) => `${e.from} → ${e.to}`).join("; ")} / 沙盒入口登记 ${SANDBOX_ENTRY_EVIDENCE.length} 项:${SANDBOX_ENTRY_EVIDENCE.map((e) => `${e.rel}[${e.how}]`).join(" | ")}) 断言通过`,
  );

  // ================= (f) 测试扫描面单源:等式 + 下限,两条判据各管一件事 =================
  // 等式判据最大的失败形态是**恒绿**,故必须双向证明:
  //   正向 —— 正常仓库下等式成立、文件数满足下限;
  //   负向 —— 造「声明 5 个、磁盘上 6 个」与「声明 5 个、只建成 4 个」的夹具树,断言判红
  //           **并点名差异目录**;负向 A 还额外断言「文件数远超下限时下限仍判绿」,证明
  //           下限替代不了等式(这正是改判据的理由);
  //   下限 —— 反向:目录集合与磁盘一致、但文件数塌到下限以下时,只有下限能抓(等式抓不到)。
  {
    /** @type {string[]} 夹具根,末尾统一清理(不留残:临时目录残留在系统临时区谁也看不出) */
    const sandboxes = [];
    try {
      // 1. 正向:真实仓库等式成立 + 满足下限(否则下面所有负向夹具的「绿」都没意义)
      const real = checkSurfaceEquality(repoRoot);
      assertEq(real.ok, true, `真实仓库的扫描面等式须成立:${formatSurfaceMismatch(real)}`);
      // 声明面恰好是那三个段目录 + common + tools(fixtures 虽有源文件,但按显式理由排除)
      assertEq(
        real.declared.join(","),
        "test/common,test/main,test/renderer,test/segments,test/tools",
        "声明面(单一来源)应恰为这 5 个目录",
      );
      assert(
        !real.measured.includes("test/fixtures"),
        `排除清单里的 test/fixtures 不得出现在实测面(它是样例数据):${real.measured.join(", ")}`,
      );
      const realFiles = listScanFiles(repoRoot).length;
      assertEq(
        judgeScanFloor(realFiles).ok,
        true,
        `真实仓库扫描文件数须满足下限(实测 ${realFiles},下限 ${MIN_SCAN_FILES})`,
      );
      console.log(`[ok] contract:扫描面等式正向(真实仓库声明 ${real.declared.length} 个 == 实测 ${real.measured.length} 个,扫描 ${realFiles} 个文件 ≥ 下限 ${MIN_SCAN_FILES})`);

      // 2. 正向对照:声明 5 个 / 磁盘 5 个 → 等式成立(否则下面的负向可能只是「恒红」)
      const aligned = makeFixtureTree(SCAN_TARGETS.map((t) => t.dir), 1);
      sandboxes.push(aligned);
      const alignedResult = checkSurfaceEquality(aligned);
      assertEq(alignedResult.ok, true, `声明与磁盘一致的夹具树应判绿:${formatSurfaceMismatch(alignedResult)}`);

      // 3. 负向 A(本泳道要修的真缺陷):磁盘 6 个、声明 5 个 —— 漏扫一个测试子目录
      const leaky = makeFixtureTree([...SCAN_TARGETS.map((t) => t.dir), "test/perf"], 20);
      sandboxes.push(leaky);
      const leakyResult = checkSurfaceEquality(leaky);
      assertEq(leakyResult.ok, false, "声明 5 个、磁盘 6 个时等式必须判红(漏扫的目录正是这条要抓的)");
      assertEq(leakyResult.extra.join(","), "test/perf", "须点名那个漏登记的目录");
      assertEq(leakyResult.missing.length, 0, "这一侧不该有缺失目录");
      const leakyText = formatSurfaceMismatch(leakyResult);
      assert(leakyText.includes("test/perf"), `诊断须点名 test/perf,实际:${leakyText}`);
      // 关键对照:同一个夹具树的文件数远超下限 → 下限判据**照样绿**。这就是「下限不是
      // 唯一判据」的实证:只保留下限,这个漏扫会静默通过。
      const leakyFiles = listScanFiles(leaky).length;
      assert(
        leakyFiles > MIN_SCAN_FILES,
        `对照前提:漏扫夹具的文件数应远超下限(实际 ${leakyFiles},下限 ${MIN_SCAN_FILES}),否则证明不了下限抓不到漏扫`,
      );
      assertEq(judgeScanFloor(leakyFiles).ok, true, "下限判据对「漏一个子目录」必须无能为力(它只管 walker 整体失效)");
      console.log(`[ok] contract:扫描面等式负向(声明 5 / 实测 6 → 判红并点名 test/perf;同树下 ${leakyFiles} 个文件远超下限,下限判绿 —— 证明下限替代不了等式)`);

      // 4. 负向 B:声明 5 个、磁盘只建成 4 个 —— 登记过的目录被删/改名,声明成了空头支票
      const short = makeFixtureTree(["test/segments", "test/main", "test/renderer", "test/common"], 1);
      sandboxes.push(short);
      const shortResult = checkSurfaceEquality(short);
      assertEq(shortResult.ok, false, "声明 5 个、磁盘 4 个时等式必须判红");
      assertEq(shortResult.missing.join(","), "test/tools", "须点名磁盘上已经没有测试源文件的那个目录");
      assertEq(shortResult.extra.length, 0, "这一侧不该有多出目录");
      assert(
        formatSurfaceMismatch(shortResult).includes("test/tools"),
        `诊断须点名 test/tools,实际:${formatSurfaceMismatch(shortResult)}`,
      );
      console.log("[ok] contract:扫描面等式负向(声明 5 / 实测 4 → 判红并点名 test/tools)");

      // 5. 下限的分工:目录集合与磁盘一致、但文件数塌到下限以下 —— 等式判绿,只有下限判红
      const collapsed = makeFixtureTree(SCAN_TARGETS.map((t) => t.dir), 1);
      sandboxes.push(collapsed);
      assertEq(
        checkSurfaceEquality(collapsed).ok,
        true,
        "walker 整体失效时目录集合仍与磁盘一致(等式理应判绿 —— 它管不了文件数)",
      );
      assertEq(
        judgeScanFloor(listScanFiles(collapsed).length).ok,
        false,
        "walker 整体失效(文件数塌到下限以下)必须由下限判红",
      );
      assertEq(judgeScanFloor(MIN_SCAN_FILES - 1).ok, false, "下限 -1 个文件必须判红");
      assertEq(judgeScanFloor(MIN_SCAN_FILES).ok, true, "恰好等于下限应判绿(下界不是排他)");
      const floorText = judgeScanFloor(10).ok ? "" : judgeScanFloor(10).text;
      assert(
        (floorText ?? "").includes(`下限 ${MIN_SCAN_FILES}`),
        `下限诊断须写明下限值,实际:${floorText}`,
      );
      console.log(`[ok] contract:下限判据分工(等式绿 / 下限红;下限 ${MIN_SCAN_FILES} 处为界,文案含下限值)`);
    } finally {
      for (const dir of sandboxes) {
        const outcome = removeTree(dir, { retryDelay: 200 });
        if (!outcome.ok) throw new Error(`contract 夹具清理失败:${dir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
      }
    }
  }
}
