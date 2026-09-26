// 安装 → 启动 smoke → 静默卸载 三步冒烟(exit 0/1),默认只预演、真实执行须显式 --execute。
//
// 用途:解包目录跑得起来不等于「装得上、装完跑得起来、卸得干净」。本脚本按发布链的真实
// 形态走一遍 NSIS 生命周期:
//   1. 静默安装(/S /D=<安装目录>)→ 校验安装目录、应用可执行文件、卸载器就位;
//   2. 从安装目录启动并跑 --smoke → 校验退出码 0 且诊断标记齐备(判定面与解包目录同构,
//      标记清单与进程硬杀等原语单一来源在 scripts/smoke-proc.mjs);
//   3. 静默卸载(<安装目录>/Uninstall <productName>.exe /S)→ 校验安装目录、开始菜单、
//      卸载注册表相对「安装前」没有新增残留(前后快照比对,不硬编码键名/图标名)。
//
// 安全硬约束(写死在本脚本内,不依赖调用方自觉):
//   - 默认预演(plan)模式:只打印将要执行的命令与将要校验的项,零系统副作用、退出码 0;
//   - 真实执行必须显式 --execute,且执行前打印醒目警告(逐条点名会被改动的系统位置);
//   - 每步都设硬超时 + 硬杀进程树,不在安装器/应用里留孤儿进程;
//   - 步骤 2 的 userData 为一次性目录(落 output/),结束即清。
//
// 用法:
//   node scripts/check-install-smoke.mjs                       # 预演(默认)
//   node scripts/check-install-smoke.mjs --install-dir <dir>    # 预演并指定安装目录
//   node scripts/check-install-smoke.mjs --execute             # 真实安装/启动/卸载

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandArtifactName } from './check-release-artifacts.mjs';
import { isMainModule, parseArgs, toPosix } from './check-dist-manifest.mjs';
import {
  collectSmokeProblems,
  createUserData,
  DEFAULT_SMOKE_TIMEOUT_MS,
  describeSmokeCommand,
  disposeUserData,
  outputTail,
  runProcess,
  runSmokeProcess,
  SMOKE_FLAG,
} from './smoke-proc.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/** 发布产物目录默认值(build.directories.output 为准,取不到时回退) */
const DEFAULT_RELEASE_DIR = 'release';
/** 默认临时根(output/ 内,gitignore 覆盖) */
const DEFAULT_SCRATCH_DIR = path.join('output', 'smoke-check', 'install');
/** 失败留痕的日志文件名(仅失败时写,通过即删) */
const LOG_FILE_NAME = 'install-smoke.log';
/** 卸载后轮询「安装目录是否消失」的上限(ms):NSIS 卸载器会派生临时副本自行完成删除 */
const UNINSTALL_POLL_MS = 120000;
/** 卸载注册表根(HKCU;electron-builder 的 NSIS 卸载项写在 HKCU) */
const UNINSTALL_REG_ROOT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

const USAGE = `用法: node scripts/check-install-smoke.mjs [选项]
  --release <dir>     发布产物目录(默认 <build.directories.output>)
  --install-dir <dir> 安装目录(默认 %ProgramFiles%\\<productName>;预演模式可任意指定,
                     真实执行会真的往该目录安装)
  --timeout <ms>      单步硬超时(ms,默认 ${DEFAULT_SMOKE_TIMEOUT_MS})
  --scratch <dir>     一次性 userData 与日志的根目录(默认 ${toPosix(DEFAULT_SCRATCH_DIR)})
  --execute           真实执行(默认只预演;执行前会打印警告)
  --help              显示本用法`;

/**
 * 一次外部命令的执行结果(与 smoke-proc 的 ProcessRunResult 同构)。
 * @typedef {import('./smoke-proc.mjs').ProcessRunResult} ProcessRunResult
 */

/**
 * 外部命令执行器(依赖注入点:真实执行走 runProcess,沙盒自测可换成记账替身)。
 * @typedef {(spec: { command: string, args: string[], timeoutMs: number }) => Promise<ProcessRunResult>} CommandRunner
 */

/**
 * smoke 启动器(依赖注入点:真实执行走 runSmokeProcess,沙盒自测可换成记账替身)。
 * @typedef {(spec: { exePath: string, userDataDir: string, timeoutMs: number }) => Promise<ProcessRunResult>} SmokeLauncher
 */

