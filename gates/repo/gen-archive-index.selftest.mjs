// 归档索引生成器自身的回归守护(负向夹具;`check:archive-index` 跑的是它的 --check 模式)。
//
// gen-archive-index.mjs 是 verify:ci 链上的文档侧门禁:若「分流去向」检索退化成恒返回
// null(全表记 —)、或形态断言被摘掉、或 --check 被改成无条件通过,本脚本会打印 `[ok]` 而
// `docs/evidence/INDEX.md` 静默烂掉 —— 新增归档原文后要手改三处、少改一处都不报错的
// 那种漂移正是它要拦的。此处用临时夹具逐条制造这些漂移,断言生成器/校验确实以非零码
// 拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体**:夹具 = 把生成器原样拷进临时目录的 gates/repo/(它的 projectRoot
// 由 `new URL('..', import.meta.url)` 推导,故拷贝后 docs/ 自动指向夹具根),配一棵最小
// docs/ 树。真实仓库只被**读**(baseline 那一条跑真实 docs/ 且带 --check,零写入)。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则
// 系统临时区会堆满夹具树。

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'gates', 'repo', 'gen-archive-index.mjs');

const INDEX_REL = 'docs/evidence/INDEX.md';

/** 夹具里的两份归档原文:一份被 docs/REQ.md 按名引用(应取可点链接),一份未被引用(应记 —) */
const ARCHIVE_HOSTED = '20260101-101010-REQ-999-宿主引用.md';
const ARCHIVE_ORPHAN = '20260101-202020-REF-888-无宿主.md';

function writeUnder(root, rel, body = '# fixture\n') {
  const target = join(root, ...rel.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, body, 'utf8');
}

/**
 * 造一份夹具:拷贝生成器本体 + 最小 docs/ 树(evidence/ 下含本索引与说明页,二者都应被
 * 排除在表外),再由 mutate 打上漂移。
 */
function createFixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-archive-index-selftest-'));
  mkdirSync(join(dir, 'gates', 'repo'), { recursive: true });
  copyFileSync(checkerPath, join(dir, 'gates', 'repo', 'gen-archive-index.mjs'));
  // 被测生成器从 shared/paths.js 取项目根(ADR-040),夹具内必须带一份
  mkdirSync(join(dir, 'shared'), { recursive: true });
  copyFileSync(join(projectRoot, 'shared', 'paths.js'), join(dir, 'shared', 'paths.js'));
  writeUnder(dir, `docs/evidence/${ARCHIVE_HOSTED}`);
  writeUnder(dir, `docs/evidence/${ARCHIVE_ORPHAN}`);
  writeUnder(dir, 'docs/evidence/README.md', '# evidence 说明页\n');
  writeUnder(dir, 'docs/REQ.md', `# 需求台账\n\n见 \`${ARCHIVE_HOSTED}\`。\n`);
  // 第二个常驻载体:不放任何归档原文的按名引用,验证「未被引用的原文分流去向记 —」。
  // 载体名取 CHANGELOG.md 而非 PLAN.md:后者在生成器的 HOST_EXCLUDE_FILES 里(临时载体不入表),
  // 换成它会让这条夹具退化成「没有第二个载体」,白送一条覆盖。
  writeUnder(dir, 'docs/CHANGELOG.md', '# 变更日志\n\n(不按名引用任何归档原文)\n');
  // mutate 抛异常时调用方拿不到 dir,其 finally 清不到 → 在这里兜住(临时产物不留残)
  try {
    mutate?.(dir);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return dir;
}

