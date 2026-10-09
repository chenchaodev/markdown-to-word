// @ts-check
/**
 * IPC 注册体段(src/main/ipc/register.ts:此前仅 smoke 兜底):
 * 可脱离真实窗口/对话框直测的 handler 逻辑(经 dist/main/ipc/register.js):
 * - 注册面:临时包装 ipcMain.handle 捕获注册表(仍走原 handle 真实注册),断言
 *   全部预期 channel 均有 handler(防漏注册);
 * - 入参类型守卫:convertSingle/convertBatch/convertMerge 非法入参 →
 *   { ok:false, error }(守卫先于 runWithCtx,无需真实 BrowserWindow/event.sender);
 * - 注册表被外部占用时的 busy 形状(手工预占,只验形状;真实并发调用 handler
 *   见 operation-single-flight.test.js);
 * - shell 白名单:未登记路径 revealInFolder/openPath → { ok:false, error }
 *   (测试进程白名单为空,拒绝路径不触达 shell,无用户可见副作用);
 * - 纯转发 handler 直调:fileCollectMarkdown(目录递归收集/skipped/扫描预算警告回传)、
 *   fileFilterExisting(保序剔除缺失)、settingsGet/settingsSet、uiStateGet/uiStateSet、
 *   appVersion(与 app.getVersion 同源)、previewOpen 非法入参、previewRefresh 空操作、
 *   convertCancel 无 ctx 时空操作;
 * - settings:set 的 main 侧运行时副作用(真实触点端到端:语言变更后 main 文案经 t()
 *   即时切换、应用菜单即时重建;副作用判定本身见 settings-runtime-sync 段)。
 * 不在自动断言面:对话框系(fileOpenDialog/dirSelect/presetsImport/presetsExport/
 * cssImport,依赖真实 dialog)、合法转换链路(convertImpl 全流程,converter.test.js 已覆盖)。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { app, ipcMain, Menu } from "electron";
import { registerIpc } from "../../dist/main/ipc/register.js";
import { IPC_CHANNELS as CH } from "../../dist/main/ipc/channels.js";
import { MAX_SCAN_DEPTH } from "../../dist/convert/paths.js";
import { formatWarning, t } from "../../dist/core/i18n/index.js";
import { beginWebContentsOperation, finishWebContentsOperation } from "../../dist/main/windows/web-contents-registry.js";
import { removeTree } from "../harness/temp-resource.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

const { assert: harnessAssert } = createAsserter("ipc-register");

/**
 * 窄化壳:harness 的 assert 刻意不声明 `asserts cond`(TS2775 禁从解构模式调断言函数),
 * 而本段下游代码依赖收窄 ⇒ 这里保留一层带窄化签名的壳,函数体只委派、不自带判定逻辑。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  harnessAssert(cond, msg);
}

/** 假 IpcMainInvokeEvent(runWithCtx 仅读 sender.id;守卫路径不触达 BrowserWindow) */
const fakeEvent = { sender: { id: -999999 } };

/**
 * 假转换上下文:装配层 ConversionHandle 的真形状(cancelRequested 只读标志 +
 * cancel() 置位 + signal),供本段手工预占 webContents 注册表。
 * @returns {import("../../dist/main/converter/index.js").ConversionHandle} 假转换上下文
 */
