// 临时目录清理收敛门禁自身的回归守护(负向夹具)。
//
// check-temp-cleanup.mjs 是 verify:ci 链上的一道零自检门禁(且是门禁树里最大的一个):
// 若两条规则的判定器被改坏(正则写成永远不命中 / 选项校验被删)、或某处加了「白名单整文件
// 放行」,本脚本会打印 `[ok]` 而测试树里裸写的递归删除照旧存在。此处用临时夹具逐条制造
// 这些漂移,断言门禁确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体**:夹具 = 把门禁脚本原样拷进临时目录的 gates/repo/(它的 projectRoot
// 由 cwd 决定,夹具那侧 spawn 的 cwd 指向夹具根),连同它的仓内依赖 shared/copy-closure.js
// (剥注释,零 I/O 纯文本层)与 shared/test-common-surface.js(测试扫描面单源,零仓内依赖)
// 一起拷贝,配一棵最小测试树。真实仓库只被**读**(baseline 那一条跑真实 test/ 树)。
// ⚠ 为何这一处仍保留复制而别的 selftest 已改成「真脚本 + cwd」:其中一条负向用例必须**改写门禁
//   自己的源码**(内建 SELF_PROBE 的 before/after 对调),对真脚本做不到。
// 「副本的 import 闭包」由 SANDBOX_COPY_SET + assertCopySetIsClosed 守住(旧闭包门禁退役后的降级形态)。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则
// 系统临时区会堆满夹具树。

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix, join } from 'node:path';
import { ROOT } from '../../shared/paths.js';
import { SEGMENT_DIRS } from '../../shared/test-common-surface.js';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'gates', 'repo', 'check-temp-cleanup.mjs');
/** 门禁的仓内 import(纯文本层,零 node: 依赖),须随门禁一起拷进夹具 */
const copyClosurePath = join(projectRoot, 'shared', 'copy-closure.js');
/** 门禁的仓内 import(测试扫描面单源,只依赖 node: 内建),须随门禁一起拷进夹具 */
const surfacePath = join(projectRoot, 'shared', 'test-common-surface.js');

/** 干净底板内容:不含任何删除调用 */
const CLEAN = "export const value = 'clean';\n";

/**
 * 夹具的扫描面底板:四个目标目录各若干文件,合计 55(下限 50,留五个余量)。
 * 目录全部必须存在(等式判据与 walker 都按目录走,缺目录测不到任何判定)。
 * 段目录的配额随第五个目标目录(段目录之外的杂物抽屉,已取消)重分配到 core 与 gates
 * (按实测的 58 : 17 段数比),
 * main / renderer / common 保持原值 —— common 是等式之外唯一的非段目录,配额压太低
 * 会让「walker 整体失效」那条负向夹具的前提变得不可靠。
 */
