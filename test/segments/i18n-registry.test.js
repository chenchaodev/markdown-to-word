/**
 * i18n 多语言注册表守护段(方案A 字典拆分改造):
 * 经 dist 断言(与既有段一致),覆盖四类回归面:
 * (a) 键集包含关系:en 键集 = zh 键集(satisfies 全量约束的运行期冒烟);
 *     各 Partial 语言(ja/ko/fr/ru)键集 ⊆ zh 键集(多键即编译期已报错,此处防运行期漂移)
 * (b) 回退链行为:tByKey 当前语言 → en → key——设 ru 后取 ru 字典刻意缺失的
 *     warn.katexCssLoadFailed(ru.ts 头注释记录的固定测试夹具),断言回退 en 文案而非裸 key;
 *     formatWarning 同链路同步断言
 * (c) htmlLang 映射:htmlLangOf 对全部注册语言返回 BCP 47 期望值(zh→zh-CN 等)
 * (d) settings 校验派生:isValidSettings 接受全部注册语言码、拒绝未注册值;
 *     settings.json 往返无损:新语言经写入后 loadSettings 原样读回(向后兼容:旧文件
 *     缺 language 兜底 zh)
 */
import fs from "node:fs/promises";
import { app } from "electron";
import { DICT, LANGUAGES, htmlLangOf, isLanguage } from "../../dist/core/i18n/index.js";
import {
  setLanguage,
  t,
  formatWarning,
} from "../../dist/core/i18n.js";
import {
  backupSettingsFile,
  freshSettingsModule,
  settingsJsonPath,
} from "../common/settings.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`i18n-registry 断言失败:${msg}`);
}

/** 回退链固定夹具键:仅 ru 刻意缺失(ru.ts 头注释记录,补译须同步本段) */
const FALLBACK_PROBE_KEY = "warn.katexCssLoadFailed";

