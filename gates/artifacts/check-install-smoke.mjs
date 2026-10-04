// 安装 → 启动 smoke → 静默卸载 三步冒烟(exit 0/1),默认只预演、真实执行须显式 --execute。
//
// 用途:解包目录跑得起来不等于「装得上、装完跑得起来、卸得干净」。本脚本按发布链的真实
// 形态走一遍 NSIS 生命周期:
//   1. 静默安装(/S /D=<安装目录>)→ 校验安装目录、应用可执行文件、卸载器就位;
//   2. 从安装目录启动并跑 --smoke → 校验退出码 0 且诊断标记齐备(判定面与解包目录同构,
//      标记清单与进程硬杀等原语单一来源在 gates/smoke/smoke-proc.mjs);
//   3. 静默卸载(<安装目录>/Uninstall <productName>.exe /S)→ 校验安装目录、开始菜单、
//      卸载注册表相对「安装前」没有新增残留(前后快照比对,不硬编码键名/图标名)。
//
// --execute 会把上面这套生命周期跑**两轮**(见 ADR-062):
//   默认支 —— 不带 PATH opt-in 开关,装完用户 PATH 必须一条都不变(用户同意的前提);
//   勾选支 —— 带 /M2W_ADD_PATH=1,装完必须恰好多出安装目录这一项,卸完后逐条同序回到基线。
// 两轮都跑完整生命周期,而不是第二轮只验 PATH:带开关装完应用也得起得来、卸得干净。
// 只跑默认支的话,写入与还原这两段逻辑在真机上一次都没执行过。
//
// 安装目录按**构建口径**推导,不猜 electron-builder 的隐式默认:build.nsis.perMachine
// 显式为 true → %ProgramFiles%\<productName>(所有用户,需提权);否则按当前用户
// → %LOCALAPPDATA%\Programs\<productName>(无需提权)。把「实际装在哪」猜错,非交互
// 环境会被 UAC 拦下,而安装器已写完注册表/开始菜单 —— 留下一条卸不掉的幽灵条目。
//
// 安全硬约束(写死在本脚本内,不依赖调用方自觉):
//   - 默认预演(plan)模式:只打印将要执行的命令与将要校验的项,零系统副作用、退出码 0;
//   - 真实执行必须显式 --execute,且执行前打印醒目警告(逐条点名会被改动的系统位置,
//     提权要求按「实际目标目录」而非固定文案);
//   - 每步都设硬超时 + 硬杀进程树,不在安装器/应用里留孤儿进程;
//   - 步骤 2 的 userData 为一次性目录(落 output/),结束即清;
//   - 失败时点名本次残留的具体键值/路径,并在未提权前提下尽力自愈;自愈只删「相对
//     安装前快照确认本次新增」的对象,安装前就存在的同名对象一律不碰;自愈不改变判定。
//
// 用法:
//   node gates/artifacts/check-install-smoke.mjs                       # 预演(默认)
//   node gates/artifacts/check-install-smoke.mjs --install-dir <dir>    # 预演并指定安装目录
//   node gates/artifacts/check-install-smoke.mjs --execute             # 真实安装/启动/卸载

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expandArtifactName } from './check-release-artifacts.mjs';
import { isMainModule, parseArgs } from '../../shared/cli.mjs';
import { toPosix } from '../../shared/fsx.mjs';
import { ROOT } from '../../shared/paths.js';
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
} from '../smoke/smoke-proc.mjs';

const projectRoot = ROOT;

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
/**
 * 用户 PATH 所在的注册表位置(自定义 NSIS 勾选框写入的就是这一处)。
 *
 * 为什么单独一条断言:卸载残留那道前后快照比对只认 startMenuTraces() 与卸载
 * 注册表两处,**HKCU\Environment 对它完全隐形** —— 装完把 PATH 改坏了、卸载又
 * 没还原,脚本报「零残留」而用户的环境里多了一截。PATH 不在任何现有检查面上。
 */
const USER_ENVIRONMENT_KEY = 'HKCU\\Environment';
/** 用户 PATH 的值名 */
const USER_PATH_VALUE = 'Path';
/** 删除卸载注册表项的硬超时(ms) */
const REGISTRY_MUTATION_TIMEOUT_MS = 30000;

/**
 * 用法文本(安装目录默认值随构建口径变化,故由函数生成而非模块级常量)。
 * @param {boolean} perMachine 构建口径是否为按机器安装
 * @returns {string} 用法文本
 */
function buildUsage(perMachine) {
  return `用法: node gates/artifacts/check-install-smoke.mjs [选项]
  --release <dir>     发布产物目录(默认 <build.directories.output>)
  --install-dir <dir> 安装目录(默认 ${defaultInstallDirHint(perMachine)};预演模式可任意指定,
                     真实执行会真的往该目录安装)
  --timeout <ms>      单步硬超时(ms,默认 ${DEFAULT_SMOKE_TIMEOUT_MS})
  --scratch <dir>     一次性 userData 与日志的根目录(默认 ${toPosix(DEFAULT_SCRATCH_DIR)})
  --execute           真实执行(默认只预演;执行前会打印警告)。会跑两轮:默认支 +
                     带 ${PATH_OPT_IN_SWITCH} 的勾选支(见 ADR-062)
  --help              显示本用法`;
}

/**
 * 一次外部命令的执行结果(与 smoke-proc 的 ProcessRunResult 同构)。
 * @typedef {import('../smoke/smoke-proc.mjs').ProcessRunResult} ProcessRunResult
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
 * 删除卸载注册表项(注入点;返回 true = 已删除)。
 * @typedef {(keyPath: string) => Promise<boolean>} RegistryKeyDeleter
 */

