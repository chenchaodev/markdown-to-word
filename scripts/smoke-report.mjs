// 冒烟结果的机器可读报告(把「一次 --smoke 运行的 stdout 文本标记 + 退出码」归一成
// CI 可结构化消费的 JSON 产物;判定口径**只读**既有契约,不放水、不改口径)。
//
// 存在理由:冒烟取证此前只有 stdout 的 5 条文本标记与进程退出码,CI 侧要判断
// 「哪条标记缺失 / 有没有非致命降级 / 这次到底跑没跑」只能正则捞文本,捞不到就
// 只能当没跑。本脚本把那层判定抽成结构化产物:
//   - markers[]:逐条标记的 present/absent(清单单源在 scripts/smoke-proc.mjs 的
//     SMOKE_MARKERS,与发布侧检查逐字同源,不会两处漂移);
//   - markerContract / missingMarkers:缺失项清单(按标记 label 点名);
//   - exitCode / timedOut / unterminated:退出面;
//   - degradations[]:非致命降级留痕行(当前只有 pdf 降级一类,见 DEGRADATION_TOKENS),
//     降级**不判红**(判定口径是「标记齐 + 退出码 0」,与 src/main/smoke.ts 的
//     throw → app.exit(1) 失败路径保持一致),但必须可见、不静默;
//   - problems[]:直接复用 collectSmokeProblems 的问题列表(同源,故本脚本不重写
//     判定规则;缺的只是结构化表达)。
//
// 两种来源(dev 侧与解包产物)都产出同形状报告:
//   --source dev       :以 electron 启动仓库根(等价 npm run test:smoke 的启动面)
//   --source unpacked  :以解包目录里的应用 exe 启动(等价 check-unpacked-smoke 的启动面)
//
// 硬纪律:
//   1. 判定不放水:缺失标记/非零退出/超时/启动失败一律 fail,报告与退出码同步。
//   2. 不伪造:本机没有 Electron、解包目录不存在、dist 未构建 → 报「未执行」
//      (status=not-run, executed=false)并以**非 0** 退出(EXIT.notRun=2),
//      绝不产出一份「看起来通过」的报告。CI 必须把 2 与 0 区分开。
//   3. 产物可复现:报告 JSON **不含时间戳、不含绝对路径、不含原始输出**(stdout 里
//      全是临时目录绝对路径,连耗时也不进 JSON —— 每次跑都变的字段会让「产物是否
//      变化」这件事失去可比性)。耗时只打在人类摘要里(可复现性见 renderSmokeSummary)。
//   4. 零删除:只读 release/,临时目录只写 output/ 下的一次性 userData。
//
// 用法:
//   node scripts/smoke-report.mjs [--source unpacked|dev] [选项]
//   node scripts/smoke-report.mjs --source dev --out output/artifacts/smoke-report.json

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, parseArgs, toPosix } from './check-dist-manifest.mjs';
import {
  collectSmokeProblems,
  createUserData,
  DEFAULT_SMOKE_TIMEOUT_MS,
  describeSmokeCommand,
  disposeUserData,
  listExeNames,
  outputTail,
  runSmokeProcess,
  SMOKE_MARKERS,
} from './smoke-proc.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/** 报告 schema 版本(消费端按此判形状;字段语义只增不改) */
export const SMOKE_REPORT_SCHEMA = 1;
/** 报告产物固定文件名(默认落点,gitignore 覆盖 output/) */
export const DEFAULT_REPORT_REL = 'output/artifacts/smoke-report.json';
/** 默认报告目录下的临时根(一次性 userData;结束即删) */
const DEFAULT_SCRATCH_REL = 'output/smoke-report';
/** electron-builder 的 win 解包目录名(写死:改名会让本脚本与产物布局分叉) */
const UNPACKED_DIR_NAME = 'win-unpacked';
/** 默认发布产物目录(与 check-unpacked-smoke.mjs 同口径;build.directories.output 变更需同改) */
const DEFAULT_RELEASE_DIR = 'release';
/** 失败留痕的原始输出文件名(仅失败时写;不进报告 JSON,故不影响可复现性) */
const LOG_SUFFIX = '.log';

