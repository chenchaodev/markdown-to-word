// PLAN「状态 ↔ 真实在跑」对读门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- 它堵的是哪一类失效 ----
// 载体上写着「下一步要做 X」/「X 正在做」,但**实际没有任何会话在做 X**,而没有任何判据会报红。
// 本仓这一类失效已反复发生,形状与另两族同源:
//   - **悬空 selftest**:`check:src-layout:selftest` / `check:test-layout:selftest` 一度连 npm script
//     都没有 ⇒ 坏了四个提交没人发现;
//   - **判据恒绿**:某判据的扫描面指向不存在的目录 ⇒ walker 扫到 0 个文件 ⇒ 恒绿且不报错;
//   - **看得见的状态与真实状态之间没有对读**:主会话在汇报里写「现在派 T3-6」而并没有真的派发,
//     `PLAN.md` 里 T3-6 的标记是 🔄 —— 事后回看状态与真实在跑的东西不一致,却无人报红。
// 共同形状:**看得见的状态与真实状态之间没有对读**。
//
// ---- 为什么必须有「声明」而不是让门禁去猜 ----
// 门禁**无法**知道有没有会话在跑:进程里没有这个事实,文件里也没有。故「现在在跑什么」必须是
// 一处**显式声明**(本门禁只认 `当前在跑:` 那一行),门禁做的是「声明 vs 标记」的**双向**对读,
// 不做任何猜测。声明腐化(声明还写着但标记已改)与声明悬空(标记还在但没人声明)各判一个方向,
// 两边都不放过:
//
//   标记 🔄 但声明里没有它          ⇒ undeclared-in-progress / declaration-missing
//                                    ← **这正是「说要派而没派」那一族**
//   声明里有它但标记不是 🔄           ⇒ declared-not-in-progress(防漏改标记)
//   声明里有它但该子步已不存在       ⇒ declared-unknown-step(防声明指向已删子步)
//
// 零进行中子步时**恒绿**(全部完成不得判红)—— 这是最容易被写坏的一格,故 selftest 有专门夹具。
//
// ---- 扫描面:PLAN.md 的 markdown 表格行 ----
// 判据只看**表格行**,且行的首格须是一个「子步 id」形态(见 parsePlanSteps)。散文段落不参与,
// 所以「正文里提到 🔄」不会把任何东西判成进行中。
//
// **子步 id 的取法**(`parsePlanSteps` 内,唯一实现):首格剥掉 markdown 装饰与状态标记后,
// 若已形如 `T<数字>…`(阶段表那一列),直接用作 id;否则用**最近一个小节标题的 `T<数字>…` 前缀**
// 补全为 `<小节>-<首格>`。为什么必须补全:T3 的子步表与 T2 的五步表都用裸序号(`1`/`2`/`3`…),
// T3-4d 的批次表又是第三份裸序号 ⇒ 裸 `3` 在同一文件里出现三次,不补前缀则声明与标记无法对读。
// 实测 id 全集:`T0.0` `T0` `T2` `T3` `T4` `T5` · `T2-1`…`T2-5` · `T3-1`…`T3-6` · `T3-4d-1`…`T3-4d-3`。
// 标题不含 `T<数字>` 时前缀为空(此时只可能是阶段表那种自限定首格,否则 id 会被 `duplicate-step-id` 抓住)。
//
// **「进行中」的取法**:该行**任意一格**含 `🔄` 即为进行中。为什么不限定「状态列」——
// PLAN.md 实测两种形态并存:T2 五步表**根本没有状态列**(标记在首格 `| 5 🔄 |`),而 T3 子步表
// 与 T3-4d 批次表的标记在末格(`| 6 | … | 🔄 待做 |`)。两种形态都得认,才不必猜哪一列是状态列。
// 误报方向:某个子步行的备注格里写了 🔄 ⇒ 该行被判进行中 ⇒ 门禁要求它进声明 ⇒ **响亮地错**,
// 不是静默地漏。代价可接受(不要在子步行里用 🔄 做行内强调即可)。
//
// **已知边界**:本门禁不看散文。「下一步」节里写「现在派 T3-6」而 `🔄` 标记在别处时,它判不出来
// —— 那正是 `PLAN.md`「措辞纪律」节(宣布下一步必须同句给出子会话 task id)要管的部分。
// 门禁能对读状态,判不了「一句话是不是宣称了已派」。
//
// ---- 切格规则:GFM 是「先按未转义 `|` 切格、再解析行内」 ----
// 所以代码跨度里的 `|` **同样切格**(GFM 要求写成 `\|`),本门禁按这条切,并把 `\|` 还原成字面 `|`。
// 本仓 `docs/PLAN.md` 实测无 `\|`,故还原分支当前不会被走到,但它不是可选的:有人为了在单元格里
// 写 `a|b` 而打上 `\|` 的那一天,不带还原的实现会把那行切成两半并静默改掉首格。
//
// ---- 形状:判定本体 = `checkPlanInProgress(base)`(可注入、零 IO 副作用) ----
// 与 check-src-layout.mjs / check-test-layout.mjs 同一范式(全仓门禁判定协议,见
// gates/probe/gate-probes/protocol.mjs):IO 全部经 ctx 注入(读文本 / 扫描面下限),`main()` 只打印
// 并按判红项出 0/1。扫描面下限是**形参**:自检脚本要在合成文本上验「扫不到子步行 ⇒ 判红」,
// 靠改模块常量做不到,而能传「关掉下限」的口子本身不是漏洞(下限的语义是「塌缩这一档」,不是白名单)。
//
// ---- 入口守卫:必需,不是整洁问题 ----
// 本模块被门禁注册表 import 当判定本体指针。顶层自执行会改写宿主进程的 exitCode,而注册表 R4b
// 会逐项对账「judgment.load 声明」与「顶层是否自执行」的事实。守卫写法与 check-src-layout.mjs 同形。
import { readFileSync } from "node:fs";
import path from "node:path";
import { isMainModule, parseArgs } from "../../shared/cli.mjs";
import { ROOT } from "../../shared/paths.js";

