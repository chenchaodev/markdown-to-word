// 工程契约自检(Node 口径 + 门禁链),无产物、幂等,exit 0/1。
//
// 用途:把「宿主 Node 版本口径」与「CI/Release 门禁命令清单」收敛到单一来源
// (package.json engines + scripts 链),并把下列易漏约定变成可执行断言:
//   - lockfile 与两个 workflow 的 Node 口径与 engines 地板一致,且存在精确钉住地板的 lane;
//   - workflow 与 scripts 引用的本地脚本文件真实存在;
//   - build 先于 typecheck(typecheck 含测试树,测试 import dist/ 编译产物);
//   - verify:release 复用 verify:ci 链并只追加 dist(发布不维护第二份缩水清单)。
// 该脚本在 verify:ci 首步与两条 workflow 的依赖安装之前各跑一次:
// Node 版本不符时在 npm install 之前就 fail fast,不必等 EBADENGINE 警告或构建失败。
//
// 单一来源:Node 地板 = package.json engines.node;门禁链 = verify:ci。
// 本脚本不校验具体产物内容(那是各段测试与 smoke 的职责)。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

/** 收集问题;全部检查跑完后统一输出(exit 0/1),避免首个失败掩盖其余漂移 */
const problems = [];
const fail = (message) => problems.push(message);

function readText(relativePath) {
  return readFileSync(join(projectRoot, relativePath), 'utf8');
}

/** 语义化版本号比较(仅 major.minor.patch):a < b → -1,a === b → 0,a > b → 1 */
function compareSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// ---- Node 地板(单源:package.json engines.node)----

const pkg = JSON.parse(readText('package.json'));
const lock = JSON.parse(readText('package-lock.json'));
const enginesNode = pkg.engines?.node;
if (typeof enginesNode !== 'string') {
  fail('package.json 缺少 engines.node,宿主 Node 口径无单源');
}
const floorMatch = typeof enginesNode === 'string' ? /^>=\s*v?(\d+)\.(\d+)\.(\d+)$/.exec(enginesNode) : null;
if (floorMatch === null) {
  fail(`engines.node 只接受 ">=major.minor.patch" 形式以便精确比对,实际 ${String(enginesNode)}`);
}
const floorStr = floorMatch === null ? '0.0.0' : `${floorMatch[1]}.${floorMatch[2]}.${floorMatch[3]}`;
const floor = floorMatch === null ? [0, 0, 0] : [Number(floorMatch[1]), Number(floorMatch[2]), Number(floorMatch[3])];
const floorMajor = floor[0];

if (lock.packages?.['']?.engines?.node !== enginesNode) {
  fail(
    `package-lock.json 根包 engines.node(${String(lock.packages?.['']?.engines?.node)})与 package.json(${String(enginesNode)})不一致,需同步`,
  );
}

const runtime = process.versions.node.split('.').map(Number);
if (compareSemver(runtime, floor) < 0) {
  fail(`当前 Node ${process.versions.node} 低于 engines 地板 ${enginesNode},请升级宿主 Node 后再执行门禁`);
}

// ---- workflow 口径:Node lane 与引用的 npm scripts ----

