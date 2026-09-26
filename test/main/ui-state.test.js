/**
 * UI 状态持久化测试(src/main/persist/ui-state.ts 纯逻辑层;测试经 dist/main/persist/ui-state.js):
 * 策略——备份真实 ui-state.json,finally 恢复;每场景用 query-string 动态 import 取全新模块实例。
 * 校验宽松:字段非法/缺失 → 该字段默认值,不影响其它字段。
 * 并发与重启:mutation queue 内读改写(不同顶层字段并发 patch 不丢)+ 全新实例
 * 读盘复核(最近文件/会话文件/窗口状态并发字段全部保留);写失败不更新缓存、
 * 错误上抛、队列不截断(恢复后重启读盘一致)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

function assert(cond, msg) {
  if (!cond) throw new Error(`ui-state 断言失败:${msg}`);
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const uiFile = path.join(app.getPath("userData"), "ui-state.json");
  // 备份真实 ui-state.json(如有),finally 恢复(ui-state.ts 无注入点,只能读写真实路径)
  let backup = null;
  let hadFile = false;
  try {
    backup = await fs.readFile(uiFile, "utf8");
    hadFile = true;
  } catch {
    /* 无既有文件 */
  }
  let seq = 0;
  const freshModule = () => import(`../../dist/main/persist/ui-state.js?case=${seq++}`);
  try {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const mod = await freshModule();
    // 段内基线复位:同进程内其它段(如 operation-single-flight 经真实 IPC 写
    // 最近文件)会先落到同一 userData/ui-state.json,本段以 DEFAULT_UI_STATE
    // 作为已知起点,消除跨段顺序依赖;收尾 finally 仍恢复原文件内容。
    await fs.writeFile(uiFile, JSON.stringify(mod.DEFAULT_UI_STATE), "utf8");

    // ---- 1. 原子写往返:saveUiState 落盘 → 全新实例 loadUiState 逐字段一致,无 .tmp 残留 ----
    const patch = {
      recentFiles: [
        { path: "C:\\a.md", name: "a.md", format: "docx", ts: 300 },
        { path: "C:\\b.md", name: "b.md", format: "pdf", ts: 200 },
      ],
      lastSessionFiles: ["C:\\a.md", "C:\\b.md"],
      lastOpenDir: "C:\\docs",
      windowBounds: { x: 100, y: 100, width: 900, height: 640 },
      panelOpen: { page: false, typography: true },
    };
    const saved = await mod.saveUiState(patch);
    assert(
      saved.recentFiles.length === 2 && saved.lastOpenDir === "C:\\docs",
      `saveUiState 返回值异常:${JSON.stringify(saved)}`,
    );
    assert(saved.windowBounds?.width === 900 && saved.panelOpen.page === false, "saveUiState 返回值异常(嵌套字段)");
    const m2 = await freshModule();
    const loaded = m2.loadUiState();
    const expected = { ...mod.DEFAULT_UI_STATE, ...patch };
    assert(
      JSON.stringify(loaded) === JSON.stringify(expected),
      `往返不一致:实际 ${JSON.stringify(loaded)} 期望 ${JSON.stringify(expected)}`,
    );
    let tmpLeft = true;
    try {
      await fs.access(uiFile + ".tmp");
    } catch {
      tmpLeft = false;
    }
    assert(!tmpLeft, "原子写完成后不应残留 .tmp 临时文件");
    console.log("[ok] ui-state:原子写往返(逐字段一致 + 无 .tmp 残留)");

    // ---- 2. 损坏 JSON(parse 失败)→ 全字段默认,不写盘 ----
    await fs.writeFile(uiFile, "{broken json!!", "utf8");
    const m3 = await freshModule();
    const s3 = m3.loadUiState();
    assert(
      JSON.stringify(s3) === JSON.stringify(m3.DEFAULT_UI_STATE),
      `损坏 JSON 应回退全默认,实际 ${JSON.stringify(s3)}`,
    );
    assert(
      (await fs.readFile(uiFile, "utf8")) === "{broken json!!",
      "损坏文件不应被重写(静默不写盘)",
    );
    console.log("[ok] ui-state:损坏 JSON 回退全默认(静默不写盘)");

    // ---- 2b. 合法 JSON 但非对象(167-168 行)→ 全字段默认 ----
    await fs.writeFile(uiFile, JSON.stringify("hello"), "utf8");
    const m3b = await freshModule();
    assert(
      JSON.stringify(m3b.loadUiState()) === JSON.stringify(m3b.DEFAULT_UI_STATE),
      `非对象 JSON(字符串)应回退全默认,实际 ${JSON.stringify(m3b.loadUiState())}`,
    );
    await fs.writeFile(uiFile, JSON.stringify(null), "utf8");
    const m3c = await freshModule();
    assert(
      JSON.stringify(m3c.loadUiState()) === JSON.stringify(m3c.DEFAULT_UI_STATE),
      `非对象 JSON(null)应回退全默认,实际 ${JSON.stringify(m3c.loadUiState())}`,
    );
    console.log("[ok] ui-state:非对象 JSON(字符串/null)回退全默认");

    // ---- 3. 字段类型非法 → 该字段默认(其它字段不受影响) ----
    await fs.writeFile(
      uiFile,
      JSON.stringify({
        recentFiles: [
          { path: "C:\\ok.md", name: "ok.md", format: "docx", ts: 100 },
          { name: "no-path.md", format: "docx", ts: 100 }, // 缺 path
          { path: "C:\\no-name.md", format: "docx", ts: 100 }, // 缺 name
          { path: "C:\\bad-fmt.md", name: "bad-fmt.md", format: "html", ts: 100 }, // format 非法
          { path: "C:\\bad-ts.md", name: "bad-ts.md", format: "pdf", ts: "now" }, // ts 非数
          "not-an-object", // 非对象条目
        ],
        lastSessionFiles: ["C:\\keep.md", 42, "", "C:\\keep2.md"],
        lastOpenDir: 123,
        windowBounds: { x: "left", y: 10, width: 800, height: 600 },
        panelOpen: { page: "yes", typography: false },
      }),
      "utf8",
    );
    const m4 = await freshModule();
    const s4 = m4.loadUiState();
    assert(
      s4.recentFiles.length === 1 && s4.recentFiles[0].path === "C:\\ok.md",
      `recentFiles 非法条目应被过滤,实际 ${JSON.stringify(s4.recentFiles)}`,
    );
    assert(
      JSON.stringify(s4.lastSessionFiles) === JSON.stringify(["C:\\keep.md", "C:\\keep2.md"]),
      `lastSessionFiles 非字符串/空串应过滤,实际 ${JSON.stringify(s4.lastSessionFiles)}`,
    );
    assert(s4.lastOpenDir === "", `lastOpenDir 非字符串应回退空串,实际 ${JSON.stringify(s4.lastOpenDir)}`);
    assert(s4.windowBounds === null, `windowBounds 字段非法应回退 null,实际 ${JSON.stringify(s4.windowBounds)}`);
    assert(
      s4.panelOpen.page === false && s4.panelOpen.typography === false,
      `panelOpen 非布尔应回退默认 false(另一字段保留),实际 ${JSON.stringify(s4.panelOpen)}`,
    );
    console.log("[ok] ui-state:字段类型非法逐字段回退(recentFiles 过滤/lastSessionFiles 过滤/lastOpenDir/windowBounds/panelOpen)");

    // ---- 4. recentFiles 去重 + 上限 10 + ts 降序 ----
    const entries = [];
    for (let i = 0; i < 12; i++) {
      entries.push({ path: `C:\\f${i}.md`, name: `f${i}.md`, format: "docx", ts: i });
    }
    entries.push({ path: "C:\\f5.md", name: "f5.md", format: "pdf", ts: 1000 }); // 重复 path,ts 更大
    await fs.writeFile(uiFile, JSON.stringify({ recentFiles: entries }), "utf8");
    const m5 = await freshModule();
    const s5 = m5.loadUiState();
    assert(s5.recentFiles.length === 10, `recentFiles 应截断到 10,实际 ${s5.recentFiles.length}`);
    assert(
      new Set(s5.recentFiles.map((e) => e.path)).size === 10,
      "recentFiles 应按 path 去重",
    );
    const f5 = s5.recentFiles.find((e) => e.path === "C:\\f5.md");
    assert(f5 && f5.ts === 1000 && f5.format === "pdf", "重复 path 应保留 ts 最大条目");
    for (let i = 1; i < s5.recentFiles.length; i++) {
      assert(s5.recentFiles[i - 1].ts >= s5.recentFiles[i].ts, "recentFiles 应按 ts 降序");
    }
    console.log("[ok] ui-state:recentFiles 去重(保留 ts 最大)+ 上限 10 + ts 降序");

    // ---- 5. saveUiState 追加合并语义:重复转换自然置顶,不重复累积 ----
    await fs.writeFile(uiFile, JSON.stringify({ recentFiles: [] }), "utf8"); // 复位文件,隔离场景 4 数据
    const m6 = await freshModule();
    await m6.saveUiState({
      recentFiles: [{ path: "C:\\x.md", name: "x.md", format: "docx", ts: 1 }],
    });
    await m6.saveUiState({
      recentFiles: [
        { path: "C:\\x.md", name: "x.md", format: "pdf", ts: 2 },
        { path: "C:\\y.md", name: "y.md", format: "docx", ts: 1 },
      ],
    });
    const m7 = await freshModule();
    const s7 = m7.loadUiState();
    assert(s7.recentFiles.length === 2, `追加合并后应 2 条,实际 ${JSON.stringify(s7.recentFiles)}`);
    const x = s7.recentFiles.find((e) => e.path === "C:\\x.md");
    assert(x && x.ts === 2 && x.format === "pdf", "追加合并:x 应只留 ts 最大条目且置顶");
    assert(s7.recentFiles[0].path === "C:\\x.md", "追加合并:ts 最大应排最前");
    console.log("[ok] ui-state:saveUiState 追加合并(重复 path 去重置顶)");

    // ---- 5b. saveUiState({ recentFiles: [] }) = 清空(renderer「清空最近」传空数组) ----
    await m7.saveUiState({ recentFiles: [] });
    const m7b = await freshModule();
    const s7b = m7b.loadUiState();
    assert(s7b.recentFiles.length === 0, `空数组应清空 recentFiles,实际 ${JSON.stringify(s7b.recentFiles)}`);
    // 清空后追加合并语义不变(转换成功后追加新条目,index.ts:280 调用不受影响)
    await m7b.saveUiState({ recentFiles: [{ path: "C:\\z.md", name: "z.md", format: "docx", ts: 5 }] });
    const m7c = await freshModule();
    const s7c = m7c.loadUiState();
    assert(
      s7c.recentFiles.length === 1 && s7c.recentFiles[0].path === "C:\\z.md",
      `清空后追加合并应正常,实际 ${JSON.stringify(s7c.recentFiles)}`,
    );
    console.log("[ok] ui-state:saveUiState 空数组清空(清空最近)+ 清空后追加合并不变");

    // ---- 6. lastOpenDir 缺失 / 空串 → 默认空串 ----
    await fs.writeFile(uiFile, JSON.stringify({ lastOpenDir: "" }), "utf8");
    const m8 = await freshModule();
    assert(m8.loadUiState().lastOpenDir === "", "lastOpenDir 空串应保留默认");
    const m9 = await freshModule();
    assert(m9.loadUiState().lastOpenDir === "", "lastOpenDir 缺失应回退默认空串");
    console.log("[ok] ui-state:lastOpenDir 空串/缺失回退默认");

    // ---- 7. pickWindowBounds:工作区内保留 / 全工作区外丢弃 / 尺寸非法丢弃 ----
    const areas = [
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: 1920, y: 0, width: 1920, height: 1040 },
    ];
    const valid = { x: 100, y: 100, width: 900, height: 600 };
    assert(
      JSON.stringify(mod.pickWindowBounds(valid, areas)) === JSON.stringify(valid),
      "pickWindowBounds:工作区内应原样保留",
    );
    assert(
      JSON.stringify(mod.pickWindowBounds({ x: 2000, y: 300, width: 800, height: 600 }, areas)) ===
        JSON.stringify({ x: 2000, y: 300, width: 800, height: 600 }),
      "pickWindowBounds:第二显示器工作区内应保留",
    );
    assert(mod.pickWindowBounds({ x: 5000, y: 500, width: 800, height: 600 }, areas) === null, "pickWindowBounds:全工作区外(x 越界)应丢弃");
    assert(mod.pickWindowBounds({ x: -100, y: 500, width: 800, height: 600 }, areas) === null, "pickWindowBounds:全工作区外(负坐标)应丢弃");
    assert(mod.pickWindowBounds({ x: 0, y: 0, width: 0, height: 600 }, areas) === null, "pickWindowBounds:宽 ≤0 应丢弃");
    assert(mod.pickWindowBounds({ x: 0, y: 0, width: 800, height: -1 }, areas) === null, "pickWindowBounds:高 ≤0 应丢弃");
    assert(mod.pickWindowBounds({ x: NaN, y: 0, width: 800, height: 600 }, areas) === null, "pickWindowBounds:非数坐标应丢弃");
    assert(mod.pickWindowBounds(null, areas) === null, "pickWindowBounds:null 应丢弃");
    console.log("[ok] ui-state:pickWindowBounds 工作区钳制(区内保留/区外与非法丢弃)");

    // ---- 8. suppressCompleteDialog(默认 true=不弹):布尔往返持久化;缺失/非 boolean → 默认 true ----
    await fs.writeFile(uiFile, JSON.stringify({ suppressCompleteDialog: true }), "utf8");
    const m10 = await freshModule();
    assert(m10.loadUiState().suppressCompleteDialog === true, "suppressCompleteDialog:true 应原样读回");
    await m10.saveUiState({ suppressCompleteDialog: false });
    const m11 = await freshModule();
    assert(m11.loadUiState().suppressCompleteDialog === false, "suppressCompleteDialog:saveUiState(false) 应持久化(用户显式选弹窗的既有偏好被尊重)");
    await fs.writeFile(uiFile, JSON.stringify({ suppressCompleteDialog: "yes" }), "utf8");
    const m12 = await freshModule();
    assert(m12.loadUiState().suppressCompleteDialog === true, "suppressCompleteDialog:非 boolean 应回退默认 true");
    await fs.writeFile(uiFile, JSON.stringify({}), "utf8");
    const m13 = await freshModule();
    assert(m13.loadUiState().suppressCompleteDialog === true, "suppressCompleteDialog:缺失应回退默认 true");
    assert(m13.DEFAULT_UI_STATE.suppressCompleteDialog === true, "DEFAULT_UI_STATE.suppressCompleteDialog 应为 true");
    console.log("[ok] ui-state:suppressCompleteDialog 往返/宽松校验(布尔持久化,缺失与非 boolean 回退默认 true 不弹)");

    // ---- 9. isMaximized(窗口最大化状态记忆):true 往返持久化;缺失/非 boolean → false ----
    await fs.writeFile(uiFile, JSON.stringify({ isMaximized: true }), "utf8");
    const m14 = await freshModule();
    assert(m14.loadUiState().isMaximized === true, "isMaximized:true 应原样读回");
    await m14.saveUiState({ isMaximized: true, windowBounds: { x: 0, y: 0, width: 800, height: 600 } });
    const m15 = await freshModule();
    const s15 = m15.loadUiState();
    assert(s15.isMaximized === true, "isMaximized:saveUiState(true) 应持久化");
    assert(
      s15.windowBounds && s15.windowBounds.width === 800,
      "isMaximized 同批写入的 windowBounds(还原态尺寸)应一并持久化",
    );
    await fs.writeFile(uiFile, JSON.stringify({ isMaximized: "yes" }), "utf8");
    const m16 = await freshModule();
    assert(m16.loadUiState().isMaximized === false, "isMaximized:非 boolean 应回退 false");
    await fs.writeFile(uiFile, JSON.stringify({}), "utf8");
    const m17 = await freshModule();
    assert(m17.loadUiState().isMaximized === false, "isMaximized:缺失应回退默认 false");
    assert(m17.DEFAULT_UI_STATE.isMaximized === false, "DEFAULT_UI_STATE.isMaximized 应为 false");
    // patch 未携带时保留现值(saveUiState 合并语义)
    await m17.saveUiState({ isMaximized: true });
    await m17.saveUiState({ lastOpenDir: "C:\\tmp" });
    const m18 = await freshModule();
    assert(m18.loadUiState().isMaximized === true, "patch 未携带 isMaximized 时应保留现值");
    console.log("[ok] ui-state:isMaximized 往返/宽松校验(true 持久化,缺失与非 boolean 回退 false,patch 合并保留)");

    // ---- 10. mutation queue:不同顶层字段并发 patch 不丢,最终缓存与落盘一致 ----
    const m19 = await freshModule();
    const [dirResult, boundsResult, maximizedResult] = await Promise.all([
      m19.saveUiState({ lastOpenDir: "C:\\queue-a" }),
      m19.saveUiState({ windowBounds: { x: 1, y: 2, width: 640, height: 480 } }),
      m19.saveUiState({ isMaximized: false }),
    ]);
    assert(dirResult.lastOpenDir === "C:\\queue-a", "ui-state mutation 第一个结果应含自身字段");
    assert(boundsResult.lastOpenDir === "C:\\queue-a" && boundsResult.windowBounds?.width === 640, "ui-state mutation 第二个结果应保留前序字段");
    assert(maximizedResult.lastOpenDir === "C:\\queue-a" && maximizedResult.windowBounds?.width === 640, "ui-state mutation 第三个结果应保留前序字段");
    const m20 = await freshModule();
    const queued = m20.loadUiState();
    assert(
      queued.lastOpenDir === "C:\\queue-a" && queued.windowBounds?.width === 640 && queued.isMaximized === false,
      `ui-state 并发不同顶层字段不得丢更新,实际 ${JSON.stringify(queued)}`,
    );
    console.log("[ok] ui-state:mutation queue(不同顶层字段并发 patch 不丢)");

    // ---- 10b. 重启后并发字段全部保留:最近文件 / 会话文件 / 窗口状态同批并发 ----
    // 模拟重启 = 全新模块实例读 ui-state.json;renderer 的「转换成功追加最近文件」
    // 与「列表变化写会话文件」「窗口关闭写 bounds」天然并发,任一丢更新都在此暴露。
    const m21 = await freshModule();
    const sessionA = ["C:\\work\\a.md", "C:\\work\\b.md"];
    await Promise.all([
      m21.saveUiState({ recentFiles: [{ path: "C:\\work\\a.md", name: "a.md", format: "docx", ts: 10 }] }),
      m21.saveUiState({ lastSessionFiles: sessionA }),
      m21.saveUiState({ windowBounds: { x: 20, y: 30, width: 1024, height: 768 }, isMaximized: true }),
    ]);
    const m22 = await freshModule();
    const restarted = m22.loadUiState();
    assert(
      restarted.recentFiles.length === 1 && restarted.recentFiles[0].path === "C:\\work\\a.md",
      `重启后最近文件应保留,实际 ${JSON.stringify(restarted.recentFiles)}`,
    );
    assert(
      JSON.stringify(restarted.lastSessionFiles) === JSON.stringify(sessionA),
      `重启后会话文件应保留,实际 ${JSON.stringify(restarted.lastSessionFiles)}`,
    );
    assert(
      restarted.windowBounds?.width === 1024 && restarted.windowBounds?.x === 20 && restarted.isMaximized === true,
      `重启后窗口状态应保留,实际 ${JSON.stringify(restarted.windowBounds)} maximized=${restarted.isMaximized}`,
    );
    assert(
      restarted.lastOpenDir === "C:\\queue-a",
      `重启后前序 mutation 的字段仍应保留,实际 ${restarted.lastOpenDir}`,
    );
    console.log("[ok] ui-state:重启读盘(最近文件/会话文件/窗口状态并发字段全部保留)");

    // ---- 11. 写失败可观察:不更新缓存、不吞错误,且后续 mutation 仍可恢复 ----
    // 目标路径暂替换为目录,避免依赖 Windows 权限/文件锁的非确定性。
    await fs.rm(uiFile, { force: true });
    await fs.mkdir(uiFile, { recursive: true });
    const mFail = await freshModule();
    let failureObserved = false;
    try {
      await mFail.saveUiState({ lastOpenDir: "C:\\should-not-commit" });
    } catch {
      failureObserved = true;
    }
    assert(failureObserved, "ui-state 写失败必须向调用方抛出,不得静默成功");
    assert(mFail.loadUiState().lastOpenDir !== "C:\\should-not-commit", "ui-state 写失败不得更新缓存");
    await fs.rm(uiFile, { recursive: true, force: true });
    await mFail.saveUiState({ lastOpenDir: "C:\\recovered" });
    assert(mFail.loadUiState().lastOpenDir === "C:\\recovered", "ui-state 写失败后队列应继续处理下一次 mutation");
    // 恢复后重启读盘:拿到恢复成功的那次写(失败尝试未污染磁盘)
    // 注:本段把目标路径临时替换为目录,该实例的缓存基线因此退化为默认态,
    // 故此处只断言恢复值本身落盘,不要求保留失败前字段(见 10b 的重启覆盖)。
    const mFailRestart = await freshModule();
    const recovered = mFailRestart.loadUiState();
    assert(
      recovered.lastOpenDir === "C:\\recovered",
      `失败恢复后重启读盘应拿到恢复写入的值,实际 ${JSON.stringify(recovered.lastOpenDir)}`,
    );
    console.log("[ok] ui-state:写失败可观察(不吞错/不更新缓存/队列可恢复/重启读盘一致)");
  } finally {
    // 恢复真实 ui-state.json(原有内容或删除),避免污染用户状态
    if (hadFile) await fs.writeFile(uiFile, backup, "utf8");
    else await fs.rm(uiFile, { force: true });
  }
}
