// 变换层分派点门禁自身的回归守护(负向夹具)。
//
// check-transform-dispatch.mjs 是 verify:ci 链上的一道零自检门禁:若它被改成「永远
// 通过」、某条断言被误删、或三处扫描面之一(渲染层 / main 转换层薄壳 / 枚举点计数面)
// 因目录改名而塌缩,本脚本会打印 `[ok]` 而没人察觉,「第三个 mapper 长出来」与
// 「分派被搬出 core/markdown」都会静默通过。此处用临时夹具逐条制造这些漂移,断言门禁
// 确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体**,夹具一律造在 os.tmpdir() 下并在 finally 清理(测试对象是
// 夹具,不是本仓库文件)。真实仓库只被**读**(baseline 那一条跑真实 src 树)。

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../shared/paths.js';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'scripts', 'check-transform-dispatch.mjs');

/** 干净底板文件内容:不含任何变换键名,故不影响枚举点计数 */
const NEUTRAL = 'export const noop = 1;\n';

// 各扫描面的文件数下限(与 check-transform-dispatch.mjs 的 SCOPES 对齐):
//   渲染层 = core/convert.ts + core/docx/** + core/pdf/** ≥ 20
//   main 薄壳 = main/converter/** ≥ 4
//   枚举点计数面 = core/** ≥ 40
const DOCX_FILES = 10;
const PDF_FILES = 10;
const UTIL_FILES = 16;
const SHELL_FILES = 4;

function writeUnder(root, rel, body = NEUTRAL) {
  const target = join(root, ...rel.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, body, 'utf8');
}

/** 造一份与真实 src 树同构的夹具(含恰好 2 处枚举点),再由 mutate 打上漂移 */
function createFixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-transform-dispatch-selftest-'));
  const src = join(dir, 'src');
  writeUnder(src, 'core/convert.ts');
  for (let i = 0; i < DOCX_FILES; i += 1) writeUnder(src, `core/docx/part-${i}.ts`);
  for (let i = 0; i < PDF_FILES; i += 1) writeUnder(src, `core/pdf/part-${i}.ts`);
  for (let i = 0; i < UTIL_FILES; i += 1) writeUnder(src, `core/util/helper-${i}.ts`);
  for (let i = 0; i < SHELL_FILES; i += 1) writeUnder(src, `main/converter/shell-${i}.ts`);
  // 两处枚举点:分派 1 + 档位映射 1,都在 core/markdown/(与门禁的硬约束同形)
  writeUnder(src, 'core/markdown/dispatch.ts', 'export const dispatch = (o) => o.aiCleanup;\n');
  writeUnder(src, 'core/markdown/level-map.ts', 'export const level = (o) => o.obsidian;\n');
  writeUnder(src, 'core/markdown/parser.ts', 'export const parse = (t) => t;\n');
  mutate({ dir, src });
  return dir;
}

/**
 * 跑门禁并返回退出码与合并输出。args 为空 = 跑真实仓库(读 src 树,零写入);
 * 否则 `--src <夹具>/src`(绝对路径,故与 cwd 无关)。
 * @param {string[]} args 追加给门禁的参数
 * @returns {{code: number, output: string}}
 */
