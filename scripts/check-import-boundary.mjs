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
//   node scripts/check-import-boundary.mjs [--src <dir>] [--package <file>] [--flavor src|dist]
//
//   --src      被扫描的源码子树(默认 src)
//   --package  依赖声明来源(默认 package.json)
//   --flavor   源码形态:src = TS 源(默认);dist = tsc 产物(ESM + CommonJS 混编,
//              type-only 已被编译期擦除,故产物侧一律按运行时判定)
//
// 源码子树(--src)与依赖声明(--package)分开指定:编译产物(dist/)与仓库根的
// package.json 是一对,但两者不同层;合成一个根目录参数会逼着脚本去猜声明在哪。

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, parseArgs } from './check-dist-manifest.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const USAGE =
  '用法: node scripts/check-import-boundary.mjs [--src <dir>] [--package <file>] [--flavor src|dist]';

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
 * 逐个列文件而不是放行「某一组模块」:这四个文件各自因具体原因需要
 * 文件系统/URL 能力(合并目录探测、KaTeX css 落盘解析、预检 realpath、
 * pdf 图片 file:// 解析),新增一个即代表 core 又漏了宿主依赖面。
 * 书写 .ts 源文件名,匹配时按去扩展名比较(见 stripExtension),使同一份白名单
 * 同时约束 src 源与其编译产物 dist/*.js。
 */
export const CORE_NODE_BUILTIN_FILES = Object.freeze([
  'core/markdown/precheck.ts',
  'core/pdf/katex-css.ts',
  'core/pdf/rules/image.ts',
  'core/pipeline/merge.ts',
]);

/**
 * type-only 反向依赖放行表(精确到 文件 × specifier × 仅 type-only)。
 * 命中的违规不判红;条目失效(该 import 已不存在)也不判红,只在输出里记一笔,
 * 便于择机删除,而不是让门禁反过来逼着人保留一条注释。
 */
export const REVERSE_TYPE_ALLOWLIST = Object.freeze([
  {
    file: 'renderer/renderer.ts',
    spec: '../main/preload.cjs',
    note: 'OPT-5.1 收口项:window.api 的类型单源在 preload(见 src/main/preload.cts 头注),'
      + 'renderer 经 import type 取 PreloadApi 推导全局声明;编译期擦除,产物无此依赖。'
      + '收口方向:把 PreloadApi 抽到 core 侧共享契约模块,renderer 与 preload 同源引用。',
  },
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
]);

// ---- 源码文本 → import 事实 ----

/** `import/export ... from 'spec'`(含 `import type` 与行内 `type` 说明符) */
const FROM_RE = /(^|\n)[ \t]*(?:import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
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
    return entry.kind === 'relative' && entry.spec.startsWith(rule.forbid.slice('prefix:'.length));
  }
  throw new Error(`未知的层向规则形态:${rule.forbid}`);
}

/**
 * 边界判定。返回 { problems, info };info 只作提示(未使用声明、已失效的放行条目),
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
  const allowlistUsed = new Set(REVERSE_TYPE_ALLOWLIST.map(() => false));

  for (const { abs, file } of listSourceFiles(root, extensions)) {
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
        // 放行表按去扩展名匹配文件:改扩展名(.ts → .mts)不该让门禁误判红,
        // 真正的收口动作(删掉这条 import)才会让条目自然失效。
        const allowIndex = REVERSE_TYPE_ALLOWLIST.findIndex(
          (item) => stripExtension(item.file) === stripExtension(file) && item.spec === entry.spec,
        );
        if (allowIndex !== -1 && entry.typeOnly) {
          allowlistUsed[allowIndex] = true;
          continue;
        }
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

    REVERSE_TYPE_ALLOWLIST.forEach((item, index) => {
      if (!allowlistUsed[index]) info.push(`放行条目已失效:${item.file} → ${item.spec}(不再命中任何违规,请删除该条目)`);
    });
  }

  return { problems, info };
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
  for (const line of result.info) console.log(`[info] boundary:${line}`);
  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(`[boundary:fail] ${problem}`);
    console.error(`[boundary:fail] 依赖声明与 import 层向自检失败,共 ${result.problems.length} 项`);
    return 1;
  }
  const scopeText = flavor === 'src' ? 'src' : 'dist 产物';
  console.log(
    `[ok] import 边界自检通过(${scopeText}):`
      + `运行时 import 的包均在 dependencies(host 内建 ${Object.keys(HOST_PROVIDED_RUNTIME).join('/')} 除外);`
      + `core 不依赖宿主且不反向依赖 GUI 两层;renderer 不反向依赖 main;preload 不上跳引用 main;`
      + `core 的 node: 内建白名单限 ${CORE_NODE_BUILTIN_FILES.length} 个文件`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
