// 归档索引生成器自身的回归守护(负向夹具;`check:archive-index` 跑的是它的 --check 模式)。
//
// gen-archive-index.mjs 是 verify:ci 链上的文档侧门禁:若「分流去向」检索退化成恒返回
// null(全表记 —)、或形态断言被摘掉、或 --check 被改成无条件通过,本脚本会打印 `[ok]` 而
// `docs/evidence/INDEX.md` 静默烂掉 —— 新增归档原文后要手改三处、少改一处都不报错的
// 那种漂移正是它要拦的。此处用临时夹具逐条制造这些漂移,断言生成器/校验确实以非零码
// 拒绝,并断言未漂移时通过。
//
// **不修改被测生成器本体,也不复制它**:夹具 = 临时目录里的一棵最小 docs/ 树。纯函数档
// 直接 import 判定本体 `judgeArchiveIndex` 并注入盘面(ADR-074 决定二:判定本体拆出注入面
// 之后,夹具验的就是真规则本身,而不是「进程跑一遍」这种间接证据)—— 那三份 IO(归档目录 /
// 宿主内容 / 索引原文)由 judge 闭包在合成根里现读,与 main 读的是同一组
// readdirSync/readFileSync。项目根单一来源是 shared/paths.js 的 process.cwd(),而 ESM 静态
// import 按**文件位置**解析、与 cwd 无关,所以真生成器的仓内依赖天然可达,沙盒里不需要
// (也不应该)再放一份 shared/。真实仓库只被**读**(baseline 那一条跑真实 docs/ 且带
// --check,零写入)。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则
// 系统临时区会堆满夹具树。
//
// ---- 形态:一张合成根用例表 + 留在原处的 bespoke case(ADR-068 / ADR-074)----
//
// 进表的是**`--check` 族的判红档**:判据收注入的盘面、输出是问题清单,这一族形态一致。
// 表行只放纯数据(仓库相对 POSIX 路径 → 正文),期望正则不带 `[gen-archive-index:fail] `
// 前缀 —— 那是 main 打印时才加的。
//
// 不进表的四族,理由逐条写在各自的组注里:
//   ① **判绿档**(零问题)—— harness 的表结构表达不了这一格(`expect` 必须非空,且恒绿防护
//      把零问题判成失败);
//   ② **prepare 族**(先跑生成模式写盘,再 --check)—— 前置步骤是「起一个子进程写盘」,
//      harness 的入参只能是纯数据(ADR-068 第①条:一旦允许回调,harness 就退化成通用测试
//      框架)。而这一族断言的正是「**先重生成**再 --check」这条真实使用路径 —— 生成与校验
//      是两个模式,少了生成那一步,--check 绿与不绿都证明不了分流去向列真的按名取到了链接;
//   ③ **also 内容断言** —— 断言的是生成出来的索引正文本身(按名引用取链接 / 未引用记 — /
//      说明页被排除 / 形态不合规时不写索引),不是「问题清单」,同样 bespoke;
//   ④ 进程级档(退出码 + 合并输出)。
//
// ⚠ 表内红档的索引正文由被测生成器的**纯函数** `buildArchiveIndex` 现算(不是手抄、也不是
// 起子进程):红档要的形态是「盘上与应生成内容**只差漂移那几行**」,derive 自判定本体正好
// 保证这一点。判绿档因此必须另走进程级生成(组②)—— 若绿档也用 derive 出来的正文,生成器
// 整体写错时夹具会跟着错成一致,那是恒绿。两条路径互补,缺一条就有一个失效面没人守。

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, createCaseSuite } from '../../shared/case.js';
import { runSyntheticRootCases, withSyntheticRoot } from '../../shared/gate-selftest-harness.mjs';
import { ROOT } from '../../shared/paths.js';
import { buildArchiveIndex, judgeArchiveIndex } from './gen-archive-index.mjs';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'gates', 'repo', 'gen-archive-index.mjs');

