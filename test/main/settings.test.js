// @ts-check
/**
 * 设置持久化测试(src/main/persist/settings.ts 纯逻辑层;测试经 dist/main/persist/settings.js,未改动实现):
 * 实现事实(读源码确认):
 * - sanitizePageSetup:边距钳制 Math.min(1000, Math.max(0, v))(MARGIN_MIN_MM=0 / MAX=1000),
 *   非有限数(NaN/Infinity/非 number)→ 当前 pageSetup 对应值;paper/orientation
 *   枚举外值 → fallback 对应值;纸张/方向下内容区不足时按上/下、左/右
 *   固定次序执行最小溢出修正，并输出迁移 warning
 * - sanitizeTypography:bodySizePt 8-24、lineSpacing 1.0-2.5 范围校验,越界 → DEFAULT_TYPOGRAPHY
 *   值;字体须非空字符串、布尔字段须 boolean、align 枚举(left/justify);整块兜底,
 *   始终返回合法完整对象
 * - sanitizePatch:仅 SETTING_KEYS 白名单(version/format/pageSetup/typography/breakBeforeH1/
 *   toc/equationNumbering/afterConvert/outputDir/customPresets/pdfCss/language/theme/headerFooter),未知键过滤;非法值回退默认
 * - sanitizeCustomPresets:非数组 → [];条目须对象且 name 非空;
 *   typography 逐字段钳制、pageSetup 非法对象整条丢弃;同名去重(保留先出现);
 *   截断 MAX_CUSTOM_PRESETS=10
 * - loadSettings:JSON parse 失败 / 非 pageSetup 形状非法(isValidSettings)→ 返回 DEFAULT_SETTINGS 引用
 *   (静默不写盘);pageSetup 非法只迁移该块并保留其它字段;旧文件(缺 toc/outputDir/typography)
 *   → 其余字段保留 + 兜底默认,不崩溃
 * - settingsFilePath = app.getPath("userData")/settings.json(无注入点)→ 测试备份真实文件、
 *   finally 恢复;模块级 settingsCache 惰性缓存 → 每场景用 query-string 动态 import 取
 *   全新模块实例(实证:Node ESM 同文件不同 query = 独立实例,缓存按 URL 键;
 *   备份/全新实例样板已迁移 test/common/settings.js 公共助手)
 * - sanitizePageSetup/sanitizeTypography/sanitizePatch 均未导出 → 经 updateSettings 公开
 *   路径断言(patch 合并 + sanitize + 持久化 + 返回 next)
 * - isValidSettings:整文件形状校验纯函数直测——任一字段非法
 *   (如 marginTop:"abc")→ false(loadSettings 据此整体回退 DEFAULT_SETTINGS 引用);
 *   合法完整对象 → true(合法值保留)
 * - saveSettings 写队列(promise 链):并发调用串行执行,调用序 = 写盘序,链尾即最终态
 *   (防并发交错写同一 tmp 文件丢更新;失败不截断队列,错误由各自调用方处理)
 * - mutation queue:「读当前值 → 合并 patch → 落盘 → 提交缓存」在同一队列内,
 *   并发不同字段 patch 互不覆盖;写失败不提交缓存(内存/磁盘停在最后一次成功值),
 *   恢复写入后全新实例(重启)读盘逐字段一致
 */
import fs from "node:fs/promises";
import { mkdirSync, rmSync } from "node:fs";
import { app } from "electron";
import {
  DEFAULT_PAGE_SETUP,
  validatePageSetup,
} from "../../dist/core/settings/settings-defaults.js";
import { DEFAULT_TYPOGRAPHY } from "../../dist/core/settings/typography.js";
import { backupSettingsFile, freshSettingsModule, settingsJsonPath } from "../common/settings.js";

