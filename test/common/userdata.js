// @ts-check
/**
 * 验收 userData 隔离助手(单一来源):
 * 段内 settings/ui-state 直读 `app.getPath("userData")`(无注入点),若不隔离就会
 * 读写真实 %APPDATA% 下的用户数据,且段间互相污染(一段写过的设置成为下一段起点)。
 * 逐段子进程隔离后,隔离粒度下沉到**每段一个目录**:
 * - 父进程(runner.js)为该段 mkdtemp 一个目录,经环境变量注入子进程;
 * - 子进程宿主(segment-host.mjs)在 `app.whenReady()` **之前**重定向(过期即抛);
 * - 父进程在该段子进程退出后删除(被杀的超时段同样删),故段间零共享。
 *
 * 本模块刻意不 import electron:`app` 由调用方注入(纯 fs/os 依赖,便于直测)。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 段子进程 userData 目录的环境变量键(父进程创建目录后注入,子进程 before-ready 消费) */
export const USER_DATA_ENV = "M2W_SEGMENT_USER_DATA";

/** userData 目录名前缀(与段内业务临时目录 m2w-* 区分,便于识别残留) */
export const USER_DATA_PREFIX = "m2w-userdata-";

/**
 * 建一个一次性 userData 目录(os.tmpdir 下 mkdtemp,天然唯一)。
 * @param {string} [prefix] 目录名前缀
 * @returns {string} 绝对目录路径
 */
export function createTempUserData(prefix = USER_DATA_PREFIX) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * 删除一次性 userData 目录;清理失败(Windows 上进程刚退出、句柄未释放可能 EBUSY)
 * 只静默忽略——隔离靠"每段目录唯一",不靠删除成功,残留只占系统临时区。
 * @param {string} dir 目录路径
 */
export function removeTempUserData(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // 清理失败静默忽略,不影响段结果与退出码
  }
}

/**
 * 把 app 的 userData 重定向到一次性目录(必须在 app ready 之前调用,否则 app.setPath 抛)。
 * @param {{ setPath(name: string, value: string): void }} app electron app(或同形状替身)
 * @param {string} dir 目标目录(不存在则创建:段内多处直接读写真实路径)
 * @returns {string} 实际生效的目录
 */
export function redirectUserData(app, dir) {
  fs.mkdirSync(dir, { recursive: true });
  app.setPath("userData", dir);
  return dir;
}
