// 契约自检脚本自身的回归守护(负向夹具)。
//
// verify:ci 的第一道门是 check:contract;若该脚本被改成「永远通过」或某个断言被
// 误删,配置漂移(Node 口径、门禁链缩水、build/typecheck 与几何门禁乱序、依赖声明/
// 层向门禁与 action 引用固定门禁被移出或排到构建之后、全量验收段被移出/改成裸跑/
// 被加回重复跑、前置清理被移出/乱序、清理目标越界、产物核对被移出
// 或排到打包之前、脚本缺失、链被拆成子脚本后内层门禁漏登记)就会静默放行
// 发布,没有任何其他检查能发现。此处用
// 临时夹具逐条制造漂移,断言自检脚本
// 确实以非零码拒绝,并断言未漂移时通过。纯 fs + 子进程,无产物:临时目录
// 写在系统临时目录并在 finally 清理(测试对象是夹具,不是本仓库文件)。
//
// 链解析本身在 gates/repo/chain-expand.mjs(全仓单源);本文件除夹具外另有一段
// **直锚点**:直接对展开器求值,钉住「递归视图看得见内层 / 顶层视图不递归 /
// 成环与悬空引用必被回报 / 菱形依赖不算环 / 叶子命令序 = 执行序」。那一段不是可选的:
// 上面每条夹具断言的诊断全都经它产出,展开器一旦恒绿,夹具就只是在验证「什么都没报」。

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../shared/paths.js';
import { expandChainScriptNames, topLevelScriptNames, walkChain } from './chain-expand.mjs';
import { scanTopLevel, topLevel } from './repo-manifest.mjs';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'gates', 'repo', 'check-ci-contract.mjs');
/** 被测门禁自身的仓库相对路径(复制点要排除它:它由 copyFileSync 逐字节落盘,不是占位文件) */
const CHECKER_RELATIVE = join('gates', 'repo', 'check-ci-contract.mjs');

const FLOOR = '22.13.0';

/** 夹具内的编译配置:声明输出目录(打包白名单对账要靠它认出「交付面」)。与真实仓库同构。 */
const FIXTURE_TSCONFIG = {
  compilerOptions: { outDir: 'dist', target: 'ES2022' },
  include: ['test'],
};

/** 夹具基线:与真实仓库同构的门禁链(verify:ci 全步含几何门禁 + verify:release 追加 dist) */
const FIXTURE_SCRIPTS = {
  'check:contract': 'node gates/repo/check-ci-contract.mjs',
  'check:boundary': 'node gates/repo/check-import-boundary.mjs',
  'check:pinned-actions': 'node gates/repo/check-pinned-actions.mjs',
  'check:docs': 'node gates/repo/check-docs.mjs',
  'check:archive-index': 'node gates/repo/gen-archive-index.mjs --check',
  'check:env': 'node gates/repo/print-env-fingerprint.mjs',
  'check:geometry': 'electron gates/geometry/check-geometry.mjs',
  'gen:dist-manifest': 'node gates/artifacts/check-dist-manifest.mjs',
  'check:dist-manifest': 'node gates/artifacts/check-dist-manifest.mjs --check',
  'check:asar': 'node gates/artifacts/check-asar-manifest.mjs',
  'check:release': 'node gates/artifacts/check-release-artifacts.mjs',
  'clean:dist': 'node build/clean-artifacts.mjs --target dist',
  'clean:release': 'node build/clean-artifacts.mjs --target release',
  build: 'tsc',
  typecheck: 'tsc --noEmit',
  lint: 'eslint src/',
  test: 'npm run build && electron test/acceptance.mjs',
  'test:coverage': 'npm run build && c8 electron test/acceptance.mjs',
  'check:fixtures': 'node gates/fixtures/gen-fixtures.mjs --check',
  'test:smoke': 'node gates/smoke/check-build-fresh.mjs && electron . --smoke',
  dist:
    'npm run clean:dist && npm run clean:release && npm run build && npm run gen:dist-manifest ' +
    '&& electron-builder && npm run check:dist-manifest && npm run check:asar && npm run check:release',
  'verify:ci':
    'npm run check:contract && npm run check:boundary && npm run check:pinned-actions && npm run check:docs && npm run check:archive-index ' +
    '&& npm run build && npm run typecheck && npm run lint ' +
    '&& npm run test:coverage && npm run check:fixtures && npm run test:smoke && npm run check:geometry',
  'verify:release': 'npm run verify:ci && npm run dist',
};

/**
 * 夹具内被 script / workflow 引用的占位文件:**从 FIXTURE_SCRIPTS 的命令正文派生**,不再手写。
 *
 * 派生口径与门禁自身的「被引用脚本文件存在性」那条断言同一条规则(命令正文里的代码文件路径),
 * 因此「哪些文件必须存在」这件事只登记一次:往 FIXTURE_SCRIPTS 加一条引用到
 * `<树>/xxx.mjs` 的命令,占位文件自动跟上,漏登记会让门禁因 `引用的文件不存在` 判红 ——
 * 而那正是夹具想测的形态。
 * @param {Record<string, string>} scripts 夹具的 npm scripts
 * @returns {string[]} 仓库相对 POSIX 路径(已排序)
 */
