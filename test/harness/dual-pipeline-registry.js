// @ts-check
/**
 * 双管线**登记册**:键表 + 矩阵行对照 + 由它们派生的纯判据。
 *
 * ## 为什么这些数据不住在台账段里
 *
 * 此前 `DUAL_PIPELINE_KEYS` / `MATRIX_ROW_IDS` / `MATRIX_ROW_TO_LEDGER` 三张表与两条
 * 纯函数住在台账段(现 `test/harness/dual-pipeline-decision-ledger.test.js`),矩阵段为了读它们
 * `import` 了那个段 —— **段 import 段**,与 `check-test-layout.mjs` 的 L4
 * (`test-layer-self-hosted`)冲突:段是**发现与隔离的单位**(runner 逐段起子进程),
 * 段间 import 让「一段失败」不再是可归因的最小单位,且被 import 的那段会在自己的
 * 进程里再跑一遍(双跑 + 顺序耦合)。
 *
 * 本模块是那个「既单一来源、又非段」的落点:数据与纯判据在此,两侧段各自 import 它。
 *
 * ## 三张表 + 45 项台账的分工(抽离边界)
 *
 * - **本模块**:键登记表(`DUAL_PIPELINE_KEYS`)、矩阵行集合(`MATRIX_ROW_IDS`)、
 *   矩阵行 → 台账条目对照(`MATRIX_ROW_TO_LEDGER`),以及三条纯判据。
 * - **台账段内不动**:45 项决策台账 `DECISION_LEDGER`。它从未被矩阵段读过(实测:矩阵段里
 *   一次都没出现,只在注释里被提及),故留在段内 —— 搬它会把「评审态的结论」与
 *   「被矩阵消费的登记数据」混在一处,而两者的更新节奏与责任人本就不同。
 *
 * ## `assertLedgerShape` 为什么也搬到了这里(附理由)
 *
 * 它原本在台账段内,但它核的是**几张表互相之间**的自洽:矩阵行对照表的键集合是否等于
 * 矩阵行集合、每个非 null 对照是否指向一条**真实台账条目**。前三张表既已搬出,把它留在
 * 段里等于让「主体在模块、判据在段」—— 段必须 import 模块才能核自己的数据,方向是反的。
 * 故一并搬来,并把段内的 45 项台账改为**入参**(纯函数 + 依赖注入):本模块因此零仓库内
 * 依赖,而台账段仍保有它真正的职责 —— 持有 45 项评审结论并触发形状守护。
 *
 * ⚠ 本文件名**不得**以 `.test.js` 结尾 —— 那会让它被 runner 的段发现当成一个段,
 * 并触发 L8(`test-harness-not-segment`)。
 */

/**
 * 一条决策项(形状与台账段的 `DECISION_LEDGER` 同源;本模块只按结构消费它)。
 *
 * @typedef {object} LedgerEntry
 * @property {string} id 稳定标识(引用时用;不因行序变化而失效)
 * @property {"literal" | "derivation" | "ordering"} group 所属枚举组
 * @property {string} semantic 语义(人读)
 * @property {"carrier-forced" | "drift" | "setting-void" | "matrix-locked"} bucket 四档归类
 * @property {string} docxSide docx 侧实现位置或形态
 * @property {string} pdfSide pdf 侧实现位置或形态
 * @property {string} rationale 归类理由
 * @property {string} [matrixRow] 若已被矩阵守护,记行 id
 * @property {string} [disposition] 非「不动」的处置结论
 */