const INDEX_REL = 'docs/evidence/INDEX.md';

/** 夹具里的两份归档原文:一份被 docs/REQ.md 按名引用(应取可点链接),一份未被引用(应记 —) */
const ARCHIVE_HOSTED = '20260101-101010-REQ-999-宿主引用.md';
const ARCHIVE_ORPHAN = '20260101-202020-REF-888-无宿主.md';

/** 夹具底板里恒含的宿主载体:`REQ.md` 按名引用其中一份归档原文,`CHANGELOG.md` 不引用任何一份 */
const HOST_TREE = Object.freeze({
  'docs/REQ.md': '# 需求台账\n\n见 `20260101-101010-REQ-999-宿主引用.md`。\n',
  'docs/CHANGELOG.md': '# 变更日志\n\n(不按名引用任何归档原文)\n',
});

/** 与 HOST_TREE 同源的宿主内容清单(判定本体的入参形态),两处必须同源否则夹具恒绿 */
const HOST_FILES = Object.freeze(
  Object.entries(HOST_TREE).map(([rel, text]) => ({ rel: rel.replace(/^docs\//, ''), text })),
);

/** 合成根底板:最小 docs/ 树。`evidence/README.md` 按设计应被排除在表外,故底板里恒含它 */
const BASE_TREE = Object.freeze({
  ...HOST_TREE,
  [`docs/evidence/${ARCHIVE_HOSTED}`]: '# fixture\n',
  [`docs/evidence/${ARCHIVE_ORPHAN}`]: '# fixture\n',
  'docs/evidence/README.md': '# evidence 说明页\n',
});

/** 空归档目录形态:evidence/ 下只剩按设计排除的 README.md */
const EMPTY_TREE = Object.freeze({
  ...HOST_TREE,
  'docs/evidence/README.md': '# evidence 说明页\n',
});

/** 期望归档文件名(已过滤 ARCHIVE_EXCLUDED、已排序)—— 与 judgeArchiveIndex 内部的选取同口径 */
const BASE_ARCHIVE_NAMES = Object.freeze([ARCHIVE_HOSTED, ARCHIVE_ORPHAN].sort());

/** 表内红档共用的「索引正文」:盘面与应生成内容只差漂移那几行(derive 自判定本体的纯函数) */
const INDEX_TEXT_BASE = buildArchiveIndex([...BASE_ARCHIVE_NAMES], [...HOST_FILES]);

/** 手工删行形态:把未被引用的那一份归档原文所在行删掉(索引不再是目录的投影) */
const INDEX_TEXT_WITHOUT_ORPHAN = INDEX_TEXT_BASE
  .split('\n')
  .filter((line) => !line.includes(ARCHIVE_ORPHAN))
  .join('\n');

/** 把 extra 铺到底板上(table 行的 `files` 一律是纯数据,不进回调) */
const withFiles = (extra) => ({ ...BASE_TREE, ...extra });

/**
 * judge 闭包:在合成根里现读盘面(与 main 读的是同一组 IO),再交判定本体。
 * @param {string} root 合成根绝对路径
 * @returns {string[]} 问题清单
 */
function judgeAt(root) {
  const docsDir = join(root, 'docs');
  const evidenceDir = join(docsDir, 'evidence');
  const archiveNames = readdirSync(evidenceDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name);
  /** @type {{ rel: string, text: string }[]} */
  const hosts = [];
  /** @param {string} dir @param {string} rel */
  const walkHosts = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (rel === '' && (childRel === 'evidence' || childRel === 'large')) continue;
        walkHosts(join(dir, entry.name), childRel);
      } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'PLAN.md') {
        hosts.push({ rel: childRel, text: readFileSync(join(dir, entry.name), 'utf8') });
      }
    }
  };
  walkHosts(docsDir, '');
  const indexFile = join(root, ...INDEX_REL.split('/'));
  const indexText = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : null;
  return judgeArchiveIndex({ archiveNames, hosts, indexText }).problems;
}

