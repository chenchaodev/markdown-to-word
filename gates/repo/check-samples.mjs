// samples/ 准入门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- 它守的是「准入」,不是「内容」----
// `samples/` 是**样例产物目录**(`shared/paths.js` 的 `FIXTURES_DIR` 指向它),消费方有三处:
//   ① `gates/fixtures/gen-fixtures.mjs` —— 把各验收段导出的 `fixtures` **生成**成
//      `samples/docs/<段基名>[-<场景>].md`,并把段引用到的图片复制进 `samples/docs/input/`;
//      `--check` 按字节比对(它判的是「生成产物是否新鲜」)。
//   ② 同一门禁的图片**字节基线**(`listImageFixtures` 覆盖 samples/ 下**全部**图片
//      —— 含 `manual/images/`、`input/` 下那些没被任何样例引用的图),判「夹具本身有没有漂移」。
//   ③ GUI 的「打开样例」与 `tools/visual-check.mjs` —— 直接读 `samples/docs/*.md`。
//
// ⇒ 本门禁**只判文件层形态**(扩展名 / 子树可读性),**一个字节的 md 正文都不解析**。
// 这条分界不是省事,是本门禁唯一的正确性前提:`samples/docs/code-highlight.md` 与
// `mermaid-js.md` **通篇是围栏代码块**(实测各 2 处 ```),而那正是这两个样例存在的全部理由。
// 「md 里有代码块」与「树里有 .mjs 文件」是**两件事**:前者是样例内容,后者是代码落错了地方。
// 任何按正文判「samples/ 不许出现代码」的写法都会把这两个样例 themselves 判红。
//
// ---- 为什么这道判据有牙齿(缺口是可实测的,不是假想)----
// `samples/` 被**四道既有门禁整棵排除**,其中两处是**按设计**排除(不是漏网):
//   - `check-temp-cleanup.mjs:21`「排除 samples(被测样例数据本身,不是清理动作)」;
//   - `check-test-numbering.mjs:20-24` 同款(排除写成显式清单,理由是「它不是断言」)。
// 另两处是**范围**上根本没扫到它:
//   - `npm run lint` = `eslint src/ test/ gates/ tools/` —— `samples/` 不在清单里;
//   - `tsc` 的 include 不含 `samples/`,`check-import-boundary` 的门禁主体豁免表也记着
//     「实测没有任何 import 说明符指向 samples/」。
//
// ⇒ **一个 `.mjs` 落进 `samples/` 是完全无人看守的**:不被 lint、不被 typecheck、
// 不被 import 边界核对、不被临时目录清理收口、不被测试编号门禁扫到,而它在工作树里
// 存在、还能被人 import 到。它是本仓唯一一处「代码可以住进去而没有任何一道门禁会红」的树。
// 本门禁就是把那个「无人看守」变成「落进去即红」。
//
// ---- 两族判据 ----
//   ① samples-no-code-files:`samples/**` 下不得有**代码文件**。判据是**扩展名**,
//      不是「像代码」 —— 形态判定必须在不读正文的前提下成立(见上文的分界)。
//   ② samples-unreadable-subtree:`samples/` 及其任一子目录**列不出来**即判红。
//      ⚠ 这一族与「树是空的」是**两件事**:空目录是合法状态(列得出来、零条目),
//      列不出来是「这道门禁没查那棵子树」—— 后者是恒绿形态,前者不是。
//      分界画在这里,是为了既消灭恒绿、又不把「临时清空 samples/」变成红。
//
// ---- 扩展名闭集为什么是这个闭集 ----
// `CODE_EXTS` 收的是「Node / TS 工具链会把它当模块加载或编译」的扩展名。
// 逐条说清**不收**的,理由与收的一样是判据的一半(判据的可信度来自它的边界也写清了):
//   - **`.json` 不收**:json 是**数据**。settings 样例、预设样例放 json 进 samples/ 是
//     这个目录的正常用法,禁它会把一条正当用法判红,而它又不会被当模块执行。
//   - **`.map` 不收**:source map 是代码的产物,不是代码。它出现在 samples/ 意味着
//     「有人在这里构建过」——而那种情形下真正的代码文件(`.mjs` / `.js`)必然同时在场,
//     由本族已经判红。单独为它开一条只会扩大红面而不增加任何保护。
//   - **`.md` / `.png` 等不在表内即放行**:它们是样例的正当内容,不是「漏网」(见上)。
//   - `.d.ts` 无需单列:它以 `.ts` 结尾,已被本闭集命中。
//
// ---- 递归深度不限 ----
// 实测 `samples/` 有子目录且**不是**一层:docs/ · docs/input/ · input/ · manual/
// · manual/chapters/ · manual/images/(最深三层)。设深度上限等于开一个洞:
// `samples/a/b/c/x.mjs` 从洞里走过去。递归深度与 `gen-fixtures.listImageFixtures` 同款
// (它对 samples/ 也是不限深度的递归),两层判据对「samples/ 有什么」的视野因此一致。
//
// ---- 符号链接:不递归进入,按文件判 ----
// `readdirSync(withFileTypes)` 对「指向目录的符号链接」返回 `isDirectory() === false`,
// 故它被当作**文件**参与扩展名判定(`x.mjs` 软链照样判红),且不会被 walk 进去 ⇒ 结构上
// 不存在软环无限递归。这不是「忽略软链」,是软链落在文件那一档;无需额外代码,写在这里
// 是为了让后来者不必把它当一个待办。
//
// ---- 豁免:无,且刻意不建豁免机制 ----
// 实测 `samples/` 下**没有任何一个子路径是该放代码的**:docs/ 由 md fixtures 生成(产物
// 只能是 md 与被引用的图片)、manual/ 与 input/ 是手写 md 与图片。⇒ 无豁免。
//
// ⚠ **刻意不预建一张空的豁免表**:空表在第一次命中前恒绿,而「查不到豁免」与
// 「真没有豁免」在门禁上不可区分 —— 那正是本仓多处明写要消灭的失效形态
// (见 `gate-index.selftest.mjs` 文件头「删掉之后不许留一个 report-only 的占位」)。
// 将来若真的出现该放代码的子路径,那是一件需要**单独裁决**的事(它意味着 samples/ 的
// 定位要重新讨论),不是加一行豁免就能解决的 —— 故此处不留机制口。
//
// ---- 形状:判定本体 = `checkSamples(ctx)`(可注入、零 IO 副作用)----
// 与 check-src-layout.mjs 同一范式:IO 全部经 ctx 注入(列目录 / 根路径),`main()` 只做
// 「打印 + 按结论出 0/1」。注入面让自检能在**合成树**上先红后绿,不必碰真实 samples/
// —— 这也是「夹具绝不造在 samples/ 里」得以成立的机制前提(判据的对象必须是 samples/,
// 在对象里造夹具就是判错了对象)。
//
// ---- 入口守卫:必需,不是整洁问题 ----
// 本模块被门禁索引当判定体指针 import。顶层自执行会**改写宿主进程的 exitCode**
// (验收段在 Electron 里跑,而它 import 本模块的时刻不该决定整场验收的退出码);
// `test/gates/repo/gate-index.test.js` 的格③也会逐条核对「judgment 指针声明的模块
// 顶层无自执行」。守卫写法与 check-src-layout.mjs / check-ci-contract.mjs 同形(全仓先例)。
import { readdirSync } from "node:fs";
import path from "node:path";
import { isMainModule, parseArgs } from "../../shared/cli.mjs";
import { ROOT } from "../../shared/paths.js";

