// 依赖声明与 import 层向边界自检(无产物、幂等,exit 0/1)。
//
// 用途:三件事都在「构建之前、纯文本层面」判定,不必等 tsc/打包才暴露:
//   1. 传递依赖声明:src 运行时真的 import 的包必须在 dependencies。历史上把
//      jszip 放在 devDependencies、把 mdast/micromark/unified 一族靠别的包的
//      传递依赖偶然就位 —— 一次干净的 `npm ci --omit=dev` 或上游树变动就会在
//      运行时炸掉,而 lockfile 一直看不出问题。本脚本按「源码实际 import」与
//      「package.json 声明」求差集,两个方向都判红。
//   2. type-only import 走独立判定:类型是编译期产物,由 @types/* 或任意已声明
//      包提供即可,不该被「必须进 dependencies」的运行时规则误伤;反过来,只被
//      type-only 引用的包也不构成运行时依赖(仍可在 dependencies 里,只是不再
//      强制)。
//   3. 层向边界:core 是可复用转换核心(不碰宿主、不反向依赖 GUI 两层),
//      renderer 不反向依赖 main,preload 不经上跳引用 main。这是单向依赖的
//      机械断言,替代「靠 code review 记住」的约定。
//
// 判定输入是**源码文本**而非类型检查结果:门禁要在 tsc 之前跑,且要在
// 「有人新写了一个 import」的最早时刻就红。正则抽取而非走 TS AST,理由同
// check-ci-contract.mjs(纯 Node,零新增依赖)。
//
// 用法:
//   node gates/repo/check-import-boundary.mjs [--src <dir>] [--package <file>] [--flavor src|dist]
//
//   --src      被扫描的源码子树(默认 src)
//   --package  依赖声明来源(默认 package.json)
//   --flavor   源码形态:src = TS 源(默认);dist = tsc 产物(ESM + CommonJS 混编,
//              type-only 已被编译期擦除,故产物侧一律按运行时判定)
//
// 源码子树(--src)与依赖声明(--package)分开指定:编译产物(dist/)与仓库根的
// package.json 是一对,但两者不同层;合成一个根目录参数会逼着脚本去猜声明在哪。

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, parseArgs } from '../artifacts/check-dist-manifest.mjs';
import { lexSource, skipQuoted } from '../../shared/copy-closure.js';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const USAGE =
  '用法: node gates/repo/check-import-boundary.mjs [--src <dir>] [--package <file>] [--flavor src|dist]';

/** 源码形态 → 参与扫描的扩展名与是否抽 require() */
export const FLAVORS = Object.freeze({
  src: { extensions: ['.ts', '.cts'], cjs: false, typeOnlyAware: true },
  dist: { extensions: ['.js', '.cjs'], cjs: true, typeOnlyAware: false },
});

// ---- 规则表(单一来源;诊断文案与判定同处,避免两处漂移)----

/**
 * 宿主内建模块:由 Electron 运行时注入,不随包分发,因此只能是 devDependency。
 * 若按「运行时 import 必须在 dependencies」一刀切,主进程全部 import 都会红。
 */
export const HOST_PROVIDED_RUNTIME = Object.freeze({
  electron: '宿主(Electron 运行时)注入,非 node_modules 依赖,只能是 devDependency',
});

/**
 * 「声明了但不经 import 使用」的依赖:以 file:// 直引其产物文件
 * (见 src/main/services/resource-dirs.ts),import 图上看不到。
 * 未列入本表的未使用声明会原样报出。
 */
export const RESOURCE_ONLY_DEPENDENCIES = Object.freeze({
  mermaid: '以 file:// 直引 dist/mermaid.min.js(IIFE 产物),不经 import',
});

/**
 * core 内允许 import node: 内建模块的文件(其余 core 文件一律判红)。
 * 逐个列文件而不是放行「某一组模块」:这五个文件各自因具体原因需要
 * 文件系统/URL 能力,新增一个即代表 core 又漏了宿主依赖面。
 * 书写 .ts 源文件名,匹配时按去扩展名比较(见 stripExtension),使同一份白名单
 * 同时约束 src 源与其编译产物 dist/*.js。
 *
 * 读这份表时请分清两类能力(REF-025 #07 之后):
 * - **真做 IO**:precheck.ts(node:fs 存在性/realpath)、katex-css.ts(node:path 拼装 +
 *   读取经注入,已不含 node:fs);
 * - **纯字符串运算**:image.ts(node:url 转 file://)、merge.ts(node:path)、
 *   image-path-policy.ts(node:path 的 resolve/relative/isAbsolute/sep/win32/posix)。
 *   后者一个字节磁盘都不碰。image-path-policy.ts 的 node:path 是**刻意保留**的 ——
 *   其中 path.relative 与 path.win32/posix 是符号链接逃逸判定(ADR-012)的承重逻辑,
 *   自己实现一份就是制造安全漏洞,故宁可留白名单也不摘。
 */
export const CORE_NODE_BUILTIN_FILES = Object.freeze([
  'core/pipeline/precheck.ts',
  'core/pdf/katex-css.ts',
  'core/pdf/rules/image.ts',
  'core/pipeline/merge.ts',
  'core/markdown/image-path-policy.ts',
]);

/**
 * 层向规则。scope 匹配相对路径;forbid 语义:
 *   bare:<包名>     —— 该 bare specifier 不得出现在此范围内
 *   layer:<层,层>   —— 不得 import 解析后落在这些层下的模块
 *   prefix:<前缀>   —— 不得使用以此前缀开头的相对 specifier
 */
