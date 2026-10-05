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
 * (六格行的宽度直接决定该行会不会被列数守卫挡下 —— 挡下的行**既退出全部判定又判红**),
 * 落文件反而更难看出意图。
 * 不复制判据逻辑:夹具只是台账文本,判红/出声的判定完全交给被测函数。
 *
 * **为什么不给判据编号**:本段断言的是「台账内不变量」这一整组性质,断言文案用编号
 * 指代会让后来者误以为是某一条判据的编号,而编号本身随时可能重排。
 */
import assert from "node:assert/strict";
import { checkLedger, checkLedgerShape, checkTableShape } from "../../gates/repo/check-pointers.mjs";
// → 段里若内联字面量,上限一改就会把测试让成失效夹具(本会话此前已因此红过 4 条);
//   取**全仓单点持有**那一份(`shared/`),门禁已不再导出这三个常量。
//   另见上面 `OVER_TITLE` 那条同源纪律的 e2e 段写法。
import { TITLE_LIMIT } from "../../shared/markdown-table.mjs";
import { createCaseSuite } from "../harness/case.js";

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
 * ⚠️ 格数必须跟表头一致 —— 但**理由已经变了**:列数不符的行现在**判红**(原先只出声)。
 * 改这个格数会让整段夹具转红,那是真阳性,不是「夹具失效」。
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
//
// ⚠️ `DATA_ROW` 的格数必须与 `HDR` 一致(各 6 格)。这一档测的是表**块结构**,不测列数;
// 但列数守卫是**读 `docs/REQ.md` 的**,不走这三行常量,故这里改错不会立刻转红 —— 而一旦
// 有人把这三行也接到列数守卫上,不一致就会变成真阳性。留一句注释免得下一个人以为随意。
const HDR = "| 号 | 标题 | 状态 | 为什么停在这 | 什么条件下重看 | 分析在哪 |";
const SEP = "|---|---|---|---|---|---|";
const DATA_ROW = "| REQ-001 | 甲 | 待拍板 | 原因 | 条件 | 无 |";

/**
 * 反引号字符(代码标点),用 `String.fromCharCode(96)` 拼而**不写字面量**。
 *
 * 为什么不写字面量:反引号是本仓的雷 —— 注释里出现反引号三连会让 TS 的 JSDoc 解析器把紧随
 * 其后的 `@param` 吞成代码块**内容**而非标签,该参数类型整个失效(判据见
 * `shared/markdown-table.mjs` 里 `maskFencedLines` 的同条警告)。
 *
 * ⚠️ **也不许用任何别的引号代替**(如双引号):本段要钉的收窄只剥**反引号**与**星号**两种装饰,
 * 换成双引号的话那些夹具在**收窄被撤掉时仍然绿** ⇒ 钉子钉空(实测踩过:三条 case 全照过)。
 * @type {string}
 */
const BT = String.fromCharCode(96);

