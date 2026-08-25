/**
 * 恒等断言守护段(TEST-5:已知双源全部纳入运行期守护;跨 src/core 与 src/renderer
 * 只读 import,经 dist 断言):
 * (a) renderer state/pure.ts STAGE_TEXT / formatRecentTime 的 zh 默认文案 ↔
 *     core i18n 字典(zh.ts)convert.stage.* / recent.time.* 逐字相等(MR-1;
 *     pure 层零 import 约束导致 zh 原文双份,漂移在此即时暴露);
 * (b) MAX_RECENT_FILES:main persist/ui-state.ts(导出常量)↔ renderer ui/recent-files.ts
 *     (模块私有未导出,MR-4——经源码文本提取恒等断言,改任一侧未同步即失败);
 * (c) 设置默认值防御性合并双侧关键字段抽样一致(MR-11):main persist/settings.ts
 *     loadSettings sanitize ↔ renderer settings-logic.ts mergeSettingsWithDefaults,
 *     以「旧版合法文件缺字段」与「完整合法文件」两场景对比双侧产出;
 * (d) 行内 HTML 白名单表达式扫描双份算法对同一组样本产出一致(CORE-11 双向指针):
 *     core/markdown/html-whitelist.ts isAllowedInlineHtml(整串布尔判定)↔
 *     core/docx/handlers/inline-html.ts normalizeInlineHtml + parseInlineHtml
 *     (节点流合并扫描),白名单接受性必须逐样本一致。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DICT } from "../../dist/core/i18n/index.js";
import { STAGE_TEXT, stageText, formatRecentTime } from "../../dist/renderer/state/pure.js";
import { MAX_RECENT_FILES as MAIN_MAX_RECENT_FILES } from "../../dist/main/persist/ui-state.js";
import { mergeSettingsWithDefaults } from "../../dist/renderer/settings/settings-logic.js";
import { isAllowedInlineHtml } from "../../dist/core/markdown/html-whitelist.js";
import { normalizeInlineHtml, parseInlineHtml } from "../../dist/core/docx/handlers/inline-html.js";
import { backupSettingsFile, freshSettingsModule, settingsJsonPath } from "../common/settings.js";
import { ROOT } from "../common/paths.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`identity-guards 断言失败:${msg}`);
}

/** i18n 模板插值(镜像 t() 的 ${name} 占位语义,仅测试用) */
function interpolate(template, params = {}) {
  return template.replace(/\$\{(\w+)\}/g, (_, k) => String(params[k] ?? `\${${k}}`));
}

