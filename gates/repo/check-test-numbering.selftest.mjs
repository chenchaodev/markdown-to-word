// 测试树规划编号门禁自身的回归守护(负向夹具)。
//
// check-test-numbering.mjs 是 verify:ci 链上的一道零自检门禁:若词法判定被改坏
// (字符串字面量抽不出来 / 字母表被清空 / 排除目录被删)、或白名单被扩成「整文件放行」,
// 本脚本会打印 `[ok]` 而规划编号照旧长在测试树里。此处用临时夹具逐条制造这些漂移,
// 断言门禁确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体,也不复制它**:夹具 = 临时目录里的一棵最小测试树,而门禁**原位**从仓内跑、
// 只靠 cwd 指夹具 —— 故它的扫描面自动指向夹具根。项目根单一来源是 shared/paths.js 的
// process.cwd(),而 ESM 静态 import 按**文件位置**解析、与 cwd 无关,所以真脚本的仓内依赖
// (shared/paths.js、shared/test-common-surface.js)天然可达,沙盒里不需要再放一份。
// 真实仓库只被**读**(baseline 那一条跑真实 test/ 树)。

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../shared/paths.js';
import { SEGMENT_DIRS } from '../../shared/test-common-surface.js';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'gates', 'repo', 'check-test-numbering.mjs');

/** 干净底板内容:不含任何规划编号字面量 */
const CLEAN = "export const value = 'clean';\n";

/**
 * 夹具的扫描面底板:四个目标目录各若干文件,合计 54(下限 50,留四个余量)。
 * 目录全部必须存在(等式判据与 walker 都按目录走,缺目录测不到任何判定)。
 * 段目录的配额随第五个目标目录(段目录之外的杂物抽屉,已取消)重分配到 core 与 gates
 * (按实测的 58 : 17 段数比),
 * main / renderer / common 保持原值 —— common 是等式之外唯一的非段目录,配额压太低
 * 会让「walker 整体失效」那条负向夹具的前提变得不可靠。
 */
const BASE_SHAPE = Object.freeze({
  'test/core': 21,
  'test/main': 11,
  'test/renderer': 11,
  'test/gates': 5,
  // 新增测试段目录时必须同时补两处:shared/test-common-surface.js 的 SEGMENT_DIRS
  // (声明面)与本形状(实测面)。漏后者则夹具里该目录被声明却无文件,等式判据恒红,
  // 且级联成「每条夹具都失败」——症状离根因很远。
  'test/convert': 1,
  'test/cli': 2,
  'test/mcp': 1,
  'test/common': 6,
});

function writeUnder(root, rel, body = CLEAN) {
  const target = join(root, ...rel.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, body, 'utf8');
}

/** 造一份夹具:按 shape 铺一棵最小测试树,再由 mutate 打上漂移 */
function createFixture(mutate, shape = BASE_SHAPE) {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-test-numbering-selftest-'));
  // 段目录镜像判据的判定对象是**顶层**的同名树,夹具不把它们造出来就等于该判据恒红
  for (const name of SEGMENT_DIRS) mkdirSync(join(dir, name), { recursive: true });
  for (const [target, count] of Object.entries(shape)) {
    const ext = target === 'test/common' ? '.js' : '.test.js';
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

/** 在夹具上跑门禁(真脚本 + cwd 指夹具);返回退出码与合并输出 */
function runChecker(dir, args = []) {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
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
    mutate: (dir) => writeUnder(dir, 'test/core/case-0.test.js', "throw new Error('B3 断言失败:档位映射');\n"),
    expect: /\[numbering:fail] test\/core\/case-0\.test\.js:1 → B3 →/,
  },
  {
    name: '中文批次形态(批次9 断言失败)',
    mutate: (dir) => writeUnder(dir, 'test/core/case-1.test.js', "throw new Error('批次9断言失败:脚手架');\n"),
    expect: /\[numbering:fail] test\/core\/case-1\.test\.js:1 → 批次9 →/,
  },
  {
    name: 'OPT 类编号泄漏(带小数段形态)',
    mutate: (dir) => writeUnder(dir, 'test/main/case-0.test.js', "const tag = 'OPT-2.1 待办';\n"),
    expect: /→ OPT-2\.1 →/,
  },
  // 反向锚点三条:门禁的判定输入是「字符串字面量」,越界即误报;真误报会逼人改门禁
  {
    name: '注释里的编号(场景标签)不报 → 通过',
    mutate: (dir) => writeUnder(dir, 'test/core/case-2.test.js', "// 场景 B1:单文件,场景 B2:多文件\nexport const n = 1;\n"),
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
    // 扫描面**等式**的负向夹具:磁盘上多出一个未登记的测试子目录。文件数仍在下限之上,
    // 所以这条判红只可能来自等式 —— 它正是「下限替代不了等式」的端到端实证。
    name: '扫描面多出一个未登记的测试子目录(等式判红并点名)',
    mutate: (dir) => writeUnder(dir, 'test/perf/case-0.test.js'),
    expect: /扫描面等式不成立:.*多出\(磁盘上有测试源文件但未登记进扫描面\):test\/perf/,
  },
  {
    // 段目录**镜像**判据的负向夹具:抽掉顶层的 renderer/ 这棵树(test/renderer 仍在,
    // 文件数与等式都照常满足)⇒ 只有镜像判据拦得住。这条证明该判据不是恒绿装饰。
    name: '段目录不镜像任何顶层树(镜像判红并点名)',
    mutate: (dir) => rmSync(join(dir, 'renderer'), { recursive: true, force: true }),
    expect: /段目录镜像判据不成立:.*test\/renderer\(顶层没有可镜像的 renderer\//,
  },
  {
    // 防空过:walker 静默失效会退化成「零文件全过」,那是假通过。
    // 合成文件 10(段目录与 common 各自的 shape 计数),远低于下限 50。
    // 期望写成与具体数字无关的形态(下限判据只承诺「低于下限即红」,不承诺某个夹具形状
    // 恰好是几 —— 门禁多带一个依赖进来时,这条断言不该跟着改)。
    name: '扫描面塌缩(文件数掉到下限以下)',
    shape: { 'test/core': 4, 'test/main': 2, 'test/renderer': 2, 'test/gates': 1, 'test/convert': 1, 'test/cli': 2, 'test/mcp': 1, 'test/common': 1 },
    expect: /只扫到 \d+ 个文件\(下限 50\):扫描面或 walker 失效/,
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