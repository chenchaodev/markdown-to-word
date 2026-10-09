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
//
// ---- 形态:case 契约接入,但**不接 harness**(ADR-074 决定一)----
//
// 用 `shared/case.js` 的 `createCaseSuite`,`suite.case(档名, () => …)` 建一次、逐档登记。
// 门禁树接的是落在 shared/ 的真实现:`gates-stay-in-gates` 的允许面只有 `gates` / `shared` /
// `test/fixtures`,`test/` 整棵树不在其中,故引不到 `test/harness/case.js`。
//
// **不用合成根 harness**:本文件的判定走 spawn CLI(夹具里那份门禁副本 + cwd 指夹具根),入参是
// **夹具树路径**(以及两条改门禁源码的 mutate),而 harness 的表只收「树型路径 → 正文 + 问题清单
// 正则」且判定体须回吐**问题清单** —— 入参与返回两侧都不对型,塞进去是假接入(ADR-068:bespoke
// 留在原处)。接 case 契约解决的是另一件事:让「档数」成为可机械计数的单位
// (`gates-selftest-named-case` 判的就是它),迁移后分母由 `suite.results.length` 给出
// (= 夹具表 16 + 表外的「沙盒副本闭包」1 = 17;旧分母 16 不含那块静态断言,这是**可见性增加**)。
//
// ⚠ **表外那块的次序语义**:`assertCopySetIsClosed()` 今天在主循环前无条件先跑,它红的时候后面
// 16 条一条都不该跑。迁移后把它收成**第一个** case,`await` 的书写次序即执行次序,这一格不丢。
// 它表内三处 throw(含「一条相对 import 都没抽到 ⇒ 判据本身失效」那条自我否定断言)原样留在
// case 体内 —— 现在由 case 级 catch 收成「该 case 失败」,语义等价且更强。

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix, join } from 'node:path';
import { assert, createCaseSuite } from '../../shared/case.js';
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
  'test/behavior': 2,
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
  // 判据 0 的判定本体:门禁 import 它,不拷则夹具里 import 解析不到、门禁起不来
  'gates/repo/protected-tree.mjs',
  // protected-tree.mjs 的仓内依赖(它按派生单源取被保护路径,不 import S4 将删的 contract.mjs)
  'gates/repo/repo-manifest.mjs',
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
  // 判据 0 的承接体与它的依赖(原型 scanTopLevel 会读夹具根的顶层声明,故必须在场)
  copyFileSync(
    join(projectRoot, 'gates', 'repo', 'protected-tree.mjs'),
    join(dir, 'gates', 'repo', 'protected-tree.mjs'),
  );
  copyFileSync(
    join(projectRoot, 'gates', 'repo', 'repo-manifest.mjs'),
    join(dir, 'gates', 'repo', 'repo-manifest.mjs'),
  );
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
    shape: { 'test/core': 4, 'test/main': 2, 'test/renderer': 2, 'test/gates': 1, 'test/convert': 1, 'test/cli': 2, 'test/mcp': 1, 'test/harness': 1, 'test/shared': 1, 'test/behavior': 1 },
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
  {
    // 判据 0(真实工作树零注入)的负向夹具。这一格是 ADR-062 裁决「从沙盒层取出来、挂到
    // check:temp-cleanup」的唯一存在理由:门禁跑的过程中把真实工作树改坏,必须判红。
    //
    // 注入方式与上面那条 SELF_PROBE 夹具同形:改写门禁副本的源码,在跑前快照**之后**、
    // 跑后快照之前插一次真实的写。写的是被保护路径 package.json(顶层声明文件,指纹集必含),
    // 故 changedPaths 与 changedFiles 两路都会命中。
    //
    // 为何必须造「门禁自己写」而不是「门禁跑之前树就已经脏」:后者两份快照相同、恒判绿,
    // 证明不了任何事 —— 本判据的对象是**本次运行期间**发生的变化。
    name: '门禁跑的过程中写坏了真实工作树(指纹判红并点名)',
    mutate: (dir) => {
      // 门禁副本只 import 了 node:fs 的 readFileSync,故连 import 行一并改掉再插写入
      patchInFixture(
        dir,
        'gates/repo/check-temp-cleanup.mjs',
        "import { readFileSync } from 'node:fs';",
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
      );
      patchInFixture(
        dir,
        'gates/repo/check-temp-cleanup.mjs',
        '  const treeBefore = snapshotProtectedTree(root);',
        [
          '  const treeBefore = snapshotProtectedTree(root);',
          // 写派生集里确实存在的被保护路径。**不写 package.json**:夹具根没有包清单,
          // 它压根不在该根派生的 protectedTreePaths 内(写了也不会被指纹看见 —— 这正是
          // 「派生而非手写枚举」的正确行为,不是判据漏判)。
          "  writeFileSync(path.join(root, 'shared', 'injected-by-gate.js'), 'export const x = 1;\\n', 'utf8');",
        ].join('\n'),
      );
    },
    expect: /本次运行期间真实工作树指纹不一致[\s\S]*变化路径:[^\n]*shared[\s\S]*shared\/injected-by-gate\.js/,
  },
  {
    // 反向锚点:同一格判据的反方向。node_modules 哨兵单独被增删(工作树文件一个没动)
    // 也必须判红 —— 否则哨兵那一路是恒绿的装饰。
    name: '运行期间只增删 node_modules 顶层项(哨兵判红,变化路径为空)',
    mutate: (dir) => {
      patchInFixture(
        dir,
        'gates/repo/check-temp-cleanup.mjs',
        "import { readFileSync } from 'node:fs';",
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
      );
      patchInFixture(
        dir,
        'gates/repo/check-temp-cleanup.mjs',
        '  const treeBefore = snapshotProtectedTree(root);',
        [
          '  const treeBefore = snapshotProtectedTree(root);',
          "  mkdirSync(path.join(root, 'node_modules', 'injected-pkg'), { recursive: true });",
        ].join('\n'),
      );
    },
    expect: /node_modules 哨兵已被增删/,
  },
];

