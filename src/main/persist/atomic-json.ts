/**
 * JSON 文件原子写共享工具(main 层;自 settings.ts / ui-state.ts 双份实现抽出,行为零变化):
 * - 原子写:临时文件 + rename(Windows 下 rename 可覆盖已存在文件)
 * - 写队列:promise 链串行化——write+rename 之间不得插入其它写(同 tmp 路径),
 *   调用序 = 写盘序,链尾即最终态;单次写失败(如磁盘错误)不截断队列,
 *   错误由调用方各自处理
 * 每实例独立队列(settings / ui-state 各持一实例,保持原双链语义)。
 * 注意:core/ 为纯净层(无 IO、无 Electron),本工具属 main 层,勿下沉。
 */
import { rename, writeFile } from "node:fs/promises";

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

/** 创建原子 JSON 写入器(独立写队列,实例间互不串扰)。 */
export function createJsonWriter(): JsonWriter {
  let writeChain: Promise<void> = Promise.resolve();

  const writeNow: JsonWrite = async (filePath, value, onCommitted) => {
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmpPath, filePath);
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