export const LAYER_RULES = Object.freeze([
  {
    id: 'core-no-host',
    scope: 'core',
    forbid: 'bare:electron',
    reason: 'core 是与宿主无关的可复用转换核心,不得依赖 Electron 宿主',
  },
  {
    id: 'core-no-upward',
    scope: 'core',
    forbid: 'layer:main,renderer',
    reason: 'core 不得反向依赖 GUI 两层(依赖方向单向:core ← main ← renderer)',
  },
  {
    id: 'renderer-no-main',
    scope: 'renderer',
    forbid: 'layer:main',
    reason: 'renderer 不得直接引用主进程模块,跨界只经 preload 暴露的 contextBridge API',
  },
  {
    id: 'preload-no-main',
    scope: 'preload',
    forbid: 'prefix:../main',
    reason: 'preload 运行在沙箱 renderer 侧,不经上跳引用 main 进程模块',
  },
  {
    id: 'main-no-renderer',
    scope: 'main',
    forbid: 'layer:renderer',
    reason: 'main 是 GUI 的宿主而非被依赖方,不得反向引用 renderer 内部模块(依赖方向单向 core ← main ← renderer;跨界只经 preload 暴露的 contextBridge API)',
  },
  {
    id: 'smoke-no-outside-src',
    scope: 'smoke',
    // 用既有的 prefix: 形态而非 layer:—— resolveLayer 是相对文件目录拼接、不锚定 src 根,
    // 故 ../../test/x 归一化后首段是「..」而非「test」,layer: 形态抓不到向上逃逸。
    // 而本规则的意图正是「不得逃出 src/」:smoke 编译产物在 dist/main/,凡 ../../ 开头
    // 的依赖都已在包外(build.files 只收 dist/**),解包后必然跑不起来。
    forbid: 'prefix:../../',
    reason: '冒烟须能在打包产物里运行(build.files 只收 dist/**),smoke 不得逃出 src/(即不得引用仓库相对路径、test/ 等不入包路径);test 侧只做薄转调',
  },
  {
    id: 'renderer-foundation-no-feature-dep',
    scope: 'renderer-foundation',
    // 分层口径(REF-025 #13):renderer 内部**不**整体分层 —— 实测 convert / settings /
    // ui / wizard 四个功能目录两两互依(5 对双向、共 29 条目录边),它们是平铺协作的
    // peer 模块,对它们断言「方向」会一加就红。故只约束**基础层**:元素映射(dom/)与
    // 纯函数核+store(state/)。实测这两层在全部 29 条边中**无任何出边**,即它们是叶子,
    // 任何功能模块都依赖它们、它们不依赖任何功能目录 —— 这条是真不变量,机械可判。
    // 它守住的是两条语义:pure.ts「零 DOM 依赖」与 refs.ts「无业务知识」;一旦反向
    // 依赖,这两条不变量就名存实亡(比如 refs 里塞进设置项判断)。
    forbid: 'prefix:../convert/,../settings/,../ui/,../wizard/',
    reason: 'renderer 基础层(dom/ 元素映射、state/ 纯函数核与 store)是所有功能模块的共同底座,不得反向依赖任何功能目录;唯一合法的向上引用是 ../../core/(跨进程契约单源)',
  },
  {
    id: 'core-pdf-no-fs',
    scope: 'core-pdf',
    // 只禁 node:fs / node:fs/promises 这两个真做 IO 的内建;node:path 与 node:url
    // 在 core/pdf 里是纯字符串运算(file:// 拼装、字体路径绝对化),继续按
    // CORE_NODE_BUILTIN_FILES 的既有口径放行。
    forbid: 'builtin:node:fs,node:fs/promises',
    reason: 'core 的 pdf 渲染路径不做文件 IO:其两次读(图片路径边界的 realpathSync、'
      + 'KaTeX CSS 读取)经 RenderPdfHtmlOptions.fs 由 main 注入(REF-025 #07),'
      + '故 core/pdf/** 不得直接 import node:fs',
  },
]);

// ---- 规则 no-self-computed-root:项目根的单一来源 ----

/**
 * 全仓唯一允许自算项目根的文件。改它的位置必须同步改这里(两处互为对方的校验)。
 * 它按「自身位于 <root>/shared/」这一固定深度取根,故深度只在这一处出现。
 */
export const ROOT_SOURCE_FILE = 'shared/paths.js';

/**
 * ⚠ 本文件曾有一张 `ROOT_COMPUTE_EXEMPT_FILES` 豁免表(9 条),已按 ADR-040 **整表删除**。
 * 那 9 条全部是「被逐字节复制进沙盒、而沙盒不含 shared/」的脚本,如今 7 处复制点都补了
 * `shared/paths.js`,故它们改为 import 单源,不再需要豁免。
 * 删表后本规则对全仓**零豁免**(门禁自身 `ROOT_COMPUTE_SELF_EXEMPT` 除外,那是规则定义处)。
 * 不要再把豁免表加回来:若某个脚本将来又需要自算根,正确做法是给它所在的沙盒补复制点。
 */

/**
 * 自算项目根的四种写法(逐字匹配源码文本,故门禁与实现无共享代码):
 *   1. url-up         —— 用 URL 构造器在 import.meta.url 上跳一级或多级
 *   2. dirname-resolve —— 同一写法的 import.meta.dirname 形态
 *   3. dirname-chain  —— path.resolve 套 path.dirname 套 fileURLToPath 的连写形态
 *   4. fileurl-up     —— fileURLToPath 取到本文件路径后再手工上跳的变体
 * 覆盖 3/4 是因为它们与 1/2 语义完全相同,却躲过前两条正则 —— 规则若只认字面写法,
 * 等于给出「换个写法就绕过门禁」的提示。
 *
 * 本表刻意不写可读的写法示例:字面示例会被本规则扫到门禁自己(见 ROOT_COMPUTE_SELF_EXEMPT)。
 */
