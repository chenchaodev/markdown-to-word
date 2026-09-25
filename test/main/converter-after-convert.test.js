/**
 * 导出后行为(after-convert)副作用所有权段(test/main/,与 converter.test.js 同为
 * 主进程层,经 dist/main/converter/index.js 真实实现,docx 链路不依赖 Electron 打印):
 * 断言「谁触发、触发几次、取消后是否触发」三条契约
 * - 所有权:单文件每次转换 1 次;合并整次合并 1 次;批量整批 1 次(逐文件让位);
 *   批量/合并只有首个/单个产物被打开,不出现 N+1 次。
 * - 取消/关窗竞态:取消发生在「产物已落盘 → 打开产物」的最后窗口也绝不打开;
 *   取消经 ctx.cancel()(用户取消)与 cancelWebContentsOperation()(主窗「放弃转换并关闭」)
 *   两条入口同构,均断言零副作用。
 * - 配置快照:批次入口取深拷贝 immutable snapshot,批次中途改写模块级设置缓存
 *   (含嵌套 pageSetup)不产生混合配置——浅拷贝实现在此露馅。
 * shell.openPath / shell.showItemInFolder 临时替换为记录器(不可写则 defineProperty 兜底),
 * 一律 finally 还原(段同进程串行,不得污染其他段);产物落 os.tmpdir() 独立目录并整体删除;
 * 用户设置经 backupSettings 备份还原。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { shell } from "electron";
import { loadSettings, updateSettings } from "../../dist/main/persist/settings.js";
import {
  beginWebContentsOperation,
  cancelWebContentsOperation,
  finishWebContentsOperation,
} from "../../dist/main/windows/web-contents-registry.js";
import {
  batchConvertImpl,
  ConvertCanceledError,
  convertImpl,
  createConvertContext,
  mergeConvertImpl,
} from "../../dist/main/converter/index.js";
import { backupSettings } from "../common/settings.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`converter-after-convert 断言失败:${msg}`);
}

/** 记录 shell 副作用调用:{ action, path };finally 还原原实现 */
async function withShellRecorder(fn) {
  const calls = [];
  const originals = { openPath: shell.openPath, showItemInFolder: shell.showItemInFolder };
  const viaDefine = new Set();
  const patch = (key, impl) => {
    try {
      shell[key] = impl;
    } catch {
      Object.defineProperty(shell, key, { configurable: true, writable: true, value: impl });
      viaDefine.add(key);
    }
  };
  patch("openPath", async (opened) => {
    calls.push({ action: "open", path: opened });
    return "";
  });
  patch("showItemInFolder", (shown) => {
    calls.push({ action: "show-in-folder", path: shown });
  });
  try {
    return await fn(calls);
  } finally {
    for (const key of ["openPath", "showItemInFolder"]) {
      if (viaDefine.has(key)) {
        Object.defineProperty(shell, key, { configurable: true, writable: true, value: originals[key] });
      } else {
        shell[key] = originals[key];
      }
    }
  }
}

/** 取消点:stage 命中即 ctx.cancel()(模拟进度回调里收到取消,如 IPC convert:cancel) */
function cancelOnStage(stages, ctx, wanted) {
  return (stage) => {
    stages.push(stage);
    if (stages.includes(wanted)) ctx.cancel();
  };
}

