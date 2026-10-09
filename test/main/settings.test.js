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
 * - 渲染前变换两组(aiCleanup:总开关+两档,adr-021;obsidian:兼容+附件目录;adr-024 分组):
 *   键白名单 / 块内非布尔逐字段回退默认 / 落盘往返 /
 *   预设导入(只写 customPresets)不丢档位 / 旧文件缺整块字段级兜底默认
 * - 旧形状迁移(adr-024 决定要点四):旧平铺五键 → 新嵌套两块取值等值、旧键不残留
 *   且不随写盘回写、新旧同存以新键为准、新旧两形状都能读入、部分新形状逐字段兜底
 * - settingsFilePath = app.getPath("userData")/settings.json(无注入点)→ 测试备份真实文件、
 *   finally 恢复;模块级 settingsCache 惰性缓存 → 每场景用 query-string 动态 import 取
 *   全新模块实例(实证:Node ESM 同文件不同 query = 独立实例,缓存按 URL 键;
 *   备份/全新实例样板已迁移 test/harness/settings.js 公共助手)
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
import { mkdirSync } from "node:fs";
import { app } from "electron";
import {
  DEFAULT_PAGE_SETUP,
  DEFAULT_WATERMARK,
  validatePageSetup,
} from "../../dist/core/settings/settings-defaults.js";
import { DEFAULT_TYPOGRAPHY } from "../../dist/core/settings/typography.js";
import {
  CURRENT_SETTINGS_VERSION,
  LEGACY_TRANSFORM_KEYS,
  PERSISTED_KEYS,
  SETTINGS_SCHEMA,
  SHAPE_CHECKED_ENTRIES,
} from "../../dist/core/settings/schema.js";
import { backupSettingsFile, freshSettingsModule, settingsJsonPath } from "../harness/settings.js";
import { removeFile, removeTree } from "../harness/temp-resource.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

/** 设置契约(单源:core/settings/settings-defaults) */
/** @typedef {import("../../dist/core/settings/settings-defaults.js").AppSettings} AppSettings */
/** 页面设置契约 */
/** @typedef {import("../../dist/core/settings/settings-defaults.js").PageSetup} PageSetup */
/** schema 表的键联合(用于「表内不可能出现的键名」这类反向断言) */
/** @typedef {import("../../dist/core/settings/schema.js").SettingsSchemaEntry} SettingsSchemaEntry */

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

const { assert: harnessAssert } = createAsserter("settings");

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

/**
 * 越界 patch 投喂口:本段有一批用例**刻意**送非法 patch(updateSettings 的清洗面
 * 正是被测对象:枚举外值 / 非布尔 / 非字符串 / 缺字段 / 白名单外键各自回退默认)。
 * updateSettings 的声明入参是 Partial<AppSettings>(合格 patch 的类型),故这些
 * 刻意越界的字面量无法直接传入 —— 它们模拟的是「renderer 送了脏数据」这一现实,
 * 而不是一份写错了的设置。
 *
 * 故收口在此单点:入参按 unknown 收(照实描述「来路不明的 patch」),内部一次
 * cast 到被测函数的声明入参类型,返回值仍是 AppSettings(后续断言照常受类型检查)。
 * 只此一处 cast,不在各调用点散落。
 *
 * @param {{ updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings> }} mod settings 模块实例
 * @param {unknown} patch 刻意越界的 patch(非法枚举 / 错类型 / 缺字段 / 白名单外键)
 * @returns {Promise<AppSettings>} 清洗合并后的完整设置
 */
const patchDirty = (mod, patch) => mod.updateSettings(/** @type {Partial<AppSettings>} */ (patch));

/**
 * 「旧文件兼容」副本:去掉给定键模拟旧 settings.json 缺该键(逐键 delete)。
 * 显式重贴 ValidSettingsFixture 标注是必要的 —— 上游 mod.isValidSettings(validSettings)
 * 的类型守卫会把 validSettings 收窄成 AppSettings,那会把 toc/outputDir 等
 * 「可缺字段」变成必填,delete 随即判红(TS2790)。旧文件兼容用例要的正是
 * 「这些键可缺」这一形状,故在此把形状显式复位。
 *
 * @param {ValidSettingsFixture} base 完整形状夹具
 * @param {readonly string[]} dropped 要去掉的键
 * @returns {Record<string, unknown>} 缺这些键的逐键扫描副本
 */