/** node-version 合法写法:主线别名(22)或完整版本(22.12.0);主线别名需不低于地板主线 */
const NODE_VERSION_RE = /node-version:\s*['"]?([\w.]+)['"]?/g;
const NPM_RUN_RE = /npm run ([\w:.-]+)/g;
const WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/release.yml'];

/** 去掉整行 YAML 注释:注释里出现的版本号/命令字样不应被当作配置 */
function stripYamlComments(text) {
  return text.replace(/^\s*#.*$/gm, '');
}

for (const workflow of WORKFLOWS) {
  const text = stripYamlComments(readText(workflow));
  const versions = [...text.matchAll(NODE_VERSION_RE)].map((m) => m[1]);
  if (versions.length === 0) {
    fail(`${workflow} 未声明 node-version`);
  }
  let floorPinned = false;
  for (const version of versions) {
    if (version === floorStr) {
      floorPinned = true;
    } else if (/^\d+$/.test(version)) {
      // 主线别名(如 22):允许,用于「当前稳定/后续支持版本」兼容 lane
      if (Number(version) < floorMajor) {
        fail(`${workflow} 的 node-version: ${version} 低于 engines 地板主线 ${floorMajor}(${enginesNode})`);
      }
    } else if (/^\d+\.\d+\.\d+$/.test(version)) {
      if (compareSemver(version.split('.').map(Number), floor) < 0) {
        fail(`${workflow} 的 node-version: ${version} 低于 engines 地板 ${enginesNode}`);
      }
    } else {
      fail(`${workflow} 的 node-version: ${version} 是不受支持的写法(只接受主线别名或完整版本)`);
    }
  }
  if (!floorPinned) {
    fail(`${workflow} 没有任何 lane 精确钉住 engines 地板 ${floorStr},地板不可验证`);
  }
  for (const m of text.matchAll(NPM_RUN_RE)) {
    if (pkg.scripts?.[m[1]] === undefined) {
      fail(`${workflow} 引用了不存在的 npm script:${m[1]}`);
    }
  }
}

if (!/\bnpm run verify:ci\b/.test(stripYamlComments(readText(WORKFLOWS[0])))) {
  fail('.github/workflows/ci.yml 未调用 npm run verify:ci,门禁入口会与本地口径分叉');
}
if (!/\bnpm run verify:release\b/.test(stripYamlComments(readText(WORKFLOWS[1])))) {
  fail('.github/workflows/release.yml 未调用 npm run verify:release,发布可能绕过约定门禁');
}

// ---- 门禁链展开:script → 有序的子 script 名 + 叶子命令 ----

const scripts = pkg.scripts ?? {};

/** 展开 `a && npm run b && c` 形态的 script,返回递归后的子 script 执行序(用于断言步骤与顺序) */
function expandScript(name, stack = []) {
  if (stack.includes(name)) {
    fail(`scripts.${name} 存在自引用链:${[...stack, name].join(' -> ')}`);
    return [];
  }
  const body = scripts[name];
  if (body === undefined) {
    fail(`scripts.${name} 未在 package.json 中定义`);
    return [];
  }
  const names = [];
  for (const part of body.split('&&')) {
    const segment = part.trim();
    const nested = /^npm run ([\w:.-]+)$/.exec(segment);
    if (nested === null) continue;
    names.push(nested[1], ...expandScript(nested[1], [...stack, name]));
  }
  return names;
}

/** script 顶层直接调用的子 script 名(不递归):用于断言「发布只复用 verify:ci 链」这类形态约束 */
function topLevelScriptNames(name) {
  const body = scripts[name];
  if (body === undefined) {
    fail(`scripts.${name} 未在 package.json 中定义`);
    return [];
  }
  return body
    .split('&&')
    .map((part) => part.trim())
    .flatMap((segment) => {
      const nested = /^npm run ([\w:.-]+)$/.exec(segment);
      return nested === null ? [] : [nested[1]];
    });
}

// CI 门禁必备步骤(顺序即依赖顺序):build 产出 dist/ 编译产物,测试与 fixture 校验都跑 dist。
const REQUIRED_CI_STEPS = ['build', 'typecheck', 'lint', 'test', 'test:coverage', 'check:fixtures', 'test:smoke'];

const ciChain = expandScript('verify:ci');
let cursor = -1;
for (const step of REQUIRED_CI_STEPS) {
  const at = ciChain.indexOf(step, cursor + 1);
  if (at === -1) {
    fail(`verify:ci 缺少门禁步骤 ${step}(当前链:${ciChain.join(' -> ') || '空'})`);
    continue;
  }
  cursor = at;
}

const buildAt = ciChain.indexOf('build');
const typecheckAt = ciChain.indexOf('typecheck');
if (buildAt === -1 || typecheckAt === -1 || buildAt > typecheckAt) {
  fail(`verify:ci 须先 build 再 typecheck(typecheck 含测试树,测试 import dist/),当前 build@${buildAt} typecheck@${typecheckAt}`);
}

// verify:release 只允许「复用 verify:ci + 追加 dist」两种形态:发布若自行拼装
// 子集命令(coverage/fixture/smoke 任一缺失即等于绕过门禁),此处即拦截。
const releaseTopLevel = topLevelScriptNames('verify:release');
if (releaseTopLevel.join(',') !== 'verify:ci,dist') {
  fail(`verify:release 须恰为 verify:ci + dist(复用同一门禁链,不维护第二份清单),当前:${releaseTopLevel.join(' -> ') || '空'}`);
}

// ---- 被引用脚本文件存在性(package.json 全量 scripts + 两个 workflow)----

const SCRIPT_FILE_RE = /(?:^|\s)([\w.\\/'-]+\.(?:mjs|cjs|js|cts))(?=\s|$)/g;
const referencingTexts = [
  ...Object.entries(scripts).map(([name, body]) => [`scripts.${name}`, body]),
  ...WORKFLOWS.map((file) => [file, stripYamlComments(readText(file))]),
];
for (const [owner, text] of referencingTexts) {
  for (const m of text.matchAll(SCRIPT_FILE_RE)) {
    const relative = m[1].replaceAll('\\', '/');
    if (!existsSync(join(projectRoot, relative))) {
      fail(`${owner} 引用的文件不存在:${relative}`);
    }
  }
}

// ---- 输出 ----

if (problems.length > 0) {
  for (const problem of problems) console.error(`[contract:fail] ${problem}`);
  console.error(`[contract:fail] 工程契约自检失败,共 ${problems.length} 项`);
  process.exit(1);
}
console.log(
  `[ok] 工程契约自检通过:Node 地板 ${floorStr}(engines/lockfile/CI/Release 口径一致,当前 ${process.versions.node});` +
    `verify:ci 链 ${topLevelScriptNames('verify:ci').join(' -> ')};verify:release = verify:ci + dist;被引用脚本均存在`,
);
