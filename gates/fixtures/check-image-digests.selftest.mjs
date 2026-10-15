// 图片夹具字节基线门禁自身的回归守护(负向夹具 + 真变异 + 防空门禁)。
//
// ---- 为什么必须有这份 selftest ----
// 基线是那几张**没被任何样例引用**的图唯一的字节看守(input/g4-preview.png 与 manual/images/
// 下两张):生成器的 imageCopies 只比对被样例引用到的图片,而「源与副本同时被改」时它恒绿。
// 这族失效的症状是**静默的** —— 判据退化成「永远 exit 0」时,没人会看到任何东西变红,
// 只有依赖夹具的段(image-size / basic-render)莫名其妙红起来,排查方向被带偏。
// 本脚本让每一处退化都判红。
//
// ---- 三层守护,互不替代 ----
// ① **基线档**(CASES 表,合成夹具树上跑 CLI):反向锚点 + 两档注入(字节漂移 / 未登记)。
//    两档是**从 `gen-fixtures.selftest.mjs` 迁来的** —— 判定体迁到独立门禁后,它们若留在原处
//    就守的是「生成器顺带比过了字节」,而不是「这道门禁判红」;迁过来后它们直接验 CLI 的退出码
//    与诊断前缀。
// ② **判定层档**(内联):「`fixtures = null` 是合法终态」三档判定 + 已知不覆盖的机械体现 +
//    两道塌缩下限的正性。
// ③ **真变异档**:真改门禁本体(基线表),跑 CLI,再逐字还原,断言退化被抓住。
//    合成树档验的是「判定逻辑」,本档验的是「它真的接在 CLI 上」(退出码、诊断前缀、判定次序)。
//
// ⚠ **变异窗口内不许并发改动被变异文件**:`finally` 还原之前若有第三方写入,还原会覆盖它。
// 故还原前**先比对**,发现文件已不是本档写进去的那份就**拒绝还原**并判红 ——
// 宁可让本档红着,也不许静默吃掉别人的改动(与 tools/req-edit.mjs 的 TOCTOU 防线同一条理由)。
// 被变异的 `check-image-digests.mjs` 同时是 `gen-fixtures.mjs` 的 import 源与本门禁的修复面,
// 这是有意的:本门禁判红时的修法就是改它那张基线表。
//
// ⚠ **临时产物必须在 finally 清理**:中途断言失败抛异常时同样要删。
//
// ---- 形态:case 契约接入,不接 harness(ADR-074 决定一)----
// 用 `shared/case.js` 的 `createCaseSuite`,逐档 `await suite.case(档名, …)`。
// 入参是「合成夹具树路径」与「门禁 CLI 的退出码 + 诊断」,不是 harness 那张
// 「树型路径 → 正文 + 问题清单正则」的表 —— 塞进去是假接入,故 bespoke 留在原处。
//
// ⚠ **不复制门禁本体**:门禁**原位**从仓内跑、只靠 cwd 指夹具(项目根单一来源是
// shared/paths.js 的 process.cwd();ESM 静态 import 按文件位置解析、与 cwd 无关,
// 故真脚本的仓内依赖天然可达)。复制一份进来会把「规则的演进」冻在夹具里。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, createCaseSuite } from "../../shared/case.js";
import { FIXTURES_DIR, ROOT } from "../../shared/paths.js";
// 判定本体静态 import:合成树档与判定层档直接调它的纯函数;变异档走 CLI 子进程
// (变异的是磁盘上的源码,已 import 的这份不受影响 —— 两条路径各验各的,互不替代)。
import {
  IMAGE_DIGEST_BASELINE,
  MIN_BASELINE_ENTRIES,
  MIN_IMAGE_FIXTURES,
  auditImageTree,
  classifyFixturesDeclaration,
  listImageFixtures,
} from "./check-image-digests.mjs";

const checkerPath = join(ROOT, "gates", "fixtures", "check-image-digests.mjs");