/**
 * 读一个注册表字符串值(注入点;值不存在返回 '')。
 * @typedef {(keyPath: string, valueName: string) => Promise<string>} RegValueReader
 */

/**
 * 跑一次 reg.exe 并返回其 stdout(注入点)。
 * @typedef {(args: string[]) => Promise<string>} RegRunner
 */

/**
 * 删除文件/目录(注入点;返回 true = 已删除)。
 * @typedef {(target: string) => boolean} PathRemover
 */

/**
 * execute 路径的输入(依赖注入点齐备,便于沙盒自测在不碰系统的前提下走完真实分支)。
 * @typedef {object} InstallFlowSpec
 * @property {string} installer 安装包路径
 * @property {string} installDir 安装目录
 * @property {{ productName: string, version: string, artifactTemplate: string, releaseDir: string, perMachine: boolean, pathOptInScript: string }} facts 打包口径
 * @property {number} timeoutMs 单步硬超时(ms)
 * @property {string} scratchRoot 一次性 userData 与日志的根目录
 * @property {boolean} [installDirOverridden] 安装目录是否由 --install-dir 显式指定
 * @property {string} [optInSwitch] PATH opt-in 开关(默认空 = 本轮不传,即「未勾选」那一支)
 * @property {string} [loopLabel] 轮次标签(只进诊断文案,不参与判定)
 * @property {CommandRunner} [run] 外部命令执行器(默认 runProcess)
 * @property {SmokeLauncher} [launchSmoke] smoke 启动器(默认 runSmokeProcess)
 * @property {PathProbe} [exists] 路径存在性判定
 * @property {DirLister} [listDir] 目录项列举
 * @property {RegistryProbe} [queryRegistry] 卸载注册表检索
 * @property {RegistryKeyDeleter} [deleteRegistryKey] 卸载注册表项删除
 * @property {PathRemover} [removePath] 文件/目录删除
 * @property {RegValueReader} [readRegValue] 读注册表字符串值(用户 PATH 断言用)
 */

/**
 * 真实执行前的醒目警告(逐条点名会被改动的系统位置)。
 *
 * 提权要求按「实际目标目录」生成而非固定文案:按用户安装写在用户级目录、根本不需要提权,
 * 无条件喊 UAC 会让预演/执行日志与事实矛盾(也会误导人去开管理员终端重试)。
 * @param {object} spec 参数
 * @param {string} spec.installDir 安装目录
 * @param {boolean} spec.perMachine 构建口径是否为按机器安装
 * @param {boolean} [spec.installDirOverridden] 安装目录是否由 --install-dir 显式指定
 * @returns {string[]} 警告行
 */
export function buildExecuteWarning({ installDir, perMachine, installDirOverridden = false }) {
  const elevated = needsElevation({ installDir, perMachine });
  return [
    '==============================================================',
    ' 警告:即将真实执行安装 / 启动 / 卸载,会改动本机系统状态',
    `   - 安装目录:${installDir}${installDirOverridden ? '(由 --install-dir 显式指定)' : '(按构建口径推导)'}`,
    `   - 安装范围:${perMachine ? '所有用户(build.nsis.perMachine = true)' : '仅当前用户(build.nsis.perMachine 未开启)'}`,
    '   - 写注册表:HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\…',
    '   - 写开始菜单:%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\…',
    '   - 写用户 PATH(仅勾选支):HKCU\\Environment\\Path 会临时多出安装目录这一项,卸载时由安装器摘掉',
    elevated
      ? '   - 提权:需要管理员权限(目标在 Program Files 下,安装器会弹 UAC;非交互环境可能被拦下)'
      : '   - 提权:不需要管理员权限(目标在用户级目录,安装器不会弹提权窗)',
    '   - 若中途失败:可能残留安装痕迹;脚本会点名具体键值/路径并在不提权的前提下尽量自愈',
    ' 不带 --execute 即为预演模式:只打印计划,零副作用',
    '==============================================================',
  ];
}

/**
 * 读打包口径(productName / 版本 / 目标名模板 / 安装范围),缺失即抛可读错误。
 * @param {string} pkgPath package.json 路径
 * @returns {{ productName: string, version: string, artifactTemplate: string, releaseDir: string, perMachine: boolean }} 打包口径
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
    // 只认显式 true:electron-builder 的 perMachine 不设时按当前用户安装(实测安装器
    // 写出的 UninstallString 带 /currentuser,故不猜隐式默认 —— 猜错会把非交互环境
    // 的安装按到 Program Files、被 UAC 拦下,却已留下注册表/开始菜单痕迹)。
    perMachine: pkg.build?.nsis?.perMachine === true,
    // 勾选框写 PATH 这件事由 build.nsis.include 挂载的自定义 NSIS 脚本实现。
    // 期望值从这里派生而不是写死字符串:门禁自带一份与配置无关的期望,配置改了
    // 门禁不跟变,就成了漂移校验。include 缺失 = 本仓没有这个能力,断言随之
    // 退化为「PATH 必须原封不动」,而不是凭空要求某一截增量。
    pathOptInScript:
      typeof pkg.build?.nsis?.include === 'string' && pkg.build.nsis.include !== ''
        ? pkg.build.nsis.include
        : '',
  };
}

/** Program Files 根(按机器安装的落点)。@returns {string} 绝对路径 */
function programFilesRoot(env = process.env) {
  return env.ProgramFiles ?? env.PROGRAMFILES ?? 'C:\\Program Files';
}

