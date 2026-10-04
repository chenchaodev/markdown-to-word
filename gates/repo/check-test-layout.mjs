// test 布局门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- 四族判据 ----
//   ① test-layer-self-hosted(L4):`test/<R>/**/<m>.test.js` 必须 import **至少一个**
//      解析后落在 `<R>/` 对应主体根内的模块。零命中即判红并点名该段。
//   ② test-layer-cross-import(L5):`test/<L>/**` 不得 import **别的层**的
//      `dist/<其它层>/` / `src/<其它层>/` / `<其它层>/`。命中判红,诊断直接给出
//      「搬去 `test/behavior/` 并写 `covers`」的处置指引。
//   ③ test-top-dirs-exact(L7):`test/` 顶层**目录**集合 == 镜像源派生集 ∪ {behavior, harness}。
//      多一个少一个都判红。
//   ④ test-harness-not-segment(L8):`test/harness/` 下不得出现 `*.test.js`。
//
// ---- L4 为什么必须判「零命中」而不是只判「import 落在别处」 ----
// 一条只检查「不许 import 别层」的规则,在**一个本层主体都没 import** 的段上会全绿 ——
// 而那正是最该被抓的形态:`test/core/runner-report.test.js`(797 行)import 的是
// `test/harness/runner.js`(测试框架自身),`test/shared/entry-exit-guard.test.js` 测的是
// `shared/entry-guard.mjs`,`test/gates/contract-single-source.test.js` 零 `gates/` import。
// 「至少一个」这条下界(而非「不许越界」那条上界)才是 L4 的全部内容。
//
// ---- L4 的「本层主体根」是什么 ----
// 主体根按层分两种形态,与镜像源集合的两种来源同构:
//   - `src/` 的直接子目录 R → `src/R/` **与** `dist/R/`(源与产物都算本层主体);
//   - 仓顶层树 R(gates/shared/tools)→ 只有 `R/`。
// 为什么 `src/R/` 与 `dist/R/` 都算:本仓的验收段跑**产物**(`dist/` 是 tsc 输出,
// 覆盖率与 `test:smoke` 的新鲜度门禁都以它为准),而类型引用只能指 `src/`
// (见下节)。只认其一会把另一半合法形态判红。
//
// ---- 值 import 与 type-only 引用必须分开(否则合法形态被误判) ----
// 本仓的 `dist/` **不产 `.d.ts`**(tsconfig.test.json 的 checkJs 关闭、产物只发 JS),
// 所以测试段里有一批**类型引用只能指 `src/`**:实测形如
// `test/core/render-defaults.test.js:36` 的
// `@typedef {import("../../src/core/i18n.js").ConvertWarning} Warning`。
// 这些引用合法且必需(改成指 `dist/` 会因缺声明文件而失去类型),**不得判红**。
// 判据因此复用 `check-import-boundary.mjs` 导出的 `isTypeOnlyClause`(词法层已区分
// `import type` 与行内 `type` 说明符),并对 JSDoc 里的 `import("…")` 形态单列一条:
// `import("…")` 出现在**代码**里是运行期动态 import,出现在**注释**里才是类型引用 ——
// 两者字面同形,靠 `lexSource` 的「抹注释」结果区分(代码里那个下标在 code 中仍是
// `import(`,注释里那个已被抹成空格)。
//
// ---- 镜像源集合为什么从磁盘派生(两层来源) ----
//   - `src/` 的直接子目录:**从磁盘列**。这是本门禁派生的一半,新增/合并层自动跟随。
//   - 仓顶层树:**取 `check-import-boundary.mjs` 的 `TREE_DIRS` 去掉 `test` 自身**
//     (`gates` / `shared` / `tools`)。不另列一张表 —— 那正是 ADR 判据反复批过的
//     「两份可漂移的副本」;顶层树集合在仓内已有单源(`TREE_DIRS` 是 ADR-038/043 的
//     树边界登记),本门禁读它而不是重抄一遍。
// ⚠ 这与 `SEGMENT_DIRS`(当前硬编码在 `shared/test-common-surface.js:47`)无关:
// 那张表**将在 T2/P2 被删除**,故本门禁**不得**依赖它 —— 段的发现机制是
// `test/harness/runner.js` 逐目录 `readdir` 过滤 `.endsWith(".test.js")`,**纯 glob、
// 无注册表**,本门禁照此发现,不读任何段目录清单。
//
// ---- L5 为什么**恒报告**、连 `--enforce` 也不参与退出码(ADR-064 的节奏) ----
// L5 在 T1 建时**当前即红**,且**已知会误伤合理跨层**:实测
// `test/core/heading-scale.test.js` import `dist/renderer/settings/settings-logic.js`
// 做 token 对照,`test/shared/geometry-gate.test.js` import `shared/geometry/*`
// (几何 core 本就归 shared),这类跨层是**有意的**。把这种误伤做成 fail-closed,
// 会逼人去删正确的测试或塞豁免表 —— 那比判红本身更坏。
// 故 L5 的命中归 **`info` 通道、结构上不参与退出码**:`checkTestLayout()` 返回的
// `problems` 里**恒不含** L5 项,`--enforce` 也只看 `problems`。这不是一个可配置的
// 开关(不给「从命令行把它摘出去」的口子 —— 那本身是 fail-open),而是模块内的
// 单一事实源常量 `L5_PENDING`,grep 行锚即 T2/T3 的进度记录:
//
//   grep -nE '^\s*L5_PENDING = true,$' gates/repo/check-test-layout.mjs
//
// **切换点(ADR-064 T3 末)**:跨层测试全部搬进 `test/behavior/` 并写 `covers` 之后,
// 把 `L5_PENDING` 改为 `false`,`judgeL5()` 的命中即从 `info` 改道进 `problems`,
// `--enforce` 随之对它 fail-closed。切换的前置条件是 info 通道的命中数归零 ——
// 在它还非零时切,是把已知违例固化成基线。
//
// ---- 形状:判定本体 = `checkTestLayout(ctx)`(可注入、零 IO 副作用) ----
// 与 check-src-layout.mjs / check-copy-sites.mjs 同一范式(全仓门禁判定协议,见
// gates/probe/gate-probes/protocol.mjs):IO 全部经 ctx 注入(读文本 / 列目录 /
// 扫描面下限),`main()` 只做「打印 + 按结论出 0/1」。
//
// ---- 入口守卫:必需,不是整洁问题 ----
// 本模块被门禁注册表 import 当判定本体指针。顶层自执行会**改写宿主进程的 exitCode**
// (验收段在 Electron 里跑,而它 import 本模块的时刻不该决定整场验收的退出码);而注册表
// R4b 会逐项对账「judgment.load 声明」与「顶层是否自执行」的事实。守卫写法与
// check-src-layout.mjs / check-import-boundary.mjs / check-changelog.mjs 同形。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isMainModule, parseArgs } from "../../shared/cli.mjs";
import { lexSource } from "../../shared/copy-closure.js";
import { ROOT } from "../../shared/paths.js";
import { isTypeOnlyClause, TREE_DIRS } from "./check-import-boundary.mjs";

