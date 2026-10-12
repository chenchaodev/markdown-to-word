// 落盘失败码登记完整性门禁自身的回归守护(负向夹具 + 真变异)。
//
// check-output-unwritable-registry.mjs 是「漏登记一个落盘失败码」这一族的唯一机器看守。
// 而这一族的失效形态**天然是静默的**:判据退化成「永远 exit 0」时,真实症状是
// 某个落盘失败点漏登记、CLI 退出码从 4 悄悄变 3 —— 没有任何东西会因此报红。
// 本脚本让每一处退化都判红。
//
// ---- 三层守护,互不替代 ----
// ① **基线档**:真实仓库零未登记命中,且不覆盖登记表的每一条**确实命中**
//    (usedNotOutput 对得上)。只断言「零问题」的话,把登记表删空也能照样绿 ——
//    那正是恒绿的一个入口。
// ② **合成根档**:在临时目录里造一棵最小产物链,把五种已知失效形态逐条写成源码,
//    断言门禁逐条报出来;并造「已登记豁免 / errno 守卫重抛 / promise.catch 回调」的对照,
//    断言它们**零命中**。这一层验的是「判据的窄度」—— 放宽了判据,对照格先红。
// ③ **真变异档**:真改源文件,跑一遍,再逐字还原,断言每种退化都被抓住。
//    合成根档验的是判定本体的**逻辑**,本档验的是**它真的接在 CLI 上**(出口码、诊断前缀)。
//
// ⚠ **变异窗口内不许并发改动被变异文件**:`finally` 还原之前若有第三方写入,还原会覆盖它。
// 故还原前**先比对**,发现文件已不是本档写进去的那份就**拒绝还原**并判红 ——
// 宁可让本档红着,也不许静默吃掉别人的改动(与 tools/req-edit.mjs 的 TOCTOU 防线同一条理由)。
//
// ⚠ **临时产物必须在 finally 清理**:中途断言失败抛异常时同样要删。
//
// ⚠ **变异目标是 `src/convert/artifact-writer.ts`**,而它正是本门禁判红时的**修复面**。
// 这是有意的:变异注入的正是「新增一个落盘失败点却忘了登记码」那个真实缺陷的形态,
// 修复动作与真实修复同款(把该点改为 outputUnwritableError(已登记键, …))。
//
// ---- 形态:case 契约接入,不接 harness(ADR-074 决定一)----
// 用 `shared/case.js` 的 `createCaseSuite`,逐档 `await suite.case(档名, …)`。
// 入参是「源码文本 + 仓内相对路径」与「临时树路径」,不是 harness 那张
// 「树型路径 → 正文 + 问题清单正则」的表 —— 塞进去是假接入,故 bespoke 留在原处。

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, createCaseSuite } from "../../shared/case.js";
import { ROOT } from "../../shared/paths.js";
// 判定本体静态 import:合成根档要**逐条调它的纯函数**(两遍判定的产物);变异档走 CLI 子进程
// (变异的是磁盘上的源码,已 import 的这份不受影响 —— 两条路径各验各的,互不替代)。
import {
  analyze,
  judge,
  runSelfProbe,
  NOT_OUTPUT_FAILURES,
  MIN_REGISTRY_CODES,
  MIN_SCANNED_FILES,
  SCAN_ROOTS,
} from "./check-output-unwritable-registry.mjs";

const projectRoot = ROOT;
const checkerRel = "gates/repo/check-output-unwritable-registry.mjs";
const checkerPath = join(projectRoot, ...checkerRel.split("/"));
/** 被变异档改写的真实仓库文件(登记表单源 + 两处补码的所在地) */
const subjectRel = "src/convert/artifact-writer.ts";
const subjectPath = join(projectRoot, ...subjectRel.split("/"));

