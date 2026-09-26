// 打包产物 smoke 启动的共享原语(单一来源)。
//
// 两个发布侧检查脚本(解包目录启动 / 安装目录启动)判定面完全同构:启动一个真实可执行
// 文件 → 传 --smoke → 等它自行退出 → 断言退出码 0 且输出带齐诊断标记。差异只在「启动的
// 是 win-unpacked 还是安装目录」,故把易错的部分收敛在这里,两处不各写一份:
//   - 诊断标记清单(期望哪些 marker),避免两脚本各维护一份、漂移成「一个查三个」;
//   - 硬超时记账 + 进程树硬杀(Windows 上 Electron 拉起的渲染/GPU 进程必须连带终止,
//     否则渲染进程变孤儿、句柄不释放,临时 userData 目录删不掉);
//   - 一次性 userData 的建/清(建在 output/ 内,便于定位残留;清走
//     test/common/userdata.js 的 removeTempUserData,EBUSY 重试语义单源)。
//
// 隔离手段两层(缺一层就可能污染真实用户数据):
//   - `--user-data-dir=<一次性目录>`:Chromium/Electron 的 profile 位置;
//   - 子进程 env 覆盖 APPDATA / LOCALAPPDATA:Windows 上 Electron 的 appData 来源,
//     设置/ui-state 落点随之被搬进一次性目录(单靠 --user-data-dir 不覆盖全部落点)。
//
// 判定口径说明:冒烟实现已下沉到 src/main/smoke.ts → dist/main/smoke.js(2026-09),
// 编译产物在 build.files 的 dist/** 白名单内,故随包分发。此前 dev-only 的
// test/tools/smoke/smoke.mjs 进不了 app.asar,打包产物跑 --smoke 必然失败,现缺口已填。
// 本文件只负责判定与取证,不放水。

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { removeTempUserData } from '../test/common/userdata.js';

/** 冒烟开关(应用主进程据此切到 smoke 分支,跑完诊断自行退出) */
export const SMOKE_FLAG = '--smoke';

/** 诊断标记契约(期望输出的锚点;token 取自 src/main/smoke.ts 的 console.log) */
export const SMOKE_MARKERS = Object.freeze([
  { id: 'convert', label: 'docx 转换', token: '[smoke] convert ok:' },
  { id: 'pdf-convert', label: 'pdf 转换', token: '[smoke] pdf convert ok:' },
  { id: 'pdf-bookmark', label: 'pdf 书签', token: '[smoke] pdf 书签 ok:' },
  { id: 'renderer-diag', label: 'renderer 诊断', token: '[smoke] renderer diag:' },
  { id: 'ipc-diag', label: 'IPC 接线诊断', token: '[smoke] ipc diag:' },
]);

/** 冒烟入口在源码树中的相对路径:主进程以 URL 动态 import 它,打进包才谈得上跑 --smoke */
export const SMOKE_ENTRY_RELATIVE = 'dist/main/smoke.js';

/** 一次性 userData 目录名前缀(与段内业务临时目录 m2w-* 区分,便于识别残留) */
export const SMOKE_USER_DATA_PREFIX = 'm2w-smoke-';

/** 硬杀进程树后等待 exit 的上限(超过则按「已终止」记账并继续,留痕告警) */
const KILL_GRACE_MS = 10000;

/** 默认硬超时:Electron 首启 + 转换 + PDF + 渲染诊断,3 分钟足够,超时即判红 */
export const DEFAULT_SMOKE_TIMEOUT_MS = 180000;

/**
 * 进程执行结果(本文件契约;超时/启动失败/信号终止都在同一形状里归一,消费端不必分支猜)。
 * @typedef {object} ProcessRunResult
 * @property {number | null} code 退出码(null = 被信号终止或启动失败)
 * @property {string | null} signal 终止信号
 * @property {boolean} timedOut 是否由硬超时触发(已杀进程树)
 * @property {boolean} [unterminated] 硬杀后仍未退出(句柄被占用,可能有残留进程)
 * @property {string} output stdout + stderr 合并输出
 * @property {Error} [spawnError] 启动失败
 */

