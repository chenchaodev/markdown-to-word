// 工程契约自检(Node 口径 + 门禁链 + 产物核对链),无产物、幂等,exit 0/1。
//
// 用途:把「宿主 Node 版本口径」与「CI/Release 门禁命令清单」收敛到单一来源
// (package.json engines + scripts 链),并把下列易漏约定变成可执行断言:
//   - lockfile 与两个 workflow 的 Node 口径与 engines 地板一致,且存在精确钉住地板的 lane;
//   - workflow 与 scripts 引用的本地脚本文件真实存在;
//   - build 先于 typecheck(typecheck 含测试树,测试 import dist/ 编译产物);
//   - 依赖声明与 import 层向门禁(check:boundary)紧随契约自检且早于 build:
//     它判定源码文本、不消费 dist,排到构建之后就失去了 fail-fast 意义;
//   - action 引用固定门禁(check:pinned-actions)与 check:boundary 同级、同在 build
//     之前:它判定 workflow 文本、离线可跑,排到构建之后同样失去 fail-fast 意义
//     (固定 SHA 后 Dependabot 漏洞告警失效,这道门禁是补偿面,不许被挪到链尾);
//   - 几何门禁(check:geometry)在 verify:ci 链内且晚于 build —— 链尾是唯一位置:
//     它需要在 smoke 之后运行(此时 dist 已是本次构建),又必须早于 dist 打包;
//   - dist 链形态:先清理生成目录(clean:dist + clean:release)→ build → 生成 dist
//     清单(基线)→ electron-builder → 产物核对(dist 清单校验 / app.asar 核对 /
//     发布目标核对),即「从干净目录打出,再核对刚打出的那份包」;
//   - 清理目标白名单:clean:* 只能指向 dist/release/all(删除不可逆,不许扩散到其它目录);
//   - verify:release 复用 verify:ci 链并只追加 dist(发布不维护第二份缩水清单,
//     故几何门禁与产物核对无法被 tag 绕过)。
// 该脚本在 verify:ci 首步与两条 workflow 的依赖安装之前各跑一次:
// Node 版本不符时在 npm install 之前就 fail fast,不必等 EBADENGINE 警告或构建失败。
//
// 单一来源:Node 地板 = package.json engines.node;门禁链 = verify:ci。
// 本脚本不校验具体产物内容(那是各段测试、smoke 与几何门禁的职责)。

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
/**
 * workflow 里的 `npm run <script>`;允许脚本名前夹带 npm 开关
 * (如 --silent 抑制 run 头噪声),开关不参与脚本名捕获,只取其后的脚本名。
 */
const NPM_RUN_RE = /npm run (?:-{1,2}[\w-]+ )*([\w:.-]+)/g;
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

// CI 门禁必备步骤(顺序即依赖顺序):check:contract 之后立刻核对依赖声明与
// import 层向(纯文本判定,不依赖 dist,故须早于 build —— 构建之后才发现
// 传递依赖漏声明,已经白跑一次)与 action 引用固定(同理由:纯文本、可离线,
// 排在 build 之后等于让 workflow 漂移白跑一次构建才被拦下);build 产出 dist/
// 编译产物,测试与 fixture 校验都跑 dist;check:geometry 收尾(采样
// dist/renderer,须在 build 之后、且是链内最后一步)。
const REQUIRED_CI_STEPS = [
  'check:contract',
  'check:boundary',
  'check:pinned-actions',
  'build',
  'typecheck',
  'lint',
  'test',
  'test:coverage',
  'check:fixtures',
  'test:smoke',
  'check:geometry',
];

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

// 依赖声明/层向门禁判定的是源码文本,不消费 dist:排到 build 之后等于让
// 「jszip 只在 devDependencies」「core 反向依赖 main」这类漂移白跑一次构建
// 才被拦下,故与 typecheck 同级断言「boundary 在 build 之前」。
const boundaryAt = ciChain.indexOf('check:boundary');
if (buildAt !== -1 && boundaryAt !== -1 && boundaryAt > buildAt) {
  fail(
    `verify:ci 须先 check:boundary 再 build(依赖声明与 import 层向在构建前判定),当前 build@${buildAt} check:boundary@${boundaryAt}`,
  );
}

// action 引用固定门禁同样只判定 workflow 文本(纯正则 + JSON 基线,离线可跑):
// 排到 build 之后,「有人把 uses: 改回浮动 tag」这类漂移要白跑一次构建才被拦下。
const pinnedAt = ciChain.indexOf('check:pinned-actions');
if (buildAt !== -1 && pinnedAt !== -1 && pinnedAt > buildAt) {
  fail(
    `verify:ci 须先 check:pinned-actions 再 build(action 引用固定在构建前判定),当前 build@${buildAt} check:pinned-actions@${pinnedAt}`,
  );
}

