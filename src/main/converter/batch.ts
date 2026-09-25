/**
 * 批量转换实现:
 * 并发上限 2 的简单池,每文件独立 convertImpl,失败不中断。
 * 副作用所有权:整批至多触发一次导出后行为(逐文件经 batchCtx.skipAfterConvert 让位),
 * 取消/关窗中止后不触发。
 * 返回/进度类型契约(BatchResult/BatchItem/BatchProgressInfo)单源 core/ipc-contract.ts。
 */
import path from "node:path";
import type { ConvertFormat } from "../../core/settings/settings-defaults.js";
import type { BatchItem, BatchProgressInfo, BatchResult } from "../../core/ipc-contract.js";
import { loadSettings } from "../persist/settings.js";
import { ConvertCanceledError, createConvertContext, type ConvertContext } from "./context.js";
import { convertImpl, runAfterConvert } from "./single.js";

/**
 * 批量转换:并发上限 2 的简单池,每文件独立 convertImpl,失败不中断。
 * 取消支持(未开始项跳过,记 canceledCount);完成后按批次设置快照的 afterConvert
 * 打开第一个成功项(与单文件一致,不再强制跳过);进度经 onProgress 上报。
 * 配置一致性:批次入口即取 immutable settings snapshot(深拷贝),早于任何文件处理,
 * 批次期间修改设置(模块缓存被改写或 updateSettings 换新对象)都不产生混合配置——
 * 单文件/合并为单次转换,无跨文件配置混合面,不取快照。
 * 副作用所有权:每个文件跳过单文件 after-convert(batchCtx.skipAfterConvert),
 * 由本函数在批次末尾统一执行一次;取消闸门在 runAfterConvert 内最后一刻复查。
 * 汇总完整性:取消后 items 必须逐项归属(ok/fail/canceled),不留空洞,
 * okCount + failCount + canceledCount === files.length。
 */
export async function batchConvertImpl(
  files: string[],
  format: ConvertFormat,
  onProgress?: (info: BatchProgressInfo) => void,
  ctx: ConvertContext = createConvertContext(),
  katexDir?: string,
): Promise<BatchResult> {
  // 深拷贝:loadSettings 返回模块级缓存对象本体,直接沿用会让批次中途的设置改写渗入本批次
  const settingsSnapshot = structuredClone(loadSettings());
  const batchCtx: ConvertContext = {
    get cancelRequested() {
      return ctx.cancelRequested;
    },
    cancel: () => ctx.cancel(),
    skipAfterConvert: true,
  };
  const total = files.length;
  const items: BatchItem[] = new Array<BatchItem>(total);
  let okCount = 0;
  let failCount = 0;
  let canceledCount = 0;
  let next = 0; // 下一个待取任务的索引(worker 共享,JS 单线程自增安全)

  /**
   * 未取项(索引 ≥ next)全部标记取消:已取项(含在途,索引 < next)由其 worker 结算,
   * 不在此触碰,避免与在途 worker 抢写同一项导致计数重复。
   */
  function markRemainingCanceled(): void {
    for (let i = next; i < total; i++) {
      if (!items[i]) {
        items[i] = { file: files[i]!, ok: false, canceled: true }; // 循环上界 i<total 保证下标有效
        canceledCount++;
      }
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (batchCtx.cancelRequested) {
        markRemainingCanceled(); // 未开始项(含当前索引)标记取消,不再处理
        return;
      }
      const index = next++;
      if (index >= total) return;
      const file = files[index]!; // index < total 已守卫,必然存在
      const send = (stage: string): void =>
        onProgress?.({ index: index + 1, total, file: path.basename(file), stage });
      try {
        const { outputPath, warnings } = await convertImpl(
          file,
          format,
          send,
          batchCtx,
          katexDir,
          settingsSnapshot,
        );
        items[index] = { file, ok: true, outputPath, warnings };
        okCount++;
      } catch (err) {
        if (err instanceof ConvertCanceledError) {
          items[index] = { file, ok: false, canceled: true };
          canceledCount++;
          // 退出前结算未取项:否则并发 worker 全走取消分支时,尾部索引无人认领
          // (items 留空洞、canceledCount 少计,汇总与 renderer 逐项展示都失真)
          markRemainingCanceled();
          return;
        }
        items[index] = { file, ok: false, error: err instanceof Error ? err.message : String(err) };
        failCount++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, total) }, () => worker()));
  // 批次副作用:整个批次至多一次,只作用于第一个成功项(避免打开 N 个文件);
  // 取消/关窗中止后由 runAfterConvert 的闸门拦下——即便前序文件已成功落盘也不打开。
  const firstOk = items.find((item) => item?.ok); // 稀疏数组:find 跳过空洞,可选链兜底
  if (firstOk?.outputPath) {
    await runAfterConvert(settingsSnapshot.afterConvert, firstOk.outputPath, batchCtx);
  }
  return { ok: true, items, okCount, failCount, canceledCount };
}