/** 在夹具上跑生成器;返回退出码与合并输出。`check` = true 时带 --check */
function runChecker(dir, { check = true } = {}) {
  const args = check ? ['--check'] : [];
  const result = spawnSync(process.execPath, [join(dir, 'gates', 'repo', 'gen-archive-index.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/** 读夹具里生成出的索引正文 */
function readIndex(dir) {
  return readFileSync(join(dir, ...INDEX_REL.split('/')), 'utf8');
}

// 每条负向夹具须命中一个真实历史缺陷或现实漂移形态,而非人造噪声。
const CASES = [
  {
    name: '真实仓库当前索引与目录一致 → 通过',
    dir: projectRoot,
    expect: null,
  },
  {
    // 好样例不能只测「--check 绿」,还要证明生成出来的内容本身是对的
    name: '先重生成再 --check → 通过,且分流去向列按名引用取链接、未引用记 —',
    prepare: (dir) => {
      const gen = runChecker(dir, { check: false });
      if (gen.code !== 0) throw new Error(`重生成失败:${gen.output}`);
    },
    expect: null,
    also: (dir) => {
      const index = readIndex(dir);
      if (index.includes(ARCHIVE_ORPHAN) === false) throw new Error('索引缺未被引用的那份归档原文');
      if (!index.includes(`[REQ.md](../REQ.md)`)) throw new Error('「分流去向」列未对被按名引用的原文取可点链接');
      if (!/\|\s*—\s*\|/.test(index)) throw new Error('未被按名引用的原文未记 —');
      if (index.includes('README.md](')) throw new Error('说明页被登记进了表(应排除)');
    },
  },
  {
    name: '形态豁免名 user-guide-vX.Y.md 不算偏差 → 通过',
    mutate: (dir) => writeUnder(dir, 'docs/evidence/user-guide-v1.0.md', '# 用户指南归档\n'),
    prepare: (dir) => {
      const gen = runChecker(dir, { check: false });
      if (gen.code !== 0) throw new Error(`重生成失败:${gen.output}`);
    },
    expect: null,
  },
  {
    name: '新增归档原文未重生成索引(漏改一处就不报错的经典形态)',
    prepare: (dir) => {
      const gen = runChecker(dir, { check: false });
      if (gen.code !== 0) throw new Error(`重生成失败:${gen.output}`);
      writeUnder(dir, 'docs/evidence/20260102-101010-第三份.md');
    },
    expect: /evidence\/INDEX\.md 与目录实际内容不一致\(共 \d+ 行不同\)/,
  },
  {
    name: '索引被手工删行(索引不再是目录的投影)',
    prepare: (dir) => {
      const gen = runChecker(dir, { check: false });
      if (gen.code !== 0) throw new Error(`重生成失败:${gen.output}`);
      const target = join(dir, ...INDEX_REL.split('/'));
      writeFileSync(target, readFileSync(target, 'utf8').replace(/^.*20260101-202020.*\n/m, ''), 'utf8');
    },
    expect: /evidence\/INDEX\.md 与目录实际内容不一致[\s\S]*第 \d+ 行/,
  },
  {
    name: '形态不合规的历史偏差命名(靠散文约定滑进来的那种)',
    mutate: (dir) => writeUnder(dir, 'docs/evidence/随手记.md', '# 随手记\n'),
    expect: /份文件名不符合 `YYYYMMDD-HHMMSS-<主题>\.md` 形态/,
    also: (dir) => {
      // 形态断言排在生成之前:不合规时宁可不写索引(否则会把偏差固化成「已登记」)
      if (existsSync(join(dir, ...INDEX_REL.split('/')))) throw new Error('形态不合规时仍写出了索引');
    },
  },
  {
    name: '索引文件不存在(从未生成过)',
    expect: /evidence\/INDEX\.md 不存在\(应生成\)/,
  },
  {
    name: '空归档目录(表只有表头)→ 通过',
    mutate: (dir) => {
      rmSync(join(dir, 'docs', 'evidence'), { recursive: true, force: true });
      mkdirSync(join(dir, 'docs', 'evidence'), { recursive: true });
    },
    prepare: (dir) => {
      const gen = runChecker(dir, { check: false });
      if (gen.code !== 0) throw new Error(`重生成失败:${gen.output}`);
    },
    expect: null,
  },
  {
    name: '未知参数(不得静默按生成模式跑一遍报绿)',
    raw: ['oops'],
    expect: /无法识别的参数/,
  },
];

const failures = [];
for (const testCase of CASES) {
  let dir;
  try {
    // `dir` 显式给出 = 跑真实仓库(只读,且强制 --check);否则造夹具并在 finally 清理
    try {
      dir = testCase.dir ?? createFixture(testCase.mutate);
      testCase.prepare?.(dir);
    } catch (error) {
      // createFixture / prepare 抛异常时前者自己已清理;这里只登记,不让一条夹具的
      // 构造失败打断整批(否则后面的夹具一条都跑不到,报告里也看不出是哪条坏了)
      failures.push(
        `${testCase.dir === undefined ? '夹具' : '真实仓库'} ${testCase.name}:`
          + `造夹具/前置步骤抛异常:${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const args = testCase.raw ?? (testCase.dir === undefined ? ['--check'] : ['--check']);
    const result = spawnSync(
      process.execPath,
      [testCase.dir === undefined ? join(dir, 'gates', 'repo', 'gen-archive-index.mjs') : checkerPath, ...args],
      { cwd: dir, encoding: 'utf8', windowsHide: true },
    );
    const code = result.status;
    const output = `${result.stdout}${result.stderr}`;
    const tag = testCase.dir === undefined ? '夹具' : '真实仓库';
    if (testCase.expect === null) {
      if (code !== 0) {
        failures.push(`${tag} ${testCase.name}:期望通过,实际 exit ${code}\n${output}`);
        continue;
      }
      try {
        testCase.also?.(dir);
      } catch (error) {
        failures.push(`${tag} ${testCase.name}:生成内容断言失败:${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      console.log(`[ok] archive-index-selftest:${testCase.name}(门禁通过,exit 0)`);
      continue;
    }
    if (code !== 0 && testCase.expect.test(output)) {
      try {
        testCase.also?.(dir);
      } catch (error) {
        failures.push(`${tag} ${testCase.name}:副断言失败:${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      console.log(`[ok] archive-index-selftest:${testCase.name}(漂移被拦截,exit ${code})`);
    } else {
      failures.push(
        `${tag} ${testCase.name}:期望 exit≠0 且输出匹配 ${testCase.expect},实际 exit ${code}\n${output}`,
      );
    }
  } finally {
    if (testCase.dir === undefined && dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[archive-index-selftest:fail] ${failure}`);
  console.error(`[archive-index-selftest:fail] 归档索引门禁回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] archive-index-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);