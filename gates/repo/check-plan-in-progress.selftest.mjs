// PLAN「状态 ↔ 真实在跑」对读门禁自身的回归守护(负向夹具)。
//
// check-plan-in-progress.mjs 判定的是**两处人工维护的文本之间是否一致**,它的失效形态不是
// 「抓错」而是「恒绿」与「恒红」:解析层一旦塌掉(表格形态一改就一行都认不出、或把带 🔄 的那行
// 当成表头吃掉),每一格都会安静地给出同一个答案,而没人会去看一个总是 exit 0 的脚本。
// 此处逐条注入这些漂移,断言判据确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体,也不复制它**:纯函数档直接 import 判定本体并注入 ctx(读文本 / 扫描面下限);
// 进程级档靠 cwd 指夹具根跑**仓内真脚本**(shared/paths.js 的 ROOT = process.cwd(),故这一句
// 同时是「换根」与「不换脚本」—— 夹具里不需要也不该放一份门禁副本)。
//
// **真实仓库那条只断言不变量、不断言绿**:真实载体此刻就该红(主会话正在跑 T3-6 而声明行还没补),
// 把缺陷状态写成「期望 exit 1」同样是把自己钉死在缺陷上 —— 缺陷一修,夹具自己红,而它守的判据
// 并没有变。断言的是「不抛错 + 判红项全在已登记代号集合内 + 计数自洽」。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则系统临时区
// 会堆满夹具树。本脚本全部写操作都落在 mkdtemp 出来的目录里,**不碰真实工作树**。

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../../shared/paths.js";
import { checkPlanInProgress } from "./check-plan-in-progress.mjs";

const projectRoot = ROOT;
const checkerPath = join(projectRoot, "gates", "repo", "check-plan-in-progress.mjs");

/** 子步表里用来锚点的两行(改 BASE_PLAN 时这两行必须一起改,否则插入类夹具静默失配) */
const ANCHOR_LAST_DONE = "| 3 ✅ | 已完成的又一步 | ✅ 已完成 |";
const ANCHOR_PENDING = "| 2 | 夹具底板里未开始的一步 | ⏸ 待做 |";
const ANCHOR_STAGE_T3 = "| **T3** | 搬迁 | ⏸ |";

/**
 * 夹具底板:三张表各一份 —— 阶段表(首格自限定 `**T3**`)、T3 子步表(裸序号,含一个 ⏸ 待做)、
 * T3-4d 批次表(另一份裸序号,前缀不同),外加一张首格是整句话的表(`修复项复测`)。
 *
 * 为什么必须复现这三份形态:门禁的「哪些行算子步」「id 怎么补前缀」完全靠形态判定。底板少了任何
 * 一张,「首格不是 id 的行不参与」「自限定首格不补前缀」「裸序号补上小节前缀」三格就失去对照,
 * 夹具会绿在一个收窄了扫描面的实现上。底板有 9 个子步行(下限 3),故每条夹具验的都是它要验的
 * 那一格,而不是「扫描面塌缩」那一格。
 */
const BASE_PLAN = [
  "# PLAN · 夹具",
  "",
  "## 步序与泳道",
  "",
  "| 阶段 | 内容 | 状态 |",
  "|---|---|---|",
  "| **T0** | 建判据 | ✅ 已完成 |",
  "| **T3** | 搬迁 | ⏸ |",
  "| **T4** | 收尾 | ⛔ 受阻 |",
  "",
  "### T3 的子步（夹具）",
  "",
  "| 子步 | 内容 | 状态 |",
  "|---|---|---|",
  "| 1 ✅ | 已完成的那一步 | ✅ 已完成 |",
  ANCHOR_PENDING,
  ANCHOR_LAST_DONE,
  "",
  "### T3-4d（夹具批次）",
  "",
  "| 批 | 段数 | 状态 |",
  "|---|---|---|",
  "| 1 | 2 | ✅ 完成 |",
  "| 2 | 3 | ✅ 完成 |",
  "",
  "## 修复项复测",
  "",
  "| 现象 | 首判 | 复测动作 |",
  "|---|---|---|",
  "| `verify:ci` 在 T5 后链长变长 | 新增门禁被误挂进链 | 查 access 字段 |",
  "",
].join("\n");

/**
 * 把底板里那一步从「⏸ 待做」改成「🔄 进行中」。
 * @param {string} [anchor] 目标行原文
 * @returns {string} 合成 PLAN.md
 */
function markInProgress(anchor = ANCHOR_PENDING) {
  return BASE_PLAN.replace(anchor, anchor.replace("⏸ 待做", "🔄 进行中"));
}