/** 被判定的子树(单一来源:扫描面只此一处登记) */
export const SAMPLES_REL = "samples";

/**
 * 判为「代码文件」的扩展名闭集(小写比较:仓内扩展名一律小写)。
 * 收录判准与不收的逐条理由见文件头「扩展名闭集为什么是这个闭集」。
 * @type {readonly string[]}
 */
export const CODE_EXTS = Object.freeze([".mjs", ".js", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);

const USAGE = "用法: node gates/repo/check-samples.mjs [--help]";

/**
 * @typedef {object} DirEntry 一个目录项(注入面用的最小形状)
 * @property {string} name
 * @property {boolean} isDirectory
 */

/**
 * @typedef {object} SamplesCtx 注入面(IO 全部经它进来,判定本体自身不碰 fs)
 * @property {string} root 求值根
 * @property {(relative: string) => DirEntry[]} listDir 列仓库相对目录
 */

/**
 * @typedef {object} SamplesStats 计数(结论行用)
 * @property {number} files 扫描到的文件总数
 * @property {number} dirs 扫描到的子目录总数
 * @property {number} codeFiles 判为代码文件的数量(判红条数与它相等)
 * @property {number} byExt 按扩展名统计的分布(结论行用,便于一眼看出这棵树里都是什么)
 */

/**
 * 注入面工厂:补齐缺项,判定本体拿到的永远是完整注入面。
 * @param {Partial<SamplesCtx>} [base] 调用方给的注入面
 * @returns {SamplesCtx} 完整注入面
 */
export function makeSamplesCtx(base = {}) {
  const root = base.root ?? ROOT;
  return {
    root,
    listDir:
      base.listDir
      ?? ((relative) => readdirSync(path.join(root, ...relative.split("/")), { withFileTypes: true })
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))),
  };
}

/**
 * 取出扩展名(小写)。无点、无点文件名(`.gitignore` 这类)返回 `""`。
 * @param {string} basename 文件名
 * @returns {string} 扩展名(含点,小写)或空串
 */
export function extOf(basename) {
  const dot = basename.lastIndexOf(".");
  return dot <= 0 ? "" : basename.slice(dot).toLowerCase();
}

