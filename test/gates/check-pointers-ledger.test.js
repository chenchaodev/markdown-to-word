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
 * @param {{ max: number; next: number; rows: string[] }} spec 号段声明与登记表数据行
 * @returns {string}
 */
function fixture({ max, next, rows }) {
  return [
    "## 号段",
    "",
    "| 项 | 值 |",
    "|---|---|",
    `| 已用最大号 | REQ-${pad3(max)}(台账声明) |`,
    `| 下一个可用号 | REQ-${pad3(next)} |`,
    "",
    "## 登记表",
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
    await suite.case("好台账 ⇒ 0 错(七项都真正判定过)", () => {
      const r = checkLedger(fixture({ max: 3, next: 4, rows: goodRows(3) }));
      assert.deepEqual(r.errors, [], `好台账应 0 错:${JSON.stringify(r.errors)}`);
      assert.equal(r.stats.invariants, 7, "七项判据都应真正判定过");
    });

    await suite.case("状态取表外值 ⇒ 判红", () => {
      const r = checkLedger(
        fixture({
          max: 2,
          next: 3,
          rows: [row("REQ-001", "需求一", "待拍板"), row("REQ-002", "需求二", "审核中")],
        }),
      );
      assert.equal(r.errors.length, 1, JSON.stringify(r.errors));
      assert.match(String(r.errors[0]), /状态不在取值域内/);
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
      assert.equal(r.errors.length, 2, JSON.stringify(r.errors));
      assert.match(r.errors.join("\n"), /状态是「已作废」但本行没有/);
      assert.match(r.errors.join("\n"), /本行划掉了/);
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

  // ============ 台账表结构档(checkTableShape)============

  await suite.describe("台账表结构", async () => {
    await suite.case("规范台账表(表头紧邻分隔行、分隔行紧邻数据行)⇒ 0 错", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, SEP, DATA_ROW]);
      assert.equal(r.length, 0, JSON.stringify(r));
    });

    await suite.case("数据行被插到表头与分隔行之间 ⇒ 判红并点名那一行", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, DATA_ROW, SEP, DATA_ROW]);
      assert.equal(r.length, 1, JSON.stringify(r));
      assert.match(String(r[0]), /缺分隔行/);
      assert.match(String(r[0]), /表头\(第 3 行\)下一行/);
    });

    await suite.case("分隔行与首行数据行之间夹空行 ⇒ 判红(表格在空行处断开)", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, SEP, "", DATA_ROW]);
      assert.equal(r.length, 1, JSON.stringify(r));
      assert.match(String(r[0]), /之间夹了 1 个空行/);
    });

    await suite.case("空节(只有表头+分隔行)⇒ 0 错(0 行是合法态,不是破损)", () => {
      const r = checkTableShape(["## 在办", "", HDR, SEP]);
      assert.equal(r.length, 0, JSON.stringify(r));
    });

    await suite.case("非台账表格(表头无「号」/「状态」)⇒ 不判红(免得对其它表格误报)", () => {
      const r = checkTableShape(["| 名称 | 说明 |", "|---|---|", "| 甲 | 乙 |"]);
      assert.equal(r.length, 0, JSON.stringify(r));
    });

    await suite.case("空行夹在表头与分隔行之间 ⇒ 判红(只查「分隔行→数据」那处会漏判)", () => {
      // 回归:初版只比了「分隔行→首行数据」的行号。空行夹在**表头与分隔行**之间时,
      // 块内第二行仍是分隔行 ⇒ 它是分隔行为真 ⇒ 另一处又没空行 ⇒ 整档判绿(实测踩过)。
      const r = checkTableShape(["## 待拍板", "", HDR, "", SEP, DATA_ROW]);
      assert.equal(r.length, 1, JSON.stringify(r));
      assert.match(String(r[0]), /表头\(第 3 行\)与分隔行\(第 5 行\)/);
    });

    await suite.case("两处都夹空行 ⇒ 各报一条,不合并不吞掉", () => {
      const r = checkTableShape(["## 待拍板", "", HDR, "", SEP, "", DATA_ROW]);
      assert.equal(r.length, 2, JSON.stringify(r));
    });
  });

  return { cases: suite.results };
}