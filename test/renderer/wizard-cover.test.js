// @ts-check
/**
 * 成书向导封面步「单位」字段回归段(封面元数据从向导到产物的接线):
 *
 * - 封面步四个输入同一形态、同一段内,顺序为 书名 → 单位 → 作者 → 日期(与产物封面同序:
 *   docx `chrome.ts` 的封面段与 pdf `template.ts` 的 metaLine 都是「单位 · 作者 · 日期」);
 * - frontmatter 带 `organization` 时**预填到位**(输入框 + 草稿态)—— 漏了它,用户在向导里
 *   填别的字段提交就会经整对象替换把单位吃掉(ADR-078 已知缺口面,本段只守「不漏」);
 * - 向导里填的单位随付印交给 `runMerge` 的 metadata 一起出去(renderer 侧能观察到的最远一
 *   环;它进产物封面那半由 `core/cover-metadata.test.js` 守着 —— 两侧同一份 metadata);
 * - 复开后单位态不残留。
 *
 * 用最小 DOM stub 驱动真实 dist 向导模块(元素工厂与 dom-stub.js 同款)。
 */
import { fireListener, installDomStub } from "./dom-stub.js";
import { loadBookWizardDeps } from "./wizard-deps.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

const { assert: harnessAssert } = createAsserter("wizard-cover");

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
 * 本段测哪一层(ADR-062 L4 声明通道):**renderer**,段主体由
 * `await import("../../dist/renderer/…")` 的**运行期动态 import** 载入(字面量说明符;
 * 仍是动态 import,必须晚于 DOM stub 安装才加载)。
 *
 * 主体依据(头注):头注写「成书向导封面步「单位」字段回归段(封面元数据从向导到产物的
 * 接线)」。被守护的决定逐条落在:
 * - `wizard/wizard-steps.ts` —— 封面步第三个之外那四个输入的构建/事件/预览行;
 * - `wizard/book-wizard.ts` —— 付印时封面草稿 → `runMerge` 的 metadata(cleanMetadata),
 *   以及每次打开的重置;
 * - `wizard/wizard-steps-delivery.ts` —— 合并源步的首文件 frontmatter 预填;
 * - `wizard/wizard-state.ts` —— 封面草稿的字段形状与新建值。
 */
export const covers = [
  "src/renderer/wizard/wizard-steps.ts",
  "src/renderer/wizard/book-wizard.ts",
  "src/renderer/wizard/wizard-steps-delivery.ts",
  "src/renderer/wizard/wizard-state.ts",
];

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/** 单位字段在三个字典里的键(既有键,本段只消费不改名) */
const ORG_KEY = "wizard.cover.fieldOrganization";

