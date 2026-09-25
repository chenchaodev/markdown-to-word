/**
 * 批量转换实现:
 * 并发上限 2 的简单池,每文件独立 convertImpl,失败不中断。
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
 * 批次开始复制设置快照,后续设置 mutation 不影响本批次;每个文件跳过单文件
 * after-convert,由本函数统一执行一次。
 */
export async function batchConvertImpl(
  files: string[],
  format: ConvertFormat,
  onProgress?: (info: BatchProgressInfo) => void,
  ctx: ConvertContext = createConvertContext(),
  katexDir?: string,
): Promise<BatchResult> {
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

  async function worker(): Promise<void> {
    for (;;) {
      if (batchCtx.cancelRequested) {
        // 未开始项(含当前索引)标记取消,不再处理
        for (let i = next; i < total; i++) {
          if (!items[i]) {
            items[i] = { file: files[i]!, ok: false, canceled: true }; // 循环上界 i<total 保证下标有效
            canceledCount++;
          }
        }
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
          return;
        }
        items[index] = { file, ok: false, error: err instanceof Error ? err.message : String(err) };
        failCount++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, total) }, () => worker()));
  // 批量导出后行为:与单文件一致,作用于第一个成功项(避免打开 N 个文件)
  if (!batchCtx.cancelRequested) {
    const firstOk = items.find((i) => i.ok);
    if (firstOk?.outputPath) {
      await runAfterConvert(settingsSnapshot.afterConvert, firstOk.outputPath);
    }
  }
  return { ok: true, items, okCount, failCount, canceledCount };
}