/**
 * 进程级档:以指定 cwd 跑仓内生成器本体。**cwd 即求值根**(shared/paths.js 的 ROOT =
 * process.cwd()),所以这一句同时是「换根」与「不换脚本」—— 夹具里因此不需要、也不该放一份
 * 生成器副本。
 * @param {string} cwd 工作目录
 * @param {string[]} args 传给生成器的参数
 * @returns {{ code: number | null, output: string }} 退出码与合并输出
 */
function runAt(cwd, args) {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * 在合成目录上跑生成器 CLI(进程级档;cwd 指夹具根,argv[1] 指仓内本体 —— 两者恒不相等,
 * 故入口守卫成立)。造树与清理由 harness 的 withSyntheticRoot 承担(清理在 finally)。
 * @param {Record<string, string>} files 假仓库树(仓库相对 POSIX 路径 → 正文)
 * @param {string[]} args 传给生成器的参数
 * @returns {Promise<{ code: number | null, output: string }>}
 */
function runChecker(files, args) {
  return withSyntheticRoot(files, (root) => runAt(root, args));
}

/**
 * prepare 族的跑法:**先跑生成模式**(写索引),再跑断言的那一次(默认 `--check`)。
 * 生成失败即抛 —— 旧实现的 `prepare` 也是这个语义(它自己清目录后重抛,harness 的
 * withSyntheticRoot 在 finally 里清,两者等价)。
 *
 * `prepare: false` 的那几条不先跑生成模式(它要断的正是「没写」,先生成就把索引写出来了)。
 * @param {Record<string, string>} files 假仓库树
 * @param {string[]} args 断言那一次的参数
 * @param {boolean} prepare 是否先跑生成模式
 * @returns {Promise<{ code: number | null, output: string }>}
 */
async function runMaybePrepareThen(files, args, prepare) {
  return withSyntheticRoot(files, async (root) => {
    if (prepare) {
      const gen = runAt(root, []);
      if (gen.code !== 0) throw new Error(`重生成失败:${gen.output}`);
    }
    return runAt(root, args);
  });
}

const suite = createCaseSuite();

// =====================================================================================
// 表一:`--check` 族的判红档(判据收注入的盘面、输出是问题清单 —— 这一族形态一致,进表)
// =====================================================================================

/** @type {import("../../shared/gate-selftest-harness.mjs").SyntheticRootCase[]} */
const CHECK_CASES = [
  {
    // 新增归档原文后漏改索引:生成时它是绿的(生成模式不判红),--check 时才红。
    // 这一条证明「生成 ⇏ 校验通过」—— 也是本门禁存在的理由。
    name: '新增归档原文未重生成索引(漏改一处就不报错的经典形态)',
    files: withFiles({ [INDEX_REL]: INDEX_TEXT_BASE, 'docs/evidence/20260102-101010-第三份.md': '# fixture\n' }),
    expect: /evidence\/INDEX\.md 与目录实际内容不一致\(共 \d+ 行不同\)/,
  },
  {
    name: '索引被手工删行(索引不再是目录的投影)',
    files: withFiles({ [INDEX_REL]: INDEX_TEXT_WITHOUT_ORPHAN }),
    expect: /evidence\/INDEX\.md 与目录实际内容不一致[\s\S]*第 \d+ 行/,
  },
  {
    // 索引文件不存在(从未生成过):`existsSync` 拿不到原文 ⇒ null ⇒ 一条 problems。
    // **底板里恒不含 INDEX.md**,故这一条不需要 mutate。
    name: '索引文件不存在(从未生成过)',
    files: { ...BASE_TREE },
    expect: /evidence\/INDEX\.md 不存在\(应生成\)/,
  },
];

// -------------------------------------------------------------------------------------
// bespoke case:留在原处的那些(不进表),理由逐组写在组注里
// -------------------------------------------------------------------------------------

/**
 * 组一 · prepare 族(**不进表**):前置步骤是「起一个子进程跑生成模式写盘」,harness 的入参
 * 只能是纯数据(ADR-068 第①条)。而这一族断言的正是「**先重生成**再 --check」这条真实使用
 * 路径 —— 生成与校验是两个模式,少了生成那一步,--check 绿与不绿都证明不了分流去向列
 * 真的按名取到了链接。三条绿档全在这一组:判绿档若整体失效,上面那一整组判红档的「红」
 * 就失去意义。
 */
const PREPARE_CASES = Object.freeze([
  {
    // 好样例不能只测「--check 绿」,还要证明生成出来的内容本身是对的
    name: '先重生成再 --check → 通过,且分流去向列按名引用取链接、未引用记 —',
    files: { ...BASE_TREE },
    expectCode: 0,
    also: (root) => {
      const index = readFileSync(join(root, ...INDEX_REL.split('/')), 'utf8');
      if (!index.includes(ARCHIVE_ORPHAN)) throw new Error('索引缺未被引用的那份归档原文');
      if (!index.includes('[REQ.md](../REQ.md)')) throw new Error('「分流去向」列未对被按名引用的原文取可点链接');
      if (!/\|\s*—\s*\|/.test(index)) throw new Error('未被按名引用的原文未记 —');
      if (index.includes('README.md](')) throw new Error('说明页被登记进了表(应排除)');
    },
  },
  {
    // 形态豁免名的生成模式口径:user-guide-vX.Y.md 是唯一不由时间戳命名的归档专用名,
    // 它不该触发形态断言,且应被登记进表(否则「豁免」会退化成「不进表」)。
    name: '形态豁免名 user-guide-vX.Y.md 不算偏差 → 通过',
    files: withFiles({ 'docs/evidence/user-guide-v1.0.md': '# 用户指南归档\n' }),
    expectCode: 0,
    also: (root) => {
      const index = readFileSync(join(root, ...INDEX_REL.split('/')), 'utf8');
      if (!index.includes('[user-guide-v1.0.md](user-guide-v1.0.md)')) throw new Error('豁免名未被登记进表');
      if (!index.includes('[REQ.md](../REQ.md)')) throw new Error('「分流去向」列未对被按名引用的原文取可点链接');
      if (!/\|\s*—\s*\|/.test(index)) throw new Error('未被按名引用的原文未记 —');
    },
  },
  {
    name: '空归档目录(表只有表头)→ 通过',
    files: { ...EMPTY_TREE },
    expectCode: 0,
    also: (root) => {
      const index = readFileSync(join(root, ...INDEX_REL.split('/')), 'utf8');
      if (!index.includes('| 文件 | 工作项ID | 主题 | 分流去向 |')) throw new Error('空目录下索引缺表头');
      if (index.includes(ARCHIVE_HOSTED)) throw new Error('空目录下索引仍登记着归档原文');
    },
  },
  {
    // 形态断言排在生成/比对之前:不合规时宁可不写索引 —— 写出去的表会把偏差固化成「已登记」。
    // 这条**没有 prepare**(它要断的正是「不合规时没写」),故 here 断言索引文件不存在。
    // 直接用 --check 跑(不先跑生成模式):先生成会把索引写出来,那就测不到「没写」。
    name: '形态不合规的历史偏差命名(靠散文约定滑进来的那种)',
    files: withFiles({ 'docs/evidence/随手记.md': '# 随手记\n' }),
    prepare: false,
    expectCode: 1,
    expect: /份文件名不符合 `YYYYMMDD-HHMMSS-<主题>\.md` 形态/,
    also: (root) => {
      if (existsSync(join(root, ...INDEX_REL.split('/')))) throw new Error('形态不合规时仍写出了索引');
    },
  },
]);

/**
 * 组二 · 进程级档(**不进表**):断言的是**退出码 + 合并输出**,不是「问题清单」——
 * harness 的 judge 契约是 `(合成根) => string[]`,把退出码塞进返回数组就是把「问题清单」
 * 那一格撑成通用返回通道(ADR-074 后果节的半齿纪律:期望必须在表里,才谈得上「删一条会留痕」;
 * 这一族一旦改成表,退出码的期望就会离开表)。
 */
const CLI_CASES = Object.freeze([
  {
    name: '未知参数(不得静默按生成模式跑一遍报绿)',
    files: { ...BASE_TREE },
    args: ['oops'],
    expectCode: 1,
    expect: /无法识别的参数/,
  },
  {
    // 正向对照:真实仓库只被读。判红面是**当前事实**,故断言写成「exit 0」而不是写死条数 ——
    // 写死会在下一次新增归档原文时变成一条自己把自己判红的夹具。
    // **不进表**:读的是真实仓而不是注入面,harness 的 judge 只拿得到合成根。
    name: '真实仓库当前索引与目录一致 → 通过',
    realRepo: true,
    args: ['--check'],
    expectCode: 0,
    expect: null,
  },
]);

// -------------------------------------------------------------------------------------
// 跑:表内用例走 harness(它自己建树、跑判定、比对、汇成 case),bespoke 逐条 suite.case。
// -------------------------------------------------------------------------------------

await runSyntheticRootCases({
  group: '--check 族(合成根 · 盘面注入)',
  judge: judgeAt,
  cases: CHECK_CASES,
  suite,
});

// ---- bespoke:prepare 族(先跑生成模式写盘,再 --check;含生成内容断言) ----
await suite.describe('prepare 族(bespoke · 生成模式前置 + 内容断言)', async () => {
  for (const testCase of PREPARE_CASES) {
    await suite.case(testCase.name, async () => {
      const run = await runMaybePrepareThen(testCase.files, ['--check'], testCase.prepare !== false);
      assert(
        run.code === testCase.expectCode,
        `期望 exit=${String(testCase.expectCode)},实际 exit=${String(run.code)}\n${run.output}`,
      );
      // 恒绿防护的等价物:判红档要求「退出码非零**且**输出命中」;判绿档只要求退出码为零。
      assert(
        testCase.expect === undefined || testCase.expect.test(run.output),
        `期望输出匹配 ${String(testCase.expect)},实际 exit=${String(run.code)}\n${run.output}`,
      );
    });
  }
});

// ---- bespoke:进程级档(退出码 + 合并输出,不是「问题清单」) ----
await suite.describe('进程级档(bespoke · 退出码与输出)', async () => {
  for (const testCase of CLI_CASES) {
    await suite.case(testCase.name, async () => {
      const run = testCase.realRepo === true
        ? runAt(projectRoot, testCase.args ?? [])
        : await runChecker(testCase.files, testCase.args ?? []);
      assert(
        run.code === testCase.expectCode,
        `期望 exit=${String(testCase.expectCode)},实际 exit=${String(run.code)}\n${run.output}`,
      );
      // 恒绿防护的等价物:判红档要求「退出码非零**且**输出命中」;判绿档只要求退出码为零。
      assert(
        testCase.expect === null || testCase.expect.test(run.output),
        `期望输出匹配 ${String(testCase.expect)},实际 exit=${String(run.code)}\n${run.output}`,
      );
    });
  }
});

// -------------------------------------------------------------------------------------
// 汇总:段级成败按 case 结果判(与旧实现的 failures[] 判定等价:任一 case 失败即非零退出)。
// -------------------------------------------------------------------------------------

const cases = suite.results;
const failures = suite.failures;
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[archive-index-selftest:fail] ${failure.name}:${failure.message ?? '(无失败消息)'}`);
  }
  console.error(
    `[archive-index-selftest:fail] 归档索引门禁回归守护失败,共 ${String(failures.length)}/${String(cases.length)} 条`,
  );
  process.exit(1);
}
console.log(`[ok] archive-index-selftest:${String(cases.length)} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);