/**
 * 硬杀子进程及其派生进程。做法与 test/common/runner.js 的 killProcessTree 一致
 * (该函数未导出,故此处按同一约定实现):Windows 无进程组,`taskkill /T` 才能连带
 * 终止 Electron 拉起的渲染/GPU 进程;其它平台用 SIGKILL。
 * @param {import('node:child_process').ChildProcess} child 子进程句柄
 * @returns {void}
 */
export function killProcessTree(child) {
  if (typeof child.pid !== 'number') return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  child.kill('SIGKILL');
}

/**
 * 建一次性 userData 根目录(mkdtemp 保证每次运行都拿到全新目录 —— 同名复用会把上一次的
 * 残留带进这一次,隔离就名存实亡;落在 scratchRoot 内而不用 os.tmpdir,残留能一眼定位在
 * output/ 下)。
 * @param {string} scratchRoot 临时根目录(不存在则创建)
 * @returns {string} 一次性目录绝对路径
 */
export function createUserData(scratchRoot) {
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(path.join(scratchRoot, SMOKE_USER_DATA_PREFIX));
  mkdirSync(path.join(root, 'profile'), { recursive: true });
  mkdirSync(path.join(root, 'home'), { recursive: true });
  return root;
}

/**
 * 一次性 userData 的 Chromium 开关值(Electron 认 --user-data-dir=)。
 * @param {string} userDataDir createUserData 返回的目录
 * @returns {string} 形如 `--user-data-dir=<dir>/profile`
 */
export function userDataSwitch(userDataDir) {
  return `--user-data-dir=${path.join(userDataDir, 'profile')}`;
}

/**
 * 一次性 userData 的环境覆盖:把 Windows 的 appData 根搬进一次性目录。
 * @param {string} userDataDir createUserData 返回的目录
 * @returns {Record<string, string>} env 覆盖项
 */
export function userDataEnv(userDataDir) {
  const home = path.join(userDataDir, 'home');
  return { APPDATA: home, LOCALAPPDATA: home };
}

/**
 * 删除一次性 userData(EBUSY 重试语义单源在 test/common/userdata.js)。
 * @param {string} userDataDir 目录路径
 * @returns {void}
 */
export function disposeUserData(userDataDir) {
  removeTempUserData(userDataDir);
}

/**
 * 启动进程并等它退出:捕获合并输出,到点未退出则硬杀进程树并记账。
 * @param {object} spec 参数
 * @param {string} spec.command 可执行文件
 * @param {string[]} [spec.args] 参数
 * @param {string} [spec.cwd] 工作目录
 * @param {Record<string, string>} [spec.env] 环境覆盖
 * @param {number} [spec.timeoutMs] 硬超时(ms);0/非有限值 = 不启用
 * @returns {Promise<ProcessRunResult>}
 */
export function runProcess({ command, args = [], cwd, env = {}, timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: null, signal: null, timedOut: false, output: '', spawnError: /** @type {Error} */ (error) });
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    child.stdout?.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    let timedOut = false;
    let settled = false;
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    /** @type {NodeJS.Timeout | undefined} */
    let graceTimer;
    const finish = (/** @type {ProcessRunResult} */ result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve({ ...result, output: Buffer.concat(chunks).toString('utf8') });
    };
    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
        // 兜底:句柄被占用等极端情况下进程没被终结,不再无限等 exit
        graceTimer = setTimeout(() => finish({ code: null, signal: 'SIGKILL', timedOut, unterminated: true }), KILL_GRACE_MS);
      }, timeoutMs);
    }
    child.once('error', (error) => finish({ code: null, signal: null, timedOut, spawnError: error }));
    child.once('exit', (code, signal) => finish({ code, signal, timedOut }));
  });
}

