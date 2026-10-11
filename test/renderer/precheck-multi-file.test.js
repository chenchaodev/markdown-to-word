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
 * (11) 抛异常路径(convert / convertBatch / convertMerge 各自 reject):此前本段
 *     零覆盖(桩一律 resolve),三个 catch 分支摘掉 setError/showSummary 一条断言
 *     都不会红;catch 收进 reportFailure 后单点爆炸半径 1 → 3,故逐条钉住 ——
 *     状态行(可操作化之后)、汇总卡 fail 态 + 本流程 failedTitle、卡片错误区给
 *     原始错误文本、命令锁释放、state.mode 归位(以「下一条命令仍能发起」为证)。
 *     批量另有 lastBatchResult 归 null 的清理;另用 EBUSY 单独钉「可操作化」那一层
 *     (单文件/合并改写、批量按既有口径刻意透传)。
 *
 * 焦点陷阱与关闭后焦点回归由 focus-return-guards 段守(预检弹窗两条断言已在其中),
 * 本段不重复;组头标签用 createElement 记名后逐节点断言。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../harness/paths.js";
import { installDomStub, fireListener, makeElement } from "./dom-stub.js";
import { loadConvertFlowDeps } from "./convert-flow-deps.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

const { assert: harnessAssert } = createAsserter("precheck-multi-file");

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
 * 本段测哪一层(ADR-062 L4 声明通道):**renderer**,判据静态看不见本段的主体 ——
 * 被测的 dist 模块由 `await import(distUrl(...))` 的**运行期动态 import** 载入
 * (路径 `path.join` 逐段拼出),另有几处对 `src/renderer/**` 的**字符串路径**文本断言,
 * 段内零 renderer import。
 *
 * 主体依据(头注 + 段内加载位置):头注写「预检覆盖批量 / 合并路径 + 报告对话框按文件分组」。
 * 逐条对应:
 * - `convert/convert-flow.ts` —— 逐文件预检的发起侧、决策门、预检期单实例、以及第 26 组
 *   「调用点不再自带 withPrecheck」与三个命令函数自带 `precheckedCommand(` 的源契约;
 * - `ui/dialogs.ts` —— 报告对话框的渲染(按文件分组的 h3 组头、单组扁平、同名回退全路径);
 * - `convert/events/selection.ts` —— 粘贴直转(selection 域)那一格;
 * - `state/state.ts` —— `state.mode` / `lastBatchResult` 等状态单例的断言落点;
 * - `style/base.css` 与 `style/dialogs.css` —— 第 25 组两条 `flex:none` 的源契约断言。
 *
 * 另加载 `dist/core/i18n/index.js` 取三语言字典作**期望值**(判据上的「夹具输入/规格」,
 * 非被测行为:本段不替 i18n 下断言,只拿它的文案当比对基准),故不声明 core 层元素。
 */
