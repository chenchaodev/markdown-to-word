/**
 * 转换编排验收(位于 test/main/ = 主进程层测试;src/main/converter.ts 主进程编排层,
 * 测试经 dist/main/converter.js,electron 环境):
 * 覆盖从 smoke 迁出的纯逻辑断言(不依赖 Electron 打印/窗口,断言与 smoke 原版一字未改):
 * - 重名保护:convertImpl 两次 → 「名 (2).docx」且两产物共存
 * - 批量汇总(3 成功 + 1 缺失)与 merge docx(frontmatter 仅首文件/图片嵌入/标题齐全)
 * - 取消链路:批量取消(canceledCount=2/未开始项标记)、取消后复位(批量/merge)、
 *   pdf 预取消(ConvertCanceledError + 不产出文件)
 * - 设置注入端到端:持久化往返、landscape → w:orient、breakBeforeH1 → pageBreakBefore、
 *   分页符 → w:br page(toc:false 下仅显式分页符)
 * 实现事实(读源码确认):
 * - settings.ts 模块级 settingsCache:本段经 dist/main/settings.js 直连同一实例
 *   (converter.js 内部同 URL import → 同一模块实例),全部场景共享缓存
 *   → 结束前 updateSettings(orig) 恢复文件与缓存(与 smoke 原 restore 行为一致);
 *   原本无 settings.json 时恢复后删除文件,不污染用户设置(settings.test.js 同款卫生)
 * - convertImpl 输出目录 = settings.outputDir(空串 → 源文件同目录):本段统一置 ""
 *   + afterConvert "none"(测试环境不触发打开文件),保证断言确定性
 * - 样例/产物全部放 os.tmpdir() 独立目录,finally 整体删除,不污染 output/smoke
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { loadSettings, updateSettings } from "../../dist/main/settings.js";
import { backupSettings } from "../common/settings.js";
import {
  batchConvertImpl,
  ConvertCanceledError,
  convertImpl,
  createConvertContext,
  mergeConvertImpl,
} from "../../dist/main/converter.js";

const SAMPLE_MD = "# 冒烟测试 中文标题\n\n<!-- page-break -->\n\n| 列A | 列B |\n| --- | --- |\n| 你好 | world |\n\n- 项目一\n- 项目二\n";
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function assert(cond, msg) {
  if (!cond) throw new Error(`converter 断言失败:${msg}`);
}

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-converter-${process.pid}`);
  const sampleMd = path.join(dir, "sample.md");
  const restoreSettings = await backupSettings();
  try {    await fs.mkdir(dir, { recursive: true });
    // 输出目录指回源目录(样例同目录),afterConvert 置 none 保证断言确定性
    await updateSettings({ outputDir: "", afterConvert: "none" });
    await fs.writeFile(sampleMd, SAMPLE_MD, "utf8");

    // ---- 1. 重名保护:同 md 连续转换两次 → (2) 序号变体且两产物共存 ----
    const dup1 = await convertImpl(sampleMd, "docx");
    const dup2 = await convertImpl(sampleMd, "docx");
    assert(dup1.outputPath !== dup2.outputPath, "重名保护:两次产物路径相同");
    assert(dup2.outputPath.endsWith(" (2).docx"), `重名保护:第二次应为「名 (2).docx」,实际为 ${dup2.outputPath}`);
    await fs.stat(dup1.outputPath);
    await fs.stat(dup2.outputPath);
    console.log(`[ok] converter:重名保护 ${path.basename(dup2.outputPath)} 与 ${path.basename(dup1.outputPath)} 共存`);

    // ---- 2. 批量转换:3 成功 + 1 缺失 → 汇总逐条正确 + 产物存在 ----
    const batchFiles = ["batch-a.md", "batch-b.md", "batch-c.md"].map((n) => path.join(dir, n));
    for (const [i, f] of batchFiles.entries()) {
      await fs.writeFile(f, `# 批量文件 ${i + 1}\n\n正文 ${i + 1}\n`);
    }
    const batchMissing = path.join(dir, "batch-missing.md"); // 故意不写盘
    const batch = await batchConvertImpl([...batchFiles, batchMissing], "docx");
    assert(batch.okCount === 3 && batch.failCount === 1, `批量汇总错误: ok=${batch.okCount} fail=${batch.failCount}`);
    const failItem = batch.items.find((i) => !i.ok);
    assert(failItem?.file === batchMissing && !!failItem.error, "批量失败项汇总不正确");
    for (const item of batch.items) {
      if (item.ok) {
        assert(!!item.outputPath, "批量成功项缺少 outputPath");
        await fs.stat(item.outputPath); // 批量产物存在
      }
    }
    console.log("[ok] converter:批量 3 成功 1 失败(汇总逐条正确)");

    // ---- 3. merge docx:frontmatter 仅首文件保留/标题齐全/图片嵌入 ----
    const pngPath = path.join(dir, "g4-smoke.png");
    await fs.writeFile(pngPath, Buffer.from(PNG_1PX, "base64"));
    const mergeA = path.join(dir, "merge-a.md");
    const mergeB = path.join(dir, "merge-b.md");
    await fs.writeFile(mergeA, `---\ntitle: 合并首文件\n---\n\n# 合并第一章\n\n![图](g4-smoke.png)\n`);
    await fs.writeFile(mergeB, `---\ntitle: 合并第二文件\n---\n\n# 合并第二章\n\n正文\n`);
    const mergeResult = await mergeConvertImpl([mergeA, mergeB], "docx");
    // 重名序号变体兼容:输出目录可配置后产物可能为「merge-a-合并 (2).docx」,
    // 断言剥离 (N) 序号后缀后须以 -合并.docx 结尾(与 batch 断言同源修复)
    const mergeBase = mergeResult.outputPath?.replace(/\s\(\d+\)(?=\.docx$)/, "");
    assert(
      mergeResult.ok && !!mergeResult.outputPath && !!mergeBase?.endsWith("-合并.docx"),
      `合并输出异常: ${mergeResult.error ?? mergeResult.outputPath}`,
    );
    const mergeZip = await JSZip.loadAsync(await fs.readFile(mergeResult.outputPath));
    const mergeXml = await mergeZip.file("word/document.xml").async("string");
    assert(mergeXml.includes("合并第一章") && mergeXml.includes("合并第二章"), "合并产物缺少文件标题");
    assert(!mergeXml.includes("合并第二文件"), "合并产物残留后续 frontmatter title");
    const mergeRels = await mergeZip.file("word/_rels/document.xml.rels").async("string");
    assert(mergeRels.includes("image"), "合并产物图片未嵌入");
    console.log(`[ok] converter:merge ${path.basename(mergeResult.outputPath)} (frontmatter/图片/标题正确)`);

    // ---- 4. 批量取消:首个进度事件取消 → 在途项检查点取消 + 未开始项标记 ----
    const cancelFiles = ["batch-cancel-1.md", "batch-cancel-2.md", "batch-cancel-3.md"].map((n) =>
      path.join(dir, n),
    );
    await fs.writeFile(cancelFiles[1], "# 取消测试 2\n\n正文\n");
    await fs.writeFile(cancelFiles[2], "# 取消测试 3\n\n正文\n");
    const cancelBatchCtx = createConvertContext(); // 每次调用新建 context,取消经 ctx.cancel() 置位
    const cancelBatch = await batchConvertImpl(
      cancelFiles,
      "docx",
      () => {
        cancelBatchCtx.cancel(); // 首个进度事件即取消
      },
      cancelBatchCtx,
    );
    assert(
      cancelBatch.okCount === 0 &&
        cancelBatch.failCount === 1 &&
        cancelBatch.canceledCount === 2 &&
        !!cancelBatch.items[0] &&
        !cancelBatch.items[0].ok &&
        !!cancelBatch.items[0].error &&
        !!cancelBatch.items[1]?.canceled &&
        !!cancelBatch.items[2]?.canceled,
      `批量取消断言失败: ok=${cancelBatch.okCount} fail=${cancelBatch.failCount} canceled=${cancelBatch.canceledCount}` +
        ` items=${JSON.stringify(cancelBatch.items.map((i) => i && { ok: i.ok, canceled: i.canceled, error: !!i.error }))}`,
    );
    console.log("[ok] converter:批量取消(在途项检查点取消 + 未开始项标记 canceledCount=2)");

    // ---- 5. 批量复位:取消后再次批量转换必须成功(未传 ctx → 新建 context,取消标志不复用) ----
    const retryBatch = await batchConvertImpl(cancelFiles, "docx");
    assert(
      retryBatch.okCount === 2 && retryBatch.failCount === 1 && retryBatch.canceledCount === 0,
      `批量复位断言失败: ok=${retryBatch.okCount} fail=${retryBatch.failCount} canceled=${retryBatch.canceledCount}`,
    );
    console.log("[ok] converter:批量复位(取消后再次转换 2 成功 1 缺失失败,无取消残留)");

    // ---- 6. pdf 预取消:取消置位后 convertImpl(pdf) 抛 ConvertCanceledError 且不产出文件 ----
    // (检查点位于落盘前;outputDir 已置 "" → 候选输出目录 = 源文件目录)
    const cancelPdfMd = path.join(dir, "cancel-pdf.md");
    await fs.writeFile(cancelPdfMd, "# PDF 取消\n\n正文\n");
    const pdfCancelCtx = createConvertContext();
    pdfCancelCtx.cancel();
    let pdfCanceled = false;
    try {
      await convertImpl(cancelPdfMd, "pdf", undefined, pdfCancelCtx);
    } catch (err) {
      pdfCanceled = err instanceof ConvertCanceledError;
    }
    assert(pdfCanceled, "PDF 取消:未抛 ConvertCanceledError");
    const pdfTarget = path.join(dir, "cancel-pdf.pdf");
    const pdfTargetExists = await fs.access(pdfTarget).then(() => true, () => false);
    assert(!pdfTargetExists, "PDF 取消:取消后仍产出文件");
    console.log("[ok] converter:pdf 预取消(ConvertCanceledError 且不产出文件)");

    // ---- 7. merge 取消复位:取消后再次合并必须成功(未传 ctx → 新建 context,取消标志不复用) ----
    const mergeCancelCtx = createConvertContext();
    let mergeCanceled = false;
    try {
      await mergeConvertImpl([mergeA, mergeB], "docx", () => mergeCancelCtx.cancel(), mergeCancelCtx);
    } catch (err) {
      mergeCanceled = err instanceof ConvertCanceledError;
    }
    assert(mergeCanceled, "merge 取消:未抛 ConvertCanceledError");
    const mergeRetry = await mergeConvertImpl([mergeA, mergeB], "docx");
    assert(mergeRetry.ok, `merge 复位断言失败: ${mergeRetry.error}`);
    console.log("[ok] converter:merge 取消复位(取消后再次合并成功)");

    // ---- 8. 设置注入端到端:持久化往返 + landscape + breakBeforeH1 + 分页符(docx) ----
    await updateSettings({ breakBeforeH1: true });
    assert(loadSettings().breakBeforeH1 === true, "设置持久化失败: breakBeforeH1 未生效");
    await updateSettings({ pageSetup: { ...restoreSettings.orig.pageSetup, orientation: "landscape" } });
    const landResult = await convertImpl(sampleMd, "docx");
    const landZip = await JSZip.loadAsync(await fs.readFile(landResult.outputPath));
    const landEntry = landZip.file("word/document.xml");
    assert(!!landEntry, "docx 缺少 document.xml");
    const landXml = await landEntry.async("string");
    assert(landXml.includes('w:orient="landscape"'), "页面设置 landscape 未生效");
    // breakBeforeH1 产物效果:设置开启 → document.xml 断言 H1 前分页
    const h1Result = await convertImpl(sampleMd, "docx");
    const h1Xml = await (await JSZip.loadAsync(await fs.readFile(h1Result.outputPath)))
      .file("word/document.xml").async("string");
    assert(h1Xml.includes("<w:pageBreakBefore/>"), "breakBeforeH1:document.xml 缺少 <w:pageBreakBefore/>");
    // 分页符:关闭 toc,保证 w:br w:type="page" 仅来自显式 <!-- page-break -->
    // (目录页自带分页符会污染计数)
    await updateSettings({ toc: false });
    const pbResult = await convertImpl(sampleMd, "docx");
    const pbXml = await (await JSZip.loadAsync(await fs.readFile(pbResult.outputPath)))
      .file("word/document.xml").async("string");
    assert(pbXml.includes('<w:br w:type="page"/>'), '分页符:document.xml 缺少 <w:br w:type="page"/>');
    console.log("[ok] converter:设置注入(持久化/landscape/breakBeforeH1/分页符 docx)");
  } finally {
    // 恢复设置文件 + 模块级缓存(updateSettings 双写);原本无文件则删除,不污染用户设置
    await restoreSettings.restore();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