/**
 * 双管线**键登记表**:段自己声明「哪些设置项属于 docx ↔ pdf 必须对齐的键」。
 *
 * ## 为什么要这张表(以及它取代了什么)
 *
 * 矩阵补行之前,「哪些设置项是双管线共有键」这个名单**只存在于矩阵段文件头的注释里**。
 * 注释不可判:改它不会让任何东西变红,新加一个键而忘了改注释(或者反过来,注释里多写
 * 一个键)都无人察觉。本表把那份名单变成可判数据,并与矩阵行的 `covers` 字段**双向交叉
 * 核对**(见下方 assertKeyCoverageRegistered 的头注)。
 *
 * ## 「键」的口径
 *
 * 一个设置项进表的条件是:**同一个设置在两条管线上都有可观察的行为**(不论两侧行为
 * 一致还是有意的差异)。只在一侧生效的设置项(如 pdf 侧的 `pdfCss` / `katexDir`)
 * 不进表 —— 它们没有「对齐」这回事。
 *
 * 注意其中两个键在类型上**不是** `SharedRenderOptions` 的共有字段
 * (`render-options.ts:46` 明确把 `tocMode` / `headerFooter` 列为 docx 侧独有条目):
 * 它们由 `convert` 层解析后透传给两侧(`convert.ts:267` 按 headerFooter 造 pdf 页眉
 * 模板、`DEFAULT_TOC_MODE` 经 convert 进 PdfArtifact)。即「键」判的是**行为覆盖面**,
 * 不是类型声明位置 —— 按类型声明位置筛会漏掉这两个。
 *
 * ## 表的边界:哪些键**刻意不在**表内
 *
 * 共有渲染契约(`render-options.ts` 的 `SharedRenderOptions` /
 * `ResolvedRenderSwitches`)里还有 `headingNumbering` 与 `captionNumbering` 两个开关,
 * 本表**刻意不收**:
 * - `captionNumbering` 的开/关双侧口径已由 caption-label-strip 行实跑断言
 *   (关开关后两侧同口径原样保留 label),按「已被现有行顺带锁住」处理;
 * - `headingNumbering` 在矩阵里**没有**对应行(章节号的有意差异由
 *   caption-before-first-h1 行覆盖的是 h1c 计数器的边界,不是这个开关本身)。
 *   收它进来会让「每个键至少被一行覆盖」当场判红,而补那行是新增矩阵行的活,
 *   不属本轮(登记字段化)范围 —— 故显式登记为**已知缺口**,而不是让它看起来
 *   「表已完备」。
 *
 * ## 这张表抓不到什么(必须照实说)
 *
 * 它是**手工登记**的,故只守「已登记的键不被遗忘」,**不守「键的完备性」**:
 * 有人往 `SharedRenderOptions` / `ResolvedRenderSwitches` 加了新字段却没往本表登记,
 * 两层机制(本表的键集合 + 矩阵行的 `covers` 字段)全绿。把完备性变成可判需要从 core
 * 反向枚举键集合并与本表求差集,那是「发现工具」,与本段「台账是登记工具,不是发现
 * 工具」的口径冲突(45 项决策条目同理:它们来自一次人工枚举)。本轮明确不做。
 *
 * @typedef {object} DualPipelineKey
 * @property {string} id 键名(与两侧实现里的设置字段同名)
 * @property {string} semantic 语义(人读)
 * @property {string} [note] 归类补充说明(为什么它在表内 / 口径例外)
 */

/** @type {readonly DualPipelineKey[]} */
export const DUAL_PIPELINE_KEYS = [
  {
    id: "pageSetup",
    semantic: "纸张 / 方向 / 四边距",
    note: "两侧同读同一份 validatePageSetup 几何门禁;page-geometry 行以 A5 + 四边互异实跑。",
  },
  {
    id: "toc",
    semantic: "是否自动生成目录",
    note: "toc-levels 行锁层级口径,另与 tocMode 组成一对(见下条)。",
  },
  {
    id: "tocMode",
    semantic: "目录模式(static / field)",
    note: "口径例外:类型上属 docx 侧独有条目(render-options.ts:46),但经 convert 解析后"
      + "进 PdfArtifact 驱动 pdf 两遍法,故按行为覆盖面进表。",
  },
  {
    id: "equationNumbering",
    semantic: "公式编号开关",
    note: "equation-label-switch 行断言开启时编号连续 + 关闭时两侧同口径不编号。",
  },
  {
    id: "typography",
    semantic: "正文字体 / 字号 / 行距 / 缩进 / 对齐(及题注、代码字号推导)",
    note: "本键补行时长期零覆盖,由 body-typography 与 derived-font-sizes 两行共同覆盖;"
      + "单行不足以锁全(前者不锁推导字号,后者不锁对齐与缩进)。",
  },
  {
    id: "breakBeforeH1",
    semantic: "一级标题前分页",
    note: "本键补行时长期零覆盖;现由 break-before-h1 行以开/关两侧对照实跑。",
  },
  {
    id: "headerFooter",
    semantic: "页眉模式 / 页眉文字 / 页脚开关与页码",
    note: "口径例外:类型上属 docx 侧独有条目,但 convert.ts:267 据此造 pdf 页眉页脚模板。"
      + "已确认的失效点(页眉 default 模式在 pdf 侧整体静默出空页眉)正在此键上。",
  },
  {
    id: "watermark",
    semantic: "文字水印的文字 / 配色 / 角度 / 不透明度",
    note: "本键补行时长期零覆盖。已确认的两处失效正在此键上:角度两侧符号约定相反、"
      + "不透明度在 docx 侧零消费。",
  },
];

