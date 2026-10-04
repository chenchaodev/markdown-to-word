// 构建新鲜度门禁(check-build-fresh.mjs)自身的回归守护(负向夹具)。
//
// 这道门禁只有一条判据:**src 树里最新的文件 mtime 晚于 dist 树里最新的那个** ⇒ 判红。
// 它的失效形态不是「恒红」而是**恒绿**:判定退化成一个从不成立的比较(两侧 max 恒等 /
// 只比顶层目录 mtime / 只看 dist 不看 src / 比较符写反成 `<`),它都会静默 exit 0,
// 而 `test:smoke` 于是用**旧产物**跑出一份看起来正常的冒烟结果 —— 没人会去看一个总是
// 通过的脚本。故此处逐条注入 mtime 漂移,断言判据确实以非零码拒绝,并断言撤销漂移后回到判绿。
//
// 形态(**判定本体与 CLI 分离**,与 gates/repo/check-src-layout.selftest.mjs 同款):
//   - 纯函数档直接 import 判定本体 `evaluateFreshness({ srcDir, distDir })` —— 它已经是
//     「路径进、问题数组出」的形状,**无需为可注入而改动门禁本体**(判定本体留在门禁旁边);
//   - 进程级档跑仓内真脚本本体,cwd 指合成树(项目根单一来源是 shared/paths.js 的
//     process.cwd();ESM 静态 import 按文件位置解析、与 cwd 无关,故真脚本的仓内依赖
//     天然可达,合成树里不需要也不该放一份 shared/)。合成树造在系统临时目录,
//     **真实工作树只被读**(进程级档的 cwd 从不指向它)。
//
// ⚠ 判定面的已知边界(**刻意不覆盖,避免把缺陷钉成契约**):
//   `evaluateFreshness` 对「src 目录不存在」返回零问题(collectMaxMtime 对不可读目录返回
//   null,而 srcMaxMtime === null 时那一族判据整体跳过)。真正挡住它的是 CLI 的
//   `existsSync(srcDir)` 前置守卫 —— 故「src 不存在」这一格只在**进程级档**断言(断言
//   exit 1 且诊断点名「源码目录不存在」),纯函数档刻意不钉它:那是 CLI 层的义务,
//   在纯函数层钉死会把「将来收紧了」误报成夹具漂移。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则系统
// 临时区会堆满夹具树。本脚本全部写操作都落在 mkdtemp 出来的目录里、**不碰真实工作树**,
// 因此 check:temp-cleanup 扫不到、也不该扫到它(该门禁刻意不扫 gates/:那里 rmSync 是
// 被测语义)。
//
// ⚠ 关于「诊断可归因」的如实记录:本门禁的诊断**不点名具体文件**(正文恒为
// 「构建产物过期(存在晚于 dist 的 src 改动),请先运行 npm run build」)。故归因由本脚本
// 自己建立:夹具知道**自己动了哪个文件**,并断言「动它 ⇒ 红;把它撤销 ⇒ 绿」。
// 想要「诊断里带出文件名」得改判定本体,不在本自测的范围内。

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../shared/paths.js';
import { evaluateFreshness } from './check-build-fresh.mjs';

const gatePath = join(ROOT, 'gates', 'smoke', 'check-build-fresh.mjs');

/**
 * 夹具用的三个固定时刻(epoch 秒,相隔 1 天)。
 *
 * 为什么用**显式时刻**而不是「现在」:判据是两侧 **max** mtime 的大小关系,而文件系统时间戳
 * 精度随卷而异(有些卷只到秒)。靠「先写 dist 再写 src」去蹭文件系统时钟,在这类卷上两条
 * 记录可能落在同一格里,夹具就会变成时好时坏的 flaky。钉死时刻把这一层不确定性彻底拿掉。
 * 相隔 1 天而不是 1 秒:留足余量,任何精度(哪怕秒级)下关系都成立。
 *
 * ⚠ 方向:合成树**默认 src 旧 / dist 新**(即「未漂移」),负向夹具把**某一个 src 文件前拨**
 * 到最晚时刻。为什么是「前拨单个文件」而不是「回拨单个文件」:判定取的是 max,回拨一个文件
 * 后**其余 src 文件仍比 dist 新**,漂移根本造不成(本脚本第一版就是这么写的,被自己的恒绿
 * 防护当场抓住 —— 那正是这道防护存在的理由)。
 */