const withoutKeys = (base, dropped) => {
  /** @type {Record<string, unknown>} */
  const copy = { ...base };
  for (const key of dropped) delete copy[key];
  return copy;
};

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
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
    // 越界面(B5 / reverse):被测的就是枚举回退,故经 patchDirty 投喂
    // 取数(updateSettings 的每一次写入都落盘并改缓存)留在 case 外,case 内只放判定:
    // 下面每一组的判定对象都是上一组写入后的累积状态,拆进 case 会让 case 之间
    // 互相依赖(前一个 case 失败时后一个的判定对象根本不存在)。
    const r1 = await patchDirty(mod, {
      pageSetup: {
        marginTop: -5, marginBottom: 0, marginLeft: 301, marginRight: 300,
        paper: "B5", orientation: "reverse",
      },
    });
    await suite.case("1 页面设置边距钳制:0 边界保留、负值钳 0、内容区不足由右边距吸收", () => {
      assert(r1.pageSetup.marginTop === 0, "边距 -5 应钳制到 0");
      assert(r1.pageSetup.marginBottom === 0, "边距 0 边界应保留");
      assert(r1.pageSetup.marginLeft === 0, "A4 横向双边超限时不应无谓保留左边距");
      assert(r1.pageSetup.marginRight === 209, "A4 横向内容区不足时右边距应吸收剩余溢出");
      validatePageSetup(r1.pageSetup);
    });
    await suite.case("1 页面设置纸张/方向枚举外值回退默认", () => {
      assert(r1.pageSetup.paper === DEFAULT_PAGE_SETUP.paper, "paper 枚举外值(B5)应回退默认");
      assert(r1.pageSetup.orientation === DEFAULT_PAGE_SETUP.orientation, "orientation 枚举外值应回退默认");
    });

    // ---- 2. sanitizePageSetup 非数回退默认；几何非法值确定性收缩并 warning ----
    // 越界面:NaN / -999 / 缺 paper·orientation(缺字段沿用当前值)
    const r2 = await patchDirty(mod, {
      pageSetup: { marginTop: 0, marginBottom: 300, marginLeft: NaN, marginRight: -999 },
    });
    await suite.case("2 非数值回退当前值、下边距 300 确定性收缩至内容区 1mm", () => {
      assert(r2.pageSetup.marginTop === 0, "0 边界保留");
      assert(r2.pageSetup.marginBottom === 296, "A4 下边距 300 应确定性收缩至内容区 1mm");
      assert(r2.pageSetup.marginLeft === r1.pageSetup.marginLeft, "NaN 应回退当前 pageSetup 左边距");
      assert(r2.pageSetup.marginRight === 0, "-999 应钳制到 0");
      validatePageSetup(r2.pageSetup);
    });
    // 局部 pageSetup patch:只给部分边距 / 只给纸张,被测的是「按当前值合并、不重置」
    const r2PartialBase = await patchDirty(mod, {
      pageSetup: { marginTop: 11, marginBottom: 12, marginLeft: 13, marginRight: 14 },
    });
    const r2Partial = await patchDirty(mod, { pageSetup: { paper: "A5" } });
    await suite.case("2 局部 pageSetup patch 基于当前值合并,未提供的边距不重置", () => {
      assert(
        r2Partial.pageSetup.marginTop === r2PartialBase.pageSetup.marginTop &&
          r2Partial.pageSetup.marginBottom === r2PartialBase.pageSetup.marginBottom &&
          r2Partial.pageSetup.marginLeft === r2PartialBase.pageSetup.marginLeft &&
          r2Partial.pageSetup.marginRight === r2PartialBase.pageSetup.marginRight,
        "partial pageSetup patch 应基于当前值合并，不得重置未提供边距",
      );
      assert(r2Partial.pageSetup.paper === "A5", "partial pageSetup patch 应应用已提供纸张");
      validatePageSetup(r2Partial.pageSetup);
    });

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
    await suite.case("2 几何非法 pageSetup:确定性收缩为内容区 1mm 并输出迁移 warning", () => {
      assert(
        r2Geometry.pageSetup.marginTop === 0 && r2Geometry.pageSetup.marginBottom === 296,
        "A4 下边距 1000 应迁移为下 0 / 上 0 / 下 296(内容区保留 1mm)",
      );
      validatePageSetup(r2Geometry.pageSetup);
      assert(
        geometryWarnings.some((message) => message.includes("pageSetup") && message.includes("自动修正")),
        "几何非法 pageSetup 的 update 应输出明确迁移 warning",
      );
    });

    // ---- 3. sanitizeTypography 字号/行距边界值与越界值 ----
    // typography 局部 patch:只给部分字段(缺字段由清洗器补默认)
    const r3 = await patchDirty(mod, { typography: { bodySizePt: 8, lineSpacing: 1.0 } });
    await suite.case("3 typography 下边界:bodySizePt 8 / lineSpacing 1.0 保留", () => {
      assert(r3.typography.bodySizePt === 8, "bodySizePt 8 边界应保留");
      assert(r3.typography.lineSpacing === 1.0, "lineSpacing 1.0 边界应保留");
    });
    const r4 = await patchDirty(mod, { typography: { bodySizePt: 24, lineSpacing: 2.5 } });
    await suite.case("3 typography 上边界:bodySizePt 24 / lineSpacing 2.5 保留", () => {
      assert(r4.typography.bodySizePt === 24, "bodySizePt 24 边界应保留");
      assert(r4.typography.lineSpacing === 2.5, "lineSpacing 2.5 边界应保留");
    });
    // 越界面:7.9/0.9 越界 + 空字体 + align 枚举外值(right)
    const r5 = await patchDirty(mod, {
      typography: { bodySizePt: 7.9, lineSpacing: 0.9, fontAscii: "", align: "right" },
    });
    await suite.case("3 typography 越界回退默认:bodySizePt 7.9 / lineSpacing 0.9 / 空字体 / align 枚举外", () => {
      assert(r5.typography.bodySizePt === DEFAULT_TYPOGRAPHY.bodySizePt, "bodySizePt 7.9 越界应回退默认");
      assert(r5.typography.lineSpacing === DEFAULT_TYPOGRAPHY.lineSpacing, "lineSpacing 0.9 越界应回退默认");
      assert(r5.typography.fontAscii === DEFAULT_TYPOGRAPHY.fontAscii, "空字体应回退默认");
      assert(r5.typography.align === DEFAULT_TYPOGRAPHY.align, "align 枚举外值(right)应回退默认");
    });
    const r6 = await patchDirty(mod, {
      typography: {
        bodySizePt: 24.1, lineSpacing: 2.6, fontEastAsia: "宋体",
        firstLineIndent: false, headingNumbering: false,
      },
    });
    await suite.case("3 typography 上界越界回退默认,而非空字体与布尔字段保留", () => {
      assert(r6.typography.bodySizePt === DEFAULT_TYPOGRAPHY.bodySizePt, "bodySizePt 24.1 越界应回退默认");
      assert(r6.typography.lineSpacing === DEFAULT_TYPOGRAPHY.lineSpacing, "lineSpacing 2.6 越界应回退默认");
      assert(r6.typography.fontEastAsia === "宋体", "非空字体应保留");
      assert(r6.typography.firstLineIndent === false, "布尔字段应保留");
      assert(r6.typography.headingNumbering === false, "布尔字段应保留");
    });

    // ⚠ **局部块是「整块重置」,不是「只改我给的那几项」** —— 本用例把这条钉住。
    // sanitizeTypography 以 DEFAULT_TYPOGRAPHY 起手再逐字段覆盖,故块内省略的字段一律
    // 回到默认值。⚠ pageSetup 走的是**另一套**语义(以 current 合并、省略的边距保留),
    // 两者不可混谈 —— `SettingsMergePatch`(core/settings/merge-patch.ts)不放开 pageSetup
    // 正是为此(ADR-072)。这条语义此前只写在注释里、**无任何断言**,而同一文件对
    // pageSetup 侧的「缺边距不重置」是有断言的 —— 那个不对称正是它一直没被发现的原因。
    // 前置播种非默认值:否则「省略字段回默认」在初始本就是默认时会**永真**,测不到任何东西。
    const seeded = await patchDirty(mod, {
      typography: { fontAscii: "Inter", align: "left", firstLineIndent: false, bodySizePt: 14 },
    });
    const rPartial = await patchDirty(mod, { typography: { bodySizePt: 8 } });
    await suite.case("3 typography 局部块是整块重置:前置播种的非默认值不被保留", () => {
      assert(seeded.typography.fontAscii === "Inter", "前置:整块应能写入非默认值");
      assert(seeded.typography.align === "left", "前置:合法枚举的非默认值应保留");
      assert(seeded.typography.firstLineIndent === false, "前置:布尔非默认值应保留");
      assert(rPartial.typography.bodySizePt === 8, "局部块给出的字段应生效");
      assert(
        rPartial.typography.fontAscii === DEFAULT_TYPOGRAPHY.fontAscii,
        "局部块**省略**的字段应回到默认 —— 局部块是整块重置,不是逐字段合并",
      );
      assert(rPartial.typography.align === DEFAULT_TYPOGRAPHY.align, "同上:省略的 align 回默认");
      assert(
        rPartial.typography.firstLineIndent === DEFAULT_TYPOGRAPHY.firstLineIndent,
        "同上:省略的 firstLineIndent 回默认",
      );
    });

    // ---- 4. 非法枚举/类型回退(format/afterConvert/version/breakBeforeH1) ----
    // 越界面:四个键各自枚举外/错类型/非当前版本,应各自回退默认
    const r7 = await patchDirty(mod, {
      format: "html", afterConvert: "email", version: 2, breakBeforeH1: "yes",
    });
    const r8 = await mod.updateSettings({ format: "pdf", afterConvert: "open", breakBeforeH1: true, toc: false, equationNumbering: false });
    const r8b = await mod.updateSettings({ tocMode: "field" });
    const r8c = await patchDirty(mod, { tocMode: "bogus" });
    await suite.case("4 非法枚举/类型逐键回退默认:format/afterConvert/version/breakBeforeH1", () => {
      assert(r7.format === "docx", "format 枚举外值(html)应回退默认 docx");
      assert(r7.afterConvert === "none", "afterConvert 枚举外值应回退默认 none");
      assert(r7.version === 1, "version 非 1 应回退 1");
      assert(r7.breakBeforeH1 === false, "breakBeforeH1 非布尔应回退默认");
    });
    await suite.case("4 合法枚举与布尔保留、非法 tocMode 回退默认 static", () => {
      assert(r8.format === "pdf" && r8.afterConvert === "open", "合法枚举应保留");
      assert(r8.breakBeforeH1 === true && r8.toc === false, "合法布尔应保留");
      assert(r8.equationNumbering === false, "合法布尔(equationNumbering)应保留");
      assert(r8b.tocMode === "field", "合法 tocMode(field)应保留");
      assert(r8c.tocMode === "static", "非法 tocMode 应回退默认 static");
    });

    // ---- 5. sanitizePatch 白名单:未知键过滤 + 键集合同构(schema 表为准) ----
    // 原先这里是 18 个键名的全量硬编码副本;改为遍历 schema 表断言,键集合同构由
    // 「表派生」保证,不再需要在测试里复写一遍键名(键名一改这里就漏)。
    const r9 = await patchDirty(mod, { evil: "x", xss: 1, format: "pdf" });
    const persisted = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    await suite.case("5 白名单外键被过滤(内存与写盘都不含),白名单内键正常生效", () => {
      assert(!("evil" in r9) && !("xss" in r9), "白名单外键应被过滤(不写入)");
      assert(r9.format === "pdf", "白名单内键应正常生效");
      // 持久化文件同样不含未知键
      assert(!("evil" in persisted) && !("xss" in persisted), "写盘内容不应含白名单外键");
    });
    const persistedKeys = SETTINGS_SCHEMA.filter((e) => e.role === "persisted").map((e) => e.key);
    await suite.case("5 键集合同构:DEFAULT_SETTINGS = 表内持久化键 + version,落盘白名单同步", () => {
      assert(
        Object.keys(mod.DEFAULT_SETTINGS).length === persistedKeys.length + 1,
        "DEFAULT_SETTINGS 应为「表内持久化键 + version」这么多键",
      );
      for (const k of persistedKeys) {
        assert(k in mod.DEFAULT_SETTINGS, `DEFAULT_SETTINGS 缺少键 ${k}`);
        assert(PERSISTED_KEYS.includes(k), `落盘白名单缺少键 ${k}`);
      }
      assert(PERSISTED_KEYS.includes("version"), "落盘白名单应含 version(格式版本参数)");
    });
    await suite.case("5 旧平铺键不得进落盘白名单,也不得出现在 DEFAULT_SETTINGS", () => {
      assert(
        LEGACY_TRANSFORM_KEYS.every((k) => !PERSISTED_KEYS.includes(k) && !(k in mod.DEFAULT_SETTINGS)),
        "旧平铺键不得进落盘白名单,也不得出现在 DEFAULT_SETTINGS",
      );
    });

    // ---- 5b. pdfCss:合法 string 保留 / 非 string 回退默认空串 ----
    const r9b = await mod.updateSettings({ pdfCss: "body { color: red; }" });
    const r9c = await patchDirty(mod, { pdfCss: 123 });
    const r9d = await mod.updateSettings({ pdfCss: "" });
    await suite.case("5b pdfCss:合法 string 保留、非 string 回退默认空串、空串保留(清除语义)", () => {
      assert(r9b.pdfCss === "body { color: red; }", "pdfCss 合法 string 应保留");
      assert(r9c.pdfCss === "", "pdfCss 非 string 应回退默认空串");
      assert(r9d.pdfCss === "", "pdfCss 空串应保留(清除语义)");
    });

    // ---- 5c. theme:合法枚举保留 / 枚举外回退默认 system ----
    const r9e = await mod.updateSettings({ theme: "dark" });
    const r9f = await mod.updateSettings({ theme: "light" });
    const r9g = await patchDirty(mod, { theme: "blue" });
    const r9h = await patchDirty(mod, { theme: 123 });
    await suite.case("5c theme:合法枚举保留,枚举外与非字符串都回退默认 system", () => {
      assert(r9e.theme === "dark", "theme 合法值(dark)应保留");
      assert(r9f.theme === "light", "theme 合法值(light)应保留");
      assert(r9g.theme === "system", "theme 枚举外值(blue)应回退默认 system");
      assert(r9h.theme === "system", "theme 非字符串应回退默认 system");
    });

    // ---- 5d. 渲染前变换两组(adr-021 两档 + adr-024 分组):合法保留 / 非布尔回退默认 /
    //          落盘往返 / 预设导入(只写 customPresets)不丢档位 / 旧文件缺键兜底默认 ----
    // 取数(三次写入 + 两次读盘)留在 case 外:每一组的判定对象都是上一组写入后的累积状态
    const rTier = await mod.updateSettings({ aiCleanup: { enabled: true, tidy: false, rewrite: false } });
    const tierDisk = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    // 预设导入只经 updateSettings({ customPresets })(见 ipc/register.ts 导入分支),
    // 档位不属任何预设 → 导入既不改写也不丢值
    const afterPresetImport = await mod.updateSettings({
      customPresets: [{
        name: "我的模板",
        typography: { ...DEFAULT_TYPOGRAPHY, bodySizePt: 13 },
        pageSetup: { ...DEFAULT_PAGE_SETUP, paper: "A3" },
      }],
    });
    const rTierBad = await patchDirty(mod, { aiCleanup: { enabled: "yes", tidy: 1 } });
    const rObsidianBad = await patchDirty(mod, { obsidian: { compat: "yes", attachmentFolder: 3 } });
    await suite.case("5d AI 清理两档:合法的 false 保留且整块落盘,导入预设不丢档位", () => {
      assert(
        rTier.aiCleanup.tidy === false && rTier.aiCleanup.rewrite === false,
        "两档合法的 false 应保留(结构改写可单独关)",
      );
      assert(
        JSON.stringify(tierDisk.aiCleanup) === JSON.stringify({ enabled: true, tidy: false, rewrite: false }),
        `AI 清理整块应写入 settings.json(键白名单已含),实际 ${JSON.stringify(tierDisk.aiCleanup)}`,
      );
      assert(
        afterPresetImport.aiCleanup.tidy === false && afterPresetImport.aiCleanup.rewrite === false,
        "导入预设不得丢失 AI 清理两档(两档不入预设)",
      );
    });
    await suite.case("5d 渲染前变换两组:块内非布尔/非字符串逐字段回退默认", () => {
      assert(
        JSON.stringify(rTierBad.aiCleanup) === JSON.stringify({ enabled: false, tidy: true, rewrite: true }),
        `块内非布尔应逐字段回退默认(总开关关、两档开),实际 ${JSON.stringify(rTierBad.aiCleanup)}`,
      );
      assert(
        JSON.stringify(rObsidianBad.obsidian) === JSON.stringify({ compat: false, attachmentFolder: "Attachments" }),
        `obsidian 块内非布尔/非字符串应逐字段回退默认,实际 ${JSON.stringify(rObsidianBad.obsidian)}`,
      );
    });
    // 旧 settings.json 缺这两组键 → 字段级兜底默认,不整体回退、不报错
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        version: 1, format: "docx", afterConvert: "none", breakBeforeH1: false,
        pageSetup: { paper: "A4", orientation: "portrait", marginTop: 20, marginBottom: 20, marginLeft: 30, marginRight: 30 },
      }),
      "utf8",
    );
    const mLegacyTier = await freshModule("settings-legacy-ai-tiers");
    const legacyTier = mLegacyTier.loadSettings();
    await suite.case("5d 旧 settings.json 缺两组整块:字段级兜底默认且不牵连其它字段", () => {
      assert(
        JSON.stringify(legacyTier.aiCleanup) === JSON.stringify({ enabled: false, tidy: true, rewrite: true }),
        `旧 settings.json 缺 aiCleanup 整块时应兜底默认,实际 ${JSON.stringify(legacyTier.aiCleanup)}`,
      );
      assert(
        legacyTier.obsidian.compat === false && legacyTier.obsidian.attachmentFolder === "Attachments",
        `旧 settings.json 缺 obsidian 整块时应兜底默认,实际 ${JSON.stringify(legacyTier.obsidian)}`,
      );
      assert(
        legacyTier.format === "docx" && legacyTier.pageSetup.paper === "A4",
        "旧文件缺两组不应牵连其它字段",
      );
    });
    // 形状校验:分组块存在但字段类型非法 → 整文件判非法(adr-024 决定要点一:分组
    // 不得把「任一字段非法 → 整文件回退」静默放宽成字段级兜底)
    await suite.case("5d 分组块字段类型非法 → isValidSettings 判非法(不得放宽成字段级兜底)", () => {
      assert(
        mLegacyTier.isValidSettings({ ...legacyTier, aiCleanup: { ...legacyTier.aiCleanup, tidy: "yes" } }) === false,
        "aiCleanup.tidy 非布尔应使 isValidSettings 判非法",
      );
      assert(
        mLegacyTier.isValidSettings({ ...legacyTier, obsidian: { ...legacyTier.obsidian, attachmentFolder: 3 } }) === false,
        "obsidian.attachmentFolder 非字符串应使 isValidSettings 判非法",
      );
      assert(
        mLegacyTier.isValidSettings({ ...legacyTier, aiCleanup: "on" }) === false,
        "aiCleanup 既非对象也非旧布尔形状应判非法",
      );
      assert(
        mLegacyTier.isValidSettings({ ...legacyTier, obsidian: false }) === false,
        "obsidian 非对象应判非法",
      );
    });
    await suite.case("5d 旧平铺形状:仍判合法(迁移读入不被形状校验挡住),键类型非法则整文件判非法", () => {
      // 旧平铺形状(分组前)仍判合法 —— 迁移读入能力保留一个版本
      assert(
        mLegacyTier.isValidSettings({ ...legacyTier, aiCleanup: true, aiCleanupTidy: true, aiCleanupRewrite: false, obsidianCompat: true, obsidianAttachmentFolder: "Assets" }) === true,
        "旧平铺形状应仍判合法(迁移读入路径不得被形状校验挡在门外)",
      );
      // 旧平铺键类型非法 → 整文件判非法(与分组前同一口径,不得因改名而放宽)
      assert(
        mLegacyTier.isValidSettings({ ...legacyTier, aiCleanupTidy: "yes" }) === false,
        "旧 aiCleanupTidy 非布尔应使 isValidSettings 判非法",
      );
      assert(
        mLegacyTier.isValidSettings({ ...legacyTier, obsidianAttachmentFolder: 7 }) === false,
        "旧 obsidianAttachmentFolder 非字符串应使 isValidSettings 判非法",
      );
    });
    console.log("[ok] settings:渲染前变换两组 合法保留/块内非布尔回退/落盘往返/预设导入不丢/旧文件缺键兜底/新旧两形状形状校验 断言通过");

    // ---- 5e. 旧平铺形状 → 新嵌套形状的迁移(adr-024 决定要点四):取值等值迁移、
    //          旧键不残留、新键优先于同存的旧键、两形状都能读入 ----
    {
      const legacyShapeRaw = {
        version: 1, format: "docx", afterConvert: "none", breakBeforeH1: false,
        outputDir: "", toc: true, tocMode: "static", equationNumbering: true,
        pageSetup: { ...DEFAULT_PAGE_SETUP },
        aiCleanup: true, aiCleanupTidy: true, aiCleanupRewrite: false,
        obsidianCompat: true, obsidianAttachmentFolder: "Assets",
      };
      await fs.writeFile(settingsFile, JSON.stringify(legacyShapeRaw), "utf8");
      const mLegacyShape = await freshModule("settings-legacy-shape");
      const migrated = mLegacyShape.loadSettings();
      // 旧键不得被写回 settings.json(迁移是单向收敛,不是双写)
      await mLegacyShape.updateSettings({ toc: false });
      const afterLegacyWrite = JSON.parse(await fs.readFile(settingsFile, "utf8"));
      await suite.case("5e 旧平铺五键迁移为等值新对象,且不残留旧平铺键", () => {
        assert(
          JSON.stringify(migrated.aiCleanup) === JSON.stringify({ enabled: true, tidy: true, rewrite: false }),
          `旧平铺五键应迁移为等值新对象,实际 ${JSON.stringify(migrated.aiCleanup)}`,
        );
        assert(
          JSON.stringify(migrated.obsidian) === JSON.stringify({ compat: true, attachmentFolder: "Assets" }),
          `旧 obsidian 两键应迁移为等值新对象,实际 ${JSON.stringify(migrated.obsidian)}`,
        );
        assert(
          !("aiCleanupTidy" in migrated) && !("aiCleanupRewrite" in migrated) &&
            !("obsidianCompat" in migrated) && !("obsidianAttachmentFolder" in migrated),
          "迁移结果不得残留旧平铺键(否则搭车回写、文件收敛不到新形状)",
        );
      });
      await suite.case("5e 旧平铺键不随写盘回写(单向收敛),迁移取值写盘后保持不变", () => {
        assert(
          !("aiCleanupTidy" in afterLegacyWrite) && !("obsidianCompat" in afterLegacyWrite),
          `旧平铺键不应随写盘回写,实际键集 ${JSON.stringify(Object.keys(afterLegacyWrite))}`,
        );
        assert(
          JSON.stringify(afterLegacyWrite.aiCleanup) === JSON.stringify({ enabled: true, tidy: true, rewrite: false }),
          "旧文件迁移后的取值应在写盘后保持不变",
        );
      });
      // 新键与旧键同存 → 以新键为准(新键是本版本写出的权威形状)
      await fs.writeFile(
        settingsFile,
        JSON.stringify({
          ...legacyShapeRaw,
          aiCleanup: { enabled: false, tidy: false, rewrite: true },
          obsidian: { compat: false, attachmentFolder: "New" },
        }),
        "utf8",
      );
      const mBoth = await freshModule("settings-both-shapes");
      const both = mBoth.loadSettings();
      await suite.case("5e 新旧两形状同存时以新键为准", () => {
        assert(
          JSON.stringify(both.aiCleanup) === JSON.stringify({ enabled: false, tidy: false, rewrite: true }) &&
            JSON.stringify(both.obsidian) === JSON.stringify({ compat: false, attachmentFolder: "New" }),
          `新旧两形状同存时应以新键为准,实际 ${JSON.stringify(both.aiCleanup)}/${JSON.stringify(both.obsidian)}`,
        );
      });
      // 新形状原样接受(不做任何改写)
      await fs.writeFile(
        settingsFile,
        JSON.stringify({ ...legacyShapeRaw, aiCleanup: { enabled: true, tidy: false, rewrite: true }, obsidian: { compat: true, attachmentFolder: "Z" } }),
        "utf8",
      );
      const mNewShape = await freshModule("settings-new-shape");
      const newShape = mNewShape.loadSettings();
      await suite.case("5e 纯新形状原样读入(不做任何改写)", () => {
        assert(
          JSON.stringify(newShape.aiCleanup) === JSON.stringify({ enabled: true, tidy: false, rewrite: true }) &&
            JSON.stringify(newShape.obsidian) === JSON.stringify({ compat: true, attachmentFolder: "Z" }),
          "纯新形状应原样读入",
        );
      });
      // 部分字段的新形状 → 缺位字段按默认补(字段级兜底,不整文件回退);
      // 此处 aiCleanup 被新对象整体覆盖,旧的布尔总开关随之消失,故 enabled 走默认
      await fs.writeFile(
        settingsFile,
        JSON.stringify({ ...legacyShapeRaw, aiCleanup: { rewrite: true }, obsidian: { compat: true } }),
        "utf8",
      );
      const mPartial = await freshModule("settings-partial-new-shape");
      const partial = mPartial.loadSettings();
      await suite.case("5e 新形状缺字段逐字段兜底(缺位用旧键/默认补),不整文件回退", () => {
        assert(
          JSON.stringify(partial.aiCleanup) === JSON.stringify({ enabled: false, tidy: true, rewrite: true }) &&
            JSON.stringify(partial.obsidian) === JSON.stringify({ compat: true, attachmentFolder: "Assets" }),
          `新形状缺字段应逐字段兜底(缺位用旧键/默认补),实际 ${JSON.stringify(partial.aiCleanup)}/${JSON.stringify(partial.obsidian)}`,
        );
      });
      console.log("[ok] settings:旧平铺形状 → 新嵌套形状迁移(等值取值/旧键不残留/新键优先/两形状可读/缺字段兜底)断言通过");
    }

    // ---- 6. 损坏 settings.json(JSON parse 失败)→ DEFAULT_SETTINGS,静默不写盘 ----
    await fs.writeFile(settingsFile, "{broken json!!", "utf8");
    const m1 = await freshModule();
    const s1 = m1.loadSettings();
    await suite.case("6 损坏 settings.json(JSON parse 失败)→ 返回 DEFAULT_SETTINGS 引用且静默不写盘", async () => {
      assert(s1 === m1.DEFAULT_SETTINGS, "JSON 解析失败应返回 DEFAULT_SETTINGS 引用");
      assert(s1.format === "docx" && s1.pageSetup.paper === "A4", "损坏文件应回退默认值");
      assert(
        (await fs.readFile(settingsFile, "utf8")) === "{broken json!!",
        "损坏文件不应被重写(静默不写盘)",
      );
    });

    // ---- 7. 形状非法(合法 JSON 但字段非法)→ 默认 ----
    await fs.writeFile(
      settingsFile,
      JSON.stringify({ version: 9, format: "exe", pageSetup: { paper: "B0" } }),
      "utf8",
    );
    const m2 = await freshModule();
    const s2 = m2.loadSettings();
    await suite.case("7 形状非法(合法 JSON 但字段非法)→ 返回 DEFAULT_SETTINGS 引用", () => {
      assert(s2 === m2.DEFAULT_SETTINGS, "形状非法应返回 DEFAULT_SETTINGS 引用");
      assert(s2.version === 1 && s2.pageSetup.paper === "A4", "形状非法应回退默认值");
    });

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
    await suite.case("7b 非法 pageSetup 进入字段迁移(非整文件默认引用),且不丢弃其它设置", () => {
      assert(s2b !== m2b.DEFAULT_SETTINGS, "非法 pageSetup 应进入字段迁移而非整文件默认引用");
      assert(s2b.format === "pdf" && s2b.afterConvert === "open" && s2b.breakBeforeH1, "非法 pageSetup 迁移不得丢弃其它设置");
      assert(
        s2b.pageSetup.paper === DEFAULT_PAGE_SETUP.paper &&
          s2b.pageSetup.orientation === DEFAULT_PAGE_SETUP.orientation &&
          s2b.pageSetup.marginTop === 0 &&
          s2b.pageSetup.marginBottom === 296,
        `非法 pageSetup 纠正结果异常:${JSON.stringify(s2b.pageSetup)}`,
      );
      validatePageSetup(s2b.pageSetup);
    });
    await suite.case("7b loadSettings 返回结构化 migration(kind/page-setup-correction,scheduled,含页面)", () => {
      assert(
        s2b.migration?.kind === "page-setup-correction" &&
          s2b.migration.persistence === "scheduled" &&
          s2b.migration.message.includes("页面"),
        "loadSettings 应返回结构化 migration 供 renderer 显示 warning",
      );
    });
    // 等迁移写**结算**,而不是「等够久再放弃」:loadSettings 的迁移写是 fire-and-forget,
    // 固定预算的轮询在慢机上到点放弃后,写仍可能迟到落盘并覆盖下一小节写入的内容
    // (曾表现为下一小节读到陈旧设置)。drain 是确定性的:它 resolve 即代表队列已排空。
    await m2b.whenSettingsIdle();
    const migratedDisk = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    const m2bAfterIdle = m2b.loadSettings();
    await suite.case("7b 迁移写可靠固化到磁盘,瞬时 migration 不写入 settings.json", () => {
      assert(
        migratedDisk.pageSetup?.paper === "A4" && migratedDisk.pageSetup?.marginBottom === 296 && !migratedDisk.migration,
        "load 迁移的合法 pageSetup 应可靠固化，且瞬时 migration 不写入 settings.json",
      );
    });
    // committed 标志由写盘的 onCommitted 回调同步置位,而上面的 drain 已保证写结算,
    // 故此处无需再轮询等待。
    await suite.case("7b 迁移写成功后 cache 状态为 committed 且 cache pageSetup 与磁盘一致", () => {
      assert(
        m2bAfterIdle.migration?.persistence === "committed",
        "迁移写成功后 cache 中的 migration 状态必须为 committed",
      );
      assert(
        JSON.stringify(m2bAfterIdle.pageSetup) === JSON.stringify(migratedDisk.pageSetup),
        "迁移写成功后 cache pageSetup 必须与磁盘一致",
      );
    });

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
    const mQueueAfter = mQueue.loadSettings();
    await suite.case("7b 迁移入队后:后续 update 不被旧迁移快照覆盖,队列保留最小溢出修正", () => {
      assert(
        queuedUpdate.format === "docx" && queuedUpdate.toc === false &&
          queuedDisk.format === "docx" && queuedDisk.toc === false,
        "迁移后的后续 update 不得被旧迁移快照覆盖",
      );
      assert(
        queuedUpdate.pageSetup.marginTop === 96 && queuedUpdate.pageSetup.marginBottom === 200,
        "迁移与后续 update 队列应保留最小溢出修正结果",
      );
    });
    await suite.case("7b 迁移队列提交后 cache 状态与磁盘 pageSetup 一致", () => {
      assert(
        mQueueAfter.migration === undefined &&
          JSON.stringify(mQueueAfter.pageSetup) === JSON.stringify(queuedDisk.pageSetup),
        "迁移队列提交后 cache 状态与磁盘 pageSetup 应一致",
      );
    });

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
    // 下面两步是「把 settings.json 这个单目标在文件与目录之间来回换」,两次删除形态不同:
    // 这里删的是**文件**(走 removeFile,不配 recursive),后一处删的是**目录**(走 removeTree)。
    removeFile(settingsFile);
    mkdirSync(settingsFile);
    // 排空后该次写已结算(失败也在 catch 里置位),无需轮询。
    await mMigrationFailure.whenSettingsIdle();
    const failedMigrationState = mMigrationFailure.loadSettings();
    await suite.case("7b 迁移写失败时 cache 状态落为 failed(不得永远停在 scheduled)", () => {
      assert(
        failedMigrationState.migration?.persistence === "failed",
        "迁移写失败时 cache 必须记录 failed 状态",
      );
    });
    // 此处 settingsFile 已被换成**目录**(上面 mkdirSync),故走 removeTree(目录树删除)
    const outcome546 = removeTree(settingsFile);
    if (!outcome546.ok) throw new Error(`settings 目录替换还原失败:${settingsFile}:${outcome546.error?.message ?? ""}`);
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
    // 取数(七个旧文件副本 + 七个非法样例)留在 case 外,case 内只放判定
    await suite.case("7c isValidSettings:合法完整对象通过形状校验", () => {
      assert(mod.isValidSettings(validSettings) === true, "合法完整对象应通过形状校验(合法值保留)");
      assert(mod.isValidSettings({ ...validSettings, theme: "dark" }) === true, "theme dark 应通过形状校验");
      assert(mod.isValidSettings({ ...validSettings, theme: "system" }) === true, "theme system 应通过形状校验");
      assert(mod.isValidSettings({ ...validSettings, language: "zh" }) === true, "language zh 应通过形状校验");
      assert(mod.isValidSettings({ ...validSettings, language: "en" }) === true, "language en 应通过形状校验");
    });
    await suite.case("7c isValidSettings:缺可缺键的旧文件仍通过(toc/outputDir/equationNumbering/pdfCss/language/theme)", () => {
      // 旧文件兼容:缺 toc/outputDir 视为合法(loadSettings 兜底)
      const legacySettings = withoutKeys(validSettings, ["toc", "outputDir"]);
      assert(mod.isValidSettings(legacySettings) === true, "缺 toc/outputDir 的旧文件应通过形状校验");
      // equationNumbering 缺失(旧文件)视为合法,存在则须为布尔
      const legacyNoEq = withoutKeys(validSettings, ["equationNumbering"]);
      assert(mod.isValidSettings(legacyNoEq) === true, "缺 equationNumbering 的旧文件应通过形状校验");
      // pdfCss 缺失(旧文件)视为合法,存在则须为 string
      const legacyNoPdfCss = withoutKeys(validSettings, ["pdfCss"]);
      assert(mod.isValidSettings(legacyNoPdfCss) === true, "缺 pdfCss 的旧文件应通过形状校验");
      // language 缺失(旧文件)视为合法;非法/未注册值亦不整文件拒绝
      // (语言裁撤迁移:ko/fr/ru 用户字段级兜底 zh,其余偏好保留),见 loadSettings
      const legacyNoLang = withoutKeys(validSettings, ["language"]);
      assert(mod.isValidSettings(legacyNoLang) === true, "缺 language 的旧文件应通过形状校验");
      // theme 缺失(旧文件)视为合法,存在则须为 system/light/dark
      const legacyNoTheme = withoutKeys(validSettings, ["theme"]);
      assert(mod.isValidSettings(legacyNoTheme) === true, "缺 theme 的旧文件应通过形状校验");
    });
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
    await suite.case("7c isValidSettings:七个字段各自非法都整文件拒绝(逐条报告是哪一个)", () => {
      for (const [bad, label] of invalidCases) {
        assert(mod.isValidSettings(bad) === false, `${label} 应判定形状非法(整文件回退)`);
      }
    });
    await suite.case("7c isValidSettings:pageSetup 非法不整文件拒绝,交由 loadSettings 字段迁移处理", () => {
      // pageSetup 非法不参与整文件形状拒绝，交由 loadSettings 的字段迁移契约处理。
      assert(mod.isValidSettings({ ...validSettings, pageSetup: { ...validSettings.pageSetup, paper: "B5" } }) === true, "非法 paper 应允许进入 pageSetup 迁移");
      assert(mod.isValidSettings({ ...validSettings, pageSetup: { ...validSettings.pageSetup, marginTop: "abc" } }) === true, "非法边距类型应允许进入 pageSetup 迁移");
      assert(mod.isValidSettings({ ...validSettings, pageSetup: null }) === true, "pageSetup 缺失/非法形状应允许进入 pageSetup 迁移");
    });
    console.log("[ok] settings:isValidSettings 直测(合法保留/旧文件兼容/任一非法整文件回退)断言通过");

    // ---- 7d. 逐键语义表(4-0 护栏):21 键 × 三轴,期望值手写、independently of schema ----
    // 本表是「现状复刻」的钉子:schema 里任何一档写错(把 language/pageSetup 改成整文件
    // 拒绝,或把 aiCleanup 改成字段级兜底)都会在这里红 —— 而不是在下游某条用例上
    // 表现为「行为悄悄变了」。因此期望值**不得**从 schema 派生。
    // bad = 该键的「非法值」样例;expectReject = 注入它是否应整文件拒绝。
    const KEY_SEMANTICS = [
      { key: "format", role: "persisted", optional: false, invalid: "reject-whole-file", bad: "html" },
      { key: "pageSetup", role: "persisted", optional: true, invalid: "repair-block", bad: { paper: "B5" } },
      { key: "typography", role: "persisted", optional: true, invalid: "fallback-field", bad: "not-an-object" },
      { key: "breakBeforeH1", role: "persisted", optional: false, invalid: "reject-whole-file", bad: "yes" },
      { key: "toc", role: "persisted", optional: true, invalid: "reject-whole-file", bad: "yes" },
      { key: "tocMode", role: "persisted", optional: true, invalid: "reject-whole-file", bad: "bogus" },
      { key: "equationNumbering", role: "persisted", optional: true, invalid: "reject-whole-file", bad: "yes" },
      { key: "afterConvert", role: "persisted", optional: false, invalid: "reject-whole-file", bad: "email" },
      { key: "outputDir", role: "persisted", optional: true, invalid: "reject-whole-file", bad: "relative/dir" },
      { key: "customPresets", role: "persisted", optional: true, invalid: "fallback-field", bad: "not-an-array" },
      { key: "pdfCss", role: "persisted", optional: true, invalid: "reject-whole-file", bad: 123 },
      { key: "language", role: "persisted", optional: true, invalid: "fallback-field", bad: "ko" },
      { key: "theme", role: "persisted", optional: true, invalid: "reject-whole-file", bad: "blue" },
      { key: "headerFooter", role: "persisted", optional: true, invalid: "fallback-field", bad: "not-an-object" },
      { key: "watermark", role: "persisted", optional: true, invalid: "fallback-field", bad: "not-an-object" },
      { key: "aiCleanup", role: "persisted", optional: true, invalid: "reject-whole-file", bad: "on" },
      { key: "obsidian", role: "persisted", optional: true, invalid: "reject-whole-file", bad: false },
      { key: "aiCleanupTidy", role: "legacy-migration", optional: true, invalid: "reject-whole-file", bad: "yes" },
      { key: "aiCleanupRewrite", role: "legacy-migration", optional: true, invalid: "reject-whole-file", bad: "yes" },
      { key: "obsidianCompat", role: "legacy-migration", optional: true, invalid: "reject-whole-file", bad: "yes" },
      { key: "obsidianAttachmentFolder", role: "legacy-migration", optional: true, invalid: "reject-whole-file", bad: 7 },
    ];
    await suite.case("7d schema 表条目数与手写语义表一致(表派生不得漂移)", () => {
      assert(
        SETTINGS_SCHEMA.length === KEY_SEMANTICS.length,
        `schema 表应有 ${KEY_SEMANTICS.length} 条(17 落盘键 + 4 旧形状键;version 已移出被校验集合),实际 ${SETTINGS_SCHEMA.length}`,
      );
    });
    // 逐键扫描用的宽松副本(逐键 delete 任意键,故不套 ValidSettingsFixture 的定长形状)
    const perKeyBase = /** @type {Record<string, unknown>} */ ({ ...validSettings });
    // ⚠ 每键一个 case:一条语义写错不该让其余 20 键的判定都不跑(段内一次跑完可见全部失败面)
    for (const expected of KEY_SEMANTICS) {
      const entry = SETTINGS_SCHEMA.find((e) => e.key === expected.key);
      // 轴 2/3 的可观察面:缺该键 / 注入非法值时的整文件校验判定(取数,留在 case 外)
      const missing = { ...perKeyBase };
      delete missing[expected.key];
      const expectReject = expected.invalid === "reject-whole-file";
      const withBad = { ...perKeyBase, [expected.key]: expected.bad };
      await suite.case(`7d 逐键语义 ${expected.key}:角色/缺失合法性/处置档 + 两个可观察面 + 不变式`, () => {
        assert(entry !== undefined, `schema 表缺少键 ${expected.key}`);
        // 轴 1:角色(落盘 / 仅迁移期校验)
        assert(entry.role === expected.role, `${expected.key} 的角色应为 ${expected.role},实际 ${entry.role}`);
        // 轴 2:缺失是否合法
        assert(entry.optional === expected.optional, `${expected.key} 的「缺失是否合法」应为 ${expected.optional},实际 ${entry.optional}`);
        // 轴 3:非法时处置(三档,单选)
        assert(entry.invalid === expected.invalid, `${expected.key} 的处置档应为 ${expected.invalid},实际 ${entry.invalid}`);
        // 轴 2 的可观察面:缺该键时整文件校验的判定
        assert(
          mod.isValidSettings(missing) === expected.optional,
          `${expected.key} 缺失时应${expected.optional ? "合法(交加载兜底)" : "判非法(整文件回退)"},实际 ${mod.isValidSettings(missing)}`,
        );
        // 轴 3 的可观察面:注入非法值时整文件校验的判定
        assert(
          mod.isValidSettings(withBad) === !expectReject,
          `${expected.key} 注入非法值应${expectReject ? "整文件拒绝" : "不整文件拒绝(走兜底档)"},实际 ${mod.isValidSettings(withBad)}`,
        );
        // 推导不变式:处置档 = reject-whole-file ⇔ 该键参与整文件形状校验
        assert(
          SHAPE_CHECKED_ENTRIES.includes(entry) === expectReject,
          `${expected.key} 是否参与形状校验应与其处置档一致(消费点不得另设白名单)`,
        );
      });
    }
    const noVersion = { ...perKeyBase };
    delete noVersion.version;
    await suite.case("7d version:格式版本保持 1 且不在 schema 表内;非当前/缺失都整文件拒绝", () => {
      // version 已移出被校验键集合,但仍按声明的格式版本判定(不升位)
      assert(CURRENT_SETTINGS_VERSION === 1, "settings.json 格式版本应保持 1(adr-028 决定要点二:不升位)");
      assert(
        // e.key 收窄成 string 再比:本条断言的正是「表内没有 version 这个键」,
        // 而 version 已不在 schema 的键联合里(联合类型会直接判本条恒真/恒假)
        !SETTINGS_SCHEMA.some((e) => /** @type {string} */ (e.key) === "version"),
        "version 不应是表内条目(表不得被版本号选取,否则 schema 被自身校验)",
      );
      assert(mod.isValidSettings({ ...validSettings, version: 2 }) === false, "version 非当前格式版本应整文件拒绝");
      assert(mod.isValidSettings({ ...validSettings, version: 1 }) === true, "version 为当前格式版本应通过");
      assert(mod.isValidSettings(noVersion) === false, "缺 version 应整文件拒绝(格式版本是必填参)");
    });
    // 六个「不整文件拒绝」键的加载兜底:逐键兜底而非整文件回退,其它设置原样保留。
    // 一次落盘覆盖六键(pageSetup 由 core 纠正、其余五键由 sanitizer 兜底)。
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        ...validSettings,
        pageSetup: { paper: "B5", orientation: "sideways", marginTop: "abc" },
        typography: "not-an-object",
        customPresets: "not-an-array",
        language: "ko",
        headerFooter: "not-an-object",
        watermark: "not-an-object",
      }),
      "utf8",
    );
    const mFallback = await freshModule("settings-per-key-fallback");
    const fellBack = mFallback.loadSettings();
    await suite.case("7d 六个兜底键同时非法:逐键兜底而非整文件回退,且不牵连其它设置", () => {
      assert(fellBack !== mFallback.DEFAULT_SETTINGS, "六键非法应进入逐键兜底,而不是整文件回退 DEFAULT_SETTINGS");
      assert(fellBack.format === validSettings.format, "逐键兜底不得牵连其它设置(format 应原样保留)");
      assert(fellBack.toc === validSettings.toc, "逐键兜底不得牵连其它设置(toc 应原样保留)");
      assert(fellBack.pageSetup.paper === DEFAULT_PAGE_SETUP.paper, `pageSetup 应整块纠正,实际 ${JSON.stringify(fellBack.pageSetup)}`);
      validatePageSetup(fellBack.pageSetup);
    });
    await suite.case("7d 六个兜底键各自回退默认:typography/customPresets/language/headerFooter/watermark", () => {
      assert(
        fellBack.typography.bodySizePt === DEFAULT_TYPOGRAPHY.bodySizePt,
        "typography 应整块兜底为默认",
      );
      assert(JSON.stringify(fellBack.customPresets) === "[]", "customPresets 非数组应兜底 []");
      assert(fellBack.language === "zh", `语言裁撤值应字段级兜底默认语言,实际 ${fellBack.language}`);
      assert(
        fellBack.headerFooter.headerMode === "default" &&
          fellBack.watermark.angle === DEFAULT_WATERMARK.angle,
        "headerFooter / watermark 应逐字段兜底默认",
      );
    });
    await mFallback.whenSettingsIdle();
    console.log(`[ok] settings:逐键语义表 ${KEY_SEMANTICS.length} 键 × 三轴(角色/缺失合法/处置档)+ version 参数断言通过`);

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
    await suite.case("8 旧 settings.json:既有字段与 pageSetup(含四边距)原样保留", () => {
      assert(s3.format === "pdf" && s3.afterConvert === "open" && s3.breakBeforeH1 === true, "旧文件既有字段应保留");
      assert(s3.pageSetup.paper === "A3" && s3.pageSetup.orientation === "landscape", "旧文件 pageSetup 应保留");
      assert(
        s3.pageSetup.marginTop === 10 && s3.pageSetup.marginBottom === 20 &&
        s3.pageSetup.marginLeft === 30 && s3.pageSetup.marginRight === 40,
        "旧文件边距应保留",
      );
    });
    await suite.case("8 旧 settings.json 缺键逐项兜底默认(toc/equationNumbering/outputDir/pdfCss/language/theme)", () => {
      assert(s3.toc === true, "旧文件缺 toc → 兜底 true");
      assert(s3.equationNumbering === true, "旧文件缺 equationNumbering → 兜底 true");
      assert(s3.outputDir === "", "旧文件缺 outputDir → 兜底空串");
      assert(s3.pdfCss === "", "旧文件缺 pdfCss → 兜底空串");
      assert(s3.language === "zh", "旧文件缺 language → 兜底 zh");
      assert(s3.theme === "system", "旧文件缺 theme → 兜底 system(theme 键)");
    });
    await suite.case("8 旧 settings.json 缺 customPresets / typography → 空数组与整块默认", () => {
      assert(
        JSON.stringify(s3.customPresets) === "[]",
        "旧文件缺 customPresets → 兜底空数组",
      );
      assert(
        s3.typography.bodySizePt === DEFAULT_TYPOGRAPHY.bodySizePt &&
        s3.typography.lineSpacing === DEFAULT_TYPOGRAPHY.lineSpacing,
        "旧文件缺 typography → 整块默认",
      );
    });

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
    // 取数(载入 + 抓 warning)与 console 复原的 try/finally 一并留在 case 外:
    // 进了 case 则 case 失败会先抛,finally 的 console 复原虽仍会跑,但 case 与
    // 「改写全局 console」交叠会让失败定位变难。
    let mGeometry;
    let sGeometry;
    try {
      mGeometry = await freshModule("settings-geometry-load");
      sGeometry = mGeometry.loadSettings();
    } finally {
      console.warn = originalLoadWarn;
    }
    await suite.case("8b 旧文件几何非法边距:保留其余设置并确定性迁移 pageSetup", () => {
      assert(sGeometry.format === "pdf" && sGeometry.afterConvert === "open", "几何迁移不应丢弃其它旧设置");
      assert(
        sGeometry.pageSetup.marginTop === 296 && sGeometry.pageSetup.marginBottom === 0,
        `旧文件几何迁移结果异常:${JSON.stringify(sGeometry.pageSetup)}`,
      );
      validatePageSetup(sGeometry.pageSetup);
    });
    await suite.case("8b loadSettings 迁移几何非法旧设置时输出 warning", () => {
      assert(
        loadGeometryWarnings.some((message) => message.includes("pageSetup") && message.includes("自动修正")),
        "loadSettings 迁移几何非法旧设置时应输出 warning",
      );
    });
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
    const saved = s4.customPresets[0];
    await suite.case("9 合法完整文件:标量字段原样读取(含绝对路径 outputDir / pdfCss / language / theme)", () => {
      assert(s4.format === "pdf" && s4.toc === false, "合法文件字段应原样读取");
      assert(s4.equationNumbering === false, "合法文件 equationNumbering 应原样读取");
      assert(s4.outputDir === "C:\\tmp\\out", "绝对路径 outputDir 应保留");
      assert(s4.pdfCss === "body { color: red; }", "合法文件 pdfCss 应原样读取");
      assert(s4.language === "en", "合法文件 language 应原样读取");
      assert(s4.theme === "dark", "合法文件 theme 应原样读取(theme 键)");
    });
    await suite.case("9 合法完整文件:pageSetup 0 边界与合法边距、typography 与 customPresets 原样保留", () => {
      assert(s4.pageSetup.marginTop === 0 && s4.pageSetup.marginBottom === 200, "合法文件 0 边界与合法边距应保留");
      assert(
        s4.typography.bodySizePt === 14 && s4.typography.align === "left" && s4.typography.fontEastAsia === "宋体",
        "合法 typography 应保留",
      );
      assert(
        s4.customPresets.length === 1 && saved !== undefined && saved.name === "存档模板" &&
        saved.typography.bodySizePt === 14 && saved.pageSetup.marginBottom === 200,
        "合法 customPresets 应原样读取(名称/typography/pageSetup 保留)",
      );
    });

    // ---- 10. saveSettings 写队列串行化:并发 updateSettings 不交错、不丢更新 ----
    // saveSettings 经 promise 链串行(write tmp + rename 原子段不插入其它写);
    // 并发调用全部成功,最终落盘 = 最后一次调用的完整状态(调用序 = 写盘序,
    // next 在调用时同步计算合并当时缓存,语义不变),无残留 .tmp。
    const [rA, rB, rC, rD] = await Promise.all([
      mod.updateSettings({ format: "pdf", toc: true, breakBeforeH1: true }),
      mod.updateSettings({ format: "docx", afterConvert: "open" }),
      // 局部块 patch(只给部分边距 / 只给字号):被测的是「不同字段并发互不覆盖」
      patchDirty(mod, { pageSetup: { marginTop: 12.5, marginBottom: 20, marginLeft: 30, marginRight: 40 } }),
      patchDirty(mod, { typography: { bodySizePt: 13 } }),
    ]);
    // 最终落盘与 .tmp 残留探测留在 case 外(取数);四个调用的返回值判定进 case
    const final = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    const cacheAfterQueue = mod.loadSettings();
    let tmpLeft = true;
    try {
      await fs.access(settingsFile + ".tmp");
    } catch {
      tmpLeft = false;
    }
    await suite.case("10 并发 updateSettings:每个调用返回自身合并结果,逐个读到前序已提交字段", () => {
      // 每个调用返回各自合并结果(调用间互不吞并)
      assert(rA.format === "pdf" && rA.toc === true && rA.breakBeforeH1 === true, "并发调用 1 应返回自身合并结果");
      assert(rB.format === "docx" && rB.afterConvert === "open" && rB.toc === true, "并发调用 2 应读到调用 1 已提交字段");
      assert(rC.pageSetup.marginTop === 12.5 && rC.afterConvert === "open" && rC.toc === true, "并发调用 3 应保留前序字段");
      assert(rD.typography.bodySizePt === 13 && rD.format === "docx" && rD.afterConvert === "open", "并发调用 4 应保留前序字段");
    });
    await suite.case("10 并发写队列:最终落盘 = 最后一次调用的完整状态,缓存与落盘一致,无残留 .tmp", () => {
      // 最终落盘 = 最后一次调用返回的完整状态(完整相等,不交错/不丢字段)
      assert(
        JSON.stringify(final) === JSON.stringify(rD),
        "最终落盘应等于最后一次调用返回的完整状态(并发不交错/不丢更新)",
      );
      assert(
        JSON.stringify(cacheAfterQueue) === JSON.stringify(rD),
        "缓存应与最终落盘一致(链尾即最终态)",
      );
      assert(!tmpLeft, "写队列完成后不应残留 .tmp 临时文件");
    });

    // ---- 10a. 重启后并发字段全部保留:全新模块实例(读盘)逐字段复核 ----
    // 模拟重启 = 丢弃内存缓存的全新实例读 settings.json:并发 patch 的每个字段
    // 都必须落盘保留(丢更新在这里才暴露),且与缓存终态一致。
    const mRestart = await freshModule();
    const restarted = mRestart.loadSettings();
    await suite.case("10a 重启读盘:并发字段(pageSetup/typography)全部保留", () => {
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
    });
    await suite.case("10a 重启读回内容与最后一次成功写盘结果完全一致(内存/磁盘一致)", () => {
      assert(
        JSON.stringify(restarted) === JSON.stringify(rD),
        "重启读回内容应与最后一次成功写盘结果完全一致(内存/磁盘一致)",
      );
      validatePageSetup(restarted.pageSetup);
    });
    console.log("[ok] settings:重启读盘(并发不同字段全部保留,与缓存终态一致)");

    // ---- 10b. 写失败可观察:不更新缓存、不吞错误,且后续 mutation 仍可恢复 ----
    // settingsFilePath 固定走 userData/settings.json;将该目标暂时替换为目录,
    // 触发 rename 失败,不依赖平台特定的权限/锁定行为。
    removeFile(settingsFile); // 此处 settingsFile 是**文件**(删完才 mkdir 成目录)
    await fs.mkdir(settingsFile, { recursive: true });
    const mFail = await freshModule("settings-failure");
    let failureObserved = false;
    try {
      await mFail.updateSettings({ format: "pdf" });
    } catch {
      failureObserved = true;
    }
    await suite.case("10b 写失败必须向调用方抛出,且不更新缓存", () => {
      assert(failureObserved, "settings 写失败必须向调用方抛出,不得静默成功");
      assert(mFail.loadSettings().format !== "pdf", "settings 写失败不得更新缓存");
    });
    const outcome921 = removeTree(settingsFile); // 此处已是**目录**,走 removeTree
    if (!outcome921.ok) throw new Error(`settings 目录替换还原失败:${settingsFile}:${outcome921.error?.message ?? ""}`);
    await mFail.updateSettings({ format: "pdf" });
    await suite.case("10b 写失败后队列继续处理下一次 mutation", () => {
      assert(mFail.loadSettings().format === "pdf", "settings 写失败后队列应继续处理下一次 mutation");
    });
    // 恢复写入后重启读盘:拿到的是恢复成功的那次写(失败尝试未污染磁盘)
    // 注:本段把目标路径临时替换为目录,该实例的缓存基线因此退化为默认态,
    // 故此处只断言恢复值本身落盘(重启字段保留见 10a)。
    const mFailRestart = await freshModule("settings-failure-restart");
    const recoveredDisk = mFailRestart.loadSettings();
    await suite.case("10b 失败恢复后重启读盘拿到恢复写入的值(失败尝试未污染磁盘)", () => {
      assert(
        recoveredDisk.format === "pdf",
        `失败恢复后重启读盘应拿到恢复写入的值,实际 ${recoveredDisk.format}`,
      );
    });
    console.log("[ok] settings:写失败可观察(不吞错/不更新缓存/队列可恢复/重启读盘一致)");

