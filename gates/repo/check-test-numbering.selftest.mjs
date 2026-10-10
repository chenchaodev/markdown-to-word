// 测试树规划编号门禁自身的回归守护(负向夹具)。
//
// check-test-numbering.mjs 是 verify:ci 链上的一道自检门禁:若词法判定被改坏
// (字符串字面量抽不出来 / 字母表被清空 / 排除目录被删)、或白名单被扩成「整文件放行」,
// 本脚本会打印 `[ok]` 而规划编号照旧长在测试树里。此处用临时夹具逐条制造这些漂移,
// 断言门禁确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体,也不复制它**:夹具 = 临时目录里的一棵最小测试树。纯函数档
// 直接 import 判定本体 `analyze({ root })` 并注入合成根(ADR-074 决定二:判定本体拆出注入面
// 之后,夹具验的就是真规则本身,而不是「进程跑一遍」这种间接证据);进程级档靠 cwd 指夹具根
// 跑仓内真脚本 —— 项目根单一来源是 shared/paths.js 的 process.cwd(),而 ESM 静态 import 按
// **文件位置**解析、与 cwd 无关,所以真脚本的仓内依赖(shared/paths.js、
// shared/test-common-surface.js)天然可达,沙盒里不需要再放一份。
// 真实仓库只被**读**(baseline 那一条跑真实 test/ 树)。
//
// 每条负向夹具须命中一个真实历史缺陷或现实漂移形态,而非人造噪声。
//
// ---- 形态:一张合成根用例表 + 留在原处的 bespoke case(ADR-068 / ADR-074)----
//
// 进表的是**判红档**:输入是「按 shape 铺出来的最小测试树」,输出是问题清单,一族形态一致。
// 表行只放纯数据(仓库相对 POSIX 路径 → 正文 + 期望问题清单正则);期望正则**不带
// `[numbering:fail] ` 前缀** —— 那是 main 打印时才加的,判定本体给出的 `hit.message` 本体
// 形如 `test/core/case-0.test.js:1 → B3 → 「throw new Error('B3 断言失败:…')」`。
//
// 表内 judge 除 `analyze` 的编号命中外,还把**扫描面三判据**(等式 / 镜像 / 下限)并进问题
// 清单,顺序与 main 的判定顺序一致(main 判红即返回,故三者任一成立时走不到编号命中那一段)：
// 三项判定的真源在 `shared/test-common-surface.js`(注入 root 即可复用,不在本文件复制一份),
// 此处只拼上 main 打印时用的前缀段;后缀段(修法提示)是 main 的呈现细节,不进问题清单,
// 故表的期望正则一律不依赖它。
//
// 不进表的两族,理由逐条写在各自的组注里:判绿档(harness 的表结构表达不了「零问题」这一格)
// 与进程级档(退出码 + 合并输出,不是「问题清单」)。

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { assert, createCaseSuite } from '../../shared/case.js';
import { runSyntheticRootCases, withSyntheticRoot } from '../../shared/gate-selftest-harness.mjs';
import { ROOT } from '../../shared/paths.js';
import {
  SEGMENT_DIRS,
  checkSegmentMirrors,
  checkSurfaceEquality,
  formatMirrorMismatch,
  formatSurfaceMismatch,
  judgeScanFloor,
} from '../../shared/test-common-surface.js';
import { analyze } from './check-test-numbering.mjs';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'gates', 'repo', 'check-test-numbering.mjs');

/** 干净底板内容:不含任何规划编号字面量 */
const CLEAN = "export const value = 'clean';\n";

/**
 * 夹具的扫描面底板:四个目标目录各若干文件,合计 54(下限 50,留四个余量)。
 * 目录全部必须存在(等式判据与 walker 都按目录走,缺目录测不到任何判定)。
 * 段目录的配额随第五个目标目录(段目录之外的杂物抽屉,已取消)重分配到 core 与 gates
 * (按实测的 58 : 17 段数比),
 * main / renderer / common 保持原值 —— common 是等式之外唯一的非段目录,配额压太低
 * 会让「walker 整体失效」那条负向夹具的前提变得不可靠。
 */
const BASE_SHAPE = Object.freeze({
  'test/core': 21,
  'test/main': 11,
  'test/renderer': 11,
  'test/gates': 5,
  // 新增测试段目录时必须同时补两处:shared/test-common-surface.js 的 SEGMENT_DIRS
  // (声明面)与本形状(实测面)。漏后者则夹具里该目录被声明却无文件,等式判据恒红,
  // 且级联成「每条夹具都失败」——症状离根因很远。
  'test/convert': 1,
  'test/cli': 2,
  'test/mcp': 1,
  'test/harness': 6,
  'test/shared': 2,
  'test/behavior': 2,
});