/**
 * 把折行统一成 LF;再按目标文件**自身**的折行放回去。
 *
 * ⚠ 锚点为什么必须行尾无关:判定本体的检出形态由各端 autocrlf 决定
 * (`* text=auto` + Windows runner 的 `core.autocrlf=true` ⇒ 检出即 CRLF)。
 * 拿 LF 锚点直接去 `includes` 一份 CRLF 源码,恒不命中 —— 而失败形态是「找不到锚点」,
 * 看着像锚点写错了,实则是行尾,于是本地(LF)绿、CI(CRLF)恒红。
 * 手法照 check-eol-anchor.selftest.mjs 的同名函数(那处是本仓现成先例)。
 * @param {string} lfText 折行已归一为 LF 的文本
 * @param {string} eol 原文件实际使用的折行
 * @returns {string} 按 `eol` 折行的文本
 */
function withFileEol(lfText, eol) {
  return eol === "\n" ? lfText : lfText.replace(/\n/g, eol);
}

/**
 * 真变异:改一份源文件的正文,跑一遍门禁 CLI,再逐字还原。
 *
 * ⚠ **必须是真改变行为**:断言 `from !== to` 只是最弱的一道闸,真正保证「变异有效」的是
 * 随后的那一格 —— 若改的那段不在判定路径上,门禁会与基线同色,而那一格正是各档断言的内容。
 * @param {string} targetPath 被变异文件绝对路径
 * @param {string} from 原字面量(按 LF 书写)
 * @param {string} to 替换字面量(按 LF 书写)
 * @returns {{ status: number | null, stdout: string, stderr: string, restored: boolean }}
 */