/** 被判定的子树(单一来源:扫描面只此一处登记) */
export const TEST_REL = "test";
/** 段的扩展名(发现机制与 `test/harness/runner.js` 的 readdir 过滤逐字一致) */
export const SEGMENT_EXT = ".test.js";
/**
 * 允许存在但**不是镜像源**的两个顶层目录。
 *
 * `behavior` 收跨层测试(一个段横跨多层是它的**定义**,不是错位 —— 故它既不在 L4 的
 * 作用域内,L5 也不对它生效);`harness` 收测试框架自身(runner / assert / 夹具助手),
 * 它不是任何被测层的主体。
 *
 * 为什么这两个名字**必须**登记而不能纯派生:L7 的判据形状是「集合相等」,而这两个目录
 * 在仓内**没有对应的镜像源**(它们对应的是「测试的组织方式」而不是「被测的层」)。
 * 纯派生出的集合里没有它们,不给登记位就恒红。注意这与「登记一份镜像源清单」是相反
 * 性质的常量:镜像源那一半从磁盘派生,这里登记的是**派生之外的豁免位**,两者不会互相漂移。
 */
export const NON_MIRROR_TOP_DIRS = Object.freeze(["behavior", "harness"]);
/**
 * 扫描面(段)文件数下限:walker 整体失效(零段)时四族判据会「全绿」,而恒绿是纯文本门禁
 * 最坏的失效形态(没人会去看一个总是 exit 0 的脚本)。取实测值的约 3/4
 * (实测 134 段 → 下限 100),只在「塌缩」这一档报红,不随日常增删段抖动。
 */
