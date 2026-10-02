// @ts-check
/**
 * 文档指针判据(本仓 vendored 版)的**引用解析 / 豁免形态 / 退出码不变量**单测段。
 *
 * 为什么要有这一段:判据本体 `gates/repo/check-pointers.mjs` 是从全局配置目录逐字搬进来的
 * (ADR-054 决定一),搬的时候只搬了实现、**没搬它的单元测试** ⇒ 本仓这一千多行判据在
 * 本仓侧零单测。改解析口径时只有跑门禁才看得出来,而门禁读的是本仓真实文档 ——
 * 「同目录邻居链接能不能解析到」这类**夹具级口径**在真实文档上永远走不到。
 * 本段把上游那份测试里**属于判据本身**的用例搬过来(ADR-054 决定五)。
 *
 * 本段只搬「纯函数 + 内存夹具」那一族;需要落真文件树或起子进程的不在此列(那是端到端职责)。
 * 夹具路径形如 `docs/AGENTS.md`,与真仓无关 ⇒ 本段不造临时目录、不读真文件树;
 * 唯一读磁盘的地方是末尾那两条「读判据源码文本」的机械守卫。
 *
 * ---- 三处与上游不同的地方,都是「拆分」造成的,不是改口径 ----
 * 1. **跨仓路径只分类、不判定**(ADR-054 决定四):上游那一族断言的是「报错」,而判红的依据在
 *    全局配置目录、本仓不可达,照搬得到的是确定性假红。本段改断言**分类侧**,并额外钉住
 *    「分类接口根本不提供错误通道」这个结构性事实(它才是「本仓恒为未判」的机械证据)。
 * 2. **单模式**(ADR-054 决定一删掉了配置模式):上游用例里的模式参数一律去掉。唯一因此空转的
 *    不变量是「两模式候选顺序相反」,它退化成「顺序必须显式传参、不得依赖默认值」
 *    (ADR-014 决定二在单模式下的形态)—— 本段按后者断言,否则下一个人会把 order 默认值加回来。
 * 3. **豁免表的「与模式无关」**:上游断言的是「项目模式下同样豁免」,模式没了之后存活下来的是
 *    「形态豁免只由文件名形态决定」,按后者断言。
 */
import fs from "node:fs";
import path from "node:path";
import { assert, createCaseSuite } from "../common/case.js";
import { ROOT } from "../common/paths.js";
import {
  checkExistence,
  checkOrdinalSections,
  checkSections,
  classifyCrossRepoRefs,
  makeCrossRepoRowSkipper,
  refResolutionStats,
  resetRefResolutionStats,
  resolveRef,
  skipReason,
} from "../../gates/repo/check-pointers.mjs";

/** 判据源码(末尾两条机械守卫读它;仓根取 single 源,不按目录层级自推) */
const GATE_REL = "gates/repo/check-pointers.mjs";
const gateSource = () => fs.readFileSync(path.join(ROOT, ...GATE_REL.split("/")), "utf8");

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
 * 「判红清单为空」断言。**不能用相等比较**:判定每次返回的是新数组,`[] === []` 恒假,
 * 会让这条判据变成恒红(看起来在断,其实什么都没断)。
 * @param {string[]} errors 判定返回的错误清单
 * @param {string} what 断言项名
 * @returns {void}
 */
function assertNoErrors(errors, what) {
  assert(Array.isArray(errors) && errors.length === 0, `${what}:实得 ${errors.length} 条判红 ${JSON.stringify(errors)}`);
}

/**
 * 内存夹具:表是「仓根相对路径 → 正文」。`base` 刻意**大小写敏感**,它代表 Linux 侧的真实行为
 * (Windows 上真文件系统不区分大小写,那是 P5 那条已知的不一致,本轮不修)。
 * @param {Record<string, string>} table 内存文件表
 * @returns {{ base: (rel: string) => boolean; read: (rel: string) => string }}
 */
function mem(table) {
  const has = (/** @type {string} */ rel) => Object.prototype.hasOwnProperty.call(table, rel);
  return { base: has, read: (rel) => (has(rel) ? (table[rel] ?? "") : "") };
}

