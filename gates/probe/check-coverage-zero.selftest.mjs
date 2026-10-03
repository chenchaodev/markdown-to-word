// 覆盖率零覆盖面门禁(coverage-gate.mjs --zero)自身的回归守护(负向夹具)。
//
// `npm run check:coverage-zero` 是 verify:ci 链里**唯一**执行者只有一处的那道动态面:
// c8 的 json-summary 与 gates/probe/gate-probes/coverage-baseline.json 的零覆盖模块清单必须一致。
// 它的失效形态全是「静默放宽」——`--all` 打开后全局百分比会把「清单外的新 0% 文件」按体量
// 摊薄(一个 20 行的新死代码在 ~1.8 万条语句里只值 0.1pp),而这道门禁正是为堵这个洞而存在。
// 若它被改成恒绿(判据写错 / 集合比较反了 / 豁免失效方向漏了),没有任何其他检查能发现:
// c8 自己只看四个阈值,而 c8 的 --per-file 实测不可用(94 个文件里 33 个低于阈值)。
//
// 第二类恒绿形态是「基线能解析但结构损坏」:结构诊断由 loadBaseline 独家产出,而动态面此前
// 只在基线**整个读不出来**时回传它 —— 于是手改坏基线(字段改名 / 类型改成字符串 / 整段删掉)
// 时 `--zero` 照常判绿,完整诊断只落在 `--static` / `--all` 面上,而那两面不在任何 npm script
// 里。夹具对此有三格:两种漂移形态各一条负向 + 一条「结构合法但阈值数值越界仍判绿」的反向
// 锚点(证明红的是「结构不对」,不是「动过基线就红」)。
//
// 夹具口径(**刻意不复制门禁本体**):
//   - 判定面用 `auditZeroFiles(root)` 直调 —— 它就是 CLI 的全部判定内容(main() 只做
//     「打印 + 按 problems.length 出 0/1」),且 root 是入参,合成 coverage JSON 与基线
//     可以整棵树放在系统临时目录里造。
//   - **不使用 copyFileSync**:凡是把仓内文件逐字节复制进沙盒的调用点,都在
//     gates/repo/check-copy-sites.mjs 的 COPY_SITE_WHITELIST 里登记(按**文件**登记,
//     出现未登记的复制原语即判红)。新增复制点必须同步那张表,而 test/** 不在本自检的
//     可写范围 ⇒ 走函数级夹具,不走复制夹具。
//   - 真实仓库只被**读**:末尾一条用例把真门禁当子进程跑一遍,验 CLI 适配层(参数路由 →
//     动态面 → 退出码 → 诊断行)在真实数据上的表现。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则系统
// 临时区会堆满夹具树。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../shared/paths.js';
import { auditZeroFiles, BASELINE_RELATIVE, SUMMARY_RELATIVE } from './gate-probes/coverage-gate.mjs';

const projectRoot = ROOT;
const gatePath = join(projectRoot, 'gates', 'probe', 'gate-probes', 'coverage-gate.mjs');

/**
 * SUMMARY_RELATIVE 派生的正则片段:夹具的期望文案要断言的就是这个路径。
 *
 * 为什么从常量派生而不写死字面量:门禁的产物落点是本仓显式约定(`test:coverage` 的
 * `--reports-dir` + `SUMMARY_RELATIVE`,两侧一致性由静态面判红),把它在这里抄第二份
 * 就等于造一处「会静默过期且无人判红」的文本 —— 落点一改,这些夹具会因为匹配不到而
 * **假红**(报「门禁在此形态上恒绿了」,而门禁其实只是换了路径)。派生即自动跟随。
 * 位置在 CASES 之前:CASES 里的 `expect` 是模块加载期求值的,声明晚了会撞 TDZ。
 */
const SUMMARY_PATTERN = SUMMARY_RELATIVE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 合成基线:结构必须过 loadBaseline 的全部校验(否则夹具会因「基线不成形」判红,而不是因
 * 被注入的 0% 形态判红 —— 那会让负向夹具测不到任何东西)。字段值一律无关紧要:动态面只读
 * `exemptions[].file`,阈值段在这里只是「不让结构校验先炸」的填充。
 */
