// @ts-check
/**
 * 双管线**决策项台账**:45 项决策层条目逐条归四档(adr-030 决定要点四 · 6-A)。
 *
 * ## 这份台账为什么存在
 *
 * 原诊断(archive/20260927-222300)把双管线的重复系统枚举为 45 项,结论是
 * 「代码本身没有『该重构』的地方 —— 重复都是局部的、成对的、有注释标注的。
 * 缺的是一张表,和一个保证新键会进表的机制」。
 *
 * **本台账是登记工具,不是发现工具。** 它的价值只在「下一次有人加一个双管线键时,
 * 有一个地方必须填一行」这件事上成立;发现新重复靠的是别的手段(差异矩阵、
 * 渲染期观察),台账不负责。若把它读成「已穷举全部重复」,那是被它的形态骗了 ——
 * 45 项来自一次人工枚举,不是从代码推导出的完备集。
 *
 * ## 为什么不放 core(以及为什么现在在 `test/harness/`)
 *
 * 判定类别与「处置」是**评审结论**,不是运行时事实;放 core 等于把评审态的
 * 分类编译进发布产物(与差异矩阵同款理由,见 dual-pipeline-matrix.test.js 头注)。
 * 这条理由**今天依然成立**,它排除的是 `src/core/**`(被测层)而不是任何位置。
 *
 * T3 步 6 之前本段住在 `test/core/`(自称「跨域守护段」),那其实是个**说不通的位置**:
 * 它的被测对象既不在 `src/core/`,也不在测试框架里,而是它自己文件内的数据 ——
 * L4 的「零本层主体」因此判红,而声明 `src/core/**` 只能靠撒谎变绿。同批的处置是:
 * 三张被矩阵段消费的表(`DUAL_PIPELINE_KEYS` / `MATRIX_ROW_IDS` /
 * `MATRIX_ROW_TO_LEDGER`)与三条纯判据搬进**非段**模块
 * `test/harness/dual-pipeline-registry.js`,段留在测试树并搬进 `test/harness/`
 * (那里是「测试树自身的登记与判据」的归宿,与它「评审态结论」的属性同调)。
 * 45 项 `DECISION_LEDGER` 仍留本段内 —— 它从未被矩阵段读过,搬它只会把评审结论与
 * 被消费的登记数据混在一处。
 *
 * ## 四档与各自的含义
 *
 * | 档 | 含义 | 处置 |
 * |---|---|---|
 * | `carrier-forced` | 载体所迫:同一规则在两种数据结构上的表达(AST 遍历 vs token 遍历、CSS counter vs OOXML 域) | 登记,不动 |
 * | `drift` | 实质漂移:同一输入 → 不同输出 | 修,或登记为已知差异并进矩阵 |
 * | `setting-void` | 设置项失效:设置项在一侧无消费或行为不同 | 必修(6-B / 6-C) |
 * | `matrix-locked` | 已被矩阵某行 `mustMatch` / `allowedDiff` 守护 | 不动 |
 *
 * 「不动」不等于「不用看」:`carrier-forced` 与 `matrix-locked` 的区别是前者靠
 * 载体性质保证一致(动一侧必然动另一侧),后者靠可执行断言保证。两者都不动代码,
 * 但只有后者有回归防护。
 *
 * ## 机制:新键必须进这张表
 *
 * 三层,各断一个方向,单侧失守不会静默:
 *
 * 1. **键登记表**(`DUAL_PIPELINE_KEYS`,本文件内):段自己声明「哪些设置项是双管线
 *    共有键」。它取代了原先只存在于矩阵段头注释里的那份名单 —— 注释不可判,改注释
 *    不会让任何东西变红。
 * 2. **矩阵行 `covers` 字段**(dual-pipeline-matrix.test.js 内):每行声明自己覆盖哪
 *    几个键。矩阵段的 `assertMatrixShape` 与本表**双向**交叉核对(见该文件头注)。
 * 3. **阴性自检**(`gates/probe/check-gate-probes.mjs` 的 `dual-matrix` 门禁探针):往沙盒
 *    工程副本里删一处 `covers` 标记 / 塞一个未登记的键,断言验收段真的判红 ——
 *    证明第 2 层不是恒真断言。
 *
 * 与 45 项决策台账的关系:那份表登记的是**决策项**(值/推导/排序三类),本表登记的是
 * **设置键**(两侧渲染入口共有的那几个)。两者不是同一维度,故分表而非合并 ——
 * 合并会逼着每个键在「决策项」里凑一条,而多数键(如 `toc`)的取值并无决策分叉。
 *
 * **登记表是手工维护的,这一点必须写明**:它守的是「已登记的键不被遗忘」,**不是**
 * 「键的完备性」。有人往 `SharedRenderOptions` 加了新字段却没登记进本表,两层机制
 * (本表的键集合 + 矩阵行的 `covers` 字段)全绿。把完备性也变成可判需要从 core 反向
 * 枚举键集合(与本段「台账是登记工具,不是发现工具」的口径冲突),本轮不做。
 */