/**
 * 形状校验夹具(合法完整对象):「可缺字段」声明为可选——旧文件兼容用例经 delete
 * 去掉这些键来模拟旧档;取值声明为 unknown,因为同组用例也刻意塞非法值断言整文件拒绝。
 */
 /** @typedef {{
 *   version: number,
 *   format: string,
 *   afterConvert: string,
 *   breakBeforeH1: boolean,
 *   toc?: unknown,
 *   outputDir?: unknown,
 *   equationNumbering?: unknown,
 *   pdfCss?: unknown,
 *   language?: unknown,
 *   theme?: unknown,
 *   pageSetup: {
 *     paper: string,
 *     orientation: string,
 *     marginTop: number,
 *     marginBottom: number,
 *     marginLeft: number,
 *     marginRight: number,
 *   },
 * }} ValidSettingsFixture */

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`settings 断言失败:${msg}`);
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const settingsFile = settingsJsonPath();
  // 备份真实 settings.json(如有),finally 恢复(settings.ts 无注入点,只能读写真实路径;公共助手)
  const { restore } = await backupSettingsFile();
  /**
   * 取全新 settings 模块实例(动态 import 绕开模块级缓存)。
   * @param {string} [tag] query 标签(仅排障可读性,实例唯一性由公共 helper 内部序号保证)
   * @returns {Promise<typeof import("../../dist/main/persist/settings.js")>} 模块实例
   */
  const freshModule = (tag = "settings") => freshSettingsModule(tag);
  try {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const mod = await freshModule();

    // ---- 1. sanitizePageSetup 数值钳制:0 边界保留、负值/超限钳回;非法枚举回退 ----
    const r1 = await mod.updateSettings({
      pageSetup: {
        marginTop: -5, marginBottom: 0, marginLeft: 301, marginRight: 300,
        paper: "B5", orientation: "reverse",
      },
    });
    assert(r1.pageSetup.marginTop === 0, "边距 -5 应钳制到 0");
    assert(r1.pageSetup.marginBottom === 0, "边距 0 边界应保留");
    assert(r1.pageSetup.marginLeft === 0, "A4 横向双边超限时不应无谓保留左边距");
    assert(r1.pageSetup.marginRight === 209, "A4 横向内容区不足时右边距应吸收剩余溢出");
    validatePageSetup(r1.pageSetup);
    assert(r1.pageSetup.paper === DEFAULT_PAGE_SETUP.paper, "paper 枚举外值(B5)应回退默认");
    assert(r1.pageSetup.orientation === DEFAULT_PAGE_SETUP.orientation, "orientation 枚举外值应回退默认");

    // ---- 2. sanitizePageSetup 非数回退默认；几何非法值确定性收缩并 warning ----
    const r2 = await mod.updateSettings({
      pageSetup: { marginTop: 0, marginBottom: 300, marginLeft: NaN, marginRight: -999 },
    });
    assert(r2.pageSetup.marginTop === 0, "0 边界保留");
    assert(r2.pageSetup.marginBottom === 296, "A4 下边距 300 应确定性收缩至内容区 1mm");
    assert(r2.pageSetup.marginLeft === r1.pageSetup.marginLeft, "NaN 应回退当前 pageSetup 左边距");
    assert(r2.pageSetup.marginRight === 0, "-999 应钳制到 0");
    validatePageSetup(r2.pageSetup);
    const r2PartialBase = await mod.updateSettings({
      pageSetup: { marginTop: 11, marginBottom: 12, marginLeft: 13, marginRight: 14 },
    });
    const r2Partial = await mod.updateSettings({ pageSetup: { paper: "A5" } });
    assert(
      r2Partial.pageSetup.marginTop === r2PartialBase.pageSetup.marginTop &&
        r2Partial.pageSetup.marginBottom === r2PartialBase.pageSetup.marginBottom &&
        r2Partial.pageSetup.marginLeft === r2PartialBase.pageSetup.marginLeft &&
        r2Partial.pageSetup.marginRight === r2PartialBase.pageSetup.marginRight,
      "partial pageSetup patch 应基于当前值合并，不得重置未提供边距",
    );
    assert(r2Partial.pageSetup.paper === "A5", "partial pageSetup patch 应应用已提供纸张");
    validatePageSetup(r2Partial.pageSetup);

    const geometryWarnings = /** @type {string[]} */ ([]);
    const originalWarn = console.warn;
    console.warn = (...args) => geometryWarnings.push(args.join(" "));
    let r2Geometry;
    try {
      r2Geometry = await mod.updateSettings({
        pageSetup: { ...DEFAULT_PAGE_SETUP, marginBottom: 1000 },
      });
    } finally {
      console.warn = originalWarn;
    }
    assert(
      r2Geometry.pageSetup.marginTop === 0 && r2Geometry.pageSetup.marginBottom === 296,
      "A4 下边距 1000 应迁移为下 0 / 上 0 / 下 296(内容区保留 1mm)",
    );
    validatePageSetup(r2Geometry.pageSetup);
    assert(
      geometryWarnings.some((message) => message.includes("pageSetup") && message.includes("自动修正")),
      "几何非法 pageSetup 的 update 应输出明确迁移 warning",
    );

    // ---- 3. sanitizeTypography 字号/行距边界值与越界值 ----
    const r3 = await mod.updateSettings({ typography: { bodySizePt: 8, lineSpacing: 1.0 } });
    assert(r3.typography.bodySizePt === 8, "bodySizePt 8 边界应保留");
    assert(r3.typography.lineSpacing === 1.0, "lineSpacing 1.0 边界应保留");
    const r4 = await mod.updateSettings({ typography: { bodySizePt: 24, lineSpacing: 2.5 } });
    assert(r4.typography.bodySizePt === 24, "bodySizePt 24 边界应保留");
    assert(r4.typography.lineSpacing === 2.5, "lineSpacing 2.5 边界应保留");
    const r5 = await mod.updateSettings({
      typography: { bodySizePt: 7.9, lineSpacing: 0.9, fontAscii: "", align: "right" },
    });
    assert(r5.typography.bodySizePt === DEFAULT_TYPOGRAPHY.bodySizePt, "bodySizePt 7.9 越界应回退默认");
    assert(r5.typography.lineSpacing === DEFAULT_TYPOGRAPHY.lineSpacing, "lineSpacing 0.9 越界应回退默认");
    assert(r5.typography.fontAscii === DEFAULT_TYPOGRAPHY.fontAscii, "空字体应回退默认");
    assert(r5.typography.align === DEFAULT_TYPOGRAPHY.align, "align 枚举外值(right)应回退默认");
    const r6 = await mod.updateSettings({
      typography: {
        bodySizePt: 24.1, lineSpacing: 2.6, fontEastAsia: "宋体",
        firstLineIndent: false, headingNumbering: false,
      },
    });
    assert(r6.typography.bodySizePt === DEFAULT_TYPOGRAPHY.bodySizePt, "bodySizePt 24.1 越界应回退默认");
    assert(r6.typography.lineSpacing === DEFAULT_TYPOGRAPHY.lineSpacing, "lineSpacing 2.6 越界应回退默认");
    assert(r6.typography.fontEastAsia === "宋体", "非空字体应保留");
    assert(r6.typography.firstLineIndent === false, "布尔字段应保留");
    assert(r6.typography.headingNumbering === false, "布尔字段应保留");

    // ---- 4. 非法枚举/类型回退(format/afterConvert/version/breakBeforeH1) ----
    const r7 = await mod.updateSettings({
      format: "html", afterConvert: "email", version: 2, breakBeforeH1: "yes",
    });
    assert(r7.format === "docx", "format 枚举外值(html)应回退默认 docx");
    assert(r7.afterConvert === "none", "afterConvert 枚举外值应回退默认 none");
    assert(r7.version === 1, "version 非 1 应回退 1");
    assert(r7.breakBeforeH1 === false, "breakBeforeH1 非布尔应回退默认");
    const r8 = await mod.updateSettings({ format: "pdf", afterConvert: "open", breakBeforeH1: true, toc: false, equationNumbering: false });
    assert(r8.format === "pdf" && r8.afterConvert === "open", "合法枚举应保留");
    assert(r8.breakBeforeH1 === true && r8.toc === false, "合法布尔应保留");
    assert(r8.equationNumbering === false, "合法布尔(equationNumbering)应保留");
    const r8b = await mod.updateSettings({ tocMode: "field" });
    assert(r8b.tocMode === "field", "合法 tocMode(field)应保留");
    const r8c = await mod.updateSettings({ tocMode: "bogus" });
    assert(r8c.tocMode === "static", "非法 tocMode 应回退默认 static");

    // ---- 5. sanitizePatch 白名单:未知键过滤 + SETTING_KEYS 键核对 ----
    const r9 = await mod.updateSettings({ evil: "x", xss: 1, format: "pdf" });
    assert(!("evil" in r9) && !("xss" in r9), "白名单外键应被过滤(不写入)");
    assert(r9.format === "pdf", "白名单内键应正常生效");
    const settingKeys = ["version", "format", "pageSetup", "typography", "breakBeforeH1", "toc", "tocMode", "equationNumbering", "afterConvert", "outputDir", "customPresets", "pdfCss", "language", "theme", "headerFooter", "watermark", "aiCleanup", "obsidianCompat", "obsidianAttachmentFolder"];
    assert(Object.keys(mod.DEFAULT_SETTINGS).length === settingKeys.length, "DEFAULT_SETTINGS 应为 19 键(F4 headerFooter + F5 watermark + F7 tocMode + B1 aiCleanup + C1 obsidianCompat/obsidianAttachmentFolder)");
    for (const k of settingKeys) assert(k in mod.DEFAULT_SETTINGS, `DEFAULT_SETTINGS 缺少键 ${k}`);
    // 持久化文件同样不含未知键
    const persisted = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    assert(!("evil" in persisted) && !("xss" in persisted), "写盘内容不应含白名单外键");

    // ---- 5b. pdfCss:合法 string 保留 / 非 string 回退默认空串 ----
    const r9b = await mod.updateSettings({ pdfCss: "body { color: red; }" });
    assert(r9b.pdfCss === "body { color: red; }", "pdfCss 合法 string 应保留");
    const r9c = await mod.updateSettings({ pdfCss: 123 });
    assert(r9c.pdfCss === "", "pdfCss 非 string 应回退默认空串");
    const r9d = await mod.updateSettings({ pdfCss: "" });
    assert(r9d.pdfCss === "", "pdfCss 空串应保留(清除语义)");

    // ---- 5c. theme:合法枚举保留 / 枚举外回退默认 system ----
    const r9e = await mod.updateSettings({ theme: "dark" });
    assert(r9e.theme === "dark", "theme 合法值(dark)应保留");
    const r9f = await mod.updateSettings({ theme: "light" });
    assert(r9f.theme === "light", "theme 合法值(light)应保留");
    const r9g = await mod.updateSettings({ theme: "blue" });
    assert(r9g.theme === "system", "theme 枚举外值(blue)应回退默认 system");
    const r9h = await mod.updateSettings({ theme: 123 });
    assert(r9h.theme === "system", "theme 非字符串应回退默认 system");

    // ---- 6. 损坏 settings.json(JSON parse 失败)→ DEFAULT_SETTINGS,静默不写盘 ----
    await fs.writeFile(settingsFile, "{broken json!!", "utf8");
    const m1 = await freshModule();
    const s1 = m1.loadSettings();
    assert(s1 === m1.DEFAULT_SETTINGS, "JSON 解析失败应返回 DEFAULT_SETTINGS 引用");
    assert(s1.format === "docx" && s1.pageSetup.paper === "A4", "损坏文件应回退默认值");
    assert(
      (await fs.readFile(settingsFile, "utf8")) === "{broken json!!",
      "损坏文件不应被重写(静默不写盘)",
    );

    // ---- 7. 形状非法(合法 JSON 但字段非法)→ 默认 ----
    await fs.writeFile(
      settingsFile,
      JSON.stringify({ version: 9, format: "exe", pageSetup: { paper: "B0" } }),
      "utf8",
    );
    const m2 = await freshModule();
    const s2 = m2.loadSettings();
    assert(s2 === m2.DEFAULT_SETTINGS, "形状非法应返回 DEFAULT_SETTINGS 引用");
    assert(s2.version === 1 && s2.pageSetup.paper === "A4", "形状非法应回退默认值");

    // ---- 7b. 非法 pageSetup 只迁移该块，其它旧设置保留；结构化 migration 交给 renderer ----
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        version: 1, format: "pdf", afterConvert: "open", breakBeforeH1: true,
        pageSetup: { paper: "B5", orientation: "sideways", marginTop: "abc", marginBottom: 1000, marginLeft: 30, marginRight: 40 },
      }),
      "utf8",
    );
    const m2b = await freshModule("settings-page-migration");
    const s2b = m2b.loadSettings();
    assert(s2b !== m2b.DEFAULT_SETTINGS, "非法 pageSetup 应进入字段迁移而非整文件默认引用");
    assert(s2b.format === "pdf" && s2b.afterConvert === "open" && s2b.breakBeforeH1, "非法 pageSetup 迁移不得丢弃其它设置");
    assert(
      s2b.pageSetup.paper === DEFAULT_PAGE_SETUP.paper &&
        s2b.pageSetup.orientation === DEFAULT_PAGE_SETUP.orientation &&
        s2b.pageSetup.marginTop === 0 &&
        s2b.pageSetup.marginBottom === 296,
      `非法 pageSetup 纠正结果异常:${JSON.stringify(s2b.pageSetup)}`,
    );
    assert(
      s2b.migration?.kind === "page-setup-correction" &&
        s2b.migration.persistence === "scheduled" &&
        s2b.migration.message.includes("页面"),
      "loadSettings 应返回结构化 migration 供 renderer 显示 warning",
    );
    validatePageSetup(s2b.pageSetup);
    // 等迁移写**结算**,而不是「等够久再放弃」:loadSettings 的迁移写是 fire-and-forget,
    // 固定预算的轮询在慢机上到点放弃后,写仍可能迟到落盘并覆盖下一小节写入的内容
    // (曾表现为下一小节读到陈旧设置)。drain 是确定性的:它 resolve 即代表队列已排空。
    await m2b.whenSettingsIdle();
    const migratedDisk = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    assert(
      migratedDisk.pageSetup?.paper === "A4" && migratedDisk.pageSetup?.marginBottom === 296 && !migratedDisk.migration,
      "load 迁移的合法 pageSetup 应可靠固化，且瞬时 migration 不写入 settings.json",
    );
    // committed 标志由写盘的 onCommitted 回调同步置位,而上面的 drain 已保证写结算,
    // 故此处无需再轮询等待。
    assert(
      m2b.loadSettings().migration?.persistence === "committed",
      "迁移写成功后 cache 中的 migration 状态必须为 committed",
    );
    assert(
      JSON.stringify(m2b.loadSettings().pageSetup) === JSON.stringify(migratedDisk.pageSetup),
      "迁移写成功后 cache pageSetup 必须与磁盘一致",
    );

    // 迁移写任务必须先入队，后续 update 只能在其后提交，不能被旧迁移快照覆盖。
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        version: 1, format: "pdf", afterConvert: "none", breakBeforeH1: false,
        pageSetup: { paper: "A4", orientation: "portrait", marginTop: 150, marginBottom: 200, marginLeft: 10, marginRight: 10 },
      }),
      "utf8",
    );
    const mQueue = await freshModule("settings-migration-queue");
    mQueue.loadSettings();
    const queuedUpdate = await mQueue.updateSettings({ format: "docx", toc: false });
    const queuedDisk = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    assert(
      queuedUpdate.format === "docx" && queuedUpdate.toc === false &&
        queuedDisk.format === "docx" && queuedDisk.toc === false,
      "迁移后的后续 update 不得被旧迁移快照覆盖",
    );
    assert(
      queuedUpdate.pageSetup.marginTop === 96 && queuedUpdate.pageSetup.marginBottom === 200,
      "迁移与后续 update 队列应保留最小溢出修正结果",
    );
    assert(
      mQueue.loadSettings().migration === undefined &&
        JSON.stringify(mQueue.loadSettings().pageSetup) === JSON.stringify(queuedDisk.pageSetup),
      "迁移队列提交后 cache 状态与磁盘 pageSetup 应一致",
    );

    // 迁移写失败时状态必须落为 failed，不能让 cache 永远停留在 scheduled。
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        version: 1, format: "docx", afterConvert: "none", breakBeforeH1: false,
        pageSetup: { paper: "A4", orientation: "portrait", marginTop: 0, marginBottom: 1000, marginLeft: 10, marginRight: 10 },
      }),
      "utf8",
    );
    const mMigrationFailure = await freshModule("settings-migration-failure");
    mMigrationFailure.loadSettings();
    rmSync(settingsFile, { force: true });
    mkdirSync(settingsFile);
    // 排空后该次写已结算(失败也在 catch 里置位),无需轮询。
    await mMigrationFailure.whenSettingsIdle();
    assert(
      mMigrationFailure.loadSettings().migration?.persistence === "failed",
      "迁移写失败时 cache 必须记录 failed 状态",
    );
    rmSync(settingsFile, { recursive: true, force: true });
    console.log("[ok] settings:非法 pageSetup 字段迁移/其它设置保留/结构化 warning/固化/队列状态断言通过");

    // ---- 7c. isValidSettings 直测(导出纯函数,不依赖磁盘 IO) ----
    // 依据(dist/main/persist/settings.ts isValidSettings):整文件形状校验——任一字段非法
    // → false(loadSettings 据此整体回退 DEFAULT_SETTINGS 引用);合法完整对象 → true。
    // typography/customPresets 不参与形状校验(loadSettings 单独 sanitize)。
    const validSettings = /** @type {ValidSettingsFixture} */ ({
      version: 1, format: "pdf", afterConvert: "open", breakBeforeH1: true, toc: false,
      outputDir: "C:\\tmp\\out",
      pageSetup: { paper: "Letter", orientation: "landscape", marginTop: 12.5, marginBottom: 20, marginLeft: 30, marginRight: 40 },
    });
    assert(mod.isValidSettings(validSettings) === true, "合法完整对象应通过形状校验(合法值保留)");
    // 旧文件兼容:缺 toc/outputDir 视为合法(loadSettings 兜底)
    const legacySettings = { ...validSettings };
    delete legacySettings.toc;
    delete legacySettings.outputDir;
    assert(mod.isValidSettings(legacySettings) === true, "缺 toc/outputDir 的旧文件应通过形状校验");
    // equationNumbering 缺失(旧文件)视为合法,存在则须为布尔
    const legacyNoEq = { ...validSettings };
    delete legacyNoEq.equationNumbering;
    assert(mod.isValidSettings(legacyNoEq) === true, "缺 equationNumbering 的旧文件应通过形状校验");
    // pdfCss 缺失(旧文件)视为合法,存在则须为 string
    const legacyNoPdfCss = { ...validSettings };
    delete legacyNoPdfCss.pdfCss;
    assert(mod.isValidSettings(legacyNoPdfCss) === true, "缺 pdfCss 的旧文件应通过形状校验");
    // language 缺失(旧文件)视为合法;非法/未注册值亦不整文件拒绝
    // (语言裁撤迁移:ko/fr/ru 用户字段级兜底 zh,其余偏好保留),见 loadSettings
    const legacyNoLang = { ...validSettings };
    delete legacyNoLang.language;
    assert(mod.isValidSettings(legacyNoLang) === true, "缺 language 的旧文件应通过形状校验");
    // theme 缺失(旧文件)视为合法,存在则须为 system/light/dark
    const legacyNoTheme = { ...validSettings };
    delete legacyNoTheme.theme;
    assert(mod.isValidSettings(legacyNoTheme) === true, "缺 theme 的旧文件应通过形状校验");
    assert(mod.isValidSettings({ ...validSettings, theme: "dark" }) === true, "theme dark 应通过形状校验");
    assert(mod.isValidSettings({ ...validSettings, theme: "system" }) === true, "theme system 应通过形状校验");
    assert(mod.isValidSettings({ ...validSettings, language: "zh" }) === true, "language zh 应通过形状校验");
    assert(mod.isValidSettings({ ...validSettings, language: "en" }) === true, "language en 应通过形状校验");
    // 任一字段非法 → false(整文件回退语义)
    const invalidCases = [
      [{ ...validSettings, format: "html" }, "format 枚举外值"],
      [{ ...validSettings, version: 2 }, "version 非 1"],
      [{ ...validSettings, breakBeforeH1: "yes" }, "breakBeforeH1 非布尔"],
      [{ ...validSettings, equationNumbering: "yes" }, "equationNumbering 非布尔"],
      [{ ...validSettings, pdfCss: 123 }, "pdfCss 非 string"],
      [{ ...validSettings, theme: "blue" }, "theme 枚举外值"],
      [{ ...validSettings, afterConvert: "email" }, "afterConvert 枚举外值"],
    ];
    // pageSetup 非法不参与整文件形状拒绝，交由 loadSettings 的字段迁移契约处理。
    assert(mod.isValidSettings({ ...validSettings, pageSetup: { ...validSettings.pageSetup, paper: "B5" } }) === true, "非法 paper 应允许进入 pageSetup 迁移");
    assert(mod.isValidSettings({ ...validSettings, pageSetup: { ...validSettings.pageSetup, marginTop: "abc" } }) === true, "非法边距类型应允许进入 pageSetup 迁移");
    assert(mod.isValidSettings({ ...validSettings, pageSetup: null }) === true, "pageSetup 缺失/非法形状应允许进入 pageSetup 迁移");
    for (const [bad, label] of invalidCases) {
      assert(mod.isValidSettings(bad) === false, `${label} 应判定形状非法(整文件回退)`);
    }
    console.log("[ok] settings:isValidSettings 直测(合法保留/旧文件兼容/任一非法整文件回退)断言通过");

    // ---- 8. 旧 settings.json 兼容(缺 toc/outputDir/typography)→ 其余保留 + 兜底默认 ----
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        version: 1, format: "pdf", afterConvert: "open", breakBeforeH1: true,
        pageSetup: { paper: "A3", orientation: "landscape", marginTop: 10, marginBottom: 20, marginLeft: 30, marginRight: 40 },
      }),
      "utf8",
    );
    const m3 = await freshModule();
    const s3 = m3.loadSettings();
    assert(s3.format === "pdf" && s3.afterConvert === "open" && s3.breakBeforeH1 === true, "旧文件既有字段应保留");
    assert(s3.pageSetup.paper === "A3" && s3.pageSetup.orientation === "landscape", "旧文件 pageSetup 应保留");
    assert(
      s3.pageSetup.marginTop === 10 && s3.pageSetup.marginBottom === 20 &&
      s3.pageSetup.marginLeft === 30 && s3.pageSetup.marginRight === 40,
      "旧文件边距应保留",
    );
    assert(s3.toc === true, "旧文件缺 toc → 兜底 true");
    assert(s3.equationNumbering === true, "旧文件缺 equationNumbering → 兜底 true");
    assert(s3.outputDir === "", "旧文件缺 outputDir → 兜底空串");
    assert(s3.pdfCss === "", "旧文件缺 pdfCss → 兜底空串");
    assert(s3.language === "zh", "旧文件缺 language → 兜底 zh");
    assert(s3.theme === "system", "旧文件缺 theme → 兜底 system(B13)");
    assert(
      JSON.stringify(s3.customPresets) === "[]",
      "旧文件缺 customPresets → 兜底空数组",
    );
    assert(
      s3.typography.bodySizePt === DEFAULT_TYPOGRAPHY.bodySizePt &&
      s3.typography.lineSpacing === DEFAULT_TYPOGRAPHY.lineSpacing,
      "旧文件缺 typography → 整块默认",
    );

    // ---- 8b. 旧文件含几何非法边距:保留其余设置，确定性迁移 pageSetup 并 warning ----
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        version: 1, format: "pdf", afterConvert: "open", breakBeforeH1: true,
        pageSetup: { paper: "A4", orientation: "portrait", marginTop: 1000, marginBottom: 0, marginLeft: 30, marginRight: 40 },
      }),
      "utf8",
    );
    const loadGeometryWarnings = /** @type {string[]} */ ([]);
    const originalLoadWarn = console.warn;
    console.warn = (...args) => loadGeometryWarnings.push(args.join(" "));
    let mGeometry;
    try {
      mGeometry = await freshModule("settings-geometry-load");
      const sGeometry = mGeometry.loadSettings();
      assert(sGeometry.format === "pdf" && sGeometry.afterConvert === "open", "几何迁移不应丢弃其它旧设置");
      assert(
        sGeometry.pageSetup.marginTop === 296 && sGeometry.pageSetup.marginBottom === 0,
        `旧文件几何迁移结果异常:${JSON.stringify(sGeometry.pageSetup)}`,
      );
      validatePageSetup(sGeometry.pageSetup);
    } finally {
      console.warn = originalLoadWarn;
    }
    assert(
      loadGeometryWarnings.some((message) => message.includes("pageSetup") && message.includes("自动修正")),
      "loadSettings 迁移几何非法旧设置时应输出 warning",
    );
    // 排空后再让下一小节覆写文件:这一处原本是「最多等 100ms」的轮询,慢机上到点放弃后
    // 迁移写会迟到落盘、覆盖下一小节刚写入的合法设置(曾表现为下一小节读到陈旧内容判红)。
    await mGeometry.whenSettingsIdle();

    // ---- 9. 合法完整文件:原样读取(含 0 边界边距与 typography 全字段) ----
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        version: 1, format: "pdf", afterConvert: "open", breakBeforeH1: true, toc: false, equationNumbering: false, outputDir: "C:\\tmp\\out",
        pageSetup: { paper: "Letter", orientation: "landscape", marginTop: 0, marginBottom: 200, marginLeft: 50, marginRight: 50 },
        typography: { fontAscii: "Arial", fontEastAsia: "宋体", bodySizePt: 14, lineSpacing: 2.0, firstLineIndent: false, align: "left", headingNumbering: false, captionNumbering: false },
        pdfCss: "body { color: red; }",
        language: "en",
        theme: "dark",
        customPresets: [
          { name: "存档模板", typography: { fontAscii: "Arial", fontEastAsia: "宋体", bodySizePt: 14, lineSpacing: 2.0, firstLineIndent: false, align: "left", headingNumbering: false, captionNumbering: false }, pageSetup: { paper: "Letter", orientation: "landscape", marginTop: 0, marginBottom: 200, marginLeft: 50, marginRight: 50 } },
        ],
      }),
      "utf8",
    );
    const m4 = await freshModule();
    const s4 = m4.loadSettings();
    assert(s4.format === "pdf" && s4.toc === false, "合法文件字段应原样读取");
    assert(s4.equationNumbering === false, "合法文件 equationNumbering 应原样读取");
    assert(s4.outputDir === "C:\\tmp\\out", "绝对路径 outputDir 应保留");
    assert(s4.pdfCss === "body { color: red; }", "合法文件 pdfCss 应原样读取");
    assert(s4.language === "en", "合法文件 language 应原样读取");
    assert(s4.theme === "dark", "合法文件 theme 应原样读取(B13)");
    assert(s4.pageSetup.marginTop === 0 && s4.pageSetup.marginBottom === 200, "合法文件 0 边界与合法边距应保留");
    assert(
      s4.typography.bodySizePt === 14 && s4.typography.align === "left" && s4.typography.fontEastAsia === "宋体",
      "合法 typography 应保留",
    );
    assert(
      s4.customPresets.length === 1 && s4.customPresets[0].name === "存档模板" &&
      s4.customPresets[0].typography.bodySizePt === 14 && s4.customPresets[0].pageSetup.marginBottom === 200,
      "合法 customPresets 应原样读取(名称/typography/pageSetup 保留)",
    );

    // ---- 10. saveSettings 写队列串行化:并发 updateSettings 不交错、不丢更新 ----
    // saveSettings 经 promise 链串行(write tmp + rename 原子段不插入其它写);
    // 并发调用全部成功,最终落盘 = 最后一次调用的完整状态(调用序 = 写盘序,
    // next 在调用时同步计算合并当时缓存,语义不变),无残留 .tmp。
    const [rA, rB, rC, rD] = await Promise.all([
      mod.updateSettings({ format: "pdf", toc: true, breakBeforeH1: true }),
      mod.updateSettings({ format: "docx", afterConvert: "open" }),
      mod.updateSettings({ pageSetup: { marginTop: 12.5, marginBottom: 20, marginLeft: 30, marginRight: 40 } }),
      mod.updateSettings({ typography: { bodySizePt: 13 } }),
    ]);
    // 每个调用返回各自合并结果(调用间互不吞并)
    assert(rA.format === "pdf" && rA.toc === true && rA.breakBeforeH1 === true, "并发调用 1 应返回自身合并结果");
    assert(rB.format === "docx" && rB.afterConvert === "open" && rB.toc === true, "并发调用 2 应读到调用 1 已提交字段");
    assert(rC.pageSetup.marginTop === 12.5 && rC.afterConvert === "open" && rC.toc === true, "并发调用 3 应保留前序字段");
    assert(rD.typography.bodySizePt === 13 && rD.format === "docx" && rD.afterConvert === "open", "并发调用 4 应保留前序字段");
    // 最终落盘 = 最后一次调用返回的完整状态(完整相等,不交错/不丢字段)
    const final = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    assert(
      JSON.stringify(final) === JSON.stringify(rD),
      "最终落盘应等于最后一次调用返回的完整状态(并发不交错/不丢更新)",
    );
    assert(
      JSON.stringify(mod.loadSettings()) === JSON.stringify(rD),
      "缓存应与最终落盘一致(链尾即最终态)",
    );
    let tmpLeft = true;
    try {
      await fs.access(settingsFile + ".tmp");
    } catch {
      tmpLeft = false;
    }
    assert(!tmpLeft, "写队列完成后不应残留 .tmp 临时文件");

    // ---- 10a. 重启后并发字段全部保留:全新模块实例(读盘)逐字段复核 ----
    // 模拟重启 = 丢弃内存缓存的全新实例读 settings.json:并发 patch 的每个字段
    // 都必须落盘保留(丢更新在这里才暴露),且与缓存终态一致。
    const mRestart = await freshModule();
    const restarted = mRestart.loadSettings();
    assert(
      restarted.format === "docx" && restarted.afterConvert === "open" && restarted.toc === true &&
      restarted.breakBeforeH1 === true,
      `重启后并发字段应全部保留,实际 ${JSON.stringify({
        format: restarted.format,
        afterConvert: restarted.afterConvert,
        toc: restarted.toc,
        breakBeforeH1: restarted.breakBeforeH1,
      })}`,
    );
    assert(
      restarted.pageSetup.marginTop === 12.5 && restarted.pageSetup.marginBottom === 20 &&
      restarted.pageSetup.marginLeft === 30 && restarted.pageSetup.marginRight === 40,
      `重启后并发 patch 的 pageSetup 应保留,实际 ${JSON.stringify(restarted.pageSetup)}`,
    );
    assert(
      restarted.typography.bodySizePt === 13,
      `重启后并发 patch 的 typography 应保留,实际 ${JSON.stringify(restarted.typography)}`,
    );
    assert(
      JSON.stringify(restarted) === JSON.stringify(rD),
      "重启读回内容应与最后一次成功写盘结果完全一致(内存/磁盘一致)",
    );
    validatePageSetup(restarted.pageSetup);
    console.log("[ok] settings:重启读盘(并发不同字段全部保留,与缓存终态一致)");

    // ---- 10b. 写失败可观察:不更新缓存、不吞错误,且后续 mutation 仍可恢复 ----
    // settingsFilePath 固定走 userData/settings.json;将该目标暂时替换为目录,
    // 触发 rename 失败,不依赖平台特定的权限/锁定行为。
    await fs.rm(settingsFile, { force: true });
    await fs.mkdir(settingsFile, { recursive: true });
    const mFail = await freshModule("settings-failure");
    let failureObserved = false;
    try {
      await mFail.updateSettings({ format: "pdf" });
    } catch {
      failureObserved = true;
    }
    assert(failureObserved, "settings 写失败必须向调用方抛出,不得静默成功");
    assert(mFail.loadSettings().format !== "pdf", "settings 写失败不得更新缓存");
    await fs.rm(settingsFile, { recursive: true, force: true });
    await mFail.updateSettings({ format: "pdf" });
    assert(mFail.loadSettings().format === "pdf", "settings 写失败后队列应继续处理下一次 mutation");
    // 恢复写入后重启读盘:拿到的是恢复成功的那次写(失败尝试未污染磁盘)
    // 注:本段把目标路径临时替换为目录,该实例的缓存基线因此退化为默认态,
    // 故此处只断言恢复值本身落盘(重启字段保留见 10a)。
    const mFailRestart = await freshModule("settings-failure-restart");
    const recoveredDisk = mFailRestart.loadSettings();
    assert(
      recoveredDisk.format === "pdf",
      `失败恢复后重启读盘应拿到恢复写入的值,实际 ${recoveredDisk.format}`,
    );
    console.log("[ok] settings:写失败可观察(不吞错/不更新缓存/队列可恢复/重启读盘一致)");

