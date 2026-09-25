/**
 * IPC 注册体段(src/main/ipc/register.ts:此前仅 smoke 兜底):
 * 可脱离真实窗口/对话框直测的 handler 逻辑(经 dist/main/ipc/register.js):
 * - 注册面:临时包装 ipcMain.handle 捕获注册表(仍走原 handle 真实注册),断言
 *   全部预期 channel 均有 handler(防漏注册);
 * - 入参类型守卫:convertSingle/convertBatch/convertMerge 非法入参 →
 *   { ok:false, error }(守卫先于 runWithCtx,无需真实 BrowserWindow/event.sender);
 * - shell 白名单:未登记路径 revealInFolder/openPath → { ok:false, error }
 *   (测试进程白名单为空,拒绝路径不触达 shell,无用户可见副作用);
 * - 纯转发 handler 直调:fileCollectMarkdown(目录递归收集/skipped)、
 *   fileFilterExisting(保序剔除缺失)、settingsGet/settingsSet、uiStateGet/uiStateSet、
 *   appVersion(与 app.getVersion 同源)、previewOpen 非法入参、previewRefresh 空操作、
 *   convertCancel 无 ctx 时空操作。
 * 不在自动断言面:对话框系(fileOpenDialog/dirSelect/presetsImport/presetsExport/
 * cssImport,依赖真实 dialog)、合法转换链路(convertImpl 全流程,converter.test.js 已覆盖)。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { app, ipcMain } from "electron";
import { registerIpc } from "../../dist/main/ipc/register.js";
import { IPC_CHANNELS as CH } from "../../dist/main/ipc/channels.js";
import { beginWebContentsOperation, finishWebContentsOperation } from "../../dist/main/windows/web-contents-registry.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`ipc-register 断言失败:${msg}`);
}

/** 假 IpcMainInvokeEvent(runWithCtx 仅读 sender.id;守卫路径不触达 BrowserWindow) */
const fakeEvent = { sender: { id: -999999 } };