/**
 * 在 T3 子步表末尾追加一行(**必须落在该小节内**:追加到文件末尾会落进 `修复项复测` 那个小节,
 * 前缀清空后 id 变成裸 `4`,验的就不是「子步表新增一行」而是另一件事了)。
 * @param {string} label 首格(含状态标记与否由调用方决定)
 * @param {string} status 末格
 * @returns {string} 合成 PLAN.md
 */
function addSubstepRow(label, status) {
  return BASE_PLAN.replace(ANCHOR_LAST_DONE, `${ANCHOR_LAST_DONE}\n| ${label} | 夹具追加的一步 | ${status} |`);
}

/**
 * 追加一行声明到全文末尾。
 * @param {string} value 标签之后的值
 * @returns {string} 合成 PLAN.md
 */
function withDeclaration(value) {
  return `${BASE_PLAN}\n当前在跑: ${value}\n`;
}

/**
 * 在合成文本上求值判定本体(纯函数档;不 spawn,故不碰真实工作树,也不受 cwd 影响)。
 * @param {string} plan 合成 PLAN.md 全文
 * @param {{ minStepRows?: number }} [opts]
 * @returns {{ problems: string[], stats: import("./check-plan-in-progress.mjs").PlanStats }}
 */
function judge(plan, opts = {}) {
  return checkPlanInProgress({
    readText: (relative) => {
      if (relative !== "docs/PLAN.md") throw new Error(`夹具只提供 docs/PLAN.md,被判体却读了 ${relative}`);
      return plan;
    },
    minStepRows: opts.minStepRows ?? 0,
  });
}

/**
 * 造一棵合成仓根(只有 docs/PLAN.md),供进程级档以 cwd 指过去跑仓内真脚本。
 * @param {string} plan 合成 PLAN.md 全文
 * @returns {string} 夹具根绝对路径
 */
function createFixtureRoot(plan) {
  const dir = mkdtempSync(join(tmpdir(), "m2w-plan-in-progress-selftest-"));
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "PLAN.md"), plan, "utf8");
  return dir;
}

/**
 * 以指定 cwd 跑仓内门禁本体。
 * @param {string} cwd 工作目录
 * @param {string[]} [args] 传给门禁的参数
 * @returns {{ code: number | null, output: string }}
 */
