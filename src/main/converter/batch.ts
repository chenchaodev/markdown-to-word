/**
 * 批量转换实现(目录重组批⑤自 converter.ts 拆出):
 * 并发上限 2 的简单池,每文件独立 convertImpl,失败不中断。
 */
import path from "node:path";
import type { ConvertFormat } from "../../core/convert.js";
import type { ConvertWarning } from "../../core/i18n.js";
import { loadSettings } from "../persist/settings.js";
import { ConvertCanceledError, createConvertContext, type ConvertContext } from "./context.js";
import { convertImpl, runAfterConvert } from "./single.js";

export interface BatchProgressInfo {
  index: number;
  total: number;
  file: string;
  stage: string;
}

export interface BatchItem {
  file: string;
  ok: boolean;
  outputPath?: string;
  error?: string;
  warnings?: ConvertWarning[];
  /** 用户主动取消(未开始即跳过) */
  canceled?: boolean;
}

export interface BatchResult {
  ok: true;
  items: BatchItem[];
  okCount: number;
  failCount: number;
  /** 用户主动取消的未开始项数量 */
  canceledCount: number;
}

/**
 * 批量转换:并发上限 2 的简单池,每文件独立 convertImpl,失败不中断。
 * 批次 7:取消支持(未开始项跳过,记 canceledCount);完成后按 afterConvert
 * 打开第一个成功项(与单文件一致,不再强制跳过);进度经 onProgress 上报。
 */
export async function batchConvertImpl(
  files: string[],
  format: ConvertFormat,
  onProgress?: (info: BatchProgressInfo) => void,
  ctx: ConvertContext = createConvertContext(),
  katexDir?: string,
): Promise<BatchResult> {
  const total = files.length;
  const items: BatchItem[] = new Array<BatchItem>(total);
  let okCount = 0;
  let failCount = 0;
  let canceledCount = 0;
  let next = 0; // 下一个待取任务的索引(worker 共享,JS 单线程自增安全)

  async function worker(): Promise<void> {
    for (;;) {
      if (ctx.cancelRequested) {
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
        const { outputPath, warnings } = await convertImpl(file, format, send, ctx, katexDir);
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
  if (!ctx.cancelRequested) {
    const firstOk = items.find((i) => i.ok);
    if (firstOk?.outputPath) {
      const settings = await loadSettings();
      await runAfterConvert(settings.afterConvert, firstOk.outputPath);
    }
  }
  return { ok: true, items, okCount, failCount, canceledCount };
}
