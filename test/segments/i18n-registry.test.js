/**
 * i18n 多语言注册表守护段(方案A 字典拆分改造):
 * 经 dist 断言(与既有段一致),覆盖四类回归面:
 * (a) 键集包含关系:en 键集 = zh 键集(satisfies 全量约束的运行期冒烟);
 *     各 Partial 语言(ja)键集 ⊆ zh 键集(多键即编译期已报错,此处防运行期漂移)
 * (b) 回退链行为:当前语言 → en → key——ja 已全量翻译(无天然缺口),改为断言
 *     全字典级不变量:ja 下遍历全部 zh 键 t() 永不返回裸 key(en 全量兜底);
 *     另保留两级均缺失分支(formatWarning fallback / t 裸 key)断言
 * (c) htmlLang 映射:htmlLangOf 对全部注册语言返回 BCP 47 期望值(zh→zh-CN 等)
 * (d) settings 校验派生:isValidSettings 接受全部注册语言码;非法/未注册语言码
 *     不再整文件拒绝,loadSettings 字段级兜底 zh(语言裁撤迁移:已存 ko/fr/ru
 *     用户仅语言回退,其余偏好保留);settings.json 往返无损;旧文件缺 language 兜底 zh
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
  // ja 已全量翻译(无天然缺口),夹具升级为全字典级不变量:ja 下遍历全部 zh 键,
  // t() 永不返回裸 key——任何键缺失于 ja 时必落 en 文案(en satisfies 全量兜底)
  setLanguage("ja");
  for (const key of zhKeys) {
    assert(t(key) !== key, `ja 下键 ${key} 不应回退裸 key(en 全量兜底失效?)`);
  }
  // en 直接命中抽查(不经 zh)
  setLanguage("en");
  assert(t("app.title") === DICT.en["app.title"], "en 当前语言应直接命中 en 字典");
  // 两级均缺失才回退 fallback / 裸 key(既有语义保持)
  setLanguage("ja");
  const keyed = { key: "no.such.key", params: { error: "E" }, fallback: "兜底文案" };
  assert(formatWarning(keyed) === "兜底文案", "两级均缺失时 formatWarning 应回退 fallback");
  assert(t("no.such.key") === "no.such.key", "两级均缺失时 t() 应回退 key 本身");
  // 已译键不受回退链影响:ja 直接命中
  assert(t("app.title") === DICT.ja["app.title"], "ja 已译键应直接命中,不经 en");
  setLanguage("zh");
  assert(t("app.title") === DICT.zh["app.title"], "切回 zh 后恢复中文(状态可复原地测试)");
  console.log("[ok] i18n-registry:(b) 回退链全字典不变量(ja 下无裸 key,en 兜底)+ 两级均缺失分支 断言通过");

  // ================= (c) htmlLang 映射(BCP 47) =================
  const EXPECTED_HTML_LANG = {
    zh: "zh-CN",
    en: "en",
    ja: "ja",
  };
  for (const { code } of LANGUAGES) {
    assert(
      htmlLangOf(code) === EXPECTED_HTML_LANG[code],
      `htmlLangOf(${code}) 应为 "${EXPECTED_HTML_LANG[code]}",实际 "${htmlLangOf(code)}"`,
    );
    assert(isLanguage(code) === true, `isLanguage(${code}) 应为 true(注册表内)`);
  }
  // 裁撤语言回归守卫:ko/fr/ru 不再是合法值(isLanguage 由注册表派生,误回加/漏删即失败)
  assert(
    isLanguage("ko") === false && isLanguage("fr") === false && isLanguage("ru") === false,
    "isLanguage 应拒绝已裁撤的 ko/fr/ru",
  );
  assert(isLanguage("xx") === false && isLanguage("de") === false && isLanguage(1) === false,
    "isLanguage 未注册值/非字符串应拒绝");
  console.log(`[ok] i18n-registry:(c) htmlLang 映射正确(${LANGUAGES.map((l) => `${l.code}→${l.htmlLang}`).join(", ")}) + ko/fr/ru 已裁撤 断言通过`);

  // ================= (d) settings 校验:注册语言接受 + 裁撤语言字段级迁移兜底 =================
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
    // 语言裁撤迁移语义:非法/未注册语言码不再整文件拒绝(否则 ko/fr/ru 用户
    // 全部偏好被默认值覆盖),由 loadSettings 字段级兜底 zh
    assert(mod.isValidSettings({ ...base, language: "xx" }) === true, "未注册语言码不应整文件拒绝(字段级兜底)");
    assert(mod.isValidSettings(base) === true, "缺 language 的旧文件应合法(兜底 zh)");

    // 往返无损:新语言写入磁盘后,全新模块实例 loadSettings 原样读回
    await fs.writeFile(settingsFile, JSON.stringify({ ...base, language: "ja" }), "utf8");
    const m1 = await freshSettingsModule("i18n-rt-ja");
    assert(m1.loadSettings().language === "ja", "settings.json 写入 ja 后 loadSettings 应原样读回 ja");

    // 裁撤语言迁移(核心):已存 ko → loadSettings 回退 zh,其余偏好原样保留
    const migrated = {
      ...base,
      language: "ko",
      outputDir: "C:\\docs\\out",
      theme: "dark",
      typography: { fontAscii: "Arial", fontEastAsia: "宋体", bodySizePt: 12, lineSpacing: 1.5, firstLineIndent: true, align: "justify", headingNumbering: true, captionNumbering: true },
    };
    await fs.writeFile(settingsFile, JSON.stringify(migrated), "utf8");
    const m2 = await freshSettingsModule("i18n-migrate-ko");
    const loadedKo = m2.loadSettings();
    assert(loadedKo.language === "zh", `已存 ko 应字段级兜底 zh,实际 ${loadedKo.language}`);
    assert(loadedKo.outputDir === "C:\\docs\\out", "语言迁移不应波及其他偏好(outputDir 保留)");
    assert(loadedKo.theme === "dark", "语言迁移不应波及其他偏好(theme 保留)");
    assert(loadedKo.typography.fontEastAsia === "宋体", "语言迁移不应波及其他偏好(typography 保留)");
    // updateSettings 写入路径同样字段级兜底(ko 补丁 → zh)
    await fs.writeFile(settingsFile, JSON.stringify({ ...base, language: "en" }), "utf8");
    const r = await freshSettingsModule("i18n-rt-patch");
    await r.updateSettings({ language: "ko" });
    const r2 = await freshSettingsModule("i18n-rt-patch2");
    assert(r2.loadSettings().language === "zh", "updateSettings(ko) 应字段级兜底 zh");
    // 向后兼容:旧文件缺 language → 兜底 zh
    await fs.writeFile(settingsFile, JSON.stringify(base), "utf8");
    const m3 = await freshSettingsModule("i18n-rt-legacy");
    assert(m3.loadSettings().language === "zh", "旧文件缺 language 应兜底 zh");
    console.log("[ok] i18n-registry:(d) 注册语言接受 + 裁撤语言(ko/fr/ru)字段级迁移兜底 zh 且其余偏好保留 + 往返无损 断言通过");
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
