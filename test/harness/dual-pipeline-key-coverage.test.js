// @ts-check
/**
 * 双管线**键覆盖登记**的两类负向夹具(「键漏写会被抓住」那一格的承接)。
 *
 * ## 这一格原本由谁守、为什么需要本段
 *
 * 「删掉一行的 `covers` 标记」与「给某行塞一个未登记的键」这两个负向,原先**只**由
 * `gates/probe/gate-probes/gates/dual-matrix.mjs` 守(沙盒探针:在工程副本里改矩阵段那一行,
 * 真起 Electron 跑矩阵段,断言段真的判红)。该探针是 P6/S4 的删除对象 ⇒ 探针一删,
 * 「将来有人加了新双管线键却忘了补矩阵行」这件事就没有任何人能抓住它。本段是它的承接。
 *
 * ## 为什么不导出矩阵段的 `assertMatrixShape`(实测过的三条路)
 *
 * 1. **导出它**(段文件加 `export`):矩阵段的判定面是 `assertMatrixShape()`,但它**零入参** ——
 *    它读的是模块级 `MATRIX` 常量。于是负向夹具能造成的唯一故障是「改矩阵段源码」,
 *    而真实工作树不许改 ⇒ 又得回到「工程副本 + 起 Electron 跑整段」,也就是把探针重做一遍。
 *    (另一条形态更直接地被挡下:若负向夹具本身是段,`check-test-layout.mjs` 的 L4 第二格
 *    「段 import 段」当场判红 —— 段是发现与隔离的单位。)
 * 2. **抽成非段模块**:这件事**已经做完了**。键覆盖交叉核对的判定本体
 *    `assertKeyCoverageRegistered` 早就是非段模块 `test/harness/dual-pipeline-registry.js`
 *    的导出函数(T3 步 6 从台账段抽出),矩阵段只是它的一个调用方。本段直接 import 它。
 * 3. **兄弟门禁**(`gates/repo/check-*.mjs`):被断的判定本体不在 `gates/` 里,而在 `test/harness/`;
 *    在门禁侧 import 一个测试树模块会把「测试树自身的一致性」判据挂到 `gates/` 的门禁族上,
 *    与 `check-test-layout.mjs`(已经扫 `test/**` 全部段)的职责边界重叠,且要新增 npm script
 *    + 注册表 `PROBE_CARRIER_SCRIPTS` 登记才挂得上链。段是这一族事实上的归宿。
 *
 * ## 判据本体不动
 *
 * 本段只**消费** `assertKeyCoverageRegistered`,不改它、不复制它(门禁的负向夹具复制判定
 * 逻辑 = 把判定冻结在夹具里)。两类负向各改一份 `coversByRow` 入参,其余照原样。
 *
 * ## 入参是**真数据**,不是捏造的
 *
 * `coversByRow` 从矩阵段**源码文本**里解析出真实的 26 行 `id`/`covers`(不 import 那个段,
 * 理由见上)。解析结果先过两道恒绿防护再进负向:行数必须等于 `MATRIX_ROW_IDS.length`、
 * 行 id 集合必须与之逐字相同 —— 解析口径一旦跟不上段里的写法,这两道**立刻判红**,
 * 而不是安静地返回空表让后面的负向变成恒绿。
 *
 * ## 抓不到什么(照实登记)
 *
 * 1. **接线**:本段证明「判定不是恒真断言」,**不**证明「矩阵段真的把它自己的 26 行喂了进去」。
 *    后者由矩阵段本身正向证明 —— 它在 `assertMatrixShape` 之后打印逐键覆盖行数,那段打印
 *    打不出来就说明形状守护已抛错(顺序即证据)。
 * 2. **完备性**:键集合手工登记。往 core 加了新共有字段而没登记进 `DUAL_PIPELINE_KEYS` ⇒
 *    本段与矩阵段全绿(该边界写在 `dual-pipeline-registry.js` 的头注里,此处不复制)。
 * 3. **覆盖深度 / 断言有效性**:`covers: ["watermark"]` 只表示「该键有可执行断言入口」。
 */