/** 冲刷微任务与宏任务,让未 await 的异步链(void 启动)跑完。 */
async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function run() {
  const suite = createCaseSuite();
  /**
   * 首文件 frontmatter 的应答(逐次改写以造「有单位 / 无单位」两种前置态;
   * 被测代码在调用时读取,故改写对下一次预填生效)。
   * @type {{ title?: string; organization?: string; author?: string; date?: string }}
   */
  let fmResponse = {};
  const dom = installDomStub({
    api: {
      // 本段不关心落盘:settingsSet 永不落定(写回流水线停在 await 处,不产生回填噪声)
      settingsSet: () => new Promise(() => {}),
      previewRefresh: () => Promise.resolve(),
      // 合并源列表渲染会在收尾写一次会话文件(file-list 的 persistSessionFiles);
      // 缺这个端口会同步抛 TypeError,而它被 addSources 的 catch 吞掉 ——
      // 症状会伪装成「预填没生效」,排查方向被整体带偏
      uiStateSet: () => Promise.resolve(),
      openMarkdowns: () => Promise.resolve(["C:\\work\\first.md"]),
      readFrontmatter: () => Promise.resolve(fmResponse),
    },
  });
  const openedSince = (/** @type {number} */ mark) => dom.created.slice(mark);
  /**
   * 按 id 取本次 open 建的元素(子节点含文本,需跳过非元素)。
   * @param {import("./dom-stub.js").StubElement[]} nodes
   * @param {string} id
   * @returns {import("./dom-stub.js").StubElement | null}
   */
  const findById = (nodes, id) =>
    nodes.find((el) => el.id === id) ?? null;
  /**
   * 按 class + dataset 取本次 open 建的元素。
   * @param {import("./dom-stub.js").StubElement[]} nodes
   * @param {string} className
   * @param {string} [i18n]
   * @returns {import("./dom-stub.js").StubElement | null}
   */
  const findByClass = (nodes, className, i18n) =>
    nodes.find(
      (el) => el.className === className && (i18n === undefined || el.dataset.i18n === i18n),
    ) ?? null;
  /** 子节点里是元素的那些(文本节点不算)。 @param {import("./dom-stub.js").StubNode[]} children */
  const elementChildren = (children) => children.filter((node) => typeof node === "object");
  /**
   * 取封面步四个字段行的 (标签键, 控件) 对(按 DOM 序)。
   * @param {import("./dom-stub.js").StubElement} pane
   * @returns {Array<{ label: import("./dom-stub.js").StubElement | undefined, control: import("./dom-stub.js").StubElement | undefined }>}
   */
  const coverRows = (pane) =>
    elementChildren(pane.children)
      .filter((el) => el.className === "wz-field")
      .map((row) => {
        const [label, control] = elementChildren(row.children);
        return { label, control };
      });

  try {
    const { state } = await import("../../dist/renderer/state/state.js");
    const { runtime } = await import("../../dist/renderer/wizard/wizard-runtime.js");
    const bookWizard = await import("../../dist/renderer/wizard/book-wizard.js");

    /** 付印交出的 metadata 明细(renderer 侧能观察到的最远一环)。 */
    /** @type {Array<{ files?: string[]; format?: "docx" | "pdf"; metadata?: { title?: string; organization?: string; author?: string; date?: string } }>} */
    const mergeCalls = [];
    const baseDeps = await loadBookWizardDeps();
    // runMerge 换成探针(真实那条走 IPC,产物面不在本层);withPrecheck 直接放行 ——
    // 本段判的是「向导交出了什么」,不是转换链路本身。
    const deps = {
      ...baseDeps,
      runMerge: (
        /** @type {{ files?: string[]; format?: "docx" | "pdf"; metadata?: { title?: string; organization?: string; author?: string; date?: string } } | undefined} */ opts,
      ) => {
        mergeCalls.push(opts ?? {});
        return Promise.resolve();
      },
      withPrecheck: async (
        /** @type {string[]} */ _filePaths,
        /** @type {() => void | Promise<void>} */ action,
      ) => {
        await action();
      },
    };

    // 段宿主是新进程 ⇒ state.settings 已由 state.ts 的模块初始化取好默认值
    // (不在这里 import core 的 cloneDefaultSettings:renderer 段跨层取 core 主体要另登记豁免)
    state.selectedFiles = [];
    state.mode = null;

    // ---- 1. 封面步四个输入:同段、同形、同序(书名 → 单位 → 作者 → 日期) ----
    let mark = dom.created.length;
    bookWizard.openBookWizard(deps);
    let nodes = openedSince(mark);
    const pane = nodes.find((el) => el.className === "wz-pane" && el.dataset.step === "2") ?? null;
    const rows = pane ? coverRows(pane) : [];

    await suite.case("封面步四个输入同段同形,顺序为 书名→单位→作者→日期", () => {
      assert(pane, "首开应构建封面步(step 2)的 pane");
      assert(rows.length === 4, `封面步应有四个字段行,实际 ${rows.length}`);
      assert(
        rows.map((row) => row.label?.dataset.i18n).join(",")
          === "wizard.cover.fieldTitle,wizard.cover.fieldOrganization,wizard.cover.fieldAuthor,wizard.cover.fieldDate",
        `封面步标签序应与产物封面同序(书名→单位→作者→日期),实际 ${rows.map((row) => row.label?.dataset.i18n).join(",")}`,
      );
      assert(
        rows.every((row) => row.control?.className === "tin"),
        `四个输入应沿用既有输入件形态(class=tin),实际 ${rows.map((row) => row.control?.className).join(",")}`,
      );
      assert(
        rows[1]?.control?.id === "wizardCoverOrganization",
        `单位输入应排在第二位,实际 ${rows[1]?.control?.id}`,
      );
      // 每个标签的 for 都指向本行控件(程序关联不因插一行而错位)
      assert(
        rows.every((row) => row.label?.getAttribute("for") === row.control?.id),
        "每个封面字段行的 label[for] 都应指向本行控件",
      );
    });

    await suite.case("单位标签消费既有 i18n 键(不是新键、不是硬编码文案)", () => {
      const label = rows[1]?.label;
      assert(label, "封面步应构建单位字段行的标签");
      assert(
        label.dataset.i18n === ORG_KEY,
        `单位标签应挂既有字典键 ${ORG_KEY},实际 ${label.dataset.i18n}`,
      );
      // 缺键时 t 的回退链最终返回键名本身 ⇒ 文案既非空也不等于键名,才说明当前语言
      // 字典里确有这个键(本段不 import core 字典,故用这条运行期形态代替查表比对)。
      // 三语齐由 check:i18n-keys 门禁守(键集对齐),不在本段重复。
      assert(
        label.textContent.length > 0 && label.textContent !== ORG_KEY,
        `单位标签文案应来自字典而非键名回落,实际 ${JSON.stringify(label.textContent)}`,
      );
    });

    // ---- 2. 预填(负例):frontmatter 无 organization 时单位留空,其余照填 ----
    fmResponse = { title: "文档标题", author: "文档作者", date: "2026-01-01" };
    const addBtn = findByClass(nodes, "btn btn-ghost", "wizard.merge.add");
    await suite.case("合并源步构建「添加文件」入口(预填经它触发)", () => {
      assert(addBtn, "应构建合并源步的添加文件按钮");
    });
    const addBtnEl = /** @type {import("./dom-stub.js").StubElement} */ (addBtn);
    fireListener(addBtnEl, "click");
    await flush();
    const orgInput = /** @type {import("./dom-stub.js").StubElement} */ (
      findById(nodes, "wizardCoverOrganization")
    );

    await suite.case("frontmatter 无 organization 时预填不写单位(其余字段照填)", () => {
      assert(runtime.draft.cover.title === "文档标题", `预填应写入 frontmatter 标题,实际 ${runtime.draft.cover.title}`);
      assert(
        orgInput.value === "" && runtime.draft.cover.organization === "",
        `frontmatter 无 organization 时单位应保持空(输入框 ${JSON.stringify(orgInput.value)} / 草稿 ${JSON.stringify(runtime.draft.cover.organization)})`,
      );
    });

    // ---- 3. 预填(正例,硬要求):frontmatter 带 organization → 输入框与草稿同时到位 ----
    bookWizard.closeBookWizard(deps);
    fmResponse = {
      title: "文档标题",
      organization: "青崖大学文学院",
      author: "文档作者",
      date: "2026-01-01",
    };
    mark = dom.created.length;
    bookWizard.openBookWizard(deps);
    nodes = openedSince(mark);
    const addBtn2 = findByClass(nodes, "btn btn-ghost", "wizard.merge.add");
    assert(addBtn2, "复开应重新构建添加文件按钮");
    fireListener(/** @type {import("./dom-stub.js").StubElement} */ (addBtn2), "click");
    await flush();
    const orgInput2 = /** @type {import("./dom-stub.js").StubElement} */ (
      findById(nodes, "wizardCoverOrganization")
    );

    await suite.case("frontmatter 带 organization 时向导预填到位(输入框 + 草稿态)", () => {
      assert(
        orgInput2.value === "青崖大学文学院",
        `预填应把 frontmatter 单位写进输入框,实际 ${JSON.stringify(orgInput2.value)}`,
      );
      assert(
        runtime.draft.cover.organization === "青崖大学文学院",
        `预填应把 frontmatter 单位写进草稿态(否则付印时被整对象替换吃掉),实际 ${JSON.stringify(runtime.draft.cover.organization)}`,
      );
      assert(
        runtime.draft.cover.title === "文档标题" && runtime.draft.cover.author === "文档作者",
        "同一轮预填应把标题/作者一并带上(单位不是单独一条路径)",
      );
    });

    // ---- 4. 向导内编辑 → 预览行与产物封面同序(单位 · 作者 · 日期) ----
    const titleInput = /** @type {import("./dom-stub.js").StubElement} */ (findById(nodes, "wizardCoverTitle"));
    const authorInput = /** @type {import("./dom-stub.js").StubElement} */ (findById(nodes, "wizardCoverAuthor"));
    const dateInput = /** @type {import("./dom-stub.js").StubElement} */ (findById(nodes, "wizardCoverDate"));
    titleInput.value = "排版付梓";
    orgInput2.value = "青崖大学";
    authorInput.value = "陈拾遗";
    dateInput.value = "2026-10-18";
    fireListener(orgInput2, "input");
    const metaNodes = dom.created.filter((el) => el.className === "wz-cover-meta");
    const meta = metaNodes[metaNodes.length - 1];

    await suite.case("预览行按「单位 · 作者 · 日期」同序体现单位", () => {
      assert(meta, "封面预览应渲染单位/作者/日期那一行");
      assert(
        meta.textContent === "青崖大学 · 陈拾遗 · 2026-10-18",
        `预览行项序应与产物封面一致(单位 · 作者 · 日期),实际 ${JSON.stringify(meta.textContent)}`,
      );
      assert(
        runtime.draft.cover.organization === "青崖大学",
        `向导内编辑应写进草稿态,实际 ${JSON.stringify(runtime.draft.cover.organization)}`,
      );
    });

    // ---- 5. 付印:封面草稿(含单位)随 metadata 交给 runMerge ----
    const finishBtn = findById(nodes, "wizardFinish");
    assert(finishBtn, "向导应构建付印按钮");
    fireListener(/** @type {import("./dom-stub.js").StubElement} */ (finishBtn), "click");
    await flush();

    await suite.case("付印交出的 metadata 带上单位(四字段齐,无一被漏掉)", () => {
      assert(mergeCalls.length === 1, `单格式付印应只发起一次合并,实际 ${mergeCalls.length}`);
      const md = mergeCalls[0]?.metadata;
      assert(md, "付印应把封面草稿作为 metadata 交给 runMerge");
      assert(
        md.organization === "青崖大学",
        `metadata 应带上向导里填的单位,实际 ${JSON.stringify(md?.organization)}`,
      );
      assert(
        md.title === "排版付梓" && md.author === "陈拾遗" && md.date === "2026-10-18",
        `metadata 应带上全部封面字段,实际 ${JSON.stringify(md)}`,
      );
      assert(mergeCalls[0]?.format === "docx", `草稿格式应随命令传出,实际 ${mergeCalls[0]?.format}`);
    });

    // ---- 6. 复开:单位态不残留(控件重建与草稿重置同源) ----
    mark = dom.created.length;
    bookWizard.openBookWizard(deps);
    const nodes3 = openedSince(mark);
    const orgInput3 = /** @type {import("./dom-stub.js").StubElement} */ (
      findById(nodes3, "wizardCoverOrganization")
    );

    await suite.case("复开后备复用单位不残留", () => {
      assert(orgInput3.value === "", `复开单位输入应清空,实际 ${JSON.stringify(orgInput3.value)}`);
      assert(
        runtime.draft.cover.organization === "",
        `复开草稿态单位应清空,实际 ${JSON.stringify(runtime.draft.cover.organization)}`,
      );
    });
    bookWizard.closeBookWizard(deps);

    console.log(
      "[ok] wizard-cover:封面步单位(四输入同形同序 / frontmatter 预填 / 预览同序 / 付印 metadata / 复开不残留)断言通过",
    );
    return { cases: suite.results };
  } finally {
    dom.restore();
  }
}