export async function run() {
  // ---- 0. 注册并捕获 handler 表(临时包装 handle,注册后还原) ----
  const handlers = new Map();
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) => {
    handlers.set(channel, fn);
    return originalHandle(channel, fn);
  };
  try {
    registerIpc();
  } finally {
    ipcMain.handle = originalHandle;
  }

  // ---- 1. 注册面:全部预期 channel 均有 handler(防漏注册) ----
  const expected = [
    CH.fileOpenDialog, CH.fileCollectMarkdown, CH.fileFilterExisting, CH.dirSelect,
    CH.convertSingle, CH.convertBatch, CH.convertMerge, CH.convertCancel, CH.convertPrecheck,
    CH.readFrontmatter,
    CH.presetsImport, CH.presetsExport, CH.cssImport,
    CH.settingsGet, CH.settingsSet, CH.uiStateGet, CH.uiStateSet,
    CH.appVersion, CH.shellRevealInFolder, CH.shellOpenPath,
    CH.previewOpen, CH.previewRefresh,
  ];
  for (const ch of expected) {
    assert(handlers.has(ch), `channel ${ch} 应已注册 handler`);
  }
  console.log(`[ok] ipc-register:${expected.length} 个预期 channel 全部注册 断言通过`);

  // ---- 2. 入参类型守卫:非法入参 → { ok:false, error },不触达转换链路 ----
  const badSingle = await handlers.get(CH.convertSingle)(fakeEvent, 42, "docx");
  assert(badSingle.ok === false && typeof badSingle.error === "string" && badSingle.error.length > 0,
    "convertSingle 非字符串路径应返回 { ok:false, error }");
  const badFormat = await handlers.get(CH.convertSingle)(fakeEvent, "C:/a.md", "html");
  assert(badFormat.ok === false, "convertSingle 枚举外 format 应返回 { ok:false, error }");
  const badBatch = await handlers.get(CH.convertBatch)(fakeEvent, "not-array", "pdf");
  assert(badBatch.ok === false, "convertBatch 非数组 files 应返回 { ok:false, error }");
  const badMerge = await handlers.get(CH.convertMerge)(fakeEvent, ["a.md", 42], "docx");
  assert(badMerge.ok === false, "convertMerge 混入非字符串元素应返回 { ok:false, error }");
  console.log("[ok] ipc-register:convertSingle/Batch/Merge 入参类型守卫(B1)断言通过");

  // ---- 3. shell 白名单:未登记路径拒绝且不触达 shell(测试进程白名单为空) ----
  const reveal = handlers.get(CH.shellRevealInFolder)(fakeEvent, "C:\\definitely\\not\\allowed.docx");
  assert(reveal.ok === false && typeof reveal.error === "string", "revealInFolder 白名单外路径应拒绝");
  const revealBad = handlers.get(CH.shellRevealInFolder)(fakeEvent, 42);
  assert(revealBad.ok === false, "revealInFolder 非字符串入参应拒绝");
  const openBad = await handlers.get(CH.shellOpenPath)(fakeEvent, "C:\\definitely\\not\\allowed.docx");
  assert(openBad.ok === false && typeof openBad.error === "string", "openPath 白名单外路径应拒绝");
  const openNonStr = await handlers.get(CH.shellOpenPath)(fakeEvent, null);
  assert(openNonStr.ok === false, "openPath 非字符串入参应拒绝");
  console.log("[ok] ipc-register:MR-12 shell 白名单拒绝(未登记/非字符串)断言通过");

  // ---- 3.1 同一 webContents 的转换/预检共享 single-flight:第二次明确 busy ----
  const busyCtx = { cancel() {} };
  const busyToken = beginWebContentsOperation(fakeEvent.sender.id, "single", busyCtx);
  assert(busyToken !== null, "测试应先占用 sender operation");
  try {
    const busyConvert = await handlers.get(CH.convertSingle)(fakeEvent, "C:/a.md", "docx");
    assert(busyConvert.ok === false && busyConvert.busy === true && typeof busyConvert.error === "string",
      "活动转换期间第二次 convertSingle 应返回 { ok:false, busy:true, error }");
    const busyPrecheck = await handlers.get(CH.convertPrecheck)(fakeEvent, "C:/a.md");
    assert(busyPrecheck.ok === false && busyPrecheck.busy === true,
      "活动转换期间 convertPrecheck 应返回明确 busy");
    const busyBatch = await handlers.get(CH.convertBatch)(fakeEvent, ["a.md", "b.md"], "docx");
    assert(
      busyBatch.ok === false && busyBatch.busy === true &&
      Array.isArray(busyBatch.items) && busyBatch.okCount === 0 &&
      busyBatch.failCount === 0 && busyBatch.canceledCount === 0,
      "活动转换期间 convertBatch 应返回兼容旧 renderer 计数字段的 busy",
    );
  } finally {
    finishWebContentsOperation(fakeEvent.sender.id, busyToken);
  }
  console.log("[ok] ipc-register:同 webContents convert/precheck single-flight busy 断言通过");

  // ---- 4. fileCollectMarkdown:目录递归收集 md / 非 md 进 skipped / 缺失传入路径进 skipped ----
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "m2w-ipcreg-"));
  try {
    await fs.mkdir(path.join(tmpDir, "sub"));
    await fs.writeFile(path.join(tmpDir, "a.md"), "# a", "utf8");
    await fs.writeFile(path.join(tmpDir, "b.txt"), "skip me", "utf8");
    await fs.writeFile(path.join(tmpDir, "sub", "c.markdown"), "# c", "utf8");
    await fs.mkdir(path.join(tmpDir, ".hidden"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".hidden", "d.md"), "# d", "utf8"); // 点开头目录跳过

    const collected = await handlers.get(CH.fileCollectMarkdown)(fakeEvent, [
      tmpDir,
      path.join(tmpDir, "missing.md"),
    ]);
    assert(collected.files.length === 2, `目录递归应收 2 个 md(a/c),实际 ${JSON.stringify(collected.files)}`);
    assert(
      collected.files.some((f) => f.endsWith("a.md")) && collected.files.some((f) => f.endsWith("c.markdown")),
      "递归结果应含 a.md 与 sub/c.markdown",
    );
    assert(
      collected.skipped.length === 1 && collected.skipped[0].endsWith("missing.md"),
      `缺失的传入路径应进 skipped,实际 ${JSON.stringify(collected.skipped)}`,
    );

    const empty = await handlers.get(CH.fileCollectMarkdown)(fakeEvent, [42]);
    assert(empty.files.length === 0 && empty.skipped.length === 0, "非数组入参应按空输入处理(零收集)");
    console.log("[ok] ipc-register:fileCollectMarkdown 递归收集/skipped/点目录跳过/类型守卫 断言通过");

    // ---- 5. fileFilterExisting:保序过滤仍存在的路径 ----
    const existing = path.join(tmpDir, "a.md");
    const filtered = await handlers.get(CH.fileFilterExisting)(fakeEvent, [existing, path.join(tmpDir, "gone.md"), existing]);
    assert(
      filtered.length === 2 && filtered[0] === existing && filtered[1] === existing,
      "filterExisting 应保序保留存在路径、剔除缺失",
    );
    console.log("[ok] ipc-register:fileFilterExisting 保序剔除缺失 断言通过");

    // ---- 5b. readFrontmatter 走统一准备链:UTF-8/GBK/UTF-16 与 frontmatter 双链 ----
    const frontmatter = "---\r\ntitle: [[你好世界]]\r\nauthor: 作者\r\n---\r\n\r\n[[正文]]\r\n";
    const frontmatterPath = path.join(tmpDir, "frontmatter.md");
    await fs.writeFile(frontmatterPath, frontmatter, "utf8");
    const gbkFrontmatterPath = path.join(tmpDir, "frontmatter-gbk.md");
    await fs.writeFile(gbkFrontmatterPath, iconv.encode(frontmatter, "gbk"));
    const utf16LeFrontmatterPath = path.join(tmpDir, "frontmatter-utf16le.md");
    await fs.writeFile(
      utf16LeFrontmatterPath,
      Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(frontmatter, "utf-16le")]),
    );
    const utf16BeFrontmatterPath = path.join(tmpDir, "frontmatter-utf16be.md");
    await fs.writeFile(
      utf16BeFrontmatterPath,
      Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(frontmatter, "utf-16be")]),
    );
    for (const filePath of [frontmatterPath, gbkFrontmatterPath, utf16LeFrontmatterPath, utf16BeFrontmatterPath]) {
      const metadata = await handlers.get(CH.readFrontmatter)(fakeEvent, filePath);
      assert(
        metadata.title === "[[你好世界]]" && metadata.author === "作者",
        `readFrontmatter 编码/双链解析失败:${filePath}`,
      );
    }

    // ---- 5c. precheck 缺文件/读取失败仍返回空数组,不扩大 PrecheckResult ----
    const missingPrecheck = await handlers.get(CH.convertPrecheck)(fakeEvent, path.join(tmpDir, "missing.md"));
    const directoryPrecheck = await handlers.get(CH.convertPrecheck)(fakeEvent, tmpDir);
    assert(
      Array.isArray(missingPrecheck) && missingPrecheck.length === 0 &&
        Array.isArray(directoryPrecheck) && directoryPrecheck.length === 0,
      "precheck 缺文件/读取失败应保持空 warning 数组契约",
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  // ---- 6. settings/ui-state/appVersion 转发直调 ----
  const settings = handlers.get(CH.settingsGet)();
  assert(settings.version === 1 && typeof settings.format === "string" && typeof settings.pageSetup === "object",
    "settings:get 应返回完整 AppSettings 形状");
  const updated = await handlers.get(CH.settingsSet)(undefined, { format: "pdf" });
  assert(updated.format === "pdf", "settings:set 合法 patch 应生效");
  const reread = handlers.get(CH.settingsGet)();
  assert(reread.format === "pdf", "settings:set 后 get 应读到新值(缓存一致)");

  const uiState = await handlers.get(CH.uiStateSet)(undefined, { lastOpenDir: tmpMarkerDir() });
  assert(uiState.lastOpenDir === tmpMarkerDir(), "ui-state:set patch 应生效");
  assert(handlers.get(CH.uiStateGet)().lastOpenDir === tmpMarkerDir(), "ui-state:get 应读到刚写入的值");

  assert(handlers.get(CH.appVersion)() === app.getVersion(), "app:version 应与 app.getVersion 同源");
  console.log("[ok] ipc-register:settings/ui-state 读写转发 + appVersion 同源 断言通过");

  // ---- 7. 无副作用兜底:previewOpen 非法入参 / previewRefresh 空操作 / convertCancel 无 ctx ----
  const badPreview = await handlers.get(CH.previewOpen)(fakeEvent, 42);
  assert(badPreview.ok === false && typeof badPreview.error === "string", "preview:open 非字符串路径应拒绝");
  assert(handlers.get(CH.previewRefresh)() === undefined, "preview:refresh 无预览窗口时应为空操作");
  assert(handlers.get(CH.convertCancel)(fakeEvent) === undefined, "convert:cancel 无注册 ctx 时应为空操作");
  console.log("[ok] ipc-register:previewOpen 守卫/previewRefresh 空操作/convertCancel 无 ctx 兜底 断言通过");
}

/** ui-state 写入用标记目录(仅作字符串值存储,无须真实存在) */
function tmpMarkerDir() {
  return path.join(os.tmpdir(), `m2w-ipcreg-marker-${process.pid}`);
}