/**
 * 路径存在性判定(注入点)。
 * @typedef {(target: string) => boolean} PathProbe
 */

/**
 * 目录项名列举(注入点;目录不存在返回空数组)。
 * @typedef {(dir: string) => string[]} DirLister
 */

/**
 * 查卸载注册表里与关键字相关的键名(注入点)。
 * @typedef {(keyword: string) => Promise<string[]>} RegistryProbe
 */

/**
 * execute 路径的输入(依赖注入点齐备,便于沙盒自测在不碰系统的前提下走完真实分支)。
 * @typedef {object} InstallFlowSpec
 * @property {string} installer 安装包路径
 * @property {string} installDir 安装目录
 * @property {{ productName: string, version: string, artifactTemplate: string, releaseDir: string }} facts 打包口径
 * @property {number} timeoutMs 单步硬超时(ms)
 * @property {string} scratchRoot 一次性 userData 与日志的根目录
 * @property {CommandRunner} [run] 外部命令执行器(默认 runProcess)
 * @property {SmokeLauncher} [launchSmoke] smoke 启动器(默认 runSmokeProcess)
 * @property {PathProbe} [exists] 路径存在性判定
 * @property {DirLister} [listDir] 目录项列举
 * @property {RegistryProbe} [queryRegistry] 卸载注册表检索
 */

/** 真实执行前的醒目警告(逐条点名会被改动的系统位置) */
function buildExecuteWarning(installDir) {
  return [
    '==============================================================',
    ' 警告:即将真实执行安装 / 启动 / 卸载,会改动本机系统状态',
    `   - 安装目录:${installDir}`,
    '   - 写注册表:HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\…',
    '   - 写开始菜单:%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\…',
    '   - 需要管理员权限(UAC):装到 Program Files 时会弹 UAC,非交互环境可能失败',
    '   - 若中途失败,可能残留安装痕迹(脚本会如实报出,需人工清理)',
    ' 不带 --execute 即为预演模式:只打印计划,零副作用',
    '==============================================================',
  ];
}

/**
 * 读打包口径(productName / 版本 / 目标名模板),缺失即抛可读错误。
 * @param {string} pkgPath package.json 路径
 * @returns {{ productName: string, version: string, artifactTemplate: string, releaseDir: string }} 打包口径
 */
function readBuildFacts(pkgPath) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    throw new Error(`package.json 不可读:${error instanceof Error ? error.message : String(error)}`);
  }
  const productName = typeof pkg.build?.productName === 'string' ? pkg.build.productName : '';
  const artifactTemplate = pkg.build?.nsis?.artifactName;
  if (productName === '') throw new Error('package.json build.productName 缺失(安装目录/安装包名无从确定)');
  if (typeof artifactTemplate !== 'string' || artifactTemplate === '') {
    throw new Error('package.json build.nsis.artifactName 缺失(安装包名无从确定)');
  }
  return {
    productName,
    version: typeof pkg.version === 'string' ? pkg.version : '',
    artifactTemplate,
    releaseDir: typeof pkg.build?.directories?.output === 'string' ? pkg.build.directories.output : DEFAULT_RELEASE_DIR,
  };
}

/**
 * 默认安装目录:%ProgramFiles%\<productName>(与 electron-builder NSIS 的默认落点一致)。
 * @param {string} productName 产品名
 * @returns {string} 安装目录绝对路径
 */
function defaultInstallDir(productName) {
  const programFiles = process.env.ProgramFiles ?? process.env.PROGRAMFILES ?? 'C:\\Program Files';
  return path.join(programFiles, productName);
}

/**
 * 卸载器文件名(electron-builder 约定 `Uninstall <productName>.exe`)。
 * @param {string} productName 产品名
 * @returns {string} 文件名
 */
function uninstallerName(productName) {
  return `Uninstall ${productName}.exe`;
}

/**
 * 开始菜单「程序」目录(按用户)。
 * @returns {string} 目录绝对路径
 */
function startMenuProgramsDir() {
  const appData = process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
}

/**
 * 真实注册表检索:列出「键名或其值里含关键字」的卸载项键名。
 * 刻意用检索而不是硬编码键名 —— electron-builder 的卸载项键名带 GUID 变体,写死会随
 * 上游模板变动而误报。
 * @param {string} keyword 关键字(产品名)
 * @returns {Promise<string[]>} 命中的键名(去重、字典序;reg 不可用时返回空数组)
 */