/*
 * 本段测哪一层:**不是 core**(见本文件头注「## 为什么不放 core」一节 —— 判定类别与
 * 「处置」是**评审结论**,不是运行时事实;放 core 等于把评审态的分类编译进发布产物)。
 *
 * ⚠ **本段刻意不写 `export const covers`**,理由有三,每条都经实测核对:
 * 1. 本段**零 import、零 fs、零子进程**(grep 实测:`^import` / `require(` / `fs.` /
 *    `spawn` 全部零命中)—— 被测的「台账」就是本文件内的 `DECISION_LEDGER` /
 *    `DUAL_PIPELINE_KEYS` / `MATRIX_ROW_IDS` / `MATRIX_ROW_TO_LEDGER` 四张数据表,
 *    `run()` 只调 `assertLedgerShape()` 核它们自身的形状(id 唯一 / 四档合法 / 归因非空 /
 *    setting-void 必写处置 / 矩阵行对照表逐字相同)。台账条目里的 `docxSide` / `pdfSide`
 *    是**人读的实现位置描述**,`assertLedgerShape` 从不拿它们核磁盘 —— 声明任何
 *    `src/core/**` 都是拿一份未被断言的字符串冒充被测主体。
 * 2. L6 判「空数组」与「缺声明」等效(两者都判红),而写非空数组必含一个不属 core 的
 *    元素 —— 那正是本段拒绝做的事。
 * 3. 因此 L4 的「零本层主体」在本段**判红是正确的**,它如实表达「这一段没有 core 主体」。
 *
 * 另一格 L4 判红(「段 import 段」:本段被 dual-pipeline-matrix.test.js 导入)同理:
 * ADR-062:210 已定「矩阵/表不该被拆碎」,该红**不该靠拆段解决**。
 */

import { createCaseSuite } from "./case.js";
import {
  DUAL_PIPELINE_KEYS,
  MATRIX_ROW_IDS,
  assertLedgerShape,
} from "./dual-pipeline-registry.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**harness** ——「本层主体根就是 `test/harness/`
 * 自己」。
 *
 * 主体是 `test/harness/dual-pipeline-registry.js`:三张登记数据表(键登记表 / 矩阵行集合 /
 * 矩阵行→台账对照)与三条由它们派生的纯判据(台账形状守护 / 键覆盖交叉核对 / 逐键覆盖数)。
 * `run()` 调 `assertLedgerShape(DECISION_LEDGER)` —— 台账数据由本段持有、被守护的
 * 「表与表之间自洽」由模块里的判据执行。
 *
 * T3 步 6 之前本段**刻意不写 covers**(零主体、声明 core 即撒谎)。同批把三张表与判据
 * 抽进那个非段模块后,主体才第一次真实存在,声明随之成立;另一格「段 import 段」
 * (矩阵段曾 import 本段取那三张表)也随之消掉 —— 数据与判据在非段模块里,
 * 两个段各自 import 它,ADR-062:210「矩阵/表不该被拆碎」的约束不受影响。
 */
export const covers = ["test/harness/dual-pipeline-registry.js"];

/**
 * 一条决策项。
 *
 * @typedef {object} LedgerEntry
 * @property {string} id 稳定标识(引用时用;不因行序变化而失效)
 * @property {"literal" | "derivation" | "ordering"} group 所属枚举组:默认值字面量 / 推导逻辑 / 排序编号规则
 * @property {string} semantic 语义(人读)
 * @property {"carrier-forced" | "drift" | "setting-void" | "matrix-locked"} bucket 四档归类
 * @property {string} docxSide docx 侧实现位置或形态
 * @property {string} pdfSide pdf 侧实现位置或形态
 * @property {string} rationale 归类理由(为什么落这一档 —— 这一栏是台账的主体,不是装饰)
 * @property {string} [matrixRow] 若已被矩阵守护,记行 id(未锁则省略)
 * @property {string} [disposition] 非「不动」的处置结论
 */