/**
 * 差异矩阵的**全部行 id**(单源在此;矩阵段反向断言自己的行集合与之逐字相同)。
 *
 * 机制:矩阵段与本台账互为对方的漏登记探测器 ——
 * - 矩阵段断言「我的行集合 == MATRIX_ROW_IDS」:矩阵加了行而没登记进本表 → 判红;
 * - 本段断言「对照表与行集合逐字相同,且每个非 null 指向命中真实条目」。
 *
 * 两侧各断一个方向,单侧失守不会静默。这管的是「新增矩阵**行**」;
 * 「新增双管线**键**」由 DUAL_PIPELINE_KEYS + 矩阵行 `covers` 字段那一对负责
 * (见 assertKeyCoverageRegistered),两层不互相替代。
 */
export const MATRIX_ROW_IDS = [
 "frontmatter-strip",
 "page-geometry",
 "html-whitelist",
 "explicit-page-break",
 "toc-levels",
 "caption-numbering",
 "caption-label-strip",
 "crossref-text-dangling",
 "equation-label-switch",
 "katex-limits",
 "code-highlight",
 "xref-label-namespace",
 "formula-degrade-trigger",
 "mermaid-carrier",
 "footnote-implementation",
 "tasklist-rendering",
 "image-budget-accounting",
 "heading-id-fallback",
 "toc-page-numbers",
 "cancel-checkpoint-density",
 "caption-before-first-h1",
 "body-typography",
 "derived-font-sizes",
 "break-before-h1",
 "header-footer-modes",
 "watermark",
];

/**
 * 矩阵行 → 台账条目的对照(值为 null = 该行守护载体机制差异、决策层零分叉,
 * 故台账 45 项按定义不收它;理由逐条写在该行行尾注释里)。
 *
 * 加了矩阵行却没在这张表里出现 → assertLedgerShape 判红。这是「让新键有地方
 * 登记」的兜底:每个新行必须落到「某条台账条目」或「载体机制差异」二者之一。
 */
export const MATRIX_ROW_TO_LEDGER = {
 "frontmatter-strip": null, // 共用 parseFrontmatter,零决策分叉
 "page-geometry": "derive-orientation-visual-size",
 "html-whitelist": null, // 白名单集合已共用单源模块
 "explicit-page-break": null, // 注释语法在共用正则族
 "toc-levels": "order-toc-levels",
 "caption-numbering": "derive-caption-number-text",
 "caption-label-strip": "order-label-strip",
 "crossref-text-dangling": null, // 文案/占位已共用 CROSS_REF_KINDS
 "equation-label-switch": "order-equation-seq",
 "katex-limits": null, // 资源边界已共用 resource-limits 单源
 "code-highlight": "derive-code-highlight-palette",
 "xref-label-namespace": "order-label-namespace",
 "formula-degrade-trigger": null, // 降级触发的分叉由两侧同源判据决定
 "mermaid-carrier": null, // 载体机制差异(内嵌 PNG vs 内联 SVG)
 "footnote-implementation": null, // 载体机制差异(部件 vs HTML 区)
 "tasklist-rendering": null, // 载体机制差异 + Chromium 打印 bug 规避
 "image-budget-accounting": null, // 记账口径由载体所迫(原始字节 vs base64 字节)
 "heading-id-fallback": null, // 兜底取源由载体所迫(AST 纯文本 vs token 原文)
 "toc-page-numbers": "literal-toc-page-injection",
 "cancel-checkpoint-density": "derive-cancel-checkpoint-density",
 "caption-before-first-h1": "derive-chapter-h2-without-h1",
 "body-typography": "derive-line-spacing",
 // 本行同时由 derive-code-font-size 条目声明 matrixRow(题注与代码字号同源于正文字号,
 // 一行实跑锁两侧三处取值);对照表按行 → 首个条目登记。
 "derived-font-sizes": "literal-caption-font-size",
 "break-before-h1": "literal-switch-defaults",
 "header-footer-modes": "literal-header-default-mode",
 watermark: "derive-watermark-opacity",
};

