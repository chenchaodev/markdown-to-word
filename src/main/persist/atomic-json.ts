/**
 * JSON 文件原子写共享工具(main 层;自 settings.ts / ui-state.ts 双份实现抽出,行为零变化):
 * - 原子写:临时文件 + rename(Windows 下 rename 可覆盖已存在文件)
 * - 显式落盘(耐久性,勿删):写内容 → 对**文件句柄** fsync → rename → 对**父目录**
 *   fsync。少了文件 fsync,断电/掉电后可能留下 0 字节 settings.json,而 loadSettings
 *   对整文件解析失败一律回退默认 → 用户全部偏好静默归零,且现场无任何报错线索。
 *   少了父目录 fsync,rename 的目录项本身可能未落盘(POSIX 上同理)。
 * - 写队列:promise 链串行化——write+rename 之间不得插入其它写(同 tmp 路径),
 *   调用序 = 写盘序,链尾即最终态;单次写失败(如磁盘错误)不截断队列,
 *   错误由调用方各自处理
 * - 失败清理:write/fsync/rename 失败时尽力删除半成品 tmp(原文件保持不变、不提交缓存),
 *   避免残留文件被误当作已提交结果;rename 之后的父目录 fsync 失败不视为写失败
 *   (内容已就位,只是目录项未保证落盘),仅留痕。
 * 每实例独立队列(settings / ui-state 各持一实例,保持原双链语义)。
 * 注意:core/ 为纯净层(无 IO、无 Electron),本工具属 main 层,勿下沉。
 */
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";

/** 写内容的文件句柄面(只取本工具用到的三个操作;真实实现 = node:fs/promises FileHandle) */
export interface DurableFileHandle {
  writeFile(data: string, encoding: "utf8"): Promise<void>;
  /** 把句柄内数据刷到稳定存储(断电安全的唯一凭据) */
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** 原子写依赖面(默认实现走真实 fs;测试注入观测器/故障实现以断言 fsync 时点与顺序) */
export interface JsonWriterDeps {
  /** 以 "w" 打开目标文件(返回可写/可 sync 的句柄) */
  openFile: (filePath: string) => Promise<DurableFileHandle>;
  rename: (fromPath: string, toPath: string) => Promise<void>;
  /** 删除半成品 tmp(force 语义:不存在也不算失败) */
  remove: (filePath: string) => Promise<void>;
  /**
   * 父目录 fsync(rename 之后调用)。
   * 契约:实现须自行吞掉「平台不支持目录 fsync」类错误,**不得 reject**——
   * rename 已完成,把它报成写失败会让调用方以为旧值仍在(实际已被替换)。
   */
  syncDir: (dirPath: string) => Promise<void>;
}

/**
 * 父目录 fsync:POSIX 上 rename 只改目录项,需 fsync 目录句柄才落盘;
 * Windows 无目录 fsync 句柄语义(打开目录即失败,目录项由 NTFS 写入日志保证),
 * 故按平台降级为空操作,失败一律吞掉(见 JsonWriterDeps.syncDir 契约)。
 */
async function syncDirectory(dirPath: string): Promise<void> {
  if (process.platform === "win32") return;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(dirPath, "r");
  } catch {
    return;
  }
  try {
    await handle.sync();
  } catch {
    /* 平台/文件系统不支持目录 fsync:不影响已落盘的文件内容 */
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** 默认依赖面(真实 fs):导出供测试包一层观测器复用真实实现,避免另写一份假 fs */
export const defaultJsonWriterDeps: JsonWriterDeps = {
  openFile: (filePath) => open(filePath, "w"),
  rename,
  remove: async (filePath) => {
    await rm(filePath, { force: true });
  },
  syncDir: syncDirectory,
};

/** 原子 JSON 写入器:filePath 目标文件(tmp 为 filePath + ".tmp"),value 序列化对象,
 *  onCommitted 在写盘成功后同步调用(调用方更新内存缓存,与写盘同序)。 */
export type JsonWrite = (
  filePath: string,
  value: unknown,
  onCommitted?: () => void,
) => Promise<void>;

/**
 * 原子 JSON 写入队列。
 * - 直接调用:提交一次完整 JSON 写盘任务。
 * - enqueue:把“读当前值 → 合并 patch → 写盘”整个事务排入同一队列；回调收到
 *   write,只能使用该回调写入,不要再次调用外层 writer(否则会等待自己)。
 */
export interface JsonWriter {
  (filePath: string, value: unknown, onCommitted?: () => void): Promise<void>;
  enqueue<T>(mutate: (write: JsonWrite) => Promise<T>): Promise<T>;
}

/** 创建原子 JSON 写入器(独立写队列,实例间互不串扰)。
 *  @param deps 可注入的 fs 依赖面(缺省真实 fs;测试用于观测 fsync 调用与构造失败) */
export function createJsonWriter(deps: JsonWriterDeps = defaultJsonWriterDeps): JsonWriter {
  let writeChain: Promise<void> = Promise.resolve();

  const writeNow: JsonWrite = async (filePath, value, onCommitted) => {
    const tmpPath = `${filePath}.tmp`;
    try {
      // 单一句柄完成「写 + fsync + 关」:内容在 rename 之前已刷到稳定存储,
      // 断电后 tmp 要么是完整新值、要么不存在,不会出现半个 JSON 被当成成品。
      const handle = await deps.openFile(tmpPath);
      try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await deps.rename(tmpPath, filePath);
    } catch (error: unknown) {
      // 失败不提交缓存(原文件保持为最后一次成功值),并清理半成品 tmp;
      // 错误原样抛给调用方,队列不截断,下一次写仍可恢复。
      await deps.remove(tmpPath).catch(() => undefined);
      throw error;
    }
    // rename 已完成:父目录 fsync 只影响目录项落盘的保证,失败不推翻已成功的写
    // (defensive:即便注入的实现违反「不得 reject」契约,也不能让调用方误以为旧值还在)
    await deps.syncDir(path.dirname(filePath)).catch((error: unknown) => {
      console.warn(`[atomic-json] 父目录 fsync 失败(内容已落盘,仅目录项未保证):${String(error)}`);
    });
    onCommitted?.();
  };

  const writer = ((filePath: string, value: unknown, onCommitted?: () => void) => {
    const task = writeChain.then(() => writeNow(filePath, value, onCommitted));
    // 单次写失败不阻断后续写入;错误由本调用方各自处理
    writeChain = task.catch(() => undefined);
    return task;
  }) as JsonWriter;

  writer.enqueue = <T>(mutate: (write: JsonWrite) => Promise<T>): Promise<T> => {
    const task = writeChain.then(() => mutate(writeNow));
    // 事务失败同样不能截断队列;调用方仍能收到本次原始错误
    writeChain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  return writer;
}
