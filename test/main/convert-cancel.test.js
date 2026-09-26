// @ts-check
/**
 * 单文件/批量取消与时间上限贯穿验收(位于 test/main/ = 主进程层;被测
 * src/main/converter/single.ts、batch.ts 与 context.ts,经 dist 直连,electron 环境;
 * 合并链路的同款断言见 merge-cancel.test.js):
 * - 映射面:buildConvertContext 把 main 上下文的 signal/deadline 原样透传给 core
 *   ConvertContext(单源构造,不逐字复制);
 * - 单文件:过期 deadline 在 core 渲染层入口即判取消(main 闸门只看 cancelRequested,
 *   过期 deadline 只有渲染层会判——这是「确实透传到 core」的判据);
 * - 渲染期取消归一为本层 ConvertCanceledError(而非 core 侧错误类型),使 IPC 取消
 *   分支与调用方 catch 仍判定为「已取消」;取消后零产物;
 * - 批量:过期 deadline → 逐项结算为 canceled(okCount 为 0),证明批次 ctx 的
 *   signal/deadline 同样到达逐文件 convertImpl;
 * - 对照组:未到期 deadline 与未取消转换照常产出(透传不误伤)。
 * 运行时样例与产物放 os.tmpdir() 独立目录,finally 整体删除;settings 经
 * backupSettings 备份/恢复(与 merge-cancel.test.js 同款卫生)。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSettings, updateSettings } from "../../dist/main/persist/settings.js";
import {
  batchConvertImpl,
  buildConvertContext,
  convertImpl,
  createConvertContext,
} from "../../dist/main/converter/index.js";
import { ConvertCanceledError } from "../../dist/main/converter/context.js";
import { isConversionCanceled } from "../../dist/core/cancel.js";
import { backupSettings } from "../common/settings.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`convert-cancel 断言失败:${msg}`);
}

/**
 * 目录内的产物清单(断言取消后零产物)
 * @param {string} dir 目录
 * @returns {Promise<string[]>} 产物文件名列表
 */