// 几何门禁采样 dist/renderer 的真实 Electron 窗口:build 之前跑只会拿到上一次的界面,
// 门禁形同虚设却报绿,故与 typecheck 同级断言「build 在前」。
const geometryAt = ciChain.indexOf('check:geometry');
if (buildAt !== -1 && geometryAt !== -1 && buildAt > geometryAt) {
  fail(`verify:ci 须先 build 再 check:geometry(几何门禁采样本次构建的 dist/renderer),当前 build@${buildAt} check:geometry@${geometryAt}`);
}

// verify:release 只允许「复用 verify:ci + 追加 dist」两种形态:发布若自行拼装
// 子集命令(coverage/fixture/smoke 任一缺失即等于绕过门禁),此处即拦截。
const releaseTopLevel = topLevelScriptNames('verify:release');
if (releaseTopLevel.join(',') !== 'verify:ci,dist') {
  fail(`verify:release 须恰为 verify:ci + dist(复用同一门禁链,不维护第二份清单),当前:${releaseTopLevel.join(' -> ') || '空'}`);
}

// ---- dist 链形态:先清理、再构建、清单基线在打包前、产物核对在打包后 ----
// 不清理则源文件改名/删除后的残留产物会打进包、release/ 的历史安装包会与本次产物并存;
// 清单与哈希核对只能证明「一致」,证不了「没多带」。放在 electron-builder 之前校验 dist
// 同样只能证明「打包前的 dist 干净」,证明不了「打进包里的就是这一份」——所以两侧都要卡。
const DIST_PREP_STEPS = ['clean:dist', 'clean:release', 'build', 'gen:dist-manifest'];
const DIST_ARTIFACT_STEPS = ['check:dist-manifest', 'check:asar', 'check:release'];

const distBody = scripts.dist ?? '';
if (distBody === '') {
  fail('scripts.dist 未在 package.json 中定义(verify:release 依赖它)');
} else {
  const builderAt = distBody.indexOf('electron-builder');
  if (builderAt === -1) {
    fail('scripts.dist 缺少 electron-builder 打包命令');
  }
  let previousAt = -1;
  for (const step of DIST_PREP_STEPS) {
    const at = distBody.indexOf(`npm run ${step}`);
    if (at === -1) {
      fail(`scripts.dist 缺少前置步骤 ${step}(顺序须为 ${DIST_PREP_STEPS.join(' → ')} → electron-builder → ${DIST_ARTIFACT_STEPS.join(' → ')})`);
    } else if (at < previousAt) {
      fail(`scripts.dist 步骤乱序:${step} 出现在 ${DIST_PREP_STEPS[DIST_PREP_STEPS.indexOf(step) - 1]} 之前(顺序须为 ${DIST_PREP_STEPS.join(' → ')}),当前 ${step}@${at} 上一步@${previousAt}`);
    } else if (builderAt !== -1 && at > builderAt) {
      fail(`scripts.dist 的 ${step} 须在 electron-builder 之前,当前 ${step}@${at} builder@${builderAt}`);
    }
    if (at > previousAt) previousAt = at;
  }
  for (const step of DIST_ARTIFACT_STEPS) {
    const at = distBody.indexOf(`npm run ${step}`);
    if (at === -1) {
      fail(`scripts.dist 缺少产物核对步骤 ${step}(发布链不得只打包不核对)`);
    } else if (builderAt !== -1 && at < builderAt) {
      fail(`scripts.dist 的 ${step} 须在 electron-builder 之后(核对对象是刚打出的包),当前 ${step}@${at} builder@${builderAt}`);
    }
  }
}

// ---- 清理目标白名单(删除不可逆,不许扩散)----
const CLEAN_TARGETS = new Set(['dist', 'release', 'all']);
for (const [name, body] of Object.entries(scripts)) {
  if (!name.startsWith('clean:')) continue;
  const target = /--target[= ]([^\s]+)/.exec(body);
  if (target === null) {
    fail(`scripts.${name} 未用 --target 显式指定清理目标(白名单 ${[...CLEAN_TARGETS].join('/')}),不做隐式删除`);
  } else if (!CLEAN_TARGETS.has(target[1])) {
    fail(`scripts.${name} 的清理目标 ${target[1]} 不在白名单(${[...CLEAN_TARGETS].join('/')})内,拒绝删除该路径`);
  }
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
    `verify:ci 链 ${topLevelScriptNames('verify:ci').join(' -> ')};verify:release = verify:ci + dist;` +
    `dist 链 先清 dist/release 再构建、清单基线先于打包、产物核对后于打包;清理目标限定 dist/release;被引用脚本均存在`,
);
