// 打包解包产物(win-unpacked)启动 smoke(exit 0/1)。
//
// 用途:check-release-artifacts.mjs 只证明「产物齐备且指纹对得上」,不证明「这份产物
// 起得来、跑得动」。本脚本补的就是这一段:定位 release/win-unpacked 下的应用可执行
// 文件,以 --smoke 启动并等它自行退出,断言退出码为 0 且输出带齐诊断标记
// (docx 转换 / pdf 转换 / pdf 书签 / renderer 诊断 / IPC 接线,清单单一来源在
// gates/smoke/smoke-proc.mjs)。
//
// 硬约束(写死在本脚本内,不依赖调用方自觉):
//   - 硬超时必设:到点未退出即硬杀进程树并判红(不留孤儿渲染进程);
//   - 每次运行一个全新的一次性 userData,并在 finally 里删除(建在 output/ 内);
//   - 零删除:不碰 release/ 里的任何既有产物(解包目录是 electron-builder 的产物目录,
//     本脚本只读它);临时目录只写 output/smoke-check/;
//   - 随包分发的命令行转发器(build.extraFiles 落在安装根目录、与 exe 并列)必须就位:
//     只断存在性,不断言其运行行为。
//
// 能力缺口已填(2026-09):冒烟实现下沉到 src/main/smoke.ts → dist/main/smoke.js,
// 编译产物在 build.files 白名单内随包分发。此前 dev-only 入口进不了 app.asar,
// 打包产物收到 --smoke 会在主进程动态 import 处失败(exit 1);预检仍保留该入口的
// 存在性核对(缺则判红),但当前预期是预检通过、启动取证转绿。
//
// 用法:
//   node gates/artifacts/check-unpacked-smoke.mjs [选项]
//   node gates/artifacts/check-unpacked-smoke.mjs --unpacked <dir> --timeout <ms>
//   node gates/artifacts/check-unpacked-smoke.mjs --exe <file> --launcher <script.mjs>

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, parseArgs } from '../../shared/cli.mjs';
import { toPosix } from '../../shared/fsx.mjs';
import { ROOT } from '../../shared/paths.js';
import {
  asarContainsEntry,
  collectSmokeProblems,
  createUserData,
  DEFAULT_SMOKE_TIMEOUT_MS,
  describeSmokeCommand,
  disposeUserData,
  listExeNames,
  outputTail,
  runSmokeProcess,
  SMOKE_ENTRY_RELATIVE,
  SMOKE_FLAG,
} from '../smoke/smoke-proc.mjs';

const projectRoot = ROOT;

/** 打开发布产物的默认目录(取自 build.directories.output,与 check-release-artifacts 同源) */
const DEFAULT_RELEASE_DIR = 'release';
/** electron-builder 的 win 解包目录名(写死:改名会让本检查与产物布局分叉) */
const UNPACKED_DIR_NAME = 'win-unpacked';
/** 默认临时根(output/ 内,gitignore 覆盖;通过即清空,失败时留一份日志供复现) */
const DEFAULT_SCRATCH_DIR = path.join('output', 'smoke-check', 'unpacked');
/** 失败留痕的日志文件名(仅失败时写;通过即删,不污染仓库) */
const LOG_FILE_NAME = 'unpacked-smoke.log';

const USAGE = `用法: node gates/artifacts/check-unpacked-smoke.mjs [选项]
  --unpacked <dir>   打包解包目录(默认 <build.directories.output>/${UNPACKED_DIR_NAME})
  --exe <file>       应用可执行文件(默认 <解包目录>/<productName>.exe)
  --launcher <file>  用解释器运行该启动器代替直接启动 exe(自测沙盒 / 需经解释器启动的目标;
                     传给启动器的参数与直接启动 exe 完全一致)
  --launcher-runtime <file>  启动器的解释器可执行文件(默认当前进程;自测沙盒里本进程是
                     Electron,需显式指向 node)
  --timeout <ms>     硬超时(ms,默认 ${DEFAULT_SMOKE_TIMEOUT_MS};0 = 不启用,不建议)
  --scratch <dir>    一次性 userData 与日志的根目录(默认 ${toPosix(DEFAULT_SCRATCH_DIR)})
  --help             显示本用法`;

