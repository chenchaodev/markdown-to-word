// @ts-check
/**
 * 文档指针门禁(本仓 vendored 版 `gates/repo/check-pointers.mjs`)**端到端组**单测段。
 *
 * 为什么要有这一段:另两段(台账内不变量 / 引用解析与豁免形态)测的是**纯函数**,
 * 而判据本体还有一族性质**只在真门禁跑起来时才成立** —— 台账按状态分节时后面几节
 * 到底判没判、载体形态「已转判红」这一族违反是否真的非零退出、列数守卫判红后是否真的
 * 非零退出、结论行报出的错误条数与逐条打印的判红条数是否一致(说谎就等于「以为被查过」)。
 * 这些性质**没有第二个观察面**:
 * 纯函数测不到(它不看输出),而 `gates/repo/check-docs.selftest.mjs` 的 12 条夹具是
 * **回归守护**(每条只打一个漂移形态),不覆盖「多条同时成立时输出是否仍然自洽」。
 *
 * ---- 为什么夹具是内联的合成仓,不是模板 ----
 * 上游那份测试拷的是配置仓的 `templates/docs-init/` 骨架;本仓没有 `templates/`,
 * 而 vendor 一份模板就多一个会漂的东西(与 `check-docs.selftest.mjs` 同一取舍)。
 * 故每条 case 用 `withRepo()` 现造一棵**最小合成仓**(仓根 README + 台账 + 按需的
 * `docs/adr/` · `docs/evidence/`),内容全部内联构造,然后 `cwd` 指向它跑**仓内真门禁**。
 *
 * ---- 为什么不 vendor 判据 ----
 * 夹具复制一份门禁只会把「规则的演进」冻在夹具里 —— 门禁改了规则夹具还绿,夹具就成了
 * 规则的第二份冻结副本。故这里跑的就是 `gates/repo/check-pointers.mjs` 本身。
 *
 * ---- 三处与上游不同的地方,都是「拆分 / 换仓」造成的,不是改口径 ----
 * 1. **不出现判据编号**:上游那些用例名与断言文案里带 C 组编号,本仓的规划编号扫描门禁
 *    (`check:test-numbering`)禁止编号字面量进入测试树。存活下来的是**性质**
 *    (「标题列上限已生效」「去向对账真的按序号查」),本段按性质命名 case。
 * 2. **单模式**(ADR-054 决定一删掉了配置模式):上游端到端组断言的结论行是
 *    `模式:配置+项目`,本仓恒为 `模式:项目`。
 * 3. **不 vendor 模板**:见上。
 *
 * 依赖方向单向:本段只 import 判据本体的纯函数与测试树自身的机制层。
 */
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCaseSuite } from "../harness/case.js";
import { ROOT } from "../harness/paths.js";
import { withTempResource } from "../harness/temp-resource.js";
import { checkLedger, TITLE_LIMIT, WHY_LIMIT, WHY_LIMIT_DONE } from "../../gates/repo/check-pointers.mjs";

/**
 * **超上限的夹具长度必须跟着判据常量走** —— 写死 21 字 / 150 字时，上限一改这两条 case 就红。
 * 另注：超「已完成」节上限的那段内容必须**超过更严的那档、但不超过其余节的宽限档**，
 * 否则「上限压根没生效」与「上限对所有节生效」两种实现会给出完全相同的输出。
 */
const OVER_TITLE = "长".repeat(TITLE_LIMIT + 1);
const OVER_WHY = "因".repeat(WHY_LIMIT_DONE + 1);

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/** 判据本体路径(仓根取 single 源,不按目录层级自推) */
const GATE_REL = "gates/repo/check-pointers.mjs";
const gatePath = path.join(ROOT, ...GATE_REL.split("/"));

/**
 * 登记表表头(必须同时含「号」与「状态」,否则台账解析零覆盖 —— 那正是要防的形态)。
 * 列序刻意不是「先标题后号」:**列序颠倒是合法写法**,判据按列名取位。
 *
 * ⚠️ **本常量是 4 列,比真台账的 6 列窄** —— 故本段的错位行夹具拆出的是 **5** 格。
 * 断言写的是「实际格数 ≠ 期望列数」这件事本身,不是某个具体数字;真台账那一侧的数字由
 * `check-pointers-ledger.test.js` 的 6 列表头夹具覆盖。**两侧都要有**:只测窄表会漏掉
 * 「按固定下标取列」的写法(窄表下下标恰好对得上),只测宽表则测不到本段这些窄夹具。
 */
const REGISTRY_HEADER = "| 工作项号 | 状态 | 一句话标题 | 为什么停在这 |";
const REGISTRY_RULE = "| --- | --- | --- | --- |";