function runChecker(args) {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/** 每条夹具的参数构造:默认跑夹具 src 树,`raw` 覆盖为直接给定的参数 */
function argsFor(testCase, dir) {
  return testCase.raw ?? ['--src', join(dir, 'src')];
}

// 每条负向夹具须命中一个真实历史缺陷或现实漂移形态,而非人造噪声。
const CASES = [
  {
    name: '真实仓库当前未漂移 → 通过',
    raw: [],
    expect: null,
  },
  {
    name: '夹具基线未漂移 → 通过',
    expect: null,
  },
  {
    // 反向锚点:枚举点计数面的三项排除是「按内容归类」而非「放过」,误放会让计数虚高、
    // 本门禁恒绿。夹具里把键名写进这三处,仍须判绿。
    name: '枚举点计数排除项(i18n 键名字典 / 声明单源)含变换键 → 仍通过',
    mutate: ({ src }) => {
      writeUnder(src, 'core/i18n/zh-CN.ts', 'export const settings = { aiCleanup: "x" };\n');
      writeUnder(src, 'core/settings/settings-defaults.ts', 'export const obsidian = 1;\n');
      writeUnder(src, 'core/settings/settings-schema.ts', 'export const aiCleanup = 1;\n');
    },
    expect: null,
  },
  {
    name: '渲染层枚举变换键(第三个 mapper 偷长进 docx)',
    mutate: ({ src }) => writeUnder(src, 'core/docx/part-0.ts', 'export const o = { aiCleanup: 1 };\n'),
    expect: /渲染层出现变换类设置「aiCleanup」\(core\/docx\/part-0\.ts:1\)/,
  },
  {
    name: 'main 转换层薄壳枚举变换键(「main 侧改动恒为 0」不再成立)',
    mutate: ({ src }) => writeUnder(src, 'main/converter/shell-0.ts', 'export const o = { obsidian: 1 };\n'),
    expect: /main 转换层薄壳出现变换类设置「obsidian」\(main\/converter\/shell-0\.ts:1\)/,
  },
  {
    name: '枚举点多到 3 处(core/markdown 里又长出一个 mapper)',
    mutate: ({ src }) => writeUnder(src, 'core/markdown/extra-mapper.ts', 'export const m = (o) => o.aiCleanup;\n'),
    expect: /变换类设置的枚举点应为 2 处[\s\S]*实际 3 处/,
  },
  {
    name: '枚举点落到 core/markdown 之外(有人重新造了一条通路)',
    mutate: ({ src }) => {
      writeUnder(src, 'core/markdown/level-map.ts');
      writeUnder(src, 'core/util/escaper.ts', 'export const e = (o) => o.obsidian;\n');
    },
    expect: /枚举点 core\/util\/escaper\.ts 不在 core\/markdown\/ 下/,
  },
  {
    // 防空过:扫描面塌缩时「零命中」是假通过,必须自己报红。
    // 刻意保留目录、只削文件数 —— 目录整个删掉会先命中 ENOENT 的「扫描失败」分支,
    // 那样测不到 minFiles 这条防空过断言。
    name: '渲染层扫描面塌缩(目录仍在、文件数掉到下限以下)',
    mutate: ({ src }) => {
      for (let i = 3; i < DOCX_FILES; i += 1) rmSync(join(src, 'core', 'docx', `part-${i}.ts`), { force: true });
      for (let i = 3; i < PDF_FILES; i += 1) rmSync(join(src, 'core', 'pdf', `part-${i}.ts`), { force: true });
    },
    expect: /渲染层只扫到 7 个文件\(下限 20\):扫描面或谓词失效/,
  },
  {
    name: '枚举点计数面扫描面塌缩(core 树被裁剪)',
    mutate: ({ src }) => rmSync(join(src, 'core', 'util'), { recursive: true, force: true }),
    expect: /枚举点计数面只扫到 24 个文件\(下限 40\):扫描面或谓词失效/,
  },
  {
    // 参数写错必须显式失败,不能静默按默认 src 跑一遍真实树然后报绿
    name: '--src 拼错(不得静默回落默认扫描面)',
    raw: ['--srcx', 'src'],
    expect: /无法识别的选项:--srcx/,
  },
  {
    name: '--src 缺取值(不得静默回落默认扫描面)',
    raw: ['--src'],
    expect: /选项 --src 缺少取值/,
  },
];

const failures = [];
for (const testCase of CASES) {
  let dir;
  try {
    dir = createFixture(testCase.mutate ?? (() => {}));
    const { code, output } = runChecker(argsFor(testCase, dir));
    if (testCase.expect === null) {
      if (code === 0) {
        console.log(`[ok] transform-dispatch-selftest:${testCase.name}(门禁通过,exit 0)`);
      } else {
        failures.push(`${testCase.name}:期望通过,实际 exit ${code}\n${output}`);
      }
      continue;
    }
    if (code !== 0 && testCase.expect.test(output)) {
      console.log(`[ok] transform-dispatch-selftest:${testCase.name}(漂移被拦截,exit ${code})`);
    } else {
      failures.push(
        `${testCase.name}:期望 exit≠0 且输出匹配 ${testCase.expect},实际 exit ${code}\n${output}`,
      );
    }
  } finally {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[transform-dispatch-selftest:fail] ${failure}`);
  console.error(`[transform-dispatch-selftest:fail] 分派点门禁回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] transform-dispatch-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);