/**
 * 某个文件名是否判为「代码文件」。
 * @param {string} basename 文件名
 * @returns {boolean}
 */
export function isCodeFile(basename) {
  return CODE_EXTS.includes(extOf(basename));
}

/**
 * 判定本体(可注入纯函数):两族判据。
 *
 * ⚠ **两族各自独立成环、独立返回**:判据一(扩展名)与判据二(子树可读)之间不共享任何
 * 状态,「列不出来」只 `continue` 掉那**一棵**子树、不中断其余遍历。这样两条负向夹具
 * 才可能各自被变异实验单独打红而不牵动对方(见 selftest 的变异实验)。
 *
 * @param {Partial<SamplesCtx>} [base] 注入面(见 makeSamplesCtx)
 * @returns {{ problems: string[], stats: SamplesStats }}
 */
export function checkSamples(base = {}) {
  const ctx = makeSamplesCtx(base);
  /** @type {string[]} */
  const problems = [];
  /** @type {SamplesStats} */
  const stats = { files: 0, dirs: 0, codeFiles: 0, byExt: {} };

  /**
   * 递归走一棵树。
   * @param {string} relDir 仓库相对目录(`samples` 或其子目录)
   * @returns {void}
   */
  const walk = (relDir) => {
    /** @type {DirEntry[]} */
    let entries;
    try {
      entries = ctx.listDir(relDir);
    } catch (error) {
      // 判据二:列不出来 = 这一棵子树**没被查**。与「这棵树是空的」严格分开 ——
      // 后者列得出来、零条目,是合法状态;前者让整棵子树在零判定下全绿,而输出是 exit 0。
      problems.push(
        `${relDir} → samples-unreadable-subtree:列不出这个目录(`
        + `${error instanceof Error ? error.message : String(error)})—— `
        + "门禁从这一刻起没有查这棵子树,而「没查」与「查过了、里面没有代码」在门禁上不可区分",
      );
      return;
    }
    for (const entry of entries) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory) {
        stats.dirs += 1;
        walk(rel);
        continue;
      }
      stats.files += 1;
      const ext = extOf(entry.name);
      stats.byExt[ext] = (stats.byExt[ext] ?? 0) + 1;
      // ---- 判据一:代码文件 ----
      if (!CODE_EXTS.includes(ext)) continue;
      stats.codeFiles += 1;
      problems.push(
        `${rel} → samples-no-code-files:${SAMPLES_REL}/ 下不得有代码文件(扩展名 ${ext})—— `
        + "这个目录是**样例产物目录**:它的内容由 md 生成或手写 md 与图片,消费方是 "
        + "`gen-fixtures --check` 的字节比对、GUI 的「打开样例」与 visual-check,"
        + "不是模块加载器。而 samples/ 被 lint / typecheck / import 边界 / 临时目录清理 / "
        + "测试编号五道门禁整棵排除 ⇒ 代码落在这里**没有任何一道门禁会红**。"
        + "要放辅助脚本请放 tools/(或段内,随该段一起被 lint 与覆盖率管到)",
      );
    }
  };

  walk(SAMPLES_REL);
  return { problems, stats };
}

/**
 * CLI 主体:读盘 → 判定 → 打印 → 按结论出 0/1(判定逻辑全在 checkSamples 里)。
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
    console.error(`[samples:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log(
      [
        USAGE,
        `  判据一 samples-no-code-files:${SAMPLES_REL}/ 下不得有代码文件(${CODE_EXTS.join(" ")})`,
        "  判据二 samples-unreadable-subtree:samples/ 或其任一子目录列不出来即判红",
        "            (与「目录是空的」是两件事:空目录合法,列不出来是「没查」)",
      ].join("\n"),
    );
    return 0;
  }

  const { problems, stats } = checkSamples();
  const shape = Object.entries(stats.byExt)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ext, n]) => `${ext === "" ? "(无扩展名)" : ext}×${n}`)
    .join(" ");
  const counts = `扫描 ${stats.files} 个文件 / ${stats.dirs} 个子目录(${shape || "空"});`
    + `代码文件 ${stats.codeFiles} 个`;

  if (problems.length === 0) {
    console.log(`[ok] ${SAMPLES_REL}/ 准入判据通过(无代码文件、无列不出的子树):${counts}`);
    return 0;
  }
  for (const problem of problems) console.error(`[samples:fail] ${problem}`);
  console.error(`[samples:fail] ${SAMPLES_REL}/ 准入判据不成立,共 ${problems.length} 项:${counts}`);
  return 1;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。守卫右侧用 `isMainModule`(代码位置
// 自比,不是由仓根反推自身路径 —— 仓根是 cwd 派生的环境值,而本门禁刻意以「cwd 指合成目录、
// argv[1] 指仓内本体」被调用,两者恒不相等)。
if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}