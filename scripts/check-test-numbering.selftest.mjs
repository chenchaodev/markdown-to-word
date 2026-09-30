// 测试树规划编号门禁自身的回归守护(负向夹具)。
//
// check-test-numbering.mjs 是 verify:ci 链上的一道零自检门禁:若词法判定被改坏
// (字符串字面量抽不出来 / 字母表被清空 / 排除目录被删)、或白名单被扩成「整文件放行」,
// 本脚本会打印 `[ok]` 而规划编号照旧长在测试树里。此处用临时夹具逐条制造这些漂移,
// 断言门禁确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体**:夹具 = 把门禁脚本原样拷进临时目录的 scripts/(它的 projectRoot
// 由 import.meta.dirname 推导,故拷贝后扫描面自动指向夹具根),配一棵最小测试树。
// 真实仓库只被**读**(baseline 那一条跑真实 test/ 树)。

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../shared/paths.js';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'scripts', 'check-test-numbering.mjs');

/** 干净底板内容:不含任何规划编号字面量 */
const CLEAN = "export const value = 'clean';\n";

/**
 * 夹具的扫描面底板:五个目标目录各若干文件,合计 50 = MIN_SCAN_FILES 下限。
 * 目录全部必须存在(walker 对不存在的目录会抛 ENOENT,那测不到任何判定)。
 */
const BASE_SHAPE = Object.freeze({
  'test/segments': 16,
  'test/main': 11,
  'test/renderer': 11,
  'test/common': 6,
  'test/tools': 6,
});

function writeUnder(root, rel, body = CLEAN) {
  const target = join(root, ...rel.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, body, 'utf8');
}

/** 造一份夹具:拷贝门禁本体 + 按 shape 铺测试树,再由 mutate 打上漂移 */
function createFixture(mutate, shape = BASE_SHAPE) {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-test-numbering-selftest-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(checkerPath, join(dir, 'scripts', 'check-test-numbering.mjs'));
  // 被测门禁从 shared/paths.js 取项目根(ADR-040),夹具内必须带一份
  mkdirSync(join(dir, 'shared'), { recursive: true });
  copyFileSync(join(projectRoot, 'shared', 'paths.js'), join(dir, 'shared', 'paths.js'));
  for (const [target, count] of Object.entries(shape)) {
    const ext = target === 'test/tools' ? '.mjs' : target === 'test/common' ? '.js' : '.test.js';
    for (let i = 0; i < count; i += 1) writeUnder(dir, `${target}/case-${i}${ext}`);
  }
  // mutate 抛异常时调用方拿不到 dir,其 finally 清不到 → 在这里兜住(临时产物不留残)
  try {
    mutate?.(dir);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return dir;
}

/** 在夹具上跑门禁;返回退出码与合并输出 */
function runChecker(dir, args = []) {
  const result = spawnSync(process.execPath, [join(dir, 'scripts', 'check-test-numbering.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

// 每条负向夹具须命中一个真实历史缺陷或现实漂移形态,而非人造噪声。
const CASES = [
  {
    name: '真实仓库当前未漂移 → 通过',
    dir: projectRoot,
    expect: null,
  },
  {
    name: '夹具基线未漂移 → 通过',
    expect: null,
  },
  {
    name: '断言消息里泄漏规划编号 B3',
    mutate: (dir) => writeUnder(dir, 'test/segments/case-0.test.js', "throw new Error('B3 断言失败:档位映射');\n"),
    expect: /\[numbering:fail] test\/segments\/case-0\.test\.js:1 → B3 →/,
  },
  {
    name: '中文批次形态(批次9 断言失败)',
    mutate: (dir) => writeUnder(dir, 'test/segments/case-1.test.js', "throw new Error('批次9断言失败:脚手架');\n"),
    expect: /\[numbering:fail] test\/segments\/case-1\.test\.js:1 → 批次9 →/,
  },
  {
    name: 'OPT 类编号泄漏(带小数段形态)',
    mutate: (dir) => writeUnder(dir, 'test/main/case-0.test.js', "const tag = 'OPT-2.1 待办';\n"),
    expect: /→ OPT-2\.1 →/,
  },
  // 反向锚点三条:门禁的判定输入是「字符串字面量」,越界即误报;真误报会逼人改门禁
  {
    name: '注释里的编号(场景标签)不报 → 通过',
    mutate: (dir) => writeUnder(dir, 'test/segments/case-2.test.js', "// 场景 B1:单文件,场景 B2:多文件\nexport const n = 1;\n"),
    expect: null,
  },
  {
    name: '排除目录 test/fixtures 里的编号不报 → 通过',
    mutate: (dir) => writeUnder(dir, 'test/fixtures/manual/plan.test.js', "export const note = 'D-02 手工清单';\n"),
    expect: null,
  },
  {
    name: 'A 族不在字母表(纸张规格 A1/A8 不报)→ 通过',
    mutate: (dir) => writeUnder(dir, 'test/main/case-1.test.js', "const size = 'A4';\nexport default size;\n"),
    expect: null,
  },
  {
    name: '白名单:paper 语义的 B5 是纸型不是编号 → 通过',
    mutate: (dir) => writeUnder(dir, 'test/main/settings.test.js', "export const o = { paper: 'B5' };\n"),
    expect: null,
  },
  {
    name: 'D-数字段形态编号泄漏(带连字符那一族)',
    mutate: (dir) => writeUnder(dir, 'test/renderer/case-0.test.js', "throw new Error('D-02 排版未收口');\n"),
    expect: /→ D-02 →/,
  },
  {
    // 防空过:walker 静默失效会退化成「零文件全过」,那是假通过
    name: '扫描面塌缩(文件数掉到下限以下)',
    shape: { 'test/segments': 4, 'test/main': 2, 'test/renderer': 2, 'test/common': 1, 'test/tools': 1 },
    expect: /只扫到 10 个文件\(下限 50\):扫描面或 walker 失效/,
  },
  {
    name: '未知参数(不得静默按默认扫描面跑一遍报绿)',
    raw: ['oops'],
    expect: /无法识别的参数:oops/,
  },
];

const failures = [];
for (const testCase of CASES) {
  let dir;
  try {
    // `dir` 显式给出 = 跑真实仓库(只读);否则造夹具并在 finally 清理
    try {
      dir = testCase.dir ?? createFixture(testCase.mutate, testCase.shape);
    } catch (error) {
      // createFixture 抛异常时它自己已清理;这里只登记,不让一条夹具的构造失败
      // 打断整批(否则后面的夹具一条都跑不到,报告里也看不出是哪条坏了)
      failures.push(
        `夹具 ${testCase.name}:造夹具抛异常:${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const { code, output } = runChecker(dir, testCase.raw ?? []);
    const tag = testCase.dir === undefined ? '夹具' : '真实仓库';
    if (testCase.expect === null) {
      if (code === 0) {
        console.log(`[ok] test-numbering-selftest:${testCase.name}(门禁通过,exit 0)`);
      } else {
        failures.push(`${tag} ${testCase.name}:期望通过,实际 exit ${code}\n${output}`);
      }
      continue;
    }
    if (code !== 0 && testCase.expect.test(output)) {
      console.log(`[ok] test-numbering-selftest:${testCase.name}(漂移被拦截,exit ${code})`);
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
  for (const failure of failures) console.error(`[test-numbering-selftest:fail] ${failure}`);
  console.error(`[test-numbering-selftest:fail] 规划编号门禁回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] test-numbering-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);