export async function queryUninstallKeys(keyword) {
  const result = await runProcess({
    command: 'reg',
    args: ['query', UNINSTALL_REG_ROOT, '/s', '/f', keyword],
    timeoutMs: 60000,
  });
  if (result.spawnError !== undefined) return [];
  const keys = new Set();
  for (const line of result.output.split(/\r?\n/)) {
    const matched = /^\s*(HKEY_[A-Z_]+\\[^\s]+)\s*$/.exec(line);
    if (matched?.[1] !== undefined) keys.add(matched[1]);
  }
  return [...keys].sort();
}

/**
 * 轮询等待某路径消失(卸载器派生临时副本完成删除需要时间)。
 * @param {PathProbe} exists 路径判定
 * @param {string} target 目标路径
 * @param {number} timeoutMs 等待上限
 * @returns {Promise<boolean>} true = 已消失
 */
async function waitGone(exists, target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (exists(target)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return true;
}

/**
 * 把一条外部命令的结果归一成可读问题(启动失败/超时/退出码非零三态)。
 * @param {string} label 步骤标签
 * @param {ProcessRunResult} result 执行结果
 * @returns {string[]} 问题列表
 */
function commandProblems(label, result) {
  if (result.spawnError !== undefined) {
    return [`${label} 启动失败:${result.spawnError.message}`];
  }
  if (result.timedOut) {
    return [
      `${label} 超过硬超时未自行退出,已硬杀进程树` +
        `${result.unterminated === true ? '(硬杀后仍未退出,可能残留进程,请用任务管理器确认)' : ''}`,
    ];
  }
  if (result.code !== 0) return [`${label} 退出码为 ${String(result.code)},期望 0`];
  return [];
}

/**
 * 渲染单行命令行(计划打印用;含空格的参数加引号,便于人读;实际执行不经 shell)。
 * @param {string} command 可执行文件
 * @param {string[]} args 参数
 * @returns {string} 单行命令
 */
function commandLine(command, args) {
  return [command, ...args].map((part) => (/[\s"]/.test(part) ? `"${part}"` : part)).join(' ');
}

/**
 * 预演模式:只打印将要执行的命令与将要校验的项,零副作用。
 * @param {object} plan 计划内容
 * @param {string} plan.installer 安装包路径
 * @param {string} plan.installDir 安装目录
 * @param {string} plan.exePath 应用可执行文件
 * @param {string} plan.uninstaller 卸载器路径
 * @param {string[]} plan.checks 第 3 步的残留校验项说明
 * @returns {void}
 */
function printPlan({ installer, installDir, exePath, uninstaller, checks }) {
  console.log('[dry-run] install-smoke: 预演模式 —— 以下命令与校验项均不会执行,零系统副作用');
  console.log(`[dry-run] install-smoke: 步骤 1/3 静默安装:${commandLine(installer, ['/S', `/D=${installDir}`])}`);
  console.log(`[dry-run] install-smoke:   校验 安装目录存在:${installDir}`);
  console.log(`[dry-run] install-smoke:   校验 应用可执行文件存在:${exePath}`);
  console.log(`[dry-run] install-smoke:   校验 卸载器存在:${uninstaller}`);
  console.log(`[dry-run] install-smoke:   记录 卸载注册表与开始菜单的「安装前」快照(第 3 步比对基线)`);
  console.log(`[dry-run] install-smoke: 步骤 2/3 启动并跑 smoke:<安装目录下的应用> ${SMOKE_FLAG} --user-data-dir=<一次性目录>`);
  console.log('[dry-run] install-smoke:   校验 退出码为 0');
  console.log('[dry-run] install-smoke:   校验 输出含诊断标记:docx 转换 / pdf 转换 / pdf 书签 / renderer 诊断 / IPC 接线');
  console.log(`[dry-run] install-smoke: 步骤 3/3 静默卸载:${commandLine(uninstaller, ['/S'])}`);
  for (const check of checks) console.log(`[dry-run] install-smoke:   校验 ${check}`);
  console.log(
    '[dry-run] install-smoke: 真实执行请显式加 --execute(会写 Program Files / 注册表 / 开始菜单,需管理员权限)',
  );
}

/**
 * 真实执行:安装 → 启动 smoke → 静默卸载 → 残留比对。
 * @param {InstallFlowSpec} spec 参数与依赖
 * @returns {Promise<number>} 退出码(0 = 三步全过)
 */
export async function runInstallFlow(spec) {
  const {
    installer,
    installDir,
    facts,
    timeoutMs,
    scratchRoot,
    run = runProcess,
    launchSmoke = runSmokeProcess,
    exists = existsSync,
    listDir = (dir) => (existsSync(dir) ? readdirSync(dir) : []),
    queryRegistry = queryUninstallKeys,
  } = spec;

  for (const line of buildExecuteWarning(installDir)) console.log(line);

  const exePath = path.join(installDir, `${facts.productName}.exe`);
  const uninstaller = path.join(installDir, uninstallerName(facts.productName));
  const startMenuCandidates = [path.join(startMenuProgramsDir(), facts.productName)];

  // ---- 安装前快照(第 3 步的比对基线;不硬编码键名/图标名) ----
  const registryBefore = await queryRegistry(facts.productName);
  const startMenuBefore = startMenuCandidates.filter((candidate) => exists(candidate));
  const installDirExistedBefore = exists(installDir);
  if (installDirExistedBefore) {
    console.warn(`[warn] install-smoke: 安装目录已存在(${installDir}),将覆盖安装;若那是一份在用的安装,请先退出应用再重试`);
  }

  const problems = [];
  /** @type {string[]} */
  const logChunks = [];
  let userDataDir = '';

  try {
    // ---- 步骤 1:静默安装 ----
    console.log(`[info] install-smoke: 步骤 1/3 静默安装 ${commandLine(installer, ['/S', `/D=${installDir}`])}`);
    const install = await run({ command: installer, args: ['/S', `/D=${installDir}`], timeoutMs });
    logChunks.push(install.output);
    problems.push(...commandProblems('静默安装', install));
    if (problems.length > 0) {
      problems.push(
        '静默安装未成功:NSIS assisted 安装包的 /S 静默与 /D= 目标目录在无 UI 环境下可能失效;' +
          '若安装器在等待交互或被 UAC 拦下,请在交互式管理员终端重试,或先用 /S 单独验证安装器行为',
      );
    } else {
      if (!exists(installDir)) problems.push(`静默安装后安装目录不存在:${installDir}(/S 未生效或装到了别处)`);
      if (!exists(exePath)) problems.push(`静默安装后应用可执行文件不存在:${exePath}`);
      if (!exists(uninstaller)) {
        const exes = listDir(installDir).filter((name) => name.toLowerCase().endsWith('.exe'));
        problems.push(`静默安装后卸载器不存在:${uninstaller}(安装目录内的 .exe:${exes.join(', ') || '(无)'})`);
      }
    }

    // ---- 步骤 2:从安装目录启动并跑 smoke ----
    if (problems.length === 0) {
      userDataDir = createUserData(scratchRoot);
      console.log(`[info] install-smoke: 步骤 2/3 启动并跑 smoke ${describeSmokeCommand({ exePath, userDataDir })}`);
      const launch = await launchSmoke({ exePath, userDataDir, timeoutMs });
      logChunks.push(launch.output);
      problems.push(...collectSmokeProblems(launch, { label: '安装后 smoke' }));
    }

    // ---- 步骤 3:静默卸载 ----
    if (exists(uninstaller)) {
      console.log(`[info] install-smoke: 步骤 3/3 静默卸载 ${commandLine(uninstaller, ['/S'])}`);
      const uninstall = await run({ command: uninstaller, args: ['/S'], timeoutMs });
      logChunks.push(uninstall.output);
      problems.push(...commandProblems('静默卸载', uninstall));
    } else {
      console.warn('[warn] install-smoke: 跳过静默卸载(卸载器不存在,无可执行文件)');
    }

    // ---- 残留比对(相对安装前快照) ----
    if (installDirExistedBefore) {
      problems.push(`安装目录在安装前就已存在,无法判定本次安装是否留痕:${installDir}`);
    } else if (!(await waitGone(exists, installDir, Math.min(timeoutMs, UNINSTALL_POLL_MS)))) {
      problems.push(`静默卸载后安装目录仍存在:${installDir}(可能应用仍在运行或文件被占用)`);
    }
    for (const candidate of startMenuCandidates) {
      if (!startMenuBefore.includes(candidate) && exists(candidate)) {
        problems.push(`静默卸载后开始菜单痕迹仍在:${candidate}`);
      }
    }
    const registryAfter = await queryRegistry(facts.productName);
    const added = registryAfter.filter((key) => !registryBefore.includes(key));
    if (added.length > 0) problems.push(`静默卸载后仍存在卸载注册表项:${added.join(' | ')}`);
  } finally {
    if (userDataDir !== '') disposeUserData(userDataDir);
  }

  if (problems.length > 0) {
    const logPath = path.join(scratchRoot, LOG_FILE_NAME);
    // 临时根可能已被 finally 里的 userData 清理顺带删掉(或从未创建:启动步骤被跳过),
    // 留痕不能因此失败 —— 诊断写不出去等于把失败面丢了
    mkdirSync(scratchRoot, { recursive: true });
    writeFileSync(logPath, `${logChunks.join('\n')}\n`, 'utf8');
    for (const problem of problems) console.error(`[install-smoke:fail] ${problem}`);
    const merged = logChunks.join('\n');
    if (merged.trim() !== '') console.error(`[install-smoke:fail] 输出尾部:\n${outputTail(merged)}`);
    console.error(
      `[install-smoke:fail] 完整输出已留痕:${toPosix(path.relative(projectRoot, logPath))};`
        + `本脚本已改动系统状态,请据实核对并按需人工清理`,
    );
    return 1;
  }
  rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(
    '[ok] 安装/启动/卸载冒烟通过:静默安装 → 安装目录下以 ' +
      `${SMOKE_FLAG} 启动退出码 0 且诊断标记齐备 → 静默卸载后安装目录/开始菜单/卸载注册表均无新增残留;一次性 userData 已清理`,
  );
  return 0;
}

export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['execute', 'help'], values: ['release', 'install-dir', 'timeout', 'scratch'] });
  } catch (error) {
    console.error(`[install-smoke:fail] ${error.message}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const timeoutMs = options.timeout === undefined ? DEFAULT_SMOKE_TIMEOUT_MS : Number(options.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(`[install-smoke:fail] --timeout 须为正毫秒数,实际 ${String(options.timeout)}`);
    return 1;
  }

  let facts;
  try {
    facts = readBuildFacts(path.resolve(projectRoot, 'package.json'));
  } catch (error) {
    console.error(`[install-smoke:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const releaseDir = path.resolve(projectRoot, options.release ?? facts.releaseDir);
  const installDir = path.resolve(projectRoot, options['install-dir'] ?? defaultInstallDir(facts.productName));
  const scratchRoot = path.resolve(projectRoot, options.scratch ?? DEFAULT_SCRATCH_DIR);

  let installerName;
  try {
    installerName = expandArtifactName(facts.artifactTemplate, {
      productName: facts.productName,
      version: facts.version,
      ext: 'exe',
    });
  } catch (error) {
    console.error(`[install-smoke:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const installer = path.join(releaseDir, installerName);

  // 产物缺失即失败(预演模式同样要求「计划有核对对象」):提示指回 dist 链,可操作
  if (!existsSync(releaseDir) || !statSync(releaseDir).isDirectory()) {
    console.error(
      `[install-smoke:fail] 发布目录不存在:${toPosix(path.relative(projectRoot, releaseDir))};`
        + `请先运行 npm run dist(打包链会生成 ${installerName})`,
    );
    return 1;
  }
  if (!existsSync(installer) || statSync(installer).size === 0) {
    console.error(
      `[install-smoke:fail] 安装包缺失或为空:${installerName}(期望版本 ${facts.version || '未知'});`
        + `请先运行 npm run dist;若 release/ 里躺着其它版本产物,先 npm run clean:release 再重跑 dist`,
    );
    return 1;
  }

  const startMenuCandidates = [path.join(startMenuProgramsDir(), facts.productName)];
  if (!options.execute) {
    printPlan({
      installer,
      installDir,
      exePath: path.join(installDir, `${facts.productName}.exe`),
      uninstaller: path.join(installDir, uninstallerName(facts.productName)),
      checks: [
        `安装目录已消失:${installDir}`,
        ...startMenuCandidates.map((candidate) => `开始菜单痕迹已清理:${candidate}`),
        `卸载注册表无新增项(检索 ${UNINSTALL_REG_ROOT} 下含「${facts.productName}」的键)`,
      ],
    });
    return 0;
  }
  return runInstallFlow({ installer, installDir, facts, timeoutMs, scratchRoot });
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
