/**
 * i18n 测试(src/core/i18n.ts 纯逻辑 + src/main/persist/settings.ts language 字段):
 * 实现事实(读源码确认):
 * - t():zh 默认输出(与既有文案逐字一致);setLanguage("en") 后输出英文;
 *   参数插值 ${name} 占位(缺失参数保留占位符原样);缺失 key 回退返回 key 本身(不抛错)
 * - getLanguage():当前语言;默认 "zh"
 * - applyStaticTexts():document 未定义(main 进程)时安全返回,不触碰 DOM
 * - settings.language:isValidSettings 缺 language(旧文件)合法、zh/en 合法、其它值非法;
 *   sanitizePatch 非法值回退 "zh"、合法值保留;loadSettings 旧文件兜底 "zh"
 * - 磁盘备份/恢复模式与 settings.test.js 一致(settings.ts 无注入点,只能读写真实路径;
 *   模块级 settingsCache 惰性缓存 → 每场景用 query-string 动态 import 取全新模块实例)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { convert } from "../../dist/core/convert.js";
import { FIXTURES_DIR } from "../common/paths.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`i18n 断言失败:${msg}`);
}

export async function run() {
  const settingsFile = path.join(app.getPath("userData"), "settings.json");
  // 备份真实 settings.json(如有),finally 恢复(与 settings.test.js 同模式)
  let backup = null;
  let hadFile = false;
  try {
    backup = await fs.readFile(settingsFile, "utf8");
    hadFile = true;
  } catch {
    /* 无既有文件 */
  }
  let seq = 0;
  const freshModule = () => import(`../../dist/main/persist/settings.js?i18n=${seq++}`);
  try {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const i18n = await import("../../dist/core/i18n.js");

    // ---- 1. t() 基础:zh 默认输出(与既有文案逐字一致) ----
    assert(i18n.getLanguage() === "zh", "默认语言应为 zh");
    assert(i18n.t("app.title") === "Markdown 转换工具", "zh 默认输出应逐字一致");
    assert(i18n.t("file.selectFirst") === "请先选择 Markdown 文件", "zh 默认输出应逐字一致");
    assert(i18n.t("convert.done.status", { outputPath: "C:\\out\\a.docx" }) === "转换完成:C:\\out\\a.docx", "zh 参数插值应替换占位符");

    // ---- 2. setLanguage("en") 切换 + 插值 ----
    i18n.setLanguage("en");
    assert(i18n.getLanguage() === "en", "setLanguage 后应返回 en");
    assert(i18n.t("app.title") === "Markdown Converter", "en 输出应为英文");
    assert(i18n.t("file.selectFirst") === "Please select a Markdown file first", "en 输出应为英文");
    assert(i18n.t("convert.done.status", { outputPath: "C:\\out\\a.docx" }) === "Conversion complete: C:\\out\\a.docx", "en 参数插值应替换占位符");
    assert(i18n.t("recent.time.monthDay", { month: 8, day: 16 }) === "8/16", "en 数字参数插值应生效");

    // ---- 3. 缺失 key 回退 key 本身;缺失参数保留占位符 ----
    assert(i18n.t("no.such.key") === "no.such.key", "缺失 key 应回退 key 本身(不抛错)");
    assert(i18n.t("convert.done.status") === "Conversion complete: ${outputPath}", "缺失参数应保留占位符原样");

    // ---- 4. 切回 zh(模块级状态可反复切换) ----
    i18n.setLanguage("zh");
    assert(i18n.t("app.title") === "Markdown 转换工具", "切回 zh 后应输出中文");

    // ---- 5. applyStaticTexts:main 进程(document 未定义)安全返回 ----
    assert(typeof i18n.applyStaticTexts === "function", "applyStaticTexts 应导出");
    assert(i18n.applyStaticTexts() === undefined, "document 未定义时应安全返回(不抛错)");

    // ---- 6. settings.language:isValidSettings 形状校验 ----
    const mod = await freshModule();
    const base = {
      version: 1, format: "docx", afterConvert: "none", breakBeforeH1: false, toc: false,
      pageSetup: { paper: "A4", orientation: "portrait", marginTop: 20, marginBottom: 20, marginLeft: 30, marginRight: 30 },
    };
    assert(mod.isValidSettings({ ...base, language: "zh" }) === true, "language zh 应通过形状校验");
    assert(mod.isValidSettings({ ...base, language: "en" }) === true, "language en 应通过形状校验");
    assert(mod.isValidSettings({ ...base, language: "fr" }) === false, "language 枚举外值(fr)应判定形状非法");
    assert(mod.isValidSettings({ ...base, language: 1 }) === false, "language 非字符串应判定形状非法");
    assert(mod.isValidSettings(base) === true, "缺 language 的旧文件应通过形状校验(loadSettings 兜底 zh)");

    // ---- 7. sanitizePatch:非法值回退 zh、合法值保留(经 updateSettings 公开路径) ----
    const r1 = await mod.updateSettings({ language: "fr" });
    assert(r1.language === "zh", "language 非法值(fr)应回退默认 zh");
    const r2 = await mod.updateSettings({ language: "en" });
    assert(r2.language === "en", "language 合法值(en)应保留");
    const r3 = await mod.updateSettings({ language: "zh" });
    assert(r3.language === "zh", "language 合法值(zh)应保留");

    // ---- 8. loadSettings:旧文件缺 language → 兜底 zh;合法 en → 原样读取 ----
    await fs.writeFile(settingsFile, JSON.stringify(base), "utf8");
    const m1 = await freshModule();
    assert(m1.loadSettings().language === "zh", "旧文件缺 language → 兜底 zh");
    await fs.writeFile(settingsFile, JSON.stringify({ ...base, language: "en" }), "utf8");
    const m2 = await freshModule();
    assert(m2.loadSettings().language === "en", "合法文件 language en 应原样读取");

    // ---- 9. formatWarning 三分支(B6 keyed 警告)----
    // 9a. string 直通
    assert(i18n.formatWarning("纯文本警告") === "纯文本警告", "formatWarning:string 应原样返回");
    // 9b. KeyedWarning key 命中 + 插值(zh)
    const keyed = { key: "warn.imageLoadFailed", params: { src: "a.png" }, fallback: "图片加载失败: a.png" };
    assert(i18n.formatWarning(keyed) === "图片加载失败: a.png", "formatWarning:key 命中应走字典插值(zh)");
    // 9c. KeyedWarning key 缺失 → 回退 fallback
    assert(
      i18n.formatWarning({ key: "warn.no.such.key", params: { x: 1 }, fallback: "兜底文案" }) === "兜底文案",
      "formatWarning:key 缺失应回退 fallback",
    );
    // 9d. en 下 keyed 警告走英文字典(语言切换后警告跟随)
    i18n.setLanguage("en");
    assert(i18n.formatWarning(keyed) === "Failed to load image: a.png", "formatWarning:en 应输出英文文案");
    i18n.setLanguage("zh");

    // ---- 10. en 键集运行期一致性抽查(编译期已由 EN 类型锁定,此处冒烟) ----
    const zhKeys = Object.keys(i18n.DICT.zh).sort();
    const enKeys = Object.keys(i18n.DICT.en).sort();
    assert(
      zhKeys.length === enKeys.length && zhKeys.every((k, idx) => k === enKeys[idx]),
      `zh/en 键集应一致,zh 独有=${JSON.stringify(zhKeys.filter((k) => !enKeys.includes(k)))},en 独有=${JSON.stringify(enKeys.filter((k) => !zhKeys.includes(k)))}`,
    );

    // ---- 11. warnOnce 对象去重(B6:去重键 = key + JSON(params))----
    // 悬空交叉引用重复出现 N 次 → 仅 1 条 KeyedWarning(docx render.ts warnDedup)
    const dedupWarnings = [];
    await convert("[图](#fig:x)\n\n[图](#fig:x)\n\n[图](#fig:x)\n\n正文", "docx", {
      baseDir: FIXTURES_DIR,
      warnings: dedupWarnings,
    });
    assert(dedupWarnings.length === 1, `悬空引用 ×3 应去重为 1 条警告,实际 ${dedupWarnings.length}`);
    const [dw] = dedupWarnings;
    assert(typeof dw === "object" && dw.key === "warn.crossRefNotFound", `去重后应为 warn.crossRefNotFound 对象,实际 ${JSON.stringify(dw)}`);
    assert(dw.params && dw.params.ref === "fig:x", `params.ref 应为 fig:x,实际 ${JSON.stringify(dw.params)}`);
    assert(dw.fallback === "交叉引用未找到图 label: fig:x", `fallback 应逐字保留中文原文,实际 ${dw.fallback}`);
    assert(i18n.formatWarning(dw) === "交叉引用未找到图 label: fig:x", "zh 下格式化结果应与 fallback 一致");

    console.log("[ok] i18n:t() 默认/切换/插值/缺 key 回退 + formatWarning 三分支 + en 键集一致性 + warnOnce 对象去重 + settings.language 校验/兜底 断言通过");
  } finally {
    // 恢复真实 settings.json(原有内容或删除),避免污染用户设置
    if (hadFile) await fs.writeFile(settingsFile, backup, "utf8");
    else await fs.rm(settingsFile, { force: true });
  }
}