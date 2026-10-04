// @ts-check
/**
 * 合并取消传播验收(位于 test/main/ = 主进程层;被测 src/main/converter/merge.ts
 * 与 context.ts,经 dist 桶导出,electron 环境):
 * - 合并把 main 取消上下文的 signal 透传给 core ConvertContext:取消能到达渲染层
 *   检查点与异步回调(不再只能等整篇渲染结束);
 * - 取消在 main 面归一为本层 ConvertCanceledError(错误码同 core 的
 *   ERR_CONVERSION_CANCELLED),使 IPC 取消分支与调用方 catch 仍判定为「已取消」
 *   而非「转换失败」;
 * - 取消后不产出任何最终文件(无半成品)。
 * - 读取完成后的取消闸门不被绕过:取消被拦在正文合并之前,不进入渲染。
 * 运行时样例与产物放 os.tmpdir() 独立目录,finally 整体删除;settings 经
 * backupSettings 备份/恢复(与 converter.test.js 同款卫生)。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateSettings } from "../../dist/main/persist/settings.js";
import { createConvertContext, mergeConvertImpl } from "../../dist/main/converter/index.js";
import { ConvertCanceledError } from "../../dist/convert/context.js";
import { isConversionCanceled } from "../../dist/core/cancel.js";
import { backupSettings } from "../harness/settings.js";
import { removeTree } from "../harness/temp-resource.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`merge-cancel 断言失败:${msg}`);
}

/**
 * 目录内的产物清单(断言取消后零产物)
 * @param {string} dir 目录
 * @returns {Promise<string[]>} 产物文件名列表
 */
async function artifactsOf(dir) {
  return (await fs.readdir(dir)).filter((name) => name.endsWith(".docx"));
}

/**
 * 取布尔值(经函数取值:前一次 `assert(flag === false)` 会把该属性收窄成字面量,
 * 而两次断言之间实现会改写它——直接再比较会误报「无交集」)。
 * @param {boolean} value 布尔值
 * @returns {boolean} 原值
 */
const liveFlag = (value) => value;

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

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
      /** @type {Error | undefined} */
      let error;
      try {
        await mergeConvertImpl(files.slice(0, 3), "docx", undefined, ctx);
      } catch (err) {
        error = /** @type {Error} */ (err);
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
      /** @type {Error | undefined} */
      let error;
      try {
        await pending;
      } catch (err) {
        error = /** @type {Error} */ (err);
      }
      assert(isConversionCanceled(error), `途中取消应判定为取消(错误码单源),实际 ${error?.stack ?? error}`);
      assert((await artifactsOf(srcDir)).length === 0, "途中取消不应产出任何最终文件");
      // 取消后信号保持 aborted(供后续检查点与异步回调感知)
      // 经函数取值:上一条 `assert(aborted === false)` 已把该属性收窄成 false 字面量,
      // 而两次断言之间 ctx.cancel() 会改写它
      assert(liveFlag(ctx.signal.aborted) === true, "取消后信号应保持 aborted");
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
      /** @type {Error | undefined} */
      let error;
      try {
        await mergeConvertImpl(files.slice(0, 3), "docx", undefined, ctx);
      } catch (err) {
        error = /** @type {Error} */ (err);
      }
      assert(error instanceof ConvertCanceledError, `过期 deadline 应归一为 ConvertCanceledError,实际 ${error?.stack ?? error}`);
      assert(isConversionCanceled(error), "过期 deadline 的错误码应为 ERR_CONVERSION_CANCELLED");
      assert((await artifactsOf(srcDir)).length === 1, "过期 deadline 不应新增产物(前一条用例的产物仍在)");
      console.log("[ok] merge-cancel:过期 deadline 经 core 渲染层取消并归一为本层取消错误");
    }

    // ---- 5. 读取完成后的取消闸门:取消不得越过正文合并 ----
    // 「mergeMarkdowns 未被调用」无模块打桩可断言(全仓 ESM、无注入点),
    // 故取机械等价面:merge.ts 在 mergeMarkdowns 之后才报 render 阶段,
    // 阶段序列含 render 即等价于已进入合并正文,断言其不含 render 即可。
    // 取消的发出点选在 read 报点(读取开始前):读取完成到该闸门之间是同步区间
    // (mapWithConcurrency 的 await 之后无任何让出点),故「已取消」标志只可能
    // 在此之前置位——这正是该闸门要守的窗口;若改用定时器,定时器必落在读取
    // 开始之前(被入口闸门拦下)或读取完成之后(已越过闸门),守不到这一道。
    {
      const ctx = createConvertContext();
      /** @type {string[]} */
      const stages = [];
      let canceled = false;
      /**
       * 记录阶段并发出取消(参数显式标注:被测声明在 dist 产物上,类型不从 src 推导)。
       * @param {string} stage 阶段名
       */
      const recordStage = (stage) => {
        stages.push(stage);
        if (!canceled) {
          canceled = true;
          ctx.cancel();
        }
      };
      const pending = mergeConvertImpl(files, "docx", recordStage, ctx);
      /** @type {Error | undefined} */
      let error;
      try {
        await pending;
      } catch (err) {
        error = /** @type {Error} */ (err);
      }
      assert(canceled, "取消须在 read 报点发出,否则本用例守不到读取后的闸门");
      assert(error instanceof ConvertCanceledError, `读取后取消应抛 ConvertCanceledError,实际 ${error?.stack ?? error}`);
      assert((await artifactsOf(srcDir)).length === 1, "读取后取消不应新增产物(前一条用例的产物仍在)");
      assert(
        !stages.includes("render"),
        `读取后取消不应报出 render 阶段(等价于未进入正文合并),实际阶段序列 ${JSON.stringify(stages)}`,
      );
      console.log(`[ok] merge-cancel:读取后取消被拦在正文合并之前(阶段序列 ${JSON.stringify(stages)})`);
    }
  } finally {
    await restoreSettings();
    // 清理失败刻意吞掉:finally 里的清理不得盖过段内真正的断言失败(助手只负责吸收 Windows 上的瞬时占用)
    removeTree(dir);
  }
}