/** 被判定的载体(仓库相对 POSIX 路径) */
export const PLAN_REL = "docs/PLAN.md";
/** 「进行中」标记:PLAN.md 实测四种状态标记里只有它表示「有人在做」 */
export const IN_PROGRESS_MARKER = "🔄";
/** 声明行的标签(行首即匹配这一串,故正文里**提到**它不会命中,只有整行写它才会) */
export const DECLARATION_LABEL = "当前在跑";
/**
 * PLAN.md 实测存在的状态标记全表(2026-10-04 于 docs/PLAN.md 逐行核对:`✅` 17 处 / `🔄` 3 处 /
 * `⏸` 5 处 / `⛔` 1 处 / `⚠` 16 处)。前四种是**状态**,`⚠` 是行内提醒 —— 两者都必须从首格里剥掉,
 * 否则 `5 🔄` 剥不出 `5`;但只有 `🔄` 参与「进行中」判定(见文件头「进行中的取法」)。
 * 变体选择符(U+FE0F / U+FE0E)与零宽连接符先剥掉,故 `⚠️` 与 `⚠` 归一。
 */
export const STATUS_MARKERS = Object.freeze(["✅", "🔄", "⏸", "⛔", "⚠"]);
/**
 * 扫描面下界:子步行数低于此值即判红。防「表格形态一改就扫到 0 行 ⇒ 恒绿」——
 * 与 check-src-layout 的 `scan-surface-collapsed` 同一族失效,方向同样是最坏的「没人会去看一个总是
 * exit 0 的脚本」。实测 PLAN.md 有二十余行,取 3 只拦塌缩、不随日常增删子步抖动。
 */
export const MIN_STEP_ROWS = 3;
/** 声明行的「什么也没在跑」写法(零进行中时的显式声明;大小写与全半角都归一) */
const NONE_TOKENS = Object.freeze(new Set([
  "无", "無", "空", "空集", "-", "—", "－", "none", "n/a", "na", "nil", "(空)", "（空）", "(无)", "（无）",
]));
/** 变体选择符(U+FE0E/U+FE0F)与零宽连接符(U+200D):emoji 序列里它们不是标记本体,归一时先剥掉 */
const VARIATION_SELECTORS = new RegExp("[\\uFE0E\\uFE0F\\u200D]", "g");
const DECLARATION_LINE_RE = new RegExp(`^\\s*(?:>\\s*)?${DECLARATION_LABEL}\\s*[:：]\\s*(.*)$`);
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*)$/;
/** 小节前缀:`T` + 数字,后接任意段 `-<字母数字>`(T3-4d 这形态实测存在) */
const SECTION_TOKEN_RE = /^T\d+(?:-[A-Za-z0-9]+)*/;
/** 子步 id 形态:首字母数字,余为字母数字 / `.` / `_` / `-`;长度上限防「整句话被当成 id」 */
const STEP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/;
/** 首格已自限定(`T0.0` 这形态)则不再补小节前缀 */
const SELF_QUALIFIED_RE = /^T\d/;
/** 表格分隔行(`|---|---|`)的首格 */
const SEPARATOR_CELL_RE = /^:?-{1,}:?$/;
/** 声明值分隔符:`·`(U+00B7)为主,兼容全角间隔号 / 逗号 / 顿号 / 空白 */
const DECLARATION_SPLIT_RE = /[\s·・,、，]+/;
const USAGE = "用法: node gates/repo/check-plan-in-progress.mjs [--help]";