export const ROOT_COMPUTE_PATTERNS = Object.freeze([
  { id: 'url-up', re: /new\s+URL\(\s*(['"])\.\.(?:\/|\\|['"])/ },
  { id: 'dirname-resolve', re: /import\.meta\.dirname\s*,\s*(['"])\.\.(?:\/|\\|['"])/ },
  { id: 'dirname-chain', re: /path\.resolve\(\s*path\.dirname\(\s*fileURLToPath\(\s*import\.meta\.url/ },
  { id: 'fileurl-up', re: /fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)\s*,\s*(['"])\.\.(?:\/|\\|['"])/ },
]);

/**
 * 上跳基准的「origin」表达式:把本文件位置取出来的三种写法。
 * 覆盖 `path.dirname(fileURLToPath(import.meta.url))` / `import.meta.dirname` /
 * `.cjs` 的隐式 `__dirname`(后者没有声明,故由 isCjs 单独特判)。
 */
const ORIGIN_SOURCE = /fileURLToPath\s*\(\s*import\.meta\.url|import\.meta\.dirname|\b__dirname\b/;

/** 声明一个 origin 变量:`const here = …dirname(…)…;`(let/var 同样算) */
const ORIGIN_DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*);/g;

/**
 * 以某个 origin 变量为基准的 path 调用:path.join(here, …) / path.resolve(here, …)。
 * 只抓「origin 紧邻首个实参」这一形态 —— origin 被包一层再传进来不是本规则要管的形态
 * (那属于参数传递而非自算根,判红它只会逼人改函数签名)。
 */
const ORIGIN_BASE_CALL_RE = /path\.(?:join|resolve)\s*\(\s*([A-Za-z_$][\w$]*)\s*(,|[\s)])/g;

/**
 * 纯字面量的多行连写链(无变量):path.join(\n  path.dirname(fileURLToPath(import.meta.url)),\n  '..', …
 * 单独一条是因为它没有 origin 变量可收集,两步法(收变量名 → 查基准)看不见它。
 */
const LITERAL_CHAIN_RE = /path\.(?:join|resolve)\s*\(\s*path\.dirname\s*\(\s*fileURLToPath\s*\(\s*import\.meta\.url\s*\)\s*\)\s*,/g;

/** 单个实参里的上跳段数:`'..'` → 1,`'../../dist'` → 2 */
function countUps(argText) {
  const quoted = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
  let ups = 0;
  for (const m of argText.matchAll(quoted)) {
    for (const seg of (m[2] ?? '').split(/[/\\]/)) if (seg === '..') ups += 1;
  }
  return ups;
}

/** 取 `path.xxx(` 的括号配平范围(跳过引号内的括号),返回实参文本;未配平返回 null */
function callArgs(code, openAt) {
  let depth = 0;
  for (let i = openAt; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipQuoted(code, i) - 1; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(openAt + 1, i);
    }
  }
  return null;
}

/** 该下标是否落在字符串字面量内部(ADR-041 先例:合成夹具串里的写法不是可执行代码) */
function insideString(inString, index) {
  return inString[index] === 1;
}

/**
 * 深度判据的共享实现:origin 基准 / 字面量连写链两类,均要求 `ups === depth`。
 *
 * 语义是「**上跳基准落在仓库根**」,不是「解析结果落在仓库根」:命中的一批里绝大多数
 * 是上跳到根**再下钻**(如 `path.join(here, '..', '..', 'dist', 'main')`),措辞必须
 * 区分这两者,否则下一个人会拿 `../../dist/...` 当反例。
 *
 * `ups >= 1` 是硬守卫:深度 0 的文件(仓库根下的顶层文件)上 `path.join(__dirname, 'x')`
 * 的 ups 与 depth 都是 0,若无此守卫会被判红,而它并没有自算根。
 */
function collectDepthHits({ code, inString, depth, isCjs, origins, literalChain }) {
  /** @type {{ line: number, id: string }[]} */
  const hits = [];
  /** @param {number} index @returns {number} */
  const lineAt = (index) => {
    let line = 1;
    for (let i = 0; i < index && i < code.length; i += 1) if (code.charCodeAt(i) === 10) line += 1;
    return line;
  };

  if (literalChain) {
    for (const m of code.matchAll(LITERAL_CHAIN_RE)) {
      const start = m.index ?? 0;
      if (insideString(inString, start)) continue;
      const args = callArgs(code, code.indexOf('(', start));
      if (args === null) continue;
      const ups = countUps(args);
      if (ups >= 1 && ups === depth) hits.push({ line: lineAt(start), id: 'literal-chain-up' });
    }
  }

  for (const m of code.matchAll(ORIGIN_BASE_CALL_RE)) {
    const start = m.index ?? 0;
    const base = m[1];
    // .cjs 的隐式 __dirname 没有声明句,靠 isCjs 特判收进来(否则这条形态恰好漏掉)
    if (!origins.has(base) && !(isCjs && base === '__dirname')) continue;
    if (insideString(inString, start)) continue;
    const args = callArgs(code, code.indexOf('(', start));
    if (args === null) continue;
    const ups = countUps(args);
    if (ups >= 1 && ups === depth) hits.push({ line: lineAt(start), id: 'origin-base-up' });
  }

  return hits;
}

/** 收集一个文件里的 origin 变量名(声明右侧含 ORIGIN_SOURCE 者) */

/**
 * ⚠ origin 传播**只做一层**:拿已收进来的 origin 变量再赋一次值,不会被收成新 origin,故
 * 「二次赋值」形态不判红 —— `const a = path.join(here,'..'); path.join(a,'..')` 判绿。
 *
 * 唯一的可判红构造是把两跳合并进一次调用(`path.join(here,'..','..')`),故自验须造
 * relPath 深 2 且两跳各 ups1 的文件:同一文件里合并写法判红、二次赋值写法判绿,两者对照
 * 才是这个盲区的完整证据。
 *
 * 有意不补,三条理由:① 传递闭包原型跑遍全树(含 `src/`)的真实代码零活样本,按 ADR-042,
 * 零违规的规则等于拿维护成本换零收益;② 传播会丢掉「中间变量是目录还是文件路径」的语义,
 * 给未来合法代码造假阳性 —— `const a = path.join(here,'..','x')` 里的 a 是**带下钻段的目录**,
 * 其后的 `path.join(a,'..')` 并不落在根,而朴素传播会累计成 ups2 === depth 判红;③ 本仓
 * 不存在「为绕门禁而写两跳」的动机。
 *
 * 将来若要补,先要解决的是中间变量的语义(下钻段该不该从 ups 里扣掉),不是加一行传播。
 */
function collectOrigins(code, inString) {
  const origins = new Set();
  for (const m of code.matchAll(ORIGIN_DECL_RE)) {
    const start = m.index ?? 0;
    if (insideString(inString, start)) continue;
    if (ORIGIN_SOURCE.test(m[2] ?? '')) origins.add(m[1]);
  }
  return origins;
}

/** 文件相对仓库根的深度:`src/main/menu.ts` → 2。供 ups === depth 判据用 */
export function fileDepth(relPath) {
  const slash = relPath.lastIndexOf('/');
  return slash < 0 ? 0 : relPath.slice(0, slash).split('/').length;
}

/**
 * 门禁自身对这条规则的豁免:规则表与自检样例里必然出现被判红的字面写法。
 *
 * 与「沙盒副本豁免」性质不同,这一条豁免的是**规则的定义处**而非某个实现文件 ——
 * 去掉它,门禁会因自己的正则表判红自己,而那既无信息量、也会让人误以为规则坏了。
 */
export const ROOT_COMPUTE_SELF_EXEMPT = 'gates/repo/check-import-boundary.mjs';

/**
 * 扫一个文件里的自算根写法,返回带行号的命中项。
 *
 * 判据只认「自算根」这一语义,不认 import 单源:从 shared/paths.js import ROOT 是正确写法,
 * 同一文件里若另有自算行仍判红(那行本身就是 depth-coupled 的)。
 *
 * ⚠ `options` 是**可选**的,省略时行为与既有四条正则逐字相同 —— 沙盒侧(--src 指向临时目录)
 * 调本函数拿到的必须是同一个答案:那里没有「文件相对仓库根的深度」可言(夹具文件的深度是
 * 夹具自己的,与真实仓库无关),多传一个猜测的 depth 只会让它得到不同的、无人解释的结果。
 * 深度判据只在调用方能给出真实 relPath 时才生效。
 *
 * @param {string} text 源码文本
 * @param {{ relPath?: string }} [options] relPath 为该文件的仓库相对 POSIX 路径;
 *   传了才追加深度判据(origin 基准 / 字面量连写链)
 * @returns {{ line: number, id: string }[]} 命中项(行号从 1 起,按出现序)
 */
export function findRootComputes(text, options = {}) {
  /** @type {Map<number, string>} 行号 → 命中的规则 id(同一行只报一次,取首个命中的) */
  const hits = new Map();
  // 先抹注释再匹配(复用 copy-closure 的 lexSource,等长故行号不变):文档里为了说明
  // 「历史上长这样」而引用的写法不是可执行代码,判红它只会逼人把注释改写得更含糊。
  // inString 一并取用:注释抹了但字符串留着,而合成夹具(test/segments/runner-report.test.js
  // 那类)里的写法是**字符串字面量内部的内容**,判红它必误伤 —— ADR-041 已有同款先例。
  const lexed = lexSource(text);
  const lines = lexed.code.split('\n');
  for (const pattern of ROOT_COMPUTE_PATTERNS) {
    for (let i = 0; i < lines.length; i += 1) {
      if (hits.has(i + 1)) continue;
      if (pattern.re.test(lines[i] ?? '')) hits.set(i + 1, pattern.id);
    }
  }

  // 深度判据:仅在调用方给出真实 relPath 时追加(理由见 @param options)
  if (options.relPath !== undefined) {
    const depth = fileDepth(options.relPath);
    for (const hit of collectDepthHits({
      code: lexed.code,
      inString: lexed.inString,
      depth,
      isCjs: /\.cjs$/.test(options.relPath),
      origins: collectOrigins(lexed.code, lexed.inString),
      literalChain: true,
    })) {
      if (!hits.has(hit.line)) hits.set(hit.line, hit.id);
    }
  }

  return [...hits.entries()]
    .map(([line, id]) => ({ line, id }))
    .sort((a, b) => a.line - b.line);
}

// ---- 源码文本 → import 事实 ----

/**
 * `import/export ... from 'spec'`(含 `import type` 与行内 `type` 说明符)
 *
 * 惰性跨度原为 `[\s\S]*?`(无界、可跨行)。跨行本身是必需的 —— 多行 import 语句
 * (`import {\n a,\n b\n} from 'x'`)必须能匹配,所以不能改成 `[^'"\n]`。
 * 但无界带来了两个代价:
 *   1. 性能:行首锚 `(^|\n)` 使每个行首都成为起点候选,而对**没有 `from`** 的
 *      import/export 行,引擎要一路扫到文件末尾才放弃 ⇒ 单次匹配代价 O(文件剩余长度)。
 *      实测 233 文件 / 3.59MB,`FROM_RE` 的 matchAll 独占 analyzeTreeBoundaries 的 89%。
 *   2. 正确性:跨度能吞掉引号,于是「`import 'side-effect'` 之后的另一条 import」的
 *      `from` 会被接上,或字符串字面量里的伪 import 语句会被当真实 import 命中。
 * 改为 `[^'"]*?` 后两者同时解决:**有效 ES 模块语法在 `import` 关键字与 `from` 之间
 * 不含引号**(specifier 的引号在 `from` 之后),该约束不漏任何真实 import,仍支持跨行。
 *
 * 行为等价性已按门禁真实输入(`lexSource` 抹注释后的 `code`)对全量 233 文件实测:
 * 新增命中 0 处、移除 8 处;其中 6 处为裸 specifier(`electron`/`node:fs`/`jszip`),
 * 本就在 `analyzeTreeBoundaries` 的 `classifySpecifier(...)!=='relative'` 处被过滤,
 * 移除是 no-op;余 2 处是夹具字符串里的伪 import(相对路径但非真实依赖),属原实现的
 * 假阳性。故该改动只减噪、不改判定。
 */
const FROM_RE = /(^|\n)[ \t]*(?:import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
/** 副作用导入 `import 'spec'` */
const SIDE_EFFECT_RE = /(^|\n)[ \t]*import\s+['"]([^'"]+)['"]/g;
/** CJS 产物里的 `require('spec')`(preload.cjs 等 tsc 编译为 CommonJS 的输出) */
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * specifier 归类:node 内建 / 相对路径 / 外部 URL / bare 包名。
 * @returns {{ kind: 'builtin'|'relative'|'external'|'bare', packageName: string|null }}
 */
export function classifySpecifier(spec) {
  if (spec.startsWith('node:')) return { kind: 'builtin', packageName: null };
  if (spec.startsWith('.') || spec.startsWith('/')) return { kind: 'relative', packageName: null };
  if (SCHEME_RE.test(spec)) return { kind: 'external', packageName: null };
  const parts = spec.split('/');
  const packageName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return { kind: 'bare', packageName };
}

/**
 * 该 import 子句是否被编译期擦除。
 * `import type {...} from` 恒为 type-only;`import { type A, type B } from`
 * 也全是 type-only;出现默认绑定/命名空间绑定即视为运行时(保守判红)。
 */
export function isTypeOnlyClause(typeKeyword, clause) {
  if (typeKeyword !== undefined) return true;
  const trimmed = clause.trim();
  if (!trimmed.startsWith('{')) return false;
  const close = trimmed.lastIndexOf('}');
  const inner = trimmed.slice(1, close === -1 ? undefined : close);
  const bindings = inner
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return bindings.length > 0 && bindings.every((part) => part === 'type' || part.startsWith('type '));
}

/** 递归列出 root 下指定扩展名的文件(相对 root 的 POSIX 路径,已排序) */
export function listSourceFiles(root, extensions) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (extensions.includes(path.extname(entry.name))) out.push(abs);
    }
  };
  walk(root);
  return out
    .map((abs) => ({ abs, file: path.relative(root, abs).split(path.sep).join('/') }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * 抽取一个文件里的全部 import 事实。
 * `cjs` 为真时额外抽 require()(编译产物是 CommonJS);产物里已无 type-only 痕迹。
 */
export function collectImports(absPath, { cjs = false } = {}) {
  const text = readFileSync(absPath, 'utf8');
  const found = new Map();
  const add = (spec, typeOnly) => {
    const key = `${spec}\u0000${String(typeOnly)}`;
    if (!found.has(key)) found.set(key, { spec, typeOnly });
  };
  for (const m of text.matchAll(FROM_RE)) add(m[4], isTypeOnlyClause(m[2], m[3]));
  for (const m of text.matchAll(SIDE_EFFECT_RE)) add(m[2], false);
  if (cjs) for (const m of text.matchAll(REQUIRE_RE)) add(m[1], false);
  return [...found.values()].map((entry) => ({ ...entry, ...classifySpecifier(entry.spec) }));
}

/**
 * 去掉扩展名:白名单按「与形态无关的路径」书写,同一份 core 内建白名单才能同时
 * 约束 src 源(.ts)与其编译产物(.js),不必在两处各维护一份文件名。
 */
export function stripExtension(file) {
  return file.slice(0, file.length - path.posix.extname(file).length);
}

/** 该文件是否在 core 的 node: 内建白名单内(按去扩展名的路径比较) */
export function isCoreBuiltinAllowed(file) {
  const key = stripExtension(file);
  return CORE_NODE_BUILTIN_FILES.some((allowed) => stripExtension(allowed) === key);
}

/** 相对 specifier 解析到「层」:core / main / renderer / 其它(取首段目录名) */
export function resolveLayer(file, spec) {
  const dir = path.posix.dirname(file);
  const joined = path.posix.normalize(path.posix.join(dir, spec));
  return joined.split('/')[0];
}

function scopeMatches(scope, file) {
  if (scope === 'preload') return file === 'main/preload.cts' || file === 'main/preload.cjs';
  // smoke 住在 main/ 下但按「文件」而非「目录」划层:它不是 main 的一个子模块,而是
  // 随包分发的自测入口(build.files 只收 dist/**),边界纪律独立于 main 的一般约束
  if (scope === 'smoke') return file === 'main/smoke.ts' || file === 'main/smoke.js';
  // renderer 的基础层:scope 按 src 顶层目录匹配(core/main/renderer),而这两处在
  // renderer/ 之下,故单列一个 scope 形态
  if (scope === 'renderer-foundation') {
    return file.startsWith('renderer/dom/') || file.startsWith('renderer/state/');
  }
  // core 的 pdf 子树:scope 按 src 顶层目录匹配,故 core/pdf/** 需单列形态
  if (scope === 'core-pdf') return file.startsWith('core/pdf/');
  return file === scope || file.startsWith(`${scope}/`);
}

/** 规则是否命中这条 import */
function ruleHits(rule, entry) {
  if (rule.forbid.startsWith('bare:')) {
    const name = rule.forbid.slice('bare:'.length);
    return entry.kind === 'bare' && entry.packageName === name;
  }
  if (rule.forbid.startsWith('layer:')) {
    if (entry.kind !== 'relative') return false;
    const layers = rule.forbid.slice('layer:'.length).split(',');
    return layers.includes(resolveLayer(entry.file, entry.spec));
  }
  if (rule.forbid.startsWith('prefix:')) {
    // 逗号分隔的多个前缀(与 layer: 的列表约定一致)。单前缀是它的退化情形,行为不变。
    // 之所以需要列表:resolveLayer 返回的是**顶层**目录(renderer 内部路径的首段恒为
    // renderer),故 layer: 形态表达不了 renderer 内部的边 —— 要约束 renderer 内部的
    // 方向只能用相对说明符前缀,而一个方向往往要同时禁多个目标目录。
    if (entry.kind !== 'relative') return false;
    const prefixes = rule.forbid.slice('prefix:'.length).split(',').map((p) => p.trim()).filter(Boolean);
    return prefixes.some((p) => entry.spec.startsWith(p));
  }
  if (rule.forbid.startsWith('builtin:')) {
    // node: 内建的精确名单(逗号分隔)。需要它是因为 classifySpecifier 把 node:*
    // 归为 kind 'builtin' 而非 'bare',故 bare: 形态匹配不到 —— 而我们需要的正是
    // **按能力** 区分:core/pdf 里 node:path/node:url 纯字符串运算可以放行(见
    // CORE_NODE_BUILTIN_FILES),node:fs 却是真 IO,故要单独一条规则禁。
    if (entry.kind !== 'builtin') return false;
    const names = rule.forbid.slice('builtin:'.length).split(',').map((p) => p.trim()).filter(Boolean);
    return names.includes(entry.spec);
  }
  throw new Error(`未知的层向规则形态:${rule.forbid}`);
}

/**
 * 边界判定。返回 { problems, info };info 只作提示(未使用声明),
 * 不参与 exit code。
 * @param root 被扫描源码子树
 * @param pkg package.json 解析结果
 * @param options { extensions, cjs, typeOnlyAware }
 */
export function analyze(
  root,
  pkg,
  { extensions = ['.ts', '.cts'], cjs = false, typeOnlyAware = true } = {},
) {
  const problems = [];
  const info = [];
  const runtimeUsed = new Set();
  const typeOnlyUsed = new Set();

  for (const { abs, file } of listSourceFiles(root, extensions)) {
    // 规则 no-self-computed-root:与 import 无关,按文件判一次(它看的是路径表达式而非 import)
    for (const hit of findRootComputes(readFileSync(abs, 'utf8'))) {
      problems.push(
        `${file}:${hit.line} 自算项目根(${hit.id})—— 项目根的单一来源是 ${ROOT_SOURCE_FILE},`
          + '请 import 它;按目录层级上跳的写法在目录改层级时会静默指错位置,而门禁查不出这种错',
      );
    }
    for (const found of collectImports(abs, { cjs })) {
      const entry = { ...found, file };
      if (entry.kind === 'bare' && entry.packageName !== null) {
        const name = entry.packageName;
        const inProd = Object.hasOwn(pkg.dependencies ?? {}, name);
        const inDev = Object.hasOwn(pkg.devDependencies ?? {}, name);
        if (entry.typeOnly) {
          typeOnlyUsed.add(name);
          // 类型由 @types/* 或任意已声明包提供即可,不必是运行时依赖
          if (!inProd && !inDev && !Object.hasOwn(pkg.devDependencies ?? {}, `@types/${name}`)) {
            problems.push(
              `${file}:type-only import「${name}」既不在 dependencies/devDependencies,也无 devDependencies 的 @types/${name} 提供`,
            );
          }
        } else {
          runtimeUsed.add(name);
          // 宿主内建模块豁免的是「必须在 dependencies」这一条,不是豁免层向规则:
          // core import electron 仍须由 core-no-host 拦下(不能用 continue 跳到下一条 import)。
          const hostProvided = Object.hasOwn(HOST_PROVIDED_RUNTIME, name);
          if (hostProvided) {
            if (inProd) {
              problems.push(
                `${file}:宿主内建模块「${name}」不应声明为 dependencies(它不随包分发,声明会误导 electron-builder 去打包)`,
              );
            }
          } else if (inDev && !inProd) {
            problems.push(
              `${file}:运行时 import「${name}」只在 devDependencies 中声明 —— 生产安装会缺件,须移入 dependencies`,
            );
          } else if (!inProd) {
            problems.push(`${file}:运行时 import「${name}」未在任何依赖段声明(当前靠传递依赖偶然就位)`);
          }
        }
      }

      // core 的 node: 内建模块面:白名单逐文件,其余一律判红(两侧都去扩展名比较)
      if (entry.kind === 'builtin' && file.startsWith('core/') && !isCoreBuiltinAllowed(file)) {
        problems.push(
          `${file}:core 侧 import「${entry.spec}」不在内建白名单内(白名单仅 ${CORE_NODE_BUILTIN_FILES.join('、')});`
            + 'core 触碰宿主能力须先评估能否下沉为入参',
        );
      }

      for (const rule of LAYER_RULES) {
        if (!scopeMatches(rule.scope, file)) continue;
        if (!ruleHits(rule, entry)) continue;
        const kindText = entry.typeOnly ? 'type-only ' : '';
        problems.push(
          `${file}:${kindText}import「${entry.spec}」违反层向规则 ${rule.id} —— ${rule.reason}`,
        );
      }
    }
  }

  // 未使用声明只在能看见 type-only 关系的形态(src)下报:产物里类型引用已被
  // 编译期擦除,micromark-util-types / unified 这类纯类型依赖在 dist 侧永远
  // 「未被 import」,照报就是纯噪声。
  if (typeOnlyAware) {
    for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
      if (runtimeUsed.has(name) || typeOnlyUsed.has(name)) continue;
      const reason = RESOURCE_ONLY_DEPENDENCIES[name];
      info.push(
        reason === undefined
          ? `未使用声明:dependencies「${name}」在被扫描源码中无任何 import`
          : `未使用声明:dependencies「${name}」不经 import(已登记:${reason})`,
      );
    }
  }

  return { problems, info };
}

/**
 * 规则 no-self-computed-root 的扫描面:仓库里会执行代码的三个子树。
 *
 * 刻意独立于 --src/--flavor:那条参数管的是「被编译的产物形态」,而自算根是**源码布局**问题,
 * 在 src 侧根本不存在(TS 产物里 import.meta.url 已被擦除)。故本扫描固定锚在真实仓库上,
 * 沙盒调用(--src 指向临时目录)也照跑 —— 判的是本仓纪律,不是夹具内容。
 */
export const ROOT_COMPUTE_SCAN_DIRS = Object.freeze(['gates', 'build', 'dev', 'test', 'shared']);

/** 参与本扫描的扩展名(与门禁自身所在树一致) */
const ROOT_COMPUTE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs']);

/**
 * 全仓扫描结果的进程内记忆化(按 root 分键)。
 *
 * 起因:`main()` 除 `--src` 目标外,还会无条件做三次**固定锚在真实仓库**的全仓扫描
 * (`analyzeRootComputes` / `selfCheckRootComputes` / `analyzeTreeBoundaries`),
 * 每次重读 ROOT_COMPUTE_SCAN_DIRS 与 TREE_SCAN_DIRS 下的全部源文件(实测 233 文件 / 3.59MB)。
 * 门禁每进程只跑一次 `main()`,这些扫描各只一次;但验收段 `import-boundary.test.js` 的
 * 25 次 `runCli` 会各跑一遍 —— 25 × 约 3.2s ≈ 80s,占该段 84.6s 的 99%(其余断言合计 <1s)。
 *
 * **分键必须是 root 绝对路径**:同一进程里 `analyzeTreeBoundaries` 还会被验收段以 6 个
 * 不同沙盒目录为 root 调用(`import-boundary.test.js` 第 7 组),沙盒各有独立 mkdtemp 路径,
 * 按 root 分键即可各扫各的、互不串味;无 key 的话会命中错误的缓存结果。
 *
 * **生效前提:两次调用之间 root 下的文件未被改动。** 逐条核对当前调用方均满足:
 *   - 门禁自身:单进程一次 `main()`,期间只读;
 *   - 验收段:25 次 `runCli` 的沙盒一律 `fs.mkdtempSync(os.tmpdir())`,写入只落沙盒,
 *     仓库不被触碰;第 7 组的 6 个沙盒各自写入后**只调用一次**。
 * 若将来出现「先扫 → 改 root 下文件 → 再扫」的调用方,必须先调 `resetScanCache()`
 * (缓存只按 root 分键,分不出内容是否变过)。
 */
const scanCache = new Map();

/** 清空全仓扫描缓存。调用方若在两次扫描之间改动过 root 下的文件,必须先调它。 */
export function resetScanCache() {
  scanCache.clear();
}

/**
 * 按 root 记忆化的全仓扫描包装。
 * @template T
 * @param {string} kind 缓存用途标签(仅供排查时辨识)
 * @param {string} root 仓库根绝对路径(分键)
 * @param {() => T} run 真正的扫描动作
 * @returns {T}
 */
function memoizedByRoot(kind, root, run) {
  const key = kind + "\u0001" + path.resolve(root);
  const hit = scanCache.get(key);
  if (hit !== undefined) return /** @type {T} */ (hit);
  const value = run();
  scanCache.set(key, value);
  return value;
}

/**
 * 扫三个子树的全部源文件,返回自算项目根的判红清单(已扣除单源与规则定义处两处豁免)。
 * @param {string} root 仓库根绝对路径
 * @returns {string[]} 判红文案(每条含仓库相对路径与行号)
 */
export function analyzeRootComputes(root) {
  return memoizedByRoot("root-computes", root, () => analyzeRootComputesUncached(root));
}

/** `analyzeRootComputes` 的未记忆化本体(见上方 scanCache 的生效前提)。 */
function analyzeRootComputesUncached(root) {
  const problems = [];
  for (const dir of ROOT_COMPUTE_SCAN_DIRS) {
    const abs = path.resolve(root, dir);
    if (!existsSync(abs)) continue;
    for (const { abs: fileAbs, file } of listSourceFiles(abs, ROOT_COMPUTE_EXTENSIONS)) {
      const rel = `${dir}/${file}`;
      // 单源自身:算自算是它的职责,豁免
      if (rel === ROOT_SOURCE_FILE) continue;
      // 规则定义处:正则表与自检样例含字面写法,豁免(理由见 ROOT_COMPUTE_SELF_EXEMPT)
      if (rel === ROOT_COMPUTE_SELF_EXEMPT) continue;
      for (const hit of findRootComputes(readFileSync(fileAbs, 'utf8'), { relPath: rel })) {
        problems.push(
          `${rel}:${hit.line} 自算项目根(${hit.id})—— 上跳基准落在仓库根,而项目根的单一来源是 ${ROOT_SOURCE_FILE},`
            + '请 import 它;按目录层级上跳的写法在目录改层级时会静默指错位置,而门禁查不出这种错',
        );
      }
    }
  }
  return problems;
}

/**
 * 规则 no-self-computed-root 的自检(纯判定层,不碰真实仓库之外的东西)。
 *
 * 为何需要:一条「按正则扫文本」的规则最危险的失效形态是**恒绿**(写错却什么都不报)。
 * 故此处在门禁自身的运行里固定两个方向的锚点 —— 造出自算样例必须命中、已收口的真实代码
 * 必须不命中 —— 任一方向失守即 exit 1。样例是内联字符串,不落盘、不进版本控制。
 *
 * 放在门禁本体而非测试段:test/segments/import-boundary.test.js 不在本泳道的可写范围,
 * 而没有自检的规则等于没有规则。
 * @param {string} root 仓库根绝对路径
 * @returns {string[]} 自检问题清单(空数组 = 两个方向都符合预期)
 */
export function selfCheckRootComputes(root) {
  const problems = [];
  // 造坏样例:四种语法形态各一,外加若干「该判绿」的对照。
  // 样例是 (relPath, text) 形式 —— relPath 不是装饰:深度判据要靠它算 ups === depth,
  // 只给文本不给路径的话深度恒为 0,深度判据就成了恒绿(正是本函数要防的失效形态)。
  // depth 与 ups 必须相等才判红,故坏样例的 relPath 深度与上跳数逐条对齐。
  const cases = [
    // ---- 形态一:链式单表达式(既有四条正则,不依赖 depth)----
    { name: 'new URL 上跳', relPath: 'gates/x.mjs', text: "const r = fileURLToPath(new URL('..', import.meta.url));\n", expect: 1 },
    { name: 'new URL 两级上跳', relPath: 'gates/x.mjs', text: 'const r = fileURLToPath(new URL("../..", import.meta.url));\n', expect: 1 },
    { name: 'dirname + resolve', relPath: 'gates/x.mjs', text: "const r = path.resolve(import.meta.dirname, '..');\n", expect: 1 },
    { name: 'dirname 连写链', relPath: 'gates/x.mjs', text: 'const r = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");\n', expect: 1 },
    { name: 'fileURLToPath 变体', relPath: 'gates/x.mjs', text: 'const r = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../x");\n', expect: 1 },
    // ---- 形态二:两语句式(origin 存进变量再上跳;depth 2 → ups 2)----
    {
      name: '两语句式(变量中转)',
      relPath: 'test/main/x.test.js',
      text: 'const here = path.dirname(fileURLToPath(import.meta.url));\n'
        + 'const root = path.resolve(here, "..", "..");\n',
      expect: 1,
    },
    // ---- 形态三:多行连写链、无变量(纯字面量正则;depth 2 → ups 2)----
    {
      name: '多行连写链(无变量)',
      relPath: 'test/main/x.test.js',
      text: 'const distMain = path.join(\n'
        + '  path.dirname(fileURLToPath(import.meta.url)),\n'
        + '  "..",\n'
        + '  "..",\n'
        + '  "dist",\n'
        + '  "main",\n'
        + ');\n',
      expect: 1,
    },
    // ---- 形态四:.cjs 隐式 __dirname(无声明句,靠 isCjs 特判;depth 1 → ups 1)----
    {
      name: '.cjs 隐式 __dirname',
      relPath: 'dev/x.cjs',
      text: 'const out = path.resolve(__dirname, "..", "out");\n',
      expect: 1,
    },
    // ---- 判绿对照 ----
    {
      name: '已收口写法(应判绿)',
      relPath: 'test/main/x.test.js',
      text: "import { ROOT } from '../common/paths.js';\nconst r = ROOT;\n",
      expect: 0,
    },
    {
      // ups !== depth:上跳落在 src/ 内而非仓库根,不是本规则要管的形态(ADR-040 只管根)
      name: 'ups 不等于 depth(落在包内,应判绿)',
      relPath: 'src/main/windows/x.ts',
      text: 'const here = path.dirname(fileURLToPath(import.meta.url));\n'
        + 'const p = path.resolve(here, "..", "preload.cjs");\n',
      expect: 0,
    },
    {
      // ups >= 1 守卫:深度 0 的顶层文件上,origin 变量被用作 path 基准但不带任何 ".."。
      // origin 必须是**声明出来的**那个变量(此处 .mjs 无隐式 __dirname,否则 collectOrigins
      // 收不到它,本夹具会因「基准压根不存在」而恒绿 —— 测不到 ups>=1 这一分支)。
      // 去掉守卫后 ups(0) === depth(0) 成立 → 变红,故本夹具对守卫有牙齿。
      name: '深度 0 且 ups 0(应判绿)',
      relPath: 'x.mjs',
      text: 'const here = path.dirname(fileURLToPath(import.meta.url));\n'
        + 'const p = path.join(here, "x");\n',
      expect: 0,
    },
    {
      // 字符串遮罩:合成夹具串里的写法不是可执行代码(ADR-041 先例)。
      // 两个刻意的写法约束,少任一条本夹具就恒绿且无牙齿(两次都实测踩到):
      // ① 不用 `const f = [ ... ]` 包裹 —— ORIGIN_DECL_RE 的 `[^;]*` 会从外层声明一路吞到
      //    串内第一个分号,把内层 origin 声明整个吞掉,collectOrigins 收不到它;
      //    改用 push 到已声明数组,每行独立成句,串内声明能被正则独立匹配。
      // ② 外层串用单引号、内层 ".." 用双引号 —— 若外层是双引号则内层须写成 \"..\",
      //    而 callArgs 的括号配平按词法跳过引号,遇到 \" 这种转义引号会算错配平范围,
      //    切出的实参不完整 → countUps 少数一个 → ups !== depth 恒不成立(实测 countUps 得 1)。
      // 去掉遮罩后 ups(2) === depth(2) 成立 → 变红,故本夹具对遮罩有牙齿。
      name: '字符串字面量内的写法(应判绿)',
      relPath: 'test/segments/x.test.js',
      text: 'const lines = [];\n'
        + 'lines.push(\'const sandbox = path.dirname(fileURLToPath(import.meta.url));\');\n'
        + 'lines.push(\'const root = path.resolve(sandbox, "..", "..", "dist");\');\n',
      expect: 0,
    },
  ];
  for (const testCase of cases) {
    const hits = findRootComputes(testCase.text, { relPath: testCase.relPath });
    if (hits.length !== testCase.expect) {
      problems.push(
        `自算根规则自检失守「${testCase.name}」:期望命中 ${testCase.expect} 处,实际 ${hits.length} 处`
        + `(规则恒绿或恒红都是失效)`,
      );
    }
  }
  // 反向锚点:真实仓库当前必须零命中(证明规则没把已收口的代码误判红)
  const real = analyzeRootComputes(root);
  if (real.length > 0) {
    problems.push(`自算根规则自检失守:真实仓库应零自算写法,实际 ${real.length} 处:${real.slice(0, 3).join(' | ')}`);
  }
  // 两处豁免的存在性:单源与规则定义处。拼错路径会让豁免静默失效(规则恒红)或
  // 恒绿(豁免了不该豁免的文件),两种都是失效,故在此钉住。
  // ADR-040 删表后不再有「沙盒副本豁免」,故此处只校验这两处。
  for (const [rel, what] of [[ROOT_SOURCE_FILE, '项目根单源'], [ROOT_COMPUTE_SELF_EXEMPT, '规则定义处']]) {
    if (!existsSync(path.resolve(root, rel))) {
      problems.push(`自算根规则自检失守:${what}不存在:${rel}(豁免将静默失效)`);
    }
  }
  return problems;
}

// ===== 树边界规则(ADR-038 / ADR-043)=====

/**
 * 逻辑树名 → 实际目录名。规则表按**逻辑名**书写、判定时才换实际目录名,
 * 树改名(逻辑名 gates ↔ 实际目录名)只改这一行,避免改名漏改诊断文案里的路径。
 * @type {Readonly<Record<string, string>>}
 */
export const TREE_DIRS = Object.freeze({ gates: 'gates', test: 'test', shared: 'shared' });

/**
 * 允许面里可用、但**没有对应顶层目录规则**的字面前缀。
 *
 * `dist` 是编译产物目录;`build` / `dev` 是门禁树按断言域分列出去的两棵产物生产树
 * (不 assert 任何东西,故不建边界规则)—— 它们与 `dist` 同形:**被引用,不治理**。
 * 登记在此而不是给它们各写一条规则:那两条规则的允许面会与 `test-stay-in-test`
 * 逐字重复,而「不被治理」正是它们当前的定位(REO-110 泳道 #07 的目标形态)。
 */
export const TREE_BOUNDARY_LITERAL_PREFIXES = Object.freeze(['dist', 'build', 'dev']);

/**
 * 树边界规则表,判据形态是 **allow-list**(允许面之外一律判红),
 * 与 LAYER_RULES 的 deny-list 语义相反,故分表不合并 —— 同一张表里放两种
 * 语义相反的判据会产生读法歧义。
 *
 * 为什么必须是 allow-list:deny-list 要逐个枚举 test/ 下的子目录,而新增任何
 * 子目录都不在枚举内 —— 那就退化成一次「枚举已知」,新目录静默放行。allow-list
 * 让新目标默认非法,无需登记即被拦。
 */
export const TREE_RULES = Object.freeze([
  {
    id: 'gates-stay-in-gates',
    scope: 'gates',
    reason: '门禁树只许引用门禁树自身、共享机制层,以及测试树的夹具数据(只读)',
    allow: Object.freeze(['gates', 'shared', 'test/fixtures']),
  },
  {
    id: 'test-stay-in-test',
    scope: 'test',
    reason: '测试树可引编译产物(dist)、产物生产树(build/dev)、共享机制层,以及门禁树的驱动器级纯静态函数',
    allow: Object.freeze(['test', 'dist', 'build', 'dev', 'shared', 'gates']),
  },
  {
    id: 'shared-no-out-edge',
    scope: 'shared',
    reason: '共享机制层的「零出边」精确为**零跨树出边**:树内互依与 node: 内建放行',
    allow: Object.freeze(['shared']),
  },
]);

const TREE_SCAN_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs']);

/**
 * 把允许面元素(逻辑树名)解析成实际的仓库相对前缀。
 * 首段是已登记树名则换成实际目录名,否则按字面前缀处理。
 * @param {string} element 允许面元素,如 'gates' / 'test/fixtures' / 'dist'
 * @returns {string} 实际的仓库相对 POSIX 前缀
 */
function resolveAllowedPrefix(element) {
  const segments = element.split('/');
  const [head, ...rest] = segments;
  const actualHead = Object.hasOwn(TREE_DIRS, head) ? TREE_DIRS[head] : head;
  return [actualHead, ...rest].join('/');
}

/**
 * 抽一个文件里全部**相对说明符** import 及其行号。
 * 复用既有三条正则,另用 `d` 标志取捕获组的精确下标换算行号 —— 不用 indexOf
 * 反推:文档字符串里含相同引号字符时 indexOf 会算错位置,而那恰是要处理的形态。
 * 多行 import(`import {\n a\n} from 'x'`)的行号取 from 那一行,故按 spec 位置算。
 * @param {string} text 已抹注释的源码文本
 * @returns {{ spec: string, line: number }[]}
 */
function collectRelativeImportsWithLine(text) {
  /** @param {number} index 字符下标 → 行号(从 1 起) */
  const lineAt = (index) => {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) line += 1;
    }
    return line;
  };
  /** @type {{ spec: string, line: number }[]} */
  const out = [];
  /** @param {RegExp} re @param {number} groupIndex 捕获组号 */
  const scan = (re, groupIndex) => {
    // 只剥 sticky(y 会把扫描锚在 lastIndex 上,与整段扫描不符);保留 g —— matchAll 要求它
    const withIndex = new RegExp(re.source, `${re.flags.replace(/y/g, '')}d`);
    for (const match of text.matchAll(withIndex)) {
      const range = match.indices[groupIndex];
      if (range == null) continue;
      out.push({ spec: match[groupIndex], line: lineAt(range[0]) });
    }
  };
  scan(FROM_RE, 4);
  scan(SIDE_EFFECT_RE, 2);
  scan(REQUIRE_RE, 1);
  return out;
}

/**
 * 扫三棵树的跨树 import,返回判红项。
 *
 * 喂 `lexSource(...).code`(已抹注释):文档/注释里为说明「历史上长这样」而写的
 * specifier 不是可执行依赖,判红它只会逼人把注释改写得更含糊。cjs 一并覆盖,
 * 免得 .cjs 的 require() 走另一条判据。
 * @param {string} root 被扫描仓库的根(锚在 --package 所在仓库,见 main)
 * @returns {string[]} 判红项(空数组 = 通过)
 */
export function analyzeTreeBoundaries(root) {
  return memoizedByRoot("tree-boundaries", root, () => analyzeTreeBoundariesUncached(root));
}

/** `analyzeTreeBoundaries` 的未记忆化本体(见上方 scanCache 的生效前提)。 */
function analyzeTreeBoundariesUncached(root) {
  /** @type {string[]} */
  const problems = [];
  for (const rule of TREE_RULES) {
    const scopeDir = TREE_DIRS[rule.scope];
    const scopeRoot = path.join(root, scopeDir);
    if (!existsSync(scopeRoot)) continue;
    const allowed = rule.allow.map(resolveAllowedPrefix);
    for (const { abs, file } of listSourceFiles(scopeRoot, TREE_SCAN_EXTENSIONS)) {
      const relPath = `${scopeDir}/${file}`;
      const { code } = lexSource(readFileSync(abs, 'utf8'));
      for (const { spec, line } of collectRelativeImportsWithLine(code)) {
        if (classifySpecifier(spec).kind !== 'relative') continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), spec));
        // 按**路径段**比而非 startsWith:否则 test/fixtures-old/ 会被 test/fixtures 放行
        const ok = allowed.some((prefix) => target === prefix || target.startsWith(`${prefix}/`));
        if (ok) continue;
        problems.push(
          `${relPath}:${line}:import「${spec}」(解析为 ${target})越出 ${scopeDir}/ 的允许面`
            + `(只许 ${allowed.join('、')});违反树边界规则 ${rule.id}`,
        );
      }
    }
  }
  return problems;
}

/**
 * 树边界规则的存在性自检:「扫不到就等于没规则」是这类判据最危险的失效形态,
 * 故每次 check:boundary 都验三棵树齐备、规则表覆盖完整、允许元素的首段不是拼错的树名。
 * @param {string} root 被扫描仓库的根
 * @returns {string[]} 自检问题(空数组 = 通过)
 */
export function selfCheckTreeLayout(root) {
  /** @type {string[]} */
  const problems = [];
  const known = [...Object.keys(TREE_DIRS), ...TREE_BOUNDARY_LITERAL_PREFIXES];
  for (const rule of TREE_RULES) {
    const scopeDir = TREE_DIRS[rule.scope];
    if (!existsSync(path.join(root, scopeDir))) {
      problems.push(`树边界规则自检失守:${rule.id} 的 scope 目录不存在:${scopeDir}/(规则形同虚设)`);
    }
    for (const element of rule.allow) {
      const head = element.split('/')[0] ?? '';
      if (!known.includes(head)) {
        problems.push(
          `树边界规则自检失守:${rule.id} 的允许元素「${element}」首段既不是已登记树名`
            + `(${Object.keys(TREE_DIRS).join('/')})也不是字面前缀(${TREE_BOUNDARY_LITERAL_PREFIXES.join('/')})`
            + '—— 拼错的树名会退化成字面量、整条规则恒绿',
        );
      }
    }
  }
  return problems;
}

export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['help'], values: ['src', 'package', 'flavor'] });
  } catch (error) {
    console.error(`[boundary:fail] ${error.message}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const flavor = options.flavor ?? 'src';
  if (!Object.hasOwn(FLAVORS, flavor)) {
    console.error(`[boundary:fail] 未知形态:${flavor}(只接受 ${Object.keys(FLAVORS).join('/')})`);
    return 1;
  }

  const root = path.resolve(projectRoot, options.src ?? 'src');
  const pkgPath = path.resolve(projectRoot, options.package ?? 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    console.error(`[boundary:fail] 依赖声明不可读:${pkgPath}(${error.message})`);
    return 1;
  }

  let result;
  try {
    result = analyze(root, pkg, FLAVORS[flavor]);
  } catch (error) {
    console.error(`[boundary:fail] 扫描失败:${error.message}`);
    return 1;
  }
  // 规则 no-self-computed-root:固定锚在真实仓库,与 --src/--flavor 无关(理由见 ROOT_COMPUTE_SCAN_DIRS)
  let rootComputeProblems;
  try {
    rootComputeProblems = analyzeRootComputes(projectRoot);
    const selfCheckProblems = selfCheckRootComputes(projectRoot);
    if (selfCheckProblems.length > 0) {
      for (const problem of selfCheckProblems) console.error(`[boundary:fail] ${problem}`);
      return 1;
    }
  } catch (error) {
    console.error(`[boundary:fail] 项目根单源扫描失败:${error.message}`);
    return 1;
  }
  // 规则 gates-stay-in-gates / test-stay-in-test / shared-no-out-edge:与 --src/--flavor 无关,
  // 固定锚在真实仓库(理由同 ROOT_COMPUTE_SCAN_DIRS):树边界守的是**本仓的三棵树**,
  // 而 --src/--package 描述的是「某个子树的某次局部扫描」—— 沙盒只铺 src/ 一棵树,
  // 让它参与树边界判定会因「缺 test/ 与 shared/」而恒红,反而掩盖 src 层的真实诊断。
  let treeBoundaryProblems;
  try {
    treeBoundaryProblems = analyzeTreeBoundaries(projectRoot);
    const layoutProblems = selfCheckTreeLayout(projectRoot);
    if (layoutProblems.length > 0) {
      for (const problem of layoutProblems) console.error(`[boundary:fail] ${problem}`);
      return 1;
    }
  } catch (error) {
    console.error(`[boundary:fail] 树边界扫描失败:${error.message}`);
    return 1;
  }
  for (const line of result.info) console.log(`[info] boundary:${line}`);
  const allProblems = [...result.problems, ...rootComputeProblems, ...treeBoundaryProblems];
  if (allProblems.length > 0) {
    for (const problem of allProblems) console.error(`[boundary:fail] ${problem}`);
    console.error(`[boundary:fail] 依赖声明与 import 层向自检失败,共 ${allProblems.length} 项`);
    return 1;
  }
  const scopeText = flavor === 'src' ? 'src' : 'dist 产物';
  console.log(
    `[ok] import 边界自检通过(${scopeText}):`
      + `运行时 import 的包均在 dependencies(host 内建 ${Object.keys(HOST_PROVIDED_RUNTIME).join('/')} 除外);`
      + `core 不依赖宿主且不反向依赖 GUI 两层;renderer 不反向依赖 main;main 不反向依赖 renderer;preload 不上跳引用 main;`
      + `smoke 不逃出 src/;`
      + `renderer 基础层(dom/state)不反向依赖功能目录;`
      + `core 的 pdf 渲染路径不 import node:fs(能力经入参注入);`
      + `core 的 node: 内建白名单限 ${CORE_NODE_BUILTIN_FILES.length} 个文件;`
      + `项目根单源为 ${ROOT_SOURCE_FILE}(零豁免,ADR-040);`
      + `树边界(ADR-038/043)按实际目录名:`
      + TREE_RULES.map((rule) => `${TREE_DIRS[rule.scope]}→${rule.allow.map(resolveAllowedPrefix).join('/')}`).join(';'),
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
