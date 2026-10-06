// HTML 手写镜像 ↔ core 常量 对称门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- 它守住什么 ----
// `src/renderer/index.html` 里页边距输入框的 `max="1000"` 是**手写字面量**,它镜像
// `src/core/settings/settings-defaults.ts` 的 `MARGIN_MAX_MM`。两侧各写一份,
// 注释里声明「两者对称」—— 但注释不是判据:改常量不会改 HTML,改 HTML 不会改常量,
// 两侧悄悄漂移时**没有任何东西会红**,而用户在设置面板里能输入一个 core 会拒绝的值
// (或反之:core 放宽了上限而输入框仍卡在旧值,用户看不到新范围)。
//
// ---- 为什么形态是「读两处 + 比对」而不是别的 ----
// **刻意不做的事**:不建常量注入机制、不在构建期生成 HTML、不引模板系统。
// 那些方案能消灭字面量,但代价是「renderer 的 HTML 从此由构建产物决定」——
// 一个静态界面文件变成需要构建才能读的产物,收益与风险完全不成比例。
// 本门禁只保证「两份字面量此刻相等」,这是**成本最低、失效面最小**的那一档;
// 它当然挡不住「同一提交里同时改两侧」,但那种改动 review 时两侧 diff 并排可见。
//
// ---- 判定形态(与 check-src-layout.mjs / check-ci-contract.mjs 同范式)----
// 判定本体 = `judgeHtmlConstMirror(ctx, pairs)`(纯函数、IO 全经 ctx 注入),
// `main()` 只做「打印 + 按 --enforce 出 0/1」。
// 镜像登记表 `MIRROR_PAIRS` 是**形参**而不是模块常量:这样自检脚本能在合成夹具上
// 先红后绿,而不需要「从命令行换一份登记表」的口子 —— 那本身就是一个 fail-open
// (能传登记表就能把自己摘出去)。
//
// ---- ⚠️ 默认只报告,不判红(ADR-064 的 T0 节奏)----
// 本判据在落地时**当前即红**(登记的镜像对在 HTML 里取不到属性、或与常量不等 ——
// 见结论行),一建就 fail-closed 会让它进不了 verify:ci,而门禁进不了链等于不存在
// (「链上少一道判据」没有任何机器会发现)。故默认 exit 0、只报告;`--enforce` 才判红。
// **切换点(ADR-064 T2)**:两侧手写字面量收敂到只剩本表登记的那几对之后,把 --enforce
// 的默认关闭语义去掉,并由主会话把 script 挂进 verify:ci。
// 取数命令(判据本体即取数命令,故这里只记命令不记数值):
//   node gates/repo/check-html-const-mirror.mjs            # 报告模式:计数 + 逐条点名
//   node gates/repo/check-html-const-mirror.mjs --enforce  # 判红模式:非零退出
//
// ---- 「取不到」一律判红,不静默放过 ----
// 三种「查不到」在本门禁上与「查过了且相等」**不可区分**,放过去就是恒绿:
//   ① HTML 里那个 input 标签不见了(改了 id / 挪走了控件);
//   ② 标签在但 `max` 属性不见了;
//   ③ 常量那一行取不到数值(改了写法,如 `= 500 + 500`;或常量改名/删除)。
// 三者都出诊断,并点名是哪一档 —— 恒绿是纯文本门禁最坏的失效形态(没人会去看一个
// 总是 exit 0 的脚本)。
//
// ---- 入口守卫:必需,不是整洁问题 ----
// 本模块被验收段 import 当判定本体指针。顶层自执行会**改写宿主进程的 exitCode**
// (验收段在 Electron 里跑,而它 import 本模块的时刻不该决定整场验收的退出码)。
// 守卫写法与 check-src-layout.mjs 同形(全仓先例)。
import { readFileSync } from "node:fs";
import path from "node:path";
import { isMainModule, parseArgs } from "../../shared/cli.mjs";
import { ROOT } from "../../shared/paths.js";

/**
 * @typedef {object} MirrorPair 一对「HTML 手写镜像 ↔ core 常量」
 * @property {string} id 条目 id(诊断里点名用)
 * @property {string} htmlRel HTML 载体(仓库相对 POSIX 路径)
 * @property {string} attribute 镜像属性名(如 `max`)
 * @property {readonly string[]} inputIds 承载该属性的 input 的 id(逐个核对,缺一即判红)
 * @property {string} tsRel 常量所在的 TS 源文件(仓库相对 POSIX 路径)
 * @property {string} constantName 常量名(如 `MARGIN_MAX_MM`)
 * @property {string} why 为什么这两处必须相等(人工复核的唯一依据,不得留空)
 */