/**
 * 以 --smoke 启动一个可执行文件(默认就是应用可执行文件;launcher 存在时改为
 * 「用 runtime 解释器跑该启动器」,参数与直接启动完全一致 —— 自测沙盒与非 exe 目标用)。
 * @param {object} spec 参数
 * @param {string} spec.exePath 应用可执行文件
 * @param {string} [spec.launcher] 启动器脚本(存在则以 runtime 运行之)
 * @param {string} [spec.runtime] 解释器可执行文件(默认当前进程的 process.execPath)
 * @param {string} spec.userDataDir 一次性 userData 根(createUserData 产出)
 * @param {number} [spec.timeoutMs] 硬超时
 * @param {Record<string, string>} [spec.env] 额外环境覆盖
 * @param {string} [spec.cwd] 工作目录
 * @returns {Promise<ProcessRunResult>}
 */
export function runSmokeProcess({
  exePath,
  launcher,
  runtime = process.execPath,
  userDataDir,
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
  env = {},
  cwd,
}) {
  const args = launcher === undefined ? [SMOKE_FLAG] : [launcher, SMOKE_FLAG];
  args.push(userDataSwitch(userDataDir));
  return runProcess({
    command: launcher === undefined ? exePath : runtime,
    args,
    cwd,
    env: { ...userDataEnv(userDataDir), ...env },
    timeoutMs,
  });
}

/**
 * 启动命令的可读形态(计划打印与失败诊断共用,避免两处拼串漂移)。
 * @param {object} spec 参数
 * @param {string} spec.exePath 应用可执行文件
 * @param {string} [spec.launcher] 启动器脚本
 * @param {string} [spec.runtime] 解释器可执行文件
 * @param {string} [spec.userDataDir] 一次性 userData 根
 * @returns {string} 单行命令
 */
export function describeSmokeCommand({ exePath, launcher, runtime = process.execPath, userDataDir }) {
  const command = launcher === undefined ? exePath : `${runtime} ${launcher}`;
  const args = launcher === undefined ? [SMOKE_FLAG] : [launcher, SMOKE_FLAG];
  if (userDataDir !== undefined) args.push(userDataSwitch(userDataDir));
  return [command, ...args].join(' ');
}

/**
 * 把一次 smoke 运行的原始结果判成可读问题列表(空数组 = 通过)。
 * @param {ProcessRunResult} result 运行结果
 * @param {object} spec 标签
 * @param {string} spec.label 前缀标签(如「unpacked smoke」)
 * @param {typeof SMOKE_MARKERS} [spec.markers] 期望的诊断标记
 * @returns {string[]} 问题列表
 */
export function collectSmokeProblems(result, { label, markers = SMOKE_MARKERS }) {
  const problems = [];
  if (result.spawnError !== undefined) {
    problems.push(`${label} 启动失败:${result.spawnError.message}`);
  }
  if (result.timedOut) {
    problems.push(
      `${label} 超过硬超时未自行退出,已硬杀进程树` +
        `${result.unterminated === true ? '(硬杀后仍未退出,可能残留进程,请用任务管理器确认)' : ''}`,
    );
  } else if (result.spawnError === undefined && result.code !== 0) {
    problems.push(`${label} 退出码为 ${String(result.code)},期望 0`);
  }
  const missing = markers.filter((marker) => !result.output.includes(marker.token)).map((marker) => marker.label);
  if (missing.length > 0) {
    problems.push(
      `${label} 输出缺少诊断标记:${missing.join('、')}` +
        `(期望全部命中:${markers.map((marker) => marker.token).join(' / ')})`,
    );
  }
  return problems;
}

/**
 * 失败输出尾部:打包产物的 --smoke 失败原因通常就在最后几行(动态 import 失败、
 * 断言文案),但主进程其余噪声可能很长,故只取尾部若干行作为可操作诊断。
 * @param {string} output 合并输出
 * @param {number} [lineCount] 取尾部行数
 * @returns {string} 尾部正文(空输出返回占位说明)
 */
export function outputTail(output, lineCount = 20) {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return '(无任何输出)';
  return lines.slice(-lineCount).join('\n');
}