function runAt(cwd, args = []) {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * 在合成仓根上跑门禁 CLI(进程级档)。
 * @param {string} plan 合成 PLAN.md 全文
 * @param {string[]} [args] 传给门禁的参数
 * @returns {{ code: number | null, output: string }}
 */
function runChecker(plan, args = []) {
  const dir = createFixtureRoot(plan);
  try {
    return runAt(dir, args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CASES = [
  {
    // 反向锚点:「没有进行中」这一格必须绿。正向不绿,下面所有负向的「红」都无意义 ——
    // 一个恒红的实现能让每一条负向夹具都通过。
    name: "基线:全部子步都不是 🔄 且无声明行 → 零判红",
    judgeOnly: true,
    plan: BASE_PLAN,
    expect: null,
  },
  {
    // 要求③的另一半:零进行中时**显式**声明「无」也不得判红(全部完成不得判红)。少了它,
    // 一个把「有声明 ⇒ 一定有东西在跑」反过来写的实现也能在上一条上绿。
    name: "零进行中 + 显式声明「无」→ 零判红",
    judgeOnly: true,
    plan: withDeclaration("无"),
    expect: null,
  },
  {
    // 要求①(本轮反复发生的那一格):标记 🔄 但全文没有任何声明。
    name: "🔄 无声明 → 判红并点名那个子步",
    judgeOnly: true,
    plan: markInProgress(),
    expect: /declaration-missing:检出 1 个标记为进行中\(🔄\)的子步\(T3-2\),但全文没有一行/,
  },
  {
    // 要求①的加强:多个子步同时在跑时必须**全部**被点名 —— 只报第一条的实现也能在上一格上红。
    name: "三个 🔄 且无声明 → 判红并按文档序把三个都点名",
    judgeOnly: true,
    plan: BASE_PLAN
      .replace(ANCHOR_PENDING, ANCHOR_PENDING.replace("⏸ 待做", "🔄 进行中"))
      .replace(ANCHOR_LAST_DONE, [
        ANCHOR_LAST_DONE,
        "| 4 | 夹具追加的一步 | 🔄 进行中 |",
        "| 5 | 夹具追加的一步 | 🔄 进行中 |",
      ].join("\n")),
    expect: /declaration-missing:检出 3 个标记为进行中\(🔄\)的子步\(T3-2 \/ T3-4 \/ T3-5\),但全文没有一行/,
  },
  {
    // 声明写着「什么也没在跑」却检出 🔄:与 declaration-missing 是**不同的缺失形态**
    // (声明行存在,只是内容为空集),必须单独判红,否则实现可以只认「没有声明行」那一种。
    name: "声明「无」但有 🔄 → 判红(declaration-none-contradicted)",
    judgeOnly: true,
    plan: `${markInProgress()}\n当前在跑: 无\n`,
    expect: /declaration-none-contradicted:声明写着「什么也没在跑」,但检出 1 个标记为进行中/,
  },
  {
    // 要求②:声明里有它但标记不是 🔄(已完成)。
    name: "声明点名已完成子步(标记 ✅)→ 判红(declared-not-in-progress)",
    judgeOnly: true,
    plan: withDeclaration("T3-1"),
    expect: /declared-not-in-progress:T3-1\(第 \d+ 行\)在声明里,但该行的标记不是 🔄/,
  },
  {
    name: "声明点名暂停子步(标记 ⏸)→ 判红(同一格,另一种标记)",
    judgeOnly: true,
    plan: withDeclaration("T3-2"),
    expect: /declared-not-in-progress:T3-2\(第 \d+ 行\)在声明里,但该行的标记不是 🔄/,
  },
  {
    name: "声明点名受阻子步(标记 ⛔)→ 判红(同一格,第三种标记)",
    judgeOnly: true,
    plan: withDeclaration("T4"),
    expect: /declared-not-in-progress:T4\(第 \d+ 行\)在声明里,但该行的标记不是 🔄/,
  },
  {
    // 要求④:声明指向一个已不存在的子步(删了/改名了而声明没跟着改),判红。
    name: "声明指向不存在的子步 → 判红(declared-unknown-step)",
    judgeOnly: true,
    plan: withDeclaration("T3-99"),
    expect: /declared-unknown-step:声明点名了 T3-99,但 docs\/PLAN\.md 里没有这个子步/,
  },
  {
    // 正向锚点:声明与 🔄 标记**双向**逐一对上时才绿。
    name: "声明与 🔄 标记逐一对上 → 零判红",
    judgeOnly: true,
    plan: `${markInProgress()}\n当前在跑: T3-2\n`,
    expect: null,
  },
  {
    // 双向各差一个:声明少一个(声明不全)与声明多一个(声明指向没在跑的)必须**同时**被点名。
    name: "部分一致(声明漏一个 + 多一个)→ 两个方向各判红",
    judgeOnly: true,
    plan: `${addSubstepRow("4", "🔄 进行中")}\n当前在跑: T3-1\n`,
    expect: /undeclared-in-progress:T3-4\(第 \d+ 行\)[\s\S]*declared-not-in-progress:T3-1/,
  },
  {
    // 「当前在跑」只能有一行:多行时无从判断哪一行是当前口径。
    name: "两行声明 → 判红(declaration-ambiguous)",
    judgeOnly: true,
    plan: `${markInProgress()}\n当前在跑: T3-2\n当前在跑: T3-2\n`,
    expect: /declaration-ambiguous:全文有 2 行声明/,
  },
  {
    name: "声明行重复点名同一子步 → 判红(declared-duplicate)",
    judgeOnly: true,
    plan: `${markInProgress()}\n当前在跑: T3-2 · T3-2\n`,
    expect: /declared-duplicate:T3-2 在声明里被点名 2 次/,
  },
  {
    name: "声明标签后是空的 → 判红(declaration-empty;空声明既不是「无」也不是一份点名)",
    judgeOnly: true,
    plan: `${BASE_PLAN}\n当前在跑:\n`,
    expect: /declaration-empty:第 \d+ 行的声明是空的/,
  },
  {
    // 声明行的正则**行首锚定**:正文里提到这一串(解释格式的那句话)不得被读成声明。
    // 少了这条,只要文档里出现一次格式说明,声明数就变成 2,而 declaration-ambiguous 会恒红。
    name: "正文里提到声明标签不算声明(行首锚定)→ 零判红",
    judgeOnly: true,
    plan: `${BASE_PLAN}\n当前在跑的写法是整行以该标签开头,不是行内提及。\n`,
    expect: null,
  },
  {
    // 阶段表的自限定首格(`**T3**`)不补小节前缀:否则 `T3` 会被算成 `步序与泳道-T3`,
    // 而声明里写 T3 就对不上。这是 id 取法的回归守护。
    name: "阶段表行用自限定首格(T3)→ id 就是 T3(不被补前缀)",
    judgeOnly: true,
    plan: `${BASE_PLAN.replace(ANCHOR_STAGE_T3, "| **T3** | 搬迁 | 🔄 进行中 |")}\n当前在跑: T3\n`,
    expect: null,
  },
  {
    // 表中间有空行时,空行后的第一行**不得**被当成表头吃掉。PLAN.md 的 T3 子步表实测有两处空行
    // (第 71/73 行),而被吃掉的那一行正是带 🔄 的子步 5 —— 这是「静默漏掉目标行 ⇒ 对它恒绿」
    // 的唯一防线:只测「表里有没有 🔄」的实现在这条上会绿(它把目标行吃掉了)。
    name: "子步表中间有空行 → 空行后的 🔄 行仍被认出并判红",
    judgeOnly: true,
    plan: BASE_PLAN
      .replace(ANCHOR_LAST_DONE, `${ANCHOR_LAST_DONE}\n`)
      .replace(ANCHOR_PENDING, ANCHOR_PENDING.replace("⏸ 待做", "🔄 进行中")),
    expect: /declaration-missing:检出 1 个标记为进行中\(🔄\)的子步\(T3-2\),但全文没有一行/,
  },
  {
    // 同一小节里两行剥出同一个 id ⇒ 「声明点名它」无法定位是哪一行,判红。
    name: "两行解析出同一个 id → 判红(duplicate-step-id)",
    judgeOnly: true,
    plan: addSubstepRow("2", "✅ 已完成"),
    expect: /duplicate-step-id:T3-2 在第 \d+ 行与第 \d+ 行各出现一次/,
  },
  {
    // 首格是整句话的表(`修复项复测`)不得贡献子步行 —— 否则那些句子会被当成子步,
    // 于是「声明点名它」会走进 declared-not-in-progress 而不是 declared-unknown-step。
    name: "首格是整句话的表不贡献子步行",
    judgeOnly: true,
    plan: withDeclaration("verify:ci"),
    expect: /declared-unknown-step:声明点名了 verify:ci,但 docs\/PLAN\.md 里没有这个子步/,
  },
  {
    // 防「扫不到东西所以恒绿」:表格形态一改(首格不再形如 id)就可能一行都认不出,
    // 而对读判据在零扫描面下会「全绿」—— 恒绿是纯文本门禁最坏的失效形态。
    name: "扫描面塌缩(一行子步都认不出)→ 判红",
    judgeOnly: true,
    plan: "## 步序与泳道\n\n这里没有任何表格,只有散文。\n",
    minStepRows: 3,
    expect: /scan-surface-collapsed:只认出 0 个子步行\(下限 3\)/,
  },
  {
    // 载体读不到时判红,而不是按「零进行中」放过 —— 那正是本门禁要堵的那一格。
    name: "载体读不到 → 判红(不是按「零进行中」放过)",
    judgeOnly: true,
    readThrows: true,
    expect: /carrier-unreadable:docs\/PLAN\.md 读不到载体/,
  },
  // ---- 进程级档(cwd 指夹具根,argv[1] 指仓内本体;顺带覆盖入口守卫与参数面) ----
  {
    name: "进程级:判定不成立时 exit 1 且输出点名子步",
    cli: true,
    plan: markInProgress(),
    args: [],
    expectCode: 1,
    expect: /declaration-missing:.*T3-2/,
  },
  {
    name: "进程级:对读成立时 exit 0",
    cli: true,
    plan: `${markInProgress()}\n当前在跑: T3-2\n`,
    args: [],
    expectCode: 0,
    expect: /\[ok\] PLAN 状态与「当前在跑」对读通过/,
  },
  {
    name: "进程级:未知参数(不得静默按默认跑一遍)",
    cli: true,
    plan: BASE_PLAN,
    args: ["--oops"],
    expectCode: 1,
    expect: /无法识别的选项:--oops/,
  },
  {
    name: "进程级:--help 出口 0 并给出声明写法",
    cli: true,
    plan: BASE_PLAN,
    args: ["--help"],
    expectCode: 0,
    expect: /当前在跑: T3-6/,
  },
  {
    name: "真实仓库(只读):不抛错、判红项全在已登记代号集合内、计数自洽",
    realRepo: true,
  },
];

/**
 * 已知判红代号全集(真实仓库那条夹具用它兜住「门禁自己改坏时冒出一个没登记过的失败形态」)。
 *
 * 为什么代号写在夹具里而不是从门禁导出:导出会让「门禁新增一条代号」这件事**自动**通过这条夹具,
 * 于是这条夹具只能证明「没抛异常」而证明不了「失败形态没变过」。逐条登记才有那道约束 ——
 * 与本仓 `check-src-layout` 判红面「白名单未登记即红」同一取向。
 * @type {readonly string[]}
 */
const KNOWN_CODES = Object.freeze([
  "carrier-unreadable",
  "scan-surface-collapsed",
  "duplicate-step-id",
  "declaration-missing",
  "declaration-ambiguous",
  "declaration-empty",
  "declaration-none-contradicted",
  "undeclared-in-progress",
  "declared-not-in-progress",
  "declared-unknown-step",
  "declared-duplicate",
]);

/**
 * 真实仓库那条:只读,断言不变量而非具体结论。
 * @returns {string[]} 失败描述(空数组 = 通过)
 */
function checkRealRepo() {
  const { problems, stats } = checkPlanInProgress();
  /** @type {string[]} */
  const notes = [];
  const codes = problems.map((item) => (item.split(":")[0] ?? "?").trim());
  const unknown = [...new Set(codes.filter((code) => !KNOWN_CODES.includes(code)))];
  if (unknown.length > 0) {
    notes.push(`真实仓库出现了未登记的判红代号:${unknown.join(", ")}(门禁自己改坏时这条会先红)`);
  }
  if (stats.stepRows < 3) {
    notes.push(`真实仓库只认出 ${stats.stepRows} 个子步行 —— 扫描面塌缩,判据对真实载体无效`);
  }
  if (stats.inProgress > stats.stepRows) {
    notes.push(`真实仓库的进行中计数 ${stats.inProgress} 超过子步行总数 ${stats.stepRows}`);
  }
  if (stats.declaredLines > 1) {
    notes.push(`真实仓库有 ${stats.declaredLines} 行声明(只能有一行)`);
  }
  if (notes.length === 0) {
    console.log(
      `[ok] plan-in-progress-selftest:真实仓库(只读):子步行 ${stats.stepRows} / 进行中 ${stats.inProgress}`
      + ` / 声明行 ${stats.declaredLines} / 判红 ${problems.length} 项,代号全部已登记`,
    );
  }
  return notes;
}

/** @type {string[]} */
const failures = [];
for (const testCase of CASES) {
  try {
    if (testCase.realRepo === true) {
      failures.push(...checkRealRepo().map((note) => `${testCase.name}:${note}`));
      continue;
    }

    if (testCase.judgeOnly === true) {
      const { problems, stats } = testCase.readThrows === true
        ? checkPlanInProgress({ readText: () => { throw new Error("夹具:载体不存在"); }, minStepRows: 0 })
        : judge(/** @type {string} */ (testCase.plan), { minStepRows: testCase.minStepRows });
      const joined = problems.join("\n");
      const statsText = `stats=${JSON.stringify(stats)}`;
      if (testCase.expect === null) {
        if (problems.length === 0) {
          console.log(`[ok] plan-in-progress-selftest:${testCase.name}(零判红 / ${statsText})`);
        } else {
          failures.push(`${testCase.name}:期望零判红,实际 ${problems.length} 条\n${joined}`);
        }
        continue;
      }
      if (testCase.expect.test(joined)) {
        console.log(`[ok] plan-in-progress-selftest:${testCase.name}(漂移被拦截 / ${statsText})`);
      } else {
        failures.push(`${testCase.name}:期望判红项匹配 ${testCase.expect},实际\n${joined || "(零判红)"}`);
      }
      continue;
    }

    // 进程级档:真实仓库那条只读,其余在合成目录里以 cwd 指夹具跑仓内真脚本
    const run = runChecker(/** @type {string} */ (testCase.plan), testCase.args ?? []);
    if (run.code !== testCase.expectCode || !(/** @type {RegExp} */ (testCase.expect)).test(run.output)) {
      failures.push(
        `${testCase.name}:期望 exit=${testCase.expectCode} 且输出匹配 ${testCase.expect},`
        + `实际 exit=${String(run.code)}\n${run.output}`,
      );
      continue;
    }
    console.log(`[ok] plan-in-progress-selftest:${testCase.name}(exit ${String(run.code)})`);
  } catch (error) {
    // 一条夹具的构造/求值抛异常只登记,不让它打断整批(否则后面的夹具一条都跑不到,
    // 报告里也看不出是哪一条坏了)
    failures.push(
      `${testCase.name}:抛异常:${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[plan-in-progress-selftest:fail] ${failure}`);
  console.error(`[plan-in-progress-selftest:fail] PLAN 对读门禁回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] plan-in-progress-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);