/**
 * @typedef {object} PlanStep 一行子步(判定面的输入单元)
 * @property {string} id 补全后的子步 id(声明里就用它)
 * @property {string} label 首格剥掉装饰与状态标记后的原文
 * @property {string} section 所属小节前缀(空串 = 无)
 * @property {number} line 行号(1 起;诊断用)
 * @property {boolean} inProgress 该行任一格含 `🔄`
 */

/**
 * @typedef {object} PlanDeclaration 一行声明
 * @property {number} line 行号(1 起)
 * @property {string} raw 标签之后的原文(未切分)
 */

/**
 * @typedef {object} PlanStats 计数(结论行用)
 * @property {number} stepRows 认得的子步行数
 * @property {number} inProgress 标记为进行中的子步行数
 * @property {number} declaredLines 声明行数
 * @property {number} declaredIds 声明里点名的子步数
 */

/**
 * @typedef {object} PlanInProgressCtx 注入面
 * @property {string} root 求值根
 * @property {(relative: string) => string} readText 读仓库相对文本
 * @property {number} minStepRows 子步行数下限(0 = 关闭该判据,合成夹具用)
 */

/**
 * 注入面工厂:补齐缺项,判定本体拿到的永远是完整注入面。
 * @param {Partial<PlanInProgressCtx>} [base] 调用方给的注入面
 * @returns {PlanInProgressCtx} 完整注入面
 */
export function makePlanInProgressCtx(base = {}) {
  const root = base.root ?? ROOT;
  return {
    root,
    readText: base.readText ?? ((relative) => readFileSync(path.join(root, ...relative.split("/")), "utf8")),
    minStepRows: base.minStepRows ?? MIN_STEP_ROWS,
  };
}

/**
 * 归一:剥掉变体选择符与零宽连接符(`⚠️` 与 `⚠` 归一,`⏸️` 与 `⏸` 归一)。
 * @param {string} text 原文
 * @returns {string} 归一后的原文
 */
function normalizeGlyphs(text) {
  return text.replace(VARIATION_SELECTORS, "");
}

/**
 * 剥 markdown 装饰(反引号 / 粗体星号)与状态标记,只留首格的 id 本体。
 *
 * 为什么装饰与标记分两步:装饰是**写法**(`` `T0.0` `` / `**T2**`),标记是**状态**(`` 5 🔄 ``),
 * 两者都要从 id 里去掉,但只有状态标记参与「进行中」判定 —— 分开剥才不会把两者混成一个集合。
 * @param {string} cell 首格原文
 * @returns {string} id 本体(剥不干净时返回空串)
 */
export function stepLabelOf(cell) {
  let out = normalizeGlyphs(cell).replace(/[`*]/g, "");
  for (const marker of STATUS_MARKERS) out = out.split(marker).join("");
  return out.replace(/\s+/g, "").trim();
}

/**
 * 按 GFM 规则切表格行:先按未转义的 `|` 切格,`\|` 还原成字面 `|`。
 *
 * 为什么不做「代码跨度内不切」:GFM 的表格是先切格再解析行内,所以代码跨度里的 `|` 同样切格
 * (要写成 `\|` 才留得住)。按行内规则实现会与渲染结果不一致,而本门禁的首格判定依赖切格边界。
 * @param {string} trimmed 已去首尾空白、且以 `|` 开头的行
 * @returns {string[]} 格数组(已 trim)
 */
export function splitTableRow(trimmed) {
  const body = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  /** @type {string[]} */
  const cells = [];
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * 切分字符串是否为表格分隔行(`|---|---|`)。
 * @param {string[]} cells 格数组
 * @returns {boolean}
 */
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL_RE.test(cell.replace(/[`*]/g, "").trim()));
}