/**
 * 三档判定在本仓的调用签名。**在这里显式声明一次**,而不是在每个调用点各写一遍断言:
 * 判定本体是 JS 且形参无类型标注,类型只能从默认值推断 —— 存在性注入点会被推成 `null`,
 * 拿到就报「不是 null」。这里写下的形状就是该注入点的契约:「仓根相对路径 → 是否存在」。
 * @typedef {(rel: string) => boolean} ExistenceProbe
 * @typedef {(root: string, files: string[], readFile: (rel: string) => string,
 *   skipRow: (file: string, lineNo: number) => boolean, base: ExistenceProbe) => string[]} TripleGate
 */

/** @type {TripleGate} */
const existenceGate = /** @type {TripleGate} */ (/** @type {unknown} */ (checkExistence));
/** @type {TripleGate} */
const sectionsGate = /** @type {TripleGate} */ (/** @type {unknown} */ (checkSections));
/** @type {TripleGate} */
const ordinalSectionsGate = /** @type {TripleGate} */ (/** @type {unknown} */ (checkOrdinalSections));

/** 跑第 1 档(存在性)。`base` 走注入点 ⇒ 落在一张内存表上。 */
const exist1 = (/** @type {Record<string, string>} */ table, /** @type {string} */ file) => {
  const m = mem(table);
  return existenceGate("ROOT", [file], m.read, () => false, m.base);
};

/** 跑第 3 档(带引号小节名)。 */
const sect1 = (/** @type {Record<string, string>} */ table, /** @type {string} */ file) => {
  const m = mem(table);
  return sectionsGate("ROOT", [file], m.read, () => false, m.base);
};

/** 跑第 5 档(无引号序数小节)。 */
const ord1 = (/** @type {Record<string, string>} */ table, /** @type {string} */ file) => {
  const m = mem(table);
  return ordinalSectionsGate("ROOT", [file], m.read, () => false, m.base);
};

/** 本仓唯一的候选顺序(引用方目录优先、仓根次之);`resolveRef` 的 order 形参无默认值,必须显式传。 */
const ORDER_DIR_FIRST = ["dir", ""];
/** 与上面相反的顺序,只用于证明「顺序真的在被尊重」(见「顺序显式传参」那条)。 */
const ORDER_ROOT_FIRST = ["", "dir"];

/** 「同目录邻居 + 真小节」的标准夹具:`adr/README.md` 里有一个真小节 `落盘分工`。 */
const ADJACENT = {
  "docs/AGENTS.md": "字段骨架、序号分配 → `adr/README.md`。\n",
  // 同一行也放在仓根下:证明「是基准在判」的那条对照(引用方在仓根 ⇒ 解析不到)。
  "AGENTS.md": "字段骨架、序号分配 → `adr/README.md`。\n",
  "docs/adr/README.md": "# adr/ 目录说明\n\n## 落盘分工\n\n正文。\n",
};

/**
 * 跨仓分类夹具。**没有「配置仓」这一侧**:判红基准在仓外、本仓不可达(ADR-054 决定四),
 * 分类器也没有接收它的入参(见「入参里没有仓外通道」那条断言)。这里只给消歧侧 ——
 * 「该裸名在本仓解析得到吗」,那才是本仓自己的判据。
 * @param {string[]} lines 被分类文件的逐行内容
 * @param {{ inProject?: string[] }} [opts] 消歧侧:本仓解析得到的裸名
 */
function classify(lines, { inProject = [] } = {}) {
  const project = new Set(inProject);
  const readFile = () => lines.join("\n");
  return classifyCrossRepoRefs(
    ["docs/x.md"],
    readFile,
    (/** @type {string} */ ref) => project.has(ref),
    makeCrossRepoRowSkipper(readFile),
  );
}