import fs from "node:fs";
import path from "node:path";
import { captureAssertionFailure, createAsserter } from "./assert.js";
import { createCaseSuite } from "./case.js";
import {
  DUAL_PIPELINE_KEYS,
  MATRIX_ROW_IDS,
  assertKeyCoverageRegistered,
  keyCoverageCounts,
} from "./dual-pipeline-registry.js";
import { ROOT } from "./paths.js";
import { normalizeEol } from "./eol.js";

/**
 * 本段测哪一层(ADR-062 L4/L8 声明通道):**harness** ——「本层主体根就是 `test/harness/`
 * 自己」。被测主体是 `test/harness/dual-pipeline-registry.js` 的键覆盖交叉核对判据
 * `assertKeyCoverageRegistered`(与同目录的 `dual-pipeline-decision-ledger` 段同主体、不同主题:
 * 那段断 `assertLedgerShape` 的台账形状,本段断键覆盖的两个方向)。
 */
export const covers = ["test/harness/dual-pipeline-registry.js"];

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头):断言对象是
// 登记数据与其派生判据,不涉及任何 markdown 产物。
export const fixtures = null;

const suite = createCaseSuite();
const { assert, assertEq, assertIncludes } = createAsserter("dual-key-coverage");

/** 被读文本的矩阵段(仓库相对 POSIX 路径):只读,本段不写它、也不 import 它 */
const MATRIX_SEGMENT_REL = "test/core/dual-pipeline-matrix.test.js";

/**
 * 从矩阵段源码里抽出逐行的 `covers`(行 id → 该行声明覆盖的键)。
 *
 * 为什么抽文本而不是 import 段:段是发现与隔离的单位(L4 第二格),段间 import 判红;而
 * import 那个段还会把 `dist/` 产物与 jszip 拖进一个「只断一行登记」的夹具。
 *
 * 匹配的是矩阵行的字段序(`id` → `mode` → `covers` 三行相邻)。这个序是**当前**写法,
 * 不是契约 —— 所以 {@link readMatrixCoversByRow} 的调用方必须拿 `MATRIX_ROW_IDS` 对账,
 * 写法一变就对不上并判红,而不是静默返回半张表。
 * @param {string} text 矩阵段源码(调用方须先归一 EOL,见 {@link readMatrixCoversByRow})
 * @returns {Record<string, string[]>} 行 id → 覆盖的键
 */
function extractCoversByRow(text) {
  /** @type {Record<string, string[]>} */
  const coversByRow = {};
  const rowPattern = /\n\s*id:\s*"([^"]+)",\n\s*mode:\s*"[^"]+",\n\s*covers:\s*\[([^\]]*)\],/g;
  for (const match of text.matchAll(rowPattern)) {
    const id = match[1];
    const raw = match[2] ?? "";
    if (id === undefined) continue;
    coversByRow[id] = [...raw.matchAll(/"([^"]+)"/g)].map((key) => key[1] ?? "");
  }
  return coversByRow;
}

/**
 * 读矩阵段源码并解析出逐行 covers,附两道恒绿防护(见文件头「入参是真数据」)。
 * @returns {Record<string, string[]>} 行 id → 覆盖的键
 */
function readMatrixCoversByRow() {
  // 读入点归一 EOL(不是改匹配式):矩阵段的字段序在检出态是 CRLF 还是 LF 由各端 autocrlf 决定
  // (`.gitattributes` 有意不钉 `test/core/**`),而 {@link extractCoversByRow} 的匹配式里是**裸 `\n`
  // 字面量** —— CRLF 检出下它一条都匹配不上,抽出空表,判据会以「与本次改动无关」的行数红挂掉。
  // 归一只放过纯行尾差异:内容差异一字不动,仍由下面两道恒绿防护与负向本体照常抓住。
  // 归一在**读入侧** ⇒ 本文件未来新增的任何字面量匹配都自动免疫,不必逐处加 `\r?`。
  const text = normalizeEol(fs.readFileSync(path.join(ROOT, ...MATRIX_SEGMENT_REL.split("/")), "utf8"));
  const coversByRow = extractCoversByRow(text);
  // 防护一:行数。解析口径失效(字段序改了 / 匹配式写错)时这里返回半张表甚至空表,
  // 而空表会让下面每条负向都「判红」—— 那正是恒绿防护要拦的假通过。
  assertEq(Object.keys(coversByRow).length, MATRIX_ROW_IDS.length, `${MATRIX_SEGMENT_REL} 解析出的矩阵行数`);
  // 防护二:行 id 集合与登记册逐字相同(不比较顺序,只比较集合)
  assertEq(
    Object.keys(coversByRow).sort().join(","),
    [...MATRIX_ROW_IDS].sort().join(","),
    "解析出的矩阵行 id 集合",
  );
  return coversByRow;
}