/** 报告状态取值 */
export const REPORT_STATUS = Object.freeze({
  /** 跑过了:标记齐 + 退出码 0 */
  pass: 'pass',
  /** 跑过了但没过:缺标记 / 非零退出 / 超时 / 启动失败 */
  fail: 'fail',
  /** 没跑:前置缺失(无产物 / 无 Electron / 未构建),退出码与 fail 区分 */
  notRun: 'not-run',
});

/**
 * @typedef {object} SmokeMarkerHit 单条诊断标记的命中情况
 * @property {string} id 标记 id
 * @property {string} label 标记中文名(缺失清单按它点名)
 * @property {string} token 标记字面量
 * @property {boolean} present 是否命中
 */

/**
 * @typedef {object} SmokeDegradation 非致命降级留痕
 * @property {string} id 降级项 id
 * @property {string} label 降级项中文名
 * @property {string} token 降级行标记字面量
 * @property {number} count 出现次数
 */

/**
 * @typedef {object} SmokeReport 机器可读冒烟报告(本文件契约;键序固定 ⇒ 产物可复现)
 * @property {number} schema 报告 schema 版本
 * @property {string} kind 恒为 smoke-report
 * @property {string} source 来源(unpacked / dev)
 * @property {string} status pass | fail | not-run
 * @property {boolean} executed 是否真的跑过(未执行为 false,不得被读成通过)
 * @property {string} target 目标可读形态(仓库相对路径)
 * @property {number | null} exitCode 被测进程退出码(null = 无信号/未产出)
 * @property {string | null} signal 终止信号
 * @property {boolean} timedOut 是否由硬超时触发
 * @property {boolean} unterminated 硬杀后仍未退出(可能有残留进程)
 * @property {string | null} spawnError 启动失败原因(已脱敏,无则 null)
 * @property {{ expected: number, present: number, missing: number } | null} markerContract 标记契约计数(未执行为 null)
 * @property {SmokeMarkerHit[]} markers 逐条标记命中表
 * @property {string[]} missingMarkers 缺失标记的 label 清单
 * @property {SmokeDegradation[]} degradations 非致命降级项
 * @property {string[]} problems 问题列表(空数组 = 通过)
 * @property {string} [notRunReason] 未执行原因(仅 status=not-run 时存在)
 */

/**
 * 退出码语义(消费端必须按此区分「没跑」与「跑了没过」):
 * 0 = pass,1 = fail,2 = not-run(未执行)。
 */
export const EXIT = Object.freeze({ pass: 0, fail: 1, notRun: 2 });

/**
 * 非致命降级留痕行的标记契约。
 *
 * 出处是 src/main/smoke.ts 的 SMOKE_MARKER.pdfDegraded(唯一实现在 src/,dev 侧入口
 * 只转调),这里不能 import 它:该模块 import electron,纯 node 进程里链不到命名导出。
 * 故此处按字面登记 + 由 test/segments/observability.test.js 断言与
 * dist/main/smoke.js 的 SMOKE_MARKER.pdfDegraded 恒等(漂移即判红),口径与
 * test/segments/packaged-smoke.test.js 对 SMOKE_MARKERS 的恒等守护同款。
 */
export const DEGRADATION_TOKENS = Object.freeze([
  { id: 'pdf-degraded', label: 'pdf 降级(非致命)', token: '[smoke] pdf 降级(非致命):' },
]);

const USAGE = `用法: node scripts/smoke-report.mjs [选项]
  --source <dev|unpacked>  冒烟来源(默认 unpacked;dev = 以 electron 启动仓库根,
                           unpacked = 以解包目录内的应用 exe 启动)
  --release <dir>          发布产物根目录(默认 ${DEFAULT_RELEASE_DIR};解包目录取其下 ${UNPACKED_DIR_NAME})
  --unpacked <dir>         显式指定解包目录(覆盖 --release 推导)
  --exe <file>             显式指定应用可执行文件(仅 unpacked 来源)
  --out <file>             报告 JSON 落点(默认 ${DEFAULT_REPORT_REL})
  --scratch <dir>          一次性 userData 根目录(默认 ${DEFAULT_SCRATCH_REL})
  --timeout <ms>           硬超时(ms,默认 ${DEFAULT_SMOKE_TIMEOUT_MS};0 = 不启用,不建议)
  --help                   显示本用法

退出码:0 = 通过(标记齐 + 退出码 0);1 = 跑了但没过(缺标记/非零退出/超时/启动失败);
        2 = 未执行(无产物/无 Electron/未构建)。2 与 0 必须区分,不得把「没跑」读成通过。`;

