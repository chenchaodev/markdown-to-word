// 门禁判定协议(单源):一道门禁的**判定本体**是一份可注入的纯函数 `check(ctx) -> Problem[]`,
// 三种驱动器消费**同一份**判定 —— 此前同一道门禁有两套自检载体与两套写法(进程级 CLI 与
// 「直接 import 门禁模块的函数」的验收段),判定口径各写一份,漂移无人发现。
//
// 三个驱动器与本文件的对应关系(驱动器只做 IO 与呈现,判定一律回本文件):
//   ① 进程级 CLI      —— `runGateCli()`:打印 + 按 `problems.length` 出 0/1(与
//                         gate-probes/coverage-gate.mjs 的 `main()` 同一形状);
//   ② 沙盒探针        —— `judgeGate()`:同一份判定跑在注入过故障的夹具 ctx 上,「变红」
//                         就是 `problems.length > 0`,不靠子进程退出码;
//   ③ 验收测试段      —— 直接 `import { judgeGate }` 并断言 problems,与 ①② 同一份判定。
//
// ctx 是**注入面**:判定本体不读全局环境(仓库根、文件读取、已装配的判定函数都经 ctx 进),
// 于是同一份判定能在真实工作树、临时夹具、探针沙盒三种根上求值 —— 这也是「必须在 build
// 之前、dist 不存在时运行」这类**驱动器**约束与「被破坏时会红」这类**机制**约束得以分开
// 的前提:约束在链序上,探针在夹具上,两者不再互相误伤。
//
// 形状与 `coverage-gate.mjs` 的 `auditZeroFiles(root)` 同一范式(判定可注入、main 只打印),
// 那份是已落地的样板,本文件把它 generalize 到全部门禁。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT as DEFAULT_ROOT } from "../../../shared/paths.js";

/* ---------- 形状(契约类型,单一来源) ---------- */

/**
 * @typedef {object} Problem 一条判定结论
 * @property {string} code 机器可读代号(稳定,驱动器据此聚合与断言;不用序号 —— 序号会随插删漂移)
 * @property {string} message 人类可读描述(判红文案本体,CLI 与探针共用,故只此一份)
 */

/**
 * @typedef {object} GateCtx 判定上下文的**注入面**(判定本体只经它接触外部世界)
 * @property {string} [root] 求值根(默认 shared/paths.js 的项目根)
 * @property {(relative: string) => string} [readText] 读仓库相对文本
 * @property {(relative: string) => boolean} [exists] 仓库相对路径是否存在
 * @property {GateEntry} [entry] 自身登记项(判定体内需要回读标题/命令时用)
 * @property {Record<string, unknown>} [deps] 判定门禁自有的额外注入(执行器、端口、时钟…)
 */

/**
 * @typedef {(ctx: GateCtx) => Problem[] | Promise<Problem[]>} GateCheck 判定本体
 */

/**
 * @typedef {object} GateProbe 探针声明(**必填**:缺它即由门禁注册表判红)
 * @property {"sandbox" | "selftest" | "segment" | "external"} kind 载体类别
 * @property {string} ref 载体标识(沙盒探针 = GATE_IDS 里的门禁 id;selftest / segment = 仓库相对路径)
 * @property {string} why 为什么这道探针能证明「被破坏时会红」(必填:无理由的探针登记等于没登记)
 */

/**
 * @typedef {object} GateEntry 门禁注册项
 * @property {string} id
 * @property {string} title
 * @property {string[]} npmScripts 驱动这道门禁的 npm script(判定侧在前;generate/check 成对时两个都登记)
 * @property {string} command 展示用命令(报告与摘要里照实登记,判定不读它)
 * @property {string} modulePath 判定本体的实现文件(仓库相对;注册表核对它真实存在)
 * @property {"chain" | "workflow" | "local"} access 接入点:门禁链上 / 仅某条 workflow / 仅本地手动
 * @property {GateProbe[]} probes 探针(必填,≥1):一道门禁常有两道载体(沙盒探针 + 验收段 / 自检),
 *   缺一不可的前提是「至少一道」—— 哪一道都拿不出,才是「没人能证明它被破坏时会红」
 * @property {GateJudgment} judgment 判定本体(必填):三种驱动器消费的就是它,两种写法二选一
 * @property {string} [judgmentNote] 判定本体形态的补充说明(指针怎么切、为什么这么切)
 */