export const MIN_SCANNED_FILES = 100;
/**
 * ⚠ L5 恒报告标记(机制与切换点见文件头「L5 为什么恒报告」一节)。
 *
 * **刻意不是形参、不是 CLI 开关**:ctx 注入白名单/下限是为了让自检脚本能在合成目录上求值
 * 同一份判据;而「L5 是否参与退出码」若可注入,就等于给了「从调用点把它摘出去」的口子 ——
 * 那本身是 fail-open(能传参就能让自己绿)。它是模块内的单一事实源,切换靠改这一行。
 */
export const L5_PENDING = true;
const USAGE = "用法: node gates/repo/check-test-layout.mjs [--enforce] [--help]";

/**
 * @typedef {object} DirEntry 一个目录项(注入面用的最小形状)
 * @property {string} name
 * @property {boolean} isDirectory
 */

/**
 * @typedef {object} TestLayoutCtx 注入面(IO 与策略全部经它进来,判定本体自身不碰 fs)
 * @property {string} root 求值根
 * @property {(relative: string) => string} readText 读仓库相对文本
 * @property {(relative: string) => DirEntry[]} listDir 列仓库相对目录
 * @property {number} minScannedFiles 扫描面段数下限(0 = 关闭该判据,合成夹具用)
 */

/**
 * @typedef {object} TestLayoutStats 计数(结论行用)
 * @property {number} files 扫描到的全部文件数
 * @property {number} segments 段文件数(进入 L4 / L5 / L8 的面)
 * @property {number} layerSegments 落在镜像源层目录内的段数(L4 / L5 的作用域)
 * @property {number} l4Violations L4 判红条数(零本层主体 + 段 import 段)
 * @property {number} l4NoOwnSubject 零本层主体的段数
 * @property {number} l4SegmentImports 段 import 段的条数
 * @property {number} l5Hits L5 跨层命中数(**恒不进 problems**,见 L5_PENDING)
 * @property {number} l7Extra 多出的顶层目录数
 * @property {number} l7Missing 缺失的顶层目录数
 * @property {number} l8Violations L8 判红条数
 */

/**
 * `import/export … from 'spec'`(含 `import type` 与行内 `type` 说明符)。
 * 跨度 `[^'"]*?` 而非无界:有效 ES 模块语法在 `import` 与 `from` 之间不含引号,
 * 该约束不漏任何真实 import、仍支持跨行,同时避免「`import '副作用'` 之后的另一条
 * import 的 from 被接上」与「文档串里的伪 import 被当真实 import」(同
 * check-import-boundary.mjs 的 FROM_RE,理由见那里的注释)。
 */
const FROM_RE = /(^|\n)[ \t]*(?:import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
/** 副作用导入 `import 'spec'` */
const SIDE_EFFECT_RE = /(^|\n)[ \t]*import\s+['"]([^'"]+)['"]/g;
/** 动态导入 `import('spec')` —— 运行期形态 */
const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * 注入面工厂:补齐缺项,判定本体拿到的永远是完整注入面。
 * @param {Partial<TestLayoutCtx>} [base] 调用方给的注入面
 * @returns {TestLayoutCtx} 完整注入面
 */
export function makeTestLayoutCtx(base = {}) {
  const root = base.root ?? ROOT;
  return {
    root,
    readText: base.readText ?? ((relative) => readFileSync(path.join(root, ...relative.split("/")), "utf8")),
    listDir:
      base.listDir
      ?? ((relative) => readdirSync(path.join(root, ...relative.split("/")), { withFileTypes: true })
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))),
    minScannedFiles: base.minScannedFiles ?? MIN_SCANNED_FILES,
  };
}

/**
 * 列出 `test/` 下的全部文件(仓库相对 POSIX 路径,已排序)。
 *
 * ctx.listDir 抛错**不在此吞掉**:调用方要把「test/ 读不到」判红(路径写错时静默按空集
 * 通过,门禁从那一刻起什么也没查,而输出是 exit 0 —— 这是最坏的失效形态)。
 * @param {TestLayoutCtx} ctx 注入面
 * @returns {string[]} 文件相对路径
 */