/**
 * 号段表(首格 `项`、次格 `值`;两行取**前导**号)。少了它,与号段一致的两条判据零覆盖。
 * @param {string} max 已用最大号
 * @param {string} next 下一个可用号
 * @returns {string} 号段表 markdown
 */
function rangeTable(max, next) {
  return [
    "| 项 | 值 |",
    "| --- | --- |",
    `| 已用最大号 | ${max} |`,
    `| 下一个可用号 | ${next} |`,
  ].join("\n");
}

/**
 * 一条登记表数据行。
 * @param {string} id 工作项号
 * @param {string} status 状态
 * @param {string} title 一句话标题
 * @param {string} why 为什么停在这
 * @returns {string} 数据行 markdown
 */
function registryRow(id, status, title, why) {
  return `| ${id} | ${status} | ${title} | ${why} |`;
}

/**
 * 一条**未填的占位行**:号格是合法工作项号,占位记号在其余格。
 *
 * ⚠️ 这个形态正是骨架台账的实际形态 —— 排除条件若只认**号格**的占位记号,这些行会进
 * 数值计算 ⇒ 实算最大号与号段声明对不上 ⇒ 模板自己判红。故这里逐格放占位记号。
 * @param {string} status 该节的状态取值
 * @returns {string} 占位数据行 markdown
 */
function placeholderRow(status) {
  return `| REQ-001 | <一句话标题，≤20 字> | ${status} | <为什么停在这> |`;
}

/**
 * 骨架台账原文形态:**按状态分四节、每节一行未填占位**,号段声明零值占位。
 *
 * 这正是「刚初始化、还没登记第一条需求」时的真实台账形态 —— 它必须是 0 错,
 * 且四行占位都被计入(排除条件靠「任一格是未填占位」而不是靠号格)。
 * @returns {string} `docs/REQ.md` 全文
 */
function skeletonLedger() {
  return [
    "# 需求号台账",
    "",
    "## 号段",
    "",
    rangeTable("REQ-000(零值占位)", "REQ-001"),
    "",
    ...["待拍板", "在办", "已完成", "已作废"].flatMap((status) => [
      `## ${status}`,
      "",
      REGISTRY_HEADER,
      REGISTRY_RULE,
      placeholderRow(status),
      "",
    ]),
  ].join("\n");
}

/**
 * ADR 夹具:`## 背景` 存在且非空(否则背景判据判红)。正文不含任何 `.md` 指针。
 * @param {string} num 号
 * @param {string} slug 短标题
 * @param {string} background 背景正文
 * @returns {string} ADR 正文
 */
function adrFile(num, slug, background) {
  return [
    `# ADR-${num} · ${slug}`,
    "",
    "## 背景",
    "",
    background,
    "",
    "## 决定",
    "",
    "写最小可判的那一份。",
    "",
  ].join("\n");
}

/**
 * evidence 夹具:头部第一处非空非标题行带「结论去向」。
 * @param {string} dest 结论去向取值(刻意**不加反引号**,免得被指针档当成活指针)
 * @returns {string} 快照正文
 */
function evidenceFile(dest) {
  return [`> 结论去向：${dest}`, "", "# 合成取证", "", "这是合成夹具的取证快照。", ""].join("\n");
}

/** 根 README(在扫描面内:仓根 `*.md` 与 `docs/` 一起扫)。刻意不含指针。 */
const ROOT_README = [
  "# 合成仓",
  "",
  "这是文档指针门禁端到端段现造的合成项目仓,内容全部内联构造。",
  "",
].join("\n");

/**
 * 写一棵合成项目仓并在其上跑**仓内真门禁**。
 *
 * **cwd 指向合成仓根** —— 本体的扫描根恒等于 `process.cwd()`,所以不需要(也不该有)
 * `--root` 参数:加了开关就等于给判据留逃生阀。沙盒生命周期完全由 `withTempResource` 管
 * (建 → 判定 → 清理,抛错也清),故本函数**不含任何 finally**。
 * @param {Record<string, string>} files 仓内相对路径 → 文本
 * @param {(out: string, code: number | null) => void} inspect 拿到合并输出后的断言体
 * @returns {Promise<unknown>} inspect 的返回值透传
 */
