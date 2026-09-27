// @ts-check
/**
 * 预检覆盖批量 / 合并路径 + 报告对话框按文件分组(行为层断言):
 *
 * (1) 逐文件预检:合并 / 批量各自对**每个源文件**各发一次 window.api.precheck,
 *     顺序与源文件列表一致(合并时「未闭合围栏吞掉后一个文件」正是靠逐文件查出的)。
 * (2) 用户决策门:有告警时 convertMerge / convertBatch 在用户点「继续转换」之前
 *     不得被调用;点「取消」则整条命令中止(两个转换 API 都不被调用)。
 * (3) 报告按文件分组:两个文件各有告警 → 渲染两组,组头是 h3 文件标识、组内是
 *     该文件的告警;只有一组告警时保持扁平列表(单文件场景不多出一行标识)。
 * (4) 文件标识用文件名(完整路径挂 title);同名文件回退全路径,免得两组同名等于没分。
 * (5) 预检异常不阻断主流程(该文件跳过、其余照常);预检 busy → 状态行提示并中止。
 * (6) 预检进行中重复发起命令不并发(单实例 flight 复用,不多发预检、不多发转换)。
 * (7) 粘贴直转(selection 域,此前**完全没有**预检)收口后自然覆盖:先预检临时
 *     文件、决策后才转换、收尾恢复按钮。
 * (8) 守护:预检只在三个命令函数内部,调用点不得再自带 withPrecheck(唯一例外是
 *     成书向导借锁 —— 它用 withPrecheck([]) 把「付印 docx+pdf」当一条命令)。
 * (9) 合并阻断(用户 2026-09-27 定):合并命中 blocksMerge 告警 → 不弹报告框、
 *     不调 convertMerge、走合并既有失败路径呈现(含文件+行号+后果)、界面恢复可用;
 *     多个文件带阻断时详报第一个 + 「另有 N 个」。单文件 / 批量**一字不改**:
 *     同样带 blocksMerge 的围栏告警在它们那里仍然只弹报告、可点继续。
 * (10) 阻断信息的文件名与报告弹窗同一判据:默认文件名,本次预检的文件里出现同名
 *     就回退全路径(含同名的干净文件);名字互不相同则不因「多文件」退化成全路径。
 *
 * 焦点陷阱与关闭后焦点回归由 focus-return-guards 段守(预检弹窗两条断言已在其中),
 * 本段不重复;组头标签用 createElement 记名后逐节点断言。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installDomStub, fireListener, makeElement } from "./dom-stub.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`precheck-multi-file 断言失败:${msg}`);
}

/** 冲刷微任务与宏任务,让 void 启动的命令链跑到下一个挂起点。 */
async function flush() {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 未闭合围栏告警夹具(键与 core precheck 一致,文案经字典渲染)。 */
const fenceWarning = (/** @type {number} */ lineNo) => ({
  key: "warn.unclosedCodeFence",
  params: { lineNo },
  fallback: `代码围栏没有闭合(第 ${lineNo} 行开始)`,
});

/**
 * 会阻断合并的未闭合围栏告警:core 的该告警恒带 blocksMerge 信号
 * (见 core/pipeline/precheck.ts 与 core/i18n.ts 的 KeyedWarning)。
 */
const blockingFence = (/** @type {number} */ lineNo) => ({
  ...fenceWarning(lineNo),
  blocksMerge: /** @type {const} */ (true),
});

/** 不阻断合并的告警夹具(未配对公式定界符 —— 危害止于本文件)。 */
const unpairedMath = () => ({
  key: "warn.unpairedMathDelimiter",
  params: { snippet: "a + b" },
  fallback: "公式定界符 $ 未配对(疑似:a + b)",
});

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  /** @param {string} rel @returns {string} */
  const distUrl = (rel) => pathToFileURL(path.resolve(here, "../../dist/renderer", rel)).href;

  /** 预检请求的源文件序列(断言「每文件一次」的唯一依据)。 */
  /** @type {string[]} */
  const precheckPaths = [];
  /** 未决预检的结算入口(逐个文件发起,故需逐条结算)。 */
  /** @type {Array<{ resolve: (value: unknown) => void }>} */
  const pendingPrechecks = [];
  /** @type {Array<{ files: string[]; format: string }>} */
  const mergeCalls = [];
  /** @type {Array<{ files: string[]; format: string }>} */
  const batchCalls = [];

  const dom = installDomStub({
    api: {
      precheck: () => Promise.resolve([]), // 装好后由 usePendingPrecheck 换成挂起形态
      convert: async () => ({ ok: true, outputPath: "out.docx", warnings: [] }),
      convertMerge: async (/** @type {string[]} */ files, /** @type {string} */ format) => {
        mergeCalls.push({ files, format });
        return { ok: true, outputPath: `out.${format}`, warnings: [] };
      },
      convertBatch: async (/** @type {string[]} */ files, /** @type {string} */ format) => {
        batchCalls.push({ files, format });
        return {
          items: files.map((file) => ({ file, ok: true })),
          okCount: files.length,
          failCount: 0,
          canceledCount: 0,
          canceled: false,
        };
      },
      convertCancel: async () => undefined,
      onConvertProgress: () => () => {},
      onBatchProgress: () => () => {},
      uiStateSet: async () => ({}),
    },
  });
  // 记下标签名:组头必须是语义标题元素(h3),而 stub 元素默认不记
  dom.document.createElement = (/** @type {string} */ tag = "div") => {
    const el = dom.withFocus(makeElement());
    /** @type {any} */ (el).tagName = tag.toUpperCase();
    return el;
  };

  /** @param {string} id @returns {import("./dom-stub.js").StubElement} */
  const elementFor = (id) => dom.elementFor(id);
  /** 预检实现:挂起待结算(默认形态,便于观察「逐文件、按序」)。 */
  const usePendingPrecheck = () => {
    /** @type {any} */ (globalThis.window).api.precheck = (
      /** @type {string} */ filePath,
    ) => {
      precheckPaths.push(filePath);
      return new Promise((resolve) => {
        pendingPrechecks.push({ resolve });
      });
    };
  };
  /** 换掉预检实现(抛错 / busy 等即时结算的用例用)。 */
  const usePrecheck = (
    /** @type {(filePath: string) => Promise<unknown>} */ impl,
  ) => {
    /** @type {any} */ (globalThis.window).api.precheck = (
      /** @type {string} */ filePath,
    ) => {
      precheckPaths.push(filePath);
      return impl(filePath);
    };
  };
  /** 结算下一条未决预检。 */
  const settleNext = (/** @type {unknown} */ result) => {
    const next = pendingPrechecks.shift();
    assert(next, "预期有一条未决预检请求(预检条数与用例不符?)");
    next.resolve(result);
  };
  /** @returns {import("./dom-stub.js").StubElement[]} 报告列表的子节点 */
  const listChildren = () => /** @type {import("./dom-stub.js").StubElement[]} */ (
    elementFor("precheckList").children ?? []
  );
  /** 点「继续转换」/「取消」(模拟用户决策)。 */
  const clickDecision = (/** @type {boolean} */ ok) =>
    fireListener(elementFor(ok ? "precheckContinue" : "precheckCancel"), "click");
  /** 状态行文本(顶部一行字);命名避开用例里的局部变量 statusText。 */
  const statusLine = () => /** @type {string} */ (elementFor("status").textContent);
  /** 汇总卡标题(合并未执行 / 合并失败 都落在这里)。 */
  const cardTitle = () => /** @type {string} */ (elementFor("summaryText").textContent);
  /** 汇总卡里的长错误文本(阻断详情只在这里出现一次)。 */
  const cardError = () => /** @type {string} */ (elementFor("summaryError").textContent);
  /** 取子节点里的元素(列表容器只挂元素,跳过文本节点只是防御)。 */
  const childElements = (/** @type {import("./dom-stub.js").StubElement} */ parent) =>
    /** @type {import("./dom-stub.js").StubElement[]} */ (
      (parent.children ?? []).filter((/** @type {unknown} */ node) => typeof node !== "string")
    );
  // 计数一律经读取函数取值:断言函数的类型收窄会把 length 锁在上一次比较的字面量上,
  // 而这些计数由被测回调在断言之间递增。
  const preCount = () => precheckPaths.length;
  const mergeCount = () => mergeCalls.length;
  const batchCount = () => batchCalls.length;

  const mergeFiles = ["C:\\work\\a.md", "C:\\work\\b.md"];

  try {
    const flow = await import(distUrl("convert/convert-flow.js"));
    const dialogs = await import(distUrl("ui/dialogs.js"));
    const i18n = await import(pathToFileURL(path.resolve(here, "../../dist/core/i18n/index.js")).href);
    // t / setLanguage 不在 i18n/index.js 的导出面上,按 i18n-registry 段的同款从
    // core/i18n.js 取(注册表面只出 DICT / LANGUAGES / isLanguage / htmlLangOf)
    const i18nApi = await import(pathToFileURL(path.resolve(here, "../../dist/core/i18n.js")).href);
    const { state } = await import(distUrl("state/state.js"));
    // 结果弹窗会把「模态可见」置起来挡住后续用例;本段只关心预检门
    state.suppressCompleteDialog = true;
    state.selectedFormat = "docx";
    state.selectedFiles = mergeFiles;
    usePendingPrecheck();

    /* ---------- 1. 合并:逐文件预检 + 决策前不转换 + 预检期单实例 ---------- */
    const mergeChain = flow.runMerge({ files: mergeFiles, format: "docx" });
    await flush();
    assert(
      preCount() === 1 && precheckPaths[0] === mergeFiles[0],
      `合并应逐文件预检且按源文件顺序,实际 ${JSON.stringify(precheckPaths)}`,
    );
    assert(flow.isConvertCommandBlocked(), "预检进行中命令锁应生效(按钮随之置灰)");
    assert(mergeCount() === 0, "预检未决时不得发起合并转换");
    // 预检未决时重复发起另一条命令:复用同一条链,不并发、不多发预检
    void flow.runBatch();
    await flush();
    assert(
      preCount() === 1,
      `预检进行中重复发起命令不得并发再发预检,实际 ${JSON.stringify(precheckPaths)}`,
    );
    assert(batchCount() === 0, "被复用的第二条命令不得自行发起转换");
    settleNext([fenceWarning(7)]);
    await flush();
    assert(
      preCount() === 2 && precheckPaths[1] === mergeFiles[1],
      `第二个源文件应在前一个结算后再查,实际 ${JSON.stringify(precheckPaths)}`,
    );
    settleNext([fenceWarning(3)]);
    await flush();
    assert(
      elementFor("precheckDialog").classList.contains("hidden") === false,
      "有告警时应弹出预检报告",
    );
    assert(mergeCount() === 0, "用户决策前不得调用 convertMerge");

    /* ---------- 2. 报告按文件分组 ---------- */
    const groups = listChildren();
    assert(groups.length === 2, `两个文件各有告警时应渲染两个分组,实际 ${groups.length}`);
    assert(
      groups.every((group) => group.className === "precheck-group"),
      `分组容器应挂 precheck-group,实际 ${JSON.stringify(groups.map((g) => g.className))}`,
    );
    const [titleA, itemsA] = childElements(groups[0] ?? elementFor("__none__"));
    const [titleB, itemsB] = childElements(groups[1] ?? elementFor("__none__"));
    assert(
      /** @type {any} */ (titleA)?.tagName === "H3" && /** @type {any} */ (titleB)?.tagName === "H3",
      `组头应是标题元素 h3(读屏按层级播报),实际 ${JSON.stringify([
        /** @type {any} */ (titleA)?.tagName,
        /** @type {any} */ (titleB)?.tagName,
      ])}`,
    );
    assert(
      titleA?.className === "precheck-group-title" &&
        titleA.textContent === "a.md" &&
        titleA.title === "C:\\work\\a.md",
      `组头应为文件标识(文件名 + 完整路径 title),实际 ${JSON.stringify({
        cls: titleA?.className,
        text: titleA?.textContent,
        title: titleA?.title,
      })}`,
    );
    assert(
      titleB?.className === "precheck-group-title" && titleB.textContent === "b.md",
      `第二组组头应为 b.md,实际 ${JSON.stringify(titleB?.textContent)}`,
    );
    assert(
      itemsA?.className === "precheck-group-items" &&
        childElements(itemsA).length === 1 &&
        childElements(itemsA)[0]?.className === "precheck-item",
      "组内应是该文件自己的告警行(precheck-item)",
    );
    assert(
      itemsB?.className === "precheck-group-items" && childElements(itemsB).length === 1,
      "第二组内也应有自己的告警行",
    );
    // 描述行计数 = 告警总数(2 个文件各 1 条 → 共 2 处),与分组标题不重复表达
    const descText = elementFor("precheckDesc").textContent;
    assert(
      typeof descText === "string" && descText.includes("2"),
      `报告描述行应按告警总数计数,实际 ${JSON.stringify(descText)}`,
    );

    clickDecision(true);
    await mergeChain;
    assert(mergeCount() === 1, `确认后应恰好调用一次 convertMerge,实际 ${mergeCalls.length}`);
    assert(
      mergeCalls[0]?.files.join("|") === mergeFiles.join("|") && mergeCalls[0]?.format === "docx",
      "convertMerge 应收到完整源文件列表与格式",
    );
    assert(!flow.isConvertCommandBlocked(), "命令结算后命令锁应释放");

    /* ---------- 3. 点「取消」:整条命令中止 ---------- */
    precheckPaths.length = 0;
    const cancelChain = flow.runMerge({ files: mergeFiles, format: "pdf" });
    await flush();
    settleNext([fenceWarning(1)]);
    await flush();
    settleNext([fenceWarning(2)]);
    await flush();
    const mergesBeforeCancel = mergeCalls.length;
    clickDecision(false);
    await cancelChain;
    assert(
      mergeCalls.length === mergesBeforeCancel,
      "用户点取消时不得调用 convertMerge(预检失败即中止,不改成照样转)",
    );
    assert(
      preCount() === 2,
      "取消只拦转换本身:预检已逐文件查过,不重发也不回滚",
    );

    /* ---------- 4. 单组告警:保持扁平列表,不出现分组标识 ---------- */
    precheckPaths.length = 0;
    const oneGroupChain = flow.runMerge({ files: mergeFiles, format: "docx" });
    await flush();
    settleNext([fenceWarning(1)]);
    await flush();
    settleNext([]); // 第二个文件干净 → 只有一组告警
    await flush();
    const flat = listChildren();
    assert(
      flat.length === 1 && flat[0]?.className === "precheck-item",
      `只有一个文件有告警时应保持扁平告警列表,实际 ${JSON.stringify(flat.map((n) => n.className))}`,
    );
    assert(
      flat.every((node) => node.className !== "precheck-group"),
      "单组场景不得出现分组标识行(单文件形态不许退步)",
    );
    clickDecision(true);
    await oneGroupChain;
    assert(mergeCalls.length === mergesBeforeCancel + 1, "单组告警确认后照常合并");

    /* ---------- 5. 同名文件:组头回退全路径(两组同名等于没分组) ---------- */
    precheckPaths.length = 0;
    const sameName = ["C:\\work\\x\\notes.md", "C:\\work\\y\\notes.md"];
    const sameNameChain = flow.runMerge({ files: sameName, format: "docx" });
    await flush();
    settleNext([fenceWarning(1)]);
    await flush();
    settleNext([fenceWarning(1)]);
    await flush();
    const sameTitles = listChildren().map((group) => childElements(group)[0]);
    assert(
      sameTitles.length === 2 &&
        sameTitles[0]?.textContent === sameName[0] &&
        sameTitles[1]?.textContent === sameName[1],
      `同名文件的组头应回退全路径,实际 ${JSON.stringify(sameTitles.map((n) => n?.textContent))}`,
    );
    clickDecision(true);
    await sameNameChain;

    /* ---------- 6. 预检抛错:该文件跳过,主流程不阻断 ---------- */
    precheckPaths.length = 0;
    let firstThrows = true;
    usePrecheck(async (filePath) => {
      if (firstThrows) {
        firstThrows = false;
        throw new Error("precheck 读取失败");
      }
      return filePath === mergeFiles[1] ? [fenceWarning(5)] : [];
    });
    const throwChain = flow.runMerge({ files: mergeFiles, format: "docx" });
    await flush();
    assert(
      preCount() === 2,
      `预检抛错的文件应被跳过并继续查下一个,实际 ${JSON.stringify(precheckPaths)}`,
    );
    assert(
      elementFor("precheckDialog").classList.contains("hidden") === false,
      "抛错文件之外的告警仍应正常弹报告",
    );
    const mergesBeforeThrowConfirm = mergeCalls.length;
    clickDecision(true);
    await throwChain;
    assert(
      mergeCalls.length === mergesBeforeThrowConfirm + 1,
      "预检失败不阻断主流程(确认后照常合并)",
    );

    /* ---------- 7. 预检 busy:状态行提示并中止 ---------- */
    precheckPaths.length = 0;
    usePrecheck(async () => ({ busy: true, error: "另一个转换正在进行" }));
    const mergesBeforeBusy = mergeCalls.length;
    await flow.runMerge({ files: mergeFiles, format: "docx" });
    assert(mergeCalls.length === mergesBeforeBusy, "预检返回 busy 时应中止,不得发起合并");
    const statusText = elementFor("status").textContent;
    assert(
      typeof statusText === "string" && statusText.includes("另一个转换正在进行"),
      `预检 busy 应把原因呈现在状态行,实际 ${JSON.stringify(statusText)}`,
    );
    assert(!flow.isConvertCommandBlocked(), "中止后命令锁应释放(界面不悬挂)");

    /* ---------- 8. 批量:同样逐文件预检 + 决策前不转换 ---------- */
    precheckPaths.length = 0;
    usePendingPrecheck(); // 回到挂起形态(6/7 换成了即时结算实现)
    state.selectedFiles = mergeFiles;
    const batchChain = flow.runBatch();
    await flush();
    assert(
      preCount() === 1 && precheckPaths[0] === mergeFiles[0],
      `批量应逐文件预检,实际 ${JSON.stringify(precheckPaths)}`,
    );
    settleNext([fenceWarning(1)]);
    await flush();
    settleNext([fenceWarning(2)]);
    await flush();
    assert(batchCount() === 0, "用户决策前不得调用 convertBatch");
    clickDecision(true);
    await batchChain;
    assert(batchCount() === 1, `确认后应恰好调用一次 convertBatch,实际 ${batchCalls.length}`);
    assert(
      batchCalls[0]?.files.join("|") === mergeFiles.join("|"),
      "convertBatch 应收到完整源文件列表",
    );
    // 批量收尾会弹结果窗(模态),后续用例的模态判定需从干净态起算
    dialogs.hideBatchDialog();
    state.selectedFiles = [];

    /* ---------- 9. 粘贴直转(selection 域):此前无预检,收口后自然覆盖 ---------- */
    precheckPaths.length = 0;
    usePendingPrecheck();
    const clipPath = "C:\\Users\\me\\AppData\\Local\\Temp\\clip.md";
    /** @type {Array<{ filePath: string; format: string }>} */
    const convertCalls = [];
    const convertCount = () => convertCalls.length;
    /** @type {any} */ (globalThis.window).api.clipboardRead = async () => ({
      type: "text",
      mdPath: clipPath,
    });
    /** @type {any} */ (globalThis.window).api.convert = async (
      /** @type {string} */ filePath,
      /** @type {string} */ format,
    ) => {
      convertCalls.push({ filePath, format });
      return { ok: true, outputPath: "out.docx", warnings: [] };
    };
    const selection = await import(distUrl("convert/events/selection.js"));
    selection.bindSelectionEvents();
    const pasteBtn = elementFor("pasteConvertBtn");
    pasteBtn.disabled = false;
    fireListener(pasteBtn, "click", { stopPropagation() {} });
    await flush();
    assert(
      preCount() === 1 && precheckPaths[0] === clipPath,
      `粘贴直转也应先预检该临时文件(收口后自然覆盖),实际 ${JSON.stringify(precheckPaths)}`,
    );
    assert(convertCount() === 0, "粘贴直转的预检未决时不得转换");
    settleNext([fenceWarning(4)]);
    await flush();
    assert(
      elementFor("precheckDialog").classList.contains("hidden") === false,
      "粘贴直转的预检告警同样应弹报告",
    );
    clickDecision(true);
    await flush();
    assert(
      convertCount() === 1 && convertCalls[0]?.filePath === clipPath,
      `确认后粘贴直转照常转换,实际 ${JSON.stringify(convertCalls)}`,
    );
    assert(
      pasteBtn.disabled === false,
      "粘贴直转收尾应恢复按钮可用(锁与预检都由命令内部收口,入口不残留忙态)",
    );

    /* ---------- 11. 合并遇 blocksMerge:阻断(不弹确认框,不调 convertMerge) ---------- */
    precheckPaths.length = 0;
    usePendingPrecheck();
    state.selectedFiles = mergeFiles;
    const blockedChain = flow.runMerge({ files: mergeFiles, format: "docx" });
    const mergesBeforeBlock = mergeCount();
    await flush();
    settleNext([blockingFence(7)]);
    await flush();
    settleNext([]); // 第二个文件干净
    await flush();
    assert(
      elementFor("precheckDialog").classList.contains("hidden"),
      "合并遇阻断告警时不得弹预检报告框(那个「继续转换」按钮对阻断是假的)",
    );
    await blockedChain;
    assert(mergeCount() === mergesBeforeBlock, "合并被阻断时 convertMerge 绝不被调用");
    // 长文本(哪个文件/第几行/后果)只在汇总卡出现一次,状态行只有短句
    const detail11 = cardError();
    assert(
      detail11.includes("a.md") && detail11.includes("7"),
      `卡片须说清哪个文件、第几行,实际 ${JSON.stringify(detail11)}`,
    );
    assert(
      detail11.includes("变成一个代码块"),
      `卡片须说清后果(变代码块),实际 ${JSON.stringify(detail11)}`,
    );
    assert(
      !detail11.includes("\\"),
      `无重名时卡片应只给文件名(不含目录分隔符),实际 ${JSON.stringify(detail11)}`,
    );
    assert(!detail11.includes("另有"), "只有一个文件带阻断告警时不得出现「另有 N 个」");
    const short11 = statusLine();
    assert(
      short11.includes("1") && short11.includes("未闭合"),
      `状态行应是一句短句(几个文件 + 未闭合),实际 ${JSON.stringify(short11)}`,
    );
    assert(
      !short11.includes("变成一个代码块") && !short11.includes("a.md"),
      `长文本不得再进状态行(冗余且会挤掉卡片),实际 ${JSON.stringify(short11)}`,
    );
    // 标题如实描述:转换根本没开始,不能说「合并失败」
    assert(
      cardTitle() === i18n.DICT.zh["convert.merge.blockedTitle"],
      `卡片标题应为如实描述的「合并未执行」,实际 ${JSON.stringify(cardTitle())}`,
    );
    assert(
      cardTitle() !== i18n.DICT.zh["convert.merge.failedTitle"],
      "阻断不得复用「合并失败」标题(会让人以为转换跑过)",
    );
    // 界面必须回到可用:命令锁释放 + 合并按钮可点(不留「永久忙碌」)
    assert(!flow.isConvertCommandBlocked(), "阻断后命令锁应释放");
    assert(
      elementFor("mergeBtn").disabled === false,
      `阻断后合并按钮应恢复可用,实际 disabled=${elementFor("mergeBtn").disabled}`,
    );
    assert(state.mode === null, `阻断后不应残留转换态,实际 mode=${state.mode}`);

    /* ---------- 12. 合并只有非阻断告警:照常弹报告 + 可继续 ---------- */
    precheckPaths.length = 0;
    const mergesBeforeSoft = mergeCount();
    const softChain = flow.runMerge({ files: mergeFiles, format: "docx" });
    await flush();
    settleNext([unpairedMath()]);
    await flush();
    settleNext([unpairedMath()]);
    await flush();
    assert(
      elementFor("precheckDialog").classList.contains("hidden") === false,
      "合并的非阻断告警应照常弹报告(不得被合并阻断规则误伤)",
    );
    clickDecision(true);
    await softChain;
    assert(
      mergeCount() === mergesBeforeSoft + 1,
      `非阻断告警确认后照常合并,实际新增 ${mergeCount() - mergesBeforeSoft} 次`,
    );

    /* ---------- 13. 单文件遇未闭合围栏:仍是「警告 + 可继续」 ---------- */
    precheckPaths.length = 0;
    state.selectedFiles = [mergeFiles[0]];
    const singleChain = flow.runConvert(mergeFiles[0], "docx");
    await flush();
    settleNext([blockingFence(7)]);
    await flush();
    assert(
      elementFor("precheckDialog").classList.contains("hidden") === false,
      "单文件遇未闭合围栏仍应弹报告(blocksMerge 只管合并)",
    );
    const convertsBefore = convertCount();
    clickDecision(true);
    await singleChain;
    assert(
      convertCount() === convertsBefore + 1,
      "单文件点继续后照常转换(不得被合并阻断规则波及)",
    );

    /* ---------- 14. 批量遇未闭合围栏:仍是「警告 + 可继续」 ---------- */
    precheckPaths.length = 0;
    state.selectedFiles = mergeFiles;
    const batchChain2 = flow.runBatch();
    await flush();
    settleNext([blockingFence(7)]);
    await flush();
    settleNext([]);
    await flush();
    assert(
      elementFor("precheckDialog").classList.contains("hidden") === false,
      "批量遇未闭合围栏仍应弹报告(blocksMerge 只管合并)",
    );
    const batchesBefore = batchCount();
    clickDecision(true);
    await batchChain2;
    assert(
      batchCount() === batchesBefore + 1,
      "批量点继续后照常转换(不得被合并阻断规则波及)",
    );
    dialogs.hideBatchDialog(); // 批量收尾的结果窗是模态,后续用例需干净态

    /* ---------- 15. 2 个以上文件带阻断:详报第一个 + 「另有 N 个」 ---------- */
    precheckPaths.length = 0;
    const threeFiles = ["C:\\work\\a.md", "C:\\work\\b.md", "C:\\work\\c.md"];
    const mergesBeforeMultiBlock = mergeCount();
    const multiBlockChain = flow.runMerge({ files: threeFiles, format: "docx" });
    await flush();
    settleNext([blockingFence(7)]);
    await flush();
    settleNext([blockingFence(3)]);
    await flush();
    settleNext([blockingFence(5)]);
    await flush();
    const multiDetail = cardError();
    assert(
      multiDetail.includes("a.md") && multiDetail.includes("7"),
      `应详报第一个出问题的文件(a.md 第 7 行),实际 ${JSON.stringify(multiDetail)}`,
    );
    assert(
      multiDetail.includes("2"),
      `应补出「另有 2 个」,实际 ${JSON.stringify(multiDetail)}`,
    );
    assert(
      !multiDetail.includes("b.md") && !multiDetail.includes("c.md"),
      `只详报第一个文件,不该把其余文件名也塞进信息,实际 ${JSON.stringify(multiDetail)}`,
    );
    // 多个阻断文件但名字互不相同 → 仍用文件名(不因「多文件」就退化成全路径)
    assert(
      !multiDetail.includes("\\"),
      `名字不重名时卡片应只给文件名,实际 ${JSON.stringify(multiDetail)}`,
    );
    // 状态行短句给的是「带阻断的文件总数」(含首个),不是长文本
    assert(
      statusLine().includes("3"),
      `状态行短句应给 3 个文件(总数),实际 ${JSON.stringify(statusLine())}`,
    );
    assert(
      !statusLine().includes("变成一个代码块"),
      `长文本只应出现在卡片一次,实际 ${JSON.stringify(statusLine())}`,
    );
    await multiBlockChain;
    assert(mergeCount() === mergesBeforeMultiBlock, "多文件阻断时仍不转换");

    /* ---------- 16. 成书向导付印路径(withPrecheck([]) → runMerge)同样被阻断 ---------- */
    precheckPaths.length = 0;
    const mergesBeforeWizard = mergeCount();
    const wizardChain = flow.withPrecheck([], () =>
      flow.runMerge({ files: mergeFiles, format: "docx" }),
    );
    await flush();
    settleNext([blockingFence(7)]);
    await flush();
    settleNext([]);
    await flush();
    await wizardChain;
    assert(
      preCount() === 2,
      `向导付印应逐文件预检(借锁链里由 runMerge 提供),实际 ${JSON.stringify(precheckPaths)}`,
    );
    assert(mergeCount() === mergesBeforeWizard, "向导付印遇阻断同样不得合并");
    assert(
      cardError().includes("变成一个代码块"),
      `向导付印的阻断详情同样应进卡片并呈现后果,实际 ${JSON.stringify(cardError())}`,
    );
    state.selectedFiles = [];

    /* ---------- 17. 同名文件都有阻断:显示全路径(与报告弹窗同一判据) ---------- */
    // 硬阻断没有「点继续」这条路,若只显示 intro.md,用户修完一份再撞另一份,
    // 正好落回本轮要消除的「来回 N 轮」。
    precheckPaths.length = 0;
    const twinFiles = ["C:\\work\\docs\\intro.md", "C:\\work\\chapters\\intro.md"];
    const mergesBeforeTwin = mergeCount();
    const twinChain = flow.runMerge({ files: twinFiles, format: "docx" });
    await flush();
    settleNext([blockingFence(7)]);
    await flush();
    settleNext([blockingFence(9)]);
    await flush();
    const twinDetail = cardError();
    assert(
      twinDetail.includes(twinFiles[0] ?? ""),
      `同名文件的阻断信息应显示全路径(第一个),实际 ${JSON.stringify(twinDetail)}`,
    );
    assert(
      twinDetail.includes("1"),
      `另一个同名文件应由「另有 1 个」带出,实际 ${JSON.stringify(twinDetail)}`,
    );
    assert(
      !statusLine().includes("intro.md"),
      `状态行短句不该带文件名(详情在卡片),实际 ${JSON.stringify(statusLine())}`,
    );
    await twinChain;
    assert(mergeCount() === mergesBeforeTwin, "同名阻断同样不转换");

    /* ---------- 18. 同名但干净孪生:候选集含未报错的文件,仍回退全路径 ---------- */
    precheckPaths.length = 0;
    const twinClean = ["C:\\work\\docs\\notes.md", "C:\\work\\chapters\\notes.md"];
    const twinCleanChain = flow.runMerge({ files: twinClean, format: "docx" });
    await flush();
    settleNext([blockingFence(2)]);
    await flush();
    settleNext([]); // 同名的另一份是干净的:候选集按「本次预检的文件」算,仍算重名
    await flush();
    assert(
      cardError().includes(twinClean[0] ?? ""),
      `同名的干净孪生也参与重名判定(否则指代不明),实际 ${JSON.stringify(cardError())}`,
    );
    assert(!cardError().includes("另有"), "只有一个文件带阻断 → 不应出现「另有 N 个」");
    await twinCleanChain;
    state.selectedFiles = [];

    /* ---------- 19. 真失败路径不受影响:标题仍是既有的「合并失败」 ---------- */
    precheckPaths.length = 0;
    usePendingPrecheck();
    /** @type {any} */ (globalThis.window).api.convertMerge = async (
      /** @type {string[]} */ files,
      /** @type {string} */ format,
    ) => {
      mergeCalls.push({ files, format });
      return { ok: false, error: "输出目录不可写" };
    };
    const realFailChain = flow.runMerge({ files: mergeFiles, format: "docx" });
    await flush();
    settleNext([]);
    await flush();
    settleNext([]);
    await flush();
    assert(
      elementFor("precheckDialog").classList.contains("hidden"),
      "无告警时不该弹报告框(直接进转换)",
    );
    await realFailChain;
    assert(
      cardTitle() === i18n.DICT.zh["convert.merge.failedTitle"],
      `真失败仍应说「合并失败」,实际 ${JSON.stringify(cardTitle())}`,
    );
    assert(
      cardTitle() !== i18n.DICT.zh["convert.merge.blockedTitle"],
      "真失败不得被阻断标题污染",
    );
    assert(
      cardError().includes("输出目录不可写"),
      `真失败的原因应照旧进卡片,实际 ${JSON.stringify(cardError())}`,
    );
    assert(
      !statusLine().includes("未闭合"),
      `真失败的状态行不该说围栏,实际 ${JSON.stringify(statusLine())}`,
    );
    /** @type {any} */ (globalThis.window).api.convertMerge = async (
      /** @type {string[]} */ files,
      /** @type {string} */ format,
    ) => {
      mergeCalls.push({ files, format });
      return { ok: true, outputPath: `out.${format}`, warnings: [] };
    };

    /* ---------- 20. 阻断用到的两个新键:三语言齐备 + 占位符集合一致 ---------- */
    const NEW_KEYS = ["convert.merge.blockedTitle", "convert.merge.blockedStatus"];
    /** 取占位符集合并排序(占位符须三语言一致,与 i18n-registry 段同款口径)。 */
    const placeholders = (/** @type {unknown} */ text) =>
      [...String(text).matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const key of NEW_KEYS) {
      for (const { code } of i18n.LANGUAGES) {
        const value = i18n.DICT[code][key];
        assert(
          typeof value === "string" && value.trim().length > 0,
          `${code} 应有非空文案 ${key}`,
        );
        assert(
          placeholders(value) === placeholders(i18n.DICT.zh[key]),
          `${code}.${key} 占位符应与 zh 一致(zh=[${placeholders(i18n.DICT.zh[key])}] ${code}=[${placeholders(value)}])`,
        );
      }
      assert(i18n.DICT.en[key] !== i18n.DICT.zh[key], `en.${key} 不应沿用中文原文`);
      assert(i18n.DICT.ja[key] !== i18n.DICT.zh[key], `ja.${key} 不应沿用中文原文`);
    }
    assert(
      placeholders(i18n.DICT.zh["convert.merge.blockedStatus"]) === "count",
      "blockedStatus 的占位符应恰为 count",
    );
    assert(
      placeholders(i18n.DICT.zh["convert.merge.blockedTitle"]) === "",
      "blockedTitle 不该带占位符(标题是固定措辞)",
    );
    assert(
      i18n.DICT.zh["convert.merge.blockedTitle"] !== i18n.DICT.zh["convert.merge.failedTitle"],
      "阻断标题不得与真失败标题同文案(否则两处又混成一句话)",
    );
    // 逐语言经 t() 命中(缺键会回退裸 key/英文,在此暴露)
    for (const { code } of i18n.LANGUAGES) {
      i18nApi.setLanguage(code);
      assert(
        i18nApi.t("convert.merge.blockedStatus", { count: 2 }) ===
          i18n.DICT[code]["convert.merge.blockedStatus"].replace("${count}", "2"),
        `${code} 下 t(convert.merge.blockedStatus) 应命中本语言字典`,
      );
    }
    i18nApi.setLanguage("zh"); // 语言是模块级状态,复位避免污染后续段

    /* ---------- 21. 守护:裁切修复的两条 flex:none 不得被摘掉(源契约) ---------- */
    // 固定槽 .feed 里的两项都不可压缩:可压缩项被更高的一项挤扁后,自己的
    // overflow:hidden 会把文字裁成一条(用户截图里「上半截被切」的机制)。
    // Node stub 测不到布局,故按源文本锁定这两条声明。
    const statusRule = /\n\.status \{([^}]*)\}/.exec(
      // 去注释后判定:注释里提到 flex:none(说明「为什么加」)不算声明
      fs
        .readFileSync(path.resolve(here, "../../src/renderer/style/base.css"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, ""),
    );
    assert(statusRule, "base.css 应有 .status 规则");
    assert(
      /flex:\s*none/.test(statusRule?.[1] ?? ""),
      `.status 必须 flex:none(不可被固定槽里的汇总卡压扁),实际规则体:${statusRule?.[1]}`,
    );
    const cardRule = /\n\.feed \.result-summary \{([^}]*)\}/.exec(
      fs
        .readFileSync(path.resolve(here, "../../src/renderer/style/dialogs.css"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, ""),
    );
    assert(cardRule, "dialogs.css 应有 .feed .result-summary 规则");
    assert(
      /flex:\s*none/.test(cardRule?.[1] ?? ""),
      `.feed .result-summary 必须 flex:none(卡片高于槽时交给槽内滚动,而不是被压扁),实际规则体:${cardRule?.[1]}`,
    );

    /* ---------- 22. 守护:调用点不再自带 withPrecheck(预检只在命令函数内部) ---------- */
    // 预检收口在 convert-flow 的三个命令函数里;入口再包一层就会双跑预检、
    // 连弹两次报告。唯一例外是成书向导:它用 withPrecheck([]) 借锁把
    // 「付印 docx+pdf」当一条命令,预检本身由 runMerge 内部提供。
    const srcRoot = path.resolve(here, "../../src/renderer");
    /** @type {string[]} */
    const wrapCallers = [];
    const walk = (/** @type {string} */ dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && entry.name !== "convert-flow.ts") {
          // 去注释后判定:注释里提到 withPrecheck(说明「为何不再包」)不是调用
          const code = fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
          if (code.includes("withPrecheck")) {
            wrapCallers.push(path.relative(srcRoot, full).replace(/\\/g, "/"));
          }
        }
      }
    };
    walk(srcRoot);
    assert(
      wrapCallers.length === 1 && wrapCallers[0] === "wizard/book-wizard.ts",
      `预检收口后调用点不应再出现 withPrecheck(唯一例外:向导借锁),实际 ${JSON.stringify(wrapCallers)}`,
    );
    const flowSource = fs.readFileSync(
      path.join(srcRoot, "convert/convert-flow.ts"),
      "utf8",
    );
    for (const command of ["runConvert", "runBatch", "runMerge"]) {
      assert(
        new RegExp(`export function ${command}\\([\\s\\S]{0,320}?precheckedCommand\\(`).test(
          flowSource,
        ),
        `${command} 入口应自带预检收口(precheckedCommand)`,
      );
    }

    console.log(
      "[ok] precheck-multi-file:合并/批量/单文件/粘贴直转逐文件预检(按序·每文件一次) + 决策门(确认前不转换/取消即中止) + 报告按文件分组(h3 组头/单组扁平/同名回退全路径) + 预检异常不阻断 + busy 中止 + 预检期单实例 + 合并遇 blocksMerge 阻断(不弹框·不转换·界面恢复·多文件补「另有 N 个」·向导付印同阻·同名回退全路径) + 单文件/批量不被波及 + 调用点不再自带 withPrecheck 断言通过",
    );
  } finally {
    dom.restore();
  }
}
