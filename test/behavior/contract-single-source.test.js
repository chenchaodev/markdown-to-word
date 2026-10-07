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
 * - 测试扫描面单源(shared/test-common-surface.js)与它的三条完整性判据,见文件末 (e) 节:
 *   段目录集合与门禁扫描面同源;完整性判据是**等式**(声明目录集合 == 磁盘上真实存在的
 *   测试子目录)+ **下限**(walker 整体失效兜底)+ **镜像**(每个段目录须镜像顶层一棵被断言的
 *   树)三条,各管一件事,双向锚点在本段内。
 *
 * ⚠ 这里曾有 (e) 节「沙盒副本闭包」与它依赖的两层判定(shared/copy-closure.js 的词法层 +
 *   test/common/copy-closure-audit.js 的扫描审计层),已整删:那套判据方向是 fail-open 的
 *   (全局并集 / per-via 只查一个硬编码文件 / 解析不出只登记不判红 / writeFileSync 造副本不可见),
 *   四条形态都写在新门禁 gates/repo/check-copy-sites.mjs 的文件头里。
 *   「沙盒副本的 import 闭包」这个守护没有随之消失,而是降级成两条**定向断言**
 *   (gates/repo/check-temp-cleanup.selftest.mjs 与 test/core/clean-artifacts-gate.test.js 各一条:
 *   副本的相对 import 目标 ⊆ 该沙盒的复制集)—— 重建 auditCopySet 的整个数据模型要贵两个
 *   数量级,买到的判据却更弱。
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
import { removeTree } from "../harness/temp-resource.js";
import {
  MIN_SCAN_FILES,
  SCAN_TARGETS,
  checkSegmentMirrors,
  checkSurfaceEquality,
  formatMirrorMismatch,
  formatSurfaceMismatch,
  judgeScanFloor,
  listScanFiles,
} from "../../shared/test-common-surface.js";
import { ROOT } from "../harness/paths.js";
import { createAsserter } from "../harness/assert.js";

/**
 * 本段横跨的层(ADR-062 L6 判据要求 behavior 段显式声明):判据只校验「非空 ＋ 每个元素
 * 在磁盘上真实存在」,元素是**仓库相对 POSIX 路径**。
 */
export const covers = [
  "src/core/markdown/cross-ref.ts",
  "src/core/ipc-contract.ts",
  "shared/test-common-surface.js",
];

const repoRoot = ROOT;
const srcRoot = path.join(repoRoot, "src");
/** @param {string} rel 相对 src 的 POSIX 路径 */
const readSrc = (rel) => fs.readFileSync(path.join(srcRoot, rel), "utf8");