/**
 * 镜像登记表:「同一个值在两处各写一份」的**全集**。
 *
 * 逐条登记而非扫描自动发现:扫描 HTML 找数字字面量会命中 `min="0"` / `step="0.5"`
 * / 版式常量等一大堆与 core 常量无对应关系的值,判红面全是噪声;而**漏登记**的那一对
 * (改了常量没改 HTML)恰恰是本门禁唯一要抓的东西 —— 它必须是一次显式的代码改动,
 * review 才看得见。这与 check-copy-sites.mjs 头注「原语表不能被派生」同一条理由。
 *
 * ⚠️ **本表当前只登记 `max` 这一对**:`min="0"`(对应 `MARGIN_MIN_MM`)、`step="0.5"`、
 * `bodySizePt` 的 `min="8"`/`max="24"`(对应 `BODY_SIZE_MIN/MAX`)、`lineSpacing` 的
 * `min="1"`/`max="2.5"` 都是**同一种形态的手写镜像**,但它们不在本次收口范围内。
 * 它们与本表的关系是「加一行即覆盖」,故在此逐个点名,避免「本门禁已经守住了
 * HTML 与 core 的对称」这个**过宽的印象**被后来者当成事实。
 *
 * @type {readonly MirrorPair[]}
 */
export const MIRROR_PAIRS = Object.freeze([
  Object.freeze({
    id: "margin-max",
    htmlRel: "src/renderer/index.html",
    attribute: "max",
    inputIds: Object.freeze(["marginTop", "marginBottom", "marginLeft", "marginRight"]),
    tsRel: "src/core/settings/settings-defaults.ts",
    constantName: "MARGIN_MAX_MM",
    why: "页边距四输入框的 max 是 MARGIN_MAX_MM 的手写镜像(index.html 该处的注释"
      + "声明两者对称,但注释不是判据)。漂移的后果是双向的:core 放宽而输入框没放宽,"
      + "用户在面板里够不到新范围;core 收紧而输入框没收,用户能输入一个随后被"
      + "validatePageSetup 拒绝的值,且界面没有任何提示。",
  }),
]);

/** 登记表非空才成立:空表会让「每一对都相等」在零判定面上恒绿 */
const MIN_PAIRS = 1;
const SNIPPET_MAX = 60;
const USAGE = "用法: node gates/repo/check-html-const-mirror.mjs [--enforce] [--help]";

/**
 * @typedef {object} MirrorCtx 注入面(IO 与策略全部经它进来,判定本体自身不碰 fs)
 * @property {(relative: string) => string} readText 读仓库相对文本
 * @property {readonly MirrorPair[]} pairs 镜像登记表(形参:自检在合成输入上求值同一份判据)
 */

/**
 * @typedef {object} MirrorStats 计数(结论行用)
 * @property {number} pairs 登记的对数
 * @property {number} checked 实际完成比对的 (对 × input) 格数
 * @property {number} mismatches 取值不一致的格数
 * @property {number} missing 取不到的一侧(input 标签 / 属性 / 常量)计数
 */

/**
 * @typedef {object} MirrorProblem 一条判红项
 * @property {"mismatch" | "input-missing" | "attribute-missing" | "constant-missing"
 *   | "constant-unreadable" | "pair-invalid"} kind 判红种类
 * @property {string} pair 登记项 id
 * @property {string} detail 人可读说明(必须点名文件与 id/常量名,否则等于「只知道有问题」)
 */

/**
 * 注入面工厂:补齐缺项,判定本体拿到的永远是完整注入面。
 * @param {Partial<MirrorCtx>} [base] 调用方给的注入面
 * @returns {MirrorCtx} 完整注入面
 */
export function makeMirrorCtx(base = {}) {
  const root = ROOT;
  return {
    readText: base.readText ?? ((relative) => readFileSync(path.join(root, ...relative.split("/")), "utf8")),
    pairs: base.pairs ?? MIRROR_PAIRS,
  };
}

/**
 * 从 TS 源码文本里取 `export const <name> = <数字>;` 的数值。
 *
 * ⚠️ **只认「字面数字」这一种写法**,取不到即 null(由调用方判红)。这是刻意的:
 * 常量一旦改成 `500 + 500` 或从别处 import,本门禁就**看不见**了 —— 那种形态下
 * 「取不到」在门禁上与「相等」不可区分,所以必须报出来让人重新登记,而不是静默放行。
 *
 * @param {string} text TS 源文本
 * @param {string} name 常量名
 * @returns {string | null} 字面量原文(保留原字符串,便于诊断里逐字对读);取不到即 null
 */
