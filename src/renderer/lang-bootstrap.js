// FOUC 缓解(B6 i18n 收口,最小方案):尽早按持久化语言镜像设置 <html lang>。
// 语言真源在 settings.json(经主进程);renderer 在语言设置/切换落定时镜像写入
// localStorage("m2w.language" 与 "m2w.htmlLang",后者值来自注册表 htmlLangOf
// 单源,见 settings-panel.ts mirrorLanguage),本脚本在 <head> 同步执行期读取
// 镜像并设置 <html lang>——只消 lang/字体方向性闪烁,不做文案替换(静态文案
// 仍由 applyStaticTexts 在应用初始化时替换)。
// htmlLang 镜像化(2026-08-24,i18n 注册表化跟进):本脚本不再自带 code→htmlLang
// 映射——原 zh/en 硬编码在多语言注册表化后对新增语言失效。优先读 "m2w.htmlLang"
// 镜像;旧版仅写 language 镜像时走下方遗留回退(zh/en,历史行为等价),首次启动
// applyStaticTexts 纠正 + mirrorLanguage 回填后即被镜像路径接管。
// 选型记录:未采用内联脚本——index.html CSP 为 script-src 'self',内联被拦;
// 亦未采用「body 初始 visibility:hidden」方案(初始化失败会白屏),本方案改动最小。
(function () {
  try {
    var htmlLang = localStorage.getItem("m2w.htmlLang");
    if (htmlLang) {
      document.documentElement.lang = htmlLang;
      return;
    }
    // 遗留回退:旧版本只写语言代码镜像(注册表化之前),仅覆盖 zh/en
    var lang = localStorage.getItem("m2w.language");
    if (lang === "en") {
      document.documentElement.lang = "en";
    } else if (lang === "zh") {
      document.documentElement.lang = "zh-CN";
    }
    // 无镜像/值非法:保持 HTML 默认 zh-CN(与默认语言一致)
  } catch {
    /* localStorage 不可用时保持默认 lang */
  }
})();
