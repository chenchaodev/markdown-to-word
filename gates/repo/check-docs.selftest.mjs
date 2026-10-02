// 指针门禁薄包装(check-docs.mjs)自身的回归守护(负向夹具)。
//
// gates/repo/check-docs.mjs 只有三个职责:解析门禁载体路径 → 委托执行 → 退出码原样传出。
// 三个职责各自都能被改成「看起来还在跑、实际什么都不查」的形态,而**没有任何其他检查能发现**:
//   · 载体不可达那行提示被删 ⇒ 静默跳过(最没用的失败形态:你以为文档被查过,其实没有);
//   · 载体不可达被改成判红 ⇒ CI(不装也不克隆配置仓)天天红;
//   · 委托的退出码被吞掉或归一成 1 ⇒ 门禁真判红时本地提交照样放行;
//   · cwd 传成配置仓根 ⇒ 门禁退化成「配置模式」,项目侧一个指针都没查却报绿。
//
// 因此这里逐条制造这些漂移,断言包装层以非零码拒绝,并断言未漂移时通过。
//
// **夹具不复制门禁本体**:直接跑仓内真实的 gates/repo/check-docs.mjs,只把 M2W_GLOBAL_CONFIG
// (或未设该变量时的合成 home)指向系统临时目录下的**替身载体**(writeFileSync 写出的合成
// tools/check-pointers.mjs)。载体一律由夹具现造 ⇒ 本自检的结论与宿主是否装了配置仓无关。
// 门禁本体的判定规则不在本仓(单一事实源在全局配置仓,自带 ledger 自检),本仓这层不持有
// 第二份逻辑 —— 夹具复制一份真实门禁进来只会把「规则的演进」也冻在夹具里。
// 另:刻意不使用 copyFileSync —— 它在 test/common/copy-closure-audit.js 里是受审计的复制
// 机制,新增复制点要同步那张登记表(不在本自检的可写范围内),故此处只「写」不「复制」。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则
// 系统临时区会堆满夹具树。真实仓库只被**读**(cwd 传给门禁,门禁只读项目文档)。

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'gates', 'repo', 'check-docs.mjs');

/** 替身载体只实现包装层关心的契约:退出码 + stdout/stderr + argv + cwd。不复制门禁的判定规则。 */
const STUB_PREAMBLE = [
  'import fs from "node:fs";',
  'import path from "node:path";',
  'const cwd = process.cwd();',
  'process.stdout.write(`[stub-gate] argv=${JSON.stringify(process.argv.slice(2))}\\n`);',
  'process.stdout.write(`[stub-gate] cwd=${cwd.split(path.sep).join("/")}\\n`);',
  // 项目探针:包装层把 cwd 设成项目仓,门禁据此判「项目模式」(探测面 = cwd 下存在 docs/REQ.md)
  'process.stdout.write(`[stub-gate] project-probe=${fs.existsSync(path.join(cwd, "docs", "REQ.md"))}\\n`);',
];

/** 判红形态:门禁自己打印一行可读诊断后退出(包装层只许原样传码,不许补调用栈) */
const STUB_RED_DIAGNOSTIC =
  'process.stderr.write("[stub-gate:fail] docs/REQ.md 的指针指向已删除的文档:docs/RETIRED.md\\n");';

/** 判绿形态:与真门禁同形的「门禁结论」行(判别式:有结论行 = 真判过) */
const STUB_GREEN_DIAGNOSTIC =
  'process.stdout.write("门禁结论:已判定 | 通过 | 模式:配置+项目 | 范围:0 | 覆盖:0\\n");';

/**
 * 造一份替身载体脚本。
 * @param {'green'|'red1'|'red7'|'signal'} mode 退出形态
 * @returns {string} 脚本源码(.mjs,故不必带 package.json)
 */
function stubGateSource(mode) {
  /** @type {string[]} */
  const tail = [];
  if (mode === 'green') tail.push(STUB_GREEN_DIAGNOSTIC);
  if (mode === 'red1' || mode === 'red7') tail.push(STUB_RED_DIAGNOSTIC, `process.exit(${mode === 'red1' ? 1 : 7});`);
  if (mode === 'signal') tail.push('// 取不到数字退出码(被信号杀死)⇒ 包装层必须按失败处理,不能当成通过', 'process.kill(process.pid, "SIGKILL");');
  return `${[...STUB_PREAMBLE, ...tail].join('\n')}\n`;
}

/**
 * 造一个「配置仓根」:三种可达性形态各一种。返回的目录一律由调用方在 finally 里删。
 * @param {'missing'|'no-gate-file'|'reachable'} shape 载体形态
 * @param {'green'|'red1'|'red7'|'signal'} [mode] 载体可达时的退出形态
 * @returns {string} 配置仓根绝对路径(`missing` 形态下该路径**不存在**)
 */