/**
 * 只被一行覆盖的键(删掉那一行的 `covers` 就等于让该键零覆盖)。
 *
 * 动态取而不是写死键名:写死的那一格会在有人给该键补第二行覆盖后**静默失效** ——
 * 夹具会从「删掉后零覆盖」变成「删掉后仍有人覆盖」而判红,报在一个与本次改动无关的名下。
 * @param {Record<string, string[]>} coversByRow 行 id → 覆盖的键
 * @returns {{ key: string; row: string }[]} 恰被一行覆盖的键及其那一行
 */
function singlyCoveredKeys(coversByRow) {
  /** @type {Map<string, string[]>} */
  const rowsByKey = new Map();
  for (const [row, keys] of Object.entries(coversByRow)) {
    for (const key of keys) rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
  }
  return [...rowsByKey.entries()]
    .filter(([, rows]) => rows.length === 1)
    .map(([key, rows]) => ({ key, row: rows[0] ?? "" }));
}

/**
 * 取第一个「恰被一行覆盖」的键及其那一行;一个都没有时**抛错**。
 *
 * 为什么自己抛而不走 assert:那不是一条可选断言,而是负向的**前提**(没有这样的键,负向一
 * 就无对象,后面所有断言都会在一个空壳上跑)。`createAsserter` 的 assert 返回 void,
 * 类型收窄不到调用方,故此处显式抛。
 * @param {Record<string, string[]>} coversByRow 行 id → 覆盖的键
 * @returns {{ key: string; row: string }} 该键与覆盖它的那一行
 */
function requireSinglyCoveredKey(coversByRow) {
  const first = singlyCoveredKeys(coversByRow)[0];
  if (first === undefined) {
    throw new Error(
      `dual-key-coverage 断言失败:应至少有一个恰被一行覆盖的双管线键`
      + `(只有这样的键,删掉那一行的 covers 才真的造成零覆盖),实际 0 个`,
    );
  }
  return first;
}

