/**
 * 冒烟自测(--smoke 模式,index.ts 一行调用):只保留必须依赖 Electron 的端到端断言。
 * - convertImpl docx 全链路落盘(基础链路 + 产物存在,端到端性质)
 * - pdf 链路:printToPDF 产物魔数 + 书签注入(Outlines 中文标题 + Dest 页面引用)+ 合并书签
 * - pdf 中间 html 分页符(core convert 直接断言,非 converter 层逻辑)
 * - renderer 诊断(executeJavaScript:window.api 注入/按钮可点/状态区反馈/弹窗隐藏)
 * 纯逻辑断言(重名保护/批量汇总/merge docx/取消链路/设置注入)已迁 test/segments/converter.test.js,
 * 本文件不再触碰设置与取消。
 * 失败:抛错由 index.ts 统一 catch → app.exit(1);renderer diag 失败打印专属消息后重抛。
 */
import { app, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";
import { convert } from "../core/convert.js";
import { convertImpl, getImageResolver, mergeConvertImpl } from "./converter.js";
import { loadSettings } from "./settings.js";

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
  const sampleMd = path.join(outDir, "g3-smoke.md");
  await fs.mkdir(outDir, { recursive: true });
  // 批次 7 起重名保护:同名产物不再覆盖 → smoke 自清理本次会生成的产物(含 (2) 序号变体),
  // 保证断言确定性;output/ 下的验收样例等其他文件不受影响。
  // Windows 下被阅读器占用的文件删除会 EBUSY,容错跳过(残留由重名序号机制规避)。
  const smokePrefixes = ["g3-smoke", "g4-smoke", "cancel-", "batch-", "merge-a", "merge-b"];
  for (const name of await fs.readdir(outDir)) {
    const base = name.replace(/\.(md|docx|pdf|png)$/i, "").replace(/\s\(\d+\)$/, "");
    if (smokePrefixes.some((p) => base.startsWith(p))) {
      try {
        await fs.rm(path.join(outDir, name), { force: true });
      } catch {
        // 被外部程序占用:跳过,不阻塞 smoke
      }
    }
  }
  await fs.writeFile(
    sampleMd,
    "# 冒烟测试 中文标题\n\n<!-- page-break -->\n\n| 列A | 列B |\n| --- | --- |\n| 你好 | world |\n\n- 项目一\n- 项目二\n",
  );
  const { outputPath } = await convertImpl(sampleMd, "docx");
  const stat = await fs.stat(outputPath);
  console.log(`[smoke] convert ok: ${outputPath} (${stat.size} bytes)`);
  // 分页符产物:pdf 侧中间 html 可截获(convert 返回 artifact.html,与 renderPdf 写临时文件同源)
  // → 断言 page-break div(样例含 <!-- page-break -->;docx 侧断言已迁 converter.test.js)。
  {
    const pbSettings = loadSettings();
    // convert() 第一参数是 markdown 内容字符串(不读文件),须先读盘再传入
    const pbSource = await fs.readFile(sampleMd, "utf8");
    const pbArtifact = await convert(pbSource, "pdf", {
      baseDir: path.dirname(sampleMd),
      title: path.basename(sampleMd).replace(/\.(md|markdown)$/i, ""),
      warnings: [],
      pageSetup: pbSettings.pageSetup,
      typography: pbSettings.typography,
      breakBeforeH1: pbSettings.breakBeforeH1,
      toc: pbSettings.toc,
      imageResolver: getImageResolver(path.dirname(sampleMd)),
      katexDir: path.join(app.getAppPath(), "node_modules", "katex", "dist"),
    });
    if (pbArtifact.kind !== "pdf" || !pbArtifact.html.includes('<div class="page-break"></div>')) {
      throw new Error("分页符断言失败:pdf 中间 html 缺少 page-break div");
    }
    console.log("[smoke] 分页符 ok: pdf 中间 html 含 page-break div");
  }
  // G4:pdf 链路(中文/表格/代码块/任务列表/本地图片 → printToPDF)
  const pngPath = path.join(outDir, "g4-smoke.png");
  await fs.writeFile(
    pngPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const pdfSampleMd = path.join(outDir, "g4-smoke.md");
  await fs.writeFile(
    pdfSampleMd,
    [
      "# G4 PDF 冒烟 中文标题",
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
      "![本地图片](g4-smoke.png)",
      "",
    ].join("\n"),
  );
  const pdfResult = await convertImpl(pdfSampleMd, "pdf");
  const pdfStat = await fs.stat(pdfResult.outputPath);
  const pdfHead = (await fs.readFile(pdfResult.outputPath)).subarray(0, 5).toString("latin1");
  if (pdfHead !== "%PDF-") throw new Error(`PDF 魔数校验失败: ${pdfHead}`);
  console.log(`[smoke] pdf convert ok: ${pdfResult.outputPath} (${pdfStat.size} bytes)`);
  // 批次 4:书签注入断言(读回 /Outlines,标题中文正确;覆盖用户实测「侧边栏书签为空」问题)
  await assertOutline(pdfResult.outputPath, "G4 PDF 冒烟 中文标题", "PDF");
  console.log(`[smoke] pdf 书签 ok: Outlines 注入,中文标题 + Dest 页面引用正确`);
  // 批次 4:合并 PDF 书签断言(用户实测「合并 PDF 侧边栏书签为空」的直接回归场景)
  const mergeA = path.join(outDir, "merge-a.md");
  const mergeB = path.join(outDir, "merge-b.md");
  await fs.writeFile(mergeA, `---\ntitle: 合并首文件\n---\n\n# 合并第一章\n\n![图](g4-smoke.png)\n`);
  await fs.writeFile(mergeB, `---\ntitle: 合并第二文件\n---\n\n# 合并第二章\n\n正文\n`);
  const mergePdfResult = await mergeConvertImpl([mergeA, mergeB], "pdf");
  // 重名序号变体兼容:输出目录可配置后产物可能为「merge-a-合并 (2).pdf」,
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
      return report;
    })()`);
    console.log(`[smoke] renderer diag: ${JSON.stringify(diag)}`);
  } catch (err) {
    console.error("[smoke] renderer diag FAILED:", err);
    throw err; // 由 index.ts 统一 catch → app.exit(1)
  }
}