/**
 * 抽出 PLAN.md 里的全部子步行。
 *
 * 只看表格行,且首格须剥得出合法 id:`修复项复测` 那种首格是整句话的表自然被排除(剥完仍含空格与
 * 汉字,不合 `STEP_ID_RE`),表头行(`| 子步 | 内容 | … |`)同样被排除(首格是汉字)—— 这正是
 * 「靠形态而不是靠登记表识别子步」的好处:新增一张表不需要改门禁,首格不是 id 的行自动不参与。
 *
 * ⚠ **刻意不做「表格首行是表头」那套推断**:实测 `docs/PLAN.md` 的 T3 子步表中间有两处空行
 * (第 71 / 73 行),按「连续 `|` 行构成一张表」会把空行后的第一行**误当表头吃掉** ——
 * 实测 `4c` 与子步 `5` 两行因此被静默漏掉,而 `5` 正是本门禁最该看见的那一行(它带 🔄)。
 * 那种失效方向是最坏的一档:**漏掉目标行 ⇒ 它不进对读 ⇒ 门禁对它恒绿**。
 * 故表头不靠位置识别,只靠「首格剥不出 id」这一条形态判定。
 * @param {string} text PLAN.md 全文
 * @returns {PlanStep[]} 子步行(文档序)
 */