const FIXTURE_BASELINE = {
  baselineSchema: 1,
  note: ['合成基线:仅供本自检的动态面夹具使用,不对应真实仓库的任何阈值或豁免。'],
  headroomPp: 4,
  floor: { statements: 85, branches: 80, functions: 85, lines: 85 },
  measured: { statements: 93, branches: 88, functions: 93, lines: 93 },
  thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
  requireFlags: ['--all', '--check-coverage'],
  requireExcludesInFlag: false,
  exemptions: [
    {
      file: 'src/core/empty.ts',
      category: 'empty-module',
      reason: '合成豁免:纯类型模块,编译产物只有 export {};,夹具用来占住「已登记的 0% 文件」这一格。',
    },
    {
      file: 'src/main/entry.ts',
      category: 'runtime-entry',
      reason: '合成豁免:运行时入口,import 即触发启动副作用,夹具用来占住「豁免失效方向」这一格。',
    },
  ],
};

/**
 * 造一条 c8 json-summary 的文件条目(键用夹具根下的绝对路径,与 c8 真实产物同形态)。
 * @param {string} root 夹具根
 * @param {string} rel 仓库相对路径
 * @param {Record<string, [number, number]>} counts 指标名 → [covered, total]
 * @returns {Record<string, unknown>} summary 条目
 */
function summaryEntry(root, rel, counts) {
  /** @type {Record<string, unknown>} */
  const metrics = {};
  for (const [name, [covered, total]] of Object.entries(counts)) {
    metrics[name] = { total, covered, skipped: 0, pct: total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)) };
  }
  return { [join(root, ...rel.split('/'))]: metrics };
}

/** 与真实 c8 json-summary 同形的 total 行(动态面跳过它,只用来让夹具不显得残缺) */
const FIXTURE_TOTAL = {
  total: {
    lines: { total: 18453, covered: 17185, skipped: 0, pct: 93.12 },
    statements: { total: 18453, covered: 17185, skipped: 0, pct: 93.12 },
    functions: { total: 602, covered: 560, skipped: 0, pct: 93.02 },
    branches: { total: 3227, covered: 2859, skipped: 0, pct: 88.59 },
  },
};

/**
 * 造夹具:整棵产物目录(SUMMARY_RELATIVE 那棵树)+ 基线都落在系统临时目录;再由 mutate
 * 打上待判形态。
 * @param {(dir: string) => void} mutate 注入漂移(抛异常时本函数自己清理后重抛)
 * @returns {string} 夹具根
 */
function createFixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-coverage-zero-selftest-'));
  try {
    mkdirSync(join(dir, ...BASELINE_RELATIVE.split('/').slice(0, -1)), { recursive: true });
    mkdirSync(join(dir, ...SUMMARY_RELATIVE.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...BASELINE_RELATIVE.split('/')), `${JSON.stringify(FIXTURE_BASELINE, null, 2)}\n`, 'utf8');
    writeFileIn(dir, SUMMARY_RELATIVE, { ...FIXTURE_TOTAL });
    mutate(dir);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return dir;
}

/**
 * 写夹具内的文件(JSON 自动序列化)。
 * @param {string} dir 夹具根
 * @param {string} relative 仓库相对 POSIX 路径
 * @param {unknown} content 字符串或可 JSON 序列化的值
 * @returns {void}
 */
function writeFileIn(dir, relative, content) {
  const target = join(dir, ...relative.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, 'utf8');
}

/** 「已登记豁免的 0% 文件」:两条豁免各一条,外加一条已覆盖文件 —— 判红时不该红 */
function writeConsistentSummary(dir) {
  writeFileIn(dir, SUMMARY_RELATIVE, {
    ...summaryEntry(dir, 'src/core/empty.ts', { statements: [0, 186], functions: [0, 1], branches: [0, 0], lines: [0, 186] }),
    ...summaryEntry(dir, 'src/main/entry.ts', { statements: [0, 83], functions: [0, 6], branches: [0, 12], lines: [0, 83] }),
    ...summaryEntry(dir, 'src/core/math.ts', { statements: [40, 42], functions: [6, 6], branches: [9, 10], lines: [40, 42] }),
    ...FIXTURE_TOTAL,
  });
}