export function collectTestFiles(ctx) {
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} relDir 仓库相对目录
   * @returns {void}
   */
  const walk = (relDir) => {
    for (const entry of ctx.listDir(relDir)) {
      if (entry.name === "node_modules") continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory) walk(rel);
      else files.push(rel);
    }
  };
  walk(TEST_REL);
  return files.sort();
}

/**
 * 镜像源派生:层集合 + 每层的「主体根」前缀。
 *
 * 一半从磁盘列(`src/` 的直接子目录),一半取仓内已有的顶层树单源
 * (`TREE_DIRS` 去掉 `test` 自身)。**不读 `SEGMENT_DIRS`**(它将在 T2/P2 被删除,
 * 依赖它等于让本门禁活到那时就断)。
 * @param {TestLayoutCtx} ctx 注入面
 * @returns {{ srcLayers: string[], topTrees: string[], layers: string[], rootsOf: (layer: string) => string[] }}
 */
export function deriveMirrorLayers(ctx) {
  const srcLayers = ctx.listDir("src")
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort();
  const topTrees = Object.values(TREE_DIRS).filter((name) => name !== TEST_REL).sort();
  const layers = [...srcLayers, ...topTrees];
  const srcSet = new Set(srcLayers);
  return {
    srcLayers,
    topTrees,
    layers,
    /** @param {string} layer @returns {string[]} */
    rootsOf: (layer) => (srcSet.has(layer) ? [`src/${layer}/`, `dist/${layer}/`] : [`${layer}/`]),
  };
}

/**
 * 抽一个文件里的全部 import 事实(相对说明符解析到仓库相对 POSIX 路径)。
 *
 * type-only 判定复用 `isTypeOnlyClause`,另加 JSDoc 形态:`import("…")` 出现在**注释**
 * 里是类型引用(编译期擦除),出现在**代码**里是运行期动态 import。两者字面同形,
 * 靠 `lexSource` 的抹注释结果区分:代码里那个下标在 `code` 中仍以 `import(` 开头,
 * 注释里那个已被抹成空格。
 *
 * ⚠ 三处 matchAll 都要过 `inString` 过滤(不止注释那一处):`lexSource` 只抹注释、
 * **保留字符串内容**,故文档串里的 `import("…")` 形状在 code 里与真动态 import 同形,
 * 只有 inString 能分(见 extractImports 内的注释)。
 *
 * @param {string} text 文件原文
 * @param {string} file 文件的仓库相对 POSIX 路径(解析相对说明符的基准)
 * @returns {{ spec: string, typeOnly: boolean, resolved: string | null }[]}
 */
export function extractImports(text, file) {
  const lexed = lexSource(text);
  /** @type {{ spec: string, typeOnly: boolean, resolved: string | null }[]} */
  const out = [];
  const dir = path.posix.dirname(file);
  /**
   * @param {string} spec 说明符
   * @param {boolean} typeOnly
   * @returns {void}
   */
  const add = (spec, typeOnly) => {
    out.push({
      spec,
      typeOnly,
      resolved: spec.startsWith(".") ? path.posix.normalize(path.posix.join(dir, spec)) : null,
    });
  };
  // ⚠ 三处 matchAll 的结果**都要过 inString 过滤**,不只是注释那一处。理由:`lexSource`
  // 只把注释放成空格、**字符串内容原样保留**(那是真 import 的 specifier 本身),所以文档串里
  // 写的 `import("../../dist/core/x.js")` 形状在 `code` 里与真动态 import **完全同形**,
  // 靠 code 区分不出来 —— 只有 inString 能分(串内部的引号是字面量内容,不是词法记号)。
  // 少这一处过滤的后果:段里「示范该怎么 import」的说明串会被当成真实依赖,
  // 既能让 L4 假性通过,也能让 L5 假性命中(同 check-import-boundary 的 insideString 守卫)。
  for (const m of lexed.code.matchAll(FROM_RE)) {
    if (lexed.inString[m.index] === 1) continue;
    add(m[4], isTypeOnlyClause(m[2], m[3]));
  }
  for (const m of lexed.code.matchAll(SIDE_EFFECT_RE)) {
    if (lexed.inString[m.index] === 1) continue;
    add(m[2], false);
  }
  for (const m of lexed.code.matchAll(DYNAMIC_RE)) {
    if (lexed.inString[m.index] === 1) continue;
    add(m[1], false);
  }
  // JSDoc/注释里的类型引用:在**原文**上匹配,但只收那些在抹注释后消失的下标
  for (const m of text.matchAll(DYNAMIC_RE)) {
    if (lexed.code.startsWith("import(", m.index)) continue;
    if (lexed.inString[m.index] === 1) continue;
    add(m[1], true);
  }
  return out;
}