/**
 * 台账自身的结构守护:四档取值合法、id 唯一、归因非空、group 三选一、
 * 每条 setting-void 项都写明处置,且矩阵行对照表与矩阵行集合逐字相同。
 * @param {readonly LedgerEntry[]} ledger 45 项决策台账(由调用段注入 —— 本模块零仓库内依赖)
 * @returns {void}
 */
export function assertLedgerShape(ledger) {
 /** @type {Set<string>} */
 const ids = new Set();
 /** @type {Set<string>} */
 const buckets = new Set(["carrier-forced", "drift", "setting-void", "matrix-locked"]);
 for (const e of ledger) {
 if (ids.has(e.id)) throw new Error(`[dual-ledger] 条目 id 重复:${e.id}`);
 ids.add(e.id);
 if (!buckets.has(e.bucket)) throw new Error(`[dual-ledger:${e.id}] bucket 非法:${e.bucket}`);
 if (e.group !== "literal" && e.group !== "derivation" && e.group !== "ordering") {
 throw new Error(`[dual-ledger:${e.id}] group 非法:${e.group}`);
 }
 if (typeof e.rationale !== "string" || e.rationale.length < 8) {
 throw new Error(`[dual-ledger:${e.id}] 缺归类理由`);
 }
 if (e.bucket === "setting-void" && !e.disposition) {
 throw new Error(`[dual-ledger:${e.id}] setting-void 项必须写明处置(不得留在表里不修)`);
 }
 }
 const mapped = Object.keys(MATRIX_ROW_TO_LEDGER).sort();
 const actual = [...MATRIX_ROW_IDS].sort();
 if (mapped.join(",") !== actual.join(",")) {
 const missing = actual.filter((k) => !mapped.includes(k));
 const extra = mapped.filter((k) => !actual.includes(k));
 throw new Error(
 `[dual-ledger] 矩阵行对照表与矩阵行集合不一致`
 + `(未登记:${missing.join(",") || "无"};表中多余:${extra.join(",") || "无"})`,
 );
 }
 for (const [row, entryId] of Object.entries(MATRIX_ROW_TO_LEDGER)) {
 if (entryId === null) continue;
 if (!ids.has(entryId)) {
 throw new Error(`[dual-ledger] 矩阵行 ${row} 指向的台账条目不存在:${entryId}`);
 }
 }
}

