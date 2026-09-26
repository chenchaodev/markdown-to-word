// @ts-check
/**
 * 剪贴板临时 Markdown 源段(主体 src/main/services/temp-html.ts 纯 Node 层;末节经
 * dist/main/ipc/register.js 真实 handler 覆盖 IPC 接线):
 * - writeTempMarkdown 句柄:内容逐字、扩展名 .md、标题命名(不再用随机临时名)、
 *   release 删除 + 一次性(重复调用空操作)、专属子目录空后回收;
 * - clipboardTitle 取标题:首个 ATX 标题 / 首个含可见文字的非围栏行 / fallback;
 * - 文件名安全化:Windows 禁用字符与控制字符、保留设备名、长度上限、空标题回落;
 * - 同名换名重试(标题同名已在 → 标题-2.md);
 * - ClipboardTempRegistry:同消费方只留最新句柄、按路径/按消费方/全量释放、
 *   pendingCount 归零,isTempSource 覆盖已释放路径(最近文件过滤的唯一判定);
 * - IPC 接线(真实 handler + 真实剪贴板):clipboard:read 登记句柄且按标题命名 →
 *   convert:single 守卫不释放/失败释放/成功释放 → 临时源不进最近文件(普通源对照)
 *   → will-quit 释放未消费源。
 * 样例目录放 os.tmpdir 下的 m2w-clipboard-{pid}(生产同款),finally 清理干净。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  clipboardTempDir,
  clipboardTempSources,
  clipboardTitle,
  ClipboardTempRegistry,
  writeTempMarkdown,
} from "../../dist/main/services/temp-html.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`temp-markdown 断言失败:${msg}`);
}

/** 最近文件条目(跨进程契约单源) */
/** @typedef {import("../../src/core/ipc-contract.js").RecentFile} RecentFile */

/**
 * 取待消费句柄数(经属性读取:前一次 `assert(pendingCount === N)` 会把它收窄成字面量,
 * 而两次断言之间释放出口会改写它——直接再比较会误报「无交集」)。
 * @param {{ pendingCount: number }} registry 临时源注册表
 * @returns {number} 当前待消费句柄数
 */
const pendingCountOf = (registry) => registry.pendingCount;

/**
 * 目标路径当前是否存在。
 * @param {string} target 路径
 * @returns {Promise<boolean>} 存在即 true
 */
async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 等待文件消失(handler 内释放是 fire-and-forget,需轮询落定)。
 * @param {string} target 路径
 * @param {string} label 场景标签(超时消息用)
 * @returns {Promise<void>} 文件消失即返回
 */