/** @type {readonly LedgerEntry[]} */
export const DECISION_LEDGER = [
 /* ---------- 7a 默认值字面量(15 项) ---------- */
 {
 id: "literal-watermark-font-size",
 group: "literal",
 semantic: "水印字号 72pt",
 bucket: "carrier-forced",
 docxSide: "chrome.ts TextRun size:144(half-points)",
 pdfSide: "template.ts font-size: 72pt",
 rationale: "同一视觉尺寸,单位不同(half-point vs pt);字面量不可共用,但换算关系固定。",
 },
 {
 id: "literal-caption-prefix",
 group: "literal",
 semantic: "题注编号前缀「图 」「表 」",
 bucket: "matrix-locked",
 docxSide: "captions.ts prefix 字面量",
 pdfSide: "xref.ts 编号文本 + template-css.ts ::before content",
 rationale: "pdf 侧的显示态编号走 CSS 伪元素(不进文本节点),故前缀必然在 CSS 里再写一次;这是载体所迫,但两侧文本的**一致性**已由 caption-numbering 行锁住。",
 matrixRow: "caption-numbering",
 },
 {
 id: "literal-eq-default-text",
 group: "literal",
 semantic: "公式引用默认文本「式」/「公式」",
 bucket: "matrix-locked",
 docxSide: "link-xref.ts(现读 CROSS_REF_KINDS.eq.defaultTexts)",
 pdfSide: "equation.ts(现读同一份)",
 rationale: "已并入 CROSS_REF_KINDS 单源(此前两侧各判一次);残余的登记是矩阵行防其漂回。",
 matrixRow: "equation-label-switch",
 disposition: "已收单源",
 },
 {
 id: "literal-eq-placeholder",
 group: "literal",
 semantic: "公式引用占位「(N)」/「(?)」",
 bucket: "matrix-locked",
 docxSide: "link-xref.ts(现读 danglingText + numberSuffix)",
 pdfSide: "equation.ts(同)",
 rationale: "同上,收单源;括号包裹形态是 eq 独有条目,由表的 numberSuffix 表达。",
 matrixRow: "equation-label-switch",
 disposition: "已收单源",
 },
 {
 id: "literal-eq-dangling-warning",
 group: "literal",
 semantic: "公式悬空警告文案",
 bucket: "drift",
 docxSide: "warn.crossRefNotFound「交叉引用未找到公式 label: …」",
 pdfSide: "warn.eqLabelUndefined「引用未定义的公式标签: eq:…」",
 rationale: "两侧文案不同且**这是有意的历史差异**(两侧各有一个 i18n key,改一侧会让既有语言包失配);只统一了 kindName 的取值来源,没有统一 key。属实质漂移但已承认,不修。",
 disposition: "已承认分歧,不修;改动需同时动三语言 i18n 包",
 },
 {
 id: "literal-caption-font-size",
 group: "literal",
 semantic: "题注字号「正文小一号,下限 8pt」",
 bucket: "matrix-locked",
 docxSide: "typography.ts captionFontSizePt(随正文变化,经 handlers/captions.ts 消费)",
 pdfSide: "typography.ts captionFontSizePt(同一函数,经 template-css.ts 消费)",
 rationale: "已按产品裁决上浮为共享推导:原先 docx 侧内联 Math.max(8, bodySizePt-1) 而 pdf 侧固定 10pt,现两侧同读 core/settings/typography.ts 的 captionFontSizePt。副产物:pdf 题注在默认 12pt 档由 10pt 变 11pt(取 docx 侧语义),属预期的用户可见变化。",
 matrixRow: "derived-font-sizes",
 disposition: "已修 —— 原「修法是让 pdf 侧也从 bodySizePt 推导」待产品裁决;现用户已裁决:两侧统一到从正文字号推导、不取硬编码值,题注沿用 docx 侧 Math.max(8, 正文-1) 的语义",
 },
 {
 id: "literal-list-indent",
 group: "literal",
 semantic: "列表内容栏左缩进 720 twips",
 bucket: "carrier-forced",
 docxSide: "numbering.ts listContentIndent 单源(编号定义与公式缩进共用)",
 pdfSide: "无对应(list 走浏览器默认缩进)",
 rationale: "docx 侧已单源(该文件头注记录曾有两份 720);pdf 侧根本没有这个概念,不是重复。",
 },
 {
 id: "literal-chapter-format",
 group: "literal",
 semantic: "章节编号格式串",
 bucket: "carrier-forced",
 docxSide: "numbering.ts OOXML text: \"%1.%2.%3\"",
 pdfSide: "template-css.ts CSS counter 规则",
 rationale: "OOXML 域与 CSS counter 是两种机制,字面量无法共用;两侧的**输出一致性**另由 caption-numbering / toc-levels 行锁。",
 matrixRow: "caption-numbering",
 },
 {
 id: "literal-toc-page-injection",
 group: "literal",
 semantic: "目录页码注入",
 bucket: "matrix-locked",
 docxSide: "chrome.ts Word TOC 域(static 无页码 / field 触发更新)",
 pdfSide: "main 层两遍法 printToPDF + injectTocPageNumbers",
 rationale: "载体所迫(Word 域 vs 需实打印才知道页码),差异方向已登记为 allowedDiff。",
 matrixRow: "toc-page-numbers",
 },
 {
 id: "literal-switch-defaults",
 group: "literal",
 semantic: "6 个渲染开关默认值",
 bucket: "matrix-locked",
 docxSide: "render.ts ctx.config 组装(构造时解析)",
 pdfSide: "render.ts 三处 + convert.ts 两处分散解析",
 rationale: "取值本就一致,但**分散在 5 处**是两处失效得以藏身的直接原因。已收成 resolveRenderSwitches 一个纯函数;矩阵 body-typography / break-before-h1 两行守产物层,render-defaults 段守解析层。",
 matrixRow: "break-before-h1",
 disposition: "已收单源并逐键断言",
 },
 {
 id: "literal-missing-field-normalize",
 group: "literal",
 semantic: "缺字段归一策略(partial 对象补默认)",
 bucket: "matrix-locked",
 docxSide: "render.ts 归一 headerFooter + watermark",
 pdfSide: "convert.ts 归一一次,template.ts 不做",
 rationale: "修复前 docx 做了两遍(幂等)、pdf 侧靠 convert 层做一次;现两侧都经 resolveHeaderFooter / resolveRenderSwitches。水印的 partial 补默认由 render-defaults 段断言。",
 disposition: "已收单源",
 },
 {
 id: "literal-paper-size",
 group: "literal",
 semantic: "纸张尺寸(A4/A3/A5/Letter/Legal)",
 bucket: "matrix-locked",
 docxSide: "render.ts 查 PAPER_SIZES_MM → mmToTwips",
 pdfSide: "template-css.ts @page size 直接拼纸名",
 rationale: "pdf 侧依赖 CSS 对纸名的隐式知识(A5 在 Chromium 有定义),但两者对同一 paper 值产出同一物理尺寸;page-geometry 行用 A5 + 四边互异实跑锁住。",
 matrixRow: "page-geometry",
 },
 {
 id: "literal-footer-switch",
 group: "literal",
 semantic: "页脚开关默认值",
 bucket: "matrix-locked",
 docxSide: "render.ts 读 headerFooter.footerEnabled",
 pdfSide: "convert.ts 读同一字段",
 rationale: "同一个 DEFAULT_HEADER_FOOTER.footerEnabled;header-footer-modes 行断言两侧页脚文案同构。",
 matrixRow: "header-footer-modes",
 },
 {
 id: "literal-header-default-mode",
 group: "literal",
 semantic: "页眉模式 default 的行为",
 bucket: "matrix-locked",
 docxSide: "headers.ts 渲染「文档标题居中页眉」",
 pdfSide: "template.ts 现在同样渲染「文档标题居中页眉」",
 rationale: "修复前 pdf 侧出**空页眉**(标题只进 <title>),即页眉功能在 pdf 侧整体静默失效 —— 本表唯一两处确认失效之一。",
 matrixRow: "header-footer-modes",
 disposition: "已修(统一到 docx 侧)",
 },
 {
 id: "literal-bullet-charset",
 group: "literal",
 semantic: "列表 bullet 字符集",
 bucket: "carrier-forced",
 docxSide: "numbering.ts [\"•\",\"◦\",\"▪\"]",
 pdfSide: "无(list-style 由浏览器默认决定)",
 rationale: "pdf 侧没有 bullet 字符集这个概念,不是重复;要统一得引入 CSS list-style-type 覆盖,收益不匹配成本。",
 },

 /* ---------- 7b 推导逻辑(20 项) ---------- */
 {
 id: "derive-orientation-visual-size",
 group: "derivation",
 semantic: "orientation → 视觉页尺寸",
 bucket: "matrix-locked",
 docxSide: "validatePageSetup 内的共用分支",
 pdfSide: "同函数",
 rationale: "已是同一纯函数;page-geometry 行实跑锁住 A5 + landscape 交换。",
 matrixRow: "page-geometry",
 },
 {
 id: "derive-heading-scale-pt",
 group: "derivation",
 semantic: "headingScale 档位 → 磅值",
 bucket: "carrier-forced",
 docxSide: "typography.ts headingFontSizePt",
 pdfSide: "同函数",
 rationale: "共享纯函数,两侧零重复;档位枚举表亦共用。",
 },
 {
 id: "derive-heading-spacing",
 group: "derivation",
 semantic: "headingSpacing 档位 → 段前/段后",
 bucket: "carrier-forced",
 docxSide: "typography.ts headingSpacingTwips(pt × 20)",
 pdfSide: "同函数的 headingSpacingPt(pt 直用)",
 rationale: "档位 → pt 同一函数,末端单位换算分叉是载体差异。",
 },
 {
 id: "derive-chapter-text",
 group: "derivation",
 semantic: "章节号文本(1 / 3.2 / 3.2.1)",
 bucket: "matrix-locked",
 docxSide: "heading-numbering.ts 单源",
 pdfSide: "同函数(xref 替换引用文本时消费)",
 rationale: "共享纯函数;toc-levels 与 caption-numbering 行锁住其输出。",
 matrixRow: "toc-levels",
 },
 {
 id: "derive-body-size-halfpoint",
 group: "derivation",
 semantic: "bodySizePt → half-point",
 bucket: "carrier-forced",
 docxSide: "render.ts × 2",
 pdfSide: "不适用(CSS 直接用 pt)",
 rationale: "单位换算,不是决策重复。",
 },
 {
 id: "derive-watermark-angle",
 group: "derivation",
 semantic: "watermark.angle → 旋转量",
 bucket: "matrix-locked",
 docxSide: "chrome.ts 读 watermarkDmlRotation 的换算结果",
 pdfSide: "template.ts 直接用 settings 值(正 = 顺时针)",
 rationale: "修复前两侧符号约定相反且**全链路无补偿性取负**,是「用户可见的方向反转」;已把口径与符号系数收敛到 settings-defaults 的两个常量,两侧同号。",
 matrixRow: "watermark",
 disposition: "已修(角度 315 = 左下→右上;翻转点 = WATERMARK_DML_ROTATION_SIGN 一个常量,方向待人工渲染确认)",
 },
 {
 id: "derive-watermark-opacity",
 group: "derivation",
 semantic: "watermark.opacity → 文字不透明度",
 bucket: "matrix-locked",
 docxSide: "chrome.ts w14:textFill/w14:alpha(修复前零消费,靠浅灰配色近似)",
 pdfSide: "template.ts CSS opacity(一直真消费)",
 rationale: "本表唯一两处确认失效之二。修复前选 docx 时该设置静默失效。",
 matrixRow: "watermark",
 disposition: "已修(docx 侧真消费 w14:alpha;未退到「界面条件禁用」)",
 },
 {
 id: "derive-watermark-gray",
 group: "derivation",
 semantic: "watermark.gray → 颜色",
 bucket: "matrix-locked",
 docxSide: "chrome.ts 读共享常量 WATERMARK_GRAY / WATERMARK_INK",
 pdfSide: "template.ts 读同两个常量",
 rationale: "已共用;watermark 行断言两侧取同一常量。",
 matrixRow: "watermark",
 },
 {
 id: "derive-chapter-h2-without-h1",
 group: "derivation",
 semantic: "章节号「无 h1 文档里 h2 显示几」",
 bucket: "matrix-locked",
 docxSide: "heading-numbering.ts 无 h1 时从「1」起",
 pdfSide: "template-css.ts 另写一套 CSS 分支",
 rationale: "CSS counter 无法回看「文档里有没有 h1」,只能靠 hasH1 布尔选分支;这是载体所迫,但两侧的**一致性**由 caption-before-first-h1 行锁住(有 h1 / 无 h1 两种文档各跑一次)。",
 matrixRow: "caption-before-first-h1",
 },
 {
 id: "derive-caption-reset-at-h1",
 group: "derivation",
 semantic: "图/表序「h1 处重置」",
 bucket: "matrix-locked",
 docxSide: "captions.ts 预扫时 chapter 递增",
 pdfSide: "xref.ts 登记 + template-css.ts counter-reset",
 rationale: "三处(登记侧 + 显示侧 + docx 预扫),机制不同;caption-numbering 行断言「图 1.1 … 图 2.1」的跨章重置。",
 matrixRow: "caption-numbering",
 },
 {
 id: "derive-caption-number-text",
 group: "derivation",
 semantic: "题注编号文本「图 3.1」",
 bucket: "matrix-locked",
 docxSide: "captions.ts captionNumberText(静态文本)",
 pdfSide: "xref.ts 引用替换 + template-css.ts ::before(显示态)",
 rationale: "最集中的「同一语义三套实现」之一,但**输出必须一致**(否则用户看到的编号对不上引用);caption-numbering 行逐条断言具体编号串。",
 matrixRow: "caption-numbering",
 },
 {
 id: "derive-inline-eq-not-numbered",
 group: "derivation",
 semantic: "行内/容器内公式不编号",
 bucket: "carrier-forced",
 docxSide: "equations.ts 遍历 ast.children 顶层",
 pdfSide: "equation.ts depth.isTopLevel() token 深度跟踪",
 rationale: "两侧可用的输入信息不同(AST 顶层 vs token 嵌套深度),不是决策重复。",
 },
 {
 id: "derive-numbering-h1-h3-only",
 group: "derivation",
 semantic: "只给 h1-h3 挂编号",
 bucket: "matrix-locked",
 docxSide: "prescan.ts depth > 3 跳过",
 pdfSide: "heading-id.ts / xref.ts 收 h1-h3",
 rationale: "载体不同但阈值语义一致;toc-levels 行以 h4-h6 有书签、不进目录的形态实跑锁住。",
 matrixRow: "toc-levels",
 },
 {
 id: "derive-content-width-px",
 group: "derivation",
 semantic: "内容区宽 → 图片百分比换算基准",
 bucket: "drift",
 docxSide: "render.ts mmToTwips → twipsToPx(÷15)",
 pdfSide: "render.ts mmToPx(÷25.4 × 96)",
 rationale: "同输入 → 不同输出,但量级 0.03px;两条链路共用同一 mm 源与同一几何 validator,只在末端单位换算分叉。large/01 已把它列为「已评估不做」(触发条件:用户报告图片/表格宽度与预期不符)。",
 disposition: "已评估不做(0.03px 量级);触发条件见 large/01 的否决表",
 },
 {
 id: "derive-line-spacing",
 group: "derivation",
 semantic: "lineSpacing → 行高",
 bucket: "matrix-locked",
 docxSide: "inline-html.ts × 240(AUTO 规则下 240 = 1 倍)",
 pdfSide: "template-css.ts line-height: 1.5(CSS 倍数)",
 rationale: "×240 是 OOXML 的单位约定不是决策;body-typography 行用 lineSpacing=2.0 断言两侧。",
 matrixRow: "body-typography",
 },
 {
 id: "derive-first-line-indent",
 group: "derivation",
 semantic: "首行缩进 2 字符",
 bucket: "matrix-locked",
 docxSide: "inline-html.ts firstLineChars: 200(百分之一字符)",
 pdfSide: "template-css.ts text-indent: 2em",
 rationale: "单位不同(200/100 字符 vs 2em);body-typography 行两侧开关各断言一次。",
 matrixRow: "body-typography",
 },
 {
 id: "derive-align",
 group: "derivation",
 semantic: "正文对齐(justify / left)",
 bucket: "matrix-locked",
 docxSide: "inline-html.ts JUSTIFIED / LEFT",
 pdfSide: "template-css.ts align === \"justify\" 条件规则",
 rationale: "枚举映射共用同一 typography.align;body-typography 行两侧各断言一次。",
 matrixRow: "body-typography",
 },
 {
 id: "derive-code-highlight-palette",
 group: "derivation",
 semantic: "代码高亮色板",
 bucket: "carrier-forced",
 docxSide: "hljs-palette.ts",
 pdfSide: "hljs-palette.ts + template-css.ts 消费",
 rationale: "调色板已共用,余下差异是 CSS 类名 vs run 属性(载体所迫)。",
 },
 {
 id: "derive-code-font-size",
 group: "derivation",
 semantic: "代码字号",
 bucket: "matrix-locked",
 docxSide: "typography.ts codeBlockFontSizePt / inlineCodeFontSizePt(随正文变化,经 code-block.ts / content.ts 消费)",
 pdfSide: "typography.ts 同两个函数(经 template-css.ts 的 pre.hljs code / code 规则消费)",
 rationale: "已按产品裁决收单源:原实测不共用且不等值(docx 单个固定 10pt / pdf 行内 0.9em、代码块 9.5pt)。用户裁决保留 pdf 侧两字号观感(行内 0.9、代码块 0.79 = 9.5/12),两侧改同读这两个推导函数。副产物:docx 行内代码 10pt→10.8pt、代码块 10pt→9.5pt,属预期的用户可见变化。",
 matrixRow: "derived-font-sizes",
 disposition: "已修 —— 原「修法有取舍(统一到 10pt 固定 vs 统一到相对值),需产品裁决」;现用户已裁决:统一到从正文字号推导、不取硬编码值,且行内与代码块刻意保持两个字号(不抹平 pdf 侧有意观感)",
 },
 {
 id: "derive-cancel-checkpoint-density",
 group: "derivation",
 semantic: "取消检查点密度",
 bucket: "matrix-locked",
 docxSide: "render.ts 块级循环内逐块复查",
 pdfSide: "render.ts 四个阶段边界复查(常数)",
 rationale: "有意差异(逐块 vs 阶段边界),已登记为 allowedDiff 并由 cancel-checkpoint-density 行用注入计数守卫实跑度量。",
 matrixRow: "cancel-checkpoint-density",
 },

 /* ---------- 7c 排序/编号规则(10 项) ---------- */
 {
 id: "order-chapter-increment",
 group: "ordering",
 semantic: "章节号递增 / 清零",
 bucket: "matrix-locked",
 docxSide: "heading-numbering.ts 单源",
 pdfSide: "同函数",
 rationale: "共享纯函数;输出由 toc-levels / caption-numbering 行锁。",
 matrixRow: "toc-levels",
 },
 {
 id: "order-chapter-text-format",
 group: "ordering",
 semantic: "章节号文本格式化",
 bucket: "matrix-locked",
 docxSide: "heading-numbering.ts",
 pdfSide: "同函数",
 rationale: "同 derive-chapter-text;重复登记是因为它在原枚举里属排序组。",
 matrixRow: "toc-levels",
 },
 {
 id: "order-chapter-display",
 group: "ordering",
 semantic: "章节号的显示态",
 bucket: "matrix-locked",
 docxSide: "numbering.ts OOXML 域 text",
 pdfSide: "template-css.ts counter + 有/无 h1 两分支",
 rationale: "显示态是载体层(域 vs 伪元素);可见文本由 crossref / toc-levels 行锁。",
 matrixRow: "toc-levels",
 },
 {
 id: "order-caption-seq",
 group: "ordering",
 semantic: "题注序数分配(fig/tab 独立、h1 重置)",
 bucket: "matrix-locked",
 docxSide: "captions.ts 预扫",
 pdfSide: "xref.ts 登记 + template-css.ts counter",
 rationale: "同 derive-caption-reset-at-h1;三套机制,输出一致性由 caption-numbering 行锁。",
 matrixRow: "caption-numbering",
 },
 {
 id: "order-caption-number-format",
 group: "ordering",
 semantic: "题注编号文本格式化",
 bucket: "matrix-locked",
 docxSide: "captions.ts captionNumberText",
 pdfSide: "xref.ts + template-css.ts",
 rationale: "同 derive-caption-number-text。",
 matrixRow: "caption-numbering",
 },
 {
 id: "order-equation-seq",
 group: "ordering",
 semantic: "公式编号(全文连续)",
 bucket: "matrix-locked",
 docxSide: "equations.ts index++(AST 预扫)",
 pdfSide: "equation.ts eqIndex++(token 遍历)",
 rationale: "两套遍历是载体所迫(AST 预扫能算跳过集合,token 流只能边走边记),**规则本身一致**;equation-label-switch 行断言编号连续 + label 锚点。",
 matrixRow: "equation-label-switch",
 },
 {
 id: "order-label-namespace",
 group: "ordering",
 semantic: "label 登记命名空间(kind 分域)",
 bucket: "matrix-locked",
 docxSide: "ctx.xref.captionLabels(键 = captionLabelKey)",
 pdfSide: "xref.ts captionLabels(同一函数)",
 rationale: "键构造已共用 captionLabelKey;xref-label-namespace 行以同名 label 跨 kind 引用实跑锁住。",
 matrixRow: "xref-label-namespace",
 },
 {
 id: "order-label-strip",
 group: "ordering",
 semantic: "label 剥离({#kind:label} 不渲染)",
 bucket: "matrix-locked",
 docxSide: "cross-ref.ts kindLabelRegex + stripSecLabelSuffix",
 pdfSide: "rules/shared.ts stripTrailingLabel + 同正则族",
 rationale: "sec 已共用同一正则实例;fig/tab/eq 两侧走各自入口但共用 EQ_LABEL_RE / kindLabelRegex。输出等价由 caption-label-strip 行锁(含开关关闭时的原样保留)。",
 matrixRow: "caption-label-strip",
 },
 {
 id: "order-toc-levels",
 group: "ordering",
 semantic: "目录条目层级上限 h1-h3",
 bucket: "matrix-locked",
 docxSide: "prescan.ts depth <= 3",
 pdfSide: "heading-id.ts PDF_TOC_MAX_LEVEL = 3(单源常量,含 postprocess 消费)",
 rationale: "原审计标「未确认是否共用同一常量」;实测**pdf 侧已单源**(PDF_TOC_MAX_LEVEL 被三处消费),docx 侧是字面量 3。阈值一致,toc-levels 行以 h4-h6 的形态实跑锁住。",
 matrixRow: "toc-levels",
 },
 {
 id: "order-toc-entry-text",
 group: "ordering",
 semantic: "目录条目标题文本取源",
 bucket: "carrier-forced",
 docxSide: "prescan.ts 从 AST 取 collectPlainText",
 pdfSide: "渲染期结构化产出(rules/heading-id.ts);旧路径从 HTML 反解析",
 rationale: "pdf 侧靠 ::before counter 显示编号、不进文本节点,故目录条目文本只能取自标题本身;docx 侧同理从 AST 取。机制不同,输出一致由 toc-levels 行锁。",
 matrixRow: "toc-levels",
 },
];