/**
 * 读 package.json 的打包口径(productName / 解包目录来源 / extraFiles 落点),不可读即抛可读错误。
 * @param {string} pkgPath package.json 路径
 * @returns {{ productName: string, releaseDir: string, extraFiles: { from: string, to: string }[] }} 打包口径
 */
function readBuildFacts(pkgPath) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    throw new Error(`package.json 不可读:${error instanceof Error ? error.message : String(error)}`);
  }
  const productName = typeof pkg.build?.productName === 'string' ? pkg.build.productName : '';
  if (productName === '') throw new Error('package.json build.productName 缺失(解包目录内的可执行文件无名可寻)');
  return {
    productName,
    releaseDir: typeof pkg.build?.directories?.output === 'string' ? pkg.build.directories.output : DEFAULT_RELEASE_DIR,
    extraFiles: readExtraFiles(pkg),
  };
}

/**
 * 读 build.extraFiles 的声明(转发器落点的**唯一来源**)。
 *
 * 为什么从 package.json 取而不是把 `m2w.cmd` 写死在本脚本里:写死等于门禁自带一份与构建
 * 配置无关的期望,配置改了门禁不会跟着变(仍是漂移校验);从配置取则「extraFiles 被删」会
 * 让本函数返回空数组 —— 那正是 preflight 里显式判红的情形(见 forwarderProblems)。
 * @param {unknown} pkg 已解析的 package.json
 * @returns {{ from: string, to: string }[]} 声明条目(非数组或字段缺失一律当空)
 */
function readExtraFiles(pkg) {
  const declared =
    pkg !== null && typeof pkg === 'object'
      ? /** @type {{ extraFiles?: unknown }} */ (pkg).build?.extraFiles
      : undefined;
  if (!Array.isArray(declared)) return [];
  /** @type {{ from: string, to: string }[]} */
  const entries = [];
  for (const item of declared) {
    if (item === null || typeof item !== 'object') continue;
    const { from, to } = /** @type {{ from?: unknown, to?: unknown }} */ (item);
    if (typeof from === 'string' && typeof to === 'string') entries.push({ from, to });
  }
  return entries;
}

/**
 * 预检:解包目录、可执行文件、app.asar 是否齐备,以及冒烟入口是否真的在包内。
 * 缺产物时给「先跑 dist 链」的可操作提示,而不是裸报错。
 * @param {object} spec 目标
 * @param {string} spec.unpackedDir 解包目录
 * @param {string | undefined} spec.exeOption --exe 显式指定的可执行文件
 * @param {{ productName: string, extraFiles: { from: string, to: string }[] }} spec.facts 打包口径
 * @returns {{ problems: string[], warnings: string[], exePath: string, forwarderPaths: string[] }} 预检结论
 */
function preflight({ unpackedDir, exeOption, facts }) {
  const problems = [];
  const warnings = [];
  /** @type {string[]} */
  let forwarderPaths = [];
  if (!existsSync(unpackedDir) || !statSync(unpackedDir).isDirectory()) {
    problems.push(
      `解包目录不存在:${toPosix(path.relative(projectRoot, unpackedDir))};` +
        `请先运行 npm run dist(打包链会生成 <${facts.releaseDir}>/${UNPACKED_DIR_NAME}),` +
        `或用 --unpacked 指向已有解包目录`,
    );
    return { problems, warnings, exePath: '', forwarderPaths };
  }
  const asarPath = path.join(unpackedDir, 'resources', 'app.asar');
  if (!existsSync(asarPath)) {
    problems.push(`应用归档缺失:${toPosix(path.relative(projectRoot, asarPath))}(解包目录不完整,打包可能中断;请重跑 npm run dist)`);
  } else {
    // 能力缺口先点出再取证:否则用户只会看到「退出码 1」,看不出是包内缺冒烟入口
    const probe = asarContainsEntry(asarPath);
    if (!probe.present) {
      if (probe.parsed === false) {
        // 头都解析不了 = 无法核对包内是否含入口,属产物完整性问题,不能只告警
        problems.push(
          `无法解析 app.asar 头部以核对冒烟入口 ${SMOKE_ENTRY_RELATIVE}:${probe.reason ?? "(未知原因)"};` +
            `产物可能未打包完整,请重跑 npm run dist`,
        );
      } else {
        warnings.push(
          `app.asar 内未找到冒烟入口 ${SMOKE_ENTRY_RELATIVE}(已按 asar 格式精确解析头部 ${probe.searched} 字节);` +
            `打包产物收到 --smoke 会在主进程动态 import 处失败。该入口由 src/main/smoke.ts 编译产出、` +
            `经 build.files 的 dist/** 随包分发,正常打包后不应缺失 —— 请确认 dist 链已重跑且 build.files 未被改`,
        );
      }
    }
  }
  const exePath = exeOption ?? path.join(unpackedDir, `${facts.productName}.exe`);
  if (!existsSync(exePath)) {
    const candidates = listExeNames(unpackedDir);
    problems.push(
      `应用可执行文件不存在:${toPosix(path.relative(projectRoot, exePath))};` +
        `解包目录内的 .exe 候选:${candidates.length === 0 ? '(无)' : candidates.join(', ')};` +
        `可用 --exe <file> 显式指定,或确认 npm run dist 是否跑完`,
    );
  }
  const forwarder = checkForwarders(unpackedDir, facts.extraFiles);
  problems.push(...forwarder.problems);
  forwarderPaths = forwarder.present;
  return { problems, warnings, exePath, forwarderPaths };
}