async function waitGone(target, label) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await exists(target))) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`temp-markdown 断言失败:${label} 文件应被删除(${target})`);
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const dir = clipboardTempDir();
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  const registry = new ClipboardTempRegistry();
  const written = [];
  try {
    // ---- 1. 基本写入:内容逐字 + .md 扩展名 + release 一次性删除 ----
    const sample = "# 标题\n\n正文内容 ${x} 与中文。\n";
    const first = await writeTempMarkdown(sample, { title: "标题", dir });
    written.push(first);
    assert(path.dirname(first.mdPath) === dir, `剪贴板源应落在专属子目录,实际 ${first.mdPath}`);
    assert(path.extname(first.mdPath) === ".md", `扩展名应为 .md,实际 ${path.extname(first.mdPath)}`);
    assert(
      (await fs.readFile(first.mdPath, "utf8")) === sample,
      `内容不一致:实际 ${JSON.stringify(await fs.readFile(first.mdPath, "utf8"))}`,
    );
    await first.release();
    assert(!(await exists(first.mdPath)), "release 后临时文件应被删除");
    await first.release(); // 一次性:第二次调用不抛也不重复动作
    console.log("[ok] temp-markdown:writeTempMarkdown 内容逐字/扩展名/release 一次性删除");

    // ---- 2. 标题命名:文件基名取自标题(产物名与文档标题同源,不再是随机临时名) ----
    const titled = await writeTempMarkdown("# 会议纪要\n\n正文\n", {
      title: clipboardTitle("# 会议纪要\n\n正文\n", "fallback"),
      dir,
    });
    written.push(titled);
    assert(
      path.basename(titled.mdPath) === "会议纪要.md",
      `文件基名应为标题「会议纪要.md」,实际 ${path.basename(titled.mdPath)}`,
    );
    // 同名已在 → 换名重试(避免 wx 碰撞导致转换读不到刚写的源)
    const collided = await writeTempMarkdown("第二份\n", { title: "会议纪要", dir });
    written.push(collided);
    assert(
      path.basename(collided.mdPath) === "会议纪要-2.md",
      `同名应换名重试为「会议纪要-2.md」,实际 ${path.basename(collided.mdPath)}`,
    );
    assert((await fs.readFile(collided.mdPath, "utf8")) === "第二份\n", "换名后内容应仍逐字一致");
    console.log("[ok] temp-markdown:标题命名 + 同名换名重试(标题-2.md)");

    // ---- 3. clipboardTitle:标题行 / 普通首行 / 跳过围栏与纯标点 / fallback ----
    assert(clipboardTitle("# 一级标题\n\n正文", "fb") === "一级标题", "应取首个 ATX 标题");
    assert(clipboardTitle("## 二级标题 ##\n正文", "fb") === "二级标题", "应剥掉标题的闭合井号");
    assert(clipboardTitle("\n\n直接一段正文\n", "fb") === "直接一段正文", "无标题时取首个非空行");
    assert(clipboardTitle("```\n# 围栏内不是标题\n```\n# 真标题", "fb") === "真标题", "围栏内代码不作标题");
    assert(clipboardTitle("```\n# 未闭合围栏\n# 仍是代码", "fb") === "fb", "未闭合围栏后不应取标题");
    assert(clipboardTitle("---\n***\n", "fb") === "fb", "无可见文字时应回落 fallback");
    assert(clipboardTitle("", "fb") === "fb", "空文本应回落 fallback");
    assert(clipboardTitle("  \n\t\n", "fb") === "fb", "全空白应回落 fallback");
    console.log("[ok] temp-markdown:clipboardTitle 标题/首行/围栏跳过/fallback 判定");

    // ---- 4. 文件名安全化:禁用字符、保留设备名、长度上限、空标题回落 ----
    const unsafe = await writeTempMarkdown("x\n", { title: 'a<b>:c/d\\e|f?g*h\u0000i  \n j', dir });
    written.push(unsafe);
    const unsafeName = path.basename(unsafe.mdPath);
    assert(!/[<>:"/\\|?*\u0000-\u001f]/.test(unsafeName), `文件名不应含 Windows 禁用字符,实际 ${unsafeName}`);
    const reserved = await writeTempMarkdown("x\n", { title: "con", dir });
    written.push(reserved);
    assert(path.basename(reserved.mdPath) === "_con.md", `保留设备名应加下划线前缀,实际 ${reserved.mdPath}`);
    const long = await writeTempMarkdown("x\n", { title: "长".repeat(200), dir });
    written.push(long);
    assert(
      path.basename(long.mdPath) === `${"长".repeat(60)}.md`,
      `标题应限长 60 字符,实际 ${path.basename(long.mdPath).length - 3}`,
    );
    const blank = await writeTempMarkdown("x\n", { title: "   ", dir });
    written.push(blank);
    assert(path.basename(blank.mdPath) === "clipboard.md", `空标题应回落通用名,实际 ${blank.mdPath}`);
    console.log("[ok] temp-markdown:文件名安全化(禁用字符/设备名/限长/空标题回落)");

    // ---- 5. 注册表:同消费方只留最新句柄(旧句柄被释放)----
    const ownerA = "101";
    const ownerB = "202";
    const a1 = await writeTempMarkdown("a1\n", { title: "甲", dir });
    const a2 = await writeTempMarkdown("a2\n", { title: "乙", dir });
    const b1 = await writeTempMarkdown("b1\n", { title: "丙", dir });
    written.push(a1, a2, b1);
    await registry.add(ownerA, a1);
    assert(registry.pendingCount === 1, "首次登记后应有 1 个待消费句柄");
    await registry.add(ownerA, a2);
    assert(!(await exists(a1.mdPath)), "同一消费方再次粘贴应先释放上一份临时源");
    assert(registry.pendingCount === 1, "替换后仍只应保留最新句柄");
    await registry.add(ownerB, b1);
    assert(pendingCountOf(registry) === 2, "不同消费方互不影响");
    console.log("[ok] temp-markdown:注册表 同消费方只留最新句柄(旧句柄即删)");

    // ---- 6. isTempSource:含已释放路径(最近文件过滤的唯一判定)----
    assert(registry.isTempSource(a1.mdPath), "已释放的临时源仍应被识别为临时源(最近文件需据此过滤)");
    assert(registry.isTempSource(a2.mdPath) && registry.isTempSource(b1.mdPath), "存活临时源应被识别");
    assert(!registry.isTempSource(path.join(dir, "会议纪要.md")), "普通 md 路径不应被误判为临时源");
    console.log("[ok] temp-markdown:isTempSource 覆盖存活与已释放路径/不误判普通文件");

    // ---- 7. 三条释放出口:按路径 / 按消费方 / 全量 ----
    await registry.releaseByPath(a2.mdPath);
    assert(!(await exists(a2.mdPath)), "releaseByPath 应删除对应临时源");
    await registry.releaseByPath(a2.mdPath); // 重复释放为空操作
    await registry.releaseByPath(path.join(dir, "不存在.md")); // 非托管路径为空操作
    assert(registry.pendingCount === 1, "按路径释放后应只剩另一个消费方的句柄");
    await registry.releaseOwner(ownerA); // 已释放过 → 空操作
    await registry.releaseOwner(ownerB);
    assert(pendingCountOf(registry) === 0, "按消费方释放后不应有存活句柄");
    assert(!(await exists(b1.mdPath)), "按消费方释放应删除其名下临时源");
    const c1 = await writeTempMarkdown("c1\n", { title: "丁", dir });
    written.push(c1);
    await registry.add("303", c1);
    await registry.releaseAll();
    assert(pendingCountOf(registry) === 0 && !(await exists(c1.mdPath)), "releaseAll 应清空并删除全部存活句柄");
    console.log("[ok] temp-markdown:注册表 按路径/按消费方/全量释放(含幂等与空操作)");

    // ---- 8. 进程单例与本段登记的临时源一并回收,专属子目录空后消失 ----
    const singleton = await writeTempMarkdown("单例\n", { title: "戊", dir });
    await clipboardTempSources.add("999", singleton);
    assert(clipboardTempSources.pendingCount === 1, "进程单例应登记成功");
    await clipboardTempSources.releaseAll();
    assert(!(await exists(singleton.mdPath)), "单例 releaseAll 应删除临时源");

    // ---- 9. IPC 接线(真实 handler):clipboard:read 登记 → convert:single 任意结局释放
    //      → 成功不入最近文件 → will-quit 释放未消费源 ----
    const { app, clipboard, ipcMain } = await import("electron");
    const { registerIpc } = await import("../../dist/main/ipc/register.js");
    const { IPC_CHANNELS: CH } = await import("../../dist/main/ipc/channels.js");
    const { loadUiState } = await import("../../dist/main/persist/ui-state.js");
    const handlers = new Map();
    const originalHandle = ipcMain.handle;
    // 同进程前序段已真注册过同名 channel,这里只捕获 handler 表,不再真注册
    ipcMain.handle = (channel, fn) => handlers.set(channel, fn);
    try {
      registerIpc();
    } finally {
      ipcMain.handle = originalHandle;
    }
    // 假 event:runWithCtx 读 sender.id,BrowserWindow.fromWebContents 需 getOwnerBrowserWindow
    /**
     * @param {number} id webContents id
     * @returns {{ sender: { id: number, once: () => void, getOwnerBrowserWindow: () => null } }} 假 ipc event
     */
    const event = (id) => ({ sender: { id, once: () => {}, getOwnerBrowserWindow: () => null } });

    clipboard.writeText("# 剪贴板标题\n\n正文段落。\n");
    const read = await handlers.get(CH.clipboardRead)(event(4242));
    assert(read.type === "text", `剪贴板文本应返回临时源,实际 ${JSON.stringify(read)}`);
    assert(
      path.basename(read.mdPath) === "剪贴板标题.md",
      `临时源应按内容标题命名(不再用随机临时名),实际 ${path.basename(read.mdPath)}`,
    );
    assert(path.dirname(read.mdPath) === dir, "临时源应落在剪贴板专属子目录");
    assert(await exists(read.mdPath), "临时源文件应已写入");
    assert(clipboardTempSources.isTempSource(read.mdPath), "clipboard:read 应登记句柄");
    assert(clipboardTempSources.pendingCount === 1, "登记后应有 1 个待消费句柄");
    console.log("[ok] temp-markdown:clipboard:read 登记句柄 + 标题命名临时源");

    // 守卫拒绝(非法 format)在释放逻辑之前:句柄保留
    const rejected = await handlers.get(CH.convertSingle)(event(4242), read.mdPath, "html");
    assert(rejected.ok === false, "非法 format 应被守卫拒绝");
    assert(clipboardTempSources.pendingCount === 1, "守卫拒绝不应释放临时源");
    // 失败结局(源已删):finally 仍释放
    await fs.rm(read.mdPath, { force: true });
    const failed = await handlers.get(CH.convertSingle)(event(4242), read.mdPath, "docx");
    assert(failed.ok === false, `源缺失应转换失败,实际 ${JSON.stringify(failed)}`);
    assert(pendingCountOf(clipboardTempSources) === 0, "转换失败结局也应释放临时源");
    assert(clipboardTempSources.isTempSource(read.mdPath), "已释放路径仍应被识别为临时源");
    console.log("[ok] temp-markdown:convert:single 守卫不释放 / 失败结局释放");

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "m2w-clipconv-"));
    try {
      const tempSrc = path.join(workDir, "临时源.md");
      const plain = path.join(workDir, "普通源.md");
      await fs.writeFile(tempSrc, "# 临时源\n\n正文\n", "utf8");
      await fs.writeFile(plain, "# 普通源\n\n正文\n", "utf8");
      // 以真实句柄形态登记(与 clipboard:read 的登记语义一致)
      await clipboardTempSources.add("777", {
        mdPath: tempSrc,
        release: async () => {
          await fs.rm(tempSrc, { force: true });
        },
      });
      const okTemp = await handlers.get(CH.convertSingle)(event(4243), tempSrc, "docx");
      assert(okTemp.ok === true, `临时源转换应成功,实际 ${JSON.stringify(okTemp)}`);
      await waitGone(tempSrc, "转换成功后释放的临时源");
      assert(pendingCountOf(clipboardTempSources) === 0, "成功后不应残留待消费句柄");
      const okPlain = await handlers.get(CH.convertSingle)(event(4243), plain, "docx");
      assert(okPlain.ok === true, `普通源转换应成功,实际 ${JSON.stringify(okPlain)}`);
      const recent = loadUiState().recentFiles.map((/** @type {RecentFile} */ entry) => entry.path);
      assert(recent.includes(plain), `普通源应进最近文件(对照组),实际 ${JSON.stringify(recent)}`);
      assert(!recent.includes(tempSrc), `剪贴板临时源不应进最近文件,实际 ${JSON.stringify(recent)}`);
      // 退出兜底:will-quit 释放未消费句柄
      const leftover = path.join(workDir, "未消费.md");
      await fs.writeFile(leftover, "# 未消费\n", "utf8");
      await clipboardTempSources.add("888", {
        mdPath: leftover,
        release: async () => {
          await fs.rm(leftover, { force: true });
        },
      });
      app.emit("will-quit");
      await waitGone(leftover, "will-quit 释放的未消费临时源");
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
    console.log("[ok] temp-markdown:成功释放 + 不进最近文件 + will-quit 释放未消费源");
  } finally {
    await registry.releaseAll();
    await clipboardTempSources.releaseAll();
    for (const source of written) await source.release().catch(() => undefined);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  // 全部释放后专属子目录应被回收(无 %TEMP% 残留目录)
  assert(!(await exists(dir)), `全部释放后专属子目录应被回收:${dir}`);
  console.log("[ok] temp-markdown:子目录空后回收 + 单例注册表释放");
}
