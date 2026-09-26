// 契约自检脚本自身的回归守护(负向夹具)。
//
// verify:ci 的第一道门是 check:contract;若该脚本被改成「永远通过」或某个断言被
// 误删,配置漂移(Node 口径、门禁链缩水、build/typecheck 与几何门禁乱序、依赖声明/
// 层向门禁与 action 引用固定门禁被移出或排到构建之后、前置清理被移出/乱序、清理
// 目标越界、产物核对被移出
// 或排到打包之前、脚本缺失)就会静默放行
// 发布,没有任何其他检查能发现。此处用
// 临时夹具逐条制造漂移,断言自检脚本
// 确实以非零码拒绝,并断言未漂移时通过。纯 fs + 子进程,无产物:临时目录
// 写在系统临时目录并在 finally 清理(测试对象是夹具,不是本仓库文件)。

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const checkerPath = join(projectRoot, 'scripts', 'check-ci-contract.mjs');

const FLOOR = '22.13.0';

/** 夹具基线:与真实仓库同构的门禁链(verify:ci 全步含几何门禁 + verify:release 追加 dist) */
const FIXTURE_SCRIPTS = {
  'check:contract': 'node scripts/check-ci-contract.mjs',
  'check:boundary': 'node scripts/check-import-boundary.mjs',
  'check:pinned-actions': 'node scripts/check-pinned-actions.mjs',
  'check:env': 'node scripts/print-env-fingerprint.mjs',
  'check:geometry': 'electron scripts/check-geometry.mjs',
  'gen:dist-manifest': 'node scripts/check-dist-manifest.mjs',
  'check:dist-manifest': 'node scripts/check-dist-manifest.mjs --check',
  'check:asar': 'node scripts/check-asar-manifest.mjs',
  'check:release': 'node scripts/check-release-artifacts.mjs',
  'clean:dist': 'node scripts/clean-artifacts.mjs --target dist',
  'clean:release': 'node scripts/clean-artifacts.mjs --target release',
  build: 'tsc',
  typecheck: 'tsc --noEmit',
  lint: 'eslint src/',
  test: 'npm run build && electron test/acceptance.mjs',
  'test:coverage': 'npm run build && c8 electron test/acceptance.mjs',
  'check:fixtures': 'node test/tools/gen-fixtures.mjs --check',
  'test:smoke': 'node scripts/check-build-fresh.mjs && electron . --smoke',
  dist:
    'npm run clean:dist && npm run clean:release && npm run build && npm run gen:dist-manifest ' +
    '&& electron-builder && npm run check:dist-manifest && npm run check:asar && npm run check:release',
  'verify:ci':
    'npm run check:contract && npm run check:boundary && npm run check:pinned-actions && npm run build && npm run typecheck && npm run lint && npm run test ' +
    '&& npm run test:coverage && npm run check:fixtures && npm run test:smoke && npm run check:geometry',
  'verify:release': 'npm run verify:ci && npm run dist',
};

/** 夹具内被 script 引用的占位文件(内容无关,只需存在) */
const FIXTURE_PLACEHOLDERS = [
  'test/acceptance.mjs',
  'test/tools/gen-fixtures.mjs',
  'scripts/check-build-fresh.mjs',
  'scripts/check-geometry.mjs',
  'scripts/check-dist-manifest.mjs',
  'scripts/check-asar-manifest.mjs',
  'scripts/check-release-artifacts.mjs',
  'scripts/check-import-boundary.mjs',
  'scripts/check-pinned-actions.mjs',
  'scripts/clean-artifacts.mjs',
  'scripts/print-env-fingerprint.mjs',
];

function writeFileIn(dir, relative, content) {
  const target = join(dir, relative);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** 造一份完整夹具,再由 mutate 打上漂移;返回夹具根目录 */
function createFixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-contract-selftest-'));
  const pkg = { name: 'fixture', version: '1.0.0', engines: { node: `>=${FLOOR}` }, scripts: { ...FIXTURE_SCRIPTS } };
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
      '      - run: node scripts/check-ci-contract.mjs',
      '      - run: npm ci --registry=https://registry.npmjs.org',
      '      - run: npm run --silent check:env',
      `      - run: npm run ${verifyScript}`,
      '',
    ].join('\n');

  writeFileIn(dir, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileIn(dir, 'package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
  writeFileIn(dir, '.github/workflows/ci.yml', workflow('verify:ci'));
  writeFileIn(dir, '.github/workflows/release.yml', workflow('verify:release'));
  for (const placeholder of FIXTURE_PLACEHOLDERS) writeFileIn(dir, placeholder, '// fixture\n');
  copyFileSync(checkerPath, join(dir, 'scripts', 'check-ci-contract.mjs'));

  // mutate 既可改内存中的 manifest(经下方回写落盘),也可直接改 workflow 文件
  mutate({ dir, pkg, lock });
  writeFileIn(dir, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileIn(dir, 'package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
  return dir;
}

/** 在夹具内跑契约自检,返回退出码与合并输出 */
function runChecker(dir) {
  const result = spawnSync(process.execPath, ['scripts/check-ci-contract.mjs'], {
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
      pkg.scripts['clean:dist'] = 'node scripts/clean-artifacts.mjs --target src';
    },
    expect: /清理目标 src 不在白名单\(dist\/release\/all\)内/,
  },
  {
    name: 'clean 脚本未显式指定目标(隐式删除风险)',
    mutate: ({ pkg }) => {
      pkg.scripts['clean:release'] = 'node scripts/clean-artifacts.mjs';
    },
    expect: /scripts\.clean:release 未用 --target 显式指定清理目标/,
  },
  {
    name: 'script 引用已删除的脚本文件',
    mutate: ({ pkg }) => {
      pkg.scripts['test:smoke'] = 'node scripts/removed.mjs && electron . --smoke';
    },
    expect: /引用的文件不存在:scripts\/removed\.mjs/,
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
    mutate: ({ dir }) => rmSync(join(dir, 'scripts', 'check-import-boundary.mjs'), { force: true }),
    expect: /引用的文件不存在:scripts\/check-import-boundary\.mjs/,
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
    mutate: ({ dir }) => rmSync(join(dir, 'scripts', 'check-pinned-actions.mjs'), { force: true }),
    expect: /引用的文件不存在:scripts\/check-pinned-actions\.mjs/,
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

if (failures.length > 0) {
  for (const failure of failures) console.error(`[contract-selftest:fail] ${failure}`);
  console.error(`[contract-selftest:fail] 契约自检回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] contract-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);