/**
 * 把文本里的绝对路径换成占位符(报告产物必须与机器无关)。
 * 覆盖两类形态:盘符绝对路径(`C:\Users\...\Temp\x`)与 POSIX 绝对路径(`/home/...`)。
 * 传入的 root 先被替换成 `<repo>` —— 相对路径信息保留,绝对路径信息丢弃。
 * @param {string} text 待净化文本
 * @param {string} root 仓库根绝对路径
 * @returns {string} 净化后文本
 */
export function redactPaths(text, root) {
  if (typeof text !== 'string' || text === '') return '';
  let out = text;
  for (const form of [root, root.split(path.sep).join('/'), root.split(path.sep).join('\\')]) {
    if (form !== '') out = out.split(form).join('<repo>');
  }
  return out
    .replace(/[A-Za-z]:[\\/][^\s"'<>|,;)\]]*/g, '<abs-path>')
    .replace(/(?:^|(?<=[\s"'(=]))\/(?:[^\s"'<>|,;)\]]+\/?)+/g, '<abs-path>');
}

/**
 * 判定一次运行的产出:逐条标记命中情况 + 降级留痕出现次数。
 * 只做「文本包含」判定(与 collectSmokeProblems 同口径),不改判定语义。
 * @param {string} output 合并后的 stdout+stderr
 * @returns {{ markers: {id: string, label: string, token: string, present: boolean}[], missing: string[], degradations: {id: string, label: string, token: string, count: number}[] }} 判定结果
 */
export function parseSmokeOutput(output) {
  const text = typeof output === 'string' ? output : '';
  const markers = SMOKE_MARKERS.map((marker) => ({
    id: marker.id,
    label: marker.label,
    token: marker.token,
    present: text.includes(marker.token),
  }));
  const missing = markers.filter((marker) => !marker.present).map((marker) => marker.label);
  const degradations = DEGRADATION_TOKENS.map((marker) => {
    let count = 0;
    for (let at = text.indexOf(marker.token); at !== -1; at = text.indexOf(marker.token, at + marker.token.length)) {
      count += 1;
    }
    return { id: marker.id, label: marker.label, token: marker.token, count };
  }).filter((entry) => entry.count > 0);
  return { markers, missing, degradations };
}

/**
 * 报告状态由问题列表归一(问题列表单源在 collectSmokeProblems,故「什么算失败」
 * 只有一处定义):空 = pass,非空 = fail。
 * @param {string[]} problems 问题列表
 * @returns {string} 报告状态
 */
function statusFromProblems(problems) {
  return problems.length === 0 ? REPORT_STATUS.pass : REPORT_STATUS.fail;
}

/**
 * 状态 → 退出码。
 * @param {string} status 报告状态
 * @returns {number} 进程退出码
 */
export function exitCodeForStatus(status) {
  if (status === REPORT_STATUS.pass) return EXIT.pass;
  if (status === REPORT_STATUS.fail) return EXIT.fail;
  return EXIT.notRun;
}

/**
 * 把一次运行结果归一成报告(纯函数:不碰 fs、不起进程,可直测)。
 * @param {object} spec 入参
 * @param {import('./smoke-proc.mjs').ProcessRunResult} spec.result 运行结果
 * @param {string} spec.source 来源标签(unpacked / dev)
 * @param {string} [spec.target] 目标的可读形态(已相对化;仅作诊断留痕)
 * @returns {SmokeReport} 报告对象(字段顺序即 JSON 键序,保证产物可复现)
 */
export function buildSmokeReport({ result, source, target = '' }) {
  const { markers, missing, degradations } = parseSmokeOutput(result.output);
  const problems = collectSmokeProblems(result, { label: source }).map((problem) =>
    redactPaths(problem, projectRoot),
  );
  return {
    schema: SMOKE_REPORT_SCHEMA,
    kind: 'smoke-report',
    source,
    status: statusFromProblems(problems),
    executed: true,
    target,
    exitCode: result.code,
    signal: result.signal,
    timedOut: result.timedOut,
    unterminated: result.unterminated === true,
    spawnError:
      result.spawnError === undefined ? null : redactPaths(result.spawnError.message, projectRoot),
    markerContract: {
      expected: markers.length,
      present: markers.filter((marker) => marker.present).length,
      missing: missing.length,
    },
    markers,
    missingMarkers: missing,
    degradations,
    problems,
  };
}

/**
 * 「未执行」报告:前置缺失时产出。**不是**通过,也**不是**失败 —— 单独一档,
 * 避免「本机没装 Electron」被读成「冒烟正常」。
 * @param {object} spec 入参
 * @param {string} spec.source 来源标签
 * @param {string} spec.reason 未执行原因(必须是相对路径形态,内部再净化一次)
 * @param {string} [spec.target] 目标可读形态
 * @returns {SmokeReport} 报告对象
 */
export function buildNotRunReport({ source, reason, target = '' }) {
  return {
    schema: SMOKE_REPORT_SCHEMA,
    kind: 'smoke-report',
    source,
    status: REPORT_STATUS.notRun,
    executed: false,
    target,
    exitCode: null,
    signal: null,
    timedOut: false,
    unterminated: false,
    spawnError: null,
    markerContract: null,
    markers: [],
    missingMarkers: [],
    degradations: [],
    problems: [redactPaths(`未执行:${reason}`, projectRoot)],
    notRunReason: redactPaths(reason, projectRoot),
  };
}

/**
 * 人类可读摘要(耗时只在这里出现:报告 JSON 要可复现,而每次运行都变的字段
 * 正是「产物变了没有」这件事的噪音源;故耗时入摘要、不入产物)。
 * @param {SmokeReport} report 报告对象
 * @param {object} [spec] 附加信息
 * @param {number | null} [spec.elapsedMs] 本次运行耗时(ms);null = 未计时
 * @returns {string} 多行摘要
 */
export function renderSmokeSummary(report, { elapsedMs = null } = {}) {
  const lines = [];
  const head =
    `[smoke-report] 来源 ${report.source} | 状态 ${report.status} | ` +
    `退出码 ${report.exitCode === null ? '(无)' : report.exitCode} | ` +
    `标记 ${report.markerContract === null ? '0/0' : `${report.markerContract.present}/${report.markerContract.expected}`} | ` +
    `降级 ${report.degradations.length} | 耗时 ${elapsedMs === null ? '(未计时)' : `${elapsedMs}ms`}`;
  lines.push(head);
  if (report.markerContract !== null) {
    for (const marker of report.markers) {
      lines.push(`  ${marker.present ? '[有]' : '[缺]'} ${marker.label}(${marker.id})`);
    }
  }
  for (const degradation of report.degradations) {
    lines.push(`  [降级] ${degradation.label} ×${degradation.count}(非致命,不影响判定)`);
  }
  for (const problem of report.problems) lines.push(`  [问题] ${problem}`);
  return lines.join('\n');
}

/**
 * electron 可执行文件定位(不 require('electron'):那个包在纯 node 下导出的是
 * 路径字符串,走 createRequire 会把「可执行文件路径」耦合到 CJS 互操作细节上;
 * 直接读包内 path.txt 更直白,沙盒也能用同样的布局夹具)。
 * @param {string} root 仓库根
 * @returns {string | null} 可执行文件绝对路径;定位不到返回 null
 */
export function resolveElectronBinary(root) {
  const pkgDir = path.join(root, 'node_modules', 'electron');
  const pathFile = path.join(pkgDir, 'path.txt');
  if (existsSync(pathFile)) {
    const rel = readFileSync(pathFile, 'utf8').trim();
    if (rel !== '') {
      const candidate = path.join(pkgDir, 'dist', rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  for (const name of ['electron.exe', 'electron']) {
    const candidate = path.join(pkgDir, 'dist', name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 应用可执行文件名(取自 package.json build.productName,与解包目录内 exe 命名同源;
 * 读不到就当空串,预检会退化为「候选不唯一时报错要 --exe」)。
 * @returns {string} productName
 */
function readProductName() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return typeof pkg.build?.productName === 'string' ? pkg.build.productName : '';
  } catch {
    return '';
  }
}

/**
 * 相对化(报告与摘要里只允许出现仓库相对路径)。
 * @param {string} target 绝对路径
 * @returns {string} 仓库相对 POSIX 路径(目标在仓库外时给 basename)
 */
function repoRelative(target) {
  const relative = path.relative(projectRoot, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(target);
  }
  return toPosix(relative);
}

/**
 * 预检:能否真的跑起来。返回 null = 可跑;返回字符串 = 未执行原因(相对路径形态)。
 * @param {object} spec 入参
 * @param {string} spec.source 来源
 * @param {string} spec.unpackedDir 解包目录
 * @param {string | undefined} spec.exeOption --exe
 * @param {string} spec.productName 应用可执行文件名(productName)
 * @returns {string | null} 未执行原因
 */
function preflight({ source, unpackedDir, exeOption, productName }) {
  if (source === 'dev') {
    const electron = resolveElectronBinary(projectRoot);
    if (electron === null) {
      return (
        'dev 侧冒烟需 electron 可执行文件,未找到 node_modules/electron/dist/electron.*' +
        '(请先 npm install;不得因本机缺 Electron 就产出一份「通过」报告)'
      );
    }
    const smokeEntry = path.join(projectRoot, 'dist', 'main', 'smoke.js');
    if (!existsSync(smokeEntry)) {
      return `dev 侧冒烟入口未构建:${repoRelative(smokeEntry)}(请先 npm run build;该入口必须先编译才能被主进程动态 import)`;
    }
    return null;
  }
  if (!existsSync(unpackedDir) || !statSync(unpackedDir).isDirectory()) {
    return (
      `解包目录不存在:${repoRelative(unpackedDir)}` +
      '(请先运行 npm run dist,或用 --unpacked 指向已有解包目录)'
    );
  }
  const asarPath = path.join(unpackedDir, 'resources', 'app.asar');
  if (!existsSync(asarPath)) {
    return `应用归档缺失:${repoRelative(asarPath)}(解包目录不完整,打包可能中断;请重跑 npm run dist)`;
  }
  const exePath = exeOption ?? findAppExe(unpackedDir, productName);
  if (exePath === null) {
    const candidates = listExeNames(unpackedDir);
    return (
      `解包目录内无法确定应用可执行文件:${repoRelative(unpackedDir)}` +
      `(.exe 候选:${candidates.length === 0 ? '(无)' : candidates.join(', ')};` +
      `期望与 productName 同名的 ${productName}.exe,可用 --exe 显式指定)`
    );
  }
  return null;
}

/**
 * 解包目录里的应用可执行文件:与 build.productName 同名者优先;候选不唯一且无法
 * 按名命中时返回 null(交由调用方报「指名 --exe」,不在多个候选里猜一个)。
 * @param {string} unpackedDir 解包目录
 * @param {string} productName package.json build.productName(可能为空)
 * @returns {string | null} 绝对路径;无法确定返回 null
 */
function findAppExe(unpackedDir, productName) {
  const names = listExeNames(unpackedDir);
  if (productName !== '') {
    const named = names.find((name) => name.toLowerCase() === `${productName}.exe`.toLowerCase());
    if (named !== undefined) return path.join(unpackedDir, named);
  }
  if (names.length === 1 && names[0] !== undefined) return path.join(unpackedDir, names[0]);
  return null;
}

/**
 * 清一次性 userData 的父目录(EBUSY 重试;失败仅告警 —— 残留只是 output/ 下的空壳,
 * 不该把清理噪声变成冒烟失败)。
 * @param {string} scratchRoot 临时根
 * @returns {void}
 */
function removeScratch(scratchRoot) {
  try {
    rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(
      `[warn] smoke-report: 临时目录清理失败(可手工删除 ${repoRelative(scratchRoot)}):` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 写报告产物(固定 2 空格缩进 + 末尾换行;不写时间戳/绝对路径,故同输入产物同字节)。
 * @param {string} outPath 落点
 * @param {object} report 报告对象
 * @returns {string} 落点绝对路径
 */
function writeReport(outPath, report) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outPath;
}

/**
 * CLI 主体。
 * @param {string[]} [argv] 参数
 * @returns {Promise<number>} 进程退出码
 */
export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, {
      booleans: ['help'],
      values: ['source', 'release', 'unpacked', 'exe', 'out', 'scratch', 'timeout'],
    });
  } catch (error) {
    console.error(`[smoke-report:fail] ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.fail;
  }
  if (options.help) {
    console.log(USAGE);
    return EXIT.pass;
  }
  const source = options.source ?? 'unpacked';
  if (source !== 'unpacked' && source !== 'dev') {
    console.error(`[smoke-report:fail] --source 只接受 dev|unpacked,实际 ${source}`);
    return EXIT.fail;
  }
  const timeoutMs = options.timeout === undefined ? DEFAULT_SMOKE_TIMEOUT_MS : Number(options.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    console.error(`[smoke-report:fail] --timeout 须为非负毫秒数,实际 ${String(options.timeout)}`);
    return EXIT.fail;
  }
  const releaseDir = path.resolve(projectRoot, options.release ?? DEFAULT_RELEASE_DIR);
  const unpackedDir = path.resolve(
    projectRoot,
    options.unpacked ?? path.join(releaseDir, UNPACKED_DIR_NAME),
  );
  const outPath = path.resolve(projectRoot, options.out ?? DEFAULT_REPORT_REL);
  const scratchRoot = path.resolve(projectRoot, options.scratch ?? DEFAULT_SCRATCH_REL);
  const exeOption = options.exe === undefined ? undefined : path.resolve(projectRoot, options.exe);

  const blocked = preflight({ source, unpackedDir, exeOption, productName: readProductName() });
  if (blocked !== null) {
    const report = buildNotRunReport({ source, reason: blocked });
    writeReport(outPath, report);
    console.error(renderSmokeSummary(report));
    console.error(
      `[smoke-report:fail] 冒烟未执行(exit ${EXIT.notRun});已写出如实报告:${repoRelative(outPath)}`,
    );
    return EXIT.notRun;
  }

  const electron = source === 'dev' ? resolveElectronBinary(projectRoot) : null;
  const exePath =
    source === 'dev' ? (electron ?? '') : (exeOption ?? findAppExe(unpackedDir, readProductName()) ?? '');
  const launcher = source === 'dev' ? '.' : undefined;
  const runtime = source === 'dev' ? (electron ?? undefined) : undefined;
  const userDataDir = createUserData(scratchRoot);
  console.log(
    `[info] smoke-report: 启动 ${describeSmokeCommand({ exePath, launcher, runtime, userDataDir })}`,
  );
  const startedAt = Date.now();
  /** @type {import('./smoke-proc.mjs').ProcessRunResult} */
  let result;
  try {
    result = await runSmokeProcess({ exePath, launcher, runtime, userDataDir, timeoutMs });
  } finally {
    disposeUserData(userDataDir);
  }
  const elapsedMs = Date.now() - startedAt;
  removeScratch(scratchRoot);
  const report = buildSmokeReport({
    result,
    source,
    target: source === 'dev' ? '仓库根(electron .)' : repoRelative(exePath),
  });
  writeReport(outPath, report);
  if (report.status === REPORT_STATUS.fail) {
    // 原始输出留痕(不进报告 JSON:里面有临时目录绝对路径,会让产物不可复现);
    // 排查直接看尾部,完整内容在同目录的 .log
    const logPath = `${outPath}${LOG_SUFFIX}`;
    writeFileSync(logPath, `${result.output}\n`, 'utf8');
    console.error(renderSmokeSummary(report, { elapsedMs }));
    console.error(`[smoke-report:fail] 输出尾部:\n${outputTail(result.output)}`);
    console.error(`[smoke-report:fail] 完整输出已留痕:${repoRelative(logPath)}`);
  } else {
    console.log(renderSmokeSummary(report, { elapsedMs }));
  }
  console.log(
    `[smoke-report] 报告已写出:${repoRelative(outPath)}(退出码 ${exitCodeForStatus(report.status)};` +
      `未执行 = ${EXIT.notRun},失败 = ${EXIT.fail},通过 = ${EXIT.pass})`,
  );
  return exitCodeForStatus(report.status);
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