/**
 * 造一棵合成夹具树,并按当前基线逐个造出那几张图。
 *
 * 为什么要**按基线造**:基线是模块常量,合成树里没有这些图时「未漂移」也恒判红(基线残留),
 * 正向锚点就失去意义。字节从真实仓库**读**(只读真实仓库,不改它)。
 * 本门禁不 import 任何测试段 ⇒ 合成树无需造段目录,也不需要 `package.json {type:"module"}`。
 * @param {(dir: string) => void} [mutate] 造完之后施加的注入
 * @returns {string} 合成树根绝对路径
 */
function buildTree(mutate) {
  const root = mkdtempSync(join(tmpdir(), "m2w-image-digests-selftest-"));
  try {
    for (const rel of Object.keys(IMAGE_DIGEST_BASELINE)) {
      const target = join(root, "samples", ...rel.split("/"));
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, readFileSync(join(FIXTURES_DIR, ...rel.split("/"))), "utf8");
    }
    // `mutate` 用「非函数」判空而不是 `!== undefined`:夹具表里「无注入」那条写的是
    // `mutate: null`,若按 undefined 判空会把 null 当函数调用 → TypeError 崩在夹具里。
    if (typeof mutate === "function") mutate(root);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 以某一层 cwd 跑仓内门禁本体(cwd 决定 ROOT,即夹具根)。
 * @param {string} cwd 工作目录
 * @param {string[]} args 传给门禁的参数
 * @returns {{ code: number | null; stdout: string; stderr: string }}
 */
function runGate(cwd, args) {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * 真变异:改门禁本体里基线表的一段正文,跑一遍门禁 CLI,再逐字还原。
 *
 * ⚠ **还原前先比对**:文件若已不是本档写进去的那份,说明有第三方在变异窗口内写过它,
 * 还原会覆盖对方的改动 —— 那种情况下宁可判红,也不许静默吃掉。
 * @param {string} from 原字面量(单行,按 LF 书写)
 * @param {string} to 替换字面量(单行,按 LF 书写)
 * @returns {{ status: number | null, stdout: string, stderr: string, restored: boolean }}
 */
function mutateAndRun(from, to) {
  const original = readFileSync(checkerPath, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const probe = original.replace(/\r\n/g, "\n");
  if (!probe.includes(from)) {
    throw new Error(`变异定位失败:${checkerPath} 里找不到 ${JSON.stringify(from)}`);
  }
  if (from === to) throw new Error("变异是空操作:结论会是假的");
  // ⚠ **替换必须在归一后的 `probe` 上做,EOL 转回放在其后**:反过来(先把 probe 转回 CRLF
  // 再拿 LF 写就的 `from` 去匹配)在 CRLF 检出下必然匹配不上,变异成为空操作,
  // :117 那道自守随即报「变异未改变文件内容」—— 本地(LF 落盘)绿、CI(Windows runner
  // 的 autocrlf 检出转 CRLF)恒红。本仓已为同类形态在 `.gitattributes` 里定点钉过四组文件,
  // 那是治检出;此处治的是「变异匹配不该对行尾敏感」,两层都要留。
  const replaced = probe.replace(from, to);
  const mutated = eol === "\n" ? replaced : replaced.replace(/\n/g, eol);
  if (mutated === original) throw new Error("变异未改变文件内容:结论会是假的");
  writeFileSync(checkerPath, mutated, "utf8");
  /** @type {{ status: number | null, stdout: string, stderr: string, restored: boolean }} */
  let run;
  try {
    const result = spawnSync(process.execPath, [checkerPath], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    });
    run = { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", restored: false };
  } finally {
    const now = readFileSync(checkerPath, "utf8");
    if (now === mutated) {
      writeFileSync(checkerPath, original, "utf8");
      run.restored = true;
    }
  }
  return run;
}

/** 真实夹具根下某张图的实测摘要(构造「按实测重新登记」的正路修法用)。 */
function realDigest(rel) {
  return createHash("sha256").update(readFileSync(join(FIXTURES_DIR, ...rel.split("/")))).digest("hex");
}

/* ---------- ① 基线档:合成夹具树上跑 CLI ---------- */

/** @type {{name: string, mutate: ((dir: string) => void) | null, expectCode: number, expectImages: string[], expectOutput?: RegExp, expectOutputAbsent?: RegExp}[]} */
const CASES = [
  {
    // 反向锚点:下面每条负向的红都必须来自注入的故障,不是「门禁本来就红」。
    name: "反向锚点:合成夹具树未漂移 → exit 0 且零 [image-digests:fail] 诊断",
    mutate: null,
    expectCode: 0,
    expectImages: [],
    expectOutput: /\[ok\] 图片夹具字节基线判定通过/,
    expectOutputAbsent: /\[image-digests:fail\]/,
  },
  {
    // ★ 迁自 gen-fixtures.selftest.mjs(判定体迁出后由本档接手):改动一张夹具的字节,
    // 门禁判红**并点名那张图**。这一格是本门禁存在的首要理由。
    name: "注入:改一张图片夹具的字节 → exit 非 0 且诊断点名该图片路径(字节漂移)",
    mutate: (dir) => {
      const target = join(dir, "samples", "manual", "images", "logo.png");
      appendFileSync(target, Buffer.from([0]), "utf8");
    },
    expectCode: 1,
    expectImages: ["manual/images/logo.png"],
    expectOutput: /字节漂移/,
  },
  {
    // 迁自 gen-fixtures.selftest.mjs:「新增夹具没登记」这一格 —— 静默放行正是本条要治的病,
    // 故必须判红并点名新文件。
    name: "注入:新增一张未登记的图片夹具 → exit 非 0 且诊断点名该图片路径",
    mutate: (dir) => {
      const target = join(dir, "samples", "manual", "images", "selftest-new.png");
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, Buffer.from([1, 2, 3]), "utf8");
    },
    expectCode: 1,
    expectImages: ["manual/images/selftest-new.png"],
    expectOutput: /未登记字节基线/,
  },
];

/* ---------- ③ 真变异档:退化必须被抓住 ---------- */

/** @type {{name: string, from: string, to: string, expect: RegExp, expectAbsent?: RegExp}[]} */
const MUTATIONS = [
  Object.freeze({
    // 真缺陷形态:有人改了夹具(重新导出/批量截断)而基线没跟上 ⇒ 必须红,且点名那张图。
    name: "变异① 基线某键的 sha256 与磁盘实测不符 ⇒ CLI 判红并点名该图",
    from: `  "manual/images/logo.png": "${realDigest("manual/images/logo.png")}",`,
    to: `  "manual/images/logo.png": "${"0".repeat(64)}",`,
    expect: /manual\/images\/logo\.png: 图片夹具字节漂移/,
  }),
  Object.freeze({
    // 防空门禁那一档在 CLI 上的机械验证:基线被删到下限以下时,判红必须来自「基线塌缩」这一族,
    // 且**先于**逐张审计 —— 否则磁盘上多出来的图会被报成「未登记」,诊断把人引向
    // 「又漏登记了一张图」,而真因是基线表被削掉了大半。
    name: "变异② 基线被削到下限以下 ⇒ CLI 以「基线塌缩」判红(且不报成「未登记」)",
    from: [
      `  "input/img-800x400.png": "${realDigest("input/img-800x400.png")}",`,
      `  "manual/images/chart.png": "${realDigest("manual/images/chart.png")}",`,
      `  "manual/images/logo.png": "${realDigest("manual/images/logo.png")}",`,
    ].join("\n"),
    to: "",
    expect: /基线塌缩/,
    expectAbsent: /未登记字节基线/,
  }),
];

const suite = createCaseSuite();

for (const testCase of CASES) {
  await suite.case(testCase.name, () => {
    /** @type {string | undefined} */
    let root;
    // 造夹具单独一段:它抛异常 = 夹具不可信(buildTree 自己已在抛异常前清掉半棵合成树),
    // 由 case 级 catch 收成「该 case 失败」—— 不中断后续 case,失败面仍全部可见。
    try {
      root = buildTree(testCase.mutate ?? undefined);
    } catch (error) {
      throw new Error(`${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const run = runGate(root, []);
      const problems = [];
      if (run.code !== testCase.expectCode) {
        problems.push(`期望 exit=${String(testCase.expectCode)},实际 exit=${String(run.code)}`);
      }
      // 点名集合必须**逐条相同**:既不许漏点,也不许多点(多点的诊断没有归因价值)。
      const want = [...testCase.expectImages].sort();
      const named = [...run.stderr.matchAll(/^\[image-digests:fail\]\s+(\S+?):/gm)].map((m) => m[1] ?? "");
      if (named.slice().sort().join(",") !== want.join(",")) {
        problems.push(`期望点名的图片集合为 [${want.join(", ")}],实际 [${named.join(", ")}]`);
      }
      if (testCase.expectOutput !== undefined && !testCase.expectOutput.test(run.stdout + run.stderr)) {
        problems.push(`输出不匹配 ${testCase.expectOutput},实际:\n${run.stdout}${run.stderr}`);
      }
      if (testCase.expectOutputAbsent !== undefined && testCase.expectOutputAbsent.test(run.stdout + run.stderr)) {
        problems.push(`输出不该匹配 ${testCase.expectOutputAbsent},实际:\n${run.stdout}${run.stderr}`);
      }
      assert(problems.length === 0, `${testCase.name}:${problems.join("; ")}`);
      console.log(`[ok] image-digests-selftest:${testCase.name}(exit ${String(run.code)})`);
    } finally {
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });
}

/* ---------- ② 判定层档:判定本体与已知不覆盖 ---------- */

await suite.case("空声明合法终态判定层:缺声明判红档、空声明合法终态档、已声明三档各归各档", () => {
  // 这一族与字节判定无关,但**同处一个模块**:它决定那批 `fixtures = null` 声明是否合法。
  // 最隐蔽的退化是「什么都归 null-terminal」—— 空声明这档照常绿,而缺声明的段静默跳过,
  // 产物缺失无人知晓。故三档逐个断言,并对 `fixtures: {}` 单列一条(它必须落 declared 档,
  // 由契约校验去判红)。
  const got = [
    classifyFixturesDeclaration({ run() {} }),
    classifyFixturesDeclaration({ fixtures: null }),
    classifyFixturesDeclaration({ fixtures: { main: "x" } }),
    classifyFixturesDeclaration({ fixtures: {} }),
  ].join(",");
  assert(
    got === "absent,null-terminal,declared,declared",
    `四形态的判定档不对(期望 absent,null-terminal,declared,declared),实际 ${got}`,
  );
});

await suite.case("已知不覆盖登记的机械体现:根下 docs/ 整棵排除、深层 x/docs/ 照常入盘点", () => {
  // 文件头「已知不覆盖 ①」登记的就是这一格。抽取时逐字保留了原判据(`rel === <产物目录名>`),
  // 而 `rel` 带递归前缀 ⇒ 排除只在夹具根的第一层生效。本档把**两侧**都钉住:
  //   ① 根下 `docs/`(生成物目录)整棵跳过 —— 连手写内容一起跳过,这是登记在册的漏看方向;
  //   ② 深层 `x/docs/` **照常入盘点** —— 免得后来者按「basename 语义」推断出一个不存在的
  //      「任意深度 docs/ 双盲区」,并据此改判据(那一改会真的把生成物下的图拉进基线)。
  const root = mkdtempSync(join(tmpdir(), "m2w-image-digests-docs-"));
  try {
    for (const rel of ["docs/input/a.png", "x/docs/b.png", "a/b/c/c.png"]) {
      const target = join(root, "samples", ...rel.split("/"));
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, Buffer.from([7]), "utf8");
    }
    const found = listImageFixtures(join(root, "samples")).map((f) => f.rel);
    assert(
      found.join(",") === "a/b/c/c.png,x/docs/b.png",
      `排除只发生在根下第一层(根下 docs/ 跳过、深层 x/docs/ 入盘点),实际 ${found.join(",")}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await suite.case("两道塌缩下限都高于空树(防空门禁那两档不是摆设)", () => {
  // 扫描面下限:夹具根被搬走 / 根目录拼错 / 扩展名枚举写坏 ⇒ 零扫描面下「全绿」是恒绿形态。
  // (「samples/ 整个不在」是另一条路径:那走扫描失败的响亮判红,不是恒绿。)
  // 基线下限:基线被清空/误删大半而磁盘上的图也被删到同一批时,扫描面下限仍过、审计仍零问题。
  const emptyRoot = mkdtempSync(join(tmpdir(), "m2w-image-digests-empty-"));
  try {
    mkdirSync(join(emptyRoot, "samples"), { recursive: true });
    const result = auditImageTree(join(emptyRoot, "samples"));
    assert(result.found.length === 0, `空夹具根应扫到 0 个图片夹具,实得 ${result.found.length}`);
    assert(
      MIN_IMAGE_FIXTURES > result.found.length,
      `扫描面塌缩下限 ${MIN_IMAGE_FIXTURES} 未高于空树(0)—— 该档被改坏时本门禁会恒绿`,
    );
    assert(
      MIN_BASELINE_ENTRIES > 0 && MIN_BASELINE_ENTRIES <= Object.keys(IMAGE_DIGEST_BASELINE).length,
      `基线塌缩下限 ${MIN_BASELINE_ENTRIES} 不是个「当前基线以下、零以上」的数(当前基线 ${Object.keys(IMAGE_DIGEST_BASELINE).length} 条)`,
    );
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }
});

/* ---------- ③ 真变异档:退化必须被抓住 ---------- */

for (const mutation of MUTATIONS) {
  await suite.case(mutation.name, () => {
    const run = mutateAndRun(mutation.from, mutation.to);
    assert(run.restored, `变异窗口内 ${checkerPath} 被第三方改过,本档拒绝还原(否则会吃掉别人的改动)`);
    assert(run.status === 1, `期望 exit 1,实得 ${String(run.status)};stderr:${run.stderr}`);
    assert(
      run.stderr.includes("[image-digests:fail]"),
      `未见诊断前缀 [image-digests:fail];stderr:\n${run.stderr}`,
    );
    assert(
      mutation.expect.test(run.stderr),
      `判红了但不是预期那一族:期望诊断含 ${mutation.expect},stderr:\n${run.stderr}`,
    );
    if (mutation.expectAbsent !== undefined) {
      assert(
        !mutation.expectAbsent.test(run.stderr),
        `诊断含本不该出现的一族 ${mutation.expectAbsent},stderr:\n${run.stderr}`,
      );
    }
  });
}

await suite.case("变异全部还原后 CLI 复绿(收尾那一格:证明前面每一档都没留下残留)", () => {
  const result = spawnSync(process.execPath, [checkerPath], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  assert(result.status === 0, `还原后仍应 exit 0,实得 ${String(result.status)};stderr:${result.stderr}`);
});

/* ---------- 收尾 ---------- */

const cases = suite.results;
const failures = suite.failures;
if (failures.length > 0) {
  for (const failure of failures) console.error(`[image-digests-selftest:fail] ${failure.name}:${failure.message ?? "(无失败消息)"}`);
  console.error(`[image-digests-selftest:fail] 图片夹具字节基线门禁回归守护失败,共 ${failures.length}/${cases.length} 条`);
  process.exit(1);
}
console.log(`[ok] image-digests-selftest:${cases.length}/${cases.length} 条全绿`);