/**
 * 判定 app.asar 是否收录了指定条目(精确解析 asar 头部目录树,不引入 @electron/asar
 * —— 它只是 electron-builder 的传递依赖)。
 *
 * 为什么不按「读文件头若干 MB 再对拼接路径做子串搜索」:asar 头里的文件树是**按目录分层
 * 嵌套**的(实测定长:{"files":{"dist":{"files":{"main":{"files":{"smoke.js":{…}}}}}}}),
 * 拼接路径字面量 `dist/main/smoke.js` 在头部文本中**根本不会出现**,子串搜索必然假阴性 ——
 * 2026-09 实测即如此:解包冒烟实际退出码 0 通过,预检却报「未找到入口」并给出与事实
 * 矛盾的告警。改为按路径分段在目录树里逐层下探,判定与包大小无关、也不受扫描前缀限制。
 *
 * asar 头部布局:uint32(头 pickle 载荷长度) + 该长度的 pickle(其首 uint32 为 JSON
 * 长度) + JSON。目录树按路径分层嵌套,故按路径分段逐层下探。
 *
 * @param {string} asarPath app.asar 路径
 * @param {string} [entryRelative] 目标条目相对路径(用 `/` 分隔)
 * @returns {{ present: boolean, searched: number, parsed: boolean, reason?: string }} 判定结果
 */
export function asarContainsEntry(asarPath, entryRelative = SMOKE_ENTRY_RELATIVE) {
  const fileSize = statSync(asarPath).size;
  const fd = openSync(asarPath, "r");
  let searched = 0;
  try {
    const sizeBuf = Buffer.alloc(8);
    readSync(fd, sizeBuf, 0, 8, 0);
    searched += 8;
    // Chromium pickle = [payload_size][value];迭代器跳过 payload_size,故长度在偏移 4
    const headerPickleSize = sizeBuf.readUInt32LE(4);
    if (headerPickleSize < 8) {
      return { present: false, searched, parsed: false, reason: "asar 头 pickle 长度异常" };
    }
    const headerBuf = Buffer.alloc(headerPickleSize);
    readSync(fd, headerBuf, 0, headerPickleSize, 8);
    searched += headerPickleSize;
    // headerBuf 同样是 pickle:再跳过一个 payload_size,偏移 4 才是 JSON 字节长度
    const jsonLength = headerBuf.readUInt32LE(4);
    if (jsonLength <= 0 || jsonLength > fileSize) {
      return { present: false, searched, parsed: false, reason: "asar 头 JSON 长度异常" };
    }
    const jsonBuf = Buffer.alloc(jsonLength);
    // JSON 起点 = 8(sizeBuf) + 8(headerBuf 的两个 uint32)
    // 实测头布局:[payload_size=4][头长度][…][JSON 长度][JSON…],JSON 起点为绝对偏移 16
    readSync(fd, jsonBuf, 0, jsonLength, 16);
    searched += jsonLength;
    let header;
    try {
      header = JSON.parse(jsonBuf.toString("utf8"));
    } catch (error) {
      return {
        present: false,
        searched,
        parsed: false,
        reason: `asar 头 JSON 解析失败:${error instanceof Error ? error.message : String(error)}`,
      };
    }
    // 按路径分段在目录树里逐层下探(命中叶子即存在)
    let node = header;
    for (const segment of entryRelative.split("/").filter((s) => s !== "")) {
      const files = node === null || node === undefined ? undefined : node.files;
      if (!files || !Object.prototype.hasOwnProperty.call(files, segment)) {
        return { present: false, searched, parsed: true };
      }
      node = files[segment];
    }
    return { present: true, searched, parsed: true };
  } finally {
    closeSync(fd);
  }
}

/**
 * 目录内 .exe 文件名(解包目录的应用可执行文件定位失败时,用于把「实际有什么」摆进提示)。
 * @param {string} dir 目录
 * @returns {string[]} 文件名(字典序;目录不存在返回空数组)
 */
export function listExeNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .sort((a, b) => a.localeCompare(b));
}