const { assert } = createAsserter("contract");

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

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

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
    // 声明类型 defaultTexts 是非空只读元组(长度 1|2),与 0 比较被判「无交集」(TS2367)。
    // 但本守卫守的是**运行期产物**:src 的声明与 dist 的实际值可以不一致(改声明未重建、
    // 或产物被别处覆写),此时类型说「非空」而值可能是空数组。故按声明的**只读字符串数组
    // 上界**读取 —— 不是放宽断言(仍与 0 比、仍判空集),只是不依赖这条恒真声明。
    const defaultTexts = /** @type {readonly string[]} */ (def.defaultTexts);
    if (!Array.isArray(def.defaultTexts) || defaultTexts.length === 0) {
      throw new Error(`contract 断言失败:CROSS_REF_KINDS.${kind} 缺 defaultTexts(默认文本集)`);
    }
    if (!defaultTexts.includes(def.defaultText)) {
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

  // ================= (e) 测试扫描面单源:等式 + 下限,两条判据各管一件事 =================
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
      // 声明面恰好是七个段目录 + harness(fixtures 虽有源文件,但按显式理由排除)。
      // 刻意钉成字面量而非从 SEGMENT_DIRS 派生:派生会让它恒真,检测力归零 ——
      // 这条断言的职责就是「声明面多了或少了目录就红」,新增测试段必须在此显式登记。
      // 同一约束另有两处副本:两个 selftest 的 BASE_SHAPE(那边是跟随声明面走,性质相反)。
      assertEq(
        real.declared.join(","),
        "test/behavior,test/cli,test/convert,test/core,test/gates,test/harness,test/main,test/mcp,test/renderer,test/shared",
        "声明面(单一来源)应恰为这 8 个目录",
      );
      assert(
        !real.measured.includes("samples"),
        `排除清单里的 samples 不得出现在实测面(它是样例数据):${real.measured.join(", ")}`,
      );
      const realFiles = listScanFiles(repoRoot).length;
      assertEq(
        judgeScanFloor(realFiles).ok,
        true,
        `真实仓库扫描文件数须满足下限(实测 ${realFiles},下限 ${MIN_SCAN_FILES})`,
      );
      console.log(`[ok] contract:扫描面等式正向(真实仓库声明 ${real.declared.length} 个 == 实测 ${real.measured.length} 个,扫描 ${realFiles} 个文件 ≥ 下限 ${MIN_SCAN_FILES};各段目录各镜像一棵顶层树)`);

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
      console.log(`[ok] contract:扫描面等式负向(声明 6 / 实测 7 → 判红并点名 test/perf;同树下 ${leakyFiles} 个文件远超下限,下限判绿 —— 证明下限替代不了等式)`);

      // 4. 负向 B:声明 8 个、磁盘只建成 7 个 —— 登记过的目录被删/改名,声明成了空头支票。
      // 替身用 test/pending:它历史上真存在过(被删掉的暂存区),与「某个段目录曾经登记过
      // 后来整目录取消」是同一失效形态。
      // 刻意只让 test/gates 缺失:本夹具要验的是「点名那个缺失目录」,缺两个会让断言
      // 退化成验排序。新增段目录时要把它补进下面的建树清单,别动断言。
      const short = makeFixtureTree(["test/core", "test/main", "test/renderer", "test/convert", "test/cli", "test/mcp", "test/harness", "test/shared", "test/behavior"], 1);
      sandboxes.push(short);
      const shortResult = checkSurfaceEquality(short);
      assertEq(shortResult.ok, false, "声明 8 个、磁盘 7 个时等式必须判红");
      assertEq(shortResult.missing.join(","), "test/gates", "须点名磁盘上已经没有测试源文件的那个目录");
      assertEq(shortResult.extra.length, 0, "这一侧不该有多出目录");
      assert(
        formatSurfaceMismatch(shortResult).includes("test/gates"),
        `诊断须点名 test/gates,实际:${formatSurfaceMismatch(shortResult)}`,
      );
      console.log("[ok] contract:扫描面等式负向(声明 8 / 实测 7 → 判红并点名 test/gates)");

      // 4b. 暂存区不许开回来:替身用 test/pending —— 它历史上真存在过(ADR-038 删掉的那个
      // 暂存区),把它原样摆回磁盘上,等式必须点名判红。
      const drawer = makeFixtureTree([...SCAN_TARGETS.map((t) => t.dir), "test/pending"], 1);
      sandboxes.push(drawer);
      const drawerResult = checkSurfaceEquality(drawer);
      assertEq(drawerResult.ok, false, "磁盘上多出 test/pending 这个暂存区时等式必须判红");
      assertEq(drawerResult.extra.join(","), "test/pending", "须点名 test/pending(勿另开暂存区)");
      console.log("[ok] contract:扫描面等式负向(实测多出 test/pending → 判红并点名,抽屉不许开回来)");

      // 4c. 镜像判据的双向锚点:它管的是**声明本身合法**(段目录须镜像顶层一棵被断言的树),
      // 与等式正交 —— 等式只认「声明 == 磁盘」。替身 test/nope:磁盘上不存在同名树,
      // 正是「随手往枚举里加一行杂物抽屉」那个形态。
      const nope = makeFixtureTree(["test/nope"], 1);
      sandboxes.push(nope);
      const nopeResult = checkSegmentMirrors(nope, ["nope"]);
      assertEq(nopeResult.ok, false, "段目录不镜像任何顶层树时必须判红(否则枚举可无限膨胀)");
      assertEq(nopeResult.offenders.join(","), "test/nope", "须点名那个不镜像的段目录");
      assert(
        formatMirrorMismatch(nopeResult).includes("顶层没有可镜像的 nope/"),
        `镜像诊断须点名 nope 缺顶层镜像树,实际:${formatMirrorMismatch(nopeResult)}`,
      );
      // `fixtures` / `acceptance` 两个名字显式禁止当段目录:它们是数据区与入口,
      // 即便顶层真有同名树也不许往里塞段。
      //
      // ⚠ **本段原先在这里断的是 `harness`,T3 步 6 起它不再是禁止项** —— harness 已
      // 登记为**自指层**段目录(被测主体就是 `test/harness/**` 自己),豁免「必须镜像」
      // 的依据从「禁止表」搬到了 `NON_MIRROR_SEGMENT_DIRS`。故禁止表少一项、豁免表多一项,
      // 两处必须同批改(否则「以为豁免了、实际被禁止」)。下面两格分别断这两张表的新形状。
      for (const banned of ["fixtures", "acceptance"]) {
        const rejected = checkSegmentMirrors(nope, [banned]);
        assertEq(rejected.ok, false, `${banned} 是数据区/入口名,登记成段目录必须判红`);
        // 诊断文案里的三字诀是**一张**表的共称(「harness/数据区/入口名」,harness 如今
        // 已不在表内,但共称沿用未改),故这里按共称断言而非按被点名的那一项。
        assert(
          formatMirrorMismatch(rejected).includes("harness/数据区/入口名"),
          `镜像诊断须点明 ${banned} 被排除的理由,实际:${formatMirrorMismatch(rejected)}`,
        );
      }
      // harness 是**段目录**(自指层)且豁免镜像义务 —— 这一格与上面那两格方向相反,
      // 两张表语义相近而相反,分开断才不会被「混用后恰好判红」蒙过去。
      assertEq(
        checkSegmentMirrors(nope, ["harness"]).ok,
        true,
        "harness 是自指层段目录(主体 = test/harness/**),豁免镜像义务而非被禁止",
      );
      console.log("[ok] contract:段目录镜像判据负向(声明 test/nope、test/fixtures、test/acceptance → 判红并点名;harness 自指层豁免镜像;等式判不出的那一侧由它兜住)");

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