/** 当前用户的 LocalAppData 根(按用户安装的父目录)。@returns {string} 绝对路径 */
function localAppDataRoot(env = process.env) {
  return env.LOCALAPPDATA ?? path.join(env.USERPROFILE ?? '', 'AppData', 'Local');
}

/**
 * 默认安装目录:按构建口径推导,不猜 electron-builder 的隐式默认。
 *
 * perMachine === true → %ProgramFiles%\<productName>(所有用户,需提权);
 * 否则 → %LOCALAPPDATA%\Programs\<productName>(当前用户,无需提权)。
 * @param {{ productName: string, perMachine: boolean }} facts 打包口径
 * @param {NodeJS.ProcessEnv} [env] 环境(注入点:沙盒自测可指定假环境变量)
 * @returns {string} 安装目录绝对路径
 */
export function defaultInstallDir({ productName, perMachine }, env = process.env) {
  return perMachine ? path.join(programFilesRoot(env), productName) : path.join(localAppDataRoot(env), 'Programs', productName);
}

/**
 * 默认安装目录的可读形态(用法文本用;真实路径随环境变化,只在 --help 里给占位说明)。
 * @param {boolean} perMachine 构建口径是否为按机器安装
 * @returns {string} 目录模板
 */
function defaultInstallDirHint(perMachine) {
  return perMachine ? '%ProgramFiles%\\<productName>' : '%LOCALAPPDATA%\\Programs\\<productName>';
}

/**
 * 目标目录是否需要提权(与「按机器/按用户」是两个维度:显式 --install-dir 可能把按用户
 * 构建指到 Program Files 下,那一步照样要 UAC)。
 * @param {object} spec 参数
 * @param {string} spec.installDir 安装目录
 * @param {boolean} spec.perMachine 构建口径是否为按机器安装
 * @returns {boolean} true = 需要管理员权限
 */
