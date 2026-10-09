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
// ✅ 关于「诊断可归因」:判定本体 `evaluateFreshness` 的每条问题**点名具体的 src 相对路径**
// (REQ-180 T5-b S1d 的接口变更:此前正文恒为「构建产物过期(存在晚于 dist 的 src 改动),
// 请先运行 npm run build」,不含文件名 —— 那是把「产物过期」说成了一句要自己去 git status
// 的话)。故本自检**逐字断言诊断里出现被前拨的那个文件名**,不再由夹具自证归因。
//
// 三格把「点名」钉死,少一格都会退化:
//   - 单文件 ⇒ 点名它,且**不出现**别的 src 文件(证明不是「把所有 src 文件名列一遍」);
//   - 两个文件同时晚于 dist ⇒ **两个都点名**(裁决是「点名全部」,不是「只点最早/最新的那个」;
//     只点一个的写法会让「修完一个再跑又冒出一个」,来回几次才能收敛);
//   - 过期文件数超过 STALE_FILE_LIST_LIMIT ⇒ 只列前 N 个但**必给总数**,且总数写的是真实个数
//     (证明上限不是隐瞒:截断只影响列举,计数永远完整)。
//
// ⚠ 元素类型刻意保持 `string[]`(判定本体的返回形状,理由在它自己的 JSDoc 里):富结构体
// 经 protocol.mjs 的 toProblems() 归一时只保留 code + message,文件清单字段会被整段丢掉。
//
// ---- 形态:case 契约接入,但**不接 harness**(ADR-074 决定一 / ADR-068 bespoke 留在原处)----
//
// 夹具表逐条收成 `await suite.case(用例名, () => …)`,期望核对统一走 `shared/case.js` 的
// `assert`(ADR-074 决定一:门禁树接的是落在 shared/ 的真实现 —— `gates-stay-in-gates` 的
// 允许面只有 `gates` / `shared` / `test/fixtures`,`test/` 整棵树不在其中,引不到
// `test/harness/case.js`)。case 内失败即抛、由 case 级 catch 收成**该 case** 失败,不中断
// 后续 case —— 一次跑完可见全部失败面。
//
// **不用合成根 harness**:本档的入参是**合成树路径**与 `evaluateFreshness` / 子进程的
// **结果对象**(problems 数组 / exit code + output),而 harness 的表只收「树型路径 → 正文
// + 问题清单正则」且判定体须回吐**问题清单** —— 入参与返回两侧都不对型,塞进去是假接入
// (口径同 smoke-proc.selftest.mjs 头注)。

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, createCaseSuite } from '../../shared/case.js';
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

/**
 * 合成树里铺的文件(相对树根的 POSIX 路径);含嵌套子目录,顺带覆盖 collectMaxMtime 的递归。
 *
 * `src/core/extra/*` 是为「超过点名上限」那一格准备的:上限是 3,要让诊断真的走到截断分支
 * 就必须有 4 个以上的过期文件,而夹具又不能改动判定本体的上限常量(那是门禁的行为)。
 */