async function withRepo(files, inspect) {
  return withTempResource({ prefix: "m2w-ptr-e2e-", label: "check-pointers 端到端沙盒" }, (resource) => {
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.join(resource.path, ...rel.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text, "utf8");
    }
    // 验收入口跑在 Electron 里(`process.execPath` 是 electron.exe),那个环境变量让它按
    // node 解释执行 —— 与 dist-manifest-gate 段同一写法,不另创第二种。
    const result = spawnSync(process.execPath, [gatePath], {
      cwd: resource.path,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    return inspect(`${result.stdout}${result.stderr}`, result.status);
  });
}

/**
 * 判红行 = 输出里**顶格**(未被 `  · ` 前缀收进自报区)且含 ` → ` 的行。
 *
 * 判据本体逐条打印的诊断正文全部顶格(格式恒为 `文件:行 → 目标 → 原因`),而所有提示、
 * 覆盖度自报与结论行都以 `  · ` 或固定中文前缀起头且不含 ` → `。故这条筛选等值于
 * 「逐条打印的判红条数」—— 它是「结论行不许说谎」那条不变量的左侧。
 * @param {string} output 门禁合并输出
 * @returns {string[]} 判红行
 */
function verdictLines(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.startsWith("  · ") && line.includes(" → "));
}

/**
 * 取一条正则的第 1 个捕获组;取不到即抛(诊断里带上原文,免得只看到「null」)。
 * @param {string} output 门禁合并输出
 * @param {RegExp} re 带一个捕获组的正则
 * @param {string} what 断言项名
 * @returns {string} 捕获组
 */
function capture(output, re, what) {
  const m = re.exec(output);
  assert(m !== null && m[1] !== undefined, `${what}:输出里匹配不到 ${re}\n--- 输出 ---\n${output}`);
  return m[1];
}

