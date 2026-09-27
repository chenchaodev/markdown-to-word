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

    /* ---------- 10. 守护:调用点不再自带 withPrecheck(预检只在命令函数内部) ---------- */
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
      "[ok] precheck-multi-file:合并/批量/单文件/粘贴直转逐文件预检(按序·每文件一次) + 决策门(确认前不转换/取消即中止) + 报告按文件分组(h3 组头/单组扁平/同名回退全路径) + 预检异常不阻断 + busy 中止 + 预检期单实例 + 调用点不再自带 withPrecheck 断言通过",
    );
  } finally {
    dom.restore();
  }
}