export function readConstLiteral(text, name) {
  const re = new RegExp(String.raw`export\s+const\s+${name}\s*=\s*(-?\d+(?:\.\d+)?)\s*;`);
  const m = re.exec(text);
  return m === null ? null : m[1];
}

/**
 * 取某个 input 标签上某属性的值。
 *
 * 按 id 定位标签(而不是全局找 `max="…"`):全局找会拿到页面上**别处**的同名属性
 * (本文件里 `max` 出现在多处,值还不一样),比对的就不是被登记的那一对了。
 *
 * @param {string} html HTML 文本
 * @param {string} inputId input 的 id
 * @param {string} attribute 属性名
 * @returns {{ found: boolean, value: string | null }} found=false = 标签不存在;value=null = 标签在但属性缺
 */
export function readInputAttribute(html, inputId, attribute) {
  const tagRe = new RegExp(String.raw`<input\b[^>]*\bid="${inputId}"[^>]*>`);
  const tag = tagRe.exec(html);
  if (tag === null) return { found: false, value: null };
  const attrRe = new RegExp(String.raw`\b${attribute}="([^"]*)"`);
  const attr = attrRe.exec(tag[0]);
  return { found: true, value: attr === null ? null : attr[1] };
}

/**
 * 压掉多余空白,超长截断(诊断里放原文,便于直接看出写成了什么)。
 * @param {string} text 片段
 * @returns {string}
 */
function snippet(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat;
}

/**
 * 判定本体(可注入纯函数):逐对读 HTML 与常量文本、逐 input 比对。
 *
 * 纯函数 —— 判据必须能在合成输入上先红后绿,所以登记表是**形参**而不是模块常量;
 * CLI 那一路传的就是本文件的常量。这样自测不需要「从命令行换一份登记表」的口子。
 *
 * @param {Partial<MirrorCtx>} [base] 注入面(见 makeMirrorCtx)
 * @returns {{ problems: MirrorProblem[], stats: MirrorStats }}
 */
export function judgeHtmlConstMirror(base = {}) {
  const ctx = makeMirrorCtx(base);
  /** @type {MirrorProblem[]} */
  const problems = [];
  /** @type {MirrorStats} */
  const stats = { pairs: ctx.pairs.length, checked: 0, mismatches: 0, missing: 0 };
  if (ctx.pairs.length < MIN_PAIRS) {
    problems.push({
      kind: "pair-invalid",
      pair: "(登记表)",
      detail: `镜像登记表只有 ${ctx.pairs.length} 对(下限 ${MIN_PAIRS})—— 零判定面上「每一对都相等」恒绿`,
    });
    return { problems, stats };
  }

  for (const pair of ctx.pairs) {
    // 登记表自身的形态:字段缺失会让下面的查表拿到 undefined 而**静默跳过**这一对,
    // 表现是「登记了但没人查」—— 与恒绿不可区分,故形态不合规即判红。
    if (pair.why.trim() === "" || pair.inputIds.length === 0) {
      problems.push({
        kind: "pair-invalid",
        pair: pair.id,
        detail: `登记表项 ${pair.id} 缺 why 或 inputIds 为空(why 是人工复核的唯一依据;`
          + "空 inputIds 会让这一对「登记了但没人查」)",
      });
      continue;
    }

    /** @type {string} */
    let html;
    try {
      html = ctx.readText(pair.htmlRel);
    } catch (error) {
      problems.push({
        kind: "constant-unreadable",
        pair: pair.id,
        detail: `${pair.htmlRel} 读不到(${error instanceof Error ? error.message : String(error)})`,
      });
      stats.missing += 1;
      continue;
    }
    /** @type {string} */
    let ts;
    try {
      ts = ctx.readText(pair.tsRel);
    } catch (error) {
      problems.push({
        kind: "constant-unreadable",
        pair: pair.id,
        detail: `${pair.tsRel} 读不到(${error instanceof Error ? error.message : String(error)})`,
      });
      stats.missing += 1;
      continue;
    }
    const expected = readConstLiteral(ts, pair.constantName);
    if (expected === null) {
      problems.push({
        kind: "constant-missing",
        pair: pair.id,
        detail: `${pair.tsRel} 里取不到 \`export const ${pair.constantName} = <数字字面量>\` `
          + "的数值 —— 常量改名、被删、或写法不再是字面数字。"
          + "本门禁只认字面数字这一种写法(改写常量会让它在这里静默失明),请改回字面量或重新登记这一对",
      });
      stats.missing += 1;
      continue;
    }

    for (const inputId of pair.inputIds) {
      const { found, value } = readInputAttribute(html, inputId, pair.attribute);
      if (!found) {
        problems.push({
          kind: "input-missing",
          pair: pair.id,
          detail: `${pair.htmlRel} 里找不到 id="${inputId}" 的 input —— `
            + `这一对的镜像(属性 ${pair.attribute} ↔ ${pair.constantName})已无处可对`,
        });
        stats.missing += 1;
        continue;
      }
      if (value === null) {
        problems.push({
          kind: "attribute-missing",
          pair: pair.id,
          detail: `${pair.htmlRel} 的 input#${inputId} 上没有 ${pair.attribute} 属性 —— `
            + `常量侧 ${pair.constantName} = ${expected} 已无镜像`,
        });
        stats.missing += 1;
        continue;
      }
      stats.checked += 1;
      if (Number(value) === Number(expected)) continue;
      stats.mismatches += 1;
      problems.push({
        kind: "mismatch",
        pair: pair.id,
        detail: `${pair.htmlRel} 的 input#${inputId} 写的是 ${pair.attribute}="${value}",`
          + `而 ${pair.tsRel} 的 ${pair.constantName} = ${expected} —— 两侧已漂移。`
          + `处置:改 HTML 的 ${pair.attribute} 或改常量,使两者相等(本门禁只判相等,不替你选哪个)`,
      });
    }
  }
  return { problems, stats };
}