export async function run() {
  const suite = createCaseSuite();

  // ============ 台账内不变量(checkLedger)============

  await suite.describe("台账内不变量", async () => {
    await suite.case("好台账 ⇒ 0 错(七项都真正判定过)", () => {
      const r = checkLedger(fixture({ max: 3, next: 4, rows: goodRows(3) }));
      assert.deepEqual(r.errors, [], `好台账应 0 错:${JSON.stringify(r.errors)}`);
      assert.equal(r.stats.invariants, 7, "七项判据都应真正判定过");
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
      assert.equal(r.stats.invariants, 6, "域外状态的行退出 R8 ⇒ invariants 少 1(分母是 7 项)");
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
      assert.equal(r.stats.invariants, 7, "域内状态的行照常参与 R8");
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
      assert.equal(r.stats.invariants, 7, "撤回后 R8 仍应真正判定过(不是靠退出判定变绿)");
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
      // 却仍留在「待拍板」节(R2 判绿)。故单列一条把那个形态钉住。
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
      assert.equal(r.stats.invariants, 6, "R8 未判定 ⇒ invariants 少 1(分母是 7 项)");
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

    // R7「墓碑 ⇔ 划掉」已于 2026-10-05 撤销(墓碑行不再要求 `~~` 划线),
    // 原「双向各判一条」的 case 随判据同批撤销 —— 探针与判据同生共死,不留僵尸行。

    // ⚠️ 这一族是**「静默退出全部判定」**那一类:行被列数守卫挡掉后,号唯一 / 状态取值域 /
    // 上限**一条都没判过**,而门禁若只出声就会说「通过」—— 那是把没判的说成判过。
    // **每条都必须有「撤回后复绿」那一步**:只做「构造 ⇒ 判红」分不清「判据在判」与「夹具写坏别的」。

    await suite.case("列数不符(标题里未转义的竖线)⇒ 判红 + 该行仍退出全部判定", () => {
      // 坏行只有 5 格:标题里那个未转义的竖线把行切成了 5 格(表头 6 列)。
      const bad = "| REQ-004 | 改 a | b 的配置 | 未开工 | 2026-09-27 |";
      // ⚠️ **号段声明 max=3 而台账里有一行 REQ-004** —— 这不是写错,是**退出行为的探针**:
      // 若那一行**参与**实算,`max` 就是 4 ≠ 声明的 3 ⇒ R4 会再报一条「号段缺行」。
      // 故「恰好 1 条判红」这条断言**同时**钉住了两件事:判红在(1 条),且退出也在(没有第 2 条)。
      const text = fixture({ max: 3, next: 4, rows: [...goodRows(3), bad] });
      const r = checkLedger(text);
      // 行号**从夹具本身算出来**,不写死(写死过就会在夹具一改时变成假失败,而假失败会让人
      // 去改断言而不是改实现 —— 与上面 R8 那条同一教训)。
      const lineNo = text.split("\n").indexOf(bad) + 1;
      assert.equal(r.stats.badColumn, 1, "错位行必须计入 badColumn");
      assert.equal(r.errors.length, 1, `列数不符只该报一条(第 2 条会是「号段缺行」,即退出失效):${JSON.stringify(r.errors)}`);
      // 诊断四要素:文件:行 / 所在节 / 实际格数 / 期望列数 —— 缺任一条就没法定位。
      assert.match(String(r.errors[0]), new RegExp(`^docs/REQ\\.md:${lineNo} → `), "报错必须带 文件:行");
      assert.match(String(r.errors[0]), /「待拍板」节/, "必须点名所在节");
      assert.match(String(r.errors[0]), /该行 5 格 ≠ 表头 6 列/, "必须同时给出实际格数与期望列数");
      assert.equal(r.stats.max, 3, "错位行不得进数值计算(实算最大号仍是被判过的 3 行里的最大)");
    });

    await suite.case("列数不符的行退出判定 ⇒ 它同时是个重号也不报(判红不得顺手把退出改掉)", () => {
      // 「判红」与「退出」是两件事:判红是**账本完整性**(说得全),退出是**解析安全**(说得准)。
      // 只加判红不保留退出,会让 R2 读错列(标题里的竖线把「状态」格挤走)⇒ R2 假红。
      // 夹具刻意让错位行**号格与上一行相同** ⇒ 它若参与判定就是重号;它退出 ⇒ 不报。
      const r = checkLedger(
        fixture({
          max: 1,
          next: 2,
          rows: [row("REQ-001", "需求一", "待拍板"), "| REQ-001 | 改 a | b 的配置 | 未开工 | 2026-09-27 |"],
        }),
      );
      assert.equal(r.errors.length, 1, `只该有列数错位那一条(重号被退出吞掉):${JSON.stringify(r.errors)}`);
      assert.match(String(r.errors[0]), /列数错位/);
      // ⚠️ **forbid 必须钉「重号那一条的诊断形态」而不是裸词「重号」** —— 裸词会命中
      // 列数错位诊断正文里列举的「重号 / 状态取值域 / 状态⇔所在节」,那是**说明**不是违规。
      assert(
        !/→ 重号:该号已在/.test(r.errors.join("\n")),
        `错位行退出判定 ⇒ 号唯一判不到它:${JSON.stringify(r.errors)}`,
      );
    });

    await suite.case("列数不符撤回:同一行改回 6 格 ⇒ 复绿(证明上两条是本判据判的,不是夹具写坏)", () => {
      const r = checkLedger(
        fixture({ max: 4, next: 5, rows: [...goodRows(3), row("REQ-004", "需求四", "待拍板")] }),
      );
      assert.deepEqual(r.errors, [], `撤回后应复绿:${JSON.stringify(r.errors)}`);
      assert.equal(r.stats.badColumn, 0, "撤回后不得再计错位行");
      assert.equal(r.stats.invariants, 7, "撤回后七项都真正判定过(不是靠退出判定变绿)");
      // 撤回后**这一行真的进了判定**:实算最大号从 3 变成 4,与号段声明一致。
      assert.equal(r.stats.max, 4, "撤回后 REQ-004 进判 ⇒ 实算最大号是 4");
    });

    await suite.case("列数守卫的存活探针:好台账的行数进过守卫,且不自称零覆盖", () => {
      // 守卫恒不命中时 `badColumn` 恒 0,而门禁照样 exit 0 —— **不可见**。故分母取
      // 「进过守卫的行数」(`columnGuarded`):真台账恒 > 0,只有守卫没跑时才为 0 而必须出声。
      const good = checkLedger(fixture({ max: 3, next: 4, rows: goodRows(3) }));
      assert.equal(good.stats.columnGuarded, 3, "三行都该进过守卫");
      assert(
        !good.notes.some((n) => /列数守卫 0 行/.test(n)),
        `好台账不该自称零覆盖:${JSON.stringify(good.notes)}`,
      );
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

  // ============ 台账形态上限档(checkLedgerShape · C1/C2 的列数守卫落点)============
  //
  // ⚠️ **这一段钉的是列数守卫的第二个落点**。守卫在判据本体里有两处:`checkLedger` 那一处
  // 管 R 族(重号 / 状态取值域),本函数这一处管**载体族**(标题列 / 判断依据的字数上限)。
  // 两处是**两次独立解析**(`locateRegistry` 合并行集 vs 本函数逐块走 `tableBlocks`),
  // 分母也分开(`LEDGER_RULES` vs `CARRIER_RULES`)—— 只改一处,另一处仍是**无声的洞**:
  // 本函数里的 `continue` 照样让 `examined` 静默少掉那一行,而「上限对这一行零判」没人说。

  await suite.describe("台账形态上限(列数守卫 · 第二个落点)", async () => {
    await suite.case("列数不符 ⇒ 判红并点名行号、所在节、实际格数与期望列数", () => {
      // 夹具的表头是 6 列(号/标题/状态/为什么停在这/什么条件下重看/分析在哪),坏行 5 格。
      // ⚠️ **标题格刻意超 C1 上限**:错位后那一行**不再量字数**,若守卫被改回静默 `continue`,
      // 这条 finding 会消失 ⇒ 判红消失;而若守卫改成「错位也照量」,读到的列是别的列
      // ⇒ 报出的是**假的**标题列超限。两种漂移这一条都抓得到。
      const bad = `| REQ-001 | ${"长".repeat(TITLE_LIMIT + 1)} | 待拍板 | 无阻塞 | 随时 |`;
      const text = fixture({ max: 1, next: 2, rows: [bad] });
      const r = checkLedgerShape(text);
      const lineNo = text.split("\n").indexOf(bad) + 1;
      assert.equal(r.findings.length, 1, `只该有列数错位那一条:${JSON.stringify(r.findings)}`);
      assert.match(
        String(r.findings[0]),
        new RegExp(`^docs/REQ\\.md:${lineNo} → `),
        `报错必须带 文件:行,实际 ${r.findings[0]}`,
      );
      assert.match(String(r.findings[0]), /「待拍板」节/, "必须点名所在节");
      assert.match(String(r.findings[0]), /该行 5 格 ≠ 表头 6 列/, "必须同时给出实际格数与期望列数");
      // **退出保留**:错位行不进 `examined`(C1/C2 对它零判,这是解析安全的必要代价)。
      assert.equal(r.examined, 0, "错位行不得进字数统计");
    });

    await suite.case("列数不符撤回:同一行改回 6 格 ⇒ 复绿(证明上条是本判据判的,不是夹具写坏)", () => {
      const r = checkLedgerShape(fixture({ max: 1, next: 2, rows: [row("REQ-001", "需求一", "待拍板")] }));
      assert.deepEqual(r.findings, [], `撤回后应复绿:${JSON.stringify(r.findings)}`);
      assert.equal(r.examined, 1, "撤回后这一行真的被量了(不是靠退出判定变绿)");
    });

    await suite.case("好台账 ⇒ 0 错,且守卫的行数分母非 0(存活探针)", () => {
      // `guarded` 是**守卫自己的**分母:恒 0 时无法区分「表里没有行」与「守卫没跑」。
      const r = checkLedgerShape(fixture({ max: 3, next: 4, rows: goodRows(3) }));
      assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
      assert.equal(r.guarded, 3, "三行都该进过守卫");
      assert.equal(r.examined, 3, "三行都该被量过字数");
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

    // ---- C7 的负向锚点:带装饰的**伪分隔行**紧跟表头 ----
    //
    // ⚠️ **这几条是本轮收窄的唯一防线**,钉的是 `shared/markdown-table.mjs` 里
    // `isSeparatorRow` 的**窄**口径(只 trim,不剥反引号/星号)。**下一个人若「顺手统一」把它
    // 改回宽口径**(那份先剥装饰再测,理由是 §7.1「取并集」),
    // 下面两条会立刻红** —— 那正是本轮成因,故必须留。
    //
    // **为什么必须判红**:GFM 只认第二行是**真 delimiter** 才把整块当表格。反引号包住横线的
    // 那一行**不是**合法 delimiter row ⇒ 整块在 GitHub 上**渲染成普通段落、根本不是表格**
    // ⇒ 表形状已破坏。宽口径把它当合法分隔行放过 ⇒ `findings=0`(实测过的**假绿**)。
    //
    // ⚠️ **「197 份真实 md 跑出 0 差异」不能拿来给放宽背书**:那份语料 100% 是正例,
    // 一条带装饰的伪分隔行都没有 ⇒ 0 差异只证明「本仓现有文件判定不变」,对**负空间零证明力**。
    // 负向性质只能用**负向夹具**钉住,就是下面这几条。
    //
    // ⚠️ 伪分隔行里的**反引号用 `BT` 拼出,不写字面量**:反引号是本仓的雷 —— 注释里出现
    // 反引号三连会让 TS 的 JSDoc 解析器把紧随其后的 `@param` 吞成代码块内容
    // (判据见 `shared/markdown-table.mjs` 里 `maskFencedLines` 的同条警告)。
    //
    // ⚠️ **`BT` 必须用 `String.fromCharCode(96)` 拼,不能写 `'"'` 或任何别的引号** ——
    // 宽口径只剥**反引号**与**星号**这两种装饰,双引号包住的 `---` 它照样不剥 ⇒ 那种夹具
    // 在收窄被撤掉时**仍然绿**(实测:撤掉收窄,三条 case 全部照过 ⇒ 钉子钉了个空),
    // 看着「有负向夹具」实则零证明力。这正是本仓已有教训「正例语料的 0 差异对负空间零证明力」
    // 的同一种病,发生在夹具这一层。

    await suite.case("C7 负向:表头下一行是带反引号装饰的伪分隔行 ⇒ 判红(不是分隔行,整块不是表格)", () => {
      const c = BT; // 反引号
      const pseudoSep = `| ${c}---${c} | ${c}---${c} | ${c}---${c} | ${c}---${c} | ${c}---${c} | ${c}---${c} |`;
      const r = checkTableShape(["## 在办", "", HDR, pseudoSep, DATA_ROW]);
      assert.ok(r.findings.length > 0, `伪分隔行必须判红,实得 ${JSON.stringify(r.findings)}`);
      // 判红要落在**形状族**:即「表头下一行不是分隔行」,而不是别的族偶然出声。
      assert.match(String(r.findings[0]), /缺分隔行/);
      assert.match(String(r.findings[0]), /表头\(第 3 行\)下一行/);
    });

    await suite.case("C7 负向:伪分隔行去掉装饰 ⇒ 复绿(证明上条是收窄判的,不是夹具写坏)", () => {
      // 撤回:同样两行,只把装饰去掉。复绿即证明判红来自「带装饰」这一条收窄,
      // 而非表格本身形状坏 —— 否则上条可能是被别的判据偶然抓住的。
      const r = checkTableShape(["## 在办", "", HDR, SEP, DATA_ROW]);
      assert.deepEqual(r.findings, [], `撤回装饰后应复绿:${JSON.stringify(r.findings)}`);
      assert.equal(r.examined, 1, "撤回后仍应判过一个登记表块(不是靠退出判定变绿)");
    });

    await suite.case("C7 负向:带星号装饰的伪分隔行 ⇒ 同样判红(收窄覆盖两种装饰字符)", () => {
      const pseudoSep = "| *---* | *---* | *---* | *---* | *---* | *---* |";
      const r = checkTableShape(["## 在办", "", HDR, pseudoSep, DATA_ROW]);
      assert.ok(r.findings.length > 0, `星号装饰的伪分隔行也必须判红,实得 ${JSON.stringify(r.findings)}`);
      assert.match(String(r.findings[0]), /缺分隔行/);
    });

    // ⚠️ **这一条与上面两条方向不同,钉的是 R 族(不是 C7)**,且它挡的是一个**已经真发生过的回归**。
    //
    // **形态**:伪分隔行不在表头之后,而在**表块中段**(表头+分隔行+数据行+伪分隔行+数据行)。
    // 宽口径下 `locateRegistry` 把它当分隔行跳过 ⇒ 它**不进数据行集** ⇒ R 族「号形态错」
    // 对它**零判且零出声** —— 门禁对一行「`---`」当号的数据行说「通过」。窄口径下它进
    // 数据行集、被判红(实测:宽 errors=0 / 窄 errors=1「`---` → 号形态错」)。
    //
    // **为什么必须单独钉**:上面两条只覆盖「伪分隔行紧跟表头」,那条路径由 C7 兜住;
    // 中段这条路径 **C7 不判**(C7 只判「表头下一行必须是分隔行」与「相邻元素间不许夹空行」),
    // 所以**只有 R 族能兜** —— C7 绿 + R 族也绿 = 该行彻底无人判。
    await suite.case("R 族负向:伪分隔行在表块中段 ⇒ 仍进数据行集被「号形态错」判红", () => {
      const c = BT;
      const pseudoSep = `| ${c}---${c} | ${c}---${c} | ${c}---${c} | ${c}---${c} | ${c}---${c} | ${c}---${c} |`;
      const text = [
        "## 在办", "",
        HDR, SEP,
        DATA_ROW,
        pseudoSep,
        "| REQ-002 | 乙 | 待拍板 | 原因 | 条件 | 无 |",
        "",
      ].join("\n");
      const r = checkLedger(text);
      const hit = r.errors.filter((e) => /号形态错/.test(String(e)));
      assert.equal(hit.length, 1,
        `中段伪分隔行必须进数据行集并被判「号形态错」(宽口径下它被当分隔行跳过 ⇒ 零判零出声),实得 errors=${JSON.stringify(r.errors)}`);
      // 反向自证:它确实**不是**被别的判据偶然抓住的 —— 号形态错这条只对数据行生效。
      assert.match(String(hit[0]), /---/, "诊断正文应点名那行的实际内容(裸横线串)");
    });
  });

  // ============ 分隔行判据档(钉「窄口径的两个方向都别被破坏」)============

  // ⚠️ **这一档钉的是「收窄不能被反向放宽」** —— 即上面 C7 那些条的**另一半**。
  // 「单格带装饰的**正常数据行**」必须**仍参与全部台账判据**:
  // 若有人把 `shared/markdown-table.mjs` 的 `isSeparatorRow` 内部那个逐格全满足(逐格)语义
  // 弱化成「任一格满足」,那么 `| REQ-002 | `---` | … |` 这一行会被**整行**误当成分隔行跳过 ⇒
  // **该行退出全部台账判据且一声不响**(行数照样对得上,其它判据照样绿)。
  // 那是与 C7 那几条**方向相反**的另一种静默:那几条是「坏的当好的放过」,这几种是「好的当坏的豁免」。
  await suite.describe("分隔行判据(窄口径 · 防反向放宽)", async () => {
    await suite.case("单格带装饰的正常数据行 ⇒ 仍参与 R 族判据(超发号被抓到)", () => {
      const c = BT;
      const text = [
        "## 号段", "",
        "| 项 | 值 |", "|---|---|",
        "| 已用最大号 | REQ-001(台账声明) |",
        "| 下一个可用号 | REQ-002 |",
        "", "## 待拍板", "",
        HDR, SEP,
        "| REQ-001 | 正常行 | 待拍板 | 原因 | 条件 | 无 |",
        `| REQ-002 | ${c}---${c} | 待拍板 | 原因 | 条件 | 无 |`,
        "",
      ].join("\n");
      const r = checkLedger(text);
      const hit = r.errors.filter((e) => /超发号/.test(String(e)));
      assert.equal(hit.length, 1, `装饰数据行仍应参与 R 族判定,实得 errors=${JSON.stringify(r.errors)}`);
    });

    await suite.case("单格带装饰的正常数据行 ⇒ 仍参与载体形态判据(判断依据字数被抓到)", () => {
      const c = BT;
      const long = "因".repeat(260); // 越过 WHY_LIMIT,取自全仓单点持有而非内联字面量
      const text = [
        "## 号段", "",
        "| 项 | 值 |", "|---|---|",
        "| 已用最大号 | REQ-001(台账声明) |",
        "| 下一个可用号 | REQ-002 |",
        "", "## 待拍板", "",
        HDR, SEP,
        "| REQ-001 | 正常行 | 待拍板 | 原因 | 条件 | 无 |",
        `| REQ-002 | ${c}---${c} | 待拍板 | ${long} | 条件 | 无 |`,
        "",
      ].join("\n");
      const r = checkLedgerShape(text);
      // 关键:这一行**进过列数守卫**(guarded)且**被量了字数**(examined)——
      // 若它被误当整行分隔行跳过,guarded 会是 1 而不是 2。
      assert.equal(r.guarded, 2, `装饰数据行应进列数守卫,实得 guarded=${r.guarded}`);
      assert.match(String(r.findings[0]), /判断依据 260 字 > 250/);
    });
  });

  return { cases: suite.results };
}