export async function run() {
  await suite.describe("正向锚点:真矩阵数据当前满足键覆盖交叉核对", async () => {
    const coversByRow = readMatrixCoversByRow();
    // 判定本体必须**不抛**。这一格是全部负向的前提:一个「无论什么输入都抛」的退化实现
    // 能让下面两条负向全绿。
    const failure = await captureAssertionFailure(() => {
      assertKeyCoverageRegistered(coversByRow);
    });
    assert(!failure.threw, `真实矩阵的 covers 应满足键覆盖交叉核对,实际抛:${failure.message}`);
    // 逐键覆盖数:每个登记的键都至少有一行(与上面同一事实的人读回显;数字不是断言阈值)
    const perKey = keyCoverageCounts(coversByRow);
    for (const key of DUAL_PIPELINE_KEYS) {
      assert((perKey[key.id] ?? 0) > 0, `双管线键 ${key.id} 应至少被一行覆盖,实际 ${String(perKey[key.id])}`);
    }
    console.log(
      `[ok] dual-key-coverage:真实矩阵 ${Object.keys(coversByRow).length} 行的 covers 满足`
      + `${DUAL_PIPELINE_KEYS.length} 个双管线键的覆盖交叉核对`
      + `(其中恰被一行覆盖的键 ${singlyCoveredKeys(coversByRow).length} 个,供下面的负向取用)`,
    );
  });

  await suite.describe("负向一:删掉一行的 covers 标记 ⇒ 该键零覆盖", async () => {
    const coversByRow = readMatrixCoversByRow();
    // 取一个「恰被一行覆盖」的键:只有这种键,删掉那一行的 covers 才真的造成零覆盖
    const target = requireSinglyCoveredKey(coversByRow);

    // 故障形态一:那一行仍在,`covers` 被改成空数组(探针原先注入的就是这一形态)
    const emptied = { ...coversByRow, [target.row]: [] };
    const failure = await captureAssertionFailure(() => {
      assertKeyCoverageRegistered(emptied);
    });
    assert(failure.threw, `把 ${target.row} 行的 covers 改成 [] 后应判红(键 ${target.key} 零覆盖),实际不抛`);
    assertIncludes(failure.message, "双管线键无任何矩阵行覆盖", "零覆盖的诊断前缀");
    // 点名:诊断必须说出是哪个键零覆盖。「抛了个错」不等于「这个键漏写会被抓住」
    assertIncludes(failure.message, target.key, "零覆盖诊断里被点名的键");

    // 故障形态二:那一行整个从覆盖表里消失(行被删 / covers 字段被整段删掉)
    const removed = { ...coversByRow };
    delete removed[target.row];
    const failureRemoved = await captureAssertionFailure(() => {
      assertKeyCoverageRegistered(removed);
    });
    assert(failureRemoved.threw, `把 ${target.row} 行整个移出覆盖表后应判红,实际不抛`);
    assertIncludes(failureRemoved.message, target.key, "零覆盖诊断里被点名的键(行被移除形态)");

    // 撤销 ⇒ 回到判绿(与「注入 ⇒ 红」成对:只做前者时,恒红实现能让本段全绿)
    const restored = await captureAssertionFailure(() => {
      assertKeyCoverageRegistered(coversByRow);
    });
    assert(!restored.threw, `撤销故障后应回到判绿,实际抛:${restored.message}`);
    console.log(`[ok] dual-key-coverage:负向一 —— 删 ${target.row} 行的 covers ⇒ 键 ${target.key} 零覆盖判红(两种形态),撤销后判绿`);
  });

  await suite.describe("负向二:给某行的 covers 塞一个未登记的键 ⇒ 登记漂移", async () => {
    const coversByRow = readMatrixCoversByRow();
    // 未登记键取一个**当前不在登记册里**的名字(动态取:写死一个名字的话,将来有人把它
    // 登记进 DUAL_PIPELINE_KEYS,本负向就会从「漂移」变成「合法」而恒绿)
    const registered = new Set(DUAL_PIPELINE_KEYS.map((key) => key.id));
    const driftKey = "dualCoverageDriftProbeKey";
    assert(!registered.has(driftKey), `负向二用的键名 ${driftKey} 不得已在登记册里(否则这一格不再是负向)`);
    const row = Object.keys(coversByRow)[0] ?? "";
    assert(row !== "", "矩阵应有至少一行");
    const originalKeys = coversByRow[row] ?? [];
    const drifted = { ...coversByRow, [row]: [...originalKeys, driftKey] };

    const failure = await captureAssertionFailure(() => {
      assertKeyCoverageRegistered(drifted);
    });
    assert(failure.threw, `给 ${row} 行塞未登记键 ${driftKey} 后应判红,实际不抛`);
    assertIncludes(failure.message, "声明覆盖未登记的键", "登记漂移的诊断前缀");
    // 点名:诊断必须说出是哪一行、塞的是哪个键(两个方向都要能归因)
    assertIncludes(failure.message, driftKey, "登记漂移诊断里被点名的新键");
    assertIncludes(failure.message, row, "登记漂移诊断里被点名的矩阵行");

    // 与负向一是**不同的**判红:否则「删 covers」与「塞未登记键」共用一条诊断时,
    // 少实现一个方向也可能全绿
    const firstRow = requireSinglyCoveredKey(coversByRow);
    const other = await captureAssertionFailure(() => {
      assertKeyCoverageRegistered({ ...coversByRow, [firstRow.row]: [] });
    });
    assert(
      other.threw && other.message !== failure.message,
      `两个方向应各自判红且诊断不同(负向二:${failure.message} / 负向一:${other.message})`,
    );

    const restored = await captureAssertionFailure(() => {
      assertKeyCoverageRegistered(coversByRow);
    });
    assert(!restored.threw, `撤销故障后应回到判绿,实际抛:${restored.message}`);
    console.log(`[ok] dual-key-coverage:负向二 —— 给 ${row} 行塞未登记键 ${driftKey} ⇒ 登记漂移判红,撤销后判绿`);
  });

  return { cases: suite.results };
}

export const meta = {
  description: "双管线键覆盖登记的两类负向:删 covers 标记 ⇒ 该键零覆盖 / 塞未登记键 ⇒ 登记漂移",
};