function createConfigRoot(shape, mode = 'green') {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-docs-selftest-'));
  if (shape === 'missing') return dir;
  mkdirSync(join(dir, 'tools'), { recursive: true });
  if (shape === 'no-gate-file') return dir;
  writeFileSync(join(dir, 'tools', 'check-pointers.mjs'), stubGateSource(mode), 'utf8');
  return dir;
}

/**
 * 造一个「合成 home」:包装层在未设 M2W_GLOBAL_CONFIG 时回退到 `os.homedir()/.config/opencode`,
 * 而 homedir 由 HOME/USERPROFILE 决定 ⇒ 改写这两个环境变量即可把该回退分支钉到夹具上。
 * 返回的目录由调用方在 finally 里删。
 * @param {'green'|'red1'|'red7'|'signal'} [mode] 载体退出形态
 * @returns {string} home 目录绝对路径(其下已预置 .config/opencode/tools/check-pointers.mjs)
 */
function createHomeRoot(mode = 'green') {
  const home = mkdtempSync(join(tmpdir(), 'm2w-docs-selftest-home-'));
  const tools = join(home, '.config', 'opencode', 'tools');
  mkdirSync(tools, { recursive: true });
  writeFileSync(join(tools, 'check-pointers.mjs'), stubGateSource(mode), 'utf8');
  return home;
}

/**
 * 跑包装层。env 显式构造:不继承宿主可能已设的 M2W_GLOBAL_CONFIG,否则夹具结论会被环境污染。
 * @param {string | undefined} configRoot M2W_GLOBAL_CONFIG 的取值(undefined = 不设该变量)
 * @param {string[]} [args] 透传给门禁的参数
 * @param {Record<string, string>} [envOverrides] 追加/覆盖的子进程环境变量(home-shim 用)
 * @returns {{ code: number | null, output: string }} 退出码与合并输出
 */