/**
 * 这个解析后的路径落在**哪一层**(不是本层时)。判据对象是「解析结果的首段目录名」,
 * 与 check-import-boundary 的 `resolveLayer` 同一形状,但这里要认得 `src/<层>/` 与
 * `dist/<层>/` 两种带前缀的形态(本仓的段 import 的是产物)。
 * @param {string} resolved 仓库相对 POSIX 路径
 * @param {{ layers: readonly string[] }} mirror 镜像源派生结果
 * @returns {string | null} 层名;不落在任何层内(如 test/ 内部、node_modules)时 null
 */
export function foreignLayerOf(resolved, mirror) {
  for (const layer of mirror.layers) {
    if (resolved.startsWith(`src/${layer}/`) || resolved.startsWith(`dist/${layer}/`)) return layer;
    if (resolved.startsWith(`${layer}/`)) return layer;
  }
  return null;
}

/**
 * 判定本体(可注入纯函数):四族判据 + 扫描面下界。
 *
 * L5 的命中走 `info` 而非 `problems`(恒报告,连 `--enforce` 也不拦 —— 见文件头)。
 * @param {Partial<TestLayoutCtx>} [base] 注入面(见 makeTestLayoutCtx)
 * @returns {{ problems: string[], info: string[], stats: TestLayoutStats }}
 */
