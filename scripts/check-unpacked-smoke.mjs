// 打包解包产物(win-unpacked)启动 smoke(exit 0/1)。
//
// 用途:check-release-artifacts.mjs 只证明「产物齐备且指纹对得上」,不证明「这份产物
// 起得来、跑得动」。本脚本补的就是这一段:定位 release/win-unpacked 下的应用可执行
// 文件,以 --smoke 启动并等它自行退出,断言退出码为 0 且输出带齐诊断标记
// (docx 转换 / pdf 转换 / pdf 书签 / renderer 诊断 / IPC 接线,清单单一来源在
// scripts/smoke-proc.mjs)。
//
// 硬约束(写死在本脚本内,不依赖调用方自觉):
//   - 硬超时必设:到点未退出即硬杀进程树并判红(不留孤儿渲染进程);
//   - 每次运行一个全新的一次性 userData,并在 finally 里删除(建在 output/ 内);
//   - 零删除:不碰 release/ 里的任何既有产物(解包目录是 electron-builder 的产物目录,
//     本脚本只读它);临时目录只写 output/smoke-check/。
//
// 能力缺口已填(2026-09):冒烟实现下沉到 src/main/smoke.ts → dist/main/smoke.js,
// 编译产物在 build.files 白名单内随包分发。此前 dev-only 入口进不了 app.asar,
// 打包产物收到 --smoke 会在主进程动态 import 处失败(exit 1);预检仍保留该入口的
// 存在性核对(缺则判红),但当前预期是预检通过、启动取证转绿。
//
// 用法:
//   node scripts/check-unpacked-smoke.mjs [选项]
//   node scripts/check-unpacked-smoke.mjs --unpacked <dir> --timeout <ms>
//   node scripts/check-unpacked-smoke.mjs --exe <file> --launcher <script.mjs>

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, parseArgs, toPosix } from './check-dist-manifest.mjs';
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
} from './smoke-proc.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/** 打开发布产物的默认目录(取自 build.directories.output,与 check-release-artifacts 同源) */
const DEFAULT_RELEASE_DIR = 'release';
/** electron-builder 的 win 解包目录名(写死:改名会让本检查与产物布局分叉) */
const UNPACKED_DIR_NAME = 'win-unpacked';
/** 默认临时根(output/ 内,gitignore 覆盖;通过即清空,失败时留一份日志供复现) */
const DEFAULT_SCRATCH_DIR = path.join('output', 'smoke-check', 'unpacked');
/** 失败留痕的日志文件名(仅失败时写;通过即删,不污染仓库) */
const LOG_FILE_NAME = 'unpacked-smoke.log';

const USAGE = `用法: node scripts/check-unpacked-smoke.mjs [选项]
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
 * 读 package.json 的打包口径(productName / 解包目录来源),不可读即抛可读错误。
 * @param {string} pkgPath package.json 路径
 * @returns {{ productName: string, releaseDir: string }} 打包口径
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
  };
}

/**
 * 预检:解包目录、可执行文件、app.asar 是否齐备,以及冒烟入口是否真的在包内。
 * 缺产物时给「先跑 dist 链」的可操作提示,而不是裸报错。
 * @param {object} spec 目标
 * @param {string} spec.unpackedDir 解包目录
 * @param {string | undefined} spec.exeOption --exe 显式指定的可执行文件
 * @param {{ productName: string }} spec.facts 打包口径
 * @returns {{ problems: string[], warnings: string[], exePath: string }} 预检结论
 */
function preflight({ unpackedDir, exeOption, facts }) {
  const problems = [];
  const warnings = [];
  if (!existsSync(unpackedDir) || !statSync(unpackedDir).isDirectory()) {
    problems.push(
      `解包目录不存在:${toPosix(path.relative(projectRoot, unpackedDir))};` +
        `请先运行 npm run dist(打包链会生成 <${facts.releaseDir}>/${UNPACKED_DIR_NAME}),` +
        `或用 --unpacked 指向已有解包目录`,
    );
    return { problems, warnings, exePath: '' };
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
  return { problems, warnings, exePath };
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

  const { problems, warnings, exePath } = preflight({
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

  /** @type {import('./smoke-proc.mjs').ProcessRunResult} */
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
  console.log(
    `[ok] 解包产物 smoke 通过:${toPosix(path.relative(projectRoot, exePath))}` +
      ` 以 ${SMOKE_FLAG} 启动后退出码 0,诊断标记齐备(docx 转换 / pdf 转换 / pdf 书签 / renderer 诊断 / IPC 接线);` +
      `一次性 userData 已清理,release/ 零改动`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
