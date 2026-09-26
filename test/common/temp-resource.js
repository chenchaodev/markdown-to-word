// @ts-check
/**
 * 临时资源生命周期(测试树共享的单一来源):**建资源 → 注册清理 → 退出/失败均清理**。
 *
 * 收敛的重复面(盘点结论,含刻意不收的部分):
 * 1) 建:24 处 `mkdtemp(Sync)(path.join(os.tmpdir(), "m2w-xxx-"))`(本轮盘点:segments 18 +
 *    main 6),前缀各不相同但**语义相同**——都是「一次性沙盒目录」;另有
 *    test/common/userdata.js 的 createTempUserData(runner/宿主用)与 scripts/smoke-proc.mjs
 *    的 createUserData(已复用 userdata.js 的清理语义);
 * 2) 删:四种写法并存,差别只在重试参数与失败处理:
 *    - `{ recursive: true, force: true }`(无重试)——supply-chain / signature-status /
 *      dist-manifest-gate / release-artifact-gate,test/main 六个段;
 *    - `{ ..., maxRetries: 5, retryDelay: 200 }` 包在 finally——import-boundary /
 *      pinned-actions / clean-artifacts-gate / install-smoke;
 *    - `{ ..., maxRetries: 5, retryDelay: 100 }` 且**静默吞错**——test/common/userdata.js;
 *    - `await fs.rm(...).catch(() => undefined)`——test/main 若干段。
 *    前两种在 Windows 上「进程刚退出、句柄未释放 → EBUSY/EPERM」时会直接抛,把段判成失败;
 *    后两种把删不掉的目录静默留在系统临时区,谁也看不出。
 * 3) 注册:无处可寻——段崩了/忘了 finally 时没有任何清单能报出「谁留下了什么」。
 * 本文件把三件事合成一处:`createTempResource` 建的每个目录都进模块级注册表,
 * `cleanupTempResources` 与进程 `exit` 钩子都能兜底,删不掉**显式抛错**(含路径与原始错误),
 * 绝不静默残留。
 *
 * 刻意不收的部分:
 * - `test/common/userdata.js` 的 `createTempUserData` / `removeTempUserData`:**不并入**。
 *   它是「Electron userData 重定向」契约(USER_DATA_ENV 注入 + ready 前重定向),生命周期归
 *   runner 的父子进程协议管,且清理语义刻意宽松(隔离靠"每段目录唯一",不靠删成功)。
 *   更硬的约束:install-smoke 段把 **userdata.js** 逐字节复制进沙盒后跑 scripts/smoke-proc.mjs,
 *   该脚本按相对路径 import `../test/common/userdata.js` —— 若 userdata.js 新增对同目录
 *   其它模块的 import,沙盒里那份副本会解析失败,install-smoke 段当场红。故 userdata.js 必须
 *   保持零内部依赖(它的 EBUSY 重试参数与本文件一致属刻意重复,见上条 2 的枚举)。
 * - 只做**目录**资源:现存散点全是目录;为「临时文件」单开一类只会多一条分支,
 *   段的实际写法是「临时目录 + 段内写文件」。
 * - 不做「清理失败后再 spawn 纯 node 子进程删除」的兜底:那招只为绕开 Electron 把 `.asar`
 *   路径交给 asar 虚拟 fs 的坑,只对含 .asar 的沙盒有意义(install-smoke 段自己保留该兜底)。
 *
 * 依赖方向单向:本文件只依赖 node:fs/os/path,可被任意段、runner 与 scripts 引用。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 默认目录名前缀(识别残留用:系统临时区里出现 m2w-tmp-* 即为未清理的测试资源) */
export const TEMP_PREFIX = "m2w-tmp-";

/**
 * 删除重试参数(Windows EBUSY/EPERM 语义:进程刚退出、句柄未释放时 rmSync 会失败,
 * 需按退避重试)。与 test/common/userdata.js 的口径保持一致。
 */
export const REMOVE_MAX_RETRIES = 5;

