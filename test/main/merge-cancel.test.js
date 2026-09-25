/**
 * 合并取消传播验收(位于 test/main/ = 主进程层;被测 src/main/converter/merge.ts
 * 与 context.ts,经 dist 桶导出,electron 环境):
 * - 合并把 main 取消上下文的 signal 透传给 core ConvertContext:取消能到达渲染层
 *   检查点与异步回调(不再只能等整篇渲染结束);
 * - 取消在 main 面归一为本层 ConvertCanceledError(错误码同 core 的
 *   ERR_CONVERSION_CANCELLED),使 IPC 取消分支与调用方 catch 仍判定为「已取消」
 *   而非「转换失败」;
 * - 取消后不产出任何最终文件(无半成品)。
 * 运行时样例与产物放 os.tmpdir() 独立目录,finally 整体删除;settings 经
 * backupSettings 备份/恢复(与 converter.test.js 同款卫生)。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateSettings } from "../../dist/main/persist/settings.js";
import { createConvertContext, mergeConvertImpl } from "../../dist/main/converter/index.js";
import { ConvertCanceledError } from "../../dist/main/converter/context.js";
import { isConversionCanceled } from "../../dist/core/cancel.js";
import { backupSettings } from "../common/settings.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`merge-cancel 断言失败:${msg}`);
}

/** 目录内的产物清单(断言取消后零产物) */
async function artifactsOf(dir) {
  return (await fs.readdir(dir)).filter((name) => name.endsWith(".docx"));
}

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-merge-cancel-${process.pid}`);
  const { restore: restoreSettings } = await backupSettings();
  try {
    await fs.mkdir(dir, { recursive: true });
    await updateSettings({ outputDir: "", afterConvert: "none" });
    // 源文件放在独立子目录:产物落在源目录,便于断言「取消后无产物」
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    const files = Array.from({ length: 40 }, (_, i) => path.join(srcDir, `c${i}.md`));
    for (const [i, file] of files.entries()) {
      await fs.writeFile(file, `# 标题 ${i}\n\n正文 ${i}\n\n![图](missing-${i}.png)\n`, "utf8");
    }

    // ---- 1. 预取消:入口闸门即抛 main ConvertCanceledError,零产物 ----
    {
      const ctx = createConvertContext();
      ctx.cancel();
      let error;
      try {
        await mergeConvertImpl(files.slice(0, 3), "docx", undefined, ctx);
      } catch (err) {
        error = err;
      }
      assert(error instanceof ConvertCanceledError, `预取消应抛 ConvertCanceledError,实际 ${error?.stack ?? error}`);
      assert(isConversionCanceled(error), "预取消错误的错误码应为 ERR_CONVERSION_CANCELLED");
      assert((await artifactsOf(srcDir)).length === 0, "预取消不应产出任何文件");
      console.log("[ok] merge-cancel:预取消抛 ConvertCanceledError 且零产物");
    }

    // ---- 2. 转换途中取消:取消在读取/渲染阶段被识别,不产出产物、不报失败 ----
    {
      const ctx = createConvertContext();
      assert(ctx.signal.aborted === false, "新建上下文的信号应为未取消");
      const pending = mergeConvertImpl(files, "docx", undefined, ctx);
      setTimeout(() => ctx.cancel(), 0);
      let error;
      try {
        await pending;
      } catch (err) {
        error = err;
      }
      assert(isConversionCanceled(error), `途中取消应判定为取消(错误码单源),实际 ${error?.stack ?? error}`);
      assert((await artifactsOf(srcDir)).length === 0, "途中取消不应产出任何最终文件");
      // 取消后信号保持 aborted(供后续检查点与异步回调感知)
      assert(ctx.signal.aborted === true, "取消后信号应保持 aborted");
      console.log("[ok] merge-cancel:途中取消被识别为取消(不报失败)且零产物");
    }

    // ---- 3. 正常合并(对照组):不取消时产物照常落盘 ----
    {
      const ctx = createConvertContext();
      const result = await mergeConvertImpl(files.slice(0, 3), "docx", undefined, ctx);
      assert(result.ok && !!result.outputPath, `未取消的合并应成功,实际 ${JSON.stringify(result)}`);
      assert((await artifactsOf(srcDir)).length === 1, "未取消的合并应产出 1 个产物");
      console.log("[ok] merge-cancel:未取消的合并照常产出(对照组)");
    }
    // ---- 4. 过期 deadline:core 渲染层入口即判取消,main 面归一为 ConvertCanceledError ----
    // 用 deadline 而非 cancel() —— 后者只置 cancelRequested(入口闸门即拦),不会走到
    // core;deadline 经 buildConvertContext 透传到 core ConvertContext,是确定性的
    // 「渲染层取消 → main 面取消」通路。
    {
      const ctx = createConvertContext({ deadline: Date.now() - 1 });
      let error;
      try {
        await mergeConvertImpl(files.slice(0, 3), "docx", undefined, ctx);
      } catch (err) {
        error = err;
      }
      assert(error instanceof ConvertCanceledError, `过期 deadline 应归一为 ConvertCanceledError,实际 ${error?.stack ?? error}`);
      assert(isConversionCanceled(error), "过期 deadline 的错误码应为 ERR_CONVERSION_CANCELLED");
      assert((await artifactsOf(srcDir)).length === 1, "过期 deadline 不应新增产物(前一条用例的产物仍在)");
      console.log("[ok] merge-cancel:过期 deadline 经 core 渲染层取消并归一为本层取消错误");
    }
  } finally {
    await restoreSettings();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
