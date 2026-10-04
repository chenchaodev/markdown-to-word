// @ts-check
/**
 * 台账判据段:`gates/repo/check-pointers.mjs` 的两个纯函数 —— 台账内不变量(`checkLedger`)
 * 与台账表结构(`checkTableShape`)—— 的单元测试。
 *
 * **为什么这两档值得单测**:判据本体有 1600 行,而「判红的前提是解析成功」这一层最容易被
 * 悄悄改坏 —— 解析一旦退化成「什么都不报」,好台账照样 0 错,**0 错与根本没在判在输出上
 * 不可分辨**。故本段每档都配判红侧的 case:正例只说明「没报错」,负例才说明「真的在判」。
 *
 * **为什么夹具全内联**:两个函数都是纯函数(零 IO),台账文本又必须精确控制到格
 * (六格行的宽度直接决定该行会不会被列数守卫静默排除),落文件反而更难看出意图。
 * 不复制判据逻辑:夹具只是台账文本,判红/出声的判定完全交给被测函数。
 *
 * **为什么不给判据编号**:本段断言的是「台账内不变量」这一整组性质,断言文案用编号
 * 指代会让后来者误以为是某一条判据的编号,而编号本身随时可能重排。
 */
import assert from "node:assert/strict";
import { checkLedger, checkTableShape } from "../../gates/repo/check-pointers.mjs";
import { createCaseSuite } from "../common/case.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/**
 * 号补零到三位(台账号的书写形态要求定宽三位)。
 * @param {number} n 号
 * @returns {string}
 */
const pad3 = (n) => String(n).padStart(3, "0");

/**
 * 台账数据行的**六格**形态,与 `fixture` 的表头逐列对齐(号 / 标题 / 状态 / 为什么停在这 /
 * 什么条件下重看 / 分析在哪)。
 *
 * ⚠️ 格数必须跟表头一致,否则整行会被列数守卫静默排除 —— 那不是「判红」而是「不判定」:
 * 行数变 0 ⇒ 号唯一 / 状态取值域 / 墓碑三条零覆盖,而门禁仍然 exit 0。
 * @param {string} id 号格(墓碑号写作删除线形态)
 * @param {string} title 标题格
 * @param {string} status 状态格
 * @returns {string}
 */
const row = (id, title, status) => `| ${id} | ${title} | ${status} | 无阻塞 | 随时 | 无 |`;

/**
 * 最小台账:只含号段表与登记表两块,够跑全部台账内不变量(纯函数用例不关心台账其余部分)。
 *
 * ⚠️ 登记表那节的节名**必须是真台账用的四个状态节之一**:R8「状态 ⇔ 所在节」的相容表只认
 * `待拍板 / 在办 / 已完成 / 已作废`,节名取不到键 ⇒ 该节所有行退出 R8 ⇒ `invariants` 少 1,
 * 且 `stats.sectionUnknown > 0`(那是有意设计的「零覆盖出声」,不是漏判)。
 * **这里写 `## 登记表` 会让 R8 静默零覆盖** —— 夹具自己就把要守的判据关掉了。
 * @param {{ max: number; next: number; rows: string[], section?: string }} spec 号段声明、登记表数据行与所在节
 * @returns {string}
 */
