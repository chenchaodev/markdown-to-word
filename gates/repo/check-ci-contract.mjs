// 工程契约自检(Node 口径 + 门禁链 + 产物核对链),无产物、幂等,exit 0/1。
//
// **形状:判定本体 = `checkContract(ctx) -> string[]`(可注入、零 IO 副作用)**,
// `main()` 只做「打印 + 按 problems.length 出 0/1」。这与 gates/probe/gate-probes/
// coverage-gate.mjs 的 `auditZeroFiles(root)` 同一范式,是全仓门禁判定协议
// (gates/probe/gate-probes/protocol.mjs)要求的样子:三种驱动器 —— 进程级 CLI(本文件
// main)、沙盒探针、验收测试段 —— 消费**同一份**判定,而不是各写一套。
//
// 为什么这道门禁特别需要那个形状:它是**两条调用路径**上都跑的门禁 —— verify:ci 链首步,
// 以及两条 workflow 在 `npm ci` **之前**的裸调 fail-fast。后者约束的是**驱动器**
// (必须在装依赖之前、在 dist 还不存在的时候跑),不是**机制**。判定本体一旦可注入根,
// 探针就能在临时夹具仓上求值它,完全不必真的处在链首那个时刻 —— 于是「必须在 build 之前」
// 与「被破坏时会红」两件事不再互相误伤。
//
// ctx 注入面(与 protocol.mjs 的 GateCtx 同形):
//   root                  求值根(默认 shared/paths.js 的项目根)
//   readText(rel)         读仓库相对文本
//   exists(rel)           仓库相对路径是否存在
//   deps.nodeVersion      宿主 Node 版本串(默认 process.versions.node)
//
// 用途:把「宿主 Node 版本口径」与「CI/Release 门禁命令清单」收敛到单一来源
// (package.json engines + scripts 链),并把下列易漏约定变成可执行断言:
//   - lockfile 与两个 workflow 的 Node 口径与 engines 地板一致,且存在精确钉住地板的 lane;
//   - workflow 与 scripts 引用的本地脚本文件真实存在;
//   - build 先于 typecheck(typecheck 含测试树,测试 import dist/ 编译产物);
//   - 全量验收段(test / test:coverage 跑的是同一批段)在链内只跑一遍,且只保留插桩
//     的那一遍:覆盖率门禁(c8 阈值 + check:coverage-zero)由它供给,删掉则静默失效;
//     裸跑那一遍不插桩(进程无 NODE_V8_COVERAGE),对覆盖率数据贡献恒为 0,数字一个
//     bit 不变,再跑一遍只是多花一遍时长;不带插桩的入口信号由链内 test:smoke 承担;
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
//   - 打包白名单与实际顶层一致(build.files 引用的顶层面必须真实存在、编译输出树必须被正向
//     模式覆盖、正向模式不得覆盖非交付面)—— 此前只断言了 asar 产出**之后**的顶层三项,
//     白名单本身没人核对,「显式白名单」这个正确选择只做了一半;
//   - verify:release 复用 verify:ci 链并只追加 dist(发布不维护第二份缩水清单,
//     故几何门禁与产物核对无法被 tag 绕过)。
// 该脚本在 verify:ci 首步与两条 workflow 的依赖安装之前各跑一次:
// Node 版本不符时在 npm install 之前就 fail fast,不必等 EBADENGINE 警告或构建失败。
//
// 单一来源:Node 地板 = package.json engines.node;门禁链 = verify:ci。
// 本脚本不校验具体产物内容(那是各段测试、smoke 与几何门禁的职责)。

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../../shared/paths.js';
import { expandChainScriptNames, topLevelScriptNames } from './chain-expand.mjs';
import { auditPackWhitelist, topLevel } from './repo-manifest.mjs';