export async function run() {
  const zhKeys = Object.keys(DICT.zh).sort();
  const enKeys = Object.keys(DICT.en).sort();

  // ================= (a) 键集包含关系 =================
  assert(
    zhKeys.length === enKeys.length && zhKeys.every((k, i) => k === enKeys[i]),
    `en 键集应与 zh 全等,zh 独有=${JSON.stringify(zhKeys.filter((k) => !enKeys.includes(k)))},en 独有=${JSON.stringify(enKeys.filter((k) => !zhKeys.includes(k)))}`,
  );
  const partialCodes = LANGUAGES.map((l) => l.code).filter((c) => c !== "zh" && c !== "en");
  const coverage = {};
  for (const code of partialCodes) {
    const extra = Object.keys(DICT[code]).filter((k) => !zhKeys.includes(k));
    assert(extra.length === 0, `${code} 字典不应有 zh 之外的键,多出=${JSON.stringify(extra)}`);
    coverage[code] = Object.keys(DICT[code]).length;
    // 抽查插值占位符不丢失:含 ${} 的 zh 模板,译文若存在则占位符集合必须一致
    // (例外:warn.crossRefNotFound 的 kind 参数按 en 口径省略,允许为 zh 子集)
    for (const [key, value] of Object.entries(DICT[code])) {
      const ph = (s) => [...String(s).matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      if (!DICT.zh[key].includes("${")) continue;
      assert(
        ph(value) === ph(DICT.zh[key]) || key === "warn.crossRefNotFound",
        `${code}.${key} 插值占位符应与 zh 一致:zh=[${ph(DICT.zh[key])}] ${code}=[${ph(value)}]`,
      );
    }
  }
  console.log(
    `[ok] i18n-registry:(a) en=zh 全量(${zhKeys.length} 键);Partial 语言键集 ⊆ zh 且占位符一致 ${JSON.stringify(coverage)} 断言通过`,
  );

  // ================= (b) 回退链行为(当前语言 → en → key) =================
  assert(
    Object.prototype.hasOwnProperty.call(DICT.zh, FALLBACK_PROBE_KEY) &&
      !Object.prototype.hasOwnProperty.call(DICT.ru, FALLBACK_PROBE_KEY),
    `回退链夹具前提:${FALLBACK_PROBE_KEY} 应存在于 zh 而缺失于 ru(见 ru.ts 头注释)`,
  );
  setLanguage("ru");
  const expectedEn = DICT.en[FALLBACK_PROBE_KEY].replace("${error}", "E");
  assert(t(FALLBACK_PROBE_KEY, { error: "E" }) === expectedEn, `ru 缺失键应回退 en 文案("${expectedEn}")而非裸 key`);
  assert(t(FALLBACK_PROBE_KEY, { error: "E" }) !== FALLBACK_PROBE_KEY, "回退结果不应是裸 key");
  // formatWarning 同步走回退链:keyed 警告在 ru 下输出 en 文案
  const keyed = { key: FALLBACK_PROBE_KEY, params: { error: "E" }, fallback: "兜底文案" };
  assert(formatWarning(keyed) === expectedEn, "formatWarning 在 ru 下应经回退链输出 en 文案");
  // 两级均缺失才回退 fallback / 裸 key(既有语义保持)
  assert(formatWarning({ key: "no.such.key", fallback: "兜底文案" }) === "兜底文案", "两级均缺失时 formatWarning 应回退 fallback");
  assert(t("no.such.key") === "no.such.key", "两级均缺失时 t() 应回退 key 本身");
  // 已译键不受回退链影响:ru 直接命中
  assert(t("app.title") === DICT.ru["app.title"], "ru 已译键应直接命中,不经 en");
  setLanguage("zh");
  assert(t("app.title") === DICT.zh["app.title"], "切回 zh 后恢复中文(状态可复原地测试)");
  console.log("[ok] i18n-registry:(b) 回退链 ru→en→key + formatWarning 同链路 断言通过");

  // ================= (c) htmlLang 映射(BCP 47) =================
  const EXPECTED_HTML_LANG = {
    zh: "zh-CN",
    en: "en",
    ja: "ja",
    ko: "ko",
    fr: "fr",
    ru: "ru",
  };
  for (const { code } of LANGUAGES) {
    assert(
      htmlLangOf(code) === EXPECTED_HTML_LANG[code],
      `htmlLangOf(${code}) 应为 "${EXPECTED_HTML_LANG[code]}",实际 "${htmlLangOf(code)}"`,
    );
    assert(isLanguage(code) === true, `isLanguage(${code}) 应为 true(注册表内)`);
  }
  assert(isLanguage("xx") === false && isLanguage("de") === false && isLanguage(1) === false,
    "isLanguage 未注册值/非字符串应拒绝");
  console.log(`[ok] i18n-registry:(c) htmlLang 映射正确(${LANGUAGES.map((l) => `${l.code}→${l.htmlLang}`).join(", ")}) 断言通过`);

  // ================= (d) settings 校验接受全部注册语言 + 往返无损 =================
  const settingsFile = settingsJsonPath();
  const { restore } = await backupSettingsFile();
  try {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const mod = await freshSettingsModule("i18n-registry");
    const base = {
      version: 1, format: "docx", afterConvert: "none", breakBeforeH1: false, toc: true,
      pageSetup: { paper: "A4", orientation: "portrait", marginTop: 20, marginBottom: 20, marginLeft: 30, marginRight: 30 },
    };
    for (const { code } of LANGUAGES) {
      assert(mod.isValidSettings({ ...base, language: code }) === true, `isValidSettings 应接受注册语言 ${code}`);
    }
    assert(mod.isValidSettings({ ...base, language: "xx" }) === false, "isValidSettings 应拒绝未注册值 xx");
    assert(mod.isValidSettings(base) === true, "缺 language 的旧文件应合法(兜底 zh)");

    // 往返无损:新语言写入磁盘后,全新模块实例 loadSettings 原样读回
    await fs.writeFile(settingsFile, JSON.stringify({ ...base, language: "ja" }), "utf8");
    const m1 = await freshSettingsModule("i18n-rt-ja");
    assert(m1.loadSettings().language === "ja", "settings.json 写入 ja 后 loadSettings 应原样读回 ja");
    // updateSettings 写入路径往返(ko)
    const r = await freshSettingsModule("i18n-rt-ko");
    await r.updateSettings({ language: "ko" });
    const r2 = await freshSettingsModule("i18n-rt-ko2");
    assert(r2.loadSettings().language === "ko", "updateSettings(ko) 后全新实例应读回 ko");
    // 向后兼容:旧文件缺 language → 兜底 zh
    await fs.writeFile(settingsFile, JSON.stringify(base), "utf8");
    const m3 = await freshSettingsModule("i18n-rt-legacy");
    assert(m3.loadSettings().language === "zh", "旧文件缺 language 应兜底 zh");
    console.log("[ok] i18n-registry:(d) settings 校验接受全部注册语言拒绝未知值 + 新语言往返无损 + 旧文件兼容 断言通过");
  } finally {
    await restore();
    setLanguage("zh"); // 语言为模块级状态,复位避免污染后续段
  }

  // ---- (e) FOUC 引导脚本镜像路径守护 ----
  // 注册表化后 lang-bootstrap.js 不自带 code→htmlLang 映射(单一事实源 =
  // htmlLangOf 经 mirrorLanguage 持久化为 m2w.htmlLang);此断言防回退到
  // 硬编码映射的旧实现(zh/en 之外的语言会失效)。
  const bootstrapSrc = await fs.readFile(
    new URL("../../src/renderer/lang-bootstrap.js", import.meta.url),
    "utf8",
  );
  assert(
    bootstrapSrc.includes("m2w.htmlLang"),
    "lang-bootstrap.js 应读取 m2w.htmlLang 镜像(不得回退为内置 code→htmlLang 硬编码映射)",
  );
  console.log("[ok] i18n-registry:(e) lang-bootstrap 读 htmlLang 镜像(无硬编码映射回归) 断言通过");
}