const BASE_SHAPE = Object.freeze({
  'test/core': 22,
  'test/main': 11,
  'test/renderer': 11,
  'test/gates': 5,
  // 新增测试段目录时必须同时补两处:shared/test-common-surface.js 的 SEGMENT_DIRS
  // (声明面)与本形状(实测面)。漏后者则夹具里该目录被声明却无文件,等式判据恒红,
  // 且级联成「每条夹具都失败」——症状离根因很远。同一形状在
  // check-test-numbering.selftest.mjs 有第二份副本,改一处要记得另一处。
  'test/convert': 1,
  'test/cli': 2,
  'test/mcp': 1,
  'test/harness': 7,
  'test/shared': 2,
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

/**
 * 造一份夹具:拷贝门禁本体 + copy-closure + 按 shape 铺测试树,再由 mutate 打上漂移
 *
 * 这里是全仓仅存两处「逐字节把仓内文件复制进临时目录」的沙盒之一(另一处是
 * test/core/clean-artifacts-gate.test.js)。复制集在此**显式列出**,下面的定向断言就是靠它
 * 守住「副本的相对 import 目标 ⊆ 复制集」—— 旧机制那套闭包门禁整删后,这条降级成这一句断言。
 */
const SANDBOX_COPY_SET = Object.freeze([
  'gates/repo/check-temp-cleanup.mjs',
  'shared/paths.js',
  'shared/copy-closure.js',
  'shared/test-common-surface.js',
]);

/**
 * 定向断言:被测门禁副本的每个相对 import 目标都必须同在这个沙盒的复制集内。
 *
 * 为何只查这一条、且只在这一处:沙盒里没有 node_modules,裸包名必然解析失败(运行时红,
 * 已由每条夹具真跑脚本兜住);而相对 import 解析不到时报错**发生在子进程内**,症状是
 * 「门禁起不来」,离「少了哪一份副本」很远 —— 这正是它值得一条机械断言的原因。
 * 约 6 行,比重建 auditCopySet 的数据模型便宜两个数量级。
 * @returns {void}
 */
function assertCopySetIsClosed() {
  const source = readFileSync(join(projectRoot, 'gates', 'repo', 'check-temp-cleanup.mjs'), 'utf8');
  const specs = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.[^"']*)\1/g)].map((m) => m[2]);
  for (const spec of specs) {
    const resolved = posix
      .normalize(posix.join(posix.dirname('gates/repo/check-temp-cleanup.mjs'), spec))
      .replace(/\\/g, '/');
    if (!SANDBOX_COPY_SET.includes(resolved)) {
      throw new Error(
        `沙盒副本闭包:check-temp-cleanup.mjs 的相对 import「${spec}」指向 ${resolved},`
        + `不在该沙盒的复制集内(${SANDBOX_COPY_SET.join(', ')})—— 请把它加进复制集`,
      );
    }
  }
  if (specs.length === 0) throw new Error('沙盒副本闭包:一条相对 import 都没抽到,判据本身失效(恒绿)');
  console.log(`[ok] temp-cleanup-selftest:沙盒副本闭包(${specs.length} 条相对 import ⊆ 复制集 ${SANDBOX_COPY_SET.length} 项)`);
}

function createFixture(mutate, shape = BASE_SHAPE) {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-temp-cleanup-selftest-'));
  mkdirSync(join(dir, 'gates', 'repo'), { recursive: true });
  copyFileSync(checkerPath, join(dir, 'gates', 'repo', 'check-temp-cleanup.mjs'));
  // 被测门禁从 shared/paths.js 取项目根(ADR-040),连同它唯一的仓内依赖一起带进夹具
  mkdirSync(join(dir, 'shared'), { recursive: true });
  copyFileSync(join(projectRoot, 'shared', 'paths.js'), join(dir, 'shared', 'paths.js'));
  mkdirSync(join(dir, 'test', 'harness'), { recursive: true });
  copyFileSync(copyClosurePath, join(dir, 'shared', 'copy-closure.js'));
  // 扫描面单源同样随门禁拷进来(它零 node: 依赖之外的仓内依赖,拷这一份就够)
  copyFileSync(surfacePath, join(dir, 'shared', 'test-common-surface.js'));
  // 段目录镜像判据的判定对象是**顶层**的同名树,夹具不把它们造出来就等于该判据恒红
  for (const name of SEGMENT_DIRS) mkdirSync(join(dir, name), { recursive: true });
  for (const [target, count] of Object.entries(shape)) {
    const ext = target === 'test/harness' ? '.js' : '.test.js';
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
    mutate: (dir) => writeUnder(dir, 'test/core/case-0.test.js', LEGAL_FORMS),
    expect: null,
  },
  {
    // 第二条规则刻意抹注释:注释不是调用点,JSDoc 里写示例不得判红
    name: 'JSDoc 注释里的正确用法不报 → 通过',
    mutate: (dir) => writeUnder(
      dir,
      'test/harness/helpers.js',
      '/**\n * 删除沙盒:removeTree(dir, { retryDelay: 200 })\n */\nexport const cleanup = () => undefined;\n',
    ),
    expect: null,
  },
  {
    name: '裸写递归删除(收口面被穿透)',
    mutate: (dir) => writeUnder(dir, 'test/core/case-1.test.js', "} finally {\n  fs.rmSync(dir, { recursive: true, force: true });\n}\n"),
    expect: /test\/core\/case-1\.test\.js:2 → fs\.rmSync\(dir, \{ recursive: true, force: true \}\)/,
  },
  {
    name: '吞错的裸写递归删除(await fs.rm + .catch)',
    mutate: (dir) => writeUnder(dir, 'test/main/case-1.test.js', "await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);\n"),
    expect: /test\/main\/case-1\.test\.js:1 → fs\.rm\(/,
  },
  {
    // 第二条规则的三类真实错用法(门禁文件头「第二条规则」节列的实测结论)
    name: '第二实参非对象(以为覆盖了重试,实则静默用默认)',
    mutate: (dir) => writeUnder(dir, 'test/core/case-2.test.js', 'removeTree(dir, 5);\n'),
    expect: /removeTree 的选项用法:第二实参必须是对象字面量 \{ maxRetries\?, retryDelay\? \},实际是 5/,
  },
  {
    name: '第二实参非法取值(负数会让 Node 抛 ERR_OUT_OF_RANGE)',
    mutate: (dir) => writeUnder(dir, 'test/core/case-3.test.js', 'removeTree(dir, { maxRetries: -1 });\n'),
    expect: /maxRetries 的取值必须是非负有限数字字面量,实际是 -1/,
  },
  {
    name: '第二实参未知键(被 Node 静默忽略,与「没传」不可区分)',
    mutate: (dir) => writeUnder(dir, 'test/core/case-4.test.js', 'removeTree(dir, { maxRetries: 5, force: true });\n'),
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
    shape: { 'test/core': 4, 'test/main': 2, 'test/renderer': 2, 'test/gates': 1, 'test/convert': 1, 'test/cli': 2, 'test/mcp': 1, 'test/harness': 1, 'test/shared': 1 },
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

// 定向断言先跑:它是本段唯一的静态守护,必须在造任何夹具之前就红(夹具红是「脚本起不来」,
// 症状离根因远);它自己绿不绿与 spawn 无关。
assertCopySetIsClosed();

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