function fakeConvertCtx() {
  const controller = new AbortController();
  return {
    cancelRequested: false,
    cancel() {
      this.cancelRequested = true;
      controller.abort();
    },
    signal: controller.signal,
  };
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
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
  // 逐 channel 一个 case:channel 名就是「漏注册的是哪一个」的定位键
  for (const ch of expected) {
    await suite.case(`channel ${ch} 应已注册 handler`, () => {
      assert(handlers.has(ch), `channel ${ch} 应已注册 handler`);
    });
  }
  console.log(`[ok] ipc-register:${expected.length} 个预期 channel 全部注册 断言通过`);

  // ---- 2. 入参类型守卫:非法入参 → { ok:false, error },不触达转换链路 ----
  const badSingle = await handlers.get(CH.convertSingle)(fakeEvent, 42, "docx");
  await suite.case("convertSingle 非字符串路径应返回 { ok:false, error }", () => {
    assert(badSingle.ok === false && typeof badSingle.error === "string" && badSingle.error.length > 0,
      "convertSingle 非字符串路径应返回 { ok:false, error }");
  });
  const badFormat = await handlers.get(CH.convertSingle)(fakeEvent, "C:/a.md", "html");
  await suite.case("convertSingle 枚举外 format 应返回 { ok:false, error }", () => {
    assert(badFormat.ok === false, "convertSingle 枚举外 format 应返回 { ok:false, error }");
  });
  const badBatch = await handlers.get(CH.convertBatch)(fakeEvent, "not-array", "pdf");
  await suite.case("convertBatch 非数组 files 应返回 { ok:false, error }", () => {
    assert(badBatch.ok === false, "convertBatch 非数组 files 应返回 { ok:false, error }");
  });
  const badMerge = await handlers.get(CH.convertMerge)(fakeEvent, ["a.md", 42], "docx");
  await suite.case("convertMerge 混入非字符串元素应返回 { ok:false, error }", () => {
    assert(badMerge.ok === false, "convertMerge 混入非字符串元素应返回 { ok:false, error }");
  });
  console.log("[ok] ipc-register:convertSingle/Batch/Merge 入参类型守卫断言通过");

  // ---- 3. shell 白名单:未登记路径拒绝且不触达 shell(测试进程白名单为空) ----
  // 四个调用结果都备在 case 外:每条判定读的是自己那一次调用的返回值,
  // 搬进 case 会让它自己重调一次,白名单拒绝路径不再走真实 handler 调用
  const reveal = handlers.get(CH.shellRevealInFolder)(fakeEvent, "C:\\definitely\\not\\allowed.docx");
  await suite.case("revealInFolder 白名单外路径应拒绝", () => {
    assert(reveal.ok === false && typeof reveal.error === "string", "revealInFolder 白名单外路径应拒绝");
  });
  const revealBad = handlers.get(CH.shellRevealInFolder)(fakeEvent, 42);
  await suite.case("revealInFolder 非字符串入参应拒绝", () => {
    assert(revealBad.ok === false, "revealInFolder 非字符串入参应拒绝");
  });
  const openBad = await handlers.get(CH.shellOpenPath)(fakeEvent, "C:\\definitely\\not\\allowed.docx");
  await suite.case("openPath 白名单外路径应拒绝", () => {
    assert(openBad.ok === false && typeof openBad.error === "string", "openPath 白名单外路径应拒绝");
  });
  const openNonStr = await handlers.get(CH.shellOpenPath)(fakeEvent, null);
  await suite.case("openPath 非字符串入参应拒绝", () => {
    assert(openNonStr.ok === false, "openPath 非字符串入参应拒绝");
  });
  console.log("[ok] ipc-register:MR-12 shell 白名单拒绝(未登记/非字符串)断言通过");

  // ---- 3.1 同一 webContents 的转换/预检共享 single-flight:第二次明确 busy ----
  // 本段手工预占注册表(仅验 busy 形状与守卫优先级);真实并发调用 handler
  // 「同时最多一个活动操作」由 operation-single-flight.test.js 断言。
  const busyCtx = fakeConvertCtx();
  const busyToken = beginWebContentsOperation(fakeEvent.sender.id, "single", busyCtx);
  await suite.case("测试应先占用 sender operation", () => {
    assert(busyToken !== null, "测试应先占用 sender operation");
  });
  try {
    // 三次 busy 调用备在 case 之前:三条判定必须读**同一次占用期内**的结果,
    // 拆到各 case 里重调会让「占用还在不在」变成 case 之间共享的可变状态
    const busyConvert = await handlers.get(CH.convertSingle)(fakeEvent, "C:/a.md", "docx");
    const busyPrecheck = await handlers.get(CH.convertPrecheck)(fakeEvent, "C:/a.md");
    const busyBatch = await handlers.get(CH.convertBatch)(fakeEvent, ["a.md", "b.md"], "docx");
    await suite.case("活动转换期间第二次 convertSingle 应返回 { ok:false, busy:true, error }", () => {
      assert(busyConvert.ok === false && busyConvert.busy === true && typeof busyConvert.error === "string",
        "活动转换期间第二次 convertSingle 应返回 { ok:false, busy:true, error }");
    });
    await suite.case("活动转换期间 convertPrecheck 应返回明确 busy", () => {
      assert(busyPrecheck.ok === false && busyPrecheck.busy === true,
        "活动转换期间 convertPrecheck 应返回明确 busy");
    });
    await suite.case("活动转换期间 convertBatch 应返回兼容旧 renderer 计数字段的 busy", () => {
      assert(
        busyBatch.ok === false && busyBatch.busy === true &&
        Array.isArray(busyBatch.items) && busyBatch.okCount === 0 &&
        busyBatch.failCount === 0 && busyBatch.canceledCount === 0,
        "活动转换期间 convertBatch 应返回兼容旧 renderer 计数字段的 busy",
      );
    });
  } finally {
    // 释放留在 try/finally 顶层:它是段级卫生,归进任一 case 都会让 case 失败
    // 提前跳出而漏掉释放。判空是因为占用成功与否的收窄已随 assert 搬进 case,
    // token 为 null 时本就没什么可释放(那条占用失败已由上方 case 记下)。
    if (busyToken) finishWebContentsOperation(fakeEvent.sender.id, busyToken);
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
    await suite.case("目录递归应收 2 个 md(a/c)", () => {
      assert(collected.files.length === 2, `目录递归应收 2 个 md(a/c),实际 ${JSON.stringify(collected.files)}`);
    });
    await suite.case("递归结果应含 a.md 与 sub/c.markdown", () => {
      assert(
        collected.files.some((/** @type {string} */ f) => f.endsWith("a.md")) && collected.files.some((/** @type {string} */ f) => f.endsWith("c.markdown")),
        "递归结果应含 a.md 与 sub/c.markdown",
      );
    });
    await suite.case("缺失的传入路径应进 skipped", () => {
      assert(
        collected.skipped.length === 1 && collected.skipped[0].endsWith("missing.md"),
        `缺失的传入路径应进 skipped,实际 ${JSON.stringify(collected.skipped)}`,
      );
    });

    const empty = await handlers.get(CH.fileCollectMarkdown)(fakeEvent, [42]);
    await suite.case("非数组入参应按空输入处理(零收集)", () => {
      assert(empty.files.length === 0 && empty.skipped.length === 0, "非数组入参应按空输入处理(零收集)");
    });
    // 扫描预算未触顶:files/skipped 语义不变,附加的 warnings 为空数组
    await suite.case("未触顶的收集不应有扫描预算警告", () => {
      assert(Array.isArray(collected.warnings) && collected.warnings.length === 0,
        `未触顶的收集不应有扫描预算警告,实际 ${JSON.stringify(collected.warnings)}`);
    });

    // 深度超 MAX_SCAN_DEPTH:不静默截断,预算警告经 handler 返回(不被丢弃)
    // 深度自「传入路径」起逐层下探,故扫描入口是深层目录的上级 tmpDir
    // 深目录与 budgeted 都备在 case 之外:三条判定读的是同一次「超深收集」的结果,
    // 把建目录/收集搬进 case 会让每条各扫一遍、彼此的中间态不再一致
    let deepDir = tmpDir;
    for (let i = 0; i <= MAX_SCAN_DEPTH + 2; i++) deepDir = path.join(deepDir, `d${i}`);
    await fs.mkdir(deepDir, { recursive: true });
    await fs.writeFile(path.join(deepDir, "too-deep.md"), "# deep", "utf8");
    const budgeted = await handlers.get(CH.fileCollectMarkdown)(fakeEvent, [tmpDir]);
    await suite.case("深度超限应随结果返回单条扫描预算警告", () => {
      assert(
        Array.isArray(budgeted.warnings) && budgeted.warnings.length === 1 &&
          budgeted.warnings[0].key === "warn.pathScanLimit" &&
          typeof budgeted.warnings[0].fallback === "string" && budgeted.warnings[0].fallback.length > 0,
        `深度超限应随结果返回单条扫描预算警告,实际 ${JSON.stringify(budgeted.warnings)}`,
      );
    });
    await suite.case("扫描预算警告文案口径不符", () => {
      assert(
        formatWarning(budgeted.warnings[0]).includes(`层级上限(${MAX_SCAN_DEPTH})`),
        `扫描预算警告文案口径不符,实际 ${formatWarning(budgeted.warnings[0])}`,
      );
    });
    await suite.case("超深文件不应被收集(既有 files 字段语义不变)", () => {
      assert(
        Array.isArray(budgeted.files) && budgeted.files.length > 0 &&
          !budgeted.files.some((/** @type {string} */ f) => f.endsWith("too-deep.md")) &&
          budgeted.files.some((/** @type {string} */ f) => f.endsWith("a.md")),
        // 触顶后停止收集,已扫到的文件照常返回(截断范围随 readdir 顺序,不断言具体数量)
        `超深文件不应被收集(既有 files 字段语义不变),实际 ${JSON.stringify(budgeted.files)}`,
      );
    });
    console.log("[ok] ipc-register:fileCollectMarkdown 递归收集/skipped/点目录跳过/类型守卫 断言通过");
    console.log("[ok] ipc-register:fileCollectMarkdown 扫描预算警告经 IPC 返回(不静默截断)");

    // ---- 5. fileFilterExisting:保序过滤仍存在的路径 ----
    const existing = path.join(tmpDir, "a.md");
    const filtered = await handlers.get(CH.fileFilterExisting)(fakeEvent, [existing, path.join(tmpDir, "gone.md"), existing]);
    await suite.case("filterExisting 应保序保留存在路径、剔除缺失", () => {
      assert(
        filtered.length === 2 && filtered[0] === existing && filtered[1] === existing,
        "filterExisting 应保序保留存在路径、剔除缺失",
      );
    });
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
    // 逐编码一个 case:文件名后缀就是「哪种编码读不出双链」的定位键
    for (const [encodingName, filePath] of /** @type {[string, string][]} */ ([
      ["utf-8", frontmatterPath],
      ["gbk", gbkFrontmatterPath],
      ["utf-16le", utf16LeFrontmatterPath],
      ["utf-16be", utf16BeFrontmatterPath],
    ])) {
      const metadata = await handlers.get(CH.readFrontmatter)(fakeEvent, filePath);
      await suite.case(`readFrontmatter ${encodingName} 编码/双链解析`, () => {
        assert(
          metadata.title === "[[你好世界]]" && metadata.author === "作者",
          `readFrontmatter 编码/双链解析失败:${filePath}`,
        );
      });
    }

    // ---- 5c. precheck 缺文件/读取失败:不静默空数组,返回单条可观察失败警告 ----
    // 契约仍为 PrecheckResult(警告数组 | busy):异常以失败警告承载,renderer
    // 走既有警告列表展示,用户可见且仍可选择继续转换(不扩联合类型)。
    /** @type {string[]} */
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args.map((a) => String(a)).join(" "));
    let missingPrecheck;
    let directoryPrecheck;
    try {
      missingPrecheck = await handlers.get(CH.convertPrecheck)(fakeEvent, path.join(tmpDir, "missing.md"));
      directoryPrecheck = await handlers.get(CH.convertPrecheck)(fakeEvent, tmpDir);
    } finally {
      console.error = originalError;
    }
    // 逐场景一个 case:场景标签就是定位键(留痕判定读的是两次调用共用的 logged)
    for (const [label, result] of [["缺文件", missingPrecheck], ["目录", directoryPrecheck]]) {
      await suite.case(`precheck ${label}应返回单条可观察失败警告`, () => {
        assert(
          Array.isArray(result) && result.length === 1 &&
            typeof result[0] === "object" && result[0].key === "warn.precheckFailed" &&
            typeof result[0].fallback === "string" && result[0].fallback.length > 0,
          `precheck ${label}应返回单条可观察失败警告(实际 ${JSON.stringify(result)})`,
        );
      });
    }
    await suite.case("precheck 失败应在主进程留痕", () => {
      assert(
        logged.length === 2 && logged.every((line) => line.includes("convert:precheck 失败")),
        `precheck 失败应在主进程留痕(实际 ${JSON.stringify(logged)})`,
      );
    });
    // 非字符串入参仍是零成本的空数组(守卫先于注册表与文件访问)
    await suite.case("precheck 非字符串入参应返回空数组", async () => {
      assert(
        JSON.stringify(await handlers.get(CH.convertPrecheck)(fakeEvent, 42)) === "[]",
        "precheck 非字符串入参应返回空数组",
      );
    });
  } finally {
    // 清理失败刻意吞掉:finally 里的清理不得盖过段内真正的断言失败(助手只负责吸收 Windows 上的瞬时占用)
    removeTree(tmpDir);
  }

  // ---- 6. settings/ui-state/appVersion 转发直调 ----
  const settings = handlers.get(CH.settingsGet)();
  await suite.case("settings:get 应返回完整 AppSettings 形状", () => {
    assert(settings.version === 1 && typeof settings.format === "string" && typeof settings.pageSetup === "object",
      "settings:get 应返回完整 AppSettings 形状");
  });
  const updated = await handlers.get(CH.settingsSet)(undefined, { format: "pdf" });
  await suite.case("settings:set 合法 patch 应生效", () => {
    assert(updated.format === "pdf", "settings:set 合法 patch 应生效");
  });
  const reread = handlers.get(CH.settingsGet)();
  await suite.case("settings:set 后 get 应读到新值(缓存一致)", () => {
    assert(reread.format === "pdf", "settings:set 后 get 应读到新值(缓存一致)");
  });

  // ---- 6b. settings:set 语言/主题变更 → main 侧文案与菜单即时跟随(不需重启,不依赖 renderer 另发通道) ----
  // 端到端走真实触点:setLanguage + buildAppMenu(菜单项 label 经 t() 实时查表);
  // 触点判定本身(何时调、调给谁)见 settings-runtime-sync 段。
  // 断言后恢复原语言:主进程语言是模块级状态,同进程后续段共用。
  // 这一段的观测点**逐步后移**:t() 与菜单读的是「上一次 settingsSet 之后」的
  // 模块级状态,所以每个 case 都紧跟在它所观测的那次设置之后,不能整体提前
  const originLanguage = settings.language;
  try {
    const en = await handlers.get(CH.settingsSet)(undefined, { language: "en" });
    await suite.case("settings:set 应落盘新语言", () => {
      assert(en.language === "en", "settings:set 应落盘新语言");
    });
    await suite.case("主进程文案应即时切到英文(menu.file)", () => {
      assert(t("menu.file") === "File",
        `主进程文案应即时切到英文(menu.file),实际 ${JSON.stringify(t("menu.file"))}`);
    });
    const enMenu = Menu.getApplicationMenu();
    await suite.case("settings:set 改语言后应已重建应用菜单", () => {
      assert(enMenu !== null, "settings:set 改语言后应已重建应用菜单");
    });
    await suite.case("菜单首项标签应即时切到英文", () => {
      assert(enMenu !== null && enMenu.items[0]?.label === "File",
        `菜单首项标签应即时切到英文,实际 ${JSON.stringify(enMenu === null ? null : enMenu.items[0]?.label)}`);
    });
    // 同值重复保存:判定为无变化 → 不重建菜单,菜单仍为当前语言(幂等)
    const sameLang = await handlers.get(CH.settingsSet)(undefined, { language: "en" });
    await suite.case("同语言重复保存应保持菜单为当前语言", () => {
      assert(sameLang.language === "en" && Menu.getApplicationMenu()?.items[0]?.label === "File",
        "同语言重复保存应保持菜单为当前语言");
    });
    // 主题变更走同一副作用切口(overlay 配色下发见 settings-runtime-sync 段;
    // 此处无主窗口,只断言落盘与 handler 正常返回)
    const themed = await handlers.get(CH.settingsSet)(undefined, { theme: "dark" });
    await suite.case("settings:set 应落盘新主题", () => {
      assert(themed.theme === "dark", "settings:set 应落盘新主题");
    });
  } finally {
    // 恢复原语言留在 try/finally 顶层:它是段级卫生(同进程后续段共用主进程语言),
    // 归进 case 会在 case 失败时漏掉恢复
    await handlers.get(CH.settingsSet)(undefined, { language: originLanguage });
    await suite.case("恢复原语言后主进程文案应回中文", () => {
      assert(t("menu.file") === "文件",
        `恢复原语言后主进程文案应回中文,实际 ${JSON.stringify(t("menu.file"))}`);
    });
  }
  console.log("[ok] ipc-register:settings:set 语言/主题变更即时同步(main 文案 + 应用菜单)断言通过");

  const uiState = await handlers.get(CH.uiStateSet)(undefined, { lastOpenDir: tmpMarkerDir() });
  await suite.case("ui-state:set patch 应生效", () => {
    assert(uiState.lastOpenDir === tmpMarkerDir(), "ui-state:set patch 应生效");
  });
  await suite.case("ui-state:get 应读到刚写入的值", () => {
    assert(handlers.get(CH.uiStateGet)().lastOpenDir === tmpMarkerDir(), "ui-state:get 应读到刚写入的值");
  });

  await suite.case("app:version 应与 app.getVersion 同源", () => {
    assert(handlers.get(CH.appVersion)() === app.getVersion(), "app:version 应与 app.getVersion 同源");
  });
  console.log("[ok] ipc-register:settings/ui-state 读写转发 + appVersion 同源 断言通过");

  // ---- 7. 无副作用兜底:previewOpen 非法入参 / previewRefresh 空操作 / convertCancel 无 ctx ----
  const badPreview = await handlers.get(CH.previewOpen)(fakeEvent, 42);
  await suite.case("preview:open 非字符串路径应拒绝", () => {
    assert(badPreview.ok === false && typeof badPreview.error === "string", "preview:open 非字符串路径应拒绝");
  });
  await suite.case("preview:refresh 无预览窗口时应为空操作", () => {
    assert(handlers.get(CH.previewRefresh)() === undefined, "preview:refresh 无预览窗口时应为空操作");
  });
  await suite.case("convert:cancel 无注册 ctx 时应为空操作", () => {
    assert(handlers.get(CH.convertCancel)(fakeEvent) === undefined, "convert:cancel 无注册 ctx 时应为空操作");
  });
  console.log("[ok] ipc-register:previewOpen 守卫/previewRefresh 空操作/convertCancel 无 ctx 兜底 断言通过");
  return { cases: suite.results };
}

/** ui-state 写入用标记目录(仅作字符串值存储,无须真实存在) */
function tmpMarkerDir() {
  return path.join(os.tmpdir(), `m2w-ipcreg-marker-${process.pid}`);
}