/**
 * 覆写夹具基线,在副本上注入改动(原 FIXTURE_BASELINE 不被就地改写,多条用例可并存)。
 *
 * 本文件里它的主用途是注入「能 JSON.parse 但结构损坏」的漂移,这类漂移的失效形态是**静默
 * 放宽**:loadBaseline 的结构诊断(逐条指名哪个字段不对)此前在 auditZeroFiles 里只在
 * `baseline === null` 时才被回传,于是「字段被改」这一整类(手改基线 / 生成器改坏 schema)
 * 路径上 `--zero` 恒绿;完整诊断只在 `--static` / `--all` 面上可见,而那两面不在任何
 * npm script 里。mutate 保持结构完好的调用则是反向锚点(证明没有一律判红)。
 * @param {string} dir 夹具根
 * @param {(baseline: Record<string, any>) => void} mutate 在副本上改动
 * @returns {void}
 */
function rewriteBaseline(dir, mutate) {
  const next = structuredClone(FIXTURE_BASELINE);
  mutate(next);
  writeFileIn(dir, BASELINE_RELATIVE, next);
}

// 每条负向夹具须命中一个真实的静默放宽形态,而非人造噪声。
const CASES = [
  {
    name: '夹具基线一致(0% 文件全部已登记豁免)→ 通过',
    expect: null,
    create: () => createFixture(writeConsistentSummary),
  },
  {
    // 本门禁存在的全部理由:清单外的 0% 文件被全局百分比摊薄后无声无息。
    name: '清单外新增 0% 死代码 → 判红并点名该文件与 covered/total',
    expect: /0% 覆盖文件未登记豁免:src\/core\/new-dead\.ts\(statements 0\/12, functions 0\/3\)/,
    create: () =>
      createFixture((dir) => {
        writeConsistentSummary(dir);
        const merged = JSON.parse(readSummaryIn(dir));
        writeFileIn(dir, SUMMARY_RELATIVE, {
          ...merged,
          ...summaryEntry(dir, 'src/core/new-dead.ts', { statements: [0, 12], functions: [0, 3], branches: [0, 0], lines: [0, 12] }),
        });
      }),
  },
  {
    // 反向锚点:若 0% 判定只看 statements,「语句有覆盖但函数一个没跑到」这类文件会被放过
    name: '语句有覆盖但函数全未覆盖 → 仍判零覆盖并判红(两个方向都要算)',
    expect: /0% 覆盖文件未登记豁免:src\/core\/cold-fns\.ts\(statements 5\/5, functions 0\/2\)/,
    create: () =>
      createFixture((dir) => {
        writeConsistentSummary(dir);
        const merged = JSON.parse(readSummaryIn(dir));
        writeFileIn(dir, SUMMARY_RELATIVE, {
          ...merged,
          ...summaryEntry(dir, 'src/core/cold-fns.ts', { statements: [5, 5], functions: [0, 2], branches: [0, 0], lines: [5, 5] }),
        });
      }),
  },
  {
    // 反向锚点:0/0 的纯类型模块在 c8 口径下是「无可执行语句」,不是「零覆盖」。
    // 若判据写成 `covered === 0` 而漏掉 `total > 0`,每个空模块都会被当成待补测试的死代码。
    name: '0/0 文件(空模块)不计入零覆盖集合 → 通过',
    expect: null,
    create: () =>
      createFixture((dir) => {
        writeConsistentSummary(dir);
        const merged = JSON.parse(readSummaryIn(dir));
        writeFileIn(dir, SUMMARY_RELATIVE, {
          ...merged,
          ...summaryEntry(dir, 'src/core/types-only.ts', { statements: [0, 0], functions: [0, 0], branches: [0, 0], lines: [0, 0] }),
        });
      }),
  },
  {
    // 豁免失效方向:文件其实已被覆盖却仍留在清单里 = 永久盲区(清单成了免检通道)
    name: '豁免条目本次已被覆盖却仍留在清单里 → 判红(豁免失效,清单不得变成免检通道)',
    expect: /豁免条目 src\/core\/empty\.ts 本次已被覆盖却仍留在清单里/,
    create: () =>
      createFixture((dir) => {
        writeConsistentSummary(dir);
        const merged = JSON.parse(readSummaryIn(dir));
        // 同一条豁免的 0% 记录改成「已覆盖」:正向不再报未登记,反向必须报失效
        writeFileIn(dir, SUMMARY_RELATIVE, {
          ...merged,
          ...summaryEntry(dir, 'src/core/empty.ts', { statements: [186, 186], functions: [1, 1], branches: [0, 0], lines: [186, 186] }),
        });
      }),
  },
  {
    // 本门禁的前提:必须紧跟 test:coverage。数据源不在 ⇒ 判红并说清为什么(而不是当成「零个 0% 文件」)
    name: '未紧跟 test:coverage(缺 coverage-summary.json)→ 判红并点名数据源与前提',
    expect: new RegExp(`未找到 ${SUMMARY_PATTERN}\\(本检查必须紧跟 test:coverage 执行`),
    create: () => {
      const made = createFixture(writeConsistentSummary);
      rmSync(join(made, ...SUMMARY_RELATIVE.split('/')));
      // 目录仍在、文件不在 —— 与「整个产物目录都没生成」区分开
      mkdirSync(join(made, ...SUMMARY_RELATIVE.split('/').slice(0, -1)), { recursive: true });
      return made;
    },
  },
  {
    name: 'coverage-summary.json 不是合法 JSON → 判红并点名解析失败原因',
    expect: new RegExp(`${SUMMARY_PATTERN} 不是合法 JSON`),
    create: () => createFixture((dir) => writeFileIn(dir, SUMMARY_RELATIVE, '{ not json')),
  },
  {
    name: '基线文件不存在 → 判红(清单是单一登记处,缺它等于无人看守)',
    expect: /基线文件不存在:gates\/probe\/gate-probes\/coverage-baseline\.json/,
    create: () => {
      const made = createFixture(writeConsistentSummary);
      rmSync(join(made, ...BASELINE_RELATIVE.split('/')));
      return made;
    },
  },
  {
    // 静默放宽(基线可解析、字段类型被改):loadBaseline 已指名 headroomPp 不是 ≥0 的数值,
    // 动态面必须把这条原文带出来。判红文案要指名字段,不是笼统的「基线损坏」——
    // 没人看得懂的诊断等于没有诊断,下一个人只会再改一次。
    name: '基线能解析但字段类型被改(headroomPp 成了字符串)→ 判红并点名该字段',
    expect: /基线结构损坏:headroomPp 必须是 ≥0 的数值/,
    create: () =>
      createFixture((dir) => {
        writeConsistentSummary(dir);
        rewriteBaseline(dir, (baseline) => {
          baseline.headroomPp = '4';
        });
      }),
  },
  {
    // 同一类漂移的另一种形态:整段被改名(不是类型错、不是缺值)。两个形态都要红 ——
    // 只挡住其中一种的「部分修复」仍然是恒绿退化。
    name: '基线能解析但整段被改名(thresholds → threshold)→ 判红并点名缺的段',
    expect: /基线结构损坏:基线缺 thresholds 段/,
    create: () =>
      createFixture((dir) => {
        writeConsistentSummary(dir);
        rewriteBaseline(dir, (baseline) => {
          baseline.threshold = baseline.thresholds;
          delete baseline.thresholds;
        });
      }),
  },
  {
    // 这一条的红不止一条:exemptions 不是数组时清单被读成空集,于是两条已登记的 0% 文件
    // 同时以「未登记豁免」的下游症状出现。结构诊断仍必须点名根因(exemptions 不是数组),
    // 否则修的人会去追 0% 文件、而真正的病因在基线里。
    name: '基线能解析但豁免清单不是数组 → 判红并点名根因(不只报下游的「未登记豁免」症状)',
    expect: /基线结构损坏:基线缺 exemptions 数组/,
    create: () =>
      createFixture((dir) => {
        writeConsistentSummary(dir);
        rewriteBaseline(dir, (baseline) => {
          baseline.exemptions = { 'src/core/empty.ts': 'empty-module' };
        });
      }),
  },
  {
    // 同格反向锚点:上面的红必须来自「结构不对」,而不是「只要动过基线就红」。这里把
    // 阈值压到远低于 floor、headroomPp 归零 —— 结构(类型/存在性)依然合法,越界的**数值**
    // 判据是静态面的判定义务(动态面读不到 package.json 参数向量,也不该读)。
    // 若这条红,说明结构诊断被换成了另一套判据,或被放宽成了「与基线不一致即红」。
    name: '反向锚点:基线结构合法但阈值数值越界(那是静态面的判定义务)→ 判绿',
    expect: null,
    create: () =>
      createFixture((dir) => {
        writeConsistentSummary(dir);
        rewriteBaseline(dir, (baseline) => {
          baseline.headroomPp = 0;
          baseline.thresholds = { statements: 0, branches: 0, functions: 0, lines: 0 };
        });
      }),
  },
  {
    // 面边界:静态面才有 dist/ 与 package.json 参数向量的判定义务;动态面跑在没有 dist 的
    // 夹具里也必须绿。若这条红,说明 `--zero` 被改成顺带跑静态面(或读 dist),两个面的职责混了。
    name: '夹具里没有 dist/ → 动态面不判红(--zero 不越界跑静态面)',
    expect: null,
    create: () => createFixture(writeConsistentSummary),
  },
];