/** 删除重试的退避基数(ms),重试总等待随次数线性增长 */
export const REMOVE_RETRY_DELAY = 100;

/**
 * @typedef {object} TempResource 一个已注册的临时资源
 * @property {string} path 绝对路径(目录)
 * @property {string} label 人类可读标签(失败消息用;缺省取目录名)
 */

/**
 * @typedef {object} TempResourceOptions 建资源选项
 * @property {string} [prefix] 目录名前缀(缺省 TEMP_PREFIX)
 * @property {string} [parent] 父目录(缺省 os.tmpdir;给定时资源建在该目录下,便于按段归拢)
 * @property {string} [label] 资源标签(失败消息用)
 */

/**
 * @typedef {object} RemoveOutcome 删除结果(不抛错,由调用方决定暴露还是忽略)
 * @property {string} target 目标路径
 * @property {boolean} existed 删除前是否存在
 * @property {true} [ok] 删除成功(含「本就不存在」)
 * @property {Error} [error] 失败原因(ok 缺省时给出)
 */

/** 已注册资源(path → 描述);模块级,一个进程一份 */
const registry = new Map();

/** exit 钩子是否已装(懒装:导入本模块不产生副作用,被 gen-fixtures 全量 import 时零成本) */
let exitHookInstalled = false;

/**
 * 把未捕获的值归一成 Error(清理路径只认 Error,避免拼出 "[object Object]")。
 * @param {unknown} value 原值
 * @returns {Error}
 */
function toError(value) {
  return value instanceof Error ? value : new Error(typeof value === "string" ? value : String(value));
}

/**
 * 删除一棵目录树:带 EBUSY 退避重试,删除后**复查是否真的消失**。
 * 不抛错,返回结果对象 —— 「暴露还是忽略」是调用方的策略决定(本模块的策略是抛)。
 * @param {string} target 目标目录(不存在即视为删除成功)
 * @param {{ maxRetries?: number; retryDelay?: number }} [options] 重试参数覆盖
 * @returns {RemoveOutcome}
 */
export function removeTree(target, options = {}) {
  if (!fs.existsSync(target)) return { target, existed: false, ok: true };
  const maxRetries = options.maxRetries ?? REMOVE_MAX_RETRIES;
  const retryDelay = options.retryDelay ?? REMOVE_RETRY_DELAY;
  /** @type {Error | undefined} */
  let error;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries, retryDelay });
  } catch (err) {
    error = toError(err);
  }
  // force:true 只吞 ENOENT,其余错误(EBUSY/EPERM)在重试耗尽后仍会抛;这里再复查一次存在性,
  // 把「抛了但目录还在」与「抛了且已消失」区分开,避免误报清理失败
  if (fs.existsSync(target)) {
    return { target, existed: true, error: error ?? new Error("删除后目录仍存在") };
  }
  return { target, existed: true, ok: true };
}

/**
 * 把失败资源清单渲染成可读文案(错误消息与报告共用一处口径)。
 * @param {{ path: string; label: string; error?: Error }[]} items 失败项
 * @returns {string}
 */
function describeFailures(items) {
  return items
    .map((item) => `${item.path}(${item.label}${item.error ? `:${item.error.message}` : ""})`)
    .join(", ");
}

/**
 * 清理单个已注册资源;成功即注销,失败**保留**在注册表(可被后续 cleanup/退出钩子重试)。
 * @param {TempResource} resource 资源
 * @returns {Error | undefined} 失败原因(成功则 undefined)
 */
function tryCleanup(resource) {
  const outcome = removeTree(resource.path);
  if (outcome.ok) {
    registry.delete(resource.path);
    return undefined;
  }
  return outcome.error ?? new Error(`删除后目录仍存在:${resource.path}`);
}

/**
 * 清理单个资源并把失败抛给调用方(段内 finally 用它,失败即段失败)。
 * @param {TempResource} resource 资源
 * @returns {void}
 */