export const covers = [
  "src/renderer/convert/convert-flow.ts",
  "src/renderer/ui/dialogs.ts",
  "src/renderer/convert/events/selection.ts",
  "src/renderer/state/state.ts",
  "src/renderer/style/base.css",
  "src/renderer/style/dialogs.css",
];

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
 * (见 core/pipeline/precheck.ts 与 core/i18n/warning.ts 的 KeyedWarning)。
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

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  /** @param {string} rel @returns {string} */
  const distUrl = (rel) => pathToFileURL(path.join(ROOT, "dist", "renderer", rel)).href;

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
    // convert 刀起结果呈现面(ui/dialogs 的五个符号)改为组合根注入的端口(ADR-075 §四);
    // ui 侧的关闭路径与 settings 的另存为弹窗关闭同理收 deps。三份都按组合根同一份清单装配。
    const convertFlowDeps = await loadConvertFlowDeps(distUrl);
    const { updateActionButtons } = await import(distUrl("convert/file-list.js"));
    const dialogsDeps = { recomputeActionButtons: updateActionButtons };
    dialogs.bindPrecheckDialogEvents(dialogsDeps);
    const i18n = await import(pathToFileURL(path.join(ROOT, "dist", "core", "i18n", "index.js")).href);
    // t / setLanguage 现由 core/i18n/index.js 一并再导出(ADR-064 把原 i18n.ts 桶溶进
    // i18n/ 后,index.ts 是唯一公开桶)。下面这一行与上一行因此取的是同一个模块 ——
    // 留着是为了不改动本段既有的变量名与用法;新写代码直接用上面的 i18n 即可。
    const i18nApi = await import(pathToFileURL(path.join(ROOT, "dist", "core", "i18n/index.js")).href);
    const { state } = await import(distUrl("state/state.js"));
    // 结果弹窗会把「模态可见」置起来挡住后续用例;本段只关心预检门
    state.suppressCompleteDialog = true;
    state.selectedFormat = "docx";
    state.selectedFiles = mergeFiles;
    usePendingPrecheck();

    // 1 段发起、2 段等它结算:声明提到 case 外(否则第 2 段拿不到这条链)。
    // 报告弹窗的存在与否是 2 段判定的前提,故 1 段只到「决策前」为止,点击留在 2 段内
    /** @type {Promise<unknown>} */
    let mergeChain;
    /** 第 3 段测量的转换次数基线,第 4 段断言要用它(相对量) */
    let mergesBeforeCancel = 0;

    /* ---------- 1. 合并:逐文件预检 + 决策前不转换 + 预检期单实例 ---------- */
    await suite.case("合并 · 逐文件预检且按源文件顺序", async () => {
      mergeChain = flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" });
      await flush();
      assert(
        preCount() === 1 && precheckPaths[0] === mergeFiles[0],
        `合并应逐文件预检且按源文件顺序,实际 ${JSON.stringify(precheckPaths)}`,
      );
      assert(flow.isConvertCommandBlocked(), "预检进行中命令锁应生效(按钮随之置灰)");
      assert(mergeCount() === 0, "预检未决时不得发起合并转换");
      // 预检未决时重复发起另一条命令:复用同一条链,不并发、不多发预检
      void flow.runBatch(convertFlowDeps);
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
    });

    /* ---------- 2. 报告按文件分组 ---------- */
    await suite.case("报告 · 按文件分组渲染(h3 组头/文件标识/各组自己的告警)", async () => {
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
    });

    /* ---------- 3. 点「取消」:整条命令中止 ---------- */
    await suite.case("合并 · 点取消即中止(不调 convertMerge)", async () => {
      precheckPaths.length = 0;
      const cancelChain = flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "pdf" });
      await flush();
      settleNext([fenceWarning(1)]);
      await flush();
      settleNext([fenceWarning(2)]);
      await flush();
      mergesBeforeCancel = mergeCalls.length;
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
    });

    /* ---------- 4. 单组告警:保持扁平列表,不出现分组标识 ---------- */
    await suite.case("报告 · 单组告警保持扁平列表且确认后照常合并", async () => {
      precheckPaths.length = 0;
      const oneGroupChain = flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" });
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
    });

    /* ---------- 5. 同名文件:组头回退全路径(两组同名等于没分组) ---------- */
    await suite.case("报告 · 同名文件的组头回退全路径", async () => {
      precheckPaths.length = 0;
      const sameName = ["C:\\work\\x\\notes.md", "C:\\work\\y\\notes.md"];
      const sameNameChain = flow.runMerge(convertFlowDeps, { files: sameName, format: "docx" });
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
    });

    /* ---------- 6. 预检抛错:该文件跳过,主流程不阻断 ---------- */
    await suite.case("预检 · 单个文件抛错被跳过且不阻断主流程", async () => {
      precheckPaths.length = 0;
      let firstThrows = true;
      usePrecheck(async (filePath) => {
        if (firstThrows) {
          firstThrows = false;
          throw new Error("precheck 读取失败");
        }
        return filePath === mergeFiles[1] ? [fenceWarning(5)] : [];
      });
      const throwChain = flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" });
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
    });

    /* ---------- 7. 预检 busy:状态行提示并中止 ---------- */
    await suite.case("预检 · 返回 busy 时状态行提示并中止", async () => {
      precheckPaths.length = 0;
      usePrecheck(async () => ({ busy: true, error: "另一个转换正在进行" }));
      const mergesBeforeBusy = mergeCalls.length;
      await flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" });
      assert(mergeCalls.length === mergesBeforeBusy, "预检返回 busy 时应中止,不得发起合并");
      const statusText = elementFor("status").textContent;
      assert(
        typeof statusText === "string" && statusText.includes("另一个转换正在进行"),
        `预检 busy 应把原因呈现在状态行,实际 ${JSON.stringify(statusText)}`,
      );
      assert(!flow.isConvertCommandBlocked(), "中止后命令锁应释放(界面不悬挂)");
    });

    /* ---------- 8. 批量:同样逐文件预检 + 决策前不转换 ---------- */
    await suite.case("批量 · 逐文件预检且决策前不调 convertBatch", async () => {
      precheckPaths.length = 0;
      usePendingPrecheck(); // 回到挂起形态(6/7 换成了即时结算实现)
      state.selectedFiles = mergeFiles;
      const batchChain = flow.runBatch(convertFlowDeps);
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
    });
    // 批量收尾会弹结果窗(模态),后续用例的模态判定需从干净态起算
    dialogs.hideBatchDialog(dialogsDeps);
    state.selectedFiles = [];

    /* ---------- 9. 粘贴直转(selection 域):此前无预检,收口后自然覆盖 ---------- */
    // 单文件转换的调用记录:本段与第 13/20 段共用一份(桩换掉了也还指着它),故声明在 case 外
    /** @type {Array<{ filePath: string; format: string }>} */
    const convertCalls = [];
    const convertCount = () => convertCalls.length;
    await suite.case("粘贴直转 · 先预检临时文件、决策后才转换、收尾恢复按钮", async () => {
      precheckPaths.length = 0;
      usePendingPrecheck();
      const clipPath = "C:\\Users\\me\\AppData\\Local\\Temp\\clip.md";
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
      selection.bindSelectionEvents({ ...convertFlowDeps, openWizard: () => {} });
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
    });

    /* ---------- 11. 合并遇 blocksMerge:阻断(不弹确认框,不调 convertMerge) ---------- */
    // 阻断信息的载体:第 12 段起的卡片/状态行文案判定都读它,故取数(跑一次阻断)留在 case 外,
    // 第 11 段只判「阻断发生了」(不弹框/不转换),文案逐条另立 case
    await suite.case("合并阻断 · 不弹报告框且 convertMerge 绝不被调用", async () => {
      precheckPaths.length = 0;
      usePendingPrecheck();
      state.selectedFiles = mergeFiles;
      const blockedChain = flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" });
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
    });
    await suite.describe("合并阻断 · 详情文案与界面恢复", async (s) => {
      await s.case("卡片说清文件与行号", () => {
        // 长文本(哪个文件/第几行/后果)只在汇总卡出现一次,状态行只有短句
        const detail11 = cardError();
        assert(
          detail11.includes("a.md") && detail11.includes("7"),
          `卡片须说清哪个文件、第几行,实际 ${JSON.stringify(detail11)}`,
        );
      });
      await s.case("卡片说清后果(变代码块)", () => {
        const detail11 = cardError();
        assert(
          detail11.includes("变成一个代码块"),
          `卡片须说清后果(变代码块),实际 ${JSON.stringify(detail11)}`,
        );
      });
      await s.case("无重名时卡片只给文件名且不出现「另有 N 个」", () => {
        const detail11 = cardError();
        assert(
          !detail11.includes("\\"),
          `无重名时卡片应只给文件名(不含目录分隔符),实际 ${JSON.stringify(detail11)}`,
        );
        assert(!detail11.includes("另有"), "只有一个文件带阻断告警时不得出现「另有 N 个」");
      });
      await s.case("状态行是一句短句(几个文件 + 未闭合)且不含长文本", () => {
        const short11 = statusLine();
        assert(
          short11.includes("1") && short11.includes("未闭合"),
          `状态行应是一句短句(几个文件 + 未闭合),实际 ${JSON.stringify(short11)}`,
        );
        assert(
          !short11.includes("变成一个代码块") && !short11.includes("a.md"),
          `长文本不得再进状态行(冗余且会挤掉卡片),实际 ${JSON.stringify(short11)}`,
        );
      });
      await s.case("标题是如实的合并未执行(不复用合并失败)", () => {
        // 标题如实描述:转换根本没开始,不能说「合并失败」
        assert(
          cardTitle() === i18n.DICT.zh["convert.merge.blockedTitle"],
          `卡片标题应为如实描述的「合并未执行」,实际 ${JSON.stringify(cardTitle())}`,
        );
        assert(
          cardTitle() !== i18n.DICT.zh["convert.merge.failedTitle"],
          "阻断不得复用「合并失败」标题(会让人以为转换跑过)",
        );
      });
      await s.case("阻断后界面回到可用(锁释放/按钮可点/无残留转换态)", () => {
        // 界面必须回到可用:命令锁释放 + 合并按钮可点(不留「永久忙碌」)
        assert(!flow.isConvertCommandBlocked(), "阻断后命令锁应释放");
        assert(
          elementFor("mergeBtn").disabled === false,
          `阻断后合并按钮应恢复可用,实际 disabled=${elementFor("mergeBtn").disabled}`,
        );
        assert(state.mode === null, `阻断后不应残留转换态,实际 mode=${state.mode}`);
      });
    });

    /* ---------- 12. 合并只有非阻断告警:照常弹报告 + 可继续 ---------- */
    await suite.case("合并 · 非阻断告警照常弹报告且可继续", async () => {
      precheckPaths.length = 0;
      const mergesBeforeSoft = mergeCount();
      const softChain = flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" });
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
    });

    /* ---------- 13. 单文件遇未闭合围栏:仍是「警告 + 可继续」 ---------- */
    await suite.case("单文件 · 未闭合围栏仍弹报告且点继续后照常转换", async () => {
      precheckPaths.length = 0;
      state.selectedFiles = [mergeFiles[0]];
      const singleChain = flow.runConvert(convertFlowDeps, mergeFiles[0], "docx");
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
    });

    /* ---------- 14. 批量遇未闭合围栏:仍是「警告 + 可继续」 ---------- */
    await suite.case("批量 · 未闭合围栏仍弹报告且点继续后照常转换", async () => {
      precheckPaths.length = 0;
      state.selectedFiles = mergeFiles;
      const batchChain2 = flow.runBatch(convertFlowDeps);
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
    });
    dialogs.hideBatchDialog(dialogsDeps); // 批量收尾的结果窗是模态,后续用例需干净态

    /* ---------- 15. 2 个以上文件带阻断:详报第一个 + 「另有 N 个」 ---------- */
    await suite.case("多文件阻断 · 详报第一个并补出「另有 N 个」", async () => {
      precheckPaths.length = 0;
      const threeFiles = ["C:\\work\\a.md", "C:\\work\\b.md", "C:\\work\\c.md"];
      const mergesBeforeMultiBlock = mergeCount();
      const multiBlockChain = flow.runMerge(convertFlowDeps, { files: threeFiles, format: "docx" });
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
    });

    /* ---------- 16. 成书向导付印路径(withPrecheck([]) → runMerge)同样被阻断 ---------- */
    await suite.case("向导付印 · 借锁链里同样逐文件预检且遇阻断不合并", async () => {
      precheckPaths.length = 0;
      const mergesBeforeWizard = mergeCount();
      const wizardChain = flow.withPrecheck(convertFlowDeps, [], () =>
        flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" }),
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
    });
    state.selectedFiles = [];

    /* ---------- 17. 同名文件都有阻断:显示全路径(与报告弹窗同一判据) ---------- */
    await suite.case("同名阻断 · 显示全路径且状态行不带文件名", async () => {
      // 硬阻断没有「点继续」这条路,若只显示 intro.md,用户修完一份再撞另一份,
      // 正好落回本轮要消除的「来回 N 轮」。
      precheckPaths.length = 0;
      const twinFiles = ["C:\\work\\docs\\intro.md", "C:\\work\\chapters\\intro.md"];
      const mergesBeforeTwin = mergeCount();
      const twinChain = flow.runMerge(convertFlowDeps, { files: twinFiles, format: "docx" });
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
    });

    /* ---------- 18. 同名但干净孪生:候选集含未报错的文件,仍回退全路径 ---------- */
    await suite.case("同名干净孪生 · 候选集按本次预检的文件算,仍回退全路径", async () => {
      precheckPaths.length = 0;
      const twinClean = ["C:\\work\\docs\\notes.md", "C:\\work\\chapters\\notes.md"];
      const twinCleanChain = flow.runMerge(convertFlowDeps, { files: twinClean, format: "docx" });
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
    });
    state.selectedFiles = [];

    /* ---------- 19. 真失败路径不受影响:标题仍是既有的「合并失败」 ---------- */
    await suite.case("真失败路径 · 标题仍是合并失败且未被阻断文案污染", async () => {
      precheckPaths.length = 0;
      usePendingPrecheck();
      /** @type {any} */ (globalThis.window).api.convertMerge = async (
        /** @type {string[]} */ files,
        /** @type {string} */ format,
      ) => {
        mergeCalls.push({ files, format });
        return { ok: false, error: "输出目录不可写" };
      };
      const realFailChain = flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" });
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
    });
    /** @type {any} */ (globalThis.window).api.convertMerge = async (
      /** @type {string[]} */ files,
      /** @type {string} */ format,
    ) => {
      mergeCalls.push({ files, format });
      return { ok: true, outputPath: `out.${format}`, warnings: [] };
    };

    /* ---------- 20. 抛错路径:三条流程的 catch 收在同一个 reportFailure ---------- */
    // 三条流程的 catch 已收口到 convert-flow 的 reportFailure(单点爆炸半径 1 → 3),
    // 但此前 test/renderer 无一处让 convert* 抛错 → 三个 catch 分支零行为覆盖:
    // 摘掉 reportFailure 里的 setError / showSummary 一条断言都不会红。
    // 下列三例钉住「用户看得见什么」;差异只在文案 key(与批量独有的清理)。
    //
    // 用例 20 的错误文本「IPC 断了」不含任何被 actionableError 识别的错误码,
    // 故可操作化前后同形 —— 状态行/卡片的「可操作化」那一层由 23 用例单独钉。
    /** 汇总卡 kind 的可观察代理:showSummary 写的是三态互斥的修饰类。 */
    const summaryKind = () =>
      ["ok", "fail", "canceled"].find((kind) =>
        elementFor("resultSummary").classList.contains(`result-summary--${kind}`),
      ) ?? "none";
    /**
     * 汇总卡归中性(每个失败用例前清一次):卡片是常驻的,上一条用例留下的
     * kind/文案会**替我们把断言蒙混过去** —— 归零后「kind 必须是 fail」才真的
     * 在断言本次 catch 写了 fail,而不是恰好继承来的。
     */
    const resetSummaryCard = () => {
      const card = elementFor("resultSummary");
      for (const kind of ["ok", "fail", "canceled"]) {
        card.classList.remove(`result-summary--${kind}`);
      }
      elementFor("summaryText").textContent = "";
      elementFor("summaryError").textContent = "";
    };
    /**
     * 一条流程抛错后的失败呈现共核(三条流程结构共用,差异只经实参传入):
     * 状态行文案 / 卡片 kind / 卡片标题 / 卡片错误文案 / 命令锁释放 / mode 归位。
     * @param label 用例标签(失败消息前缀)
     * @param statusKey 该流程的状态行 i18n key
     * @param titleKey 该流程的汇总卡标题 i18n key
     * @param presentedError 该流程应当呈现的错误文案(可操作化之后)
     */
    const assertThrownFailure = (
      /** @type {string} */ label,
      /** @type {string} */ statusKey,
      /** @type {string} */ titleKey,
      /** @type {string} */ presentedError,
    ) => {
      assert(
        statusLine() === i18nApi.t(statusKey, { error: presentedError }),
        `${label}:状态行应是本流程的失败文案(${statusKey}),实际 ${JSON.stringify(statusLine())}`,
      );
      assert(summaryKind() === "fail", `${label}:汇总卡 kind 应为 fail,实际 ${summaryKind()}`);
      assert(
        cardTitle() === i18n.DICT.zh[titleKey],
        `${label}:卡片标题应恰为 ${titleKey},实际 ${JSON.stringify(cardTitle())}`,
      );
      assert(
        cardError() === presentedError,
        `${label}:卡片错误区应给出呈现用错误文案,实际 ${JSON.stringify(cardError())}`,
      );
      assert(
        elementFor("summaryError").classList.contains("hidden") === false,
        `${label}:卡片有错误文案时错误区应可见`,
      );
      assert(!flow.isConvertCommandBlocked(), `${label}:失败后命令锁必须释放(锁住即界面卡死)`);
      assert(state.mode === null, `${label}:失败后应归位转换态,实际 mode=${state.mode}`);
    };

    await suite.case("单文件抛错 · 失败呈现共核 + 下一条命令仍能发起", async () => {
      precheckPaths.length = 0;
      resetSummaryCard();
      usePrecheck(async () => []); // 无告警:直接进转换,不弹报告框
      /** @type {any} */ (globalThis.window).api.convert = async () => {
        throw new Error("IPC 断了");
      };
      state.selectedFiles = [mergeFiles[0]];
      await flow.runConvert(convertFlowDeps, mergeFiles[0], "docx");
      assertThrownFailure("单文件", "convert.failed.status", "convert.failed.title", "IPC 断了");
      // 命令锁释放的行为证据:紧接着再发一条命令,应能真的走到 IPC
      const convertsBeforeRetry = convertCount();
      /** @type {any} */ (globalThis.window).api.convert = async (
        /** @type {string} */ filePath,
        /** @type {string} */ format,
      ) => {
        convertCalls.push({ filePath, format });
        return { ok: true, outputPath: "out.docx", warnings: [] };
      };
      precheckPaths.length = 0;
      await flow.runConvert(convertFlowDeps, mergeFiles[0], "docx");
      assert(
        convertCount() === convertsBeforeRetry + 1,
        `单文件失败后下一条命令仍应能发起(锁已释放),实际新增 ${convertCount() - convertsBeforeRetry} 次`,
      );
    });

    /* ---------- 21. 批量:convertBatch 抛错(含 lastBatchResult 清理) ---------- */
    await suite.case("批量抛错 · 失败呈现共核 + 清 lastBatchResult + 下一条命令仍能发起", async () => {
      precheckPaths.length = 0;
      resetSummaryCard();
      /** @type {any} */ (globalThis.window).api.convertBatch = async () => {
        throw new Error("IPC 断了");
      };
      // 批量窗的「重试失败项」等入口读 lastBatchResult:抛错后留陈旧结果会让用户
      // 重试到上一轮的失败项,故 catch 里必须清空(批量独有,另两条流程无此字段)。
      state.lastBatchResult = {
        ok: true,
        items: [{ file: "C:\\work\\stale.md", ok: false, error: "上一轮的失败" }],
        okCount: 0,
        failCount: 1,
        canceledCount: 0,
      };
      state.selectedFiles = mergeFiles;
      await flow.runBatch(convertFlowDeps);
      assertThrownFailure("批量", "convert.batch.failed", "convert.batch.failedTitle", "IPC 断了");
      assert(
        state.lastBatchResult === null,
        `批量抛错后应清空 lastBatchResult,实际 ${JSON.stringify(state.lastBatchResult)}`,
      );
      const batchesBeforeRetry = batchCount();
      /** @type {any} */ (globalThis.window).api.convertBatch = async (
        /** @type {string[]} */ files,
        /** @type {string} */ format,
      ) => {
        batchCalls.push({ files, format });
        return {
          items: files.map((file) => ({ file, ok: true })),
          okCount: files.length,
          failCount: 0,
          canceledCount: 0,
          canceled: false,
        };
      };
      precheckPaths.length = 0;
      await flow.runBatch(convertFlowDeps);
      assert(
        batchCount() === batchesBeforeRetry + 1,
        `批量失败后下一条命令仍应能发起(锁已释放),实际新增 ${batchCount() - batchesBeforeRetry} 次`,
      );
    });
    dialogs.hideBatchDialog(dialogsDeps); // 成功路径的结果窗是模态,后续用例需干净态
    state.selectedFiles = [];

    /* ---------- 22. 合并:convertMerge 抛错 ---------- */
    await suite.case("合并抛错 · 失败呈现共核 + 下一条命令仍能发起", async () => {
      precheckPaths.length = 0;
      resetSummaryCard();
      /** @type {any} */ (globalThis.window).api.convertMerge = async () => {
        throw new Error("IPC 断了");
      };
      await flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" });
      assertThrownFailure("合并", "convert.merge.failed", "convert.merge.failedTitle", "IPC 断了");
      const mergesBeforeRetry = mergeCount();
      /** @type {any} */ (globalThis.window).api.convertMerge = async (
        /** @type {string[]} */ files,
        /** @type {string} */ format,
      ) => {
        mergeCalls.push({ files, format });
        return { ok: true, outputPath: `out.${format}`, warnings: [] };
      };
      precheckPaths.length = 0;
      await flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" });
      assert(
        mergeCount() === mergesBeforeRetry + 1,
        `合并失败后下一条命令仍应能发起(锁已释放),实际新增 ${mergeCount() - mergesBeforeRetry} 次`,
      );
    });

    /* ---------- 23. 可操作化口径:单文件/合并改写,批量原样透传 ---------- */
    // 20-22 的错误文本不含任何被 actionableError 识别的错误码,故那一层是
    // 「原样透传」也照样绿 —— 换一条会被识别的错误把这一层单独钉住。
    // 批量是**刻意**不走的(见 BATCH_FAILURE 注记:批量窗逐条展示 main 产出的
    // 原始 error,状态行若单独改写就会与弹窗里那条对不上),故此处断言其透传。
    const busyText = i18nApi.t("error.fileBusy");
    const busyMessage = "EBUSY: resource busy or locked";
    await suite.case("可操作化 · 单文件把错误码换成可操作文案", async () => {
      precheckPaths.length = 0;
      resetSummaryCard();
      /** @type {any} */ (globalThis.window).api.convert = async () => {
        throw new Error(busyMessage);
      };
      state.selectedFiles = [mergeFiles[0]];
      await flow.runConvert(convertFlowDeps, mergeFiles[0], "docx");
      assertThrownFailure("单文件可操作化", "convert.failed.status", "convert.failed.title", busyText);
      assert(
        !cardError().includes("EBUSY"),
        `单文件的错误码应被换成可操作文案,实际 ${JSON.stringify(cardError())}`,
      );
    });
    await suite.case("可操作化 · 合并把错误码换成可操作文案", async () => {
      precheckPaths.length = 0;
      resetSummaryCard();
      /** @type {any} */ (globalThis.window).api.convertMerge = async () => {
        throw new Error(busyMessage);
      };
      await flow.runMerge(convertFlowDeps, { files: mergeFiles, format: "docx" });
      assertThrownFailure("合并可操作化", "convert.merge.failed", "convert.merge.failedTitle", busyText);
    });
    await suite.case("可操作化 · 批量刻意原样透传错误码", async () => {
      precheckPaths.length = 0;
      resetSummaryCard();
      /** @type {any} */ (globalThis.window).api.convertBatch = async () => {
        throw new Error(busyMessage);
      };
      state.selectedFiles = mergeFiles;
      await flow.runBatch(convertFlowDeps);
      assertThrownFailure("批量可操作化", "convert.batch.failed", "convert.batch.failedTitle", busyMessage);
      assert(
        cardError() === busyMessage,
        `批量刻意不过 displayError(与批量窗逐条展示的原始 error 对齐),实际 ${JSON.stringify(cardError())}`,
      );
    });
    // 收尾复位桩与状态:留下抛错桩会成为后面段的隐形地雷(同进程共用 window.api)
    /** @type {any} */ (globalThis.window).api.convert = async () => ({
      ok: true,
      outputPath: "out.docx",
      warnings: [],
    });
    /** @type {any} */ (globalThis.window).api.convertBatch = async () => ({
      items: [],
      okCount: 0,
      failCount: 0,
      canceledCount: 0,
      canceled: false,
    });
    /** @type {any} */ (globalThis.window).api.convertMerge = async (
      /** @type {string[]} */ _files,
      /** @type {string} */ format,
    ) => ({ ok: true, outputPath: `out.${format}`, warnings: [] });
    usePendingPrecheck();
    state.selectedFiles = [];

    /* ---------- 24. 阻断用到的两个新键:三语言齐备 + 占位符集合一致 ---------- */
    const NEW_KEYS = ["convert.merge.blockedTitle", "convert.merge.blockedStatus"];
    /** 取占位符集合并排序(占位符须三语言一致,与 i18n-registry 段同款口径)。 */
    const placeholders = (/** @type {unknown} */ text) =>
      [...String(text).matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    // 每个键一行 case:这一行就是「该键三语言齐备 + 占位符一致 + 未沿用中文原文」
    for (const key of NEW_KEYS) {
      await suite.case(`i18n · ${key} 三语言齐备且占位符一致`, () => {
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
      });
    }
    await suite.case("i18n · blockedTitle 不带占位符且与真失败标题不同文案", () => {
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
    });
    // 逐语言经 t() 命中(缺键会回退裸 key/英文,在此暴露)。
    // 语言是模块级状态:切语言与复位成对放在同一条 case 里,失败也不污染后续段
    await suite.case("i18n · 逐语言经 t() 命中本语言字典", () => {
      try {
        for (const { code } of i18n.LANGUAGES) {
          i18nApi.setLanguage(code);
          assert(
            i18nApi.t("convert.merge.blockedStatus", { count: 2 }) ===
              i18n.DICT[code]["convert.merge.blockedStatus"].replace("${count}", "2"),
            `${code} 下 t(convert.merge.blockedStatus) 应命中本语言字典`,
          );
        }
      } finally {
        i18nApi.setLanguage("zh"); // 复位避免污染后续段
      }
    });

    /* ---------- 25. 守护:裁切修复的两条 flex:none 不得被摘掉(源契约) ---------- */
    // 固定槽 .feed 里的两项都不可压缩:可压缩项被更高的一项挤扁后,自己的
    // overflow:hidden 会把文字裁成一条(用户截图里「上半截被切」的机制)。
    // Node stub 测不到布局,故按源文本锁定这两条声明。
    const statusRule = /\n\.status \{([^}]*)\}/.exec(
      // 去注释后判定:注释里提到 flex:none(说明「为什么加」)不算声明
      fs
        .readFileSync(path.join(ROOT, "src", "renderer", "style", "base.css"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, ""),
    );
    const cardRule = /\n\.feed \.result-summary \{([^}]*)\}/.exec(
      fs
        .readFileSync(path.join(ROOT, "src", "renderer", "style", "dialogs.css"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, ""),
    );
    await suite.describe("源契约 · 固定槽两项不可压缩", async (s) => {
      await s.case("base.css 的 .status 必须 flex:none", () => {
        assert(statusRule, "base.css 应有 .status 规则");
        assert(
          /flex:\s*none/.test(statusRule?.[1] ?? ""),
          `.status 必须 flex:none(不可被固定槽里的汇总卡压扁),实际规则体:${statusRule?.[1]}`,
        );
      });
      await s.case("dialogs.css 的 .feed .result-summary 必须 flex:none", () => {
        assert(cardRule, "dialogs.css 应有 .feed .result-summary 规则");
        assert(
          /flex:\s*none/.test(cardRule?.[1] ?? ""),
          `.feed .result-summary 必须 flex:none(卡片高于槽时交给槽内滚动,而不是被压扁),实际规则体:${cardRule?.[1]}`,
        );
      });
    });

    /* ---------- 26. 守护:调用点不再自带 withPrecheck(预检只在命令函数内部) ---------- */
    // 预检收口在 convert-flow 的三个命令函数里;入口再包一层就会双跑预检、
    // 连弹两次报告。唯一例外是成书向导:它用 withPrecheck([]) 借锁把
    // 「付印 docx+pdf」当一条命令,预检本身由 runMerge 内部提供。
    const srcRoot = path.join(ROOT, "src", "renderer");
    // 全树扫源码是取数(与两条断言无关),留在 case 外
    //
    // ⚠ **调用**与**传递**分两桶记(ADR-075 §四 的端口形态落地后两者会同时存在):
    // 向导借锁是**调用**(withPrecheck([])),那是唯一被允许的例外;而组合根为了把
    // wizard 需要的端口注进去,要在 deps 对象里**传递**withPrecheck 的引用
    // (`withPrecheck,` 简写属性)—— 那是接线,不是绕过收口。早先一版判据用
    // 「任何提及即调用点」,组合根一接线就判红,而它并没有违反本纪律。
    /** @type {string[]} */
    const wrapCallers = [];
    /** @type {string[]} */
    const wrapPassers = [];
    const walk = (/** @type {string} */ dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && entry.name !== "convert-flow.ts") {
          // 去注释后判定:注释里提到 withPrecheck(说明「为何不再包」)不是调用
          const code = fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
          if (code.includes("withPrecheck")) {
            const rel = path.relative(srcRoot, full).replace(/\\/g, "/");
            // 调用形态 = 标识符后跟实参表;简写属性(`withPrecheck,`)/类型标注不算
            (/\bwithPrecheck\s*\(/.test(code) ? wrapCallers : wrapPassers).push(rel);
          }
        }
      }
    };
    walk(srcRoot);
    const flowSource = fs.readFileSync(
      path.join(srcRoot, "convert/convert-flow.ts"),
      "utf8",
    );
    await suite.describe("源契约 · 预检只在命令函数内部", async (s) => {
      // ⚠ 「调用点」的允许面自 convert 刀起多了一处:组合根不再用简写属性**传递**
      // withPrecheck 引用,而是把它绑成零参闭包 `withPrecheck: (filePaths, action) =>
      // withPrecheck(convertFlowDeps, filePaths, action)`(与 runMerge / runConvert
      // 同一形态,ADR-075 §四:端口挂在组合根本来就在调的入口上)。故那条简写传递
      // 形态在本仓**已消失** —— 下面 case 2 仍监视它(组合根哪天改回简写仍被钉住),
      // 但区分力从「调用 vs 传递」搬到了 case 1 的「根上只有一处、且形态是接线闭包」。
      await s.case("调用点不再自带 withPrecheck(唯一例外是向导借锁)", () => {
        const unexpected = wrapCallers.filter(
          (rel) => rel !== "wizard/book-wizard.ts" && rel !== "renderer.ts",
        );
        assert(
          unexpected.length === 0,
          `预检收口后调用 withPrecheck 的只许向导借锁与组合根接线两处,实际多出 ${JSON.stringify(unexpected)}`,
        );
        // 两处都要在(缺一条说明那处被删了 —— 判据要能因「末位/接线位置」变化而红)
        assert(
          wrapCallers.includes("wizard/book-wizard.ts") && wrapCallers.includes("renderer.ts"),
          `向导借锁与组合根接线两处调用点应都在,实际 ${JSON.stringify(wrapCallers)}`,
        );
        // 组合根那一处必须是**接线闭包**,不是自己起一条预检链 —— 形态钉死,
        // 避免哪天有人把它改成在根上直接跑命令而绕开 runMerge 内部的收口。
        const rootSource = fs.readFileSync(
          path.join(ROOT, "src", "renderer", "renderer.ts"),
          "utf8",
        );
        const rootCalls = rootSource.match(/withPrecheck\s*\(/g) ?? [];
        assert(
          rootCalls.length === 1 &&
            /withPrecheck:\s*\([^)]*\)\s*=>\s*withPrecheck\(/.test(rootSource),
          `组合根应只经一个接线闭包调用 withPrecheck(不得自己起链),实际命中 ${rootCalls.length} 处`,
        );
      });
      await s.case("传递 withPrecheck 引用的只许组合根(接线,非绕过收口)", () => {
        // 组合根若哪天改回 `withPrecheck,` 简写传递,会落进 passers;只许组合根一处。
        // (当前形态下 passers 为空 —— 组合根已用上面的接线闭包,见本 describe 的注记。)
        const unexpected = wrapPassers.filter((rel) => rel !== "renderer.ts");
        assert(
          unexpected.length === 0,
          `传递 withPrecheck 引用的只许组合根一个,实际多出 ${JSON.stringify(unexpected)}`,
        );
      });
      // 每个命令函数一行 case:这一行就是「该入口自带 precheckedCommand 收口」
      for (const command of ["runConvert", "runBatch", "runMerge"]) {
        await s.case(`${command} 入口自带预检收口`, () => {
          assert(
            new RegExp(`export function ${command}\\([\\s\\S]{0,320}?precheckedCommand\\(`).test(
              flowSource,
            ),
            `${command} 入口应自带预检收口(precheckedCommand)`,
          );
        });
      }
    });

    console.log(
      "[ok] precheck-multi-file:合并/批量/单文件/粘贴直转逐文件预检(按序·每文件一次) + 决策门(确认前不转换/取消即中止) + 报告按文件分组(h3 组头/单组扁平/同名回退全路径) + 预检异常不阻断 + busy 中止 + 预检期单实例 + 合并遇 blocksMerge 阻断(不弹框·不转换·界面恢复·多文件补「另有 N 个」·向导付印同阻·同名回退全路径) + 单文件/批量不被波及 + 抛错路径(单文件/批量/合并:状态行·卡片 fail 态+failedTitle·原始错误·命令锁释放·mode 归位·批量清 lastBatchResult·可操作化口径) + 调用点不再自带 withPrecheck 断言通过",
    );
    return { cases: suite.results };
  } finally {
    dom.restore();
  }
}