function runWrapper(configRoot, args = [], envOverrides = {}) {
  /** @type {Record<string, string>} */
  const env = { ...process.env, ...envOverrides };
  if (configRoot === undefined) delete env.M2W_GLOBAL_CONFIG;
  else env.M2W_GLOBAL_CONFIG = configRoot;
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    env,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/** 包装层的 cwd 归一形态(与替身载体里 `split(path.sep).join("/")` 同一口径) */
const PROJECT_CWD_TOKEN = `cwd=${projectRoot.split('\\').join('/')}`;

// 每条负向夹具须命中一个真实漂移形态,而非人造噪声。
const CASES = [
  {
    // **为什么必须留这条**:包装层解析载体路径的第一分支是「未设 M2W_GLOBAL_CONFIG ⇒ 回退
    // os.homedir()」。其余夹具一律显式设了 M2W_GLOBAL_CONFIG,该分支**无任何覆盖** ——
    // 一旦这行回退被删改成硬依赖环境变量,全套夹具照样全绿。
    //
    // **为什么改写 HOME/USERPROFILE 而不是用真实配置仓**:回退分支的落点是宿主用户目录,
    // 那台机器装没装配置仓、装了是不是漂移的,本自检都无从判断 ⇒ 结论会随环境分化(缺依赖时
    // 悄悄退化成「验证跳过分支」,验证语义取决于跑的人)。改写成夹具现造的合成 home 后,
    // 该分支恒定命中「载体可达 → 真委托」,判别式得以收紧到「必须出已判定」。
    //
    // HOME 与 USERPROFILE **必须同时设**:os.homedir() 在 Windows 上只认 USERPROFILE,
    // 只设 HOME 会静默失效(回落到真实用户目录),夹具变绿但验证的根本不是这条分支。
    name: 'homedir 回退分支(不设 M2W_GLOBAL_CONFIG,合成 home)→ 绿且必须出已判定',
    shape: 'home-shim',
    mode: 'green',
    expectCode: 0,
    require: /门禁结论:已判定/,
    forbid: /跳过:未找到全局指针门禁/,
  },
  {
    name: '载体不可达(配置仓根不存在)→ 绿,但必须打印跳过提示(不许静默)',
    shape: 'missing',
    expectCode: 0,
    require: /\[check:docs\] 跳过:未找到全局指针门禁/,
    forbid: /门禁结论:已判定/,
  },
  {
    name: '载体不可达(tools/ 在、门禁文件不在)→ 仍走跳过分支(判据是文件不是目录)',
    shape: 'no-gate-file',
    expectCode: 0,
    require: /跳过:未找到全局指针门禁/,
  },
  {
    name: '载体可达且绿 → 委托执行、退出码 0、门禁自己的结论行原样透出',
    shape: 'reachable',
    mode: 'green',
    expectCode: 0,
    require: /门禁结论:已判定 \| 通过/,
    forbid: /跳过:未找到全局指针门禁/,
  },
  {
    name: '载体可达且红(exit 1)→ 原样传出 1,门禁诊断透出,且不回吐调用栈',
    shape: 'reachable',
    mode: 'red1',
    expectCode: 1,
    require: /\[stub-gate:fail\] docs\/REQ\.md 的指针指向已删除的文档:docs\/RETIRED\.md/,
    forbid: /\n\s+at\s/,
  },
  {
    name: '载体退出码非 1(exit 7)→ 原样传出 7(不得归一成 1,否则「哪道门禁判的」信息丢失)',
    shape: 'reachable',
    mode: 'red7',
    expectCode: 7,
    require: /\[stub-gate:fail\]/,
    forbid: /\n\s+at\s/,
  },
  {
    name: '载体被信号杀死(取不到数字退出码)→ 按失败处理 exit 1,不得当成通过',
    shape: 'reachable',
    mode: 'signal',
    expectCode: 1,
    forbid: /跳过:未找到全局指针门禁/,
  },
  {
    name: '参数原样透传给载体(门禁自己收 argv,不被包装层吞掉)',
    shape: 'reachable',
    mode: 'green',
    args: ['--docs-selftest-probe'],
    expectCode: 0,
    require: /argv=\["--docs-selftest-probe"\]/,
  },
  {
    name: '委托时 cwd = 项目仓且项目探针成立(否则门禁退化成配置模式,项目侧零覆盖却报绿)',
    shape: 'reachable',
    mode: 'green',
    expectCode: 0,
    require: new RegExp(`\\[stub-gate\\] ${PROJECT_CWD_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    requireAll: [/\[stub-gate\] project-probe=true/],
  },
  {
    name: 'M2W_GLOBAL_CONFIG 带首尾空白 → trim 后仍解析到该载体(否则一条尾随空格就静默跳过)',
    shape: 'reachable',
    mode: 'green',
    padEnv: true,
    expectCode: 0,
    require: /门禁结论:已判定 \| 通过/,
  },
];

const failures = [];
for (const testCase of CASES) {
  let configRoot;
  let homeRoot;
  try {
    // 'home-shim' 走的是「不设 M2W_GLOBAL_CONFIG ⇒ 回退 os.homedir()」那条分支:载体放在合成
    // home 下,并同时改写 HOME 与 USERPROFILE(Windows 上 os.homedir() 只认后者,只设前者会
    // 静默回落到真实用户目录 ⇒ 夹具看着绿、实际没验这条分支)。
    const isHomeShim = testCase.shape === 'home-shim';
    if (isHomeShim) homeRoot = createHomeRoot(testCase.mode);
    else configRoot = createConfigRoot(/** @type {'missing'|'no-gate-file'|'reachable'} */ (testCase.shape), testCase.mode);
    const value = configRoot === undefined ? undefined : testCase.padEnv === true ? `  ${configRoot}\t` : configRoot;
    const envOverrides = homeRoot === undefined ? {} : { HOME: homeRoot, USERPROFILE: homeRoot };
    const { code, output } = runWrapper(value, testCase.args ?? [], envOverrides);
    /** @type {string[]} */
    const problems = [];
    if (code !== testCase.expectCode) {
      problems.push(`期望 exit ${testCase.expectCode},实际 exit ${String(code)}`);
    }
    const requires = [testCase.require, ...(testCase.requireAll ?? [])].filter((re) => re !== undefined);
    for (const re of requires) {
      if (!re.test(output)) problems.push(`输出未匹配 ${re}`);
    }
    if (testCase.forbid !== undefined && testCase.forbid.test(output)) {
      problems.push(`输出命中了不该出现的 ${testCase.forbid}`);
    }
    if (problems.length === 0) {
      console.log(`[ok] docs-selftest:${testCase.name}(符合预期,exit ${String(code)})`);
    } else {
      failures.push(`${testCase.name}:${problems.join(';')}\n--- 输出 ---\n${output}`);
    }
  } catch (error) {
    // 一条夹具的构造/执行异常不许打断整批(否则后面的夹具一条都跑不到,报告里也看不出是哪条坏了)
    failures.push(`${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (configRoot !== undefined) rmSync(configRoot, { recursive: true, force: true });
    if (homeRoot !== undefined) rmSync(homeRoot, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[docs-selftest:fail] ${failure}`);
  console.error(`[docs-selftest:fail] 指针门禁包装层回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] docs-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截 / 退出码与提示原样透传)`);