/**
 * 双管线键覆盖的**结构守护**:键集合本身合法,且每个键至少被一行矩阵行覆盖。
 *
 * ## 形状为什么是「段级键集合 + 逐行 covers 标注」这一对
 *
 * 这道门的真实目的不是「跑矩阵」,是**防将来忘写** —— 有人加了新维度 / 新双管线键,却
 * 忘了加对应矩阵行。故判据必须能回答「**段自己声明的键,是不是每一项都至少被一行覆盖
 * 到**」。两个方向合起来才答得了,单有一侧都不够:
 *
 * - **只有逐行 `covers`** → 只答得了「这行覆盖了啥」,答不了「有没有键没人管」。新加一
 *   个键而没加行时,旧行一句不多一句不少,全绿 —— 正是要防的那种忘写。
 * - **只有段级键集合** → 答得了「有没有键没人管」,但答不了「这行声称覆盖的是不是真覆
 *   盖了」:`covers` 里写一个早已不存在的行 id,无人察觉。
 * - **两者交叉**(本设计)→ 段级声明「应覆盖哪些键」(DUAL_PIPELINE_KEYS),逐行声明「我覆
 *   盖哪些键」(行内 `covers` 字段),本函数断两条:① 每个声明的键至少被一行命中;② covers
 *   里的键都在声明集合内。新键漏行、covers 写未声明的键,各自判红。
 *
 * `coversByRow` 由矩阵段传入(它拥有 MATRIX 行),故本函数**不反向依赖**矩阵段 ——
 * 依赖方向与 MATRIX_ROW_IDS 相同(矩阵段 → 本段)。
 *
 * ## 抓不到什么(诚实写出来,是 ADR 后果行的素材)
 *
 * 1. **完备性**:键集合手工登记。新增一个 core 共有字段而没往 DUAL_PIPELINE_KEYS 登记 ⇒
 *    本函数与矩阵段全绿。要判完备需从 core 反向枚举键集合求差集,那是「发现工具」,与本段
 *    「台账是登记工具」的口径冲突,本轮明确不做。
 * 2. **覆盖的深度**:`covers: ["watermark"]` 只表示「该键有可执行断言入口」,不表示断言
 *    触及该键的每个子项。逐子项完备性不可判。
 * 3. **断言的有效性**:一行可声明覆盖某键却把 `verify` 写成恒真 —— 形状守护管不到,那属
 *    各行自身的断言质量(由各行实跑与门禁探针的负向负责)。
 *
 * @param {Record<string, readonly string[]>} coversByRow 矩阵行 id → 该行声明覆盖的键集合
 * @returns {void}
 */
export function assertKeyCoverageRegistered(coversByRow) {
 /** @type {Set<string>} */
 const keyIds = new Set();
 for (const key of DUAL_PIPELINE_KEYS) {
  if (keyIds.has(key.id)) throw new Error(`[dual-ledger] 双管线键 id 重复:${key.id}`);
  keyIds.add(key.id);
  if (typeof key.semantic !== "string" || key.semantic.length < 2) {
  throw new Error(`[dual-ledger:key:${key.id}] 键缺语义描述`);
  }
 }
 // 方向一:每个声明的键至少被一行 covers 命中(新键漏行在此判红)
 /** @type {Map<string, string[]>} */
 const hitRows = new Map([...keyIds].map((id) => [id, []]));
 for (const [row, keys] of Object.entries(coversByRow)) {
  if (!Array.isArray(keys)) {
  throw new Error(`[dual-ledger] 矩阵行 ${row} 的 covers 不是数组(键覆盖字段缺失或写错形态)`);
  }
  for (const key of keys) {
  if (!keyIds.has(key)) {
  // 方向二:covers 里出现未声明的键(登记漂移 / 拼错 / 行凭空声明)在此判红
  throw new Error(`[dual-ledger] 矩阵行 ${row} 声明覆盖未登记的键:${key}`);
  }
  hitRows.get(key)?.push(row);
  }
 }
 const uncovered = [...keyIds].filter((id) => (hitRows.get(id) ?? []).length === 0);
 if (uncovered.length > 0) {
  throw new Error(
  `[dual-ledger] 双管线键无任何矩阵行覆盖:${uncovered.join(",")}`
  + "(新增双管线键必须补矩阵行,或在 DUAL_PIPELINE_KEYS 里显式登记为不需矩阵行)",
  );
 }
}

/**
 * 键 → 覆盖它的矩阵行数(供段内打印核对;不是断言阈值)。
 * @param {Record<string, readonly string[]>} coversByRow 矩阵行 id → 该行声明覆盖的键集合
 * @returns {Record<string, number>} 键 id → 覆盖它的行数
 */
export function keyCoverageCounts(coversByRow) {
 /** @type {Record<string, number>} */
 const counts = {};
 for (const key of DUAL_PIPELINE_KEYS) counts[key.id] = 0;
 for (const keys of Object.values(coversByRow)) {
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
 }
 return counts;
}