/**
 * @typedef {GateCheck | ModuleJudgment} GateJudgment 判定本体
 */

/**
 * @typedef {object} ModuleJudgment 判定本体的**指针**:判定逻辑住在门禁模块里,注册表只登记它
 * @property {string} module 仓库相对模块路径(注册表核对它真实存在)
 * @property {string} export 该模块导出的判定函数名(注册表核对它确实被导出)
 * @property {string} [shaped] 归一前的返回形状(`{problems}` 包一层 / 裸数组 / 富结构数组),供阅读者对号入座
 * @property {"import" | "static"} [load] 加载方式,默认 `"import"`。**`"static"` 表示该模块顶层
 *   会自己跑 CLI,import 它等于把门禁真跑一遍**(实测:一个在 Electron 里挂死、一个重写文件、
 *   一个改宿主 exitCode)⇒ 改走 auditJudgmentRef 的加严档逐跳追转发链。该字段必须与
 *   topLevelSelfExecutions 的事实一致,注册表逐项对账。
 */

/* ---------- 判定结果的归一 ---------- */

/**
 * 造一条判定结论。
 * @param {string} code 机器可读代号
 * @param {string} message 人类可读描述
 * @returns {Problem} 判定结论
 */
export function problem(code, message) {
  return { code, message };
}

/**
 * 把门禁各形态的判定返回值归一成 `Problem[]`。
 *
 * 为什么需要归一层:本仓门禁的判定返回值历史上就是三种形状 —— `string[]`(多数脚本的
 * `problems.push('…')`)、富结构数组(`analyze()` 返回的命中对象数组)、以及 `{ problems }`
 * 包装。让每个驱动器各写一次归一,就是三处会漂移的形状判断;归一单源后,新增驱动器不必
 * 再认一遍这三种形状。
 * @param {unknown} raw 门禁判定原始返回值
 * @param {string} code 归一后统一使用的机器码(原值带 code 时保留其自身 code)
 * @returns {Problem[]} 归一后的判定结论
 */
export function toProblems(raw, code) {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === "string") return problem(code, item);
      if (typeof item === "object" && item !== null) {
        const record = /** @type {Record<string, unknown>} */ (item);
        const message =
          typeof record.message === "string"
            ? record.message
            : typeof record.text === "string"
              ? record.text
              : typeof record.summary === "string"
                ? record.summary
                : safeStringify(item);
        return problem(typeof record.code === "string" ? record.code : code, message);
      }
      return problem(code, safeStringify(item));
    });
  }
  if (typeof raw === "object") {
    const record = /** @type {Record<string, unknown>} */ (raw);
    if (Array.isArray(record.problems)) return toProblems(record.problems, code);
    if (typeof record.message === "string") return [problem(code, record.message)];
  }
  if (typeof raw === "string") return [problem(code, raw)];
  // 裸数值:不少门禁的判定体至今只导出 `main() -> 退出码`(判定与呈现尚未分离)。按「0 = 通过」
  // 收,而不是把 0 也报成问题 —— 否则每一道尚未抽判定本体的门禁都会被永久判红,而「抽判定本体」
  // 是渐进迁移,不该成为门禁表里的一道红。
  if (typeof raw === "number") {
    return raw === 0 ? [] : [problem(code, `判定返回退出码 ${String(raw)}(判定体尚未抽成 Problem[],诊断正文在门禁自身的 stdout)`)];
  }
  return [problem(code, `判定返回值形状不受支持:${safeStringify(raw)}`)];
}