export async function run() {
  const suite = createCaseSuite();

  // ============ 骨架台账(模板原文形态)============

  await suite.describe("骨架台账(按状态分四节的未填形态)", async (s) => {
    await s.case("骨架台账原样 ⇒ 判据本体的台账内不变量 0 错,占位行不进数值计算", () => {
      const text = skeletonLedger();
      const r = checkLedger(text);
      assert.deepEqual(r.errors, [], `骨架台账应 0 错:${JSON.stringify(r.errors)}`);
      assert.equal(r.stats.rows, 0, "占位行必须被排除,不进数值计算(否则实算最大号与号段声明对不上)");
      assert.equal(r.stats.placeholder, 4, "四节各一行占位,跨节合并后四行都要被计入");
      // 自报跨节合并:不报的话「只判第一节」这个漂移在输出上完全不可见。
      assert(r.notes.some((n) => /跨节合并判定/.test(n)), `必须自报已跨节合并判定:${JSON.stringify(r.notes)}`);
      assert(r.notes.some((n) => /未填的占位行/.test(n)), `未填的占位行须出声:${JSON.stringify(r.notes)}`);
    });

    await s.case("骨架仓(无 ADR / 无快照)⇒ exit 0,载体形态的逐条零覆盖必须出声并汇进结论行", async () => {
      await withRepo({ "README.md": ROOT_README, "docs/REQ.md": skeletonLedger() }, (out, code) => {
        assert.equal(code, 0, `零覆盖不是违规,不得判红:\n${out}`);
        assert(/项目模式通过/.test(out), `好骨架仓应判绿:\n${out}`);
        // 「转判红」不得外溢到零覆盖:那等于用门禁阻塞「刚建台账 / 建载体」这件小事。
        assert(/载体盲区提示/.test(out), `零覆盖提示有自己的行,不混进错误流:\n${out}`);
        assert(/adr 背景判据零覆盖/.test(out), `必须点名背景判据零覆盖:\n${out}`);
        assert(/结论去向判据零覆盖/.test(out), `必须点名结论去向判据零覆盖:\n${out}`);
        assert(/门禁结论:.*覆盖:不全/.test(out), `零覆盖须汇进结论行的 gaps:\n${out}`);
        // ⚠️ **「载体形态**整族**零覆盖」这条断言已从本夹具摘走**(挪到下面「整族零覆盖」那个夹具)。
        // 原因:**本夹具造不出整族零覆盖** —— 骨架台账有四节登记表块,而 C7(表块结构)
        // 在「表头 + 分隔行 + 占位行」的块上 `examined` **确实 +1**(「表头下一行是不是分隔行」
        // C7 真的查了),故整族 `examined` 非 0,「整族零覆盖」这句话在这里**本来就不成立**。
        // 印它反而是**低报**(说没查,而实际查过);不印是对的。
        // 「整族确实一点没查时必须响亮」这个保证改由下面那个夹具守 —— 保证没丢,只是换了落点。
      });
    });

    await s.case("整族零覆盖(仓里完全没有登记表块 / 无 ADR / 无快照)⇒ 仍 exit 0,但必须响亮自报", async () => {
      // **「整族零覆盖须自报」这条保证的新落点。** 本夹具**刻意不含任何登记表块**
      // (台账只有号段表),也没有 ADR 与快照 ⇒ C1/C2/C4/C5/C6/C7 六条的 `examined` **全为 0**。
      // 此时「载体形态整族零覆盖」才成立,断言也才断得住 —— 断在骨架夹具上是断不住的。
      //
      // ⚠️⚠️ **本夹具靠一处巧合成立,改号段表头会静默破掉它**:登记表块的识别条件是
      // 「表头**同时**含「号」与「状态」」,而这里的号段表头是 `项`/`值` —— 经
      // `normalizeHeaderCell` 剥掉空白/粗体/反引号/冒号后**恰好不含「号」字**,故不被误认成登记表块。
      // **若有人把号段表头改成含「号」的字(例如「项」→「编号」以外的任何带「号」的写法)**
      // ⇒ C7 的 `examined` 立刻变成非 0 ⇒ 整族零覆盖**不再成立** ⇒ 本 case 会因
      // `!载体形态.*零覆盖` 而红,而那条红**看起来像门禁坏了,其实是被测夹具失效了**。
      // 诊断时先确认这一处(号段表头到底含不含「号」),再怀疑判据。
      //
      // 退出码必须仍为 **0**:零覆盖是「没查」不是「违规」,判红等于用门禁阻塞
      // 「还没建这个载体」这件小事(与另三条零覆盖「不判红」同一处置)。
      const noRegistry = [
        "# 需求号台账",
        "",
        "## 号段",
        "",
        rangeTable("REQ-000(零值占位)", "REQ-001"),
        "",
      ].join("\n");
      await withRepo({ "README.md": ROOT_README, "docs/REQ.md": noRegistry }, (out, code) => {
        assert.equal(code, 0, `整族零覆盖不是违规,不得判红:\n${out}`);
        assert(/载体形态.*零覆盖/.test(out), `载体形态整族零覆盖须自报:\n${out}`);
        assert(/门禁结论:.*覆盖:不全/.test(out), `整族零覆盖须汇进结论行的 gaps:\n${out}`);
      });
    });

    await s.case("有登记表(哪怕 0 数据行)⇒ 载体形态必须报「量过 N 处」,且 N 非 0", async () => {
      // **钉住 C7 的新行为**:登记表块哪怕只有「表头 + 分隔行」(0 数据行、空节),
      // C7 的 `examined` 也 **+1** —— 它查了「表头下一行是不是分隔行」,说它零覆盖是低报。
      // 这条把「C7 在骨架上算量过」从**偶然**变成**被钉住的行为**。
      // 断言写成「量过**非 0** 处」而不是钉死具体数字:`量过` 是覆盖度计数,
      // 钉死数字会在别的判据增减时变成**假失败**,而假失败会让人去改断言而不是改实现。
      const emptySection = [
        "# 需求号台账",
        "",
        "## 在办",
        "",
        REGISTRY_HEADER,
        REGISTRY_RULE,
        "",
        "## 号段",
        "",
        rangeTable("REQ-000(零值占位)", "REQ-001"),
        "",
      ].join("\n");
      await withRepo({ "README.md": ROOT_README, "docs/REQ.md": emptySection }, (out, code) => {
        assert.equal(code, 0, `空节是合法态,不得判红:\n${out}`);
        assert(/载体形态.*量过 [1-9]\d* 处/.test(out), `有登记表块就必须报出量过非 0 处:\n${out}`);
        assert(!/载体形态.*零覆盖/.test(out), `整族量过了就不该再自称整族零覆盖:\n${out}`);
      });
    });
  });

  // ============ 端到端(好台账 / 坏台账 / 跨节)============

  await suite.describe("端到端(好台账 / 坏台账 / 跨节)", async (s) => {
    await s.case("标题列里的文件名不是指针(标题列是自由文本)⇒ 绿", async () => {
      // 「好台账判绿」本身由 check-docs.selftest.mjs 的好台账夹具守;本条只加这一档 ——
      // 登记表表体行的文件名若被当成活指针,报错会指到一个用户根本不该建的文件。
      await withRepo(
        {
          "README.md": ROOT_README,
          "docs/REQ.md": [
            "# 台账",
            "",
            "## 在办",
            "",
            REGISTRY_HEADER,
            REGISTRY_RULE,
            registryRow("REQ-001", "在办", "改 `ADR-999.md` 配置", "合成夹具,无阻塞"),
            "",
            "## 号段",
            "",
            rangeTable("REQ-001", "REQ-002"),
            "",
          ].join("\n"),
        },
        (out, code) => {
          assert.equal(code, 0, `标题列里的文件名不该判红:\n${out}`);
          assert(!/目标文件不存在/.test(out), `标题列被当成了指针:\n${out}`);
        },
      );
    });

    await s.case("坏台账 ⇒ 结论行报出的条数与逐条打印的判红条数一致(不许说谎)", async () => {
      const ledger = [
        "# 台账",
        "",
        "## 在办",
        "",
        REGISTRY_HEADER,
        REGISTRY_RULE,
        registryRow("REQ-001", "在办", "第一条", "无阻塞"),
        registryRow("REQ-001", "在办", "换个写法重复登记", "无阻塞"),
        registryRow("REQ-002", "在办", OVER_TITLE, "无阻塞"),
        "",
        "## 号段",
        "",
        rangeTable("REQ-002", "REQ-003"),
        "",
      ].join("\n");
      await withRepo(
        {
          "README.md": ROOT_README,
          "docs/REQ.md": ledger,
          "docs/evidence/20260101-000000-缺头快照.md": "# 缺头快照\n\n这一份快照的头部刻意没有「结论去向」行。\n",
        },
        (out, code) => {
          assert.equal(code, 1, `坏台账必须非零退出:\n${out}`);
          for (const re of [/重号/, new RegExp(`标题列 ${TITLE_LIMIT + 1} 字 > ${TITLE_LIMIT}`), /头部没有「结论去向」行/]) {
            assert(re.test(out), `诊断未出现 ${re}:\n${out}`);
          }
          // 三处计数必须一致:退出码非零、结论行的失败条数、逐条打印的判红行数。
          // 任一处对不上,「0 错误 / 失败(N)」就掺了没算进去的那部分 —— 那是说谎。
          const printed = verdictLines(out).length;
          const inSummary = Number(capture(out, /项目模式失败:(\d+) 错误/, "结论行的错误条数"));
          const inConclusion = Number(
            capture(out, /门禁结论:已判定 \| 失败\((\d+)\) \| 模式:项目/, "门禁结论行的失败条数"),
          );
          assert(
            printed === inSummary && inSummary === inConclusion,
            `三处计数必须一致:逐条打印 ${printed} 条 / 结论行 ${inSummary} / 门禁结论行 ${inConclusion}\n--- 输出 ---\n${out}`,
          );
          assert(printed === 3, `本夹具应恰有 3 条判红(重号 + 标题列超上限 + 缺结论去向),实得 ${printed}\n${out}`);
          // 逐条诊断必须可定位:带 文件:行 才指得到要改的地方。
          for (const line of verdictLines(out)) {
            assert(/^docs\/\S+\.md:\d+ →|^docs\/\S+\.md →/.test(line), `判红行须带文件(行)定位:${line}`);
          }
        },
      );
    });

    await s.case("非法状态放在后面的节 ⇒ 仍判红,且自报已跨节合并", async () => {
      await withRepo(
        {
          "README.md": ROOT_README,
          "docs/REQ.md": [
            "# 台账",
            "",
            "## 待拍板",
            "",
            REGISTRY_HEADER,
            REGISTRY_RULE,
            registryRow("REQ-001", "待拍板", "第一节的合法条目", "无阻塞"),
            "",
            "## 已完成",
            "",
            REGISTRY_HEADER,
            REGISTRY_RULE,
            registryRow("REQ-002", "审核中", "后一节的状态表外值", "无阻塞"),
            "",
            "## 号段",
            "",
            rangeTable("REQ-002", "REQ-003"),
            "",
          ].join("\n"),
        },
        (out, code) => {
          assert.equal(code, 1, `后一节的非法状态必须判红:\n${out}`);
          assert(/状态不在取值域内/.test(out), `必须报状态取值域:\n${out}`);
          // 断言**写死当前判据数**(R7 撤销后为 7)。这不是「恒真」隐患:分母跟着
          // `LEDGER_RULES.length` 走,而这里只写死**期望值** ⇒ 判据增删时输出会变成 `N±1/N±1`
          // 与本断言不符 ⇒ **判红**。那正是想要的:增删判据必须在这里留一次可见改动,
          // 而不是让两侧同源收缩成恒真。
          assert(/判据判定 7\/7/.test(out), `两节的数据行都要进判定:\n${out}`);
          assert(/跨节合并判定/.test(out), `须自报已跨节合并:\n${out}`);
        },
      );
    });
  });

  // ============ 载体形态判据(转判红那一族)============

  await suite.describe("载体形态判据(上限 / 背景 / 去向)", async (s) => {
    await s.case("超上限标题 + 缺结论去向 ⇒ 非零退出,且提示是「已生效」而不是一句计划", async () => {
      const ledger = [
        "# 台账",
        "",
        "## 在办",
        "",
        REGISTRY_HEADER,
        REGISTRY_RULE,
        registryRow("REQ-001", "在办", OVER_TITLE, "无阻塞"),
        "",
        "## 号段",
        "",
        rangeTable("REQ-001", "REQ-002"),
        "",
      ].join("\n");
      await withRepo(
        {
          "README.md": ROOT_README,
          "docs/REQ.md": ledger,
          "docs/evidence/20260101-000000-缺头快照.md": "# 缺头快照\n\n这一份快照的头部刻意没有「结论去向」行。\n",
        },
        (out, code) => {
          assert.equal(code, 1, `违反必须非零退出(否则「转判红」只是改了个提示文字):\n${out}`);
          // 「已生效」的措辞,不是一句已经完成的计划 —— 否则后来者读输出会以为还没开始管。
          assert(new RegExp(`标题列 ${TITLE_LIMIT + 1} 字 > ${TITLE_LIMIT}\\(上限 ${TITLE_LIMIT} 字已生效\\)`).test(out), `标题列上限须以已生效措辞报出:\n${out}`);
          assert(/三选一,已生效/.test(out), `结论去向取值域须以已生效措辞报出:\n${out}`);
          assert(!/只出声/.test(out), `转判红后不许再自称只出声:\n${out}`);
          assert(!/转判红条件/.test(out), `提示里不该留着已完成的计划:\n${out}`);
        },
      );
    });

    await s.case("结论去向的带序号形态被接受,且去向对账真的按序号查载体", async () => {
      await withRepo(
        {
          "README.md": ROOT_README,
          "docs/REQ.md": [
            "# 台账",
            "",
            "## 在办",
            "",
            REGISTRY_HEADER,
            REGISTRY_RULE,
            registryRow("REQ-001", "在办", "合成夹具的唯一一条", "无阻塞"),
            "",
            "## 号段",
            "",
            rangeTable("REQ-001", "REQ-002"),
            "",
          ].join("\n"),
          "docs/adr/ADR-020-某条真实存在的决策.md": adrFile("020", "某条真实存在的决策", "合成夹具需要一个非空背景。"),
          // 头部用**裸形态**;另一份用下游实际在写的**加粗形态** —— 两种都必须解析得到,
          // 解析不到会被报成「头部没有结论去向行」,那是最坏的失败形态(逼人删掉正确的头部)。
          "docs/evidence/20260101-000000-指向存在.md": evidenceFile("升 adr/ADR-020"),
          "docs/evidence/20260101-000001-指向缺失.md": "> **结论去向**：升 adr/ADR-777\n\n# 合成取证\n\n指向一份并不存在的决策。\n",
        },
        (out, code) => {
          assert.equal(code, 1, `去向对账违反必须非零退出:\n${out}`);
          assert(!/头部没有「结论去向」行/.test(out), `两种标签形态都必须解析得到:\n${out}`);
          assert(!/不在取值域内/.test(out), `带序号形态不该被判出取值域:\n${out}`);
          assert(!/指向存在\.md.*没有序号 020 的 ADR/.test(out), `指向存在的决策不该出声:\n${out}`);
          assert(
            /指向缺失\.md.*没有序号 777 的 ADR/.test(out),
            `去向对账必须按序号真的查载体(这条分支可达,不是死代码):\n${out}`,
          );
        },
      );
    });

    await s.case("脚本生成的索引豁免,但同目录的真快照仍受管(豁免不得扩大成整目录)", async () => {
      await withRepo(
        {
          "README.md": ROOT_README,
          "docs/REQ.md": [
            "# 台账",
            "",
            "## 在办",
            "",
            REGISTRY_HEADER,
            REGISTRY_RULE,
            registryRow("REQ-001", "在办", "合成夹具的唯一一条", "无阻塞"),
            "",
            "## 号段",
            "",
            rangeTable("REQ-001", "REQ-002"),
            "",
          ].join("\n"),
          // 索引是**脚本生成**的(头部自述不手工登记),与目录说明书同类,一并豁免 ——
          // 否则要么逼人手工编辑生成物,要么得让生成器 emit 一条对它毫无意义的去向。
          "docs/evidence/INDEX.md": "# evidence/ 索引\n\n> 本表由脚本生成,不手工登记\n",
          // 同目录再放一份**缺头**的真快照:豁免若被误写成「整目录」,它就会漏判。
          // (不能用上面那份合法快照来证明 —— 取值判据只对**问题**出声,合法的文件根本不出现。)
          "docs/evidence/20260101-000002-缺头快照.md": "# 缺头快照\n\n这一份快照的头部刻意没有「结论去向」行。\n",
        },
        (out, code) => {
          assert.equal(code, 1, `同目录真快照缺头必须判红:\n${out}`);
          assert(!/INDEX\.md.*头部没有「结论去向」行/.test(out), `生成的索引不该被判缺项:\n${out}`);
          assert(/20260101-000002-缺头快照\.md.*头部没有「结论去向」行/.test(out), `真快照仍须受管:\n${out}`);
        },
      );
    });

    await s.case("「已完成」节的更严上限真的生效,同样长度的内容在别的节合法", async () => {
      // 长度取「已完成」档上限 +1:超更严那档、未超其余节的宽限档 ⇒ **两节各放一条**,
      // 只该命中已完成那一条。只放一条的话,「上限压根没生效」与「上限对所有节生效」
      // 这两种实现会给出**完全相同**的输出 —— 必须有对照才区分得开。
      const long = OVER_WHY;
      const doneRow = registryRow("REQ-003", "已完成", "已完成的一条", long);
      const todoRow = registryRow("REQ-004", "待拍板", "待拍板的一条", long);
      const body = [
        "# 台账",
        "",
        "## 待拍板",
        "",
        REGISTRY_HEADER,
        REGISTRY_RULE,
        registryRow("REQ-001", "待拍板", "短依据甲", "无阻塞"),
        registryRow("REQ-002", "待拍板", "短依据乙", "无阻塞"),
        todoRow,
        "",
        "## 已完成",
        "",
        REGISTRY_HEADER,
        REGISTRY_RULE,
        doneRow,
        "",
        "## 号段",
        "",
        rangeTable("REQ-004", "REQ-005"),
        "",
      ];
      await withRepo({ "README.md": ROOT_README, "docs/REQ.md": body.join("\n") }, (out, code) => {
        assert.equal(code, 1, `已完成节的超限必须判红:\n${out}`);
        const hits = verdictLines(out).filter((line) => new RegExp(`判断依据 ${OVER_WHY.length} 字 >`).test(line));
        assert.equal(hits.length, 1, `只该命中已完成节那一条,实得 ${hits.length} 条\n${out}`);
        // 命中必须是按「已完成」那一档判的,不是其余节的宽限上限。
        assert(new RegExp(`判断依据 ${OVER_WHY.length} 字 > ${WHY_LIMIT_DONE}`).test(hits[0] ?? ""), `必须是按已完成节那一档判的:${hits[0] ?? "无"}`);
        assert(!new RegExp(`判断依据 ${OVER_WHY.length} 字 > ${WHY_LIMIT}\\b`).test(out), `其余节的同长度内容合法,不该按宽限上限命中:\n${out}`);
        // 行号从夹具本身算出来,不写死 —— 写死过一次,夹具一改就变成**假失败**,
        // 而假失败会让人去改断言而不是改实现,正好掩盖真问题。
        // 真正要证明的是**区分**:两节各有一条同样长度,只有按已完成判的那条该命中,
        // 而已完成节排在待拍板节之后 ⇒ 命中行号必须更大。
        const todoLine = body.indexOf(todoRow) + 1;
        const hitLine = Number(/docs\/REQ\.md:(\d+)/.exec(hits[0] ?? "")?.[1]);
        assert(
          hitLine > todoLine,
          `命中的应是已完成节那行(在第 ${todoLine} 行之后),实得 ${hitLine} —— 命中的却是待拍板那行\n${out}`,
        );
        // 整份台账只剩这一条判红 —— 其余判据(号唯一 / 号段一致 / 状态取值域)都真的判过且通过。
        assert.equal(verdictLines(out).length, 1, `只该有这一条判红\n${out}`);
      });
    });

    await s.case("占位符判据:行内代码里的泛型不算未填,裸占位记号仍算", async () => {
      // 泛型参数在字面上与占位记号完全一样。把它判成「未填」是**假红里最坏的一种**:
      // 不是漏报,而是逼人把那段正确的技术内容删掉才能过门禁。
      await withRepo(
        {
          "README.md": ROOT_README,
          "docs/REQ.md": [
            "# 台账",
            "",
            "## 在办",
            "",
            REGISTRY_HEADER,
            REGISTRY_RULE,
            registryRow("REQ-001", "在办", "合成夹具的唯一一条", "无阻塞"),
            "",
            "## 号段",
            "",
            rangeTable("REQ-001", "REQ-002"),
            "",
          ].join("\n"),
          "docs/adr/ADR-030-含泛型的背景.md": adrFile(
            "030",
            "含泛型的背景",
            "契约写成了 `{ cleanup: Pick<Settings, \"tidy\"> }`,与 core 不一致。",
          ),
          "docs/adr/ADR-031-真占位的背景.md": adrFile("031", "真占位的背景", "<这里还没写>"),
        },
        (out, code) => {
          assert.equal(code, 1, `裸占位记号必须仍被判空(否则修复把真检查关掉了):\n${out}`);
          assert(!/ADR-030-含泛型的背景\.md.*背景」是空的/.test(out), `行内代码里的泛型不该被判空:\n${out}`);
          assert(/ADR-031-真占位的背景\.md.*背景」是空的/.test(out), `裸占位记号必须仍被判空:\n${out}`);
        },
      );
    });
  });

  // ============ 列数守卫(判红那一族)============

  // ⚠️ **这一族单测测不到**:上面两段测的是纯函数,而「判红 ⇒ 非零退出」这条**只在真门禁跑起来
  // 时才成立**。门禁本体最坏的一种漂移是**退出码回落**(判据在报,但没人非零退出)——
  // 纯函数测试看不见它(它只看 `errors` 数组),`check-docs.selftest.mjs` 的夹具是**回归守护**,
  // 两条必须成对才拆得开:那一份钉「诊断文案可分辨」,本段钉「退出码真的非零」。

  await suite.describe("列数守卫(错位行判红)", async (s) => {
    // 错位行:标题里一个**未转义**的 `|` 把 4 格的行切成 5 格(合成仓的表头是 4 列)。
    // 号格与上一行相同 ⇒ 它若参与判定就是重号;它退出 ⇒ 不报重号。
    const misaligned = "| REQ-001 | 在办 | 标题里有个竖线 | 竖线左边 | 竖线右边 |";
    /**
     * 合成台账全文,数据行由 `row` 代入(错位行 / 已转义竖线的正常行两种形态共用)。
     * @param {string} row 顶在首条数据行之后的那一行
     * @returns {string} 合成台账 markdown
     */
    const ledgerWith = (row) =>
      ["# 台账", "", "## 在办", "", REGISTRY_HEADER, REGISTRY_RULE, registryRow("REQ-001", "在办", "第一条", "无阻塞"), row, "", "## 号段", "", rangeTable("REQ-001", "REQ-002"), ""].join("\n");

    await s.case("错位行 ⇒ 非零退出,且诊断带行号与两处列数(退出码回落这条漂移纯函数测不到)", async () => {
      await withRepo({ "README.md": ROOT_README, "docs/REQ.md": ledgerWith(misaligned) }, (out, code) => {
        assert.equal(code, 1, `列数不符必须非零退出(否则「判红」只是改了个提示文字):\n${out}`);
        // 合成仓的 `REGISTRY_HEADER` 是 4 列 ⇒ 错位行拆出 5 格。诊断要点名**两处**列数。
        const hits = verdictLines(out).filter((line) => /列数错位/.test(line));
        assert.equal(hits.length, 2, `两个落点各报一条(台账内不变量 + 载体形态),实得 ${hits.length} 条\n${out}`);
        for (const line of hits) {
          assert(/^docs\/REQ\.md:8 →/.test(line), `判红行须带 文件:行 定位:${line}`);
          assert(/该行 5 格 ≠ 表头 4 列/.test(line), `须同时点名实际格数与期望列数:${line}`);
          assert(/「在办」节/.test(line), `须点名所在节:${line}`);
        }
        // gap 那条说的是「这 1 行我没查」,与判红**不是同一件事**,两者都要在。
        assert(/台账错位行 1 行未判\(列数 ≠ 表头/.test(out), `覆盖度自报不得随判红一起消失:\n${out}`);
        // ⚠️ **反向证明:退出仍在**。夹具里那一行的号格与上一行相同,它若参与判定就是重号;
        // 它退出 ⇒ 号唯一判不到它 ⇒ 输出里**不得**有重号那条。
        // 裸词 `/重号/` 不能用 —— 列数错位的诊断正文里就列着「重号 / 状态取值域 / 墓碑」。
        assert(!/→ 重号:该号已在/.test(out), `错位行必须退出全部台账判据(判红不等于改成参与判定):\n${out}`);
      });
    });

    await s.case("列数守卫撤回:同一行只把格数补齐 ⇒ 复绿(证明上条红在本判据上,不是夹具写坏)", async () => {
      // 竖线已转义 ⇒ 4 格 = 表头 4 格;号格仍是 REQ-001(与上一行同号)⇒ **重号**会被报出来。
      // 退出码仍是 1 —— 本条证明的是「**红的原因换了**」:列数错位那条消失,重号那条出现。
      // 若这里断言 exit 0,就等于把「撤回」写成「顺手把夹具其它问题也修了」,钉不住任何东西。
      await withRepo(
        { "README.md": ROOT_README, "docs/REQ.md": ledgerWith("| REQ-001 | 在办 | 标题里有个竖线 \\| 竖线左边 | 无阻塞 |") },
        (out, code) => {
          assert.equal(code, 1, `撤回后仍非零退出,但红的原因必须换成重号:\n${out}`);
          assert(!/列数错位/.test(out), `格数补齐后列数错位必须消失:\n${out}`);
          assert(!/台账错位行/.test(out), `格数补齐后覆盖度自报里也不该再有错位行:\n${out}`);
          assert(/→ 重号:该号已在/.test(out), `格数补齐后那一行参与判定 ⇒ 重号该被报出来:\n${out}`);
        },
      );
    });
  });

  return { cases: suite.results };
}