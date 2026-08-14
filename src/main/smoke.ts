/**
 * 冒烟自测(--smoke 模式,index.ts 一行调用):只保留必须依赖 Electron 的端到端断言。
 * - convertImpl docx 全链路落盘(基础链路 + 产物存在,端到端性质)
 * - pdf 链路:printToPDF 产物魔数 + 书签注入(Outlines 中文标题 + Dest 页面引用)+ 合并书签
 * - renderer 诊断(executeJavaScript:window.api 注入/按钮可点/状态区反馈/弹窗隐藏)
 * 纯逻辑断言(重名保护/批量汇总/merge docx/取消链路/设置注入/分页符产物)已迁
 * test/segments|main(分页符 pdf 中间 html 在 page-setup 段),本文件不再触碰设置与取消。
 * 输出隔离:smoke 不依赖用户持久化设置——outputDir 强制 ""(产物落 output/smoke 源文件旁,
 * 自清理可覆盖;否则会污染用户设置的输出目录如 Downloads,且 (N) 序号变体越积越多)、
 * afterConvert 强制 "none"(不自动打开产物弹窗);结束前恢复原设置(与 converter.test.js 同款
 * save/restore,崩溃残留风险一致)。
 * 失败:抛错由 index.ts 统一 catch → app.exit(1);renderer diag 失败打印专属消息后重抛。
 */