function mutateAndRun(targetPath, from, to) {
  const original = readFileSync(targetPath, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const probe = original.replace(/\r\n/g, "\n");
  const anchor = from.replace(/\r\n/g, "\n");
  const replacement = to.replace(/\r\n/g, "\n");
  if (!probe.includes(anchor)) {
    throw new Error(`变异定位失败:${targetPath} 里找不到 ${JSON.stringify(anchor)}`);
  }
  if (from === to) throw new Error("变异是空操作:结论会是假的");
  const mutated = withFileEol(probe.replace(anchor, replacement), eol);
  if (mutated === original) throw new Error("变异未改变文件内容:结论会是假的");
  writeFileSync(targetPath, mutated, "utf8");
  /** @type {{ status: number | null, stdout: string, stderr: string, restored: boolean }} */
  let run;
  let restored = false;
  try {
    const result = spawnSync(process.execPath, [checkerPath], { cwd: projectRoot, encoding: "utf8" });
    run = { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", restored: false };
  } finally {
    // 还原前先比对:文件若已不是本档写进去的那份,说明有第三方在变异窗口内写过它,
    // 还原会覆盖对方的改动 —— 那种情况下宁可判红,也不许静默吃掉。
    const now = readFileSync(targetPath, "utf8");
    if (now === mutated) {
      writeFileSync(targetPath, original, "utf8");
      restored = true;
    }
    run.restored = restored;
  }
  return run;
}

/**
 * 合成根:在临时目录里造一棵最小扫描面。
 * @param {Record<string, string>} files 仓相对 POSIX 路径 → 源码正文(按 LF 书写)
 * @param {"\n" | "\r\n"} [eol] 落盘折行(默认 LF;CRLF 那一档用来复刻真实检出形态)
 * @returns {string} 临时根绝对路径
 */
function makeSyntheticRoot(files, eol = "\n") {
  const root = mkdtempSync(join(tmpdir(), "output-unwritable-selftest-"));
  for (const [rel, source] of Object.entries(files)) {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, withFileEol(source, eol), "utf8");
  }
  return root;
}

/**
 * 造一份合成产物链的源码:登记表头 + 一段 catch 体。
 *
 * ⚠ **登记表键名按 `tag` 参数化**:同一棵合成根里会并排放多个夹具文件,若它们都用
 * `thrown` / `alsoThrown` 这组键名,第二个文件起就会被判「登记表出现第二个声明点」——
 * 那是一条**真**问题,但它会盖住本档要验的那一条(诊断指向 A、真因是 B 的典型)。
 * 键名带档标是让「并排放置」这件事本身合法,而不是把并排放置从判据里绕过去。
 *
 * `catchBody` 是 catch 块内的**逐行**正文(按 LF 拼接),由各档自己给 —— 差异只在那一段,
 * 而不在样板(样板变了就不是「同一处形态的两种写法」对照了)。
 * @param {string} tag 档标(大写 ASCII;进键名与码值)
 * @param {string[]} catchBody catch 块内的逐行正文
 * @param {{ extraEntries?: string[], params?: string }} [opts] extraEntries = 追加的登记条目
 *   (死条目那一档用);params = `commit` 的形参表(实参不可核那一档要一个 `code` 形参)
 * @returns {string}
 */
function syntheticWriter(tag, catchBody, opts = {}) {
  const thrownKey = `${tag}_THROWN`;
  const alsoKey = `${tag}_ALSO_THROWN`;
  return [
    "export const OUTPUT_UNWRITABLE_CODES = Object.freeze({",
    `  ${thrownKey}: "OUTPUT_${tag}_THROWN",`,
    `  ${alsoKey}: "OUTPUT_${tag}_ALSO_THROWN",`,
    ...(opts.extraEntries ?? []),
    "} as const);",
    "export function outputUnwritableError(code, message) {",
    "  return Object.assign(new Error(message), { code });",
    "}",
    `export async function commit(dir${opts.params === undefined ? "" : `, ${opts.params}`}) {`,
    `  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.${thrownKey}, 'ok');`,
    `  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.${alsoKey}, 'ok');`,
    "  try {",
    "    await fs.open(dir, 'wx');",
    "  } catch (err) {",
    ...catchBody,
    "  }",
    "}",
  ].join("\n");
}

const suite = createCaseSuite();

/* ---------- 档表 ---------- */

/**
 * 已知失效形态:每个文件复现真实仓库里那一处的**判定形态**(不必逐字相同,复现的是
 * 「码不在表里 / 码已登记但没人抛 / 裸 throw err 未登记 / 第二个声明点」这四条结构)。
 *
 * ⚠ **档名(`name`)写在表里而不是拼在 `suite.case(...)` 上**:档名册要能机械抽到它,
 * 而 `inline-case` 那档只认**字面量**首参 —— 写成模板串抽出来的是那段模板原文,
 * 名册上就成了一条与运行时档名对不上的假记录。
 * 故 `name` 是字面量,登记表的取名策略相应地是 `table-field: KNOWN_SHAPES.name`。
 */
const KNOWN_SHAPES = Object.freeze([
  {
    name: "已知失效判红:未登记的新码(字面量实参,值不在表里)",
    rel: "src/convert/probe-literal.ts",
    kind: "call-unregistered-code",
    build: () =>
      syntheticWriter("PROBE_LITERAL", [
        "  throw outputUnwritableError('OUTPUT_MADE_UP', '码不在表里');",
      ]),
  },
  {
    name: "已知失效判红:未登记的新码(键形态,键不在表里)",
    rel: "src/convert/probe-unknown-key.ts",
    kind: "call-unregistered-code",
    build: () =>
      syntheticWriter("PROBE_UNKNOWN_KEY", [
        "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.NOT_A_KEY, '表里没这个键');",
      ]),
  },
  {
    name: "已知失效判红:实参静态不可核(变量形态,等于没有契约)",
    rel: "src/convert/probe-unresolvable.ts",
    kind: "call-unresolvable-arg",
    build: () =>
      syntheticWriter("PROBE_UNRESOLVABLE", ["  throw outputUnwritableError(code, '静态不可核');"], {
        params: "code",
      }),
  },
  {
    name: "已知失效判红:登记了却没人抛的死条目(A② 反向那一半)",
    rel: "src/convert/probe-dead-key.ts",
    kind: "registry-key-unused",
    build: () =>
      syntheticWriter("PROBE_DEAD_KEY", [], {
        extraEntries: ['  PROBE_DEAD_KEY_NEVER: "OUTPUT_PROBE_DEAD_KEY_NEVER",'],
      }),
  },
  {
    name: "已知失效判红:catch 里的裸 throw err 未登记(判据 B 的默认档)",
    rel: "src/convert/probe-bare-rethrow.ts",
    kind: "throw-unclassified",
    build: () => syntheticWriter("PROBE_BARE", ["    throw err;"]),
  },
  {
    name: "已知失效判红:登记表出现第二个声明点(单源被破坏)",
    rel: "src/convert/probe-second-decl.ts",
    kind: "registry-duplicated",
    extra: {
      "src/convert/probe-first-decl.ts": syntheticWriter("PROBE_FIRST_DECL", []),
    },
    build: () => syntheticWriter("PROBE_FIRST_DECL", []),
  },
]);

/** 对照形态:与已知失效同族但**不是雷**,断言它们零命中(这一组是判据窄度的护栏)。 */
const SAFE_SHAPES = Object.freeze([
  {
    name: "反向锚点判绿:正常形态(登记表双向齐 + catch 里包码)",
    rel: "src/convert/probe-safe-normal.ts",
    build: () =>
      syntheticWriter("PROBE_SAFE_NORMAL", [
        "    throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.PROBE_SAFE_NORMAL_THROWN, '落盘写不了');",
      ]),
  },
  {
    name: "反向锚点判绿:已登记豁免的形态(真实故障原样上抛那条,证明豁免机制有牙)",
    rel: "src/convert/artifact-writer.ts",
    // ⚠ 路径**必须**是 `src/convert/artifact-writer.ts`:不覆盖登记表按
    // 「文件 × 片段」匹配,换路径就不匹配 ⇒ 这一格验的不是豁免机制而是路径查找。
    build: () => syntheticWriter("PROBE_SAFE_REGISTERED", ["    throw err; // 真实故障"]),
  },
  {
    name: "反向锚点判绿:errno 守卫分支里的原样重抛(逐个 errno 显式决策过,档②)",
    rel: "src/convert/probe-safe-guarded.ts",
    build: () =>
      syntheticWriter("PROBE_SAFE_GUARDED", [
        "    if (errnoCode(err) === 'EEXIST') {",
        "      throw err;",
        "    }",
        "    throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.PROBE_SAFE_GUARDED_THROWN, '落盘写不了');",
      ]),
  },
  {
    name: "反向锚点判绿:promise.catch(…) 回调体不是 catch 语句块(方法不是块)",
    rel: "src/convert/probe-safe-promise-catch.ts",
    // ⚠ 两种带块-bodied 的 promise 回调形态都在这一族:`.catch(() => {` 与 `.catch(onFail => {`。
    // 它们与 `catch (err) {` 在文本上只差记号前驱;本门禁靠「绑定组与 `{` 之间必须先闭合
    // 一个 `)`」把它们排除 —— 这一格就是**那条机制的反向锚**。
    source: [
      "export const OUTPUT_UNWRITABLE_CODES = Object.freeze({",
      '  PROBE_SAFE_PROMISE_THROWN: "OUTPUT_PROBE_SAFE_PROMISE_THROWN",',
      '  PROBE_SAFE_PROMISE_ALSO_THROWN: "OUTPUT_PROBE_SAFE_PROMISE_ALSO_THROWN",',
      "} as const);",
      "export function outputUnwritableError(code, message) {",
      "  return Object.assign(new Error(message), { code });",
      "}",
      "export function commit() {",
      "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.PROBE_SAFE_PROMISE_THROWN, 'ok');",
      "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.PROBE_SAFE_PROMISE_ALSO_THROWN, 'ok');",
      "  return fs.open('x', 'wx').catch(() => {",
      "    throw new Error('回调里随便抛');",
      "  });",
      "}",
    ].join("\n"),
  },
  {
    name: "反向锚点判绿:catch 体里无 throw(回落 + warning 的形态,如 paths.ts 的 mkdir 分支)",
    rel: "src/convert/probe-safe-no-throw.ts",
    build: () => syntheticWriter("PROBE_SAFE_NO_THROW", ["    warnings.push({ key: 'warn.outputDirUnavailable' });"]),
  },
]);

const MUTATIONS = Object.freeze([
  {
    name: "变异① 往真实文件注入一个未登记的新落盘失败点 ⇒ 必须判红(本工作项的真缺陷形态)",
    target: "subject",
    from: "          OUTPUT_UNWRITABLE_CODES.tempUnwritable,",
    to: "          OUTPUT_UNWRITABLE_CODES.tempUnwr1table,",
    expect: "red",
    expectKind: "call-unregistered-code",
  },
  {
    name: "变异② 把补码处整段改回裸 throw err ⇒ 必须判红(补码被回退时的真症状)",
    target: "subject",
    from: [
      "        throw outputUnwritableError(",
      "          OUTPUT_UNWRITABLE_CODES.tempUnwritable,",
    ].join("\n"),
    to: [
      "        throw err;",
      "        void outputUnwritableError(",
      "          OUTPUT_UNWRITABLE_CODES.tempUnwritable,",
    ].join("\n"),
    expect: "red",
    expectKind: "throw-unclassified",
  },
  {
    name: "变异③ 摘掉已登记豁免那行的注释 ⇒ 必须判红(豁免按内容匹配,注释没了就不匹配)",
    target: "subject",
    from: "      throw err; // 真实故障(EIO/ENOSPC 等)原样上抛",
    to: "      throw err;",
    expect: "red",
    expectKind: "throw-unclassified",
  },
  {
    name: "变异④ 真修法:把该真实故障点改为包已登记码 ⇒ 必须判绿(证明正路修法能过门禁)",
    target: "subject",
    from: "      throw err; // 真实故障(EIO/ENOSPC 等)原样上抛",
    to: [
      "      throw outputUnwritableError(",
      "        OUTPUT_UNWRITABLE_CODES.linkUnsupported,",
      "        `提交失败:${String(err)}`,",
      "      );",
    ].join("\n"),
    expect: "green",
  },
  {
    name: "变异⑤ A① 档失效:实参形态一个都不认 ⇒ 探针先判红(判据本体坏了)",
    target: "checker",
    from: "export const ARG_KEY_RE = /^OUTPUT_UNWRITABLE_CODES\\s*\\.\\s*([A-Za-z_$][\\w$]*)$/;",
    to: "export const ARG_KEY_RE = /^(?!)/;",
    expect: "red-probe",
  },
  {
    name: "变异⑥ B 档失效:档① 不再认出错误码构造 ⇒ 探针先判红(证明三档的档①真在)",
    target: "checker",
    from: "export const CODED_THROW_RE = /\\boutputUnwritableError\\s*\\(/;",
    to: "export const CODED_THROW_RE = /(?!)/;",
    expect: "red-probe",
  },
  {
    name: "变异⑦ B 档失效:绑定组改成不闭合 ⇒ 探针先判红(.catch 回调体被当成 catch 块了)",
    target: "checker",
    // ⚠ 这一条锚的是**真正承重的那半句**:绑定组从「`(?:\(…\))?` 整体可选」改成
    // 「`\(…` 之后**不要求**闭合的 `)`」⇒ `.catch(() => {` / `.catch(onFail => {` 的回调体
    // 被收成 catch 块 ⇒ 判据 B 对 promise 回调体误伤。
    // ⚠ **刻意不用「去掉前置断言」那种变异**:实测(2026-10-12)那条对判据**没有任何影响**
    // (括号里那个 `)` 本来就配不上 `{`)⇒ 用它当变异档等于挂一个恒绿档。
    from: "export const CATCH_RE = /catch\\s*(?:\\(([^()]*(?:\\([^()]*\\)[^()]*)*)\\))?\\s*\\{/g;",
    to: "export const CATCH_RE = /catch\\s*\\(?([^()]*(?:\\([^()]*\\)[^()]*)*)?\\s*\\{/g;",
    expect: "red-probe",
  },
]);

/* ---------- ① 基线档:真实仓库 ---------- */

const baseline = analyze();
console.log(
  `[output-unwritable-registry-selftest] 基线:真实仓库 ${baseline.files} 个文件 / `
    + `${baseline.calls} 处错误码构造 / 登记表 ${baseline.registryKeys} 条码`,
);

await suite.case("真实仓库零未登记命中(登记表双向对读 + catch-throw 三档扣完之后)", () => {
  assert(
    baseline.problems.length === 0,
    `真实仓库有 ${baseline.problems.length} 项未登记命中:`
      + baseline.problems.map((p) => `${p.file}:${p.line}/${p.kind}`).join(" "),
  );
});

await suite.case("不覆盖登记条目确实命中(否则「零问题」只是登记匹配坏掉的假绿)", () => {
  assert(
    baseline.usedNotOutput > 0,
    "不覆盖登记表一条都没命中 —— 要么匹配条件写坏(恒绿入口),要么真实命中被静默放过,两个方向都要查",
  );
  assert(
    baseline.usedNotOutput === NOT_OUTPUT_FAILURES.length,
    `不覆盖登记 ${NOT_OUTPUT_FAILURES.length} 条本次命中 ${baseline.usedNotOutput} 条,须逐条相等`,
  );
});

await suite.case("不覆盖登记表零失效条目(失效条目要么雷被收了、要么判据漂了)", () => {
  assert(
    baseline.staleNotOutput.length === 0,
    `零命中的不覆盖登记条目:${baseline.staleNotOutput.join(" ")}(该删或该查,不许留着装样子)`,
  );
});

await suite.case("catch-throw 三档都真在命中(某一档恒零说明它的判据要么写坏要么没人在用)", () => {
  assert(
    baseline.tierCounts.coded > 0,
    "档①(包码)零命中:要么真没有包码的落盘失败点(本仓不可能),要么档① 判据写坏了",
  );
  assert(
    baseline.tierCounts.registered > 0,
    "档③(登记豁免)零命中:要么登记匹配条件写坏,要么真实命中被静默放过",
  );
});

await suite.case("内建探针全过(探针是判据本身的回归测试,不是装饰)", () => {
  const failed = runSelfProbe().filter((item) => !item.ok);
  assert(failed.length === 0, `探针未过:${failed.map((item) => `${item.id}(${item.detail})`).join(" ")}`);
});

await suite.case("CLI 在未变异的真实仓库上 exit 0 且打 [ok] 行", () => {
  const result = spawnSync(process.execPath, [checkerPath], { cwd: projectRoot, encoding: "utf8" });
  assert(result.status === 0, `期望 exit 0,实得 ${result.status};stderr:${result.stderr}`);
  assert(
    (result.stdout ?? "").includes("[ok] 落盘失败码登记完整性判定通过"),
    `未见 [ok] 行;stdout:${result.stdout}`,
  );
});

/* ---------- ② 合成根档:判据的窄度 ---------- */

for (const shape of KNOWN_SHAPES) {
  await suite.case(shape.name, () => {
    const modules = [
      ...Object.entries(shape.extra ?? {}).map(([rel, text]) => ({ rel, text })),
      { rel: shape.rel, text: shape.build() },
    ];
    const result = judge(modules);
    assert(
      result.problems.some((problem) => problem.kind === shape.kind),
      `形态未被判红或判红的是另一族:${shape.name}(${shape.rel})`
        + `期望 ${shape.kind},实得 ${result.problems.map((p) => `${p.line}:${p.kind}`).join(" ") || "(零)"}`,
    );
  });
}

for (const shape of SAFE_SHAPES) {
  await suite.case(shape.name, () => {
    const text = shape.source ?? shape.build();
    const result = judge([{ rel: shape.rel, text }]);
    assert(
      result.problems.length === 0,
      `不该命中却命中了:${shape.name} → ${result.problems.map((p) => `${p.line}/${p.kind}`).join(" ")}`,
    );
  });
}

/** 把一组档落成「仓相对 POSIX 路径 → 正文」;`extra` 先落,同名者被主档覆盖。 */
function toFiles(shapes) {
  /** @type {Record<string, string>} */
  const files = {};
  for (const shape of shapes) {
    for (const [rel, text] of Object.entries(shape.extra ?? {})) files[rel] = text;
    files[shape.rel] = shape.source ?? shape.build();
  }
  return files;
}

await suite.case("合成根逐条报齐(判定本体 + 不覆盖登记表 + walker 这一整条链)", () => {
  const files = toFiles(KNOWN_SHAPES);
  const root = makeSyntheticRoot(files);
  try {
    const result = analyze({ root });
    for (const shape of KNOWN_SHAPES) {
      assert(
        result.problems.some((problem) => problem.file === shape.rel && problem.kind === shape.kind),
        `合成根未报出已知失效:${shape.rel} 期望 ${shape.kind},`
          + `实得 ${result.problems.filter((p) => p.file === shape.rel).map((p) => p.kind).join(",") || "(零)"}`,
      );
    }
    assert(
      result.files === Object.keys(files).length,
      `扫描面应恰为 ${Object.keys(files).length} 个文件,实得 ${result.files}(walker 的失效方向是「少扫」)`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await suite.case("合成根以 CRLF 落盘(复刻 Windows runner 的检出形态)结论不变", () => {
  const files = toFiles(KNOWN_SHAPES);
  const root = makeSyntheticRoot(files, "\r\n");
  try {
    const result = analyze({ root });
    for (const shape of KNOWN_SHAPES) {
      assert(
        result.problems.some((problem) => problem.file === shape.rel && problem.kind === shape.kind),
        `CRLF 落盘后未报出已知失效:${shape.rel}/${shape.kind}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await suite.case("对照形态落进合成根也零命中(窄度是走整条链验的,不是只验判定本体)", () => {
  const files = toFiles(SAFE_SHAPES);
  const root = makeSyntheticRoot(files);
  try {
    const result = analyze({ root });
    assert(
      result.problems.length === 0,
      `对照形态被判红:${result.problems.map((p) => `${p.file}:${p.line}/${p.kind}`).join(" ")}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await suite.case("登记表塌缩(清空登记表)在零判定面上不得判绿", () => {
  // 这一格守的是「A①② 都在近乎零判定面上」那一档假绿:文件数下限照过,而两条判据无事可判。
  // 合成根里把登记表写成空对象(两条码全删)⇒ 判定本体仍会因「登记表塌缩」报出零问题,
  // 故这里断言的是**判定本体**那一层:它必须报 `registry-missing`,不是安静通过。
  const empty = [
    "export const OUTPUT_UNWRITABLE_CODES = Object.freeze({} as const);",
    "export function outputUnwritableError(code, message) {",
    "  return Object.assign(new Error(message), { code });",
    "}",
    "export function commit() {",
    "  throw outputUnwritableError(OUTPUT_UNWRITABLE_CODES.nothing, '表已清空');",
    "}",
  ].join("\n");
  const result = judge([{ rel: "src/convert/artifact-writer.ts", text: empty }]);
  assert(
    result.registryKeys === 0,
    `登记表清空后应认出 0 条码,实得 ${result.registryKeys}`,
  );
  assert(
    result.problems.some((problem) => problem.kind === "registry-missing"),
    `登记表清空必须报 registry-missing(否则 A①② 在零判定面上全绿),实得 ${result.problems.map((p) => p.kind).join(",")}`,
  );
  assert(
    MIN_REGISTRY_CODES > 0 && result.registryKeys < MIN_REGISTRY_CODES,
    `塌缩下限 ${MIN_REGISTRY_CODES} 未挡住这一档 —— 若被改成 0,CLI 层就不再有第二道闸`,
  );
});

await suite.case("扫描面塌缩下限高于空树(防空门禁那一档不是摆设)", () => {
  // MIN_SCANNED_FILES 若被改成 0/1,「目录被搬走 ⇒ 零文件 ⇒ 恒绿」就再无人拦。
  // 这里断言它既为正、又高于「空树」这一档 —— 空树是塌缩的极端形态,是最容易整条判据失效的入口。
  const emptyRoot = makeSyntheticRoot({});
  try {
    const result = analyze({ root: emptyRoot });
    assert(result.files === 0, `空合成根应扫到 0 个文件,实得 ${result.files}`);
    assert(
      MIN_SCANNED_FILES > result.files,
      `塌缩下限 ${MIN_SCANNED_FILES} 未高于空树(0)—— 该档被改坏时本门禁会恒绿`,
    );
    assert(
      SCAN_ROOTS.length > 0 && SCAN_ROOTS.every((dir) => dir.startsWith("src/")),
      `扫描面 ${SCAN_ROOTS.join(" ")} 不是产物落盘链路(src/ 之下)—— 收窄/放宽都要显式改这里`,
    );
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }
});

/* ---------- ③ 真变异档:退化必须被抓住 ---------- */

for (const mutation of MUTATIONS) {
  await suite.case(mutation.name, () => {
    const targetPath = mutation.target === "checker" ? checkerPath : subjectPath;
    const run = mutateAndRun(targetPath, mutation.from, mutation.to);
    assert(run.restored, `变异窗口内 ${targetPath} 被第三方改过,本档拒绝还原(否则会吃掉别人的改动)`);
    if (mutation.expect === "green") {
      assert(run.status === 0, `期望判绿,实得 exit ${run.status};stderr:${run.stderr}`);
      return;
    }
    assert(run.status === 1, `期望 exit 1,实得 ${run.status};stderr:${run.stderr}`);
    if (mutation.expect === "red-probe") {
      assert(
        run.stderr.includes("self-probe:fail"),
        `期望失败点在自检探针上(判据本体坏了),实得:\n${run.stderr}`,
      );
      return;
    }
    assert(
      run.stderr.includes("[output-unwritable-registry:fail]"),
      `未见诊断前缀 [output-unwritable-registry:fail];stderr:\n${run.stderr}`,
    );
    assert(
      !run.stderr.includes("self-probe:fail"),
      `注入的是真实命中,不该由探针先拦;stderr:\n${run.stderr}`,
    );
    assert(
      run.stderr.includes(mutation.expectKind),
      `判红了但不是预期那一族:期望诊断含 ${mutation.expectKind},stderr:\n${run.stderr}`,
    );
  });
}

await suite.case("变异全部还原后 CLI 复绿(收尾那一格:证明前面每一档都没留下残留)", () => {
  const result = spawnSync(process.execPath, [checkerPath], { cwd: projectRoot, encoding: "utf8" });
  assert(result.status === 0, `还原后仍应 exit 0,实得 ${result.status};stderr:${result.stderr}`);
});

/* ---------- 收尾 ---------- */

const cases = suite.results;
const failures = suite.failures;
if (suite.hasFailures) {
  for (const failure of failures) {
    console.error(`[output-unwritable-registry-selftest:fail] ${failure.name}:${failure.message ?? "(无失败消息)"}`);
  }
  console.error(`[output-unwritable-registry-selftest:fail] ${failures.length}/${cases.length} 条不通过`);
  process.exit(1);
}
console.log(`[ok] output-unwritable-registry-selftest:${cases.length}/${cases.length} 条全绿`);