function needsElevation({ installDir, perMachine }) {
  if (perMachine) return true;
  return installDir.toLowerCase().startsWith(`${programFilesRoot().toLowerCase()}${path.sep}`);
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
 * @param {NodeJS.ProcessEnv} [env] 环境(注入点)
 * @returns {string} 目录绝对路径
 */
function startMenuProgramsDir(env = process.env) {
  const appData = env.APPDATA ?? path.join(env.USERPROFILE ?? '', 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
}

/**
 * 开始菜单里本产品可能留下的痕迹。
 *
 * 必须同时覆盖「.lnk 快捷方式」与「同名目录」两种形态:只查目录会漏掉实测里真实发生的
 * 那一种(安装器写的是 `<productName>.lnk` 文件),残留检查对文件形态完全失明,用户就在
 * 「应用」里看到一条卸不掉的条目而脚本报「无残留」。
 * @param {string} productName 产品名
 * @returns {{ kind: 'shortcut' | 'dir', path: string }[]} 痕迹位置
 */
export function startMenuTraces(productName) {
  const dir = startMenuProgramsDir();
  return [
    { kind: 'shortcut', path: path.join(dir, `${productName}.lnk`) },
    { kind: 'dir', path: path.join(dir, productName) },
  ];
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
 * 跑 reg.exe 并返回 stdout(注入点实现)。
 *
 * 只读,不写任何键 —— 本函数被 PATH 断言使用,而 PATH 是用户的真实环境,
 * 门禁绝不能顺手改它。reg 不可用时返回空串(调用方据此判定「读不到」)。
 * @param {string[]} args reg 参数
 * @returns {Promise<string>} stdout(失败时为空串)
 */
export async function runRegQuery(args) {
  const result = await runProcess({ command: 'reg', args, timeoutMs: REGISTRY_MUTATION_TIMEOUT_MS });
  if (result.spawnError !== undefined) return '';
  return result.code === 0 ? result.output : '';
}

/**
 * 读一个注册表字符串值。值不存在时返回 '' —— 与「存在但为空」不可区分,
 * 故调用方只在比较「前后是否一致」时用它,不依赖这个区分。
 * @param {string} keyPath 完整键路径
 * @param {string} valueName 值名
 * @returns {Promise<string>} 值内容(读不到时为空串)
 */
export async function readRegStringValue(keyPath, valueName) {
  const out = await runRegQuery(['query', keyPath, '/v', valueName]);
  // reg 的输出是「值名<4 空格>REG_SZ<4 空格>数据」,数据可能含空格与分号,
  // 故按「前两个分隔段之后全部」切分,而不是按空格切。
  const match = /^\s{4}\S+\s{4}REG_[A-Z_]+\s{4}(.*)$/m.exec(out);
  return match?.[1] ?? '';
}

/**
 * 把用户 PATH 切成条目数组(仅用于比较,不改写原值)。
 *
 * 空项(;;)被丢弃:Windows 解析 PATH 时忽略空项,保留它们只会让「装完前后
 * 语义相同但写法不同」被误判成改动。
 * @param {string} value PATH 原始值
 * @returns {string[]} 非空条目
 */
export function splitPathEntries(value) {
  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * 用户 PATH 相对基准是否发生了非预期改动。
 *
 * 判定按**条目集合的增删**而非整串相等:安装器在末尾追加一项,顺序不动,
 * 整串必然变;而用户在两次快照之间自己改了 PATH,那是用户的行为,门禁管不了
 * 也不该管。真正要抓的是「装完多了一截 / 卸完没还原 / 卸完少了用户原有的」。
 *
 * 返回值把两个具名结论**都**带出来(`unchanged` / `consented`),而 ok 只是
 * 「按阶段哪个合法」的合成结果。调用方要「必须恰好是勾选后的那一种」时,必须
 * 断具名的那一个,不能断 ok —— ok 在 after-install 阶段对两种都放行,直接用它
 * 就等于把「本该多一条却没多」当成通过。
 * @param {object} spec 参数
 * @param {string} spec.before 比较基准 PATH
 * @param {string} spec.after 实测 PATH
 * @param {string} [spec.installDir] 安装目录(after-install 阶段合法的单条增量)
 * @param {'after-install' | 'after-uninstall'} [spec.phase] 比对阶段
 * @returns {{ added: string[], removed: string[], unchanged: boolean, consented: boolean, ok: boolean }} 相对基准的增删条目与判定
 */
export function diffPathEntries({ before, after, installDir = '', phase = 'after-uninstall' }) {
  const beforeSet = new Set(splitPathEntries(before));
  const afterSet = new Set(splitPathEntries(after));
  const added = [...afterSet].filter((entry) => !beforeSet.has(entry));
  const removed = [...beforeSet].filter((entry) => !afterSet.has(entry));
  const unchanged = added.length === 0 && removed.length === 0;
  // 两个阶段各有各的合法结局,混在一起判就会漏:
  //   after-install —— 未勾选则一条不变;勾选则恰好多出安装目录这一项。
  //   after-uninstall —— **必须回到原值**。即便用户勾选过、PATH 里合法地
  //     多过安装目录那一项,卸载后它也该被摘掉;还留着就是卸载摘不掉。
  //     早先的写法在这里也放过「多出安装目录」,那正好是本断言最该抓的残留,
  //     等于给最关键的失败面开了口子。
  const consented = added.length === 1 && added[0] === installDir && removed.length === 0;
  const ok = phase === 'after-install' ? unchanged || consented : unchanged;
  return { added, removed, unchanged, consented, ok };
}

/**
 * 逐条同序比较两个 PATH 的条目(比 diffPathEntries 更严:它只比集合增删)。
 *
 * 为什么卸完还要这一道:「回到基线」的字面要求是**逐条同序**,而集合相等放过
 * 「条目都在但被重排了」。重排对用户同样有影响(优先级变了),且它恰好是「用
 * 拼接/拆分重建 PATH 而不是精确还原」这类实现错误的典型症状 —— 那种错误在
 * 集合口径下完全隐形。
 * @param {string} before 基线 PATH
 * @param {string} after 实测 PATH
 * @returns {{ same: boolean, beforeEntries: string[], afterEntries: string[] }} 逐条比较结论与两侧条目
 */
export function samePathEntries(before, after) {
  const beforeEntries = splitPathEntries(before);
  const afterEntries = splitPathEntries(after);
  const same =
    beforeEntries.length === afterEntries.length &&
    beforeEntries.every((entry, index) => entry === afterEntries[index]);
  return { same, beforeEntries, afterEntries };
}

/**
 * 删除一个卸载注册表项(HKCU;用户级键不提权即可删)。
 * @param {string} keyPath 完整键路径
 * @returns {Promise<boolean>} true = 已删除
 */
export async function deleteUninstallKey(keyPath) {
  const result = await runProcess({
    command: 'reg',
    args: ['delete', keyPath, '/f'],
    timeoutMs: REGISTRY_MUTATION_TIMEOUT_MS,
  });
  return result.spawnError === undefined && result.code === 0;
}

/**
 * 删除一个文件/目录(EBUSY 重试;失败返回 false 而不抛 —— 自愈不得把失败面吞掉)。
 * @param {string} target 目标路径
 * @returns {boolean} true = 已删除
 */
export function removeResiduePath(target) {
  try {
    rmSync(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 200 });
  } catch {
    return false;
  }
  return !existsSync(target);
}

/**
 * 人工清理命令原文(自愈失败时给用户照抄的凭据,不能只说「需人工清理」)。
 * @param {object} item 残留项
 * @param {'registry' | 'shortcut' | 'dir'} item.kind 残留类型
 * @param {string} item.path 键路径或文件/目录路径
 * @returns {string} 命令原文
 */
function manualCleanupCommand({ kind, path: target }) {
  if (kind === 'registry') return `reg delete "${target}" /f`;
  return kind === 'shortcut' ? `del /f /q "${target}"` : `rmdir /s /q "${target}"`;
}

/**
 * 相对「安装前」快照判定本次运行新增的残留(只认新增 —— 安装前就存在的同名对象属于
 * 既有安装,删它就是误删用户的东西)。
 * @param {object} spec 参数
 * @param {string} spec.productName 产品名
 * @param {string} spec.installDir 安装目录
 * @param {boolean} spec.installDirExistedBefore 安装目录在安装前是否已存在
 * @param {string[]} spec.registryBefore 安装前的卸载注册表键
 * @param {string[]} spec.startMenuBefore 安装前已存在的开始菜单痕迹路径
 * @param {RegistryProbe} spec.queryRegistry 卸载注册表检索
 * @param {PathProbe} spec.exists 路径存在性判定
 * @returns {Promise<{ registryKeys: string[], startMenuPaths: string[], installDirPath: string | null }>} 本次新增残留
 */
async function collectRunResidue({
  productName,
  installDir,
  installDirExistedBefore,
  registryBefore,
  startMenuBefore,
  queryRegistry,
  exists,
}) {
  const registryAfter = await queryRegistry(productName);
  const registryKeys = registryAfter.filter((key) => !registryBefore.includes(key));
  const startMenuPaths = startMenuTraces(productName)
    .map((trace) => trace.path)
    .filter((target) => !startMenuBefore.includes(target) && exists(target));
  return {
    registryKeys,
    startMenuPaths,
    installDirPath: installDirExistedBefore || !exists(installDir) ? null : installDir,
  };
}

/**
 * 把残留摊平成可点名、可自愈的清单(键与路径原样带出,便于人工核对)。
 * @param {{ registryKeys: string[], startMenuPaths: string[], installDirPath: string | null }} residue 残留
 * @returns {{ kind: 'registry' | 'shortcut' | 'dir', path: string }[]} 残留项
 */
function residueItems(residue) {
  /** @type {{ kind: 'registry' | 'shortcut' | 'dir', path: string }[]} */
  const items = residue.registryKeys.map((key) => ({ kind: /** @type {const} */ ('registry'), path: key }));
  for (const target of residue.startMenuPaths) {
    items.push({ kind: target.toLowerCase().endsWith('.lnk') ? 'shortcut' : 'dir', path: target });
  }
  if (residue.installDirPath !== null) items.push({ kind: 'dir', path: residue.installDirPath });
  return items;
}

/**
 * 尽力自愈本次新增的残留:逐项删除,成功记「已清理」、失败记「需人工执行」。
 *
 * 前提是传入的残留已由 collectRunResidue 按安装前/后快照确认「本次新增」;这里不
 * 再二次判断归属。自愈不改变主判定 —— 判红的根因(卸载没清干净)另行上报。
 * @param {{ kind: 'registry' | 'shortcut' | 'dir', path: string }[]} items 残留项
 * @param {object} deps 依赖
 * @param {RegistryKeyDeleter} deps.deleteRegistryKey 注册表项删除
 * @param {PathRemover} deps.removePath 文件/目录删除
 * @returns {Promise<{ healed: string[], failed: string[] }>} 已清理 / 需人工处理
 */
async function healResidue(items, { deleteRegistryKey, removePath }) {
  /** @type {string[]} */
  const healed = [];
  /** @type {string[]} */
  const failed = [];
  for (const item of items) {
    const done =
      item.kind === 'registry' ? await deleteRegistryKey(item.path) : removePath(item.path);
    const label = `${item.kind === 'registry' ? '卸载注册表项' : item.kind === 'shortcut' ? '开始菜单快捷方式' : '目录'} ${item.path}`;
    if (done) healed.push(label);
    else failed.push(`${label} —— 需人工执行:${manualCleanupCommand(item)}`);
  }
  return { healed, failed };
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
 * @param {boolean} plan.perMachine 构建口径是否为按机器安装
 * @returns {void}
 */
function printPlan({ installer, installDir, exePath, uninstaller, checks, perMachine }) {
  console.log('[dry-run] install-smoke: 预演模式 —— 以下命令与校验项均不会执行,零系统副作用');
  console.log(
    `[dry-run] install-smoke: 安装范围:${perMachine ? '所有用户(需管理员权限)' : '仅当前用户(无需管理员权限)'},` +
      `安装目录按构建口径推导(可用 --install-dir 覆盖)`,
  );
  console.log(`[dry-run] install-smoke: 步骤 1/3 静默安装:${commandLine(installer, ['/S', `/D=${installDir}`])}`);
  console.log(
    `[dry-run] install-smoke: 本次 --execute 会跑**两轮**完整生命周期:`
      + `默认支(不带 PATH 开关,期望装完一条不变) + 勾选支(带 ${PATH_OPT_IN_SWITCH},期望恰好多出安装目录这一项)`,
  );
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
    `[dry-run] install-smoke: 真实执行请显式加 --execute(会写 ${perMachine ? 'Program Files' : '用户级安装目录'} / 注册表 / 开始菜单` +
      `${perMachine ? ',需管理员权限,非交互环境可能被 UAC 拦下' : ',无需管理员权限'})`,
  );
}

/**
 * 真实执行:安装 → 启动 smoke → 静默卸载 → 残留比对。
 *
 * 一轮 = 一次完整的生命周期。「带不带 PATH opt-in 开关」是这一层的**参数**
 * (`optInSwitch`),不是两套流程:两轮必须走同一段代码,否则「默认支绿、勾选支红」
 * 到底是行为差异还是实现分叉就分不清了。
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
    installDirOverridden = false,
    optInSwitch = '',
    loopLabel = '',
    run = runProcess,
    launchSmoke = runSmokeProcess,
    exists = existsSync,
    listDir = (dir) => (existsSync(dir) ? readdirSync(dir) : []),
    queryRegistry = queryUninstallKeys,
    deleteRegistryKey = deleteUninstallKey,
    removePath = removeResiduePath,
    readRegValue = readRegStringValue,
  } = spec;

  // 轮次标签只出现在**诊断**文案里,不参与判定:它让「两轮里哪一轮红了」一眼可辨,
  // 但不改变任何通过/失败结论(否则给标签就能操纵门禁)。
  const tag = loopLabel === '' ? '' : `[${loopLabel}] `;
  // ⚠ opt-in 开关必须排在 /D= **之前**,这是 NSIS 的硬约束,不是风格问题:
  // `/D=` 会把「从 /D= 到行尾」整段都当成安装目录。实测把开关放在 /D= 之后时,
  // 真安装器把 InstallLocation 写成了
  //   "C:\...\Programs\MarkdownToWord M2W_ADD_PATH=1"
  // 于是装到了一个不存在的目录、勾选支的 PATH 断言随之判红 —— 而报错信息
  // (「安装目录不存在」)完全指不到真正的原因。故此处固定这个次序,勿调换。
  const installArgs = optInSwitch === '' ? ['/S', `/D=${installDir}`] : ['/S', optInSwitch, `/D=${installDir}`];

  for (const line of buildExecuteWarning({ installDir, perMachine: facts.perMachine, installDirOverridden })) {
    console.log(tag + line);
  }

  const exePath = path.join(installDir, `${facts.productName}.exe`);
  const uninstaller = path.join(installDir, uninstallerName(facts.productName));
  const startMenuCandidates = startMenuTraces(facts.productName).map((trace) => trace.path);

  // ---- 安装前快照(第 3 步的比对基线;不硬编码键名/图标名) ----
  const registryBefore = await queryRegistry(facts.productName);
  const startMenuBefore = startMenuCandidates.filter((candidate) => exists(candidate));
  const installDirExistedBefore = exists(installDir);
  // 用户 PATH 的「安装前」基线。勾选框写的就是这一处,而它不在开始菜单/卸载
  // 注册表任何一条现有检查面上,不单独取快照就等于对它完全失明。
  const pathBefore = await readRegValue(USER_ENVIRONMENT_KEY, USER_PATH_VALUE);
  if (installDirExistedBefore) {
    console.warn(`[warn] ${tag}install-smoke: 安装目录已存在(${installDir}),将覆盖安装;若那是一份在用的安装,请先退出应用再重试`);
  }

  const problems = [];
  /** @type {string[]} */
  const logChunks = [];
  let userDataDir = '';
  // 「装完」这一刻的 PATH 快照。必须在此刻取并存到轮次末尾:等到断言阶段再读,
  // 卸载早已跑完,「装完」就恒等于「卸完」,两个数字看着一致却毫无信息量。
  // 初值取基线,保证「安装失败没走到那一步」时也不会拿空串去比。
  let pathAfterInstall = pathBefore;

  try {
    // ---- 步骤 1:静默安装 ----
    console.log(`[info] ${tag}install-smoke: 步骤 1/3 静默安装 ${commandLine(installer, installArgs)}`);
    const install = await run({ command: installer, args: installArgs, timeoutMs });
    logChunks.push(install.output);
    problems.push(...commandProblems('静默安装', install).map((line) => tag + line));
    if (problems.length > 0) {
      problems.push(
        facts.perMachine
          ? '静默安装未成功:NSIS assisted 安装包的 /S 静默与 /D= 目标目录在无 UI 环境下可能失效;' +
              '若安装器在等待交互或被 UAC 拦下,请在交互式管理员终端重试,或先用 /S 单独验证安装器行为'
          : '静默安装未成功:本次为按用户安装(目标在用户级目录、不需要提权),请优先怀疑 /S 静默未生效;' +
              'assisted 安装包在无 UI 环境下可能仍弹界面,请在交互式终端重试,或先用 /S 单独验证安装器行为',
      );
    } else {
      if (!exists(installDir)) problems.push(`${tag}静默安装后安装目录不存在:${installDir}(/S 未生效或装到了别处)`);
      if (!exists(exePath)) problems.push(`${tag}静默安装后应用可执行文件不存在:${exePath}`);
      if (!exists(uninstaller)) {
        const exes = listDir(installDir).filter((name) => name.toLowerCase().endsWith('.exe'));
        problems.push(`${tag}静默安装后卸载器不存在:${uninstaller}(安装目录内的 .exe:${exes.join(', ') || '(无)'})`);
      }
      // 装完这一刻的 PATH。两轮走**同一个** diffPathEntries,但要求不同的具名结论:
      //   默认轮(optInSwitch 为空):必须 unchanged —— 一条都不许动。
      //   勾选轮(optInSwitch 非空):必须 consented —— 恰好多出安装目录这一项。
      // 这里断的是具名结论而不是 ok:ok 在 after-install 阶段对 unchanged 与 consented
      // 都放行,用它就等于「勾了却没生效」也算通过 —— 那正是本轮要抓的失败面。
      pathAfterInstall = await readRegValue(USER_ENVIRONMENT_KEY, USER_PATH_VALUE);
      const installDiff = diffPathEntries({
        before: pathBefore,
        after: pathAfterInstall,
        installDir,
        phase: 'after-install',
      });
      const installVerdict = optInSwitch === '' ? installDiff.unchanged : installDiff.consented;
      if (!installVerdict) {
        problems.push(
          `${tag}静默安装后用户 PATH 不符合本轮期望(${USER_ENVIRONMENT_KEY}\\${USER_PATH_VALUE}):` +
            `多出:${installDiff.added.join(' | ') || '(无)'};` +
            `缺失:${installDiff.removed.join(' | ') || '(无)'};` +
            `期望:${optInSwitch === '' ? '一条都不变(未勾选,/S 下勾选页不跑)' : `恰好多出安装目录这一项(${installDir})`}。`,
        );
      }
    }

    // ---- 步骤 2:从安装目录启动并跑 smoke ----
    if (problems.length === 0) {
      userDataDir = createUserData(scratchRoot);
      console.log(`[info] ${tag}install-smoke: 步骤 2/3 启动并跑 smoke ${describeSmokeCommand({ exePath, userDataDir })}`);
      const launch = await launchSmoke({ exePath, userDataDir, timeoutMs });
      logChunks.push(launch.output);
      problems.push(...collectSmokeProblems(launch, { label: `${tag}安装后 smoke` }));
    }

    // ---- 步骤 3:静默卸载 ----
    if (exists(uninstaller)) {
      console.log(`[info] ${tag}install-smoke: 步骤 3/3 静默卸载 ${commandLine(uninstaller, ['/S'])}`);
      const uninstall = await run({ command: uninstaller, args: ['/S'], timeoutMs });
      logChunks.push(uninstall.output);
      problems.push(...commandProblems('静默卸载', uninstall).map((line) => tag + line));
    } else {
      console.warn(`[warn] ${tag}install-smoke: 跳过静默卸载(卸载器不存在,无可执行文件)`);
    }

    // ---- 残留比对(相对安装前快照)+ 尽力自愈(只删本次新增) ----
    if (installDirExistedBefore) {
      problems.push(`${tag}安装目录在安装前就已存在,无法判定本次安装是否留痕:${installDir}`);
    } else if (!(await waitGone(exists, installDir, Math.min(timeoutMs, UNINSTALL_POLL_MS)))) {
      problems.push(`${tag}静默卸载后安装目录仍存在:${installDir}(可能应用仍在运行或文件被占用)`);
    }
    const residue = await collectRunResidue({
      productName: facts.productName,
      installDir,
      installDirExistedBefore,
      registryBefore,
      startMenuBefore,
      queryRegistry,
      exists,
    });
    const residueItemsToClean = residueItems(residue);
    if (residueItemsToClean.length > 0) {
      // 根因入 problems:即便自愈把痕迹全清掉,「安装/卸载没留下干净的系统」这件事本身
      // 仍是失败 —— 自愈只减少用户善后成本,不能把判定洗成绿。
      problems.push(
        `${tag}本次运行新增了安装残留(相对「安装前」快照确认,共 ${residueItemsToClean.length} 项;` +
          `安装前就存在的同名对象不属本次、一律不清理):` +
          `${residueItemsToClean.map((item) => item.path).join(' | ')}`,
      );
      const heal = await healResidue(residueItemsToClean, { deleteRegistryKey, removePath });
      for (const label of heal.healed) console.log(`[install-smoke:heal] ${tag}已自动清理:${label}`);
      for (const line of heal.failed) problems.push(`${tag}本次新增的残留未能自动清理:${line}`);
    }

    // ---- 用户 PATH 断言(独立于上面那道残留比对:它够不着 HKCU\Environment) ----
    // 期望值从 build.nsis.include 派生(装了自定义 NSIS ⇒ 这个能力存在 ⇒ 断言
    // PATH 相对安装前不得有非预期增删),不是把某一截字符串抄进门禁。
    //
    // 卸载后的口径:**逐条同序**回到基线,不只是集合无增删。
    // 集合口径放过「条目都在但被重排」,而重排恰好是「用拼接/拆分重建 PATH 而
    // 不是精确还原」这类实现错误的典型症状(那种错误在集合口径下完全隐形),
    // 且重排会改掉用户各条目的优先级。
    //
    // ⚠ 「装完」的计数取自**步骤 1 当时**存下的快照。早先的写法在这里又读了一次
    // 实时值 —— 那时卸载早已跑完,于是「装完」永远等于「卸完」,两个数字看着
    // 一致却毫无信息量(勾选轮要报的正是「装完比装前多一条」)。
    const pathAfter = await readRegValue(USER_ENVIRONMENT_KEY, USER_PATH_VALUE);
    const pathDiff = diffPathEntries({
      before: pathBefore,
      after: pathAfter,
      installDir,
      phase: 'after-uninstall',
    });
    const ordered = samePathEntries(pathBefore, pathAfter);
    const pathEntriesBefore = splitPathEntries(pathBefore).length;
    const pathEntriesAfterInstall = splitPathEntries(pathAfterInstall).length;
    const pathEntriesAfter = ordered.afterEntries.length;
    if (!pathDiff.ok) {
      const detail =
        `多出:${pathDiff.added.length > 0 ? pathDiff.added.join(' | ') : '(无)'}`
        + `;缺失:${pathDiff.removed.length > 0 ? pathDiff.removed.join(' | ') : '(无)'}`;
      problems.push(
        `${tag}卸载后用户 PATH 未回到「安装前」(${USER_ENVIRONMENT_KEY}\\${USER_PATH_VALUE};` +
          `勾选框由 build.nsis.include=${facts.pathOptInScript || '(未配置)'} 提供):${detail}。` +
          `多出来的是卸载摘不掉的残留,少掉的是误伤了用户原有配置 —— 两者都要判红。`,
      );
    } else if (!ordered.same) {
      problems.push(
        `${tag}卸载后用户 PATH 的条目集合没变但**逐条同序**没回到基线` +
          `(条目被重排,会改掉各条目的优先级):`
          + `期望[${ordered.beforeEntries.join(' | ')}];实测[${ordered.afterEntries.join(' | ')}]。`,
      );
    } else {
      // 「断言跑了」与「跑到了且通过」必须可分辨:结论行带计数与三个阶段的条目数,
      // 不只靠 exit 0。本仓有守卫静默退 0 骗过门禁的前科。
      console.log(
        `[ok] ${tag}install-smoke: 用户 PATH 断言已执行(2 个阶段均跑到)—— `
          + `${USER_ENVIRONMENT_KEY}\\${USER_PATH_VALUE} 条目数:`
          + `安装前 ${pathEntriesBefore} → 装完 ${pathEntriesAfterInstall} → 卸完 ${pathEntriesAfter};`
          + `非预期增删 0 项;逐条同序与基线一致;判据来源 build.nsis.include=${facts.pathOptInScript || '(未配置)'}`,
      );
    }
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
        + `本脚本已改动系统状态,请据实核对(残留已逐项点名并尽量自动清理,标「需人工执行」的照抄命令即可)`,
    );
    return 1;
  }
  rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(
    `[ok] ${tag}安装/启动/卸载冒烟通过:静默安装 → 安装目录下以 ` +
      `${SMOKE_FLAG} 启动退出码 0 且诊断标记齐备 → 静默卸载后安装目录/开始菜单/卸载注册表均无新增残留;一次性 userData 已清理`,
  );
  return 0;
}

/**
 * PATH opt-in 开关名,与 build-assets/installer.nsh 里的 !define 同名同值。
 *
 * 为什么门禁里写死这一行、而不是去解析 installer.nsh:解析 NSIS 源码去取一个
 * !define 的值,会把门禁绑死在「脚本语法」上(改个引号风格就读不到了),而这不是
 * 门禁该负责的事。两处同名的代价是「改开关名要同时改两处」,已写进 ADR-062;
 * 反过来若门禁从脚本推导,开关名写错时门禁会跟着一起错、判定恒绿 —— 那更糟。
 * ⚠ 改 installer.nsh 的 !define 时,这里必须同步。
 */
const PATH_OPT_IN_SWITCH = '/M2W_ADD_PATH=1';

/**
 * 真实执行:**两轮**完整生命周期。
 *
 * 为什么必须两轮:第一轮(默认)证明「不勾选 ⇒ PATH 一条不变」这条用户同意的前提
 * 没被绕过;第二轮(带开关)证明「勾选 ⇒ 恰好多出安装目录这一项,且卸载后逐条同序
 * 回到基线」。只跑第一轮的话,写入与还原这两段代码在真机上一次都没执行过 ——
 * 它们此前只在注释与推理层面成立。
 *
 * 两轮都跑完整生命周期(装 → 启动 smoke → 卸),而不是「第一轮跑全流程、第二轮
 * 只跑 PATH」:第二轮同样要确认「带开关安装后应用仍然起得来、卸载仍然干净」。
 *
 * 轮次顺序固定为「默认 → 勾选」:先跑不写 PATH 的那轮,，万一它就出了问题,不会
 * 在已经动过用户 PATH 的状态上叠加第二个变量。
 *
 * @param {Omit<InstallFlowSpec, 'optInSwitch' | 'loopLabel'>} baseSpec 两轮共用的参数与依赖
 * @returns {Promise<number>} 退出码(0 = 两轮全过)
 */
export async function runInstallFlowBothLoops(baseSpec) {
  const loops = [
    { loopLabel: '默认支', optInSwitch: '' },
    { loopLabel: '勾选支', optInSwitch: PATH_OPT_IN_SWITCH },
  ];
  /** @type {number[]} */
  const codes = [];
  for (const { loopLabel, optInSwitch } of loops) {
    console.log(`\n[info] install-smoke: ===== ${loopLabel}${optInSwitch === '' ? '(不带 PATH 开关)' : `(带 PATH 开关 ${optInSwitch})`} =====`);
    codes.push(await runInstallFlow({ ...baseSpec, optInSwitch, loopLabel }));
  }
  // 两轮都跑完再汇总:任一轮红了仍要把另一轮跑完,否则「是开关的问题还是安装
  // 本身的问题」无从分辨 —— 而这正是两轮相对于一轮的全部价值。
  const failed = loops.filter((_, index) => codes[index] !== 0).map((loop) => loop.loopLabel);
  if (failed.length > 0) {
    console.error(`[install-smoke:fail] 两轮中判红:${failed.join('、')}(两轮均已执行完毕)`);
    return 1;
  }
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
    // 用法文本要给出「默认安装目录」,而该目录随构建口径变化:读一次 build 口径即可
    // (读失败也照常给用法 —— --help 不该被配置问题挡住,按按用户口径兜底)
    let perMachine = false;
    try {
      perMachine = readBuildFacts(path.resolve(projectRoot, 'package.json')).perMachine;
    } catch {
      perMachine = false;
    }
    console.log(buildUsage(perMachine));
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
  const installDirOverridden = typeof options['install-dir'] === 'string';
  const installDir = path.resolve(projectRoot, options['install-dir'] ?? defaultInstallDir(facts));
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

  const startMenuCandidates = startMenuTraces(facts.productName).map((trace) => trace.path);
  if (!options.execute) {
    printPlan({
      installer,
      installDir,
      exePath: path.join(installDir, `${facts.productName}.exe`),
      uninstaller: path.join(installDir, uninstallerName(facts.productName)),
      perMachine: facts.perMachine,
      checks: [
        `安装目录已消失:${installDir}`,
        ...startMenuCandidates.map((candidate) => `开始菜单痕迹已清理:${candidate}`),
        `卸载注册表无新增项(检索 ${UNINSTALL_REG_ROOT} 下含「${facts.productName}」的键)`,
        `用户 PATH 相对「安装前」无非预期增删(${USER_ENVIRONMENT_KEY}\\${USER_PATH_VALUE})——`
          + `默认支期望一条都不变,勾选支期望恰好多出安装目录这一项;卸完后两支都须逐条同序回到基线;`
          + `勾选框来自 build.nsis.include=${facts.pathOptInScript || '(未配置)'}`,
      ],
    });
    return 0;
  }
  return runInstallFlowBothLoops({ installer, installDir, facts, timeoutMs, scratchRoot, installDirOverridden });
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