import { app, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";
import { convertImpl, mergeConvertImpl } from "./converter.js";
import { getKatexDir } from "./katex-dir.js";
import { loadSettings, updateSettings } from "./settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_DIR = path.join(__dirname, "..", "..", "output", "smoke");

/** 断言 PDF 大纲:首条目 Title(中文)与 Dest[0] 页面 PDFRef(单文件/合并书签共用) */
async function assertOutline(filePath: string, expectedTitle: string, label: string): Promise<void> {
  const doc = await PDFDocument.load(await fs.readFile(filePath));
  const outlinesRef = doc.catalog.get(PDFName.of("Outlines"));
  if (!outlinesRef) throw new Error(`${label} 缺少 Outlines 大纲`);
  const outlinesDict = doc.context.lookup(outlinesRef, PDFDict);
  if (!outlinesDict) throw new Error(`${label} Outlines 字典解析失败`);
  const firstRef = outlinesDict.get(PDFName.of("First"));
  if (!firstRef) throw new Error(`${label} 大纲缺少 First 条目`);
  const firstDict = doc.context.lookup(firstRef, PDFDict);
  const title = firstDict?.get(PDFName.of("Title"));
  if (!(title instanceof PDFHexString) || title.decodeText() !== expectedTitle) {
    throw new Error(`${label} 书签标题异常: ${title?.toString()}`);
  }
  // 回归:书签 Dest[0] 必须是页面 PDFRef(曾全部回退首页致点击不跳转,见批次 4 修复)
  const destArr = firstDict?.get(PDFName.of("Dest"));
  if (!(destArr instanceof PDFArray) || !(destArr.asArray()[0] instanceof PDFRef)) {
    throw new Error(`${label} 书签 Dest 异常: ${destArr?.toString()}`);
  }
}

/** 运行冒烟断言;任何失败抛错,由 index.ts 捕获后 app.exit(1) */
export async function runSmoke(win: BrowserWindow): Promise<void> {
  const outDir = SMOKE_DIR;
  const sampleMd = path.join(outDir, "smoke-basic.md");
  await fs.mkdir(outDir, { recursive: true });
  // 批次 7 起重名保护:同名产物不再覆盖 → smoke 自清理本次会生成的产物(含 (2) 序号变体),
  // 保证断言确定性;output/ 下的验收样例等其他文件不受影响。
  // Windows 下被阅读器占用的文件删除会 EBUSY,容错跳过(残留由重名序号机制规避)。
  for (const name of await fs.readdir(outDir)) {
    const base = name.replace(/\.(md|docx|pdf|png)$/i, "").replace(/\s\(\d+\)$/, "");
    if (base.startsWith("smoke-")) {
      try {
        await fs.rm(path.join(outDir, name), { force: true });
      } catch {
        // 被外部程序占用:跳过,不阻塞 smoke
      }
    }
  }
  // 输出隔离:强制 outputDir "" + afterConvert "none"(见文件头注释),结束前恢复原设置
  const orig = loadSettings();
  await updateSettings({ outputDir: "", afterConvert: "none" });
  try {
    await fs.writeFile(
      sampleMd,
      "# 冒烟测试 中文标题\n\n<!-- page-break -->\n\n| 列A | 列B |\n| --- | --- |\n| 你好 | world |\n\n- 项目一\n- 项目二\n",
    );
    const { outputPath } = await convertImpl(sampleMd, "docx");
    const stat = await fs.stat(outputPath);
    console.log(`[smoke] convert ok: ${outputPath} (${stat.size} bytes)`);
    // PDF 链路:中文/表格/代码块/任务列表/本地图片 → printToPDF
    // P0 排查结论:1px 图人工不可辨认(且 printToPDF 极小图易被忽略),样例换 100x80 红底白点图
    const pngPath = path.join(outDir, "smoke-pdf.png");
    await fs.writeFile(
      pngPath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAGQAAABQCAIAAABga0e4AAAA0UlEQVR4nO3ZwQ2DQAxEUSqh/6LohdxzAZLFY0tv9Auw3nF328zMhu7Yd30FCxaseLBgwYoHCxaseLBgwYoHCxaseLBgwYoHCxaseB2xzqvBusWUJWuE9Ugq4tUC6wemCFke60+pSi9Yc7CWSJV5JbEWStV4wZqAtVyqwAsWLFiwYMGCBQsWLFiwQl5vHwxrCJb3rIxXzamwRmH53SkiK76wEZYf6VfIUod1xGobLFiw4sGCBSseLFiw4sGCBSseLFiw4sGCBSseLFjFWGZmzfcBLmd3baCxCRQAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const pdfSampleMd = path.join(outDir, "smoke-pdf.md");
    await fs.writeFile(
      pdfSampleMd,
      [
        "# PDF 冒烟 中文标题",
        "",
        "| 列A | 列B |",
        "| --- | --- |",
        "| 你好 | world |",
        "",
        "<!-- page-break -->",
        "",
        "```ts",
        "const x: number = 1;",
        "```",
        "",
        "- [x] 已完成项",
        "- [ ] 待办项",
        "",
        "~~删除线~~ 与 `行内代码`",
        "",
        "![本地图片](smoke-pdf.png)",
        "",
      ].join("\n"),
    );
    const pdfResult = await convertImpl(pdfSampleMd, "pdf", undefined, undefined, getKatexDir());
    const pdfStat = await fs.stat(pdfResult.outputPath);
    const pdfHead = (await fs.readFile(pdfResult.outputPath)).subarray(0, 5).toString("latin1");
    if (pdfHead !== "%PDF-") throw new Error(`PDF 魔数校验失败: ${pdfHead}`);
    console.log(`[smoke] pdf convert ok: ${pdfResult.outputPath} (${pdfStat.size} bytes)`);
    // 批次 4:书签注入断言(读回 /Outlines,标题中文正确;覆盖用户实测「侧边栏书签为空」问题)
    await assertOutline(pdfResult.outputPath, "PDF 冒烟 中文标题", "PDF");
    console.log(`[smoke] pdf 书签 ok: Outlines 注入,中文标题 + Dest 页面引用正确`);
    // 批次 4:合并 PDF 书签断言(用户实测「合并 PDF 侧边栏书签为空」的直接回归场景)
    const mergeA = path.join(outDir, "smoke-merge-1.md");
    const mergeB = path.join(outDir, "smoke-merge-2.md");
    await fs.writeFile(mergeA, `---\ntitle: 合并首文件\n---\n\n# 合并第一章\n\n![图](smoke-pdf.png)\n`);
    await fs.writeFile(mergeB, `---\ntitle: 合并第二文件\n---\n\n# 合并第二章\n\n正文\n`);
    const mergePdfResult = await mergeConvertImpl([mergeA, mergeB], "pdf", undefined, undefined, getKatexDir());
    // 重名序号变体兼容:输出目录可配置后产物可能为「smoke-merge-1-合并 (2).pdf」,
    // 断言剥离 (N) 序号后缀后须以 -合并.pdf 结尾(与 batch 断言同源修复)
    const mergePdfBase = mergePdfResult.outputPath?.replace(/\s\(\d+\)(?=\.pdf$)/, "");
    if (!mergePdfResult.ok || !mergePdfResult.outputPath || !mergePdfBase?.endsWith("-合并.pdf")) {
      throw new Error(`合并 PDF 输出异常: ${mergePdfResult.error ?? mergePdfResult.outputPath}`);
    }
    await assertOutline(mergePdfResult.outputPath, "合并第一章", "合并 PDF");
    console.log(`[smoke] merge pdf 书签 ok: 合并产物 Outlines 注入,中文标题 + Dest 页面引用正确`);
    // renderer 侧诊断:window.api 是否注入、转换按钮是否可点、点击后状态区反馈
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500)); // 等页面加载
      const diag = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const report = { api: typeof window.api };
        const btn = document.getElementById("convertBtn");
        report.btnExists = !!btn;
        if (btn) {
          report.btnDisabledBefore = btn.disabled;
          // disabled 按钮的 .click() 不触发监听 → 先解除禁用再点击,
          // 断言「未选文件」守卫路径(曾因恒空而零覆盖,见 R8 收尾 A3)
          btn.disabled = false;
          btn.click();
          await sleep(50);
          const status = document.getElementById("status");
          report.statusAfterClick = status ? status.textContent : "";
          report.statusIsError = status ? status.classList.contains("status--error") : null;
        }
        // 防回归:完成弹窗启动时必须隐藏(曾因 CSS 特异性覆盖而失效)
        const dlg = document.getElementById("completeDialog");
        report.dialogExists = !!dlg;
        report.dialogHiddenAtStart = dlg ? dlg.classList.contains("hidden") : null;
        report.dialogVisibleAtStart = dlg ? getComputedStyle(dlg).display !== "none" : null;
        // 迭代 4 预览入口迁移:单文件态「预览」按钮存在且初始禁用(未选文件);
        // 完成弹窗内「预览」按钮必须已移除
        const previewBtn = document.getElementById("previewBtn");
        report.previewBtnExists = !!previewBtn;
        report.previewBtnDisabledAtStart = previewBtn ? previewBtn.disabled : null;
        report.dialogPreviewRemoved = !document.getElementById("completeDialogPreview");
        // 批次 11 迭代 2:完成弹窗「不再提示」/ 批量弹窗「重试失败项 / 复制全部路径」存在性
        report.suppressInputExists = !!document.getElementById("completeDialogSuppress");
        report.completeDialogPromptExists = !!document.getElementById("completeDialogPrompt");
        report.retryBtnExists = !!document.getElementById("batchDialogRetry");
        report.copyAllBtnExists = !!document.getElementById("batchDialogCopyAll");
        return report;
      })()`);
      console.log(`[smoke] renderer diag: ${JSON.stringify(diag)}`);
      // 守卫断言:无文件时点击转换按钮 → 状态区错误文案 + 红字(迭代 3 交互语义)
      if (diag.statusAfterClick !== "请先选择 Markdown 文件" || diag.statusIsError !== true) {
        throw new Error(
          `[smoke] renderer diag FAILED: 点击守卫断言 statusAfterClick=${JSON.stringify(diag.statusAfterClick)}, statusIsError=${diag.statusIsError}`,
        );
      }
      // 批次 11 迭代 2:新增控件存在性守卫(缺失即回归)
      if (
        !diag.suppressInputExists ||
        !diag.completeDialogPromptExists ||
        !diag.retryBtnExists ||
        !diag.copyAllBtnExists
      ) {
        throw new Error(
          `[smoke] renderer diag FAILED: 批次 11 迭代 2 控件缺失 ${JSON.stringify({
            suppressInputExists: diag.suppressInputExists,
            completeDialogPromptExists: diag.completeDialogPromptExists,
            retryBtnExists: diag.retryBtnExists,
            copyAllBtnExists: diag.copyAllBtnExists,
          })}`,
        );
      }
    } catch (err) {
      console.error("[smoke] renderer diag FAILED:", err);
      throw err; // 由 index.ts 统一 catch → app.exit(1)
    }
  } finally {
    // 恢复用户设置(文件 + 模块级缓存);崩溃时残留风险与 converter.test.js 一致
    await updateSettings(orig);
  }
}