const SRC_SECONDS = 1_700_000_000;
const DIST_SECONDS = SRC_SECONDS + 86_400;
const STALE_SECONDS = DIST_SECONDS + 86_400;

/** 合成树里铺的文件(相对树根的 POSIX 路径);含嵌套子目录,顺带覆盖 collectMaxMtime 的递归 */
const TREE_FILES = Object.freeze({
  'src/core/convert.ts': 'export const x = 1;\n',
  'src/core/nested/deep.ts': 'export const y = 2;\n',
  'dist/core/convert.js': 'exports.x = 1;\n',
  'dist/core/nested/deep.js': 'exports.y = 2;\n',
});

/** TREE_FILES 里属于 src / dist 的键前缀 */
const SRC_PREFIX = 'src/';
const DIST_PREFIX = 'dist/';

/**
 * 造一棵合成树:src 侧文件钉在 SRC_SECONDS、dist 侧钉在 DIST_SECONDS(即「产物比源码新」)。
 *
 * 恒绿防护:写完逐个回读 mtime —— 钉不住就抛异常。静默继续的后果是夹具「因为没造出故障」
 * 而全绿,那正是本脚本要拦的假通过。
 * @returns {string} 合成树根绝对路径
 */
function createTree() {
  const root = mkdtempSync(join(tmpdir(), 'm2w-build-fresh-selftest-'));
  try {
    for (const [rel, body] of Object.entries(TREE_FILES)) {
      const target = join(root, ...rel.split('/'));
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, body, 'utf8');
      const at = rel.startsWith(DIST_PREFIX) ? DIST_SECONDS : SRC_SECONDS;
      utimesSync(target, at, at);
      const actual = statSync(target).mtimeMs / 1000;
      // 容差 2 秒:覆盖 FAT(2 秒精度)这类粗粒度卷,又不至于宽到「漂移没造上」
      if (Math.abs(actual - at) > 2) {
        throw new Error(`故障注入失败:钉不住 ${rel} 的 mtime(期望 ≈${at},实测 ${actual})—— 夹具树不可信`);
      }
    }
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 把树里某个文件钉到指定时刻,并回读确认它真的成了「全树最新」的那一个。
 *
 * 恒绿防护的落点:钉完必须回读。若该文件没能新于 dist,max 仍取自别的文件,负向夹具就会
 * 因「故障没造成」而报「门禁恒绿」—— 那条报错会指向错误的根因。
 * @param {string} root 合成树根
 * @param {string} rel 相对树根的 POSIX 路径
 * @param {number} at 目标 mtime(epoch 秒)
 * @returns {void}
 */
function pinFile(root, rel, at) {
  const target = join(root, ...rel.split('/'));
  utimesSync(target, at, at);
  const actual = statSync(target).mtimeMs / 1000;
  const distMax = statSync(join(root, ...`${DIST_PREFIX}core/convert.js`.split('/'))).mtimeMs;
  if (Math.abs(actual - at) > 2 || statSync(target).mtimeMs <= distMax) {
    throw new Error(
      `故障注入失败:${rel} 的 mtime 未生效(期望 ≈${at} 且新于 dist 的 ${Math.round(distMax / 1000)})`
      + `,实测 ${actual} —— 夹具树不可信`,
    );
  }
}

/**
 * 在合成树上跑仓内门禁本体(cwd 即求值根;argv[1] 指仓内本体,两者恒不相等,入口守卫成立)。
 * @param {string} cwd 工作目录
 * @param {string[]} [args] 传给门禁的参数
 * @returns {{ code: number | null; output: string }}
 */
function runGate(cwd, args = []) {
  const result = spawnSync(process.execPath, [gatePath, ...args], { cwd, encoding: 'utf8', windowsHide: true });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/* ---------- 夹具表 ---------- */

// 纯函数档:合成树按 NEW(新)落盘,夹具再把某个文件回拨成 OLD(旧)来制造漂移。
// 「回拨」而不是「前拨」:回拨只需动一个文件,而前拨要重铺整棵树。
const PURE_CASES = [
  {
    name: '正向锚点:src 全部早于 dist → 零问题',
    stale: null,
    expect: null,
  },
  {
    // 本门禁存在的全部理由:改了 src 忘了 build,产物比源码旧。
    name: 'src 顶层文件晚于 dist → 判红且给出可执行指引',
    stale: 'src/core/convert.ts',
    expect: /存在晚于 dist 的 src 改动.*npm run build/,
  },
  {
    // 反向锚点(防「递归被摘掉」):只在**嵌套子目录**里的那个文件被改,一样必须判红。
    // 只覆盖顶层的话,把 walk 换成只读一层目录的实现也能全绿。
    name: 'src 嵌套子目录里的文件晚于 dist → 判红(递归不可被摘掉)',
    stale: 'src/core/nested/deep.ts',
    expect: /存在晚于 dist 的 src 改动/,
  },
  {
    name: 'dist 目录不存在 → 判红并要求先 build',
    removeDist: true,
    expect: /dist 为空或不存在.*npm run build/,
  },
  {
    name: 'dist 目录存在但为空 → 判红(与「不存在」同一格,不得只挡其中一种形态)',
    emptyDist: true,
    expect: /dist 为空或不存在/,
  },
  {
    // 边界:比较是严格大于。两侧 mtime 相等时判绿 —— 钉死这一格是为了让「把 > 写成 >=」
    // 这类改动必须显式改夹具(那会改变「同刻产物算不算新鲜」的口径)。
    name: 'src 与 dist mtime 完全相等 → 判绿(比较是严格大于)',
    sameSecond: true,
    expect: null,
  },
];

// 进程级档:CLI 适配层(参数路由 → 前置守卫 → 判定 → 退出码 → 诊断前缀)
const CLI_CASES = [
  {
    name: '未漂移(src 旧 dist 新)→ exit 0 且无任何输出',
    expectCode: 0,
    expect: /^\s*$/,
  },
  {
    name: 'src 晚于 dist → exit 1 且带 [build-fresh:fail] 前缀与「请先运行 npm run build」',
    stale: 'src/core/convert.ts',
    expectCode: 1,
    expect: /\[build-fresh:fail\].*存在晚于 dist 的 src 改动.*请先运行 npm run build/,
  },
  {
    // 判定本体对「src 不存在」恒绿(见文件头「已知边界」),挡住它的是 CLI 的前置守卫。
    // 这一格是那层守卫唯一的回归守护:守卫被摘掉时,smoke 会在没有源码树的目录上继续跑。
    name: '源码目录不存在 → exit 1 且点名源码目录(CLI 前置守卫)',
    missingSrc: true,
    expectCode: 1,
    expect: /\[build-fresh:fail\] 源码目录不存在:src/,
  },
  {
    name: 'dist 不存在 → exit 1 且诊断指向 dist',
    removeDist: true,
    expectCode: 1,
    expect: /\[build-fresh:fail\].*dist 为空或不存在/,
  },
  {
    name: '未知参数 → 判红(不得静默按默认跑一遍)',
    args: ['--oops'],
    expectCode: 1,
    expect: /无法识别的选项:--oops/,
  },
  {
    name: '--help → exit 0 并打印用法',
    args: ['--help'],
    expectCode: 0,
    expect: /用法: node gates\/smoke\/check-build-fresh\.mjs/,
  },
];

/** @type {string[]} */
const failures = [];

/**
 * 把一条用例铺成合成树并施加漂移(createTree 已给出「src 旧 / dist 新」的正向锚点形态,
 * 这里只叠加该用例声明的那一处故障)。
 * @param {object} testCase 用例
 * @returns {string} 合成树根
 */
function materialize(testCase) {
  const root = createTree();
  if (testCase.sameSecond === true) {
    // 两侧钉成同一时刻:把 src 侧整体前拨到 dist 的时刻(判据是严格大于,等值应判绿)
    for (const rel of Object.keys(TREE_FILES).filter((r) => r.startsWith(SRC_PREFIX))) {
      utimesSync(join(root, ...rel.split('/')), DIST_SECONDS, DIST_SECONDS);
    }
    return root;
  }
  if (typeof testCase.stale === 'string') pinFile(root, testCase.stale, STALE_SECONDS);
  if (testCase.removeDist === true) rmSync(join(root, 'dist'), { recursive: true, force: true });
  if (testCase.emptyDist === true) {
    for (const rel of Object.keys(TREE_FILES).filter((r) => r.startsWith(DIST_PREFIX))) {
      rmSync(join(root, ...rel.split('/')), { force: true });
    }
  }
  if (testCase.missingSrc === true) rmSync(join(root, 'src'), { recursive: true, force: true });
  return root;
}

/* ---------- 纯函数档 ---------- */
for (const testCase of PURE_CASES) {
  /** @type {string | undefined} */
  let root;
  try {
    root = materialize(testCase);
    const problems = evaluateFreshness({ srcDir: join(root, 'src'), distDir: join(root, 'dist') });
    const joined = problems.join('\n');
    if (testCase.expect === null) {
      if (problems.length === 0) {
        console.log(`[ok] build-fresh-selftest:${testCase.name}`);
      } else {
        failures.push(`${testCase.name}:期望零问题,实际 ${problems.length} 条\n${joined}`);
      }
      continue;
    }
    if (testCase.expect.test(joined)) {
      console.log(`[ok] build-fresh-selftest:${testCase.name}(漂移被拦截 / ${problems.length} 条问题)`);
    } else {
      failures.push(`${testCase.name}:期望问题清单匹配 ${testCase.expect},实际\n${joined || '(零问题 —— 判定在此形态上恒绿了)'}`);
    }
  } catch (error) {
    failures.push(`${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
}

/* ---------- 反向锚点:撤销漂移必须回到判绿 ---------- */
// 「注入 ⇒ 红」与「撤销 ⇒ 绿」必须成对存在:只做前者时,一个「无论什么输入都判红」的退化
// 实现能让全部负向夹具通过;只做后者时,一个「恒绿」的实现同样能让全部用例通过。
{
  const root = createTree();
  try {
    const stale = join(root, ...`${SRC_PREFIX}core/convert.ts`.split('/'));
    pinFile(root, `${SRC_PREFIX}core/convert.ts`, STALE_SECONDS);
    const drifted = evaluateFreshness({ srcDir: join(root, 'src'), distDir: join(root, 'dist') });
    // 归因锚点:判红的**原因**必须来自那个被前拨的文件 —— 换一个未被改的子树做对照,
    // 证明判定确实跟着「哪一个文件被动了」走,而不是笼统地「src 里有文件就红」。
    const control = evaluateFreshness({
      srcDir: join(root, ...`${SRC_PREFIX}renderer`.split('/')),
      distDir: join(root, 'dist'),
    });
    utimesSync(stale, SRC_SECONDS, SRC_SECONDS);
    const restored = evaluateFreshness({ srcDir: join(root, 'src'), distDir: join(root, 'dist') });
    const problems = [];
    if (drifted.length === 0) problems.push(`前拨 ${SRC_PREFIX}core/convert.ts 的 mtime 后应判红,实际零问题`);
    if (control.length !== 0) {
      problems.push(`对照组(${SRC_PREFIX}renderer 不存在 ⇒ srcMax 为 null ⇒ 跳过该族)应判绿,实际:${control.join(" | ")}`);
    }
    if (restored.length !== 0) problems.push(`撤销漂移后应回到判绿,实际:${restored.join(" | ")}`);
    if (problems.length > 0) {
      failures.push(`注入/撤销成对:${problems.join("; ")}`);
    } else {
      console.log('[ok] build-fresh-selftest:注入 mtime 漂移判红、撤销后判绿、且判红只归因于被改的那个文件');
    }
  } catch (error) {
    failures.push(`注入/撤销成对:抛异常:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* ---------- 进程级档 ---------- */
for (const testCase of CLI_CASES) {
  /** @type {string | undefined} */
  let root;
  try {
    root = materialize(testCase);
    const run = runGate(root, testCase.args ?? ['--src', 'src', '--dist', 'dist']);
    if (run.code !== testCase.expectCode || !testCase.expect.test(run.output)) {
      failures.push(
        `${testCase.name}:期望 exit=${String(testCase.expectCode)} 且输出匹配 ${testCase.expect},`
        + `实际 exit=${String(run.code)}\n${run.output || '(无输出)'}`,
      );
      continue;
    }
    console.log(`[ok] build-fresh-selftest:${testCase.name}(exit ${String(run.code)})`);
  } catch (error) {
    failures.push(`${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
}

const total = PURE_CASES.length + 1 + CLI_CASES.length;
if (failures.length > 0) {
  for (const failure of failures) console.error(`[build-fresh-selftest:fail] ${failure}`);
  console.error(`[build-fresh-selftest:fail] 构建新鲜度门禁回归守护失败,共 ${failures.length}/${total} 条`);
  process.exit(1);
}
console.log(`[ok] build-fresh-selftest:${total} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);