// 定向断言先跑:它是本段唯一的静态守护,必须在造任何夹具之前就红(夹具红是「脚本起不来」,
// 症状离根因远);它自己绿不绿与 spawn 无关。
//
// 收成**第一个** case(档名固定为「沙盒副本闭包」),守住「主循环前无条件先跑」的次序语义:
// 它红的时候后面 16 条一条都不该跑。`[ok]` 行里那两条动态值(抽到的相对 import 条数 / 复制集
// 项数)随之进日志,不再进档名;表内三处 throw 原样留在 case 体内,由 case 级 catch 收成
// 「该 case 失败」。
const suite = createCaseSuite();
await suite.case('沙盒副本闭包', () => assertCopySetIsClosed());

/**
 * 跑一档并按声明核对结果(收进 `suite.case` 的断言体,抛错只记该档失败、不中断后续档)。
 *
 * 两种声明互斥:`expect: null`(要求 exit 0)与 `expect`(要求 exit≠0 且命中)。
 *
 * 搬迁口径:原 `failures.push(...)` 逐条改成 `assert(条件, 消息)` —— **消息逐字沿用**(含
 * 「夹具 / 真实仓库」那个 tag 前缀),原 `[ok]` 打印保留。造夹具失败那一格原来 push 后
 * `continue`(createFixture 自己已清理),现在改成抛出同一条消息,由 case 级 catch 收成
 * 「该档失败」—— 同样不打断后续档。
 * @param {object} testCase 夹具表里的一档
 */
function runCase(testCase) {
  let dir;
  try {
    // `dir` 显式给出 = 跑真实仓库(只读);否则造夹具并在下方 finally 清理
    dir = testCase.dir ?? createFixture(testCase.mutate, testCase.shape);
  } catch (error) {
    throw new Error(
      `夹具 ${testCase.name}:造夹具抛异常:${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const { code, output } = runChecker(dir, testCase.raw ?? []);
    const tag = testCase.dir === undefined ? '夹具' : '真实仓库';
    if (testCase.expect === null) {
      assert(code === 0, `${tag} ${testCase.name}:期望通过,实际 exit ${code}\n${output}`);
      console.log(`[ok] temp-cleanup-selftest:${testCase.name}(门禁通过,exit 0)`);
      return;
    }
    assert(
      code !== 0 && testCase.expect.test(output),
      `${tag} ${testCase.name}:期望 exit≠0 且输出匹配 ${testCase.expect},实际 exit ${code}\n${output}`,
    );
    console.log(`[ok] temp-cleanup-selftest:${testCase.name}(漂移被拦截,exit ${code})`);
  } finally {
    if (testCase.dir === undefined && dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

// 夹具表逐档收进 case:**档名即 case 名**(逐字沿用搬迁前 `failures.push` 记账用的 `testCase.name`)。
for (const testCase of CASES) {
  await suite.case(testCase.name, () => runCase(testCase));
}

/* ---------- 汇总:段级成败按 case 结果判 ---------- */
// 与搬迁前 `failures[]` 判定等价(任一档失败即非零退出),**分母也换成同一个**:搬迁前写
// `CASES.length`(16,不含表外那块),搬迁后由 `suite.results.length` 自然给出 17 —— 两侧一旦
// 不等,说明有档没接进 case,那正是 `gates-selftest-named-case` 要抓的形态。
const cases = suite.results;
const failedCases = suite.failures;
if (failedCases.length > 0) {
  for (const failure of failedCases) {
    console.error(`[temp-cleanup-selftest:fail] ${failure.name}:${failure.message ?? '(无失败消息)'}`);
  }
  console.error(
    `[temp-cleanup-selftest:fail] 临时目录清理门禁回归守护失败,共 ${failedCases.length}/${cases.length} 条`,
  );
  process.exit(1);
}
console.log(`[ok] temp-cleanup-selftest:${cases.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);