console.log("[ok] settings:钳制边界/枚举回退/白名单/损坏与旧文件回退/并发写队列 断言通过");

    // ---- 11. customPresets:合法保留/非法丢弃/同名去重/上限截断/非数组回退 ----
    const r11 = await mod.updateSettings({
      customPresets: [
        { name: "我的模板", typography: { bodySizePt: 13, fontEastAsia: "宋体" }, pageSetup: { marginTop: -5, paper: "A4", orientation: "portrait", marginBottom: 20, marginLeft: 30, marginRight: 40 } },
        { name: "", typography: {}, pageSetup: {} }, // 空名称 → 丢弃
        { name: "坏数据", typography: { bodySizePt: 99 }, pageSetup: "nope" }, // pageSetup 非法 → 整条丢弃
        "not-an-object", // 非对象 → 丢弃
        { name: "我的模板", typography: { bodySizePt: 20 }, pageSetup: {} }, // 同名 → 丢弃(保留先出现)
      ],
    });
    assert(r11.customPresets.length === 1, `customPresets 应只保留 1 条合法条目,实际 ${JSON.stringify(r11.customPresets)}`);
    assert(r11.customPresets[0].name === "我的模板", "合法条目名称应保留");
    assert(r11.customPresets[0].typography.bodySizePt === 13, "合法 typography 字段应保留");
    assert(r11.customPresets[0].typography.fontEastAsia === "宋体", "部分 typography 字段应保留(缺失字段回退默认)");
    assert(r11.customPresets[0].pageSetup.marginTop === 0, "pageSetup 应经钳制(-5 → 0)");
    assert(r11.customPresets[0].pageSetup.paper === "A4", "pageSetup 枚举应保留");

    const many = [];
    for (let i = 0; i < 12; i++) many.push({ name: `p${i}`, typography: {}, pageSetup: {} });
    const r12 = await mod.updateSettings({ customPresets: many });
    assert(r12.customPresets.length === 10, `customPresets 应截断到 10,实际 ${r12.customPresets.length}`);
    assert(
      r12.customPresets[0].name === "p0" && r12.customPresets[9].name === "p9",
      "截断应保留先保存的 10 条",
    );

    const r13 = await mod.updateSettings({ customPresets: "nope" });
    assert(Array.isArray(r13.customPresets) && r13.customPresets.length === 0, "customPresets 非数组应回退 []");
    console.log("[ok] settings:customPresets 校验(合法保留/非法丢弃/同名去重/上限 10/非数组回退)断言通过");
  } finally {
    // 恢复真实 settings.json(原有内容或删除),避免污染用户设置(公共助手)
    await restore();
  }
}