/** 汇总完整性:逐项有归属(无空洞)且计数和 = 文件总数 */
function assertBatchTotals(result, total, label) {
  assert(
    result.items.length === total && result.items.every((item) => !!item),
    `${label}:items 应逐项有归属(无空洞),实际 ${JSON.stringify(result.items)}`,
  );
  assert(
    result.okCount + result.failCount + result.canceledCount === total,
    `${label}:计数和应等于总数,ok=${result.okCount} fail=${result.failCount} canceled=${result.canceledCount} total=${total}`,
  );
}

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-after-convert-${process.pid}`);
  const restoreSettings = await backupSettings();
  /** 目录内以 base 开头的非 md 文件名(产物;重名序号变体一并计入) */
  const outputsOf = async (base) =>
    (await fs.readdir(dir)).filter((name) => name.startsWith(base) && !name.endsWith(".md"));
  try {
    await fs.mkdir(dir, { recursive: true });
    // 输出目录置 ""(产物落源文件同目录 = 本段临时目录);toc 关掉减少无关分页/目录开销
    await updateSettings({ outputDir: "", toc: false, breakBeforeH1: false, afterConvert: "none" });

    const singleMd = path.join(dir, "single.md");
    const folderMd = path.join(dir, "folder.md");
    const earlyCancelMd = path.join(dir, "early-cancel.md");
    const postPersistMd = path.join(dir, "post-persist.md");
    const notMarkdown = path.join(dir, "not-markdown.txt");
    for (const file of [singleMd, folderMd, earlyCancelMd, postPersistMd, notMarkdown]) {
      await fs.writeFile(file, `# ${path.basename(file)}\n\n正文\n`, "utf8");
    }
    const batchFiles = [1, 2, 3, 4].map((n) => path.join(dir, `batch-${n}.md`));
    for (const file of batchFiles) await fs.writeFile(file, `# ${path.basename(file)}\n\n正文\n`, "utf8");
    const mergeA = path.join(dir, "merge-a.md");
    const mergeB = path.join(dir, "merge-b.md");
    await fs.writeFile(mergeA, "# 合并甲\n\n正文甲\n", "utf8");
    await fs.writeFile(mergeB, "# 合并乙\n\n正文乙\n", "utf8");

    // ---- 1. 单文件成功:open 分支恰好 1 次,且作用于本次产物 ----
    await updateSettings({ afterConvert: "open" });
    await withShellRecorder(async (calls) => {
      const result = await convertImpl(singleMd, "docx");
      assert(calls.length === 1, `单文件 open 应恰好 1 次,实际 ${calls.length} 次`);
      assert(calls[0].action === "open" && calls[0].path === result.outputPath, "单文件 open 应打开本次产物");
    });
    console.log("[ok] after-convert:单文件成功恰好 1 次(作用于本次产物)");

    // ---- 2. 单文件成功:show-in-folder 分支同样受闸门约束(恰好 1 次) ----
    await updateSettings({ afterConvert: "show-in-folder" });
    await withShellRecorder(async (calls) => {
      const result = await convertImpl(folderMd, "docx");
      assert(calls.length === 1, `单文件 show-in-folder 应恰好 1 次,实际 ${calls.length} 次`);
      assert(calls[0].action === "show-in-folder" && calls[0].path === result.outputPath, "应在资源管理器定位本次产物");
    });
    console.log("[ok] after-convert:单文件 show-in-folder 恰好 1 次");

    // ---- 3. 单文件 action=none:零副作用(不打开任何产物) ----
    await updateSettings({ afterConvert: "none" });
    await withShellRecorder(async (calls) => {
      const result = await convertImpl(singleMd, "docx");
      assert(!!result.outputPath, "none 分支仍应正常产出");
      assert(calls.length === 0, `action=none 不应触发副作用,实际 ${calls.length} 次`);
    });
    console.log("[ok] after-convert:action=none 零副作用");

    // ---- 4. 单文件失败(非 markdown):抛错且零副作用(失败不打开产物) ----
    await updateSettings({ afterConvert: "open" });
    await withShellRecorder(async (calls) => {
      let failed = false;
      try {
        await convertImpl(notMarkdown, "docx");
      } catch {
        failed = true;
      }
      assert(failed, "非 markdown 应抛错");
      assert(calls.length === 0, `转换失败不应触发副作用,实际 ${calls.length} 次`);
    });
    console.log("[ok] after-convert:单文件失败零副作用");

    // ---- 5. 单文件取消(落盘前):抛 ConvertCanceledError + 不产出文件 + 零副作用 ----
    await updateSettings({ afterConvert: "open" });
    await withShellRecorder(async (calls) => {
      const ctx = createConvertContext();
      let canceled = false;
      try {
        await convertImpl(earlyCancelMd, "docx", cancelOnStage(["read"], ctx, "read"), ctx);
      } catch (err) {
        canceled = err instanceof ConvertCanceledError;
      }
      assert(canceled, "落盘前取消应抛 ConvertCanceledError");
      assert((await outputsOf("early-cancel")).length === 0, "落盘前取消不应产出文件");
      assert(calls.length === 0, `落盘前取消不应触发副作用,实际 ${calls.length} 次`);
    });
    console.log("[ok] after-convert:单文件落盘前取消(抛取消错误/无产物/零副作用)");

    // ---- 6. 单文件取消(落盘后闸门):产物已在盘但绝不打开 + 抛取消错误 ----
    await updateSettings({ afterConvert: "open" });
    await withShellRecorder(async (calls) => {
      const ctx = createConvertContext();
      let canceled = false;
      try {
        await convertImpl(postPersistMd, "docx", cancelOnStage(["read"], ctx, "done"), ctx);
      } catch (err) {
        canceled = err instanceof ConvertCanceledError;
      }
      assert(canceled, "落盘后取消应抛 ConvertCanceledError");
      assert((await outputsOf("post-persist")).length === 1, "落盘后取消场景:产物应已写盘(证明取消点在闸门上)");
      assert(calls.length === 0, `落盘后取消不应打开产物,实际 ${calls.length} 次`);
    });
    console.log("[ok] after-convert:单文件落盘后取消(产物已写盘但零副作用)");

    // ---- 7. 关窗竞态:主窗「放弃转换并关闭」经 cancelWebContentsOperation 取消当前操作,
    //      与用户取消同构 → 落盘后窗口被取消也绝不打开产物 ----
    await updateSettings({ afterConvert: "open" });
    await withShellRecorder(async (calls) => {
      const webContentsId = 987654321; // 真实 id 不会取到,仅为注册表键
      const ctx = createConvertContext();
      const token = beginWebContentsOperation(webContentsId, "single", ctx);
      assert(token !== null, "注册表应接受首次操作占用");
      try {
        let canceled = false;
        try {
          await convertImpl(
            postPersistMd,
            "docx",
            (stage) => {
              // 只在落盘后取消:闸门窗口(产物已写盘 → 打开产物)才是本例的断言面
              if (stage === "done") cancelWebContentsOperation(webContentsId);
            },
            ctx,
          );
        } catch (err) {
          canceled = err instanceof ConvertCanceledError;
        }
        assert(canceled, "关窗放弃应表现为取消(ConvertCanceledError)");
        assert((await outputsOf("post-persist")).length === 2, "关窗放弃场景:应已写盘(重名序号变体),证明取消点在闸门上");
        assert(calls.length === 0, `关窗放弃后不应打开产物,实际 ${calls.length} 次`);
      } finally {
        assert(finishWebContentsOperation(webContentsId, token) === true, "compare-and-delete 应释放本 token");
      }
    });
    console.log("[ok] after-convert:关窗放弃(注册表取消)落盘后零副作用");

    // ---- 8. 批量成功:整批恰好 1 次,只作用于第一个成功项(无 N+1) ----
    await updateSettings({ afterConvert: "open" });
    await withShellRecorder(async (calls) => {
      const result = await batchConvertImpl(batchFiles, "docx");
      assert(result.okCount === batchFiles.length, `批量应全部成功,实际 ok=${result.okCount}`);
      assertBatchTotals(result, batchFiles.length, "批量成功");
      assert(calls.length === 1, `批量 after-convert 应恰好 1 次,实际 ${calls.length} 次`);
      const firstOk = result.items.find((item) => item.ok);
      assert(calls[0].path === firstOk.outputPath, "批量应打开第一个成功项产物");
    });
    console.log("[ok] after-convert:批量成功整批恰好 1 次(第一个成功项)");

    // ---- 9. 批量取消(第 2 个文件落盘后取消):前序成功也不打开 + 汇总完整 ----
    await updateSettings({ afterConvert: "open" });
    await withShellRecorder(async (calls) => {
      const ctx = createConvertContext();
      let doneCount = 0;
      const result = await batchConvertImpl(batchFiles, "docx", (info) => {
        if (info.stage === "done" && ++doneCount === 2) ctx.cancel();
      }, ctx);
      assert(result.canceledCount > 0, "第 2 个文件落盘后取消应有取消项");
      assertBatchTotals(result, batchFiles.length, "批量取消");
      assert(calls.length === 0, `批量取消后不应打开产物,实际 ${calls.length} 次`);
    });
    console.log("[ok] after-convert:批量落盘后取消(前序成功也零副作用 + 汇总无空洞)");

    // ---- 9b. 批量取消落在「两个在途 worker 内」(第 2 个文件 read 时取消):
    //      两个 worker 均已越过取任务检查点 → 都走取消分支退出,尾部未取项必须被结算,
    //      否则 items 留空洞、canceledCount 少计(汇总与 renderer 逐项展示都失真) ----
    await updateSettings({ afterConvert: "open" });
    await withShellRecorder(async (calls) => {
      const ctx = createConvertContext();
      const inFlightFiles = [1, 2, 3, 4].map((n) => path.join(dir, `race-${n}.md`));
      for (const file of inFlightFiles) await fs.writeFile(file, `# ${path.basename(file)}\n\n正文\n`, "utf8");
      const result = await batchConvertImpl(inFlightFiles, "docx", (info) => {
        // 第 2 个文件刚被取走(read 阶段)即取消:此时两个 worker 都在 convertImpl 内
        if (info.stage === "read" && info.index === 2) ctx.cancel();
      }, ctx);
      assert(result.okCount === 0, `在途取消不应有成功项,实际 ok=${result.okCount}`);
      assert(result.canceledCount === inFlightFiles.length, `全部未取项应结算为取消,实际 canceled=${result.canceledCount}`);
      assertBatchTotals(result, inFlightFiles.length, "在途取消");
      assert(calls.length === 0, `在途取消不应打开产物,实际 ${calls.length} 次`);
    });
    console.log("[ok] after-convert:批量在途取消(尾部未取项全部结算,汇总无空洞)");

    // ---- 10. 批量全失败:无成功项 → 零副作用 ----
    await updateSettings({ afterConvert: "open" });
    await withShellRecorder(async (calls) => {
      const missing = [1, 2, 3].map((n) => path.join(dir, `missing-${n}.md`)); // 故意不写盘
      const result = await batchConvertImpl(missing, "docx");
      assert(result.okCount === 0 && result.failCount === 3, `全失败批量汇总异常:${JSON.stringify(result)}`);
      assertBatchTotals(result, missing.length, "批量全失败");
      assert(calls.length === 0, `无成功项不应触发副作用,实际 ${calls.length} 次`);
    });
    console.log("[ok] after-convert:批量全失败零副作用");

    // ---- 11. 批次 immutable settings snapshot:中途改写设置缓存(含嵌套 pageSetup)
    //      与 afterConvert 均不渗入本批次;快照为深拷贝,浅拷贝实现会露馅 ----
    await updateSettings({ afterConvert: "open", pageSetup: { ...loadSettings().pageSetup, orientation: "landscape" } });
    await withShellRecorder(async (calls) => {
      const snapshotFiles = [1, 2, 3].map((n) => path.join(dir, `snapshot-${n}.md`));
      for (const file of snapshotFiles) await fs.writeFile(file, `# ${path.basename(file)}\n\n正文\n`, "utf8");
      const result = await batchConvertImpl(snapshotFiles, "docx", (info) => {
        if (info.stage !== "read") return;
        // 直接改模块级缓存(等价于批次运行期间用户改设置并落缓存):嵌套块一并改
        const live = loadSettings();
        live.pageSetup.orientation = "portrait";
        live.afterConvert = "none";
      });
      assert(result.okCount === snapshotFiles.length, "快照批量应全部成功");
      for (const item of result.items) {
        const xml = await (await JSZip.loadAsync(await fs.readFile(item.outputPath)))
          .file("word/document.xml").async("string");
        assert(xml.includes('w:orient="landscape"'), `批次中途改设置不得产生混合配置:${item.file}`);
      }
      // 快照的 afterConvert("open")仍生效 → 整批 1 次;若读到中途的 "none" 则为 0 次
      assert(calls.length === 1, `批次应使用入口快照的 afterConvert 恰好 1 次,实际 ${calls.length} 次`);
      // 还原被本段改写的缓存字段(下一步骤依赖正确基线;文件与全量缓存由外层 finally 还原)
      const live = loadSettings();
      live.pageSetup.orientation = "landscape";
      live.afterConvert = "open";
    });
    console.log("[ok] after-convert:批次 immutable settings snapshot(嵌套设置/afterConvert 均不混入)");

    // ---- 12. 合并成功:整次合并恰好 1 次(单产物) ----
    await updateSettings({ afterConvert: "open" });
    await withShellRecorder(async (calls) => {
      const result = await mergeConvertImpl([mergeA, mergeB], "docx");
      assert(result.ok && !!result.outputPath, `合并应成功:${result.error ?? ""}`);
      assert(calls.length === 1, `合并 after-convert 应恰好 1 次,实际 ${calls.length} 次`);
      assert(calls[0].path === result.outputPath, "合并应打开本次合并产物");
    });
    console.log("[ok] after-convert:合并成功整次恰好 1 次");

    // ---- 13. 合并取消(落盘后最终取消检查):产物已写盘但绝不打开 + 抛取消错误 ----
    await withShellRecorder(async (calls) => {
      const ctx = createConvertContext();
      const stages = [];
      let canceled = false;
      try {
        await mergeConvertImpl([mergeA, mergeB], "docx", cancelOnStage(stages, ctx, "done"), ctx);
      } catch (err) {
        canceled = err instanceof ConvertCanceledError;
      }
      assert(canceled, "合并落盘后取消应抛 ConvertCanceledError(最终取消检查)");
      assert(stages.includes("done"), "本例取消点应落在落盘之后(stage=done)");
      assert((await outputsOf("merge-a-合并")).length > 0, "合并落盘后取消场景:产物应已写盘(证明取消点在闸门上)");
      assert(calls.length === 0, `合并落盘后取消不应打开产物,实际 ${calls.length} 次`);
    });
    console.log("[ok] after-convert:合并落盘后取消(最终取消检查,零副作用)");

    // ---- 14. 合并取消(落盘前):不新增产物文件 + 零副作用 ----
    await withShellRecorder(async (calls) => {
      const ctx = createConvertContext();
      const before = (await outputsOf("merge-a-合并")).length;
      let canceled = false;
      try {
        await mergeConvertImpl([mergeA, mergeB], "docx", cancelOnStage(["read"], ctx, "read"), ctx);
      } catch (err) {
        canceled = err instanceof ConvertCanceledError;
      }
      assert(canceled, "合并落盘前取消应抛 ConvertCanceledError");
      assert((await outputsOf("merge-a-合并")).length === before, "合并落盘前取消不应产出文件");
      assert(calls.length === 0, `合并落盘前取消不应触发副作用,实际 ${calls.length} 次`);
    });
    console.log("[ok] after-convert:合并落盘前取消(无副作用)");

    // ---- 15. 合并失败(空文件列表):抛错且零副作用 ----
    await withShellRecorder(async (calls) => {
      let failed = false;
      try {
        await mergeConvertImpl([], "docx");
      } catch {
        failed = true;
      }
      assert(failed, "空文件列表应抛错");
      assert(calls.length === 0, `合并失败不应触发副作用,实际 ${calls.length} 次`);
    });
    console.log("[ok] after-convert:合并失败零副作用");
  } finally {
    await restoreSettings.restore();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
