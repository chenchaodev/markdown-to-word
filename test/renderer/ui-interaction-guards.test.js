/**
 * 阶段 4 UX 缺口回归段(可观察行为 + 源契约双层断言):
 *
 * (1) 队列行 Enter/Space 不穿透拖放区
 *     - 行内 Enter/Space 必须 stopPropagation(否则被判为「容器自身目标」
 *       而打开文件对话框,叠加第二个动作);Enter 与双击同语义=预览该行;
 *       Space 只占用不误开预览。
 *     - 拖放区自身的键盘入口对行目标必须完全无动作。
 * (2) 动态状态节点不被 applyStaticTexts 覆盖
 *     - index.html 中输出目录双 chip / Logo / PDF CSS / 预设提示一律不带
 *       data-i18n(带了就等于被字典默认值覆盖真实值);
 *     - 仍保留 data-i18n 的节点,静态回退文案与 zh 字典逐字一致;
 *     - settings-panel 导出 refreshDynamicSettingsText(语言切换后的重算入口)。
 * (3) 复制反馈
 *     - 标签与「已复制」是两个独立节点,反馈只切显隐,不改写标签文案;
 *     - 单实例复位:弹窗打开即复位,反馈不跨弹窗残留。
 * (4) 取消态
 *     - 汇总条取消态既不挂 ok 也不挂 fail,图标为中性横杠;
 *     - 批量弹窗标题按结果取语义(失败 / 全取消 / 完成),不恒写「完成」。
 *
 * DOM 侧用最小 stub 直接驱动 dist renderer 模块(与 convert-command-lock 段同一套
 * 元素表约定);源码契约侧只断言「某元素的 data-i18n 缺席」这类静态事实。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installDomStub, fireListener, makeElement, makeKeyEvent } from "./dom-stub.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`ui-interaction-guards 断言失败:${msg}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const distUrl = (rel) => pathToFileURL(path.join(repoRoot, "dist", rel)).href;

/** 取 index.html 中指定 id 的元素标签文本(源契约断言用)。 */
function tagOf(html, id) {
  const re = new RegExp(`<[^>]*id="${id}"[^>]*>`, "s");
  const m = re.exec(html);
  if (!m) throw new Error(`ui-interaction-guards:index.html 未找到 id="${id}"`);
  return m[0];
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ---------- 源契约:动态节点不得挂 data-i18n ----------
  const indexHtml = fs.readFileSync(path.join(repoRoot, "src", "renderer", "index.html"), "utf8");
  const DYNAMIC_IDS = [
    "quickOutputDir",
    "outputDirValue",
    "headerLogoStatus",
    "pdfCssStatus",
    "templatePresetHint",
  ];
  for (const id of DYNAMIC_IDS) {
    const tag = tagOf(indexHtml, id);
    assert(
      !tag.includes("data-i18n"),
      `动态状态节点 #${id} 不应带 data-i18n(applyStaticTexts 会用字典默认值覆盖真实值):${tag}`,
    );
  }

  // 仍保留 data-i18n 的节点:静态回退与 zh 字典逐字一致(防止改写一处漏另一处)
  const i18n = await import(distUrl("core/i18n/index.js"));
  const STATIC_KEYS = [
    "settings.presetScopeNote",
    "settings.tagNotInPreset",
    "settings.watermarkNote",
    "settings.headerFooterDefaultNote",
  ];
  for (const key of STATIC_KEYS) {
    const re = new RegExp(`data-i18n="${key}"[^>]*>([^<]*)<`, "s");
    const m = re.exec(indexHtml);
    assert(m, `index.html 应保留静态回退节点 ${key}`);
    assert(
      m[1].trim() === i18n.DICT.zh[key],
      `${key} 静态回退与 zh 字典不一致:回退=${m[1].trim()} 字典=${i18n.DICT.zh[key]}`,
    );
  }

  // ---------- DOM 行为 ----------
  let openMarkdownsCalls = 0;
  let openPreviewCalls = 0;
  const dom = installDomStub({
    api: {
      openMarkdowns: async () => { openMarkdownsCalls++; return []; },
      openPreview: async () => { openPreviewCalls++; return { ok: true }; },
      uiStateSet: async () => ({}),
    },
  });

  try {
    const dialogs = await import(distUrl("renderer/ui/dialogs.js"));
    const selection = await import(distUrl("renderer/convert/events/selection.js"));
    const { state } = await import(distUrl("renderer/state/state.js"));
    const panel = await import(distUrl("renderer/settings/settings-panel.js"));

    // (1) 队列行 Enter/Space 边界
    state.selectedFiles = ["a.md", "b.md"];
    state.mode = null;
    selection.bindSelectionEvents();

    const row = makeElement({ dataset: { index: "0" } });
    // 行目标对事件边界选择器「命中自身」(closest 返回自己),模拟真实 DOM
    row.closest = (selector) => (selector.includes(".multi-item") ? row : null);

    const multiList = dom.elementFor("multiList");
    const enterEvent = makeKeyEvent("Enter", row);
    fireListener(multiList, "keydown", enterEvent);
    assert(enterEvent.propagationStopped, "队列行 Enter 必须 stopPropagation(不穿透拖放区)");
    assert(enterEvent.defaultPrevented, "队列行 Enter 应 preventDefault");
    assert(openPreviewCalls === 1, `队列行 Enter 应预览该行,实际 openPreview=${openPreviewCalls}`);

    const spaceEvent = makeKeyEvent(" ", row);
    fireListener(multiList, "keydown", spaceEvent);
    assert(spaceEvent.propagationStopped, "队列行 Space 必须 stopPropagation(不穿透拖放区)");
    assert(spaceEvent.defaultPrevented, "队列行 Space 应 preventDefault(不滚动列表)");
    assert(openPreviewCalls === 1, "队列行 Space 只占用,不触发预览(避免误开窗口)");

    // 拖放区自身入口对行目标必须无动作
    const dropZone = dom.elementFor("dropZone");
    const beforeMarkdowns = openMarkdownsCalls;
    const rowOnZone = makeKeyEvent("Enter", row);
    fireListener(dropZone, "keydown", rowOnZone);
    assert(!rowOnZone.defaultPrevented, "拖放区键盘入口不得对队列行目标生效");
    assert(openMarkdownsCalls === beforeMarkdowns, "拖放区不得因队列行按键打开文件对话框");

    // 行外目标(纸面空白)仍应照常打开对话框(边界不得收得太紧)
    const paper = makeElement();
    paper.closest = () => null;
    const paperEvent = makeKeyEvent("Enter", paper);
    fireListener(dropZone, "keydown", paperEvent);
    assert(paperEvent.defaultPrevented, "纸面空白处的 Enter 仍应打开文件对话框");
    assert(openMarkdownsCalls === beforeMarkdowns + 1, "纸面空白 Enter 应恰好触发一次 openDialog");

    // (3) 复制反馈:只切显隐,不改写标签
    const label = dom.elementFor("completeDialogCopyLabel");
    const ok = dom.elementFor("completeDialogCopyOk");
    label.classList.remove("hidden");
    ok.classList.add("hidden");
    dialogs.showCopyFeedback();
    assert(label.classList.contains("hidden"), "复制反馈期间标签应隐藏");
    assert(!ok.classList.contains("hidden"), "复制反馈期间「已复制」应显示");
    assert(label.textContent === "", "复制反馈不得改写标签文案(会抹掉 data-i18n)");

    // 弹窗打开即复位(不得跨弹窗残留)
    dialogs.showCopyFeedback();
    dialogs.showCompleteDialog("C:\\out\\a.docx");
    assert(!label.classList.contains("hidden"), "完成弹窗打开应复位复制反馈(标签恢复)");
    assert(ok.classList.contains("hidden"), "完成弹窗打开应复位复制反馈(反馈消失)");

    // (4) 取消态:中性、不挂 ok/fail
    const resultSummary = dom.elementFor("resultSummary");
    const iconPath = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    dom.elementFor("summaryIcon").querySelector = () => iconPath;

    dialogs.showSummary({ kind: "canceled", title: "已取消" });
    assert(resultSummary.classList.contains("result-summary--canceled"), "取消态应挂 canceled 修饰类");
    assert(!resultSummary.classList.contains("result-summary--ok"), "取消态不得显示成功绿态");
    assert(!resultSummary.classList.contains("result-summary--fail"), "取消态不得显示失败红态");
    assert(iconPath.attrs.d === "M6 12h12", `取消态图标应为中性横杠,实际 ${iconPath.attrs.d}`);

    dialogs.showSummary({ kind: "ok", title: "完成" });
    assert(resultSummary.classList.contains("result-summary--ok"), "成功态应挂 ok 修饰类");
    assert(!resultSummary.classList.contains("result-summary--canceled"), "成功态不得残留 canceled 修饰类");
    assert(iconPath.attrs.d === "M20 6L9 17l-5-5", "成功态图标应为对勾");

    dialogs.showSummary({ kind: "fail", title: "失败", error: "x" });
    assert(resultSummary.classList.contains("result-summary--fail"), "失败态应挂 fail 修饰类");
    assert(!resultSummary.classList.contains("result-summary--ok"), "失败态不得残留 ok 修饰类");

    // (4) 批量弹窗标题按结果取语义
    const titleEl = dom.elementFor("batchDialogTitle");
    const batchResult = (over) => ({
      items: [],
      okCount: 0,
      failCount: 0,
      canceledCount: 0,
      ...over,
    });
    dialogs.showBatchDialog(batchResult({ okCount: 2 }));
    assert(
      titleEl.textContent === i18n.DICT.zh["dialog.batch.title"],
      `全成功标题应为「${i18n.DICT.zh["dialog.batch.title"]}」,实际 ${titleEl.textContent}`,
    );
    dialogs.showBatchDialog(batchResult({ okCount: 1, failCount: 1 }));
    assert(
      titleEl.textContent === i18n.DICT.zh["convert.batch.failedTitle"],
      `含失败标题应为失败标题,实际 ${titleEl.textContent}`,
    );
    dialogs.showBatchDialog(batchResult({ canceledCount: 2 }));
    assert(
      titleEl.textContent === i18n.DICT.zh["common.canceled"],
      `全取消标题应为中性取消标题,实际 ${titleEl.textContent}`,
    );

    // (2) 动态节点重算入口存在
    assert(
      typeof panel.refreshDynamicSettingsText === "function",
      "settings-panel 应导出 refreshDynamicSettingsText(语言切换后重算动态节点)",
    );
    assert(
      typeof panel.syncOutputDirDisplay === "function" &&
        typeof panel.syncPdfCssState === "function" &&
        typeof panel.syncHeaderLogoDisplay === "function",
      "settings-panel 应导出三个动态节点同步函数(单一来源)",
    );

    const appBindingsSource = fs.readFileSync(
      path.join(repoRoot, "src", "renderer", "settings", "settings-bindings-app.ts"),
      "utf8",
    );
    assert(
      /applyStaticTexts\(\);[\s\S]{0,400}refreshDynamicSettingsText\(\);/.test(appBindingsSource),
      "语言切换必须先刷静态文案再重算动态节点(顺序颠倒会让动态节点停在旧语言)",
    );

    const dialogsCss = fs.readFileSync(
      path.join(repoRoot, "src", "renderer", "style", "dialogs.css"),
      "utf8",
    );
    assert(
      /\.result-summary--canceled\s*\{[\s\S]{0,120}border-color:\s*var\(--line\)/.test(dialogsCss),
      "取消态边框应为中性发丝线(不得沿用成功绿/失败红)",
    );
    assert(
      /\.result-summary--canceled \.result-summary-icon\s*\{[\s\S]{0,120}color:\s*var\(--mut\)/.test(dialogsCss),
      "取消态图标应为 --mut 弱化色",
    );
    assert(
      /\.batch-item--canceled \.batch-item-icon\s*\{[\s\S]{0,120}color:\s*var\(--mut\)/.test(dialogsCss),
      "批量条目取消图标应为 --mut 弱化色",
    );

    console.log("[ok] ui-interaction-guards:队列行键盘边界 / 动态节点不被覆盖 / 复制反馈复位 / 取消中性态与批量标题 断言通过");
  } finally {
    dom.restore();
  }
}