export function deriveFixturePlaceholders(scripts) {
  const tokenRe = /(?:^|\s)([\w.\\/'-]+\.(?:mjs|cjs|js|cts))(?=\s|$)/g;
  /** @type {Set<string>} */
  const found = new Set();
  for (const body of Object.values(scripts)) {
    for (const m of body.matchAll(tokenRe)) {
      const rel = m[1].replaceAll('\\', '/');
      if (rel !== CHECKER_RELATIVE) found.add(rel);
    }
  }
  return [...found].sort();
}

function writeFileIn(dir, relative, content) {
  const target = join(dir, relative);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** 在夹具内建一个目录(空目录也算「存在」:存在性断言看的是路径在不在) */
function makeDirIn(dir, relative) {
  mkdirSync(join(dir, relative), { recursive: true });
}

/** 造一份完整夹具,再由 mutate 打上漂移;返回夹具根目录 */
function createFixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-contract-selftest-'));
  const pkg = {
    name: 'fixture',
    version: '1.0.0',
    engines: { node: `>=${FLOOR}` },
    scripts: { ...FIXTURE_SCRIPTS },
    // 打包白名单:与真实仓库同构(显式白名单 + 交付面只有编译输出树与包清单)。少了它,
    // 「白名单引用的顶层面是否真实存在」那条断言在夹具里恒真空过 —— 恒过的断言等于没有。
    // 取反项刻意指向一个不存在的顶层:排除模式对「没有对象」不判红(见门禁里的判据 2)。
    build: { files: ['dist/**', 'package.json', '!deps-tree/**/*.map'], directories: { output: 'release' } },
  };
  const lock = {
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: { '': { name: 'fixture', version: '1.0.0', engines: { node: `>=${FLOOR}` } } },
  };
  const workflow = (verifyScript) =>
    [
      '# 注释里出现 node-version: 20 不应被当作配置',
      'on: push',
      'jobs:',
      '  a:',
      '    steps:',
      '      - uses: actions/checkout@v5',
      '      - uses: actions/setup-node@v5',
      '        with:',
      `          node-version: ${FLOOR}`,
      '      - run: node gates/repo/check-ci-contract.mjs',
      '      - run: npm ci --registry=https://registry.npmjs.org',
      '      - run: npm run --silent check:env',
      `      - run: npm run ${verifyScript}`,
      '',
    ].join('\n');

  writeFileIn(dir, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileIn(dir, 'package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
  writeFileIn(dir, '.github/workflows/ci.yml', workflow('verify:ci'));
  writeFileIn(dir, '.github/workflows/release.yml', workflow('verify:release'));
  writeFileIn(dir, 'tsconfig.json', `${JSON.stringify(FIXTURE_TSCONFIG, null, 2)}\n`);
  // 白名单正向引用的交付面在夹具里必须真实存在,否则「引用了不存在的顶层」那条断言恒红、
  // 基线用例反而变红。安装树只出现在取反模式里,故不必存在(它是随构建安装的)。
  makeDirIn(dir, 'dist');
  makeDirIn(dir, 'release');
  for (const placeholder of deriveFixturePlaceholders(FIXTURE_SCRIPTS)) {
    writeFileIn(dir, placeholder, '// fixture\n');
  }
  copyFileSync(checkerPath, join(dir, 'gates', 'repo', 'check-ci-contract.mjs'));
  // 被测门禁从 shared/paths.js 取项目根(ADR-040),并从 repo-manifest.mjs 派生顶层(ADR-037),
  // 链展开走 gates/repo/chain-expand.mjs(全仓单源);夹具内不带这三份的话,夹具会因
  // ERR_MODULE_NOT_FOUND 失败,而不是因被注入的漂移失败(那会让负向夹具假通过)。
  mkdirSync(join(dir, 'shared'), { recursive: true });
  copyFileSync(join(projectRoot, 'shared', 'paths.js'), join(dir, 'shared', 'paths.js'));
  copyFileSync(join(projectRoot, 'gates', 'repo', 'repo-manifest.mjs'), join(dir, 'gates', 'repo', 'repo-manifest.mjs'));
  copyFileSync(join(projectRoot, 'gates', 'repo', 'chain-expand.mjs'), join(dir, 'gates', 'repo', 'chain-expand.mjs'));

  // mutate 既可改内存中的 manifest(经下方回写落盘),也可直接改 workflow 文件
  mutate({ dir, pkg, lock });
  writeFileIn(dir, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileIn(dir, 'package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
  return dir;
}

/** 在夹具内跑契约自检,返回退出码与合并输出 */
function runChecker(dir) {
  const result = spawnSync(process.execPath, ['gates/repo/check-ci-contract.mjs'], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/** 读回夹具内文件并整串替换(便于对 JSON/YAML 做定点漂移) */
function patchInFixture(dir, relative, from, to) {
  const target = join(dir, relative);
  const current = readFileSync(target, 'utf8');
  if (!current.includes(from)) throw new Error(`夹具 ${relative} 中找不到待替换内容:${from}`);
  writeFileSync(target, current.replace(from, to), 'utf8');
}

/**
 * 同步改夹具的 engines 地板(package.json + lockfile 根包,两处必须一致,
 * 否则会先命中「lockfile 与 package.json 漂移」那条断言,测不到本条意图)。
 */
function setFixtureFloor(pkg, lock, floor) {
  pkg.engines.node = `>=${floor}`;
  lock.packages[''].engines.node = `>=${floor}`;
}

/**
 * 重写两个 workflow 的 node-version lane(原有那条就地替换,extraLanes 各起一条
 * setup-node 步骤,形态与 CI 预览 lane 一致)。
 * 两个 workflow 都要改:地板钉住断言是**逐 workflow** 判定的,只改一个等于
 * 让另一条报「没有 lane 钉住地板」,测不到版本比较本身。
 */
function setWorkflowLanes(dir, floor, extraLanes = []) {
  const block = [floor, ...extraLanes]
    .map((version, i) => (i === 0 ? '' : '      - uses: actions/setup-node@v5\n        with:\n') + `          node-version: ${version}`)
    .join('\n');
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    patchInFixture(dir, file, `          node-version: ${FLOOR}\n`, `${block}\n`);
  }
}

// 每条负向夹具须命中一个真实历史缺陷或现实漂移形态(旧 Node 20 流水线、乱序、
// 发布自建缩水清单、引用已删除脚本),而非人造噪声。
const CASES = [
  {
    name: '基线未漂移 → 通过',
    mutate: () => {},
    expect: null,
  },
  {
    name: '发布流水线回到低于地板的 Node 20',
    mutate: ({ dir }) => patchInFixture(dir, '.github/workflows/release.yml', `node-version: ${FLOOR}`, 'node-version: 20'),
    expect: /低于 engines 地板/,
  },
  {
    name: 'lockfile engines 与 package.json 漂移',
    mutate: ({ lock }) => {
      lock.packages[''].engines.node = '>=22.14.0';
    },
    expect: /package-lock\.json 根包 engines\.node/,
  },
  {
    name: 'typecheck 被挪到 build 之前',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace(
        'npm run build && npm run typecheck',
        'npm run typecheck && npm run build',
      );
    },
    expect: /须先 build 再 typecheck/,
  },
  {
    name: 'verify:release 自建缩水清单(绕过 coverage/fixture/smoke/geometry)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:release'] = 'npm run build && npm run test && npm run dist';
    },
    expect: /verify:release 须恰为 verify:ci \+ dist/,
  },
  {
    name: '几何门禁被移出 CI 链(布局漂移无人拦截)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace(' && npm run check:geometry', '');
    },
    expect: /verify:ci 缺少门禁步骤 check:geometry/,
  },
  {
    name: '几何门禁被提到链首(采样未构建/上次构建的界面)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = `npm run check:geometry && ${pkg.scripts['verify:ci']}`;
    },
    expect: /须先 build 再 check:geometry/,
  },
  {
    name: 'dist 链缺少 ASAR 核对(只打包不核对交付物)',
    mutate: ({ pkg }) => {
      pkg.scripts.dist = pkg.scripts.dist.replace(' && npm run check:asar', '');
    },
    expect: /scripts\.dist 缺少产物核对步骤 check:asar/,
  },
  {
    name: '产物核对被排到 electron-builder 之前(证明不了包内容来自本次构建)',
    mutate: ({ pkg }) => {
      pkg.scripts.dist =
        'npm run build && npm run check:dist-manifest && npm run check:asar ' +
        '&& electron-builder && npm run check:release';
    },
    expect: /check:dist-manifest 须在 electron-builder 之后/,
  },
  {
    name: 'dist 链不做前置清理(改名/删除源文件的残留产物会打进包)',
    mutate: ({ pkg }) => {
      pkg.scripts.dist = pkg.scripts.dist.replace('npm run clean:dist && ', '');
    },
    expect: /scripts\.dist 缺少前置步骤 clean:dist/,
  },
  {
    name: 'dist 链不清理 release 目录(历史版本安装包与本次产物并存)',
    mutate: ({ pkg }) => {
      pkg.scripts.dist = pkg.scripts.dist.replace('npm run clean:release && ', '');
    },
    expect: /scripts\.dist 缺少前置步骤 clean:release/,
  },
  {
    name: '清理被排到 build 之后(先构建再清理,等于没清)',
    mutate: ({ pkg }) => {
      pkg.scripts.dist = pkg.scripts.dist.replace(
        'npm run clean:dist && npm run clean:release && npm run build',
        'npm run clean:release && npm run clean:dist && npm run build',
      );
    },
    expect: /scripts\.dist 步骤乱序/,
  },
  {
    name: '清理目标越出白名单(试图删源码/文档目录)',
    mutate: ({ pkg }) => {
      pkg.scripts['clean:dist'] = 'node build/clean-artifacts.mjs --target src';
    },
    expect: /清理目标 src 不在白名单\(dist\/release\/all\)内/,
  },
  {
    name: 'clean 脚本未显式指定目标(隐式删除风险)',
    mutate: ({ pkg }) => {
      pkg.scripts['clean:release'] = 'node build/clean-artifacts.mjs';
    },
    expect: /scripts\.clean:release 未用 --target 显式指定清理目标/,
  },
  {
    name: 'script 引用已删除的脚本文件',
    mutate: ({ pkg }) => {
      pkg.scripts['test:smoke'] = 'node gates/removed.mjs && electron . --smoke';
    },
    expect: /引用的文件不存在:gates\/removed\.mjs/,
  },
  {
    name: 'workflow 调用不存在的 npm script',
    mutate: ({ dir }) => patchInFixture(dir, '.github/workflows/ci.yml', 'npm run verify:ci', 'npm run verify:gate'),
    expect: /引用了不存在的 npm script:verify:gate/,
  },
  {
    name: 'workflow 夹带 npm 开关调用的脚本不存在(开关不掩盖脚本名校验)',
    mutate: ({ dir }) => patchInFixture(dir, '.github/workflows/ci.yml', 'npm run --silent check:env', 'npm run --silent check:ghost'),
    expect: /引用了不存在的 npm script:check:ghost/,
  },
  {
    name: '地板 lane 退化为模糊主线别名(地板不可复现)',
    mutate: ({ dir }) => patchInFixture(dir, '.github/workflows/ci.yml', `node-version: ${FLOOR}`, 'node-version: 22'),
    expect: /没有任何 lane 精确钉住 engines 地板/,
  },
  {
    name: '依赖声明/层向门禁被移出 CI 链(传递依赖漏声明与层向漂移无人拦截)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace(' && npm run check:boundary', '');
    },
    expect: /verify:ci 缺少门禁步骤 check:boundary/,
  },
  {
    name: '依赖声明/层向门禁被排到 build 之后(漂移要白跑一次构建才被拦下)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace(
        ' && npm run check:boundary',
        '',
      ).replace('npm run build &&', 'npm run build && npm run check:boundary &&');
    },
    expect: /须先 check:boundary 再 build/,
  },
  {
    name: 'check:boundary 指向已不存在的脚本(门禁静默失效)',
    mutate: ({ dir }) => rmSync(join(dir, 'gates', 'repo', 'check-import-boundary.mjs'), { force: true }),
    expect: /引用的文件不存在:gates\/repo\/check-import-boundary\.mjs/,
  },
  {
    name: 'action 引用固定门禁被移出 CI 链(SHA 固定的补偿面无人守护)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace(' && npm run check:pinned-actions', '');
    },
    expect: /verify:ci 缺少门禁步骤 check:pinned-actions/,
  },
  {
    name: 'action 引用固定门禁被排到 build 之后(漂移要白跑一次构建才被拦下)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci']
        .replace(' && npm run check:pinned-actions', '')
        .replace('npm run build &&', 'npm run build && npm run check:pinned-actions &&');
    },
    expect: /须先 check:pinned-actions 再 build/,
  },
  {
    name: 'check:pinned-actions 指向已不存在的脚本(门禁静默失效)',
    mutate: ({ dir }) => rmSync(join(dir, 'gates', 'repo', 'check-pinned-actions.mjs'), { force: true }),
    expect: /引用的文件不存在:gates\/repo\/check-pinned-actions\.mjs/,
  },
  // ---- 全量验收段的形态(只跑一遍、只跑插桩那一遍)----
  {
    name: '覆盖率门禁被移出 CI 链(c8 阈值与 check:coverage-zero 失去唯一执行者)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace(' && npm run test:coverage', '');
    },
    expect: /全量验收只保留插桩那一遍/,
  },
  {
    name: '全量验收被改成裸跑(以为不带插桩也能守住覆盖率门禁)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace('npm run test:coverage', 'npm run test');
    },
    expect: /全量验收只保留插桩那一遍/,
  },
  {
    name: '裸跑那一遍被加回链内(同一批段跑两遍,对覆盖率数据零贡献)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace(
        ' && npm run test:coverage',
        ' && npm run test && npm run test:coverage',
      );
    },
    expect: /全量验收只保留插桩那一遍/,
  },
  // ---- 版本比较的 prerelease 语义(semver 优先级,非字符串比)----
  {
    name: '预发布地板 + 更高预发布 lane(beta 之间可比)→ 通过',
    mutate: ({ dir, pkg, lock }) => {
      setFixtureFloor(pkg, lock, '22.13.0-beta.1');
      setWorkflowLanes(dir, '22.13.0-beta.1', ['22.13.0-beta.2', '22.13.0']);
    },
    expect: null,
  },
  {
    name: '正式地板 + 同数值段预发布 lane(1.0.0-beta.1 < 1.0.0)',
    mutate: ({ dir }) => setWorkflowLanes(dir, FLOOR, ['22.13.0-beta.1']),
    expect: /低于 engines 地板/,
  },
  {
    name: '预发布地板 + 更低预发布 lane(beta.1 < beta.2,不得按字符串比)',
    mutate: ({ dir, pkg, lock }) => {
      setFixtureFloor(pkg, lock, '22.13.0-beta.2');
      setWorkflowLanes(dir, '22.13.0-beta.2', ['22.13.0-beta.1']);
    },
    expect: /低于 engines 地板/,
  },
  {
    name: 'node-version 用 build 元数据(不受支持的写法,不得静默放行)',
    mutate: ({ dir }) => setWorkflowLanes(dir, FLOOR, ['22.13.0+build.5']),
    expect: /是不受支持的写法/,
  },
  // ---- 打包白名单与实际顶层一致(此前只断言 asar 产出后的顶层三项,白名单本身无人核对)----
  {
    name: '白名单引用了不存在的顶层(目录迁移后忘了跟白名单)',
    mutate: ({ pkg }) => {
      pkg.build.files = ['dist/**', 'package.json', 'gone-tree/**'];
    },
    expect: /build\.files 引用的顶层不存在:gone-tree/,
  },
  {
    name: '白名单正向模式覆盖了源码树(源码/夹具随安装包发出去)',
    mutate: ({ pkg }) => {
      pkg.build.files = ['dist/**', 'package.json', 'test/**'];
    },
    expect: /覆盖了非交付面 test\(类别 source\)/,
  },
  {
    name: '白名单正向模式覆盖了新增的顶层目录(派生判据须点名它,而不是靠人记得加断言)',
    mutate: ({ dir, pkg }) => {
      writeFileIn(dir, 'extra-tree/tool.mjs', 'export const t = 1;\n');
      pkg.build.files = ['dist/**', 'package.json', 'extra-tree/**'];
    },
    expect: /覆盖了非交付面 extra-tree/,
  },
  {
    name: '白名单漏掉编译输出树(包是空的)',
    mutate: ({ pkg }) => {
      pkg.build.files = ['package.json'];
    },
    expect: /未覆盖编译输出树 dist/,
  },
  {
    name: 'build.files 缺失(打包退回 electron-builder 默认集,等于撤回显式白名单)',
    mutate: ({ pkg }) => {
      delete pkg.build;
    },
    expect: /build\.files 必须是显式白名单数组/,
  },
  {
    name: '取反模式指向不存在的顶层 → 通过(排除模式没有对象时不判红;干净检出里安装树本来就不存在)',
    mutate: () => {},
    expect: null,
  },
  /* ---- 链解析单源化(REQ-111):两种语义都必须守住,否则「拆链」是一次静默降级 ----
   *
   * 下面四条是**回归护栏**,不是新判据:它们钉住的是「递归视图看得见内层、顶层视图看不见
   * 内层」这组既有语义。若有人把两者合并成一个函数,前两条会红(顶层视图开始递归)或
   * 后两条会红(递归视图退化成单层)—— 那正是本次收敛要防的退化方向。 */
  {
    // 拆链实测(正向):把链首三步包进子脚本,递归视图必须照样看得见每个内层门禁。
    // 收敛前此处用的是本文件内联的扁平 split,只看顶层 ⇒ 三个必备步骤全部「消失」⇒ 判红。
    name: 'verify:ci 把契约/边界/action 三步包进子脚本 → 仍通过(递归展开看得见内层)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci:head'] =
        'npm run check:contract && npm run check:boundary && npm run check:pinned-actions';
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace(
        'npm run check:contract && npm run check:boundary && npm run check:pinned-actions &&',
        'npm run verify:ci:head &&',
      );
    },
    expect: null,
  },
  {
    // 拆链实测(负向):内层漏掉一道 → 递归视图仍须点名它。判据只许精确不许放松:
    // 若展开退化成单层,这条会因「恰好没报错」而变红(报的是别的漂移或干脆通过)。
    name: '子脚本里少一道门禁(拆链后内层漏 boundary)→ 判红',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci:head'] = 'npm run check:contract && npm run check:pinned-actions';
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace(
        'npm run check:contract && npm run check:boundary && npm run check:pinned-actions &&',
        'npm run verify:ci:head &&',
      );
    },
    expect: /verify:ci 缺少门禁步骤 check:boundary/,
  },
  {
    // 顶层视图的**非递归**语义:verify:release 自己复制一份内层步骤(成员齐全、顺序正确)
    // 仍须判红 —— 那正是「不维护第二份清单」这条断言要拦的漂移。递归化会放过它。
    name: 'verify:release 自行复制内层步骤(成员齐全)→ 判红(顶层形态断言,不得递归化)',
    mutate: ({ pkg }) => {
      // 内层步骤用展开器取(不另写一份切段):夹具自己复制一份链解析,就成了第 6 份实现,
      // 而它漂移时上面的断言会以「夹具构造错」的形式失败,而不是以「判据失守」的形式。
      const inner = expandChainScriptNames(pkg.scripts, 'verify:ci')
        .map((name) => `npm run ${name}`)
        .join(' && ');
      pkg.scripts['verify:release'] = `${inner} && npm run dist`;
    },
    expect: /verify:release 须恰为 verify:ci \+ dist/,
  },
  {
    // 重复项必须如实计出:同一个子脚本被两处调用时展开结果里出现两次。
    // 若展开器顺手去重,「全量验收段恰跑一遍」那条计数断言会自欺(被调两次记成一次)。
    name: '同一子脚本被调两次 → 计数断言看得见两次(展开不得去重)',
    mutate: ({ pkg }) => {
      pkg.scripts['verify:ci'] = pkg.scripts['verify:ci'].replace(' && npm run test:coverage', ' && npm run test:coverage && npm run test:coverage');
    },
    expect: /verify:ci 全量验收只保留插桩那一遍/,
  },
];

