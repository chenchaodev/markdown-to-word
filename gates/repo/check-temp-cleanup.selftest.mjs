// 临时目录清理收敛门禁自身的回归守护(负向夹具)。
//
// check-temp-cleanup.mjs 是 verify:ci 链上的一道零自检门禁(且是门禁树里最大的一个):
// 若两条规则的判定器被改坏(正则写成永远不命中 / 选项校验被删)、或某处加了「白名单整文件
// 放行」,本脚本会打印 `[ok]` 而测试树里裸写的递归删除照旧存在。此处用临时夹具逐条制造
// 这些漂移,断言门禁确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体**:夹具 = 把门禁脚本原样拷进临时目录的 gates/repo/(它的 projectRoot
// 由 import.meta.dirname 推导,故拷贝后扫描面自动指向夹具根),连同它的仓内依赖
// test/common/copy-closure.js(lexSource,零 I/O 纯文本层)与
// test/common/test-common-surface.js(测试扫描面单源,零仓内依赖)一起拷贝,配一棵最小测试树。
// 真实仓库只被**读**(baseline 那一条跑真实 test/ 树)。
// 少拷一个的代价不是「夹具少测一条」而是「门禁在沙盒里直接起不来」:相对 import 解析不到,
// 那条守护段 test/segments/contract-single-source.test.js 的副本闭包判定会先把它拦下。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则
// 系统临时区会堆满夹具树。

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'gates', 'repo', 'check-temp-cleanup.mjs');
/** 门禁的仓内 import(纯文本层,零 node: 依赖),须随门禁一起拷进夹具 */
const copyClosurePath = join(projectRoot, 'shared', 'copy-closure.js');
/** 门禁的仓内 import(测试扫描面单源,只依赖 node: 内建),须随门禁一起拷进夹具 */
const surfacePath = join(projectRoot, 'shared', 'test-common-surface.js');

/** 干净底板内容:不含任何删除调用 */
const CLEAN = "export const value = 'clean';\n";

/**
 * 夹具的扫描面底板:五个目标目录各若干文件,合计 49 —— 加上随门禁拷进来的
 * copy-closure.js 与 test-common-surface.js 两个文件,恰好 50 = 扫描文件数下限。
 * 目录全部必须存在(等式判据与 walker 都按目录走,缺目录测不到任何判定)。
 */
const BASE_SHAPE = Object.freeze({
  'test/segments': 16,
  'test/main': 11,
  'test/renderer': 11,
  'test/common': 7,
  'test/tools': 6,
});

/** 合法形态的助手调用与单文件删除(第一条与第二条规则都不得判红) */
const LEGAL_FORMS = [
  'export function cleanup(dir, artifact) {',
  '  removeTree(dir, { maxRetries: 3, retryDelay: 200 });',
  '  removeFile(artifact);',
  '  removeTree(dir);',
  '  return fs.rm(artifact, { force: true });',
  '}',
  '',
].join('\n');

function writeUnder(root, rel, body = CLEAN) {
  const target = join(root, ...rel.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, body, 'utf8');
}

/**
 * 在夹具内整串替换(便于对门禁源码做定点漂移;找不到即抛,不许静默跳过)。
 * 读入后先归一 CRLF→LF 再匹配:Windows autocrlf 检出下工作区文本是 CRLF,而夹具里的
 * 待替换片段按 LF 书写 —— 不归一会让替换永远落空,而那正是「找不到即抛」要拦的假通过。
 */
function patchInFixture(dir, relative, from, to) {
  const target = join(dir, relative);
  const current = readFileSync(target, 'utf8').replaceAll('\r\n', '\n');
  if (!current.includes(from)) throw new Error(`夹具 ${relative} 中找不到待替换内容:${from}`);
  writeFileSync(target, current.replace(from, to), 'utf8');
}