/** 读回夹具内刚写下的 summary 原文(合并新条目时复用已写好的那批) */
function readSummaryIn(dir) {
  return readFileSync(join(dir, ...SUMMARY_RELATIVE.split('/')), 'utf8');
}

const failures = [];
for (const testCase of CASES) {
  /** @type {string | undefined} */
  let dir;
  try {
    dir = testCase.create();
    const result = auditZeroFiles(dir);
    const joined = result.problems.join('\n');
    if (testCase.expect === null) {
      if (result.problems.length === 0) {
        console.log(
          `[ok] coverage-zero-selftest:${testCase.name}(0% 集合 ${result.zeroFiles.length} 个,判定面通过)`,
        );
      } else {
        failures.push(`${testCase.name}:期望通过,实际 ${result.problems.length} 项问题\n${joined}`);
      }
      continue;
    }
    if (testCase.expect.test(joined)) {
      console.log(`[ok] coverage-zero-selftest:${testCase.name}(漂移被拦截,${result.problems.length} 项问题)`);
    } else {
      failures.push(`${testCase.name}:期望诊断匹配 ${testCase.expect},实际\n${joined || '(无任何诊断 —— 门禁在此形态上恒绿了)'}`);
    }
  } catch (error) {
    failures.push(`${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------- 真实仓库:CLI 适配层(参数路由 → 动态面 → 退出码 → 诊断行) ---------- */

/**
 * 把真门禁当子进程跑一遍。
 *
 * 期望值按数据源在不在分成两支,**两支都是确定性断言,没有「跳过」**:
 * 本门禁的契约就是「必须紧跟 test:coverage 执行」—— 数据在则判绿;数据不在则按契约判红
 * 并点名数据源缺失(干净检出里产物目录是 gitignore 的生成物,此时正是后一种)。
 */
function checkRealRepo() {
  const result = spawnSync(process.execPath, [gatePath, '--zero'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  const output = `${result.stdout}${result.stderr}`;
  if (existsSync(join(projectRoot, ...SUMMARY_RELATIVE.split('/')))) {
    const problems = [];
    if (result.status !== 0) problems.push(`期望 exit 0,实际 ${String(result.status)}`);
    if (!/动态面:0% 文件 \d+ 个/.test(output)) problems.push('缺动态面结论行(0% 文件计数与实测值)');
    if (!/覆盖率门禁基线自检通过/.test(output)) problems.push('缺通过结论行');
    if (problems.length > 0) return `真实仓库当前未漂移:${problems.join(';')}\n--- 输出 ---\n${output}`;
  } else {
    const problems = [];
    if (result.status === 0) problems.push(`数据源缺失却判绿(期望非 0),实际 ${String(result.status)}`);
    if (!new RegExp(`未找到 ${SUMMARY_PATTERN}`).test(output)) problems.push('未点名缺失的数据源');
    if (problems.length > 0) return `真实仓库无覆盖率数据:${problems.join(';')}\n--- 输出 ---\n${output}`;
  }
  return null;
}

const realProblem = checkRealRepo();
if (realProblem === null) {
  const dataState = existsSync(join(projectRoot, ...SUMMARY_RELATIVE.split('/'))) ? '有本次覆盖率数据' : '无(按契约判红并点名数据源)';
  console.log(`[ok] coverage-zero-selftest:真实仓库 CLI 适配层(${dataState})断言通过`);
} else {
  failures.push(realProblem);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[coverage-zero-selftest:fail] ${failure}`);
  console.error(`[coverage-zero-selftest:fail] 覆盖率零覆盖门禁回归守护失败,共 ${failures.length}/${CASES.length + 1} 条`);
  process.exit(1);
}
console.log(`[ok] coverage-zero-selftest:${CASES.length + 1} 条夹具全部符合预期(一致判绿 / 静默放宽被拦截且点名)`);