/**
 * 兜底序列化(判定返回值里有循环引用时 JSON.stringify 会抛,那会让「归一失败」变成
 * 「门禁自己崩了」——崩掉的方向虽安全,但报不出是哪道门禁,故此处自己兜住)。
 * @param {unknown} value 待序列化值
 * @returns {string} 序列化结果(失败时给出类型名)
 */
function safeStringify(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/* ---------- 默认注入面 ---------- */

/**
 * 默认 ctx 工厂:补齐 `root` 与两个 IO 原语,判定本体拿到的永远是完整注入面
 * (而不是「有时有 root、有时没有」——那会让判定体各自写一遍兜底)。
 * @param {GateCtx} [base] 调用方给的注入面(会被本函数补齐缺项)
 * @returns {GateCtx} 完整注入面
 */
export function makeCtx(base = {}) {
  const root = base.root ?? DEFAULT_ROOT;
  return {
    ...base,
    root,
    readText: base.readText ?? ((relative) => readFileSync(path.join(root, ...relative.split("/")), "utf8")),
    exists: base.exists ?? ((relative) => existsSync(path.join(root, ...relative.split("/")))),
  };
}

/* ---------- 三种驱动器共用的判定调用 ---------- */

/**
 * 模块文本里**顶层**(行首无缩进)的自执行痕迹。
 *
 * 为什么需要它:一道门禁的判定本体指针必须是**可安全 import** 的 —— 而本仓有三道门禁的
 * 模块在**顶层就跑自己的 CLI**(`process.exitCode = main(...)`)。import 它们不是「读一下导出」,
 * 是「把门禁真跑一遍」,后果有三种,都不可接受:
 *   - `gates/repo/check-docs.mjs` 用 `execFileSync(process.execPath, …)` 调全局门禁。在 Electron
 *     里 `process.execPath` 是 **electron.exe** ⇒ 起一个永不退出的 GUI 进程 ⇒ 验收段硬超时
 *     (2026-10-01 实测:同一批判据纯 Node 下 1.2s 跑完,Electron 下挂在这一格);
 *   - `gates/repo/gen-archive-index.mjs` 默认是**生成**模式 ⇒ 导入就把 docs/evidence/INDEX.md 重写;
 *   - 任何一道都会顺手改掉宿主进程的 `process.exitCode`。
 * 于是协议要求指针**声明**自己的加载方式(`load`),并由本函数把声明与事实对账。
 *
 * 判据只认行首无缩进的语句(顶层作用域),故模块内部的函数体不受影响。
 * @param {string} text 模块文本
 * @returns {string[]} 命中的顶层自执行痕迹(去重;空数组 = 可安全 import)
 */
export function topLevelSelfExecutions(text) {
  /** @type {Set<string>} */
  const hits = new Set();
  for (const line of text.split("\n")) {
    if (/^process\.exitCode\s*=/.test(line)) hits.add("顶层 process.exitCode =");
    if (/^process\.exit\(/.test(line)) hits.add("顶层 process.exit(");
    if (/^(?:await\s+)?main[A-Za-z0-9_]*\(/.test(line)) hits.add("顶层 main() 调用");
  }
  return [...hits];
}

/**
 * 相对说明符 → 仓库相对模块路径(转发链用)。省略扩展名时补 `.mjs`。
 * @param {string} fromModule 起点模块(仓库相对)
 * @param {string} specifier 相对说明符
 * @returns {string} 仓库相对模块路径
 */
function resolveRelativeModule(fromModule, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromModule), specifier));
  return base.endsWith(".mjs") || base.endsWith(".js") ? base : `${base}.mjs`;
}