/**
 * 段目录里**不要求镜像顶层树**的那两个(`NON_MIRROR_SEGMENT_DIRS`,该表未导出):`behavior`
 * 与 `harness`。它们豁免的是「必须镜像」这条义务,故底板不给它们造顶层树。
 *
 * 名字在这里写死而不是从 import 取,是因为它是**豁免**语义而非派生语义,且两侧出错的方向
 * 不对称:少写一个 ⇒ 该夹具多一条镜像判红(看得见);多写一个 ⇒ 少一条镜像判红(看不见)
 * ⇒ 从严,只列确知豁免的那两个。
 */
const MIRROR_EXEMPT_SEGMENTS = Object.freeze(['behavior', 'harness']);

/**
 * 段目录镜像判据的**顶层被断言树**:合成根里必须真有一棵同名树,否则该判据对**每一条**夹具
 * 都判红 —— 那是「每条夹具都失败」这种症状离根因极远的形态(与 BASE_SHAPE 的段数注释同理)。
 *
 * 镜像判据只看**目录名**(collectMirrorCandidateNames 收顶层目录名 + 其子目录名),不看内容,
 * 故每个树只放一个标记文件 —— 而「一个文件」是这个合成根里让目录存在的唯一手段(harness
 * 不预建空目录,见其头注⑤)。`src/<name>/` 是真实仓里 core/main/renderer/convert/cli/mcp
 * 的位置;gates 与 shared 也走同一形态(src/gates、src/shared),镜像判据因此同口径满足。
 */
const MIRROR_TREES = Object.freeze(
  Object.fromEntries(
    SEGMENT_DIRS
      .filter((name) => !MIRROR_EXEMPT_SEGMENTS.includes(name))
      .map((name) => [`src/${name}/mirror.ts`, CLEAN]),
  ),
);

/**
 * 按 shape 铺一棵测试树 + 镜像顶层树,收成**纯数据**(模块加载期求值,表里只 spread 结果)。
 * 手抄 54 个条目不可能也不该做,而「把底板改成回调传进表」是 ADR-068 明文否决的那条路。
 * @param {Readonly<Record<string, number>>} shape 目标目录 → 文件数
 * @returns {Readonly<Record<string, string>>} 仓库相对 POSIX 路径 → 正文
 */
const treeOf = (shape) => Object.freeze({
  ...Object.fromEntries(
    Object.entries(shape).flatMap(([target, count]) => {
      const ext = target === 'test/harness' ? '.js' : '.test.js';
      return Array.from({ length: count }, (_, i) => [`${target}/case-${i}${ext}`, CLEAN]);
    }),
  ),
  ...MIRROR_TREES,
});

/** 底板文件树(未漂移的合成仓:测试树按 BASE_SHAPE + 每棵顶层被断言树一个标记) */
const BASE_FILES = treeOf(BASE_SHAPE);

/**
 * 「扫描面塌缩」那条的形状:合成文件 10(段目录与 common 各自的 shape 计数),远低于下限 50。
 * 期望写成与具体数字无关的形态(下限判据只承诺「低于下限即红」,不承诺某个夹具形状恰好是
 * 几 —— 门禁多带一个依赖进来时,这条断言不该跟着改)。
 */
const COLLAPSED_SHAPE = Object.freeze({
  'test/core': 4, 'test/main': 2, 'test/renderer': 2, 'test/gates': 1, 'test/convert': 1,
  'test/cli': 2, 'test/mcp': 1, 'test/harness': 1, 'test/shared': 1, 'test/behavior': 1,
});

/**
 * 表内 judge:合成根 → 问题清单(编号命中 + 扫描面三判据,顺序同 main)。
 * @param {string} root 合成根绝对路径
 * @returns {string[]} 问题清单
 */
const judge = (root) => {
  /** @type {string[]} */
  const problems = [];
  const surface = checkSurfaceEquality(root);
  if (!surface.ok) problems.push(`扫描面等式不成立:${formatSurfaceMismatch(surface)}`);
  const mirror = checkSegmentMirrors(root);
  if (!mirror.ok) problems.push(`段目录镜像判据不成立:${formatMirrorMismatch(mirror)}`);
  const result = analyze({ root });
  const floor = judgeScanFloor(result.files);
  if (!floor.ok) problems.push(floor.text);
  problems.push(...result.problems.map((hit) => hit.message));
  return problems;
};

/**
 * 进程级档:以指定 cwd 跑仓内门禁本体。**cwd 即求值根**(shared/paths.js 的 ROOT =
 * process.cwd()),所以这一句同时是「换根」与「不换脚本」—— 夹具里因此不需要、也不该放一份
 * 门禁副本。
 * @param {string} cwd 工作目录
 * @param {string[]} args 传给门禁的参数
 * @returns {{ code: number | null, output: string }} 退出码与合并输出
 */