/** 四档分布统计(供人工核对,不是断言阈值) */
export function ledgerBucketCounts() {
 /** @type {Record<string, number>} */
 const counts = { "carrier-forced": 0, drift: 0, "setting-void": 0, "matrix-locked": 0 };
 for (const e of DECISION_LEDGER) counts[e.bucket] = (counts[e.bucket] ?? 0) + 1;
 return counts;
}


export const meta = {
 description: "双管线决策项台账:45 项逐条归四档 + 8 个双管线键的覆盖登记与结构守护",
};
// 本段无验收样例:断言对象是台账数据与其结构,不涉及任何 markdown 产物
export const fixtures = null;

/** 验收段入口:形状守护 + 分布打印(键覆盖守护由矩阵段调 assertKeyCoverageRegistered 触发)。 */
export async function run() {
 const suite = createCaseSuite();
  // 段内的判定只有一条 —— 把 45 项台账交给登记册的形状判据(它一次性核:四档取值合法 /
  // 条目 id 唯一 / 归因非空 / setting-void 项必写处置 / 矩阵行对照表与行集合逐字相符 /
  // 每个非 null 对照指向真实条目)。
  //
  // 为什么是**一个** case 而不是按上面那几条拆开:它们不是几件独立的事,而是同一个判据
  // 函数体里的几道分支。拆开只能把判据逻辑复制到段内重写一遍,而复制判定 = 把判定冻结
  // 在调用点(同目录 dual-pipeline-key-coverage 段对 assertKeyCoverageRegistered 取的是
  // 同款取舍:只消费、不复制)。委派本身就是一个被测行为 —— 「台账形状是否合规」正是
  // 本段存在的理由。
  //
  // 下面三条 console.log 是人读回显、不是断言,留在 case 外(判红与否都照打)。
  await suite.case("台账形状合规:四档取值合法 / 条目 id 唯一 / 归因非空 / setting-void 项必写处置 / 矩阵行对照表与行集合逐字相符", () => {
    assertLedgerShape(DECISION_LEDGER);
  });
 const counts = ledgerBucketCounts();
 console.log(
 `[ok] dual-pipeline-ledger:${DECISION_LEDGER.length} 项登记齐全`
 + `(载体所迫 ${counts["carrier-forced"]} / 实质漂移 ${counts.drift}`
 + ` / 设置项失效 ${counts["setting-void"]} / 已被矩阵锁住 ${counts["matrix-locked"]})`,
 );
 console.log(`[ok] dual-pipeline-ledger:矩阵 ${MATRIX_ROW_IDS.length} 行全部完成登记归类`);
 console.log(
 `[ok] dual-pipeline-ledger:${DUAL_PIPELINE_KEYS.length} 个双管线键已登记`
 + "(逐键覆盖数由矩阵段的 assertKeyCoverageRegistered 核对)",
 );
 return { cases: suite.results };
}