async function artifactsOf(dir) {
  return (await fs.readdir(dir)).filter((name) => name.endsWith(".docx"));
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-convert-cancel-${process.pid}`);
  const { restore: restoreSettings } = await backupSettings();
  try {
    await fs.mkdir(dir, { recursive: true });
    await updateSettings({ outputDir: "", afterConvert: "none" });
    // 源文件放独立子目录:产物落在源目录,便于断言「取消后无产物」
    const srcDir = path.join(dir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    // 带缺失图片的文档:图片解析经 core 的守卫竞速(race),取消能在异步回调等待处生效
    const files = Array.from({ length: 6 }, (_, i) => path.join(srcDir, `c${i}.md`));
    for (const [i, file] of files.entries()) {
      await fs.writeFile(
        file,
        `# 标题 ${i}\n\n正文 ${i}\n\n![图](missing-${i}.png)\n\n## 小节\n\n更多正文\n`,
        "utf8",
      );
    }
    const settings = loadSettings();

    // ---- 0. 映射面:buildConvertContext 原样透传 signal/deadline 到 core ----
    {
      const ctx = createConvertContext({ deadline: Date.now() + 60_000 });
      const coreCtx = await buildConvertContext({
        baseDir: srcDir,
        convert: ctx,
        title: "t",
        settings,
        imageResolver: async () => null,
      });
      assert(coreCtx.signal === ctx.signal, "core 上下文应复用 main 上下文的 signal 对象(非副本)");
      assert(coreCtx.deadline === ctx.deadline, "core 上下文的 deadline 应等于 main 上下文的 deadline");
      console.log("[ok] convert-cancel:buildConvertContext 透传 signal/deadline 到 core");
    }

    // ---- 1. 单文件过期 deadline:core 渲染层入口判取消 → 归一为本层取消错误,零产物 ----
    // 确定性判据:main 闸门只读 cancelRequested(deadline 不置位),故「过期 deadline 抛取消」
    // 只可能来自渲染层守卫——signal/deadline 未透传 core 时本用例必然失败(会正常产出)。
    {
      const ctx = createConvertContext({ deadline: Date.now() - 1 });
      /** @type {Error | undefined} */
      let error;
      try {
        await convertImpl(files[0], "docx", undefined, ctx);
      } catch (err) {
        error = /** @type {Error} */ (err);
      }
      assert(
        error instanceof ConvertCanceledError,
        `过期 deadline 应归一为本层 ConvertCanceledError,实际 ${error?.stack ?? error}`,
      );
      assert(isConversionCanceled(error), "过期 deadline 的错误码应为 ERR_CONVERSION_CANCELLED");
      assert((await artifactsOf(srcDir)).length === 0, "过期 deadline 不应产出任何文件");
      console.log("[ok] convert-cancel:单文件过期 deadline 经 core 渲染层取消并归一为本层取消错误");
    }

    // ---- 2. 渲染期取消:落在 render 上报之后(此刻已越过 main 入口闸门),取消经 signal
    //         到达 core 入口检查点 → 仍归一为本层取消错误,且零产物 ----
    {
      const ctx = createConvertContext();
      /** @type {Error | undefined} */
      let error;
      try {
        await convertImpl(files[0], "docx", (/** @type {string} */ stage) => {
          if (stage === "render") ctx.cancel();
        }, ctx);
      } catch (err) {
        error = /** @type {Error} */ (err);
      }
      assert(
        error instanceof ConvertCanceledError,
        `渲染期取消应归一为本层 ConvertCanceledError(不得泄漏 core 侧错误类型),实际 ${error?.stack ?? error}`,
      );
      assert(ctx.signal.aborted === true, "取消后信号应保持 aborted(供渲染层检查点感知)");
      assert((await artifactsOf(srcDir)).length === 0, "渲染期取消不应产出任何文件");
      console.log("[ok] convert-cancel:渲染期取消(越过 main 闸门后)被识别为取消且零产物");
    }

    // ---- 3. 批量过期 deadline:批次 ctx 透传到逐文件 convertImpl → 逐项结算为取消 ----
    {
      const ctx = createConvertContext({ deadline: Date.now() - 1 });
      const result = await batchConvertImpl(files, "docx", undefined, ctx);
      assert(result.okCount === 0, `过期 deadline 下批量不应有成功项,实际 ok=${result.okCount}`);
      assert(
        result.canceledCount === files.length && result.items.every((item) => item?.canceled === true),
        `过期 deadline 下全部应结算为取消,实际 canceled=${result.canceledCount}/${files.length}`,
      );
      assert(
        result.okCount + result.failCount + result.canceledCount === files.length,
        "取消后汇总必须逐项归属(不留空洞)",
      );
      assert((await artifactsOf(srcDir)).length === 0, "批量过期 deadline 不应产出任何文件");
      console.log("[ok] convert-cancel:批量过期 deadline 逐文件取消(汇总完整/零产物)");
    }

    // ---- 4. 对照组:未到期 deadline 与未取消转换照常产出(透传不误伤) ----
    {
      const ctx = createConvertContext({ deadline: Date.now() + 60_000 });
      const result = await convertImpl(files[0], "docx", undefined, ctx);
      assert(typeof result.outputPath === "string" && result.outputPath.length > 0, "未到期 deadline 应正常产出");
      assert((await artifactsOf(srcDir)).length === 1, "对照组应产出 1 个产物");
      const batch = await batchConvertImpl(files.slice(1, 3), "docx");
      assert(batch.okCount === 2, `未取消的批量应全部成功,实际 ok=${batch.okCount}`);
      assert((await artifactsOf(srcDir)).length === 3, "对照组批量应再产出 2 个产物");
      console.log("[ok] convert-cancel:未到期 deadline/未取消转换照常产出(对照组)");
    }
  } finally {
    await restoreSettings();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