export function removeResource(resource) {
  const error = tryCleanup(resource);
  if (error) {
    throw new Error(`临时资源清理失败(${resource.label}):${resource.path}:${error.message}`);
  }
}

/**
 * 兜底清理:清空注册表里全部资源,**有任何一项删不掉即抛错**(列出路径与原因)。
 * 段末调用它 = 「本段不留下任何临时资源」的可断言声明。
 * @returns {{ removed: string[] }} 已清理的路径
 */
export function cleanupTempResources() {
  /** @type {string[]} */
  const removed = [];
  /** @type {{ path: string; label: string; error?: Error }[]} */
  const failed = [];
  for (const resource of [...registry.values()]) {
    const error = tryCleanup(resource);
    if (error) failed.push({ path: resource.path, label: resource.label, error });
    else removed.push(resource.path);
  }
  if (failed.length > 0) {
    throw new Error(
      `临时资源清理失败(${failed.length} 项,不得静默残留在系统临时区):${describeFailures(failed)}`,
    );
  }
  return { removed };
}

/**
 * 尚未清理的已注册资源(只读快照)。
 * @returns {TempResource[]}
 */
export function pendingTempResources() {
  return [...registry.values()].map((resource) => ({ ...resource }));
}

/**
 * 进程退出钩子:把「段崩在中途、没跑到 finally」的目录清掉;清不掉的打到 stderr。
 * 退出阶段不再抛错(Node 不保证退出码被传播),因此这一层是兜底不是保证——
 * 保证来自段末的 cleanupTempResources 断言。
 */
function runExitHook() {
  /** @type {string[]} */
  const stuck = [];
  for (const resource of [...registry.values()]) {
    const error = tryCleanup(resource);
    if (error) stuck.push(`${resource.path}(${error.message})`);
  }
  if (stuck.length > 0) {
    console.error(`[fail] 进程退出时仍有临时资源未清理:${stuck.join(", ")}`);
  }
}

/** 懒装退出钩子(装一次即可,重复装会让每次退出都跑一遍兜底) */
function ensureExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", runExitHook);
}

/**
 * 建一个已注册的临时目录(一次性沙盒):建完即进注册表,后续无论走 withTempResource
 * 的 finally、cleanupTempResources 还是进程退出钩子都能清掉。
 * @param {TempResourceOptions | string} [options] 选项或前缀简写
 * @returns {TempResource}
 */
export function createTempResource(options = {}) {
  const opts = typeof options === "string" ? { prefix: options } : options;
  const prefix = opts.prefix ?? TEMP_PREFIX;
  const parent = opts.parent ?? os.tmpdir();
  const dir = fs.mkdtempSync(path.join(parent, prefix));
  const resource = { path: dir, label: opts.label ?? path.basename(dir) };
  ensureExitHook();
  registry.set(dir, resource);
  return resource;
}

/**
 * 包一层生命周期:建资源 → 交给 fn → **成功或抛错都清理**(清理失败不覆盖原始失败,
 * 两者都写进错误消息),适合「一段逻辑只关心一个沙盒」的写法。
 * @template T
 * @param {TempResourceOptions | string} options 选项或前缀简写
 * @param {(resource: TempResource) => T | Promise<T>} fn 沙盒上的逻辑(返回值透传)
 * @returns {Promise<T>} fn 的返回值
 */
export async function withTempResource(options, fn) {
  const resource = createTempResource(options);
  /** @type {T | undefined} */
  let value;
  /** @type {Error | undefined} */
  let failure;
  try {
    value = await fn(resource);
  } catch (err) {
    failure = toError(err);
  }
  const cleanupError = tryCleanup(resource);
  if (failure) {
    if (cleanupError) {
      throw new Error(`${failure.message}\n[另] 临时资源清理失败(${resource.label}):${resource.path}:${cleanupError.message}`);
    }
    throw failure;
  }
  if (cleanupError) {
    throw new Error(`临时资源清理失败(${resource.label}):${resource.path}:${cleanupError.message}`);
  }
  return /** @type {T} */ (value);
}