export function parsePlanSteps(text) {
  const lines = text.split(/\r?\n/);
  /** @type {PlanStep[]} */
  const steps = [];
  /** @type {string} */
  let section = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      const token = SECTION_TOKEN_RE.exec(normalizeGlyphs(heading[1] ?? "").replace(/[`*]/g, "").trim());
      // 标题不含 `T<数字>` 时**清空**前缀而不是沿用上一个:沿用会把下一张无关表格的裸序号错挂到
      // 上一个小节名下,而错挂的后果是「声明与标记对不上」这类看不懂的红。
      section = token === null ? "" : token[0];
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = splitTableRow(trimmed);
    if (isSeparatorRow(cells)) continue;
    const label = stepLabelOf(cells[0] ?? "");
    if (!STEP_ID_RE.test(label)) continue;
    const id = SELF_QUALIFIED_RE.test(label) ? label : (section === "" ? label : `${section}-${label}`);
    steps.push({
      id,
      label,
      section,
      line: index + 1,
      inProgress: cells.some((cell) => normalizeGlyphs(cell).includes(IN_PROGRESS_MARKER)),
    });
  }
  return steps;
}

/**
 * 抽出全部声明行。
 *
 * 正则**行首锚定**(`^\s*(?:>\s*)?当前在跑\s*[:：]`):只有整行写它才算声明,正文里提到这一串
 * (例如解释格式的那句话)不会命中。这不是洁癖 —— 若不锚行首,任何一句提到格式说明的散文都会被
 * 读成声明,「声明数恰 0/1」这条判据立刻失去意义。
 * @param {string} text PLAN.md 全文
 * @returns {PlanDeclaration[]} 声明行(文档序)
 */
export function parseDeclarations(text) {
  /** @type {PlanDeclaration[]} */
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const matched = DECLARATION_LINE_RE.exec(lines[index] ?? "");
    if (matched === null) continue;
    found.push({ line: index + 1, raw: (matched[1] ?? "").trim() });
  }
  return found;
}

/**
 * 把一条声明的值切成子步 id 列表(保序,**不去重**)。
 *
 * 为什么不去重:去重会把「同一子步被点名两次」在解析层吃掉,而那正是 `declared-duplicate` 那一格
 * 判据要抓的 —— **一条永远不可能触发的判据就是恒绿判据**,而恒绿是本门禁最坏的失效形态。
 * 「这个 id 在不在声明里」那一问自己建 Set,不必让解析层替它去重。
 * @param {string} raw 声明标签之后的原文
 * @returns {string[]} id 列表(保序,可含重复)
 */
export function declaredIdsOf(raw) {
  return raw.split(DECLARATION_SPLIT_RE).map((piece) => piece.trim()).filter((piece) => piece !== "");
}

/**
 * 声明值是不是「什么也没在跑」的显式写法(大小写与全半角归一)。
 * @param {string} raw 声明原文
 * @returns {boolean}
 */
function isNoneToken(raw) {
  const flat = raw.trim().replace(/[（）]/g, (ch) => (ch === "（" ? "(" : ")")).toLowerCase();
  return NONE_TOKENS.has(flat);
}

/**
 * 判定本体(可注入纯函数):「标记为进行中的子步」× 「当前在跑的声明」双向对读。
 *
 * **每条判红项的文案一律以 `<代号>:` 开头**(诊断与机器码同源,不另立一张代号表 —— 那正是本仓
 * 反复吃过亏的「同一件事两处登记」)。自检脚本据此断言「门禁自己冒出的失败形态都在已登记集合内」。
 * @param {Partial<PlanInProgressCtx>} [base] 注入面(见 makePlanInProgressCtx)
 * @returns {{ problems: string[], stats: PlanStats }}
 */
export function checkPlanInProgress(base = {}) {
  const ctx = makePlanInProgressCtx(base);
  /** @type {string[]} */
  const problems = [];
  /** @type {PlanStats} */
  const stats = { stepRows: 0, inProgress: 0, declaredLines: 0, declaredIds: 0 };

  /** @type {string} */
  let text;
  try {
    text = ctx.readText(PLAN_REL);
  } catch (error) {
    problems.push(
      `carrier-unreadable:${PLAN_REL} 读不到载体(${error instanceof Error ? error.message : String(error)})`
      + " —— 载体读不到时判红而不是按「零进行中」放过:那正是本门禁要堵的那一格(看得见的红消失)",
    );
    return { problems, stats };
  }

  const steps = parsePlanSteps(text);
  stats.stepRows = steps.length;
  const inProgress = steps.filter((step) => step.inProgress);
  stats.inProgress = inProgress.length;

  // 扫描面下界:表格形态一改(首格不再形如 id / 全部搬进别的载体)就可能扫到 0 行,那时下面每一个
  // 判据都会「全绿」。恒绿是纯文本门禁最坏的失效形态,故这一档独立判红。
  if (steps.length < ctx.minStepRows) {
    problems.push(
      `scan-surface-collapsed:只认出 ${steps.length} 个子步行(下限 ${ctx.minStepRows})`
      + " —— 子步表的形态多半变了(首格剥不出 id?整表搬走了?),而对读判据在零扫描面下会「全绿」。"
      + `实测形态:首格剥掉 markdown 装饰与状态标记后须形如 \`T3\`/\`3b\`/\`4b-i\`(${PLAN_REL} 的 T3 子步表)`,
    );
  }

  /** @type {Map<string, PlanStep>} */
  const byId = new Map();
  for (const step of steps) {
    const seen = byId.get(step.id);
    if (seen === undefined) {
      byId.set(step.id, step);
      continue;
    }
    problems.push(
      `duplicate-step-id:${step.id} 在第 ${seen.line} 行与第 ${step.line} 行各出现一次`
      + " —— 同一个 id 有两行时「声明点名它」无法定位是哪一行,须改其中一行的首格",
    );
  }

  const declarations = parseDeclarations(text);
  stats.declaredLines = declarations.length;
  if (declarations.length > 1) {
    problems.push(
      `declaration-ambiguous:全文有 ${declarations.length} 行声明(第 ${declarations.map((item) => item.line).join(" / ")} 行)`
      + ` —— 「当前在跑」只能有一行,多行时本门禁无从判断哪一行是当前口径`,
    );
  }

  const single = declarations.length === 1 ? /** @type {PlanDeclaration} */ (declarations[0]) : null;
  const declaresNone = single !== null && isNoneToken(single.raw);
  const declaredIds = single !== null && !declaresNone ? declaredIdsOf(single.raw) : [];
  stats.declaredIds = declaredIds.length;

  if (single !== null && single.raw === "") {
    problems.push(
      `declaration-empty:第 ${single.line} 行的声明是空的 —— 空声明既不是「什么也没在跑」也不是一份点名,`
      + `请写 \`${DECLARATION_LABEL}: 无\` 或 \`${DECLARATION_LABEL}: <子步 id> <子步 id>\``,
    );
  }

  const inProgressIds = inProgress.map((step) => step.id).join(" / ");

  if (inProgress.length > 0 && declarations.length === 0) {
    // 本轮反复发生的那一格:标记是 🔄,但没有任何一行声明「现在在跑的是什么」。
    problems.push(
      `declaration-missing:检出 ${inProgress.length} 个标记为进行中(${IN_PROGRESS_MARKER})的子步(${inProgressIds}),`
      + `但全文没有一行「${DECLARATION_LABEL}: …」声明 —— 「看得见的状态」与「真实在跑的东西」之间没有对读。`
      + `要么补一行 \`${DECLARATION_LABEL}: ${inProgressIds.split(" / ")[0]}\`(确有会话在做),`
      + "要么把无人做的那个标记改掉(声明腐化)",
    );
  } else if (inProgress.length > 0 && declaresNone) {
    problems.push(
      `declaration-none-contradicted:声明写着「什么也没在跑」,但检出 ${inProgress.length} 个标记为进行中`
      + `(${IN_PROGRESS_MARKER})的子步(${inProgressIds}) —— 要么声明该点名,要么标记已陈旧`,
    );
  } else if (single !== null && !declaresNone) {
    const declaredSet = new Set(declaredIds);
    for (const step of inProgress) {
      if (declaredSet.has(step.id)) continue;
      problems.push(
        `undeclared-in-progress:${step.id}(第 ${step.line} 行)标记为进行中(${IN_PROGRESS_MARKER})但不在声明里`
        + ` —— 若确有会话在做,把它加进「${DECLARATION_LABEL}:」那一行;若没有,改掉这个标记`,
      );
    }
    const counts = new Map();
    for (const id of declaredIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const id of declaredIds) {
      if ((counts.get(id) ?? 0) > 1) {
        problems.push(`declared-duplicate:${id} 在声明里被点名 ${String(counts.get(id))} 次 —— 声明是集合,重复项通常意味着两处各写了一次`);
      }
      const step = byId.get(id);
      if (step === undefined) {
        problems.push(
          `declared-unknown-step:声明点名了 ${id},但 ${PLAN_REL} 里没有这个子步`
          + " —— 子步被删/改名而声明没跟着改,或 id 写错了(实测 id 形如 T3-6 / T3-4d-3,裸序号会被自动补上小节前缀)",
        );
        continue;
      }
      if (!step.inProgress) {
        problems.push(
          `declared-not-in-progress:${id}(第 ${step.line} 行)在声明里,但该行的标记不是 ${IN_PROGRESS_MARKER}`
          + " —— 声明已经腐化(子步做完了/暂停了),请改声明或改标记",
        );
      }
    }
  }

  return { problems, stats };
}

/**
 * CLI 主体:读盘 → 判定 → 打印 → 出 0/1(判定逻辑全在 checkPlanInProgress 里)。
 * @param {string[]} [argv] 参数数组
 * @returns {number} 退出码
 */
export function main(argv = []) {
  /** @type {Record<string, string | boolean>} */
  let options;
  try {
    options = parseArgs(argv, { booleans: ["help"], usage: USAGE });
  } catch (error) {
    // 未知参数一律失败:静默按默认跑一遍报绿就是「假通过」
    console.error(`[plan-in-progress:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log([
      USAGE,
      `  判据:子步行(表格行,首格剥掉 markdown 装饰与状态标记后形如 T3 / 3b / 4b-i)任一格含 ${IN_PROGRESS_MARKER}`
        + ` ⇒ 标记为进行中;与「${DECLARATION_LABEL}:」那一行声明双向对读。`,
      "  用法:在 docs/PLAN.md 里整行写 `当前在跑: T3-6`(零进行中时写 `当前在跑: 无`)。",
    ].join("\n"));
    return 0;
  }

  const { problems, stats } = checkPlanInProgress();
  const counts = `子步行 ${stats.stepRows} / 进行中 ${stats.inProgress} / 声明行 ${stats.declaredLines}（点名 ${stats.declaredIds}）`;

  if (problems.length === 0) {
    console.log(`[ok] PLAN 状态与「当前在跑」对读通过:${counts}`);
    return 0;
  }
  for (const problem of problems) console.error(`[plan-in-progress:fail] ${problem}`);
  console.error(`[plan-in-progress:fail] PLAN 状态与「当前在跑」对读失败,共 ${problems.length} 项:${counts}`);
  return 1;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。守卫右侧用 `isMainModule`(代码位置自比,
// 不是由仓根反推自身路径 —— 仓根是 cwd 派生的环境值,而本门禁刻意以「cwd 指合成目录、
// argv[1] 指仓内本体」被调用,两者恒不相等)。
if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}