/**
 * 判定本体的静态核对:门禁模块真实存在、且确实导出了登记的那个名字。
 *
 * 刻意**不 import** 就核对(改为读文本找导出声明):import 有副作用(见 topLevelSelfExecutions),
 * 而「登记的名字还在不在」是纯文本问题,静态核对更便宜也更确定。真正的 import 发生在驱动器
 * 那一侧(`resolveJudgment`),且只对声明 `load: "import"` 的指针做。
 *
 * `strict: true` 时**逐跳追 `export { X } from "./y"` 转发链**,要求终点模块自己声明 X。
 * 这是给不 import 的那批指针用的加严档:普通档只证明「本模块文本里出现过这个名字」,
 * 加严档连「转发目标真的存在且真的声明了它」一起证明 —— 否则一个 `export { X } from "./已删.js"`
 * 的悬空转发会被当成有效判定。
 *
 * @param {GateCtx} ctx 注入面(经 makeCtx 补齐后的)
 * @param {ModuleJudgment} ref 判定本体指针
 * @param {{ strict?: boolean, _depth?: number, _seen?: Set<string> }} [options] 选项
 * @returns {string | null} 判定结论描述(null = 通过)
 */
export function auditJudgmentRef(ctx, ref, options = {}) {
  const name = ref.export;
  const depth = options._depth ?? 0;
  const seen = options._seen ?? new Set();
  if (depth > 8 || seen.has(ref.module)) {
    return `判定本体的导出转发链在 ${ref.module} 处成环或过深(导出形状可能已失控)`;
  }
  seen.add(ref.module);

  let text;
  try {
    text = ctx.readText(ref.module);
  } catch (error) {
    return `判定本体模块不存在或不可读:${ref.module}(${error instanceof Error ? error.message : String(error)})`;
  }

  // 本地声明:function / const / class —— 证据最强的形态,任何档都直接判过
  const local = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`),
    new RegExp(`export\\s+(?:const|let|var|class)\\s+${name}\\b`),
  ];
  if (local.some((pattern) => pattern.test(text))) return null;

  if (!options.strict) {
    const bare = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`, "s");
    if (!bare.test(text)) return `判定本体模块 ${ref.module} 未导出 ${name}(导出被改名/删除,判定本体已失效)`;
    return null;
  }

  // 加严档:必须把转发链追到底
  /** @type {string[]} */
  const forwardSpecifiers = [];
  for (const m of text.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = /** @type {string} */ (m[1]);
    if (new RegExp(`(?:^|[,\\s])${name}(?:\\s*as\\s+${name})?(?:\\s*[,]|$)`).test(names)) {
      forwardSpecifiers.push(/** @type {string} */ (m[2]));
    }
  }
  for (const specifier of forwardSpecifiers) {
    if (!specifier.startsWith(".")) {
      return `判定本体 ${ref.module} 的 ${name} 转发到裸包名「${specifier}」——门禁判定体不允许来自第三方包`;
    }
    const resolved = resolveRelativeModule(ref.module, specifier);
    const nested = auditJudgmentRef(ctx, { module: resolved, export: name }, { strict: true, _depth: depth + 1, _seen: seen });
    if (nested === null) return null;
  }
  // 无 from 的 `export { X }`:X 是本地绑定(可能来自 import),追它的 import 源
  /** @type {string[]} */
  const localReexportSpecifiers = [];
  for (const m of text.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    const names = /** @type {string} */ (m[1]);
    if (!new RegExp(`(?:^|[,\\s])${name}(?:\\s*as\\s+${name})?(?:\\s*[,]|$)`).test(names)) continue;
    for (const im of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const imported = /** @type {string} */ (im[1]);
      if (new RegExp(`(?:^|[,\\s])${name}(?:\\s*as\\s+${name})?(?:\\s*[,]|$)`).test(imported)) {
        localReexportSpecifiers.push(/** @type {string} */ (im[2]));
      }
    }
  }
  for (const specifier of localReexportSpecifiers) {
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveRelativeModule(ref.module, specifier);
    const nested = auditJudgmentRef(ctx, { module: resolved, export: name }, { strict: true, _depth: depth + 1, _seen: seen });
    if (nested === null) return null;
  }
  return `判定本体模块 ${ref.module} 的 ${name} 既非本地声明、转发目标也追不到终点(导出被改名/删除,或转发已悬空)`;
}