function runAt(cwd, args) {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * 在合成目录上跑门禁 CLI(进程级档)。造树与清理由 harness 的 withSyntheticRoot 承担(清理在
 * finally,中途断言失败抛异常时同样要删)。
 * @param {Record<string, string>} files 假仓库树(仓库相对 POSIX 路径 → 正文)
 * @param {string[]} [args] 传给门禁的参数
 * @returns {Promise<{ code: number | null, output: string }>}
 */
function runChecker(files, args = []) {
  return withSyntheticRoot(files, (root) => runAt(root, args));
}

const suite = createCaseSuite();

// =====================================================================================
// 表一:判红档(判据收注入的树、输出是问题清单 —— 这一族形态一致,进表)
// =====================================================================================

/** @type {import("../../shared/gate-selftest-harness.mjs").SyntheticRootCase[]} */
const JUDGE_CASES = [
  {
    name: '断言消息里泄漏规划编号 B3',
    files: { ...BASE_FILES, 'test/core/case-0.test.js': "throw new Error('B3 断言失败:档位映射');\n" },
    expect: /test\/core\/case-0\.test\.js:1 → B3 →/,
  },
  {
    name: '中文批次形态(批次9 断言失败)',
    files: { ...BASE_FILES, 'test/core/case-1.test.js': "throw new Error('批次9断言失败:脚手架');\n" },
    expect: /test\/core\/case-1\.test\.js:1 → 批次9 →/,
  },
  {
    name: 'OPT 类编号泄漏(带小数段形态)',
    files: { ...BASE_FILES, 'test/main/case-0.test.js': "const tag = 'OPT-2.1 待办';\n" },
    expect: /→ OPT-2\.1 →/,
  },
  {
    name: 'D-数字段形态编号泄漏(带连字符那一族)',
    files: { ...BASE_FILES, 'test/renderer/case-0.test.js': "throw new Error('D-02 排版未收口');\n" },
    expect: /→ D-02 →/,
  },
  {
    // 扫描面**等式**的负向夹具:磁盘上多出一个未登记的测试子目录。文件数仍在下限之上,
    // 所以这条判红只可能来自等式 —— 它正是「下限替代不了等式」的端到端实证。
    name: '扫描面多出一个未登记的测试子目录(等式判红并点名)',
    files: { ...BASE_FILES, 'test/perf/case-0.test.js': CLEAN },
    expect: /扫描面等式不成立:.*多出\(磁盘上有测试源文件但未登记进扫描面\):test\/perf/,
  },
  {
    // 段目录**镜像**判据的负向夹具:抽掉顶层的 renderer/ 这棵树(test/renderer 仍在,
    // 文件数与等式都照常满足)⇒ 只有镜像判据拦得住。这条证明该判据不是恒绿装饰。
    // 纯数据形态 = 底板去掉那一个标记文件(它就是「src/renderer/ 这棵树」在合成根里的全部)。
    name: '段目录不镜像任何顶层树(镜像判红并点名)',
    files: Object.fromEntries(
      Object.entries(BASE_FILES).filter(([rel]) => rel !== 'src/renderer/mirror.ts'),
    ),
    expect: /段目录镜像判据不成立:.*test\/renderer\(顶层没有可镜像的 renderer\//,
  },
  {
    // 防空过:walker 静默失效会退化成「零文件全过」,那是假通过。
    name: '扫描面塌缩(文件数掉到下限以下)',
    files: treeOf(COLLAPSED_SHAPE),
    expect: /只扫到 \d+ 个文件\(下限 50\):扫描面或 walker 失效/,
  },
];

// -------------------------------------------------------------------------------------
// bespoke case:留在原处的那些(不进表),理由逐组写在组注里
// -------------------------------------------------------------------------------------

/**
 * 组一 · 判绿档(**不进表**):断言的是**零问题**,而 harness 的表结构表达不了这一格 ——
 * `expect` 必须非空(空表行恒绿、判红信息为零),且恒绿防护把「零问题」判成失败。
 * 这正是 harness 头注里写明的「要断『零问题』请写 bespoke case」。
 * 五条反向锚点全在这一组:判绿档若整体失效,上面那一整组负向夹具的「红」就失去意义。
 */
const JUDGE_GREEN_CASES = Object.freeze([
  {
    name: '夹具基线未漂移 → 通过',
    files: {},
  },
  {
    // 反向锚点三条:门禁的判定输入是「字符串字面量」,越界即误报;真误报会逼人改门禁
    name: '注释里的编号(场景标签)不报 → 通过',
    files: { 'test/core/case-2.test.js': "// 场景 B1:单文件,场景 B2:多文件\nexport const n = 1;\n" },
  },
  {
    name: '排除目录 samples 里的编号不报 → 通过',
    files: { 'samples/manual/plan.test.js': "export const note = 'D-02 手工清单';\n" },
  },
  {
    name: 'A 族不在字母表(纸张规格 A1/A8 不报)→ 通过',
    files: { 'test/main/case-1.test.js': "const size = 'A4';\nexport default size;\n" },
  },
  {
    name: '白名单:paper 语义的 B5 是纸型不是编号 → 通过',
    files: { 'test/main/settings.test.js': "export const o = { paper: 'B5' };\n" },
  },
]);

/**
 * 组二 · 进程级档(**不进表**):断言的是**退出码 + 合并输出**,不是「问题清单」——
 * harness 的 judge 契约是 `(合成根) => string[]`,把退出码塞进返回数组就是把「问题清单」
 * 那一格撑成通用返回通道(ADR-074 后果节的半齿纪律:期望必须在表里,才谈得上「删一条会留痕」;
 * 这一族一旦改成表,退出码的期望就会离开表)。
 */
const CLI_CASES = Object.freeze([
  {
    // unknown-arg 那条不注入任何树:它判的是 argv 解析,而 argv 解析发生在**任何读盘之前**
    // —— 铺不铺底板,输出都该是同一句「无法识别的参数」。
    name: '未知参数(不得静默按默认扫描面跑一遍报绿)',
    files: { ...BASE_FILES },
    args: ['oops'],
    expectCode: 1,
    expect: /无法识别的参数:oops/,
  },
  {
    // 正向对照:真实仓库只被读。判红面是**当前事实**,故断言写成「exit 0」而不是写死条数 ——
    // 写死会在下一个人新增一条带编号的断言消息时变成一条自己把自己判红的夹具。
    // **不进表**:读的是真实仓而不是注入面,harness 的 judge 只拿得到合成根。
    name: '真实仓库当前未漂移 → 通过',
    realRepo: true,
    expectCode: 0,
    expect: null,
  },
]);

// -------------------------------------------------------------------------------------
// 跑:表内用例走 harness(它自己建树、跑判定、比对、汇成 case),bespoke 逐条 suite.case。
// -------------------------------------------------------------------------------------

await runSyntheticRootCases({
  group: '判红档(合成根 · 编号与扫描面)',
  judge,
  cases: JUDGE_CASES,
  suite,
});

// ---- bespoke:判绿档(零问题,harness 的表结构表达不了这一格) ----
await suite.describe('判绿档(bespoke · 零问题)', async () => {
  for (const testCase of JUDGE_GREEN_CASES) {
    await suite.case(testCase.name, async () => {
      const problems = await withSyntheticRoot({ ...BASE_FILES, ...testCase.files }, (root) => judge(root));
      assert(
        problems.length === 0,
        `期望零判红,实际 ${String(problems.length)} 条:${problems.join('\n')}`,
      );
    });
  }
});

// ---- bespoke:进程级档(退出码 + 合并输出,不是「问题清单」) ----
await suite.describe('进程级档(bespoke · 退出码与输出)', async () => {
  for (const testCase of CLI_CASES) {
    await suite.case(testCase.name, async () => {
      const run = testCase.realRepo === true
        ? runAt(projectRoot, [])
        : await runChecker(testCase.files, testCase.args ?? []);
      assert(
        run.code === testCase.expectCode,
        `期望 exit=${String(testCase.expectCode)},实际 exit=${String(run.code)}\n${run.output}`,
      );
      // 恒绿防护的等价物:判红档要求「退出码非零**且**输出命中」;判绿档只要求退出码为零。
      assert(
        testCase.expect === null || testCase.expect.test(run.output),
        `期望输出匹配 ${String(testCase.expect)},实际 exit=${String(run.code)}\n${run.output}`,
      );
    });
  }
});

// -------------------------------------------------------------------------------------
// 汇总:段级成败按 case 结果判(与旧实现的 failures[] 判定等价:任一 case 失败即非零退出)。
// -------------------------------------------------------------------------------------

const cases = suite.results;
const failures = suite.failures;
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[test-numbering-selftest:fail] ${failure.name}:${failure.message ?? '(无失败消息)'}`);
  }
  console.error(
    `[test-numbering-selftest:fail] 规划编号门禁回归守护失败,共 ${String(failures.length)}/${String(cases.length)} 条`,
  );
  process.exit(1);
}
console.log(`[ok] test-numbering-selftest:${String(cases.length)} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);