/**
 * 语义化版本号解析 + 优先级比较(支持预发布标识)。
 *
 * 为什么不引 semver 包:本脚本刻意零依赖——两条 workflow 都在 `npm install` 之前
 * 各跑它一次(Node 版本不符要在装依赖之前就 fail fast)。一旦 import 'semver',
 * 它恰好在最需要它的那次执行里不可用(ERR_MODULE_NOT_FOUND),门禁自我否定。
 * 而这里只需要 major.minor.patch + 可选预发布这一小段优先级,自写二十余行即可,
 * 逐条规则都有回归夹具兜着(见 check-ci-contract.selftest.mjs 的 prerelease 夹具)。
 */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * 解析语义化版本号;写法不受支持时抛错(调用方先经正则校验,此处只作兜底)。
 * @param {string} version 版本号字符串
 * @returns {{core: [number, number, number], pre: string[] | null}} 数值段 + 预发布段
 */
function parseSemver(version) {
  const m = SEMVER_RE.exec(version);
  if (m === null) throw new Error(`不受支持的版本写法:${version}`);
  const pre = m[4] === undefined ? null : m[4].split('.');
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

/**
 * 预发布段比较(《语义化版本》2.0.0 §11):纯数字段按数值比,数字段低于字母段,
 * 字母段按 ASCII 比;段集为对方前缀时短者低(beta < beta.1)。
 * @param {string[] | null} a
 * @param {string[] | null} b
 * @returns {number} -1 / 0 / 1
 */
function comparePrerelease(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // 正式版高于同数值段的任意预发布(1.0.0 > 1.0.0-beta.1)
  if (b === null) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1; // 前缀关系:段少者低
    if (y === undefined) return 1;
    const xIsNum = /^\d+$/.test(x);
    const yIsNum = /^\d+$/.test(y);
    if (xIsNum && yIsNum) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
      continue;
    }
    if (xIsNum !== yIsNum) return xIsNum ? -1 : 1; // 数字段低于字母段
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * 语义化版本号优先级比较:a < b → -1,a === b → 0,a > b → 1。
 * 数值段先比,相同再比预发布(故 1.0.0-beta.1 < 1.0.0,而 beta.1 < beta.2 可比)。
 * @param {string} a
 * @param {string} b
 * @returns {number} -1 / 0 / 1
 */
function compareVersions(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  return comparePrerelease(pa.pre, pb.pre);
}

/* ---- Node 地板(单源:package.json engines.node)---- */

/** workflow `node-version:` 的取值捕获类:`[\w.+-]` 覆盖主线别名(22)、完整版本
 * (22.12.0)与预发布后缀(24.0.0-nightly…)——预发布版是 CI 预览 lane 的常见写法,
 * 捕获类漏掉 `-` 会把它截成 `24.0.0`,等于把预览版当正式版放行(勿收窄)。 */
const NODE_VERSION_RE = /node-version:\s*['"]?([\w.+-]+)['"]?/g;
/** lane 完整版本写法:`major.minor.patch` + 可选预发布后缀(不接受 v 前缀与 build 元数据) */
const NODE_VERSION_FULL_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
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

/**
 * 判定本体:跑完全部契约断言,返回问题清单(空数组 = 通过)。
 *
 * 纯判定、零副作用:只经 ctx 读盘,不写任何文件、不改进程退出码。全部断言跑完才返回,
 * 避免首个失败掩盖其余漂移(与重构前「收集完统一输出」的口径一致)。
 * @param {import('../probe/gate-probes/protocol.mjs').GateCtx} [ctx] 注入面(根 / 读文本 / 存在性 / 宿主 Node 版本)
 * @returns {string[]} 问题清单
 */
export function checkContract(ctx = {}) {
  const root = ctx.root ?? ROOT;
  const readText = ctx.readText ?? ((relativePath) => readFileSync(join(root, relativePath), 'utf8'));
  const exists = ctx.exists ?? ((relativePath) => existsSync(join(root, relativePath)));
  const nodeVersion = /** @type {string} */ (ctx.deps?.nodeVersion ?? process.versions.node);

  /** @type {string[]} */
  const problems = [];
  /** @param {string} message @returns {void} */
  const fail = (message) => problems.push(message);

  const pkg = JSON.parse(readText('package.json'));
  const lock = JSON.parse(readText('package-lock.json'));
  const scripts = pkg.scripts ?? {};

  const enginesNode = pkg.engines?.node;
  if (typeof enginesNode !== 'string') {
    fail('package.json 缺少 engines.node,宿主 Node 口径无单源');
  }
  const floorMatch = typeof enginesNode === 'string' ? /^>=\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(enginesNode) : null;
  if (floorMatch === null) {
    fail(`engines.node 只接受 ">=major.minor.patch[-prerelease]" 形式以便精确比对,实际 ${String(enginesNode)}`);
  }
  const floorStr = floorMatch === null ? '0.0.0' : floorMatch[1];
  const floorMajor = Number(floorStr.split('-')[0].split('.')[0]);

  if (lock.packages?.['']?.engines?.node !== enginesNode) {
    fail(
      `package-lock.json 根包 engines.node(${String(lock.packages?.['']?.engines?.node)})与 package.json(${String(enginesNode)})不一致,需同步`,
    );
  }

  // 宿主 Node 口径可能带预发布后缀(nightly/rc 发行版):比对只取数值段——
  // engines 地板写的是正式版,拿 nightly 的数值段与之比,才不会把「更新的预览版」
  // 误判成低于地板(旧实现 split('.') 后对 NaN 的比较恰好等价于此,此处显式化)。
  const runtimeVersion = nodeVersion.replace(/[-+].*$/, '');
  if (compareVersions(runtimeVersion, floorStr) < 0) {
    fail(`当前 Node ${nodeVersion} 低于 engines 地板 ${enginesNode},请升级宿主 Node 后再执行门禁`);
  }

  // ---- workflow 口径:Node lane 与引用的 npm scripts ----

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
      } else if (NODE_VERSION_FULL_RE.test(version)) {
        // 按 semver 优先级比:预发布 lane 低于同数值段的正式地板(22.13.0-beta.1 < 22.13.0),
        // 预发布之间可比(beta.1 < beta.2),不按字符串比
        if (compareVersions(version, floorStr) < 0) {
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
        fail(`workflow 引用了不存在的 npm script:${m[1]}`);
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
  //
  // 链解析本身在 gates/repo/chain-expand.mjs(全仓单源,见该文件头注:此前 5 份独立实现
  // 里那几份扁平的只认单层,链一旦拆出子脚本就看不见内层门禁而无人判红)。此处只做两件事:
  // 选语义(递归全展开 vs 顶层不递归)、把「成环 / 未定义」两类结构问题转成本门禁的诊断文案。
  // 两种语义并存是有判据依赖的,不是重复:递归视图给「成员与顺序」类断言(链内必备步骤、
  // 全量验收段恰跑一遍),顶层视图给「形态」类断言(verify:release 恰为 verify:ci + dist
  // —— 递归化会放过「发布自行重排并复制内层步骤」这种真实漂移)。

  /**
   * 递归展开一条链,返回子 script 名执行序;成环与未定义在此转成契约诊断。
   * @param {string} name 链根 script 名
   * @returns {string[]} 子 script 名执行序(不含 name 自身)
   */
  function expandScript(name) {
    return expandChainScriptNames(scripts, name, {
      onMissing: (missing) => fail(`scripts.${missing} 未在 package.json 中定义`),
      onCycle: (path) => fail(`scripts.${path[0]} 存在自引用链:${path.join(' -> ')}`),
    });
  }

  // CI 门禁必备步骤(顺序即依赖顺序):check:contract 之后立刻核对依赖声明与
  // import 层向(纯文本判定,不依赖 dist,故须早于 build —— 构建之后才发现
  // 传递依赖漏声明,已经白跑一次)与 action 引用固定(同理由:纯文本、可离线,
  // 排在 build 之后等于让 workflow 漂移白跑一次构建才被拦下);文档侧两道门禁同理由
  // 排在 build 之前 —— check:archive-index(归档索引与目录实际内容一致性)只判定文本,
  // 离线、零耗时。
  //
  // ⚠️ **下面这段 2026-09-27 的判断已于 2026-10-04 失效**;原文逐字保留作决策史,据以更正见
  // 其后一段。**不要按原文去把 check:docs 移出链** —— 它的前提对本仓不成立。
  //
  // 【原文 · 已失效】**check:docs 曾于 2026-09-27 移出本链**(它曾被列为必备步骤,前提是它
  // 能在 CI 上生效,而该前提不成立):它只是全局配置仓那份指针门禁的薄包装,载体在配置仓,
  // 而 workflow 不装也不克隆该目录 ⇒ CI 上扫描范围恒为空,载体不可达时打印一行提示后
  // `exit 0`。留在链上等于给「文档正在被 CI 检查」的假象,实则从未校验过任何东西。
  // 它在本地确实抓过真问题(断链、失效小节名指针、已废指针),故**保留为本地检查**:
  // 提交前手动 `npm run check:docs`。文档侧在 CI 上真正生效的是 check:archive-index。
  //
  // 【2026-10-04 更正】原文的前提有三处与本仓现状不符,故该结论已反转:
  // ① **脚本在本仓**。被调用的是 `gates/repo/` 下的脚本,扫的是**本仓** `docs/`,不依赖
  //    workflow 克隆配置仓 ⇒ 「扫描范围恒为空」不成立。
  // ② **两族判据在本仓就地判定**。台账内不变量与载体形态(C1/C2/C4/C5/C6)在本仓有实现,
  //    链上输出可见「台账一致性…判据判定 7/7 项」与「载体形态(共 5 条,已判红)」
  //    ⇒ 「实则从未校验过任何东西」不成立。
  // ③ **不可达的那部分不再静默**。跨仓路径那一档的判红基准确实仍在仓外、本仓不可达,但
  //    它已**自报**「判定 0 处 · 未判,非「查过没问题」」,并把「覆盖:不全」推进结论行
  //    ⇒ 正是原文反对留在链上的那个「假象」,被这个机制本身消掉了。
  // 处置:check:docs **保留在链内**(现为链内第 13/14 位),且**仍不列入 REQUIRED_CI_STEPS**
  // —— 在链内是事实,但本表只钉「必备且顺序即依赖」的那几步,`check:docs` 不属此列。
  // build 产出 dist/ 编译产物,测试与 fixture 校验都跑 dist;check:geometry 收尾(采样
  // dist/renderer,须在 build 之后、且是链内最后一步)。
  const REQUIRED_CI_STEPS = [
    'check:contract',
    'check:boundary',
    'check:pinned-actions',
    'check:archive-index',
    'build',
    'typecheck',
    'lint',
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

  // 全量验收段在链内的形态:插桩那一遍恰一次、裸跑那一遍零次(两个方向都要挡)。
  // 重复跑同一批段是纯浪费 —— 裸跑那一遍不插桩,进程无 NODE_V8_COVERAGE,对 c8 的
  // 覆盖率数据贡献恒为 0(--all 的分母来自 --include 的文件集合,与跑几遍无关),数字
  // 一个 bit 不变;而把插桩那一遍删掉则覆盖率门禁(c8 阈值 + check:coverage-zero)失去
  // 唯一执行者,CI 仍报绿 —— 阈值不为 0 时 c8 自己会红,不依赖另一遍裸跑兜底。
  // 计数按展开后的脚本名精确相等(子串匹配会让 test 命中 test:coverage,断言自欺)。
  const FULL_RUN_ENTRIES = [
    { name: 'test:coverage', times: 1 },
    { name: 'test', times: 0 },
  ];
  for (const { name, times } of FULL_RUN_ENTRIES) {
    const actual = ciChain.filter((step) => step === name).length;
    if (actual !== times) {
      fail(
        `verify:ci 全量验收只保留插桩那一遍(须 test:coverage 恰 1 次、裸跑 test 0 次):` +
          `同一批段重复跑是纯浪费,删掉则覆盖率门禁失效。当前链中 ${name} 出现 ${actual} 次` +
          `(链:${ciChain.join(' -> ') || '空'})`,
      );
    }
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
  // **这一格刻意用顶层视图而非递归视图**:判据要问的是「发布链的顶层形态是不是那两笔」,
  // 递归展开会把它变成「展开后成员相同」,于是「verify:release 自行把 verify:ci 的内层
  // 步骤复制一份再排一遍」这种真实漂移会被放行 —— 正是这条断言要拦的东西。
  const releaseTopLevel = topLevelScriptNames(scripts, 'verify:release');
  if (releaseTopLevel.missing) {
    fail('scripts.verify:release 未在 package.json 中定义');
  }
  if (releaseTopLevel.names.join(',') !== 'verify:ci,dist') {
    fail(`verify:release 须恰为 verify:ci + dist(复用同一门禁链,不维护第二份清单),当前:${releaseTopLevel.names.join(' -> ') || '空'}`);
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
      if (!exists(relative)) {
        fail(`${owner} 引用的文件不存在:${relative}`);
      }
    }
  }

  // ---- 打包白名单与实际顶层一致(补的是「白名单本身没人核对」这一格)----
  // 事实由 gates/repo/repo-manifest.mjs 从实际顶层派生(它不知道本门禁的存在),判据在此:
  //   1. 白名单必须显式存在 —— 不给 files 时 electron-builder 走自己的默认集(几乎打包整个
  //      工作树),那等于「显式白名单」这个选择被悄悄撤回;
  //   2. **正向**模式引用的顶层必须真实存在(目录改名/迁移后忘了跟白名单,打进包的是漏的);
  //      取反模式不要求目标存在 —— 排除模式没有对象可排除时判红是噪声,而干净检出里安装树
  //      本来就不存在(CI 的 fail-fast 那一步甚至跑在依赖安装之前),那条判据会变成恒红;
  //   3. 编译输出树必须被正向模式覆盖,否则打进包的是空的;
  //   4. 反向:正向模式只许覆盖交付面(编译输出树 + 包清单),覆盖到源码树 / 验收树 / 机制树 /
  //      文档树就是误打包(夹具、脚本、内部文档会随安装包发出去)。
  const manifest = topLevel(root);
  const packFiles = pkg.build?.files;
  if (!Array.isArray(packFiles)) {
    fail(`package.json build.files 必须是显式白名单数组(实际 ${JSON.stringify(packFiles ?? null)});缺它会让打包退回 electron-builder 默认集`);
  } else {
    const pack = auditPackWhitelist(manifest, packFiles);
    // 交付面 = 编译输出树 + 包清单。取不到包清单名时交付面只有编译输出树,此时任何正向模式
    // 都判红(拿不到单源就说明配置已经不成形,不该静默放行)。
    const delivery = new Set([...manifest.buildOutputNames, ...(manifest.manifestName === null ? [] : [manifest.manifestName])]);
    for (const reference of pack.references) {
      // 交付面豁免存在性:它由 `build` / 打包步骤产出,而本门禁的两个调用点都排在 `build`
      // 之前(ci.yml 的 fail-fast 裸调、verify:ci 第 1 步),断言它存在等于断言一个定义上
      // 不成立的事实 —— 那会让该判据在每次干净检出上恒红,与白名单写对写错无关。
      // 「目录改名后忘了跟白名单」这条防线由下面那条交付面判据完整接住:
      // 改名的段既不在声明的交付面里、其正向模式就会被判红。
      if (reference.negated || reference.exists || delivery.has(reference.segment)) continue;
      fail(`build.files 引用的顶层不存在:${reference.segment}(模式 ${reference.pattern});目录改名/迁移后须同步白名单`);
    }
    if (!pack.buildOutputCovered) {
      fail(
        `build.files 未覆盖编译输出树 ${String(pack.buildOutput)}(白名单 ${JSON.stringify(packFiles)}) —— 打包产物将不含代码`,
      );
    }
    for (const reference of pack.references) {
      if (reference.negated || delivery.has(reference.segment)) continue;
      fail(
        `build.files 的正向模式 ${reference.pattern} 覆盖了非交付面 ${reference.segment}(类别 ${String(reference.category)}) —— ` +
          `交付面只许编译输出树与包清单,误打包会把源码/夹具/内部文档随安装包发出去`,
      );
    }
  }

  return problems;
}

/**
 * 绿色摘要里的链信息(与判定本体分开:摘要要的是「判定通过」之外的可读上下文,
 * 放在这里是为了 main() 只做呈现)。
 * @param {import('../probe/gate-probes/protocol.mjs').GateCtx} [ctx] 注入面
 * @returns {string} 摘要正文
 */
function summaryLine(ctx = {}) {
  const root = ctx.root ?? ROOT;
  const readText = ctx.readText ?? ((relativePath) => readFileSync(join(root, relativePath), 'utf8'));
  const pkg = JSON.parse(readText('package.json'));
  const scripts = pkg.scripts ?? {};
  const floor = /^>=\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(pkg.engines?.node ?? '');
  const floorStr = floor === null ? '未登记' : floor[1];
  const nodeVersion = /** @type {string} */ (ctx.deps?.nodeVersion ?? process.versions.node);
  return (
    `[ok] 工程契约自检通过:Node 地板 ${floorStr}(engines/lockfile/CI/Release 口径一致,当前 ${nodeVersion});` +
    `verify:ci 链 ${topLevelScriptNames(scripts, 'verify:ci').names.join(' -> ')};verify:release = verify:ci + dist;` +
    `dist 链 先清 dist/release 再构建、清单基线先于打包、产物核对后于打包;清理目标限定 dist/release;被引用脚本均存在;` +
    `打包白名单只覆盖交付面(编译输出树 + 包清单)且引用的顶层面均存在`
  );
}

/**
 * CLI 主体:调用判定本体 → 打印 → 按结论出 0/1(判定逻辑全在 checkContract 里)。
 * @param {import('../probe/gate-probes/protocol.mjs').GateCtx} [ctx] 注入面
 * @returns {number} 退出码
 */
export function main(ctx = {}) {
  const problems = checkContract(ctx);
  if (problems.length > 0) {
    for (const item of problems) console.error(`[contract:fail] ${item}`);
    console.error(`[contract:fail] 工程契约自检失败,共 ${problems.length} 项`);
    return 1;
  }
  console.log(summaryLine(ctx));
  return 0;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。写法与
// gates/probe/gate-probes/coverage-gate.mjs 同形(全仓先例),不另创写法。
//
// 为什么必须有守卫:顶层自执行会把「import 这个模块」变成「把契约门禁真跑一遍」,
// 副作用是**改掉宿主进程的 exitCode**(verify:ci 链首步的进程退出码由调用方脚本决定,
// 一段无关的 import 就能把它改成 1)。守卫之后本模块可被安全 import,注册表因此能
// 登记它并真 import 出判定本体 checkContract。
// 守卫右侧用 `fileURLToPath(import.meta.url)`(代码位置)而非 `join(ROOT, …)`(cwd 派生的环境值):
// 本门禁在两条 workflow 里被**裸调**(`node gates/repo/check-ci-contract.mjs`),自检则以夹具为
// cwd 运行,两者恒不相等时后者会让守卫永不成立、无输出退 0。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}