/**
 * 取判定本体函数:内联写法直接给,指针写法经动态 import 解析。
 *
 * 三种驱动器都只经这一个入口拿判定 —— 「同一份判定」在实现层就是「同一个函数对象」,
 * 而不是三处各 import 一次然后各自解释返回值。
 * @param {GateCtx} ctx 注入面(经 makeCtx 补齐后的)
 * @param {GateEntry} entry 门禁登记项
 * @returns {Promise<GateCheck>} 判定本体
 */
export async function resolveJudgment(ctx, entry) {
  const judgment = entry.judgment;
  if (typeof judgment === "function") return judgment;
  if (judgment.load === "static") {
    // 静默 import 会把门禁真跑一遍(见 topLevelSelfExecutions),故显式拒绝而不是让它挂死。
    throw new Error(
      `判定本体 ${judgment.module} 声明 load:"static"(该模块顶层会自执行,import 等于跑真门禁);` +
        "请改用 auditJudgmentRef(ctx, ref, { strict: true }) 的加严静态链核对",
    );
  }
  const module = await import(pathToFileURL(path.join(ctx.root, ...judgment.module.split("/"))).href);
  const found = module[judgment.export];
  if (typeof found !== "function") {
    throw new Error(`判定本体 ${judgment.module} 的 ${judgment.export} 不是函数(导出形状变了?)`);
  }
  return /** @type {GateCheck} */ (found);
}

/**
 * 驱动器 ②/③ 共用的那一步:**调用判定本体并归一结论**。
 *
 * 判据纪律:判定本体**抛错**也算判红(退出码 0 的失败形态是最坏的一种),但归因要能
 * 指到是「判定体自身抛错」而不是「门禁抓到了什么」——故单列一个 code。
 * @param {GateEntry} entry 门禁登记项
 * @param {GateCtx} ctx 注入面
 * @returns {Promise<Problem[]>} 归一后的判定结论(空数组 = 绿)
 */
export async function judgeGate(entry, ctx) {
  if (entry.judgment === undefined) {
    return [problem("judgment-missing", `${entry.id}:登记项缺判定本体(三种驱动器消费的是它,无头即判红)`)];
  }
  const full = makeCtx({ ...ctx, entry });
  try {
    const judgment = await resolveJudgment(full, entry);
    return toProblems(await judgment(full), entry.id);
  } catch (error) {
    return [problem("judgment-threw", `${entry.id}:判定本体抛错(${error instanceof Error ? error.message : String(error)})`)]
      .concat(toProblems((error instanceof Error ? error.stack : undefined)?.split("\n").slice(0, 4), `${entry.id}:stack`));
  }
}

/**
 * 驱动器 ①(进程级 CLI):打印 + 按 `problems.length` 出 0/1。
 *
 * 与 `coverage-gate.mjs` 的 `main()` 同一形状(判定在 check 里,本函数只呈现),这样
 * 「加一道门禁」不再需要发明第三种 CLI 写法。
 * @param {GateEntry} entry 门禁登记项
 * @param {GateCtx} ctx 注入面
 * @param {(line: string) => void} [log] 正常输出
 * @param {(line: string) => void} [error] 诊断输出
 * @returns {Promise<number>} 退出码(0 = 绿)
 */
export async function runGateCli(entry, ctx, log = console.log, error = console.error) {
  const problems = await judgeGate(entry, ctx);
  for (const item of problems) error(`[${entry.id}:fail] ${item.message}`);
  if (problems.length > 0) {
    error(`[${entry.id}:fail] 判定未通过,共 ${problems.length} 项`);
    return 1;
  }
  log(`[ok] ${entry.id}:${entry.title} 判定通过`);
  return 0;
}