export function checkTestLayout(base = {}) {
  const ctx = makeTestLayoutCtx(base);
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const info = [];
  /** @type {TestLayoutStats} */
  const stats = {
    files: 0,
    segments: 0,
    layerSegments: 0,
    l4Violations: 0,
    l4NoOwnSubject: 0,
    l4SegmentImports: 0,
    l5Hits: 0,
    l7Extra: 0,
    l7Missing: 0,
    l8Violations: 0,
  };

  /** @type {string[]} */
  let files;
  try {
    files = collectTestFiles(ctx);
  } catch (error) {
    problems.push(
      `${TEST_REL}/ → scan-surface-missing:读不到 ${TEST_REL}/ 子树(`
      + `${error instanceof Error ? error.message : String(error)}) —— 扫描面为空是最坏的失效形态`
      + "(门禁从这一刻起什么也没查而输出是 exit 0),故判红",
    );
    return { problems, info, stats };
  }
  stats.files = files.length;

  /** @type {{ srcLayers: string[], topTrees: string[], layers: string[], rootsOf: (layer: string) => string[] }} */
  let mirror;
  try {
    mirror = deriveMirrorLayers(ctx);
  } catch (error) {
    problems.push(
      `src/ → scan-surface-missing:读不到 src/ 子树(`
      + `${error instanceof Error ? error.message : String(error)}) —— 镜像源集合派生的输入缺失时,`
      + "L7 只能按空集比对并把全部顶层目录判成「多一个」(恒红且无信息量),故判红",
    );
    return { problems, info, stats };
  }

  const segments = files.filter((file) => file.endsWith(SEGMENT_EXT));
  stats.segments = segments.length;

  // ---- 判据一 L4 + 判据二 L5:逐段判定(两族共用一次读取) ----
  const layerSet = new Set(mirror.layers);
  for (const file of segments) {
    const layer = file.split("/")[1] ?? "";
    // 非镜像层目录下的段(behavior / harness / 当前的 common、fixtures)**不参与 L4/L5**:
    // behavior 段的定义就是横跨多层(对它判「不得跨层」是判据反了),harness 不是被测层;
    // 而 common / fixtures 这类非镜像目录由 L7 点名(「多一个顶层目录」),不必再叠一条
    // 无信息量的 L4 判红。
    if (!layerSet.has(layer)) continue;
    stats.layerSegments += 1;
    const own = mirror.rootsOf(layer);
    const imports = extractImports(ctx.readText(file), file);

    // L4 上界:至少一个解析后落在本层主体根内的引用。
    // type-only 引用**计入**「至少一个」—— 形如 `@typedef {import("../../src/core/i18n.js")…}`
    // 的类型引用是本仓的必需形态(产物不产 .d.ts,见文件头),把它判红等于逼人删掉类型标注。
    const ownHits = imports.filter((entry) => entry.resolved !== null && own.some((p) => entry.resolved.startsWith(p)));
    if (ownHits.length === 0) {
      stats.l4NoOwnSubject += 1;
      stats.l4Violations += 1;
      problems.push(
        `${file} → test-layer-self-hosted:该段解析后**没有 import 任何 ${layer} 层的主体**`
        + `(本层主体根 ${own.join(" 或 ")})—— 「不许 import 别层」这类上界规则在它身上会全绿,`
        + `而它恰恰是最该被抓的形态。要么搬进真正被测的那一层,要么它测的其实是测试框架/门禁自身:`
        + `那种段归 test/behavior/ 并在 covers 里写明被测对象`,
      );
    }

    // L4 另一格:段 import 段。段是**发现与隔离的单位**(runner 逐段起子进程),
    // 段之间互相 import 让「一段失败」不再是可归因的最小单位,且被 import 的那段会
    // 在自己的进程里再跑一遍(双跑 + 顺序耦合)。
    const segmentImports = imports.filter(
      (entry) => entry.resolved !== null && entry.resolved.startsWith(`${TEST_REL}/`) && entry.resolved.endsWith(SEGMENT_EXT),
    );
    if (segmentImports.length > 0) {
      stats.l4SegmentImports += 1;
      stats.l4Violations += 1;
      problems.push(
        `${file} → test-layer-self-hosted:段 import 段(${[...new Set(segmentImports.map((e) => e.resolved))].join(", ")})`
        + " —— 段是发现与隔离的单位,段间 import 让失败不可归因且让被 import 的段双跑。"
        + "共用部分抽进非段助手(当前在 test/harness/(T3 步 1 已迁),harness/)",
      );
    }

    // L5:跨层。type-only 引用**不算**跨层(编译期擦除,与 check-import-boundary 的
    // allowTypeOnly 钩子同款取舍);命中恒进 info,不参与退出码。
    for (const entry of imports) {
      if (entry.resolved === null || entry.typeOnly) continue;
      if (own.some((p) => entry.resolved.startsWith(p))) continue;
      const target = foreignLayerOf(entry.resolved, mirror);
      if (target === null) continue;
      stats.l5Hits += 1;
      const message = `${file} → test-layer-cross-import:${layer} 层的段 import 了 ${target} 层的主体 `
        + `(${entry.resolved})—— 同层自由、跨层归 behavior:把该段搬进 test/behavior/ 并在段内写 `
        + `covers(声明它横跨哪几层),这样「一个段对应一层」的不变量与「确有跨层行为」两件事都还成立`;
      if (L5_PENDING) info.push(message);
      else problems.push(message);
    }
  }

  if (stats.segments < ctx.minScannedFiles) {
    problems.push(
      `scan-surface-collapsed:${TEST_REL}/ 下只扫到 ${stats.segments} 个段文件`
      + `(下限 ${ctx.minScannedFiles})—— walker 可能已失效,而四族判据在零扫描面下会「全绿」`,
    );
  }

  // ---- 判据三 L7:顶层目录集合相等 ----
  // 只数**目录**:`test/acceptance.mjs`(段入口,已登记在注册表 TOOLCHAIN_FILES)不是一层,
  // 计入即恒红 —— 与 check-import-boundary 的 analyzeSrcTopLayers 同一取舍。
  const actualDirs = ctx.listDir(TEST_REL).filter((entry) => entry.isDirectory).map((entry) => entry.name).sort();
  const expectedDirs = [...new Set([...mirror.layers, ...NON_MIRROR_TOP_DIRS])].sort();
  const actualSet = new Set(actualDirs);
  const expectedSet = new Set(expectedDirs);
  for (const name of actualDirs) {
    if (expectedSet.has(name)) continue;
    stats.l7Extra += 1;
    problems.push(
      `${TEST_REL}/${name} → test-top-dirs-exact:${TEST_REL}/ 顶层多出目录「${name}/」`
      + ` —— 顶层目录集合必须恰好等于镜像源派生集(${mirror.srcLayers.join("/")} + 顶层树 `
      + `${mirror.topTrees.join("/")})∪{${NON_MIRROR_TOP_DIRS.join(", ")}}。`
      + "非镜像目录要么迁进对应层,要么内容整体搬进 test/behavior/(跨层)或 test/harness/(测试框架自身)",
    );
  }
  for (const name of expectedDirs) {
    if (actualSet.has(name)) continue;
    stats.l7Missing += 1;
    problems.push(
      `${TEST_REL}/${name} → test-top-dirs-exact:${TEST_REL}/ 顶层缺目录「${name}/」`
      + ` —— 少一个与多一个同样是集合不等的两档:派生集里有的层必须有自己的段目录,`
      + "否则该层的段会散在别处,而「一段对应一层」的不变量无从核对",
    );
  }

  // ---- 判据四 L8:harness 下不得有段 ----
  for (const file of segments) {
    if (!file.startsWith(`${TEST_REL}/harness/`)) continue;
    stats.l8Violations += 1;
    problems.push(
      `${file} → test-harness-not-segment:test/harness/ 下出现段文件 —— harness 收的是测试框架自身`
      + "(runner / assert / 夹具助手),它们由段 import 而不被 runner 发现。"
      + `段名去掉 ${SEGMENT_EXT} 后缀即被 test/harness/runner.js 的 readdir 过滤发现并单独起进程,`
      + "而它在 harness/ 下没有任何被测层可归属",
    );
  }

  return { problems, info, stats };
}

