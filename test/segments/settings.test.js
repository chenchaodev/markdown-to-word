/**
 * 设置持久化测试(src/main/settings.ts 纯逻辑层;测试经 dist/main/settings.js,未改动实现):
 * 实现事实(读源码确认):
 * - sanitizePageSetup:边距钳制 Math.min(1000, Math.max(0, v))(MARGIN_MIN_MM=0 / MAX=1000),
 *   非有限数(NaN/Infinity/非 number)→ DEFAULT_PAGE_SETUP 对应值;paper/orientation
 *   枚举外值 → DEFAULT_PAGE_SETUP 值
 * - sanitizeTypography:bodySizePt 8-24、lineSpacing 1.0-2.5 范围校验,越界 → DEFAULT_TYPOGRAPHY
 *   值;字体须非空字符串、布尔字段须 boolean、align 枚举(left/justify);整块兜底,
 *   始终返回合法完整对象
 * - sanitizePatch:仅 SETTING_KEYS 9 键(version/format/pageSetup/typography/breakBeforeH1/
 *   toc/afterConvert/outputDir/customPresets)白名单,未知键过滤;非法值回退默认
 * - sanitizeCustomPresets(批次 11 迭代 3):非数组 → [];条目须对象且 name 非空;
 *   typography 逐字段钳制、pageSetup 非法对象整条丢弃;同名去重(保留先出现);
 *   截断 MAX_CUSTOM_PRESETS=10
 * - loadSettings:JSON parse 失败 / 形状非法(isValidSettings)→ 返回 DEFAULT_SETTINGS 引用
 *   (静默不写盘);旧文件(缺 toc/outputDir/typography)→ 其余字段保留 + 兜底默认,不崩溃
 * - settingsFilePath = app.getPath("userData")/settings.json(无注入点)→ 测试备份真实文件、
 *   finally 恢复;模块级 settingsCache 惰性缓存 → 每场景用 query-string 动态 import 取
 *   全新模块实例(实证:Node ESM 同文件不同 query = 独立实例,缓存按 URL 键)
 * - sanitizePageSetup/sanitizeTypography/sanitizePatch 均未导出 → 经 updateSettings 公开
 *   路径断言(patch 合并 + sanitize + 持久化 + 返回 next)
 * - isValidSettings(批次 15 R3 起导出):整文件形状校验纯函数直测——任一字段非法
 *   (如 marginTop:"abc")→ false(loadSettings 据此整体回退 DEFAULT_SETTINGS 引用);
 *   合法完整对象 → true(合法值保留)
 * - saveSettings 写队列(promise 链):并发调用串行执行,调用序 = 写盘序,链尾即最终态
 *   (M4,防并发交错写同一 tmp 文件丢更新;失败不截断队列,错误由各自调用方处理)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { DEFAULT_PAGE_SETUP } from "../../dist/core/convert.js";
import { DEFAULT_TYPOGRAPHY } from "../../dist/core/typography.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`settings 断言失败:${msg}`);
}

export async function run() {
  const settingsFile = path.join(app.getPath("userData"), "settings.json");
  // 备份真实 settings.json(如有),finally 恢复(settings.ts 无注入点,只能读写真实路径)
  let backup = null;
  let hadFile = false;
  try {
    backup = await fs.readFile(settingsFile, "utf8");
    hadFile = true;
  } catch {
    /* 无既有文件 */
  }
  let seq = 0;
  const freshModule = () => import(`../../dist/main/settings.js?case=${seq++}`);
  try {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const mod = await freshModule();

    // ---- 1. sanitizePageSetup 数值钳制:0/1000 边界保留、负值/超限钳回;非法枚举回退 ----
    const r1 = await mod.updateSettings({
      pageSetup: {
        marginTop: -5, marginBottom: 0, marginLeft: 1001, marginRight: 1000,
        paper: "B5", orientation: "reverse",
      },
    });
    assert(r1.pageSetup.marginTop === 0, "边距 -5 应钳制到 0");
    assert(r1.pageSetup.marginBottom === 0, "边距 0 边界应保留");
    assert(r1.pageSetup.marginLeft === 1000, "边距 1001 应钳制到 1000");
    assert(r1.pageSetup.marginRight === 1000, "边距 1000 边界应保留");
    assert(r1.pageSetup.paper === DEFAULT_PAGE_SETUP.paper, "paper 枚举外值(B5)应回退默认");
    assert(r1.pageSetup.orientation === DEFAULT_PAGE_SETUP.orientation, "orientation 枚举外值应回退默认");

    // ---- 2. sanitizePageSetup 非数回退默认(部分 patch 未给字段 → 默认,与文档语义一致) ----
    const r2 = await mod.updateSettings({
      pageSetup: { marginTop: 0, marginBottom: 1000, marginLeft: NaN, marginRight: -999 },
    });
    assert(r2.pageSetup.marginTop === 0, "0 边界保留");
    assert(r2.pageSetup.marginBottom === 1000, "1000 边界保留");
    assert(r2.pageSetup.marginLeft === DEFAULT_PAGE_SETUP.marginLeft, "NaN 应回退默认左边距");
    assert(r2.pageSetup.marginRight === 0, "-999 应钳制到 0");

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
    const r8 = await mod.updateSettings({ format: "pdf", afterConvert: "open", breakBeforeH1: true, toc: false });
    assert(r8.format === "pdf" && r8.afterConvert === "open", "合法枚举应保留");
    assert(r8.breakBeforeH1 === true && r8.toc === false, "合法布尔应保留");

    // ---- 5. sanitizePatch 白名单:未知键过滤 + SETTING_KEYS 9 键核对 ----
    const r9 = await mod.updateSettings({ evil: "x", xss: 1, format: "pdf" });
    assert(!("evil" in r9) && !("xss" in r9), "白名单外键应被过滤(不写入)");
    assert(r9.format === "pdf", "白名单内键应正常生效");
    const settingKeys = ["version", "format", "pageSetup", "typography", "breakBeforeH1", "toc", "afterConvert", "outputDir", "customPresets"];
    assert(Object.keys(mod.DEFAULT_SETTINGS).length === settingKeys.length, "DEFAULT_SETTINGS 应为 9 键");
    for (const k of settingKeys) assert(k in mod.DEFAULT_SETTINGS, `DEFAULT_SETTINGS 缺少键 ${k}`);
    // 持久化文件同样不含未知键
    const persisted = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    assert(!("evil" in persisted) && !("xss" in persisted), "写盘内容不应含白名单外键");

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

    // ---- 7b. 边距非有限数(92-93 行)→ 整文件回退默认(与 7 同路径,补分支) ----
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        version: 1, format: "docx", afterConvert: "none", breakBeforeH1: false,
        pageSetup: { paper: "A4", orientation: "portrait", marginTop: "abc", marginBottom: 20, marginLeft: 30, marginRight: 40 },
      }),
      "utf8",
    );
    const m2b = await freshModule();
    const s2b = m2b.loadSettings();
    assert(s2b === m2b.DEFAULT_SETTINGS, "边距非有限数应整文件回退 DEFAULT_SETTINGS 引用");
    assert(
      s2b.pageSetup.marginTop === DEFAULT_PAGE_SETUP.marginTop &&
        s2b.pageSetup.marginBottom === DEFAULT_PAGE_SETUP.marginBottom,
      "回退后边距应为默认值",
    );
    console.log("[ok] settings:非法边距(非有限数)整文件回退默认");

    // ---- 7c. isValidSettings 直测(批次 15 R3:导出纯函数,不依赖磁盘 IO) ----
    // 依据(dist/main/settings.ts isValidSettings):整文件形状校验——任一字段非法
    // → false(loadSettings 据此整体回退 DEFAULT_SETTINGS 引用);合法完整对象 → true。
    // typography/customPresets 不参与形状校验(loadSettings 单独 sanitize)。
    const validSettings = {
      version: 1, format: "pdf", afterConvert: "open", breakBeforeH1: true, toc: false,
      outputDir: "C:\\tmp\\out",
      pageSetup: { paper: "Letter", orientation: "landscape", marginTop: 12.5, marginBottom: 20, marginLeft: 30, marginRight: 40 },
    };
    assert(mod.isValidSettings(validSettings) === true, "合法完整对象应通过形状校验(合法值保留)");
    // 旧文件兼容:缺 toc/outputDir 视为合法(loadSettings 兜底)
    const legacySettings = { ...validSettings };
    delete legacySettings.toc;
    delete legacySettings.outputDir;
    assert(mod.isValidSettings(legacySettings) === true, "缺 toc/outputDir 的旧文件应通过形状校验");
    // 任一字段非法 → false(整文件回退语义)
    const invalidCases = [
      [{ ...validSettings, pageSetup: { ...validSettings.pageSetup, marginTop: "abc" } }, "marginTop 非有限数"],
      [{ ...validSettings, pageSetup: { ...validSettings.pageSetup, marginBottom: NaN } }, "marginBottom NaN"],
      [{ ...validSettings, format: "html" }, "format 枚举外值"],
      [{ ...validSettings, version: 2 }, "version 非 1"],
      [{ ...validSettings, breakBeforeH1: "yes" }, "breakBeforeH1 非布尔"],
      [{ ...validSettings, pageSetup: null }, "pageSetup 缺失"],
      [{ ...validSettings, afterConvert: "email" }, "afterConvert 枚举外值"],
    ];
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
    assert(s3.outputDir === "", "旧文件缺 outputDir → 兜底空串");
    assert(
      JSON.stringify(s3.customPresets) === "[]",
      "旧文件缺 customPresets → 兜底空数组",
    );
    assert(
      s3.typography.bodySizePt === DEFAULT_TYPOGRAPHY.bodySizePt &&
      s3.typography.lineSpacing === DEFAULT_TYPOGRAPHY.lineSpacing,
      "旧文件缺 typography → 整块默认",
    );

    // ---- 9. 合法完整文件:原样读取(含 0/1000 边界边距与 typography 全字段) ----
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        version: 1, format: "pdf", afterConvert: "open", breakBeforeH1: true, toc: false, outputDir: "C:\\tmp\\out",
        pageSetup: { paper: "Letter", orientation: "landscape", marginTop: 0, marginBottom: 1000, marginLeft: 100, marginRight: 200 },
        typography: { fontAscii: "Arial", fontEastAsia: "宋体", bodySizePt: 14, lineSpacing: 2.0, firstLineIndent: false, align: "left", headingNumbering: false, captionNumbering: false },
        customPresets: [
          { name: "存档模板", typography: { fontAscii: "Arial", fontEastAsia: "宋体", bodySizePt: 14, lineSpacing: 2.0, firstLineIndent: false, align: "left", headingNumbering: false, captionNumbering: false }, pageSetup: { paper: "Letter", orientation: "landscape", marginTop: 0, marginBottom: 1000, marginLeft: 100, marginRight: 200 } },
        ],
      }),
      "utf8",
    );
    const m4 = await freshModule();
    const s4 = m4.loadSettings();
    assert(s4.format === "pdf" && s4.toc === false, "合法文件字段应原样读取");
    assert(s4.outputDir === "C:\\tmp\\out", "绝对路径 outputDir 应保留");
    assert(s4.pageSetup.marginTop === 0 && s4.pageSetup.marginBottom === 1000, "合法文件 0/1000 边界边距应保留");
    assert(
      s4.typography.bodySizePt === 14 && s4.typography.align === "left" && s4.typography.fontEastAsia === "宋体",
      "合法 typography 应保留",
    );
    assert(
      s4.customPresets.length === 1 && s4.customPresets[0].name === "存档模板" &&
      s4.customPresets[0].typography.bodySizePt === 14 && s4.customPresets[0].pageSetup.marginBottom === 1000,
      "合法 customPresets 应原样读取(名称/typography/pageSetup 保留)",
    );

    // ---- 10. saveSettings 写队列串行化:并发 updateSettings 不交错、不丢更新 ----
    // M4:saveSettings 经 promise 链串行(write tmp + rename 原子段不插入其它写);
    // 并发调用全部成功,最终落盘 = 最后一次调用的完整状态(调用序 = 写盘序,
    // next 在调用时同步计算合并当时缓存,语义不变),无残留 .tmp。
    const [rA, rB, rC, rD] = await Promise.all([
      mod.updateSettings({ format: "pdf", toc: true, breakBeforeH1: true }),
      mod.updateSettings({ format: "docx", afterConvert: "open" }),
      mod.updateSettings({ pageSetup: { marginTop: 12.5 } }),
      mod.updateSettings({ typography: { bodySizePt: 13 } }),
    ]);
    // 每个调用返回各自合并结果(调用间互不吞并)
    assert(rA.format === "pdf" && rA.toc === true && rA.breakBeforeH1 === true, "并发调用 1 应返回自身合并结果");
    assert(rB.format === "docx" && rB.afterConvert === "open", "并发调用 2 应返回自身合并结果");
    assert(rC.pageSetup.marginTop === 12.5, "并发调用 3 应返回自身合并结果");
    assert(rD.typography.bodySizePt === 13, "并发调用 4 应返回自身合并结果");
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

console.log("[ok] settings:钳制边界/枚举回退/白名单/损坏与旧文件回退/并发写队列 断言通过");

    // ---- 11. customPresets(批次 11 迭代 3):合法保留/非法丢弃/同名去重/上限截断/非数组回退 ----
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
    // 恢复真实 settings.json(原有内容或删除),避免污染用户设置
    if (hadFile) await fs.writeFile(settingsFile, backup, "utf8");
    else await fs.rm(settingsFile, { force: true });
  }
}