const TREE_FILES = Object.freeze({
  'src/core/convert.ts': 'export const x = 1;\n',
  'src/core/nested/deep.ts': 'export const y = 2;\n',
  'src/core/extra/e1.ts': 'export const e1 = 1;\n',
  'src/core/extra/e2.ts': 'export const e2 = 2;\n',
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
    // 点名那一格:诊断里必须出现**被前拨的那个文件的相对路径**。路径是相对 `--src` 目录的
    // POSIX 形态(`core/convert.ts`),不是文件名片段 —— 断言相对路径才能证明诊断指的是
    // 「src 树里的哪一个」,而不只是「convert 这几个字出现在句子里」。
    name: 'src 顶层文件晚于 dist → 判红、点名该文件、给出可执行指引',
    stale: 'src/core/convert.ts',
    expect: /存在晚于 dist 的 src 改动.*源码侧 core\/convert\.ts.*npm run build/,
    // 反向:诊断不得顺手把别的 src 文件也列上(「点名」不是「把所有文件名列一遍」)
    forbid: ['core/nested/deep.ts', 'core/extra/e1.ts'],
  },
  {
    // 反向锚点(防「递归被摘掉」):只在**嵌套子目录**里的那个文件被改,一样必须判红。
    // 只覆盖顶层的话,把 walk 换成只读一层目录的实现也能全绿。
    name: 'src 嵌套子目录里的文件晚于 dist → 判红且点名它(递归不可被摘掉)',
    stale: 'src/core/nested/deep.ts',
    expect: /存在晚于 dist 的 src 改动.*源码侧 core\/nested\/deep\.ts/,
    forbid: ['core/convert.ts'],
  },
  {
    // 多文件裁决的第一格:两个文件同时晚于 dist ⇒ **两个都点名**。这是「点名全部」而非
    // 「只点最早/最新的那个」的落地断言 —— 只点一个的写法在这一格上会少一个名字而判红。
    name: '两个 src 文件同时晚于 dist → 判红且两个都点名(裁决:点名全部)',
    stale: ['src/core/convert.ts', 'src/core/nested/deep.ts'],
    expect: /存在晚于 dist 的 src 改动.*源码侧 core\/convert\.ts.*core\/nested\/deep\.ts.*共 2 个/,
  },
  {
    // 多文件裁决的第二格:超过 STALE_FILE_LIST_LIMIT(3)时只列前 3 个,**总数必须是真的**。
    // 这一格是「上限不构成隐瞒」的机器守护:把上限去掉或把计数写成 3 的常量都会红。
    name: '过期文件数超过点名上限 → 只列前 N 个但必给真实总数(上限不是隐瞒)',
    stale: ['src/core/convert.ts', 'src/core/extra/e1.ts', 'src/core/extra/e2.ts', 'src/core/nested/deep.ts'],
    expect: /存在晚于 dist 的 src 改动.*源码侧 core\/convert\.ts.*core\/extra\/e1\.ts.*core\/extra\/e2\.ts.*共 4 个,只列前 3 个/,
    forbid: ['core/nested/deep.ts'],
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
    // 进程级也要点名:纯函数档点名了不等于 CLI 那一侧点着名 —— main() 的呈现层若把问题
    // 数组换成一句常量文案,纯函数档照样绿。这里从 CLI 的真实 stdout/stderr 断言文件名。
    name: 'src 晚于 dist → exit 1、带 [build-fresh:fail] 前缀、点名该文件与重建指引',
    stale: 'src/core/convert.ts',
    expectCode: 1,
    expect: /\[build-fresh:fail\].*存在晚于 dist 的 src 改动.*源码侧 core\/convert\.ts.*请先运行 npm run build/,
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

const suite = createCaseSuite();

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
  // stale 接受字符串或字符串数组(多文件裁决那两格要同时钉住多个文件)
  if (typeof testCase.stale === 'string') pinFile(root, testCase.stale, STALE_SECONDS);
  else if (Array.isArray(testCase.stale)) {
    for (const rel of testCase.stale) pinFile(root, rel, STALE_SECONDS);
  }
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
// 档名即 case 名(逐字沿用 PURE_CASES 里的 `name:`)。每条用例的期望核对与夹具异常都收敛成
// 一条 `assert` 抛出,由 case 级 catch 收成该 case 失败。
for (const testCase of PURE_CASES) {
  await suite.case(testCase.name, () => {
    /** @type {string | undefined} */
    let root;
    /** @type {string | null} */
    let problem = null;
    try {
      root = materialize(testCase);
      const problems = evaluateFreshness({ srcDir: join(root, 'src'), distDir: join(root, 'dist') });
      const joined = problems.join('\n');
      if (testCase.expect === null) {
        if (problems.length === 0) {
          console.log(`[ok] build-fresh-selftest:${testCase.name}`);
        } else {
          problem = `${testCase.name}:期望零问题,实际 ${problems.length} 条\n${joined}`;
        }
      } else {
        // forbid 独立于 expect:它断的是「诊断还多说了不该说的」—— 一个把所有 src 文件名
        // 串进诊断的退化实现能通过 expect,但过不了 forbid。两者缺一,「点名」都可能被做成假的。
        const forbiddenHits = (testCase.forbid ?? []).filter((needle) => joined.includes(needle));
        if (testCase.expect.test(joined) && forbiddenHits.length === 0) {
          console.log(`[ok] build-fresh-selftest:${testCase.name}(漂移被拦截 / ${problems.length} 条问题)`);
        } else {
          const extra = forbiddenHits.length > 0
            ? `\n(诊断里出现了不该出现的名字:${forbiddenHits.join(", ")} —— 「点名」必须是点名那一个,不是列一遍)`
            : '';
          problem = `${testCase.name}:期望问题清单匹配 ${testCase.expect},实际\n${joined || '(零问题 —— 判定在此形态上恒绿了)'}${extra}`;
        }
      }
    } catch (error) {
      problem = `${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
    assert(problem === null, problem ?? '(无失败消息)');
  });
}

/* ---------- 反向锚点:撤销漂移必须回到判绿 ---------- */
// 「注入 ⇒ 红」与「撤销 ⇒ 绿」必须成对存在:只做前者时,一个「无论什么输入都判红」的退化
// 实现能让全部负向夹具通过;只做后者时,一个「恒绿」的实现同样能让全部用例通过。
await suite.case('注入/撤销成对', () => {
  const root = createTree();
  /** @type {string | null} */
  let problem = null;
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
    // 「归因」这一格现在是**真断言**:诊断正文里必须出现被前拨的那个文件的相对路径。
    // 判红的措辞再对、但点不出是哪个文件,归因仍然不成立 —— 那正是把判定退化成
    // 「src 树里有文件就红」的形态。
    if (drifted.length > 0 && !drifted.join('\n').includes('core/convert.ts')) {
      problems.push(`判红诊断未点名被前拨的文件 core/convert.ts,实际:${drifted.join(" | ")}`);
    }
    if (control.length !== 0) {
      problems.push(`对照组(${SRC_PREFIX}renderer 不存在 ⇒ srcMax 为 null ⇒ 跳过该族)应判绿,实际:${control.join(" | ")}`);
    }
    if (restored.length !== 0) problems.push(`撤销漂移后应回到判绿,实际:${restored.join(" | ")}`);
    if (problems.length > 0) {
      problem = `注入/撤销成对:${problems.join("; ")}`;
    } else {
      console.log('[ok] build-fresh-selftest:注入 mtime 漂移判红、撤销后判绿、且判红只归因于被改的那个文件');
    }
  } catch (error) {
    problem = `注入/撤销成对:抛异常:${error instanceof Error ? error.message : String(error)}`;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert(problem === null, problem ?? '(无失败消息)');
});

/* ---------- 进程级档 ---------- */
// 档名即 case 名(逐字沿用 CLI_CASES 里的 `name:`);与表外那条「注入/撤销成对」的顺序保持
// 搬迁前的「先纯函数、再反向锚点、后进程级」。
for (const testCase of CLI_CASES) {
  await suite.case(testCase.name, () => {
    /** @type {string | undefined} */
    let root;
    /** @type {string | null} */
    let problem = null;
    try {
      root = materialize(testCase);
      const run = runGate(root, testCase.args ?? ['--src', 'src', '--dist', 'dist']);
      if (run.code !== testCase.expectCode || !testCase.expect.test(run.output)) {
        problem =
          `${testCase.name}:期望 exit=${String(testCase.expectCode)} 且输出匹配 ${testCase.expect},`
          + `实际 exit=${String(run.code)}\n${run.output || '(无输出)'}`;
      } else {
        console.log(`[ok] build-fresh-selftest:${testCase.name}(exit ${String(run.code)})`);
      }
    } catch (error) {
      problem = `${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
    assert(problem === null, problem ?? '(无失败消息)');
  });
}

/* ---------- 汇总:段级成败按 case 结果判 ---------- */
// 分母 `suite.results.length` 与搬迁前的 `PURE_CASES.length + 1 + CLI_CASES.length` 同一个数;
// 两侧一旦不等,说明有档没接进 case —— 那正是 `gates-selftest-named-case` 要抓的形态。
const cases = suite.results;
const failedCases = suite.failures;
if (failedCases.length > 0) {
  for (const failure of failedCases) console.error(`[build-fresh-selftest:fail] ${failure.name}:${failure.message ?? '(无失败消息)'}`);
  console.error(`[build-fresh-selftest:fail] 构建新鲜度门禁回归守护失败,共 ${failedCases.length}/${cases.length} 条`);
  process.exit(1);
}
console.log(`[ok] build-fresh-selftest:${cases.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);