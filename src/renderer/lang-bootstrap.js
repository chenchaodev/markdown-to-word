/**
 * 首屏语言闪烁(FOUC)缓解:在 <head> 里**同步**执行,只把 <html lang> 摆到正确值。
 *
 * 为什么必须同步、且只能用外部脚本:① 异步执行(等价于没用)之后,首屏已经用错字体渲染过
 *   一帧 —— lang 影响字体回退与文字方向,用户看到的是字形切换;② 不用内联脚本,因为
 *   index.html 的 CSP 是 `script-src 'self'`,内联会被直接拦下(失败即白屏);③ 不用
 *   「body 初始 visibility:hidden」,初始化失败路径会白屏而不是显示错语言。
 *
 * 不变量在哪:
 * ① 本脚本**不自带** code→htmlLang 映射表 —— 语言注册表化(zh.ts 为键集事实源)之后,
 *   硬编码的 zh/en 两行对任何新增语言都失效,而它的失效形态是「静默用错 lang」,不报错。
 *   故只读主进程侧落盘时顺手镜像的 "m2w.htmlLang"(注册表 htmlLangOf 单源,写入点在
 *   settings-panel.ts 的 mirrorLanguage),下方 zh/en 分支是**仅供旧版本数据**的遗留回退,
 *   不是新增语言的入口。
 * ② 只改 lang、不换文案:静态文案仍由 applyStaticTexts 在应用初始化时替换,那是唯一的
 *   文案替换点。
 * ③ localStorage 不可用(隐私模式等)时保持 HTML 默认 lang,不抛错 —— 首屏语言不是核心功能。
 */
// FOUC 缓解:尽早按持久化语言镜像设置 <html lang>。
// 语言真源在 settings.json(经主进程);renderer 在语言设置/切换落定时镜像写入
// localStorage("m2w.language" 与 "m2w.htmlLang",后者值来自注册表 htmlLangOf
// 单源,见 settings-panel.ts mirrorLanguage),本脚本在 <head> 同步执行期读取
// 镜像并设置 <html lang>——只消 lang/字体方向性闪烁,不做文案替换(静态文案
// 仍由 applyStaticTexts 在应用初始化时替换)。
// htmlLang 镜像化:本脚本不再自带 code→htmlLang 映射——原 zh/en 硬编码在多语言
// 注册表化后对新增语言失效。优先读 "m2w.htmlLang" 镜像;旧版仅写 language 镜像时
// 走下方遗留回退(zh/en,历史行为等价),首次启动 applyStaticTexts 纠正 + mirrorLanguage
// 回填后即被镜像路径接管。
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