const failures = [];
for (const testCase of CASES) {
  const dir = createFixture(testCase.mutate);
  try {
    const { code, output } = runChecker(dir);
    if (testCase.expect === null) {
      if (code === 0) {
        console.log(`[ok] contract-selftest:${testCase.name}(自检通过,exit 0)`);
      } else {
        failures.push(`${testCase.name}:期望通过,实际 exit ${code}\n${output}`);
      }
      continue;
    }
    if (code !== 0 && testCase.expect.test(output)) {
      console.log(`[ok] contract-selftest:${testCase.name}(漂移被拦截,exit ${code})`);
    } else {
      failures.push(
        `${testCase.name}:期望 exit≠0 且输出匹配 ${testCase.expect},实际 exit ${code}\n${output}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ================= 链展开器的直锚点(展开层本身必须有自检) =================
 *
 * 上面的夹具证明「链解析**用到**的地方真会判红」;这一段直接对展开器求值,证明它自己不会恒绿
 * —— 恒绿的展开器会让上面每一条夹具都失去意义(它们断言的诊断全都来自展开结果)。
 * 三条,分别对应展开器的三项能力:
 *   ① 递归视图看得见内层(嵌套两层仍被展开)—— 单层实现必红;
 *   ② 顶层视图**不**递归(只返回一层)—— 与 ① 是一对,少任一条语义就有一半判据失效;
 *   ③ 成环不挂死且被回报 —— 静默跳过 = 恒绿。
 * 外加两条把「收敛」这件事本身钉住:菱形依赖(两父调同一子)不得被当成环,未定义 script 必须回报。
 */
const expandFailures = [];

/** 断言辅助(失败项收集口径与上面一致) */
function checkExpander(condition, message) {
  if (!condition) expandFailures.push(message);
}

/** 三层链:a → b → c,外加一个叶子命令与一个 npm 开关形态的调用 */
const EXPAND_SCRIPTS = {
  a: 'npm run b && echo step-a',
  b: 'npm run --silent c',
  c: 'echo step-c',
  // 菱形:a 与 d 都调 b。b 不是环,两次出现都要如实计出(去重会让计数类断言自欺)。
  d: 'npm run b',
  // 真环:loop → loop2 → loop。
  loop: 'npm run loop2',
  loop2: 'npm run loop',
  // 悬空引用:调用了不存在的脚本。
  dangling: 'npm run nowhere',
};

const expanded = expandChainScriptNames(EXPAND_SCRIPTS, 'a');
// 深度优先:a 的段序是 b、echo step-a ⇒ 先收 b,再收 b 的后代 c,最后叶子不参与。
checkExpander(
  expanded.join(',') === 'b,c',
  `递归展开失守「嵌套两层」:a → b → c 期望 b,c,实际 ${expanded.join(',') || '空'}`,
);
// npm 开关形态(`npm run --silent c`)必须被认出来 —— 窄的正则会让它在链上凭空消失。
checkExpander(
  expanded.includes('c'),
  `递归展开失守:脚本名前的 npm 开关(--silent)让内层调用消失(实际 ${expanded.join(',') || '空'})`,
);

// 顶层视图:同一份 scripts,a 的顶层只有 b(不递归到 c)。
const aTopLevel = topLevelScriptNames(EXPAND_SCRIPTS, 'a');
checkExpander(
  aTopLevel.names.join(',') === 'b' && !aTopLevel.missing,
  `顶层视图失守「不递归」:a 的顶层子 script 期望恰为 b,实际 ${aTopLevel.names.join(',') || '空'}(missing=${String(aTopLevel.missing)})`,
);
checkExpander(
  !aTopLevel.names.includes('c'),
  `顶层视图失守:它递归到了内层(c)—— 「verify:release 恰为 verify:ci + dist」那条形态断言会被架空`,
);
// 未定义 script 由 missing 回报,而不是静默给空数组(判红权在调用方,但事实必须传出去)。
checkExpander(
  topLevelScriptNames(EXPAND_SCRIPTS, 'nope').missing,
  '顶层视图失守:未定义的 script 未被 missing 回报(静默空数组 = 恒绿)',
);

// 成环:必须终止并回报环路径(a → b → a 那样的首尾同名序列)。
/** @type {string[][]} */
const cycles = [];
/** @type {string[]} */
const missingSeen = [];
expandChainScriptNames(EXPAND_SCRIPTS, 'loop', {
  onCycle: (path) => cycles.push(path),
  onMissing: (name) => missingSeen.push(name),
});
checkExpander(
  cycles.length === 1 && cycles[0]?.join('>') === 'loop>loop2>loop',
  `成环保护失守:期望回报 1 条环路径 loop>loop2>loop,实际 ${cycles.length} 条:${cycles.map((p) => p.join('>')).join(' | ') || '无'}(未挂死,但环没被看见 = 恒绿)`,
);
// 悬空引用必须回报 missing,而不是当作叶子命令或静默跳过。
expandChainScriptNames(EXPAND_SCRIPTS, 'dangling', { onMissing: (name) => missingSeen.push(name) });
checkExpander(
  missingSeen.includes('nowhere'),
  `未定义 script 未被回报(实际回报 ${missingSeen.join(',') || '无'})—— 调用方会以为链是空的`,
);

// 菱形不是环:a → b 与 d → b,两次出现都要计出。
/** @type {string[][]} */
const diamondCycles = [];
const diamond = expandChainScriptNames(EXPAND_SCRIPTS, 'd', { onCycle: (p) => diamondCycles.push(p) });
checkExpander(
  diamond.join(',') === 'b,c' && diamondCycles.length === 0,
  `菱形依赖失守:d → b → c 期望 b,c 且零环,实际 ${diamond.join(',') || '空'}(环 ${diamondCycles.length} 条)`,
);

// 叶子命令序列 = 深度优先的真实执行序(探针取 c8 参数向量走的就是这条路径)。
/** @type {string[]} */
const leaves = [];
walkChain(EXPAND_SCRIPTS, 'a', { onLeaf: (leaf) => leaves.push(leaf.text) });
checkExpander(
  leaves.join(' | ') === 'echo step-c | echo step-a',
  `叶子命令序失守:期望 "echo step-c | echo step-a"(深度优先 = 执行序),实际 "${leaves.join(' | ')}"`,
);

if (expandFailures.length > 0) {
  for (const failure of expandFailures) console.error(`[contract-selftest:fail] ${failure}`);
  console.error(`[contract-selftest:fail] 链展开器直锚点失败,共 ${expandFailures.length} 项`);
  process.exit(1);
}
console.log(
  `[ok] contract-selftest:链展开器直锚点(递归两层 / 顶层不递归 / 成环与悬空回报 / 菱形非环 / 叶子执行序)全部通过`,
);

/* ================= 顶层派生的双向锚点(ADR-037 后果:派生层本身必须有自检) =================
 *
 * 上面的夹具证明「派生结果**用到**的地方真会判红」;这一段证明「派生这一层自己不会恒绿」。三条:
 *   ① 改名不改类别 —— 造一棵**全部用任意名**的顶层目录树,断言类别仍落在同一档。若判据里混进
 *      任何具体目录名(哪怕只是 if (name === '…')),这一条必红。这比「源码里不许出现目录名」的
 *      文本扫描更硬:它直接证明名字不参与判定。
 *   ② 新增顶层目录自动进保护集与镜像集 —— 「零处需要手改」的可执行版本:断言点名那个新目录。
 *      同时钉住一处**有意的边界**(既无代码也无文档、无声明指向的裸目录不进保护集),否则将来
 *      有人「顺手收紧」时不会知道 clean-artifacts-gate 的正向锚点依赖这条边界。
 *   ③ 真实仓库上只断言关系(不写具体名字 —— 写名字就是新造一处枚举)。
 */

const manifestFailures = [];

/** 断言辅助(失败项收集口径与上面的夹具一致) */
function checkAnchor(condition, message) {
  if (!condition) manifestFailures.push(message);
}

/**
 * 任意名的合成顶层树:顶层名与本仓真实名字**刻意不同**,故「类别由内容决定」这件事一旦被破坏,
 * 下面的断言会立刻红。
 */
const SYNTHETIC_TOP_LEVEL = {
  // 声明面:包清单(靠 name+scripts 认出)、锁文件(靠 lockfileVersion)、两份编译配置、忽略声明
  'pkg-manifest.json': `${JSON.stringify({ name: 'synthetic', version: '1.0.0', scripts: { s: 'node gamma/gate.mjs' }, build: { files: ['omega/**', 'pkg-manifest.json'], directories: { output: 'zeta' } } }, null, 2)}\n`,
  'lock-a.json': `${JSON.stringify({ name: 'synthetic', version: '1.0.0', lockfileVersion: 3 }, null, 2)}\n`,
  'tsconfig.json': `${JSON.stringify({ compilerOptions: { outDir: 'omega', rootDir: 'alpha' }, include: ['alpha'] }, null, 2)}\n`,
  'tsconfig.aux.json': `${JSON.stringify({ extends: './tsconfig.json', compilerOptions: { noEmit: true, rootDir: '.' }, include: ['beta'] }, null, 2)}\n`,
  '.gitignore': 'theta/\nzeta/\niota/\n',
  // 内容面:每棵树一个不同的形态
  'alpha/impl.ts': 'export const a = 1;\n',
  'omega/impl.js': 'export const w = 1;\n',
  'beta/case.mjs': 'export const b = 1;\n',
  'gamma/gate.mjs': 'export const g = 1;\n',
  'delta/mech.js': 'export const d = 1;\n',
  'epsilon/REQ.md': '# req\n',
  'epsilon/PLAN.md': '# plan\n',
  'epsilon/adr/one.md': '# adr\n',
  'zeta/Setup.exe': 'stub\n',
  'zeta/latest.yml': 'a: 1\n',
  'iota/report.json': '{}\n',
  'theta/.package-lock.json': '{ "lockfileVersion": 3 }\n',
  'theta/pkg-a/package.json': '{ "name": "pkg-a" }\n',
  'theta/pkg-a/index.js': 'module.exports = 1;\n',
  'eta/tool.mjs': 'export const e = 1;\n',
  'kappa/note.txt': 'note\n',
  '.vcsdir/state.yml': 'a: 1\n',
};

/** 合成树里每个顶层名 → 期望类别(期望值本身不含任何本仓真实目录名) */
const SYNTHETIC_EXPECTED = {
  '.gitignore': 'vcs',
  '.vcsdir': 'vcs',
  alpha: 'source',
  beta: 'verify',
  delta: 'shared',
  eta: 'shared',
  epsilon: 'doc',
  gamma: 'verify',
  iota: 'artifact',
  kappa: 'other',
  'lock-a.json': 'config',
  'pkg-manifest.json': 'config',
  theta: 'deps',
  'tsconfig.aux.json': 'config',
  'tsconfig.json': 'config',
  omega: 'build',
  zeta: 'artifact',
};

const syntheticRoot = mkdtempSync(join(tmpdir(), 'm2w-manifest-selftest-'));
try {
  for (const [relative, content] of Object.entries(SYNTHETIC_TOP_LEVEL)) {
    writeFileIn(syntheticRoot, relative, content);
  }
  const synthetic = scanTopLevel(syntheticRoot);
  const actual = synthetic.entries.map((entry) => `${entry.name}=${entry.category}`).join(',');
  const expected = Object.keys(SYNTHETIC_EXPECTED)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `${name}=${SYNTHETIC_EXPECTED[name]}`)
    .join(',');
  checkAnchor(
    actual === expected,
    `顶层分类派生失守「改名不改类别」:合成树(全部任意名)实际 ${actual},期望 ${expected}`,
  );
  console.log(
    `[ok] contract-selftest:顶层分类派生(任意名合成树 ${synthetic.entries.length} 个顶层,类别与名字无关) 断言通过`,
  );

  // ② 新增顶层目录自动跟进(负向锚点的对象就叫 eta)
  checkAnchor(
    synthetic.mirrorPaths.includes('eta'),
    `新增顶层目录 eta 未自动进镜像集(实际 ${synthetic.mirrorPaths.join(',')})—— 「零处手改」失效`,
  );
  checkAnchor(
    synthetic.cleanProtectedSegments.includes('eta'),
    `新增顶层目录 eta 未自动进删除保护区(实际 ${synthetic.cleanProtectedSegments.join(',')})`,
  );
  checkAnchor(
    !synthetic.cleanProtectedSegments.includes('kappa') && !synthetic.mirrorPaths.includes('kappa'),
    '裸目录 kappa(无代码/无文档/无声明)不该进保护集与镜像集 —— clean-artifacts-gate 的守卫可达性正向锚点依赖这条边界',
  );
  // 交付面与安装树:输出树必须整树镜像(测试 import 产物),锁文件不镜像但受保护
  checkAnchor(synthetic.mirrorPaths.includes('omega'), '编译输出树 omega 应整树进镜像集(测试 import 的是产物)');
  checkAnchor(
    !synthetic.mirrorPaths.includes('lock-a.json') && synthetic.cleanProtectedSegments.includes('lock-a.json'),
    '锁文件不该进镜像集(依赖是联接挂入的),但应在删除保护区里',
  );
  checkAnchor(
    !synthetic.cleanProtectedSegments.includes('omega') && !synthetic.cleanProtectedSegments.includes('zeta'),
    '声明为产物的目录(编译输出树 / 打包输出目录)不该出现在删除保护区里,否则清理脚本会拒绝自己的目标',
  );
  console.log('[ok] contract-selftest:新增顶层目录自动进镜像集与删除保护区(含「裸目录不进」这条有意边界) 断言通过');
} finally {
  rmSync(syntheticRoot, { recursive: true, force: true });
}

// 占位文件清单的派生:自身也必须有锚点(否则「派生恒为空」会静默放过)
const derivedPlaceholders = deriveFixturePlaceholders(FIXTURE_SCRIPTS);
checkAnchor(derivedPlaceholders.length > 0, '占位文件派生为空(抽取规则失效,夹具会因「引用的文件不存在」误红)');
checkAnchor(
  derivedPlaceholders.includes('build/clean-artifacts.mjs') && !derivedPlaceholders.includes(CHECKER_RELATIVE),
  `占位文件派生失守:应含一条门禁脚本、不含被逐字节复制的被测门禁本身(实际 ${derivedPlaceholders.join(',')})`,
);
const placeholderProbe = deriveFixturePlaceholders({
  ...FIXTURE_SCRIPTS,
  'check:probe': 'node gates/extra-gate.mjs && echo done',
});
checkAnchor(
  placeholderProbe.includes('gates/extra-gate.mjs') && placeholderProbe.length === derivedPlaceholders.length + 1,
  `占位文件派生失守:新增一条引用后应恰好多出一个占位(实际 ${placeholderProbe.join(',')})`,
);
console.log(
  `[ok] contract-selftest:夹具占位文件从命令正文派生(${derivedPlaceholders.length} 个,新增引用自动跟上) 断言通过`,
);

// ③ 真实仓库:只断言关系,不写具体名字
const real = topLevel(projectRoot);
checkAnchor(new Set(real.mirrorPaths).size === real.mirrorPaths.length, '镜像集有重复项');
checkAnchor(
  real.mirrorPaths.every((name) => real.names.includes(name)),
  `镜像集含不存在的顶层:${real.mirrorPaths.filter((name) => !real.names.includes(name)).join(',')}`,
);
checkAnchor(
  real.protectedTreePaths.length >= real.mirrorPaths.length &&
    real.mirrorPaths.every((name) => real.protectedTreePaths.includes(name)),
  '指纹集应覆盖镜像集(沙盒带过去的每个面都要能看出「真实工作树被写过」)',
);
checkAnchor(
  real.buildOutputNames.every((name) => real.mirrorPaths.includes(name)),
  '编译输出树不在镜像集里 —— 沙盒内测试 import 的是产物,不带过去必然失败',
);
checkAnchor(
  real.cleanProtectedSegments.every(
    (name) => !real.buildOutputNames.includes(name) && !real.packOutputNames.includes(name),
  ),
  '删除保护区与「声明为产物的目录」相交(清理脚本会拒绝自己的目标)',
);
checkAnchor(real.manifestName !== null, '认不出包清单(声明识别的键失效)');
checkAnchor(real.lockfileName !== null, '认不出锁文件(声明识别的键失效)');
checkAnchor(
  real.entries.every((entry) => entry.reason !== ''),
  '有顶层条目没有判定依据(诊断会退化成「未知」)',
);
console.log(
  `[ok] contract-selftest:真实仓库顶层派生的关系不变量(${real.entries.length} 个顶层,类别 ${[...new Set(real.entries.map((e) => e.category))].sort().join('/')}) 断言通过`,
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`[contract-selftest:fail] ${failure}`);
  console.error(`[contract-selftest:fail] 契约自检回归守护失败,共 ${failures.length}/${CASES.length} 条夹具`);
  process.exit(1);
}
if (manifestFailures.length > 0) {
  for (const failure of manifestFailures) console.error(`[contract-selftest:fail] ${failure}`);
  console.error(`[contract-selftest:fail] 顶层派生锚点失败,共 ${manifestFailures.length} 项`);
  process.exit(1);
}
console.log(
  `[ok] contract-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截);`
  + '链展开器直锚点与顶层派生锚点全部通过',
);