function fixture({ max, next, rows, section = "待拍板" }) {
  return [
    "## 号段",
    "",
    "| 项 | 值 |",
    "|---|---|",
    `| 已用最大号 | REQ-${pad3(max)}(台账声明) |`,
    `| 下一个可用号 | REQ-${pad3(next)} |`,
    "",
    `## ${section}`,
    "",
    "| 号 | 标题 | 状态 | 为什么停在这 | 什么条件下重看 | 分析在哪 |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/**
 * 造 n 行形态完好、状态合法的数据行。
 * @param {number} n 行数
 * @returns {string[]}
 */
const goodRows = (n) =>
  Array.from({ length: n }, (_, i) => row(`REQ-${pad3(i + 1)}`, `需求 ${i + 1}`, "待拍板"));

// ---- 台账表结构档的固定三行(表头 / 分隔行 / 一条数据行)----
const HDR = "| 号 | 标题 | 状态 | 为什么停在这 | 什么条件下重看 | 分析在哪 |";
const SEP = "|---|---|---|---|---|---|";
const DATA_ROW = "| REQ-001 | 甲 | 待拍板 | 原因 | 条件 | 无 |";

export async function run() {
  const suite = createCaseSuite();

  // ============ 台账内不变量(checkLedger)============

  await suite.describe("台账内不变量", async () => {
    await suite.case("好台账 ⇒ 0 错(八项都真正判定过)", () => {
      const r = checkLedger(fixture({ max: 3, next: 4, rows: goodRows(3) }));
      assert.deepEqual(r.errors, [], `好台账应 0 错:${JSON.stringify(r.errors)}`);
      assert.equal(r.stats.invariants, 8, "八项判据都应真正判定过");
      assert.equal(r.stats.sectionUnknown, 0, "好台账不该有「落在 R8 不认识的节里」的行");
    });

    await suite.case("状态取表外值 ⇒ 只报 R2 那一条,R8 不参与(同根因不报两次)", () => {
      const r = checkLedger(
        fixture({
          max: 2,
          next: 3,
          rows: [row("REQ-001", "需求一", "待拍板"), row("REQ-002", "需求二", "审核中")],
        }),
      );
      assert.equal(r.errors.length, 1, `域外状态只该报一次:${JSON.stringify(r.errors)}`);
      assert.match(String(r.errors[0]), /状态不在取值域内/);
      // R2 的正文**必须自带「所在节也要一起改」** —— R8 在本行不参与,这条信息只有 R2 能给。
      // ⚠️ **不许写成「去 X 节」**:域外时用户还不知道该改成哪个状态,指不出具体的节 ⇒ 误导。
      assert.match(String(r.errors[0]), /同时\*\*改状态列与所在节/);
      assert(!/去.{0,4}节/.test(String(r.errors[0])), `不许预设目标节:${r.errors[0]}`);
    });

    // ============ R8「状态 ⇔ 所在节」的负向锚点 ============
    //
    // ⚠️ 这几条守的是**「正例看着没问题、所以一直没被发现」**那一族:状态词在取值域内(R2 绿),
    // 行的其它一切也正常,唯独状态与所在节不符 —— 两家都判绿,门禁 exit 0。
    // **每条都必须有「撤回后复绿」那一步**:只做「构造 ⇒ 判红」的锚点分不清
    // 「判据在判」与「夹具碰巧写坏了别的什么」。

    await suite.case("R8 跳过:域外状态 + 错节 ⇒ 恰好 1 条诊断,且**不含**「状态与所在节不符」", () => {
      // 这一条钉的是**跳过分支本身**,且刻意比上面那条多一层:上面那条的节是相容的
      // (`待拍板` 节 + 「审核中」),只靠 `length === 1` 就够;这里**两个根因同时成立**
      // (状态域外 **且** 节不相容),正是「两条都报」最容易发生的形态。
      // 显式 forbid:R8 的措辞一个字都不许出现在域外状态的行上。
      const r = checkLedger(
        fixture({
          // ⚠️ **号段格子必须与实际行数一致**:本夹具只有 REQ-001 一行,号段却声明
          // max=2 ⇒ 实算最大号 1 ≠ 声明 2 ⇒ **R4 会多报一条**,把「恰好 1 条」撑成 2。
          //   **这与 R8 重复计数是两种不同的多报,别混为一谈** —— 数条数时既要把
          //   被测之外的行降到零,也要把号段格子对齐到剩下的行。
          max: 1,
          next: 2,
          // ⚠️ **只有一行**:本 case 要数的是「域外那一行只报一次」,夹具里若还有别的行,
          // 它们的诊断会混进 `r.errors` 把计数撑大。**数条数就必须把变量降到只剩被测那一行。**
          rows: [row("REQ-001", "需求一", "审核中")],
          // 状态域外 + 节也不相容:两个根因同时成立,正是最易重复报的形态。
          section: "已完成",
        }),
      );
      assert.equal(r.errors.length, 1, `域外状态只该报一次:${JSON.stringify(r.errors)}`);
      assert.match(r.errors.join("\n"), /状态不在取值域内/);
      assert(!/状态与所在节不符/.test(r.errors.join("\n")), `R8 不该参与域外状态:${JSON.stringify(r.errors)}`);
      // 统计上**看得见**这一行退出了 R8:`done` 不含 R8 ⇒ invariants 少 1。
      assert.equal(r.stats.invariants, 7, "域外状态的行退出 R8 ⇒ invariants 少 1(分母仍是 8)");
    });

    await suite.case("R8 仍生效:域内状态 + 错节 ⇒ 判红(跳过分支不得把 R8 一起关掉)", () => {
      // **跳过分支的反向对照**:上一条让 R8 不参与,这一条必须证明 R8 没被一起关掉。
      // 两条必须成对,否则「跳过」实现成「R8 整条不管了」也会全绿。
      const r = checkLedger(
        fixture({
          max: 2,
          next: 3,
          rows: [row("REQ-001", "需求一", "待拍板"), row("REQ-002", "需求二", "已完成")],
          section: "待拍板",
        }),
      );
      assert.equal(r.errors.length, 1, `域内状态错节必须判红:${JSON.stringify(r.errors)}`);
      assert.match(String(r.errors[0]), /状态与所在节不符/);
      assert(!/状态不在取值域内/.test(String(r.errors[0])), `域内状态不该被 R2 判:${r.errors[0]}`);
      assert.equal(r.stats.invariants, 8, "域内状态的行照常参与 R8");
    });

    // ============ R8「状态 ⇔ 所在节」的负向锚点 ============
    //
    // ⚠️ 这几条守的是**「正例看着没问题、所以一直没被发现」**那一族:状态词在取值域内(R2 绿),
    // 行的其它一切也正常,唯独状态与所在节不符 —— 两家都判绿,门禁 exit 0。
    // **每条都必须有「撤回后复绿」那一步**:只做「构造 ⇒ 判红」的锚点分不清
    // 「判据在判」与「夹具碰巧写坏了别的什么」。

    await suite.case("R8 负向:状态「已完成」却留在「待拍板」节 ⇒ 判红并点名行号与两节允许的状态集合", () => {
      const bad = row("REQ-002", "需求二", "已完成");
      const text = fixture({
        max: 2,
        next: 3,
        rows: [row("REQ-001", "需求一", "待拍板"), bad],
        section: "待拍板",
      });
      const r = checkLedger(text);
      assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
      // 行号**从夹具本身算出来**,不写死 —— 写死过一次(写成了 11,实际 13),
      // 夹具一改就变成**假失败**,而假失败会让人去改断言而不是改实现
      // (与 check-pointers-e2e.test.js 里那条注释同一教训)。
      const lineNo = text.split("\n").indexOf(bad) + 1;
      // 判红正文必须带齐四要素:行号 / 号 / 实际状态 / 实际所在节 / 该节允许的集合。
      assert.match(String(r.errors[0]), new RegExp(`docs/REQ\\.md:${lineNo} → REQ-002 → 状态与所在节不符`));
      assert.match(String(r.errors[0]), /「待拍板」节/);
      assert.match(String(r.errors[0]), /只允许状态 待拍板 \/ 未开工/);
      assert.match(String(r.errors[0]), /实际状态是「已完成」/);
    });

    await suite.case("R8 撤回:同一行改回「在办」并搬进「在办」节 ⇒ 复绿(证明上条是本判据判的,不是夹具写坏)", () => {
      const r = checkLedger(
        fixture({
          max: 2,
          next: 3,
          rows: [row("REQ-001", "需求一", "在办"), row("REQ-002", "需求二", "在办")],
          section: "在办",
        }),
      );
      assert.deepEqual(r.errors, [], `撤回后应复绿:${JSON.stringify(r.errors)}`);
      assert.equal(r.stats.invariants, 8, "撤回后 R8 仍应真正判定过(不是靠退出判定变绿)");
    });

    await suite.case("R8 相容的两支都要绿:「待拍板」节里的「未开工」行不判红", () => {
      const r = checkLedger(
        fixture({
          max: 2,
          next: 3,
          rows: [row("REQ-001", "需求一", "待拍板"), row("REQ-002", "需求二", "未开工")],
          section: "待拍板",
        }),
      );
      assert.deepEqual(r.errors, [], `待拍板节允许「未开工」:${JSON.stringify(r.errors)}`);
    });

    await suite.case("R8 负向:「已作废」墓碑行留在「待拍板」节 ⇒ 判红(墓碑必须落在「已作废」节)", () => {
      // 这条是**真实台账上实测踩到的那一种**:REQ-006 的墓碑行划掉了、状态也写了「已作废」,
      // 却仍留在「待拍板」节(R7 判绿、R2 判绿)。故单列一条把那个形态钉住。
      const tomb = "| ~~REQ-002~~ | ~~需求二~~ | 已作废 | 无阻塞 | 随时 | 无 |";
      const r = checkLedger(
        fixture({ max: 2, next: 3, rows: [row("REQ-001", "需求一", "待拍板"), tomb], section: "待拍板" }),
      );
      assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
      assert.match(String(r.errors[0]), /REQ-002 → 状态与所在节不符/);
    });

    await suite.case("R8 零覆盖出声:节名不在相容表内 ⇒ 不判红,但必须计入 sectionUnknown 并出声", () => {
      // 节名不认识**不能**判红(那是逼人改正确的内容去将就门禁),但**静默当通过**更坏 ——
      // 故必须计入 `sectionUnknown` 并由 notes 说出「零覆盖」。
      const r = checkLedger(
        fixture({
          max: 1,
          next: 2,
          rows: [row("REQ-001", "需求一", "已完成")],
          section: "登记表",
        }),
      );
      assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
      assert.equal(r.stats.sectionUnknown, 1, "节名不认识必须计入 sectionUnknown");
      assert.equal(r.stats.invariants, 7, "R8 未判定 ⇒ invariants 少 1(分母仍是 8)");
      assert.ok(
        r.notes.some((n) => /零覆盖/.test(n) && /所在节/.test(n)),
        `零覆盖必须出声:${JSON.stringify(r.notes)}`,
      );
    });

    await suite.case("重号 ⇒ 判红", () => {
      const r = checkLedger(
        fixture({
          max: 3,
          next: 4,
          rows: [
            row("REQ-001", "a", "待拍板"),
            row("REQ-002", "b", "待拍板"),
            row("REQ-002", "c", "待拍板"),
            row("REQ-003", "d", "待拍板"),
          ],
        }),
      );
      assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
      assert.match(String(r.errors[0]), /重号/);
    });

    await suite.case("丢「已用最大号」格 ⇒ 只出声不判红(解析失败 ≠ 内容写错)", () => {
      const text = fixture({ max: 3, next: 4, rows: goodRows(3) }).replace(
        /^\| 已用最大号 \|.*$/m,
        "",
      );
      const r = checkLedger(text);
      assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
      assert.ok(
        r.notes.some((n) => /零覆盖/.test(n) && /号段/.test(n)),
        JSON.stringify(r.notes),
      );
    });

    await suite.case("丢行致号段不连续 ⇒ 报出缺哪个号", () => {
      const r = checkLedger(
        fixture({
          max: 3,
          next: 4,
          rows: [row("REQ-001", "a", "待拍板"), row("REQ-003", "c", "待拍板")],
        }),
      );
      assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
      assert.match(String(r.errors[0]), /号段不连续:REQ-001 之后缺 REQ-002/);
    });

    await suite.case("号形态错 ⇒ 判红,且该行不进数值计算", () => {
      const r = checkLedger(
        fixture({
          max: 3,
          next: 4,
          rows: [
            row("REQ-001", "a", "待拍板"),
            row("REQ-002", "b", "待拍板"),
            row("REF-002", "c", "待拍板"),
            row("REQ-003", "d", "待拍板"),
          ],
        }),
      );
      assert.deepEqual(
        r.errors.map((e) => /号形态错/.test(e)),
        [true],
        JSON.stringify(r.errors),
      );
      assert.equal(r.stats.max, 3, "形态错的行不得带偏实算最大号");
    });

    await suite.case("墓碑 ⇔ 划掉(双向)⇒ 两头都判红", () => {
      // 正向:状态已作废却没划掉;反向:划掉了但状态不是已作废。墓碑号写作删除线形态,
      // 若号格不剥删除线,两条都会先被号形态错判掉 ⇒ 双向都测不到。
      const r = checkLedger(
        fixture({
          max: 4,
          next: 5,
          rows: [
            row("REQ-001", "a", "待拍板"),
            row("REQ-002", "b", "~~待拍板~~"),
            row("~~REQ-003~~", "c", "已作废"),
            row("REQ-004", "d", "已作废"),
          ],
        }),
      );
      // ⚠️ **断言按 R7 的诊断筛,不按总数**。本夹具的两条「已作废」行落在「待拍板」节,
      // R8(状态 ⇔ 所在节)会**正确地**再报两条 —— 那是真阳性,不是噪声。
      // 断言总数就等于把本 case 焊死在「除 R7 外所有判据都恰好报 0 条」上:
      // 任何一族增减都会把它变成**假失败**,而假失败会让人去改断言而不是改实现。
      // 本 case 的主体是 R7 双向,R8 有自己的 case 钉(以及「好台账 0 错」那道总闸)。
      const r7 = r.errors.filter((e) => /状态是「已作废」但本行没有|本行划掉了/.test(e));
      assert.equal(r7.length, 2, `R7 双向各一条:${JSON.stringify(r.errors)}`);
      assert.match(r7.join("\n"), /状态是「已作废」但本行没有/);
      assert.match(r7.join("\n"), /本行划掉了/);
    });

    await suite.case("列数不符(标题里未转义的竖线)⇒ 整行不参与判定 + 只出声", () => {
      const r = checkLedger(
        fixture({
          max: 3,
          next: 4,
          // 坏行只有 5 格:标题里那个未转义的竖线把行切成了 5 格(表头 6 列)
          rows: [...goodRows(3), "| REQ-004 | 改 a | b 的配置 | 未开工 | 2026-09-27 |"],
        }),
      );
      assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
      assert.equal(r.stats.badColumn, 1);
      assert.ok(r.notes.some((n) => /单元格数 5 ≠ 表头 6/.test(n)), JSON.stringify(r.notes));
    });

    await suite.case("列序颠倒 ⇒ 仍 0 错(列位置按表头名取,不下标)", () => {
      // 行的单元格顺序必须跟着表头走 —— 这里颠倒的是表头,故行的四格也要跟着换位,
      // 否则那不是「列序颠倒」而是「行与表头错位」,号形态判据会照实报出来。
      const text = [
        "## 号段",
        "",
        "| 项 | 值 |",
        "|---|---|",
        "| 已用最大号 | REQ-002(台账声明) |",
        "| 下一个可用号 | REQ-003 |",
        "",
        "## 登记表",
        "",
        "| 状态 | 登记日期 | 号 | 一句话标题 |",
        "|---|---|---|---|",
        "| 待拍板 | 2026-09-27 | REQ-001 | a |",
        "| 已完成 | 2026-09-27 | REQ-002 | b |",
        "",
      ].join("\n");
      const r = checkLedger(text);
      assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
      assert.equal(r.stats.max, 2);
    });

    await suite.case("占位行残留 ⇒ 0 错 + 只出声", () => {
      const r = checkLedger(
        fixture({
          max: 0,
          next: 1,
          rows: [row("REQ-001", "<一句话标题>", "<状态，取值域见规则 4>")],
        }),
      );
      assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
      assert.equal(r.stats.placeholder, 1);
      assert.ok(r.notes.some((n) => /未填的占位行/.test(n)), JSON.stringify(r.notes));
    });

    await suite.case("零行 ⇒ 0 错 + 点名「零判定」", () => {
      const r = checkLedger(fixture({ max: 0, next: 1, rows: [] }));
      assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
      assert.equal(r.stats.invariants, 2, "只有与号段一致的两项判到了(0 == 0 成立)");
      assert.ok(r.notes.some((n) => /0 个可判定数据行/.test(n)), JSON.stringify(r.notes));
    });

    await suite.case("号段与登记表对不上 ⇒ 两个方向措辞不同", () => {
      // 声明 < 实算 ⇒ 超发号(有号在号段登记之前就发出去了)
      const over = checkLedger(
        fixture({
          max: 1,
          next: 2,
          rows: [row("REQ-001", "a", "待拍板"), row("REQ-002", "b", "待拍板")],
        }),
      );
      assert.equal(over.errors.length, 1, JSON.stringify(over.errors));
      assert.match(String(over.errors[0]), /超发号/);
      assert.match(
        String(over.errors[0]),
        /^docs\/REQ\.md:\d+ →/,
        "报错必须带 文件:行",
      );

      // 声明 > 实算 ⇒ 号段缺行(中间的行没登记或被删了)
      const under = checkLedger(fixture({ max: 3, next: 4, rows: [row("REQ-001", "a", "待拍板")] }));
      assert.equal(under.errors.length, 1, JSON.stringify(under.errors));
      assert.match(String(under.errors[0]), /号段缺行/);

      const next = checkLedger(
        fixture({
          max: 2,
          next: 5,
          rows: [row("REQ-001", "a", "待拍板"), row("REQ-002", "b", "待拍板")],
        }),
      );
      assert.equal(next.errors.length, 1, JSON.stringify(next.errors));
      assert.match(String(next.errors[0]), /「下一个可用号」不等于/);
    });
  });

  // ============ 台账表结构档(checkTableShape · C7)============

  // ⚠️ 断言对象是 `{ findings, examined }` 而非裸数组 —— `examined` 是 C7 的**覆盖度分母**
  // (登记表块数),零覆盖要出声。返回裸数组会让「这一条量过几个表块」无处可报。

  await suite.describe("台账表结构", async () => {
    await suite.case("规范台账表(表头紧邻分隔行、分隔行紧邻数据行)⇒ 0 错", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, SEP, DATA_ROW]);
      assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
      assert.equal(r.examined, 1, "恰好判过一个登记表块");
    });

    await suite.case("数据行被插到表头与分隔行之间 ⇒ 判红并点名那一行", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, DATA_ROW, SEP, DATA_ROW]);
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
      assert.match(String(r.findings[0]), /缺分隔行/);
      assert.match(String(r.findings[0]), /表头\(第 3 行\)下一行/);
    });

    await suite.case("分隔行与首行数据行之间夹空行 ⇒ 判红(表格在空行处断开)", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, SEP, "", DATA_ROW]);
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
      assert.match(String(r.findings[0]), /之间夹了 1 行/);
    });

    await suite.case("空节(只有表头+分隔行)⇒ 0 错(0 行是合法态,不是破损)", () => {
      const r = checkTableShape(["## 在办", "", HDR, SEP]);
      assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
      assert.equal(r.examined, 1, "空节也要计入覆盖度:它被判过且判绿");
    });

    await suite.case("非台账表格(表头无「号」/「状态」)⇒ 不判红(免得对其它表格误报)", () => {
      const r = checkTableShape(["| 名称 | 说明 |", "|---|---|", "| 甲 | 乙 |"]);
      assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
      assert.equal(r.examined, 0, "非台账表格不计入 C7 覆盖度(不是「判过没问题」)");
    });

    await suite.case("空行夹在表头与分隔行之间 ⇒ 判红(只查「分隔行→数据」那处会漏判)", () => {
      // 回归:初版只比了「分隔行→首行数据」的行号。空行夹在**表头与分隔行**之间时,
      // 块内第二行仍是分隔行 ⇒ 它是分隔行为真 ⇒ 另一处又没空行 ⇒ 整档判绿(实测踩过)。
      const r = checkTableShape(["## 待拍板", "", HDR, "", SEP, DATA_ROW]);
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
      assert.match(String(r.findings[0]), /表头\(第 3 行\)与分隔行\(第 5 行\)/);
    });

    await suite.case("两处都夹空行 ⇒ 各报一条,不合并不吞掉", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, "", SEP, "", DATA_ROW]);
      assert.equal(r.findings.length, 2, JSON.stringify(r.findings));
    });

    // ---- C7 的负向锚点:相邻数据行之间夹空行 ----
    //
    // ⚠️ **这一条是初版的真漏判**:原实现只比「表头→分隔行」与「分隔行→**首行**数据行」
    // 两处。空行夹在**两个数据行之间**时,`rest[0]` 仍是紧邻分隔行的那一行 ⇒ 前两处都连号
    // ⇒ **整档判绿**,而 Markdown 里那行已经不属于本表(R4 号段 / R6 连号会跟着读错表)。
    //
    // **判据必须作用在原始行序列上**:`rows` 只收数据行,空行早被过滤掉了 ——
    // 在 `rows` 上判「有没有空行」是判一个恒假命题。断言里刻意混入一个**注释行**:
    // `tableBlocks` 对 `<!-- -->` 同样「跳过不终止」,故它留下的行号空洞与空行同形,
    // 判据必须一并抓住(两行都断表)。

    await suite.case("C7 负向:相邻两个数据行之间夹空行 ⇒ 判红并点名落在哪两个元素之间", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, SEP, DATA_ROW, "", DATA_ROW]);
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
      // 判红正文四要素:节名 / 空行所在行号 / 落在哪两个表块元素之间 / 该节的表块。
      assert.match(String(r.findings[0]), /「待拍板」节登记表块内空行/);
      assert.match(String(r.findings[0]), /docs\/REQ\.md:6 →/);
      assert.match(String(r.findings[0]), /第 1 个数据行\(第 5 行\)与第 2 个数据行\(第 7 行\)/);
    });

    await suite.case("C7 撤回:去掉那个空行 ⇒ 复绿(证明上条是本判据判的,不是夹具写坏)", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, SEP, DATA_ROW, DATA_ROW]);
      assert.deepEqual(r.findings, [], `撤回后应复绿:${JSON.stringify(r.findings)}`);
      assert.equal(r.examined, 1, "撤回后仍应判过一个登记表块(不是靠退出判定变绿)");
    });

    await suite.case("C7:数据行之间夹的是 <!-- --> 注释行 ⇒ 同样判红(注释行同样断表)", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, SEP, DATA_ROW, "<!-- 注 -->", DATA_ROW]);
      assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
      assert.match(String(r.findings[0]), /之间夹了 1 行/);
    });

    await suite.case("C7:末行数据行**之后**的空行 ⇒ 不判红(表块正常终止,不是破损)", () => {
      // 反向:只比相邻元素、不看末行之后。那处空行后面通常紧跟 `## ` 小节,
      // 判它红等于逼人删掉正常排版。
      const r = checkTableShape(["## 待拍板", "", HDR, SEP, DATA_ROW, "", "## 在办", "", "尾注"]);
      assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
    });
  });

  return { cases: suite.results };
}