export async function run() {
  const suite = createCaseSuite();

  // ================= 跨仓路径(只分类,不判定) =================
  //
  // 本组三处 0 值断言互为对照:带目录前缀不分类、表外拼写不带「全局」前缀不分类、
  // 本仓有同名文件不分类 —— 三条同时成立才说明「分类 1 处」那几条不是因为这一族恒分类。
  await suite.describe("跨仓路径(只分类,不判定)", async (s) => {
    await s.case("裸名 + 本仓解析不到 + 命中全局指南名表 ⇒ 被分类为跨仓引用", () => {
      const r = classify(["见全局配置目录 `WORKFLOW-DELIVER.md` 的阶段 5。"]);
      // 上游此处断言的是「报一条跨仓死指针」,本仓不成立:判红依据在仓外(见文件头第 1 条)。
      // 存活下来的是分类侧 —— 它证明这一族在本仓仍被识别,而不是悄悄不认了。
      assertEq(r.stats.classified, 1, "裸名 + 命中全局指南名表 ⇒ 应被分类为跨仓引用");
    });

    await s.case("分类接口不提供错误通道,且入参里没有仓外可达性的 IO 通道", () => {
      const r = classify(["见全局配置目录 `WORKFLOW.md`「六、收尾」。"]);
      // 计数是 2:反引号形态与「小节名」形态各认了一次(带小节名时两条形态路径都会走)。
      assertEq(r.stats.classified, 2, "带小节名的写法同样被分类(两种指针形态各一处)");
      assert(!("errors" in r), "分类结果不得带错误通道(有它就意味着本仓又开了一条判红路径)");
      // 上游这一族的两支(小节在 / 小节不在)在本仓是**同一个结果** —— 差别只可能出现在判红侧,
      // 而判红侧不在本仓。机械证据:分类器只收 4 个入参,没有别的仓的 exists/read 注入点。
      assertEq(classifyCrossRepoRefs.length, 4, "分类器的入参个数(多一个就是多了一条仓外 IO 通道)");
    });

    await s.case("同名文件在本仓存在 ⇒ 消歧,不是跨仓指针(分类 0 处)", () => {
      const lines = ["依赖钉死约束见 `AGENTS.md`「硬约束」节。"];
      assertEq(classify(lines, { inProject: ["AGENTS.md"] }).stats.classified, 0, "本仓解析得到该裸名 ⇒ 消歧");
      // 对照:同一个裸名、本仓解析不到 ⇒ 必须被分类(否则上面那个 0 可能只是「这一族恒不分类」)。
      // 计数是 2:反引号形态与「小节名」形态各认了一次,两条形态路径都在走。
      assertEq(classify(lines).stats.classified, 2, "本仓解析不到时,两种指针形态各分类一处");
    });

    await s.case("带目录前缀的引用不分类(两个仓都有该目录 ⇒ 归属不可判定)", () => {
      const r = classify(["见全局配置目录 `docs/adr/adr-009-某.md`「决定」节。"]);
      assertEq(r.stats.classified, 0, "带目录前缀 ⇒ 归属不可判定 ⇒ 不分类");
    });

    await s.case("名表之外的拼写:带「全局」前缀照样分类,不带就不分类", () => {
      assertEq(
        classify(["见全局配置目录 `WORKFLOW-DELIVR.md`。"]).stats.classified,
        1,
        "名表管不到的拼写笔误由「全局」前缀这一支兜住",
      );
      assertEq(
        classify(["见 `WORKFLOW-DELIVR.md`。"]).stats.classified,
        0,
        "既不带「全局」又不命中名表 ⇒ 不是本族对象(判定收紧在「这句声明了跨仓」)",
      );
    });

    await s.case("台账形态表的表体行不分类,且被跳过的行必须计数", () => {
      const lines = [
        "## 判断依据",
        "",
        "| 号 | 为什么 |",
        "|---|---|",
        "| 条目甲 | 曾误引 `WORKFLOW-DELIVER.md`,已改对 |",
        "",
        "正文里的 `WORKFLOW-DELIVER.md` 才是活指针。",
      ];
      const r = classify(lines);
      assertEq(r.stats.classified, 1, "同一份文件里表体行与正文两种身份 ⇒ 只有正文那处是活指针");
      assertEq(r.stats.freeTextRows, 1, "被跳过的表体行必须计数(豁免 ≠ 无门禁)");
      // 对照:只留表体行 ⇒ 分类 0,证明上面那 1 来自正文行而不是表体行。
      assertEq(classify(lines.slice(0, 5)).stats.classified, 0, "只剩表体行时不该分类出任何跨仓指针");
    });
  });

  // ================= 引用解析(单模式 · 候选基准) =================
  //
  // 每条探针都配「能证伪它的错误实现」:正例(0 错)单独存在没有证明力 ——
  // 判据恒绿时正例同样 0 错。判红侧与正例一起看,才证明是**这条性质**在判。
  await suite.describe("引用解析(单模式)", async (s) => {
    await s.case("同目录邻居链接 ⇒ 绿(专治「基准算成仓根」)", () => {
      assertNoErrors(exist1(ADJACENT, "docs/AGENTS.md"), "引用方目录下的邻居文件应解析得到");
      assertEq(exist1(ADJACENT, "AGENTS.md").length, 1, "对照:同一行换到仓根下的文件里就解析不到(证明是基准在判)");
    });

    await s.case("上一级前缀 ⇒ 绿(专治「相对前缀被当普通名字拼在仓根后」)", () => {
      const REF = "docs/adr/ADR-004-某条决策.md";
      const table = { [REF]: "载体表见 [上一级](../README.md)。\n", "docs/README.md": "# docs/ 目录说明\n" };
      assertNoErrors(exist1(table, REF), "往上一级解析得到");
      // 判红侧:层级再往上退一级就落空(仓根没有同名文件)—— 证明相对前缀真的被解析掉了,
      // 而不是被当普通名字在仓根拼出另一个路径后碰巧对上。
      const over = { [REF]: "见 [退过头](../../README.md)。\n", "docs/README.md": "# docs/ 目录说明\n" };
      assertEq(exist1(over, REF).length, 1, "退过头一级必须解析不到");
    });

    await s.case("相对前缀层级写错 ⇒ 红(专治「回落仓根被兜绿」)", () => {
      // 构造取自真错写法:一份文档写 `../docs/adr/…`,而真身是 `docs/adr/…`。
      // **回落仓根(剥掉前缀再按仓根找)会让它变绿** —— 而那正是错写法,判红才有价值。
      // 正确解析:引用方在 `docs/evidence/` ⇒ `docs/evidence/../docs/adr/X.md`
      //          = `docs/docs/adr/X.md` ⇒ 不存在。
      const REF = "docs/evidence/20261002-000000-某次分析.md";
      const NAME = "ADR-004-文档载体结构改版.md";
      const r = exist1({ [REF]: "依据见 `../docs/adr/" + NAME + "`。\n", ["docs/adr/" + NAME]: "# 决策\n" }, REF);
      assertEq(r.length, 1, `错层级必须判红(回落仓根的实现在这里会判绿):${JSON.stringify(r)}`);
      assert(r[0] !== undefined && /目标文件不存在/.test(r[0]), `报错须说明是存在性问题:${r[0] ?? "无"}`);
      // 对照:同样带前缀、只退对一级就落在真身上 ⇒ 绿(证明不是「带前缀一律判红」)。
      const ok = { [REF]: "依据见 `../adr/" + NAME + "`。\n", ["docs/adr/" + NAME]: "# 决策\n" };
      assertNoErrors(exist1(ok, REF), "退对一级必须解析得到");
    });

    await s.case("裸名两处基准都解析不到 ⇒ 红(专治「偷偷加了全仓唯一 basename 兜底」)", () => {
      // 仓根没有该名,引用方目录也没有;但仓里**别处**有一份。「全仓唯一 basename 兜底」
      // 会把它捞出来判绿 ⇒ 拼错的文件名从此不再判红。
      const r = exist1({ "docs/AGENTS.md": "见 `ADR-999.md`。\n", "docs/adr/ADR-999.md": "# 甲\n" }, "docs/AGENTS.md");
      assertEq(r.length, 1, `全仓 basename 兜底会让这条变绿:${JSON.stringify(r)}`);
      assert(r[0] !== undefined && /ADR-999\.md/.test(r[0]), `报错须点名那个拼错的名字:${r[0] ?? "无"}`);
      // 对照:引用方目录里**真有**同名文件时是绿的 ⇒ 证明不是「这一档恒红」。
      const same = { "docs/AGENTS.md": "见 `ADR-999.md`。\n", "docs/ADR-999.md": "# 乙\n" };
      assertNoErrors(exist1(same, "docs/AGENTS.md"), "引用方目录里有同名文件时应解析得到");
    });

    await s.case("文件名大小写错 ⇒ 红(口径钉住;真文件系统上 Windows 不区分大小写,本轮不修)", () => {
      // ⚠️ 本条不得读成「Windows 上也红」:真文件系统走的是 stat,Windows 路径不区分大小写 ⇒
      // 这条引用在 Windows 会绿、在 Linux 会红。本轮不引入大小写判据(那会给 Linux 侧新增
      // 误报面),所以这里只用**大小写敏感的内存夹具**钉住「解析器不对文件名做大小写折叠」。
      const table = { "docs/AGENTS.md": "见 `adr/readme.md`。\n", "docs/adr/README.md": "# 丙\n" };
      const r = exist1(table, "docs/AGENTS.md");
      assertEq(r.length, 1, `大小写错必须解析不到:${JSON.stringify(r)}`);
      // 解析器不做任何大小写归一:候选串原样保留引用方的写法。
      assertEq(
        resolveRef(mem(table).base, "adr/readme.md", "docs/AGENTS.md", ORDER_DIR_FIRST),
        null,
        "不得把大小写不同的名字折叠到真身上",
      );
    });

    await s.case("小节名那一档:拿解析后的路径去取标题表(半修法在这里会整条判红)", () => {
      // 半修法 = 存在性判定的基准换成引用方目录,而取小节标题表的入参仍用未解析的裸名
      // ⇒ 读到空标题表 ⇒ **同一批完全正确的引用**全部判「目标文件里没有这个小节标题」,
      // 且报错文案指不到任何真实文件。那是假红里最坏的一种。
      const t = {
        "docs/AGENTS.md": "载体分工见 `adr/README.md`「落盘分工」节。\n",
        "docs/adr/README.md": "# adr/ 目录说明\n\n## 落盘分工\n\n正文。\n",
      };
      assertNoErrors(sect1(t, "docs/AGENTS.md"), "小节名那一档必须拿解析后的路径去取标题表");
      // 判红侧 + **报错必须点名解析后的路径**:这是「target 确实是解析结果」的第二重证明。
      const bad = {
        "docs/AGENTS.md": "载体分工见 `adr/README.md`「没有这个节」节。\n",
        "docs/adr/README.md": "# adr/ 目录说明\n\n## 落盘分工\n\n正文。\n",
      };
      const r = sect1(bad, "docs/AGENTS.md");
      assertEq(r.length, 1, JSON.stringify(r));
      assert(r[0] !== undefined && /→ docs\/adr\/README\.md「没有这个节」/.test(r[0]), `报错必须指到真实文件:${r[0] ?? "无"}`);
    });

    await s.case("无引号序数那一档:target 同样是解析后的路径", () => {
      // 这一档此前**自己写了一份**解析分支(与存在性那一档同一段逻辑的第二份拷贝),
      // 两处口径必须逐字一致,否则两处各自漂移。
      const t = {
        "docs/AGENTS.md": "序号分配见 `adr/README.md` 阶段 2。\n",
        "docs/adr/README.md": "# adr/ 目录说明\n\n## 阶段 2 · 分配\n",
      };
      assertNoErrors(ord1(t, "docs/AGENTS.md"), "无引号序数那一档必须拿解析后的路径去取标题表");
      const bad = {
        "docs/AGENTS.md": "序号分配见 `adr/README.md` 阶段 9。\n",
        "docs/adr/README.md": "# adr/ 目录说明\n\n## 阶段 2 · 分配\n",
      };
      const r = ord1(bad, "docs/AGENTS.md");
      assertEq(r.length, 1, JSON.stringify(r));
      assert(r[0] !== undefined && /→ docs\/adr\/README\.md 阶段 9/.test(r[0]), `报错必须指到真实文件:${r[0] ?? "无"}`);
    });

    await s.case("「兜底解析」这个计数是活的(诚实性开关,不是装饰)", () => {
      // 汇总行里那个「兜底解析 N 处」必须真的会因为**多出来的兜底基准**而变化 ——
      // 否则「偷偷加了全仓唯一 basename 兜底」的过宽实现可以在汇总行里隐身,
      // 而汇总行是唯一会被读的地方。
      const m = mem({ "docs/AGENTS.md": "x\n", "docs/adr/ADR-999.md": "# 丁\n" });
      resetRefResolutionStats();
      assertEq(resolveRef(m.base, "ADR-999.md", "docs/AGENTS.md", ORDER_DIR_FIRST), null, "无兜底基准时解析不到");
      assertEq(refResolutionStats().fallback, 0, "没有兜底基准时该计数必须为 0");
      // 给一个「全仓唯一 basename」式的兜底 ⇒ 它立刻被计成兜底(而不是混进「按引用方目录」)。
      resetRefResolutionStats();
      const hit = resolveRef(m.base, "ADR-999.md", "docs/AGENTS.md", ORDER_DIR_FIRST, [
        (/** @type {string} */ ref) => `docs/adr/${ref}`,
      ]);
      assertEq(hit, "docs/adr/ADR-999.md", "兜底基准命中时应返回它解析出的路径");
      assertEq(refResolutionStats().fallback, 1, "兜底来源必须被单独计数,否则过宽实现无法被看见");
      assertEq(refResolutionStats().byDir, 0, "兜底不得混进「按引用方目录解析」那个数");
    });

    await s.case("候选顺序必须显式传参且真的被尊重(两模式顺序相反那一支在单模式下的退化形态)", () => {
      // 上游这条断言的是「两模式的候选顺序相反」;本仓只有一种模式(ADR-054 决定一),
      // 「相反」这件事不存在了,但**「顺序必须显式传参、不许有默认值」这半条仍然成立** ——
      // 写成默认值会让顺序重新变成可省略的参数,而它恰是最容易静默改错的一档。
      const m = mem({
        "docs/AGENTS.md": "见 `guide.md`。\n",
        "guide.md": "# 仓根那份\n",
        "docs/guide.md": "# 同目录那份\n",
      });
      // 同一份夹具里 `guide.md` 在仓根与引用方目录各有一份 —— 谁被选中完全由传进来的顺序决定。
      resetRefResolutionStats();
      assertEq(resolveRef(m.base, "guide.md", "docs/AGENTS.md", ORDER_DIR_FIRST), "docs/guide.md", "按目录优先传参 ⇒ 命中同目录那份");
      const dirFirst = refResolutionStats();
      assertEq(dirFirst.byDir, 1, "目录优先时须记在「按引用方目录解析」上");
      assertEq(dirFirst.byRoot, 0, "目录优先时仓根是次选,不该被记成命中");
      resetRefResolutionStats();
      assertEq(resolveRef(m.base, "guide.md", "docs/AGENTS.md", ORDER_ROOT_FIRST), "guide.md", "按仓根优先传参 ⇒ 命中仓根那份(证明顺序真在被尊重)");
      const rootFirst = refResolutionStats();
      assertEq(rootFirst.byRoot, 1, "仓根优先时须记在「仓根解析」上");
      assertEq(rootFirst.byDir, 0, "仓根优先时引用方目录是次选,不该被记成命中");
      assertEq(dirFirst.ambiguous, 1, "两档都能解析 ⇒ 必须被计成歧义而不是静默挑一个");
      assertEq(rootFirst.ambiguous, 1, "顺序反过来也一样:歧义计数与顺序无关");
      // 「不得依赖默认值」是机械事实,不是约定:形参表里 order 后面必须紧跟逗号。
      const decl = /export function resolveRef\(\s*base\s*,\s*ref\s*,\s*fromFile\s*,\s*order\s*,/.exec(gateSource());
      assert(decl !== null, "resolveRef 的第四个形参必须叫 order 且**不带默认值**(默认值会让顺序重新可省略)");
      // 交叉印证:有默认值的形参不计入函数长度,故 length === 4 说明只有兜底槽带默认值。
      assertEq(resolveRef.length, 4, "resolveRef 的形参长度(前 4 个都必填,只有兜底槽可省略)");
    });
  });

  // ================= 豁免表:占位记号的命名形态 =================
  //
  // 直接对豁免表取证(而不是走存在性那一档看「少报一条红」):那一支的下游效果是少报,
  // 而「少报」与「那一档整体恒绿」在输出上分不开;对豁免表取证才能把「这一支在起作用」
  // 与「它的**形状**对不对」分开钉住。每条都必须有「不该跳的仍然跳不过去」的对照。
  await suite.describe("豁免形态(占位记号)", async (s) => {
    await s.case("只跳过字母形态(规则文件讲命名规范时写的就是这一串字母)", () => {
      for (const ref of [
        "evidence/YYYYMMDD-HHMMSS-主题.md",
        "docs/evidence/YYYYMMDD-HHMMSS-主题.md",
        "docs/evidence/YYYYMMDD-HHMMSS-甲-某次评估.md",
      ]) {
        assertEq(skipReason(ref), "文件名形态说明(占位记号)", `${ref} 必须被跳过(没有真文件这么命名)`);
      }
    });

    await s.case("形态不完整时不得豁免(形状要够 specific,不是见字母串就放过)", () => {
      // 收得太宽的实现(把 YYYYMMDD 单独当一支、或不要求连字符)会把这些一起放过;
      // 它们都不是规则规定的形态,必须仍然受检。
      for (const ref of [
        "YYYYMMDD.md",
        "YYYYMMDD-主题.md",
        "YYYYMMDDHHMMSS-主题.md",
        "yyyymmdd-hhmmss-主题.md",
        "docs/evidence/README.md",
        "docs/adr/ADR-099-不存在的决策.md",
      ]) {
        assertEq(skipReason(ref), null, `${ref} 不是规则规定的命名形态,豁免它就是过宽(会把真的坏指针放过)`);
      }
    });

    await s.case("形态豁免只由文件名形态决定:与目录前缀、指针前文都无关", () => {
      // ⚠️ 上游这条断言的是「项目模式下同样豁免」,而模式已随拆分删除 ⇒ 那半句随判据一起作废。
      // 存活下来的不变量是:这一支是**纯形态规则**,只看 basename 那一串字母,不看它挂在哪个
      // 目录、也不看这句指针的前文有没有声明跨仓(声明了跨仓仍归形态这一支判)。
      const EXPECT = "文件名形态说明(占位记号)";
      assertEq(skipReason("docs/evidence/YYYYMMDD-HHMMSS-主题.md"), EXPECT, "标准位置的字母形态");
      assertEq(skipReason("evidence/YYYYMMDD-HHMMSS-主题.md"), EXPECT, "换了目录前缀仍是同一支(形态规则不看目录)");
      assertEq(skipReason("YYYYMMDD-HHMMSS-主题.md"), EXPECT, "裸名形态同理");
      assertEq(skipReason("YYYYMMDD-HHMMSS-主题.md", "见全局配置目录 "), EXPECT, "前文声明了跨仓也仍是形态这一支");
      // 收窄的那半边:数字形态是真形态(真文件一律数字时间戳),必须受检。
      assertEq(skipReason("20260930-101012-缺头.md"), null, "数字形态不受检(豁免它等于给真实形态开口子)");
      assertEq(skipReason("docs/evidence/20260930-101012-缺头.md"), null, "带目录前缀的同一条同样不受检");
      // 下游对照:一份不存在的数字形态快照引用必须真的报出来(证明上面那个 null 不是恒 null)。
      const dead = { "docs/LOG.md": "分析见 `20260930-101012-缺头.md`。\n" };
      const r = exist1(dead, "docs/LOG.md");
      assertEq(r.length, 1, `数字形态的死指针必须判红:${JSON.stringify(r)}`);
      assert(r[0] !== undefined && /20260930-101012-缺头\.md/.test(r[0]), `报错须点名那个快照名:${r[0] ?? "无"}`);
      // 反向对照:真存在的同一形态仍然绿(豁免收窄不得把正常写法判红)。
      const ok = {
        "docs/LOG.md": "分析见 `docs/evidence/20261002-140000-规则层token实测.md`。\n",
        "docs/evidence/20261002-140000-规则层token实测.md": "# 某次实测\n",
      };
      assertNoErrors(exist1(ok, "docs/LOG.md"), "真实存在的快照引用必须仍然绿");
    });
  });

  // ================= 退出码不变量(读判据源码文本) =================
  //
  // 读源码而非跑子进程:这两条守的是「不许出现第二种形态」,而跑一次只能看到当次取值 ——
  // 多出来的分支得等它真的被走到才看得见,那时它已经在产物里了。
  await suite.describe("退出码不变量(源码文本判定)", async (s) => {
    await s.case("退出码恒为单值(只可能有两个取值),不因侧别引入第二组取值", () => {
      const src = gateSource();
      // 「退出码原样传出、不得归一」:任何新值(「另一侧红 = 2」之类)都是新的丢法。
      // 全文件只许有一处退出码写入。
      const writes = [...src.matchAll(/(?<![\w.])process\.exitCode\s*=\s*([^;\n]+);/g)].map((m) => (m[1] ?? "").trim());
      assertEq(writes.length, 1, `全文件只许有一处退出码写入,实得 ${writes.length} 处`);
      assertEq(writes[0], "main()", `退出码必须由判定本体的返回值一处产出(实测 ${writes[0]})`);
      assert(!/\bprocess\.exit\s*\(/.test(src), "不许有第二个退出点(它会绕开退出码取值域这条判据)");
      // 取值域只在 main 的返回表达式里判:判据本体里其它 return 返回的是字符串或解析结果,
      // 对它们做数字白名单会把整段代码风格判红。定位方式:main 的声明 → 入口守卫那一行。
      const mainStart = src.indexOf("export function main()");
      const guardStart = src.indexOf("const entryArg");
      assert(mainStart >= 0 && guardStart > mainStart, `定位不到 main 体(声明 ${mainStart} · 入口守卫 ${guardStart}),换布局时要同步改本条`);
      const mainBody = src.slice(mainStart, guardStart);
      const returns = [...mainBody.matchAll(/return\s+([^;]*);/g)].map((m) => (m[1] ?? "").trim());
      // 真正的返回语句是函数体最后那个(前面几个是体内箭头函数的);它必须是「一个条件表达式,
      // 两个分支各有一个字面量」—— 缺了字面量就说明有人把取值藏进了别的函数。
      const exitExpr = returns[returns.length - 1] ?? "";
      for (const n of exitExpr.match(/\d+/g) ?? []) {
        assert(n === "0" || n === "1", `退出码取值只能是 0 / 1,实得字面量 ${n}(整段:${exitExpr})`);
      }
      assert(
        /===\s*0\s*\?\s*0\s*:\s*1\s*$/.test(exitExpr),
        `退出码表达式应是「判据计数 === 0 ? 0 : 1」这一形状,实得:${exitExpr}`,
      );
      assert(
        returns.filter((r) => /\?\s*0\s*:\s*1/.test(r)).length === 1,
        "全文件只许有一处决定退出码取值的表达式(多一处就是第二组取值)",
      );
    });

    await s.case("不引入任何降级开关:读命令行参数恰好一处、读环境变量零处", () => {
      // 逃生阀会被单向滥用(「赶时间提交」时被用,且用的人不会回来关);把静默降级写成默认
      // 等于把最坏形态制度化。**这个开关不该存在**,所以是机械计数而不是评审约定。
      const src = gateSource();
      const argvUses = [...src.matchAll(/(?<![\w.])process\.argv/g)].length;
      assertEq(argvUses, 1, `process.argv 只许出现在「是否被直接执行」那一处,实得 ${argvUses} 处`);
      for (const bad of ["process.env", "--no-config", "NO_CONFIG", "SKIP_CONFIG", "only-project"]) {
        assert(!src.includes(bad), `不得出现任何形式的降级开关标记: ${bad}`);
      }
    });
  });

  return { cases: suite.results };
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;