/** 造一份夹具:拷贝门禁本体 + copy-closure + 按 shape 铺测试树,再由 mutate 打上漂移 */
function createFixture(mutate, shape = BASE_SHAPE) {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-temp-cleanup-selftest-'));
  mkdirSync(join(dir, 'gates', 'repo'), { recursive: true });
  copyFileSync(checkerPath, join(dir, 'gates', 'repo', 'check-temp-cleanup.mjs'));
  // 被测门禁从 shared/paths.js 取项目根(ADR-040),连同它唯一的仓内依赖一起带进夹具
  mkdirSync(join(dir, 'shared'), { recursive: true });
  copyFileSync(join(projectRoot, 'shared', 'paths.js'), join(dir, 'shared', 'paths.js'));
  mkdirSync(join(dir, 'test', 'common'), { recursive: true });
  copyFileSync(copyClosurePath, join(dir, 'shared', 'copy-closure.js'));
  // 扫描面单源同样随门禁拷进来(它零 node: 依赖之外的仓内依赖,拷这一份就够)
  copyFileSync(surfacePath, join(dir, 'shared', 'test-common-surface.js'));
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
  const result = spawnSync(process.execPath, [join(dir, 'gates', 'repo', 'check-temp-cleanup.mjs'), ...args], {
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
    // 反向锚点:合法形态若被判红,门禁会逼着人把测试改丑来讨好它
    name: '合法形态(助手两参对象 / 单参省略 / 单文件删除不配 recursive)不报 → 通过',
    mutate: (dir) => writeUnder(dir, 'test/segments/case-0.test.js', LEGAL_FORMS),
    expect: null,
  },
  {
    // 第二条规则刻意抹注释:注释不是调用点,JSDoc 里写示例不得判红
    name: 'JSDoc 注释里的正确用法不报 → 通过',
    mutate: (dir) => writeUnder(
      dir,
      'test/common/helpers.js',
      '/**\n * 删除沙盒:removeTree(dir, { retryDelay: 200 })\n */\nexport const cleanup = () => undefined;\n',
    ),
    expect: null,
  },
  {
    name: '裸写递归删除(收口面被穿透)',
    mutate: (dir) => writeUnder(dir, 'test/segments/case-1.test.js', "} finally {\n  fs.rmSync(dir, { recursive: true, force: true });\n}\n"),
    expect: /test\/segments\/case-1\.test\.js:2 → fs\.rmSync\(dir, \{ recursive: true, force: true \}\)/,
  },
  {
    name: '吞错的裸写递归删除(await fs.rm + .catch)',
    mutate: (dir) => writeUnder(dir, 'test/main/case-1.test.js', "await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);\n"),
    expect: /test\/main\/case-1\.test\.js:1 → fs\.rm\(/,
  },
  {
    // 第二条规则的三类真实错用法(门禁文件头「第二条规则」节列的实测结论)
    name: '第二实参非对象(以为覆盖了重试,实则静默用默认)',
    mutate: (dir) => writeUnder(dir, 'test/segments/case-2.test.js', 'removeTree(dir, 5);\n'),
    expect: /removeTree 的选项用法:第二实参必须是对象字面量 \{ maxRetries\?, retryDelay\? \},实际是 5/,
  },
  {
    name: '第二实参非法取值(负数会让 Node 抛 ERR_OUT_OF_RANGE)',
    mutate: (dir) => writeUnder(dir, 'test/segments/case-3.test.js', 'removeTree(dir, { maxRetries: -1 });\n'),
    expect: /maxRetries 的取值必须是非负有限数字字面量,实际是 -1/,
  },
  {
    name: '第二实参未知键(被 Node 静默忽略,与「没传」不可区分)',
    mutate: (dir) => writeUnder(dir, 'test/segments/case-4.test.js', 'removeTree(dir, { maxRetries: 5, force: true });\n'),
    expect: /未知选项键 force\(助手只接受 maxRetries \/ retryDelay;未知键被静默忽略\)/,
  },
  {
    // 扫描面**等式**的负向夹具:磁盘上多出一个未登记的测试子目录。文件数仍在下限之上,
    // 所以这条判红只可能来自等式 —— 它正是「下限替代不了等式」的端到端实证。
    name: '扫描面多出一个未登记的测试子目录(等式判红并点名)',
    mutate: (dir) => writeUnder(dir, 'test/perf/case-0.test.js'),
    expect: /扫描面等式不成立:.*多出\(磁盘上有测试源文件但未登记进扫描面\):test\/perf/,
  },
  {
    // 防空过:walker 静默失效会退化成「零文件全过」,那是假通过。
    // 合成文件 10 + 随门禁拷进来的 copy-closure.js 与 test-common-surface.js 两个 = 12。
    // 期望写成与具体数字无关的形态(下限判据只承诺「低于下限即红」,不承诺某个夹具形状
    // 恰好是几 —— 门禁多带一个依赖进来时,这条断言不该跟着改)。
    name: '扫描面塌缩(文件数掉到下限以下)',
    shape: { 'test/segments': 4, 'test/main': 2, 'test/renderer': 2, 'test/common': 1, 'test/tools': 1 },
    expect: /只扫到 \d+ 个文件\(下限 50\):扫描面或 walker 失效/,
  },
  {
    // 门禁自带的 SELF_PROBE 失效时必须 fail closed(探针是规则本身的回归测试,不是装饰)
    name: '内建探针被改坏(反向锚点 before/after 互换)',
    mutate: (dir) => patchInFixture(
      dir,
      'gates/repo/check-temp-cleanup.mjs',
      [
        "    before: '    await fs.rm(artifact, { force: true });',",
        "    after: '    await fs.rm(artifact, { recursive: true, force: true });',",
      ].join('\n'),
      [
        "    before: '    await fs.rm(artifact, { recursive: true, force: true });',",
        "    after: '    await fs.rm(artifact, { force: true });',",
      ].join('\n'),
    ),
    expect: /自检探针未通过:判定规则与声明的收口面不符,此时的扫描结果不可信/,
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
        console.log(`[ok] temp-cleanup-selftest:${testCase.name}(门禁通过,exit 0)`);
      } else {
        failures.push(`${tag} ${testCase.name}:期望通过,实际 exit ${code}\n${output}`);
      }
      continue;
    }
    if (code !== 0 && testCase.expect.test(output)) {
      console.log(`[ok] temp-cleanup-selftest:${testCase.name}(漂移被拦截,exit ${code})`);
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
  for (const failure of failures) console.error(`[temp-cleanup-selftest:fail] ${failure}`);
  console.error(`[temp-cleanup-selftest:fail] 临时目录清理门禁回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] temp-cleanup-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);