/** 键序无关的稳定序列化(对象比较用) */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 把白名单表达式按 micromark 方式拆为 html/text 节点流(docx 扫描器输入形态) */
function splitHtmlNodes(expr) {
  const nodes = [];
  let last = 0;
  const tagRe = /<[^<>]*>/g; // 循环外持有 lastIndex 才能推进(字面量置于循环内会死循环)
  for (let m = tagRe.exec(expr); m !== null; m = tagRe.exec(expr)) {
    if (m.index > last) nodes.push({ type: "text", value: expr.slice(last, m.index) });
    nodes.push({ type: "html", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < expr.length) nodes.push({ type: "text", value: expr.slice(last) });
  return nodes;
}

/** docx 侧扫描器对整串表达式的接受判定:normalize 后应合并出等于原串的 html 节点 */
function docxScannerAccepts(expr) {
  return normalizeInlineHtml(splitHtmlNodes(expr)).some((n) => n.type === "html" && n.value === expr);
}

export async function run() {
  // ================= (a) zh 文案恒等:STAGE_TEXT / formatRecentTime ↔ i18n 字典 zh =================
  for (const [stage, text] of Object.entries(STAGE_TEXT)) {
    const key = `convert.stage.${stage}`;
    assert(
      DICT.zh[key] === text,
      `STAGE_TEXT.${stage}("${text}") 应与字典 ${key}("${DICT.zh[key]}")逐字相等`,
    );
  }
  // stageText:默认输出 = 字典 zh 值;translate 注入时键名契约 convert.stage.*
  const fakeT = (key, params) => interpolate(DICT.zh[key] ?? `<<missing:${key}>>`, params);
  for (const stage of Object.keys(STAGE_TEXT)) {
    assert(stageText(stage) === DICT.zh[`convert.stage.${stage}`], `stageText(${stage}) 默认输出应等于字典 zh 值`);
    assert(stageText(stage, fakeT) === DICT.zh[`convert.stage.${stage}`], `stageText(${stage}) 注入翻译后应等于字典值`);
  }
  assert(stageText("no-such-stage") === "no-such-stage", "未知阶段键应原样兜底");

  // formatRecentTime 四分支:默认输出 ↔ recent.time.* 模板插值结果逐字相等
  const now = new Date(2026, 7, 24, 12, 0).getTime(); // 本地 2026-08-24 12:00
  const cases = [
    { ts: new Date(2026, 7, 24, 9, 5).getTime(), key: "recent.time.today" },
    { ts: new Date(2026, 7, 23, 18, 0).getTime(), key: "recent.time.yesterday" },
    { ts: new Date(2026, 6, 4, 8, 30).getTime(), key: "recent.time.monthDay" },
    { ts: new Date(2024, 0, 2, 23, 59).getTime(), key: "recent.time.fullDate" },
  ];
  for (const { ts, key } of cases) {
    const def = formatRecentTime(ts, now);
    const d = new Date(ts);
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const expected = interpolate(DICT.zh[key], {
      time,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    });
    assert(def === expected, `formatRecentTime(${key}) 默认输出"${def}"应与字典插值"${expected}"逐字相等`);
    assert(formatRecentTime(ts, now, fakeT) === expected, `formatRecentTime(${key}) 注入翻译后应与字典插值一致`);
  }
  console.log("[ok] identity-guards:(a) STAGE_TEXT/stageText/formatRecentTime ↔ i18n 字典 zh 逐字恒等 断言通过");

  // ================= (b) MAX_RECENT_FILES:main 导出常量 ↔ renderer 私有常量 =================
  // renderer 侧未导出(MR-4 记录在案):源码文本提取断言,重命名/改值未同步即失败
  const recentFilesSrc = await fs.readFile(path.join(ROOT, "src/renderer/ui/recent-files.ts"), "utf8");
  const m = /const MAX_RECENT_FILES = (\d+);/.exec(recentFilesSrc);
  assert(m !== null, "recent-files.ts 应存在 MAX_RECENT_FILES 常量声明(声明形态变更须同步本守护段)");
  assert(
    Number(m[1]) === MAIN_MAX_RECENT_FILES,
    `renderer MAX_RECENT_FILES(${m[1]}) 应与 main ui-state.ts(${MAIN_MAX_RECENT_FILES})恒等`,
  );
  console.log(`[ok] identity-guards:(b) MAX_RECENT_FILES 双侧恒等(${MAIN_MAX_RECENT_FILES}) 断言通过`);

  // ================= (c) 设置防御性合并双侧抽样一致:loadSettings ↔ mergeSettingsWithDefaults =================
  const { restore } = await backupSettingsFile();
  try {
    await fs.mkdir(path.dirname(settingsJsonPath()), { recursive: true });
    const mod = await freshSettingsModule("identity");

    // 场景 1:旧版合法文件(缺 toc/equationNumbering/outputDir/pdfCss/language/theme/
    // typography/customPresets)→ 双侧各自兜底后关键字段应一致
    const legacyRaw = {
      version: 1, format: "pdf", afterConvert: "open", breakBeforeH1: true,
      pageSetup: { paper: "Letter", orientation: "landscape", marginTop: 10, marginBottom: 20, marginLeft: 30, marginRight: 40 },
    };
    await fs.writeFile(settingsJsonPath(), JSON.stringify(legacyRaw), "utf8");
    const mainLoaded = mod.loadSettings(); // 全新模块实例,直读磁盘
    const merged1 = mergeSettingsWithDefaults(legacyRaw);
    const sampledKeys = ["version", "format", "afterConvert", "breakBeforeH1", "toc", "equationNumbering",
      "outputDir", "pdfCss", "language", "theme", "pageSetup", "typography", "customPresets"];
    for (const k of sampledKeys) {
      assert(
        stable(mainLoaded[k]) === stable(merged1[k]),
        `旧文件场景字段 ${k} 双侧应一致:main=${stable(mainLoaded[k])} renderer=${stable(merged1[k])}`,
      );
    }
    assert(mainLoaded.theme === "system" && mainLoaded.language === "zh" && mainLoaded.pdfCss === "",
      "旧文件缺失 theme/language/pdfCss 兜底值抽查(system/zh/\"\")");

    // 场景 2:完整合法文件 → 双侧均原样保留,全字段一致。
    // 注意 customPresets 条目须字段齐全:main 侧逐条 sanitize 会补默认值,而
    // renderer mergeSettingsWithDefaults 对 customPresets 整体透传不做条目级兜底
    // (语义差异记录:renderer 只防「缺顶层字段」,不重校验条目内容)。
    // F3:typography 须含 headingScale/headingSpacing——customPresets 条目 main 侧
    // 逐字段 sanitize 会补默认值,renderer 整体透传不补(见下方语义差异注释),
    // 条目缺新字段时双侧产出即失一致,故「完整合法文件」夹具必须字段齐全
    const fullTypography = { fontAscii: "Arial", fontEastAsia: "宋体", bodySizePt: 14, lineSpacing: 2.0, firstLineIndent: false, align: "left", headingNumbering: false, captionNumbering: false, headingScale: "standard", headingSpacing: "standard" };
    const fullPageSetup = { paper: "Letter", orientation: "landscape", marginTop: 10, marginBottom: 20, marginLeft: 30, marginRight: 40 };
    const fullRaw = {
      ...legacyRaw,
      toc: false, equationNumbering: false, outputDir: "C:\\tmp\\out",
      pdfCss: "body{}", language: "en", theme: "dark",
      typography: fullTypography,
      customPresets: [{ name: "我的模板", typography: fullTypography, pageSetup: fullPageSetup }],
    };
    await fs.writeFile(settingsJsonPath(), JSON.stringify(fullRaw), "utf8");
    const mod2 = await freshSettingsModule("identity-full");
    const mainLoaded2 = mod2.loadSettings();
    const merged2 = mergeSettingsWithDefaults(fullRaw);
    assert(stable(mainLoaded2) === stable(merged2), "完整合法文件场景双侧产出应整体一致");
    console.log("[ok] identity-guards:(c) 设置防御性合并双侧关键字段抽样一致(旧文件兜底/完整保留)断言通过");
  } finally {
    await restore();
  }

  // ================= (d) 行内 HTML 白名单:双份扫描算法同样本产出一致 =================
  // 已知边界(审计发现,记录不阻断):节点流末尾的孤立 br(如段落以 <br> 结尾且后无
  // 节点)会被 docx 侧合并循环丢弃(merge 循环至少追加一个后续节点才判定),而白名单侧
  // 接受——视觉上段尾换行无意义,视为无害分歧;本段样本一律带尾随文本(micromark
  // 常规输出形态),该边界不在一致性样本内。
  const validSamples = [
    "<strong>粗</strong>",
    "<b>x</b>",
    "<em>a<em>b</em>c</em>", // 同标签嵌套
    "<strong><em>x</em></strong>", // 异标签嵌套
    "<strong >带尾随空白</strong >", // 开闭标签尾随空白合法
    "<br>换行", // 独立 br(带尾随文本)
    "<br/>自闭合", // 自闭合 br(B3)
    "<br /> 带空格自闭合",
    "<mark>a</MARK>", // 闭标签大小写归一
  ];
  const invalidSamples = [
    '<div class="x">a</div>', // 非白名单标签
    "<script>x</script>", // 危险标签
    '<strong class="x">a</strong>', // 带属性开标签
    "<span/>", // 非空标签自闭合(保守不放行)
    "<u>a", // 未闭合
    "<strong>a</strong", // 闭标签未闭合
    "</u>a", // 孤立闭标签
    "<em>a</em></em>", // 多余闭标签(错配)
    "a < b", // 文本段裸 <
  ];
  for (const expr of validSamples) {
    assert(isAllowedInlineHtml(expr) === true, `白名单侧应接受:${expr}`);
    assert(docxScannerAccepts(expr) === true, `docx 扫描器应接受(合并出原串):${expr}`);
  }
  for (const expr of invalidSamples) {
    assert(isAllowedInlineHtml(expr) === false, `白名单侧应拒绝:${expr}`);
    assert(docxScannerAccepts(expr) === false, `docx 扫描器应拒绝(不合并出原串):${expr}`);
  }
  // 相邻两组表达式专项:白名单侧整串接受(栈清空即合法);docx 侧按「各自构成
  // 完整表达式」分别合并为两个 html 节点——两侧对每个子表达式的接受性一致,
  // 且内容均不丢失(结构差异记录:docx 合并粒度 = 单个完整表达式)。
  const adjacentExpr = "<code>x</code><kbd>y</kbd>";
  assert(isAllowedInlineHtml(adjacentExpr) === true, "相邻两组表达式整串应被白名单接受");
  const adjacentNodes = normalizeInlineHtml(splitHtmlNodes(adjacentExpr)).filter((n) => n.type === "html");
  assert(
    adjacentNodes.length === 2 &&
      adjacentNodes[0].value === "<code>x</code>" &&
      adjacentNodes[1].value === "<kbd>y</kbd>",
    `docx 扫描器应将相邻表达式合并为两个独立 html 节点,实际 ${JSON.stringify(adjacentNodes.map((n) => n.value))}`,
  );
  // parseInlineHtml 对合法表达式的内容重建:文本项拼接 = 剥除全部标签后的纯文本
  for (const expr of validSamples) {
    const items = parseInlineHtml(expr);
    const rebuilt = items.map((it) => ("break" in it ? "" : it.text)).join("");
    assert(
      rebuilt === expr.replace(/<[^<>]*>/g, ""),
      `parseInlineHtml 文本重建应等于剥标签纯文本:${expr} → "${rebuilt}"`,
    );
  }
  // br 专项:每个 br 标签(含自闭合)恰产出一个 break 项
  const brItems = parseInlineHtml("a<br>b<br/>c<br />d");
  assert(brItems.filter((it) => "break" in it).length === 3, "3 个 br 变体应各产出一个 break 项");
  console.log("[ok] identity-guards:(d) 行内 HTML 白名单双份扫描算法样本产出一致 + 相邻表达式 + parseInlineHtml 重建 断言通过");
}