/**
 * CLI 主体:读盘 → 判定 → 打印 → 按 `--enforce` 出 0/1(判定逻辑全在 checkTestLayout 里)。
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
    console.error(`[test-layout:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log(
      [
        USAGE,
        "  --enforce  把 L4 / L7 / L8 的判红项转成非零退出(默认只报告:ADR-064 的 T1 阶段这几族",
        "            判据当前即红,一建就 fail-closed 会让它进不了 verify:ci;切换点见文件头)。",
        `  ⚠ L5(test-layer-cross-import)恒报告:即便 --enforce 也不参与退出码(L5_PENDING = ${String(L5_PENDING)}),`,
        "            因为它已知会误伤有意的跨层测试;切换点见文件头「L5 为什么恒报告」一节。",
      ].join("\n"),
    );
    return 0;
  }
  const enforce = options.enforce === true;
  const { problems, info, stats } = checkTestLayout();

  const counts = [
    `L4 test-layer-self-hosted 判红 ${stats.l4Violations} 项`
    + `(零本层主体 ${stats.l4NoOwnSubject} / 段 import 段 ${stats.l4SegmentImports};`
    + `层内段 ${stats.layerSegments} / 共 ${stats.segments} 段)`,
    `L5 test-layer-cross-import 命中 ${stats.l5Hits} 处(${L5_PENDING ? "恒报告,不计退出码" : "已转判红"})`,
    `L7 test-top-dirs-exact 多 ${stats.l7Extra} / 缺 ${stats.l7Missing}`,
    `L8 test-harness-not-segment 判红 ${stats.l8Violations} 项`,
  ].join(";");
  const named = problems.map((problem) => problem.split(" → ")[0] ?? problem);

  for (const line of info) console.log(`[test-layout:pending] ${line}`);

  if (problems.length === 0) {
    console.log(`[ok] test 布局四族判据通过${enforce ? "(--enforce)" : "(报告模式)"}:${counts}`);
    return 0;
  }

  const stream = enforce ? console.error : console.log;
  const tag = enforce ? "fail" : "report";
  for (const problem of problems) stream(`[test-layout:${tag}] ${problem}`);
  if (!enforce) {
    console.log(
      `[report] test 布局四族判据当前判红 ${problems.length} 项,未转成非零退出(报告模式):${counts}。`
      + `点名文件:${named.join(", ")}。加 --enforce 即 fail-closed(ADR-064 的 T1 节奏:`
      + "T1 只建判据不搬文件,T2/T3 搬完并写 covers 后才把 --enforce 固化进 verify:ci)",
    );
    return 0;
  }
  console.error(
    `[test-layout:fail] test 布局四族判据不成立,共 ${problems.length} 项:${counts}`
    + `(L5 的 ${stats.l5Hits} 处恒报告,不在本计数内)`,
  );
  return 1;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。守卫右侧用 `isMainModule`(代码位置自比,
// 不是由仓根反推自身路径 —— 仓根是 cwd 派生的环境值,而本门禁刻意以「cwd 指合成目录、
// argv[1] 指仓内本体」被调用,两者恒不相等)。
if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