/**
 * 断言 build.extraFiles 声明的转发器在解包目录里**真的落位**(只断存在性,不断言运行行为)。
 *
 * 为何必须是 fail-closed 的存在性钉(而不是又一次漂移校验):`check:dist-manifest` /
 * `check:asar` 拿两个入口与 clean dist 清单逐字节比对,那是漂移校验 —— 清单里没有它们,
 * 于是 `extraFiles` 被删或 `to` 写错时,gen 与 check 两边一起空,全链仍绿,而已装用户的
 * 命令行入口静默消失。这里反过来:**期望清单来自 package.json 的声明,判定对象是产物**,
 * 少一个即红。
 *
 * fail-closed 的两个方向都要堵:
 *   - 声明为空(extraFiles 被删/被改名/读不到)→ 判红,不能「没有期望就没有失败」;
 *   - 声明有但产物里没有 → 判红,并点名期望路径与解包目录里实际看到的 .cmd/.bat。
 *
 * @param {string} unpackedDir 解包目录
 * @param {{ from: string, to: string }[]} extraFiles package.json build.extraFiles 声明
 * @returns {{ problems: string[], present: string[] }} 问题列表与已确认落位的转发器路径
 */
function checkForwarders(unpackedDir, extraFiles) {
  const problems = [];
  const present = [];
  if (extraFiles.length === 0) {
    problems.push(
      'package.json build.extraFiles 未声明任何条目:随安装包分发的命令行入口(转发器)' +
        '靠 extraFiles 落在安装根目录、与应用可执行文件并列,声明为空即入口不会随包分发;' +
        'docs/CLI.md · docs/USER-GUIDE.md · docs/MCP.md 与官网都已向用户承诺该入口,故此处判红',
    );
    return { problems, present };
  }
  for (const entry of extraFiles) {
    const target = path.join(unpackedDir, entry.to);
    if (existsSync(target)) {
      present.push(entry.to);
      continue;
    }
    const actual = listForwarderNames(unpackedDir);
    problems.push(
      `随包分发的转发器未落位:期望 ${toPosix(path.relative(projectRoot, target))}` +
        `(声明 build.extraFiles 的 from=${entry.from} → to=${entry.to});` +
        `解包目录内实际见到的 .cmd/.bat:${actual.length === 0 ? '(无)' : actual.join(', ')};` +
        `请确认 build.extraFiles 的 to 落点未被改动、build-assets/${path.basename(entry.from)} 存在、且 dist 链已重跑`,
    );
  }
  return { problems, present };
}

/**
 * 解包目录内的 .cmd/.bat 文件名(转发器缺失时用于把「实际看到了什么」摆进诊断)。
 * @param {string} dir 目录
 * @returns {string[]} 文件名(字典序;目录不存在返回空数组)
 */
function listForwarderNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.(cmd|bat)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, {
      booleans: ['help'],
      values: ['unpacked', 'exe', 'launcher', 'launcher-runtime', 'timeout', 'scratch'],
    });
  } catch (error) {
    console.error(`[unpacked-smoke:fail] ${error.message}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  let facts;
  try {
    facts = readBuildFacts(path.resolve(projectRoot, 'package.json'));
  } catch (error) {
    console.error(`[unpacked-smoke:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const timeoutMs = options.timeout === undefined ? DEFAULT_SMOKE_TIMEOUT_MS : Number(options.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    console.error(`[unpacked-smoke:fail] --timeout 须为非负毫秒数,实际 ${String(options.timeout)}`);
    return 1;
  }
  const unpackedDir = path.resolve(
    projectRoot,
    options.unpacked ?? path.join(facts.releaseDir, UNPACKED_DIR_NAME),
  );
  const scratchRoot = path.resolve(projectRoot, options.scratch ?? DEFAULT_SCRATCH_DIR);

  const { problems, warnings, exePath, forwarderPaths } = preflight({
    unpackedDir,
    exeOption: options.exe === undefined ? undefined : path.resolve(projectRoot, options.exe),
    facts,
  });
  for (const warning of warnings) console.warn(`[warn] unpacked-smoke: ${warning}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[unpacked-smoke:fail] ${problem}`);
    console.error('[unpacked-smoke:fail] 预检未通过,未启动任何进程');
    return 1;
  }

  const launcher = options.launcher === undefined ? undefined : path.resolve(projectRoot, options.launcher);
  if (launcher !== undefined && !existsSync(launcher)) {
    console.error(`[unpacked-smoke:fail] --launcher 指定的启动器不存在:${toPosix(path.relative(projectRoot, launcher))}`);
    return 1;
  }
  const runtime = options['launcher-runtime'] === undefined ? undefined : path.resolve(projectRoot, options['launcher-runtime']);
  if (runtime !== undefined && !existsSync(runtime)) {
    console.error(`[unpacked-smoke:fail] --launcher-runtime 指定的解释器不存在:${toPosix(path.relative(projectRoot, runtime))}`);
    return 1;
  }
  const userDataDir = createUserData(scratchRoot);
  const logPath = path.join(scratchRoot, LOG_FILE_NAME);
  console.log(`[info] unpacked-smoke: 启动 ${describeSmokeCommand({ exePath, launcher, runtime, userDataDir })}`);
  console.log(`[info] unpacked-smoke: 一次性 userData ${toPosix(path.relative(projectRoot, userDataDir))}(结束即删)`);

  /** @type {import('../smoke/smoke-proc.mjs').ProcessRunResult} */
  let result;
  try {
    result = await runSmokeProcess({ exePath, launcher, runtime, userDataDir, timeoutMs });
  } finally {
    // 无论如何都清一次性目录:超时段已硬杀进程树,残留只占 output/ 下的空间
    disposeUserData(userDataDir);
  }
  const found = collectSmokeProblems(result, { label: 'unpacked smoke' });

  if (found.length > 0) {
    // 失败留痕:解包产物跑 --smoke 的失败原因(动态 import 失败、断言文案)就在输出尾部,
    // 留在 output/smoke-check/ 供复现;通过则连同 scratchRoot 一起清掉,不污染仓库
    mkdirSync(scratchRoot, { recursive: true });
    writeFileSync(logPath, `${result.output}\n`, 'utf8');
    for (const problem of found) console.error(`[unpacked-smoke:fail] ${problem}`);
    console.error(`[unpacked-smoke:fail] 输出尾部:\n${outputTail(result.output)}`);
    console.error(`[unpacked-smoke:fail] 完整输出已留痕:${toPosix(path.relative(projectRoot, logPath))}`);
    return 1;
  }
  rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  // 转发器落位计数写进结论行(哪怕全通也报):「断言跑了」与「断言没跑」必须可分辨 ——
  // 本仓有同族前科(守卫静默退 0 骗过门禁,CI 上原生崩溃退出码被当成判绿),故这条
  // 断言不留「无输出即通过」的口子。
  console.log(
    `[ok] 解包产物 smoke 通过:${toPosix(path.relative(projectRoot, exePath))}` +
      ` 以 ${SMOKE_FLAG} 启动后退出码 0,诊断标记齐备(docx 转换 / pdf 转换 / pdf 书签 / renderer 诊断 / IPC 接线);` +
      `转发器落位已核对 ${facts.extraFiles.length}/${facts.extraFiles.length}(${forwarderPaths.join(', ') || '(无)'}` +
      `,与 exe 并列落在安装根目录);一次性 userData 已清理,release/ 零改动`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