/**
 * CLI 主体:读盘 → 判定 → 打印 → 按 `--enforce` 出 0/1(判定逻辑全在 judgeHtmlConstMirror 里)。
 * @param {string[]} [argv] 参数数组
 * @returns {number} 退出码
 */
export function main(argv = []) {
  /** @type {Record<string, string | boolean>} */
  let options;
  try {
    options = parseArgs(argv, { booleans: ["enforce", "help"], usage: USAGE });
  } catch (error) {
    // 未知参数一律失败:静默按默认跑一遍报绿就是「假通过」
    console.error(`[html-mirror:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log(
      [
        USAGE,
        "  --enforce  把判红项转成非零退出(默认只报告:ADR-064 的 T0 阶段本判据当前即红,",
        "            一建就 fail-closed 会让它进不了 verify:ci;切换点见文件头)。",
      ].join("\n"),
    );
    return 0;
  }
  const enforce = options.enforce === true;
  const { problems, stats } = judgeHtmlConstMirror();

  const counts = [
    `镜像对 ${stats.pairs} 组 / 比对 ${stats.checked} 格`,
    `不一致 ${stats.mismatches} 格`,
    `取不到 ${stats.missing} 格`,
  ].join(";");
  const named = problems.map((problem) => `${problem.pair}:${problem.kind}`);

  if (problems.length === 0) {
    console.log(`[ok] HTML 手写镜像与 core 常量对称${enforce ? "(--enforce)" : "(报告模式)"}:${counts}`);
    return 0;
  }

  const stream = enforce ? console.error : console.log;
  const tag = enforce ? "fail" : "report";
  for (const problem of problems) {
    stream(`[html-mirror:${tag}] ${problem.pair} → ${problem.kind}:${snippet(problem.detail)}`);
  }
  if (!enforce) {
    console.log(
      `[report] HTML 手写镜像与 core 常量对称当前判红 ${problems.length} 项,未转成非零退出(报告模式):${counts}。`
      + `逐条:${named.join(", ")}。加 --enforce 即 fail-closed(ADR-064 的 T0 节奏:`
      + "T0 只报告,T2 收敂完存量镜像后才把 --enforce 固化进 verify:ci)",
    );
    return 0;
  }
  console.error(`[html-mirror:fail] HTML 手写镜像与 core 常量对称不成立,共 ${problems.length} 项:${counts}`);
  return 1;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。守卫右侧用 `isMainModule`(代码位置自比,
// 不是由仓根反推自身路径 —— 仓根是 cwd 派生的环境值,而本门禁刻意以「cwd 指合成目录、
// argv[1] 指仓内本体」被调用,两者恒不相等)。
if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}