console.log("[ok] settings:钳制边界/枚举回退/白名单/损坏与旧文件回退/并发写队列 断言通过");

    // ---- 11. customPresets:合法保留/非法丢弃/同名去重/上限截断/非数组回退 ----
    // 全组越界:条目字段残缺 / pageSetup 非对象 / 元素非对象 / 整键非数组,
    // 被测的正是 sanitizeCustomPresets 的逐条清洗与丢弃,故经 patchDirty 投喂
    const r11 = await patchDirty(mod, {
      customPresets: [
        { name: "我的模板", typography: { bodySizePt: 13, fontEastAsia: "宋体" }, pageSetup: { marginTop: -5, paper: "A4", orientation: "portrait", marginBottom: 20, marginLeft: 30, marginRight: 40 } },
        { name: "", typography: {}, pageSetup: {} }, // 空名称 → 丢弃
        { name: "坏数据", typography: { bodySizePt: 99 }, pageSetup: "nope" }, // pageSetup 非法 → 整条丢弃
        "not-an-object", // 非对象 → 丢弃
        { name: "我的模板", typography: { bodySizePt: 20 }, pageSetup: {} }, // 同名 → 丢弃(保留先出现)
      ],
    });
    const kept = r11.customPresets[0];
    await suite.case("11 customPresets 清洗:只保留唯一合法条目,名称/typography/pageSetup 逐项正确", () => {
      assert(r11.customPresets.length === 1, `customPresets 应只保留 1 条合法条目,实际 ${JSON.stringify(r11.customPresets)}`);
      assert(kept !== undefined, "唯一保留的条目应可取到");
      assert(kept.name === "我的模板", "合法条目名称应保留");
      assert(kept.typography.bodySizePt === 13, "合法 typography 字段应保留");
      assert(kept.typography.fontEastAsia === "宋体", "部分 typography 字段应保留(缺失字段回退默认)");
      assert(kept.pageSetup.marginTop === 0, "pageSetup 应经钳制(-5 → 0)");
      assert(kept.pageSetup.paper === "A4", "pageSetup 枚举应保留");
    });

    /** @type {{ name: string, typography: object, pageSetup: object }[]} */
    const many = [];
    for (let i = 0; i < 12; i++) many.push({ name: `p${i}`, typography: {}, pageSetup: {} });
    const r12 = await patchDirty(mod, { customPresets: many });
    const r13 = await patchDirty(mod, { customPresets: "nope" });
    await suite.case("11 customPresets 截断到 10 且保留先保存的 10 条", () => {
      assert(r12.customPresets.length === 10, `customPresets 应截断到 10,实际 ${r12.customPresets.length}`);
      assert(
        r12.customPresets[0]?.name === "p0" && r12.customPresets[9]?.name === "p9",
        "截断应保留先保存的 10 条",
      );
    });
    await suite.case("11 customPresets 非数组回退 []", () => {
      assert(Array.isArray(r13.customPresets) && r13.customPresets.length === 0, "customPresets 非数组应回退 []");
    });
    console.log("[ok] settings:customPresets 校验(合法保留/非法丢弃/同名去重/上限 10/非数组回退)断言通过");

    return { cases: suite.results };
  } finally {
    // 恢复真实 settings.json(原有内容或删除),避免污染用户设置(公共助手)
    await restore();
  }
}
