// fixtures 漂移门禁(gen-fixtures.mjs --check)自身的回归守护(负向夹具)。
//
// 这道门禁的**承重能力是「点名」**:产物漂移了,诊断里必须出现**那个 fixture 的文件名**
// (「是谁坏了」),而不只是「有什么坏了」。这正是沙盒探针 gates/probe/gate-probes/gates/
// fixtures.mjs 唯一测的东西,而探针是 P6 的删除对象 —— 探针一删,这一格就无人接手。
//
// ⚠ 为什么必须有这份 selftest(而不是「只留 test/gates/fixture-contract.test.js」):
//   那条段守的是**判定函数层**(validateSegmentContract / auditImageDigests /
//   planFixtureOutputs / findOutputNameCollisions),全部喂**合成模块对象或合成记录**,
//   **从不注入真实漂移**:它证明「契约规则没写坏」,不证明「产物真的漂了会被抓住并点名」。
//   两者的差别正是本文件要补的那一格 —— 本文件在**合成夹具树上真跑门禁本体**并注入漂移。
//
// 形态(**判定本体与 CLI 分离**,与 gates/repo/check-src-layout.selftest.mjs 同款):
//   门禁**原位**从仓内跑、只靠 cwd 指夹具(项目根单一来源是 shared/paths.js 的
//   process.cwd();ESM 静态 import 按**文件位置**解析、与 cwd 无关,故真脚本的仓内依赖
//   天然可达)。**不复制门禁本体**:复制一份进来会把「规则的演进」冻在夹具里 ——
//   门禁改了规则,夹具还绿。
//
// ---- 合成树要长什么样(为什么不能只造 samples/docs/) ----
// gen-fixtures.mjs 的判定面不止「比对 docs/」,还有两条会先于比对执行的家族:
//   ① 段契约:它 import `test/<段目录>/*.test.js` 并读显式导出。段目录集合来自
//      shared/test-common-surface.js 的 SEGMENT_DIRS(真实数组,本文件 import 同一份),
//      故合成树**必须**把这十个目录都建出来,否则 readdirSync 抛错、门禁因错误原因失败
//      (而「因错误原因失败」不是「判红」,负向结论不成立);
//   ② 图片夹具字节基线:IMAGE_DIGEST_BASELINE 是**模块常量**,里面五个键是真实仓库图片的
//      路径。合成树里当然没有这些图 ⇒ 未漂移时该族恒判红(基线残留)。
//      ⇒ 合成树必须**按基线逐个造出那五张图**,否则「正向锚点」永远是红的,锚点失去意义。
//      造法:从真实仓库**读**那五张图的字节写进合成树(夹具只读真实仓库,不改它)。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则系统
// 临时区会堆满夹具树。本脚本全部写操作都落在 mkdtemp 出来的目录里、**不碰真实工作树**。

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURES_DIR, ROOT } from '../../shared/paths.js';
import { IMAGE_DIGEST_BASELINE } from './gen-fixtures.mjs';
import { SEGMENT_DIRS } from '../../shared/test-common-surface.js';

const gatePath = join(ROOT, 'gates', 'fixtures', 'gen-fixtures.mjs');

/**
 * 合成段模块的源文本模板。
 *
 * 为什么段要写成**带真实 export 的 .js 模块**而不是 stub:门禁是**动态 import 段文件**读显式
 * 契约的(文件头:「逐个动态 import 后读显式契约」)。桩件骗不过 import。
 * `.test.js` 落在合成树里而合成树带 `package.json {type:"module"}`(见 buildTree 的说明),
 * 否则 Node 按 CJS 解析 → import 抛 SyntaxError → 门禁因错误原因失败。
 * @param {string | null} fixtures 场景映射的字面量文本(整段替换进去)
 * @param {string} description meta.description 文案
 * @returns {string}
 */
function segmentSource(fixtures, description) {
  return `export const fixtures = ${fixtures};
export const meta = { description: ${JSON.stringify(description)} };
export function run() {}
`;
}

/** 主段:单场景 main */
const SEG_ALPHA = segmentSource('{ main: "# 标题\\n\\n正文。\\n" }', '合成段 alpha 的样例');
/** 副段:两个场景(产物文件名一个带后缀一个不带) */
const SEG_BETA = segmentSource('{ main: "# beta\\n", extra: "# beta extra\\n" }', '合成段 beta 的样例');
/** 无样例段:显式声明 fixtures = null(合法终态,不该判红) */
const SEG_GAMMA = segmentSource('null', '合成段 gamma 无验收样例');

/** 合成段固定放在 core / main 两个目录(段目录集合由 SEGMENT_DIRS 决定,这里只挑位置) */
const SEG_FILES = Object.freeze({
  'test/core/selftest-alpha.test.js': SEG_ALPHA,
  'test/main/selftest-beta.test.js': SEG_BETA,
  'test/gates/selftest-gamma.test.js': SEG_GAMMA,
});

/** 期望的产物文件名(由段的 baseName + 场景键推出;断言时逐个点名用) */
const PRODUCT_ALPHA = 'selftest-alpha.md';
const PRODUCT_BETA = 'selftest-beta.md';
const PRODUCT_BETA_EXTRA = 'selftest-beta-extra.md';

/**
 * 造一棵合成树,并先跑一次**生成**(不带 --check)把 samples/docs/ 铺成与段导出一致的形态。
 *
 * 为什么不手写 docs/ 的产物内容:内容规则(文件名后缀、README 行序、图片复制)住在门禁本体里,
 * 手写就等于把「规则改了夹具还绿」重新引入一次。让门禁自己生成,合成树才与真实流程同形。
 *
 * @param {(dir: string) => void} [mutate] 生成之后施加的漂移
 * @returns {string} 合成树根绝对路径
 */
function buildTree(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'm2w-fixtures-selftest-'));
  try {
    // 段模块按 ESM 解析的依据。缺它 → import 抛 SyntaxError → 门禁因错误原因失败。
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
    // 门禁遍历 SEGMENT_DIRS 每一个目录:少建一个就 readdirSync 抛错(不是判红)
    for (const relDir of SEGMENT_DIRS) mkdirSync(join(root, 'test', ...relDir.split('/')), { recursive: true });
    for (const [rel, body] of Object.entries(SEG_FILES)) {
      const target = join(root, ...rel.split('/'));
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, body, 'utf8');
    }
    // 图像夹具基线:合成树里必须**有**那五张图,否则「未漂移」也恒判红(基线残留),
    // 正向锚点失去意义。字节从真实仓库读(只读),写到合成树里。
    for (const rel of Object.keys(IMAGE_DIGEST_BASELINE)) {
      const target = join(root, 'samples', ...rel.split('/'));
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, readFileSync(join(FIXTURES_DIR, ...rel.split('/'))), 'utf8');
    }
    const generated = runGate(root, []);
    if (generated.code !== 0) {
      throw new Error(`合成树生成失败(exit ${String(generated.code)}),夹具不可信:\n${generated.output}`);
    }
    for (const name of [PRODUCT_ALPHA, PRODUCT_BETA, PRODUCT_BETA_EXTRA, 'README.md']) {
      const target = join(root, 'samples', 'docs', ...name.split('/'));
      if (!existsFile(target)) {
        throw new Error(`合成树生成后缺产物 ${name}(生成输出:\n${generated.output})—— 夹具不可信`);
      }
    }
    // `mutate` 用「非函数」判空而不是 `!== undefined`:夹具表里「无漂移」那条写的是
    // `mutate: null`,若按 undefined 判空会把 null 当函数调用 → TypeError 崩在夹具里。
    if (typeof mutate === 'function') mutate(root);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 存在性薄封装(只用 existsSync,不必把整个 fs 命名空间搬进来)。
 * @param {string} target 绝对路径
 * @returns {boolean}
 */
function existsFile(target) {
  try {
    readFileSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 以某一层 cwd 跑仓内门禁本体(--check 是本 selftest 的判定档;不带参数是生成档)。
 * @param {string} cwd 工作目录(决定 ROOT,即求值根)
 * @param {string[]} args 传给门禁的参数
 * @returns {{ code: number | null; output: string }}
 */
function runGate(cwd, args) {
  const result = spawnSync(process.execPath, [gatePath, ...args], { cwd, encoding: 'utf8', windowsHide: true });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * 抽取「诊断里点了哪些产物名」这一格。
 *
 * 为什么不直接 `expect: /某文件名/` 就完事:那会让「因为别的原因红、顺带提到了这个名字」
 * 也算通过。这里的做法是**只认 `[check] <名字>:` 这一种前缀**(门禁 report() 的输出形态),
 * 落进集合后逐个比对 —— 于是「点名了别的 fixture」与「点名了这个 fixture」是可区分的。
 * @param {string} output 门禁合并输出
 * @returns {{ products: string[], images: string[] }}
 */
function parseDiagnostics(output) {
  const products = [];
  const images = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^\[check\]\s+(.+?):/.exec(line);
    if (m === null) continue;
    const name = m[1] ?? '';
    if (name === '图片夹具') images.push(line);
    else products.push(name);
  }
  return { products, images };
}

/* ---------- 夹具表 ---------- */

const CASES = [
  {
    name: '正向锚点:合成树未漂移 → exit 0 且零 [check] 诊断(证明下面每条负向的红都来自注入的故障)',
    mutate: null,
    expectCode: 0,
    expectProducts: [],
  },
  {
    // ★ 本文件存在的首要理由:改动一个 fixture 的内容,门禁判红**并点名那个文件**。
    name: '注入:改一个 fixture 的内容(末行追加)→ exit 非 0 且诊断点名该 fixture 文件名',
    mutate: (dir) => {
      appendFileSync(join(dir, 'samples', 'docs', PRODUCT_ALPHA), '\n<!-- 故意漂移 -->\n', 'utf8');
    },
    expectCode: 1,
    expectProducts: [PRODUCT_ALPHA],
    expectOutput: /内容不一致\(首处差异第 \d+ 行\)/,
  },
  {
    // 第二格:删一个 fixture(与「改内容」是两种形态,只挡一种的「部分修复」仍是恒绿退化)
    name: '注入:删一个 fixture → exit 非 0 且诊断点名该 fixture 文件名与「缺失」',
    mutate: (dir) => {
      rmSync(join(dir, 'samples', 'docs', PRODUCT_BETA_EXTRA), { force: true });
    },
    expectCode: 1,
    expectProducts: [PRODUCT_BETA_EXTRA],
    expectOutput: /缺失\(应生成\)/,
  },
  {
    // 反向锚点:漂移的是**另一个**产物时,不得把没被动过的那个也点进名(否则「点名」退化为
    // 「把所有产物名都列一遍」,诊断也就没有归因价值了)
    name: '注入:只漂移 beta-extra → 诊断**只**点名它,alpha 与 beta 不在点名集合里',
    mutate: (dir) => {
      appendFileSync(join(dir, 'samples', 'docs', PRODUCT_BETA_EXTRA), '\n<!-- 只动这一个 -->\n', 'utf8');
    },
    expectCode: 1,
    expectProducts: [PRODUCT_BETA_EXTRA],
    expectOutput: /内容不一致/,
  },
  {
    // README 索引也是产物面:它漂了必须被点名,否则索引与样例不一致时无人知情
    name: '注入:改 README.md 索引 → exit 非 0 且诊断点名 README.md',
    mutate: (dir) => {
      appendFileSync(join(dir, 'samples', 'docs', 'README.md'), '\n| 多出来的一行 | x | y |\n', 'utf8');
    },
    expectCode: 1,
    expectProducts: ['README.md'],
    expectOutput: /内容不一致/,
  },
  {
    // 图片夹具漂移这一族与 md 漂移正交(门禁文件头有长注:曾发生的真实误判正是这一族)。
    // 这里只断言「字节漂移被抓住且点名该图」,覆盖面由 test/gates/fixture-contract.test.js 守。
    name: '注入:改一张图片夹具的字节 → exit 非 0 且诊断点名该图片路径',
    mutate: (dir) => {
      const target = join(dir, 'samples', ...'manual/images/logo.png'.split('/'));
      const bytes = readFileSync(target);
      writeFileSync(target, Buffer.concat([bytes, Buffer.from([0])]), 'utf8');
    },
    expectCode: 1,
    // 图片族在门禁里是以「图片夹具」为名前缀逐条列出的(行首即图片相对路径),
    // 故断言落在 images 通道而不是 products。
    expectProducts: [],
    expectImages: ['manual/images/logo.png'],
    expectOutput: /字节漂移/,
  },
  {
    // 「新增夹具没登记」这一格:静默放行正是本条要治的病,故必须判红并点名新文件。
    name: '注入:新增一张未登记的图片夹具 → exit 非 0 且诊断点名该图片路径',
    mutate: (dir) => {
      writeFileSync(join(dir, 'samples', 'manual', 'images', 'selftest-new.png'), Buffer.from([1, 2, 3]), 'utf8');
    },
    expectCode: 1,
    expectProducts: [],
    expectImages: ['manual/images/selftest-new.png'],
    expectOutput: /未登记字节基线/,
  },
];

/** @type {string[]} */
const failures = [];
for (const testCase of CASES) {
  /** @type {string | undefined} */
  let root;
  try {
    root = buildTree(testCase.mutate ?? undefined);
    const run = runGate(root, ['--check']);
    const { products, images } = parseDiagnostics(run.output);
    const problems = [];
    if (run.code !== testCase.expectCode) {
      problems.push(`期望 exit=${String(testCase.expectCode)},实际 exit=${String(run.code)}`);
    }
    // 点名集合必须**逐个相同**(有序无关):既不许漏点,也不许多点。
    const wantProducts = [...(testCase.expectProducts ?? [])].sort();
    if (products.slice().sort().join(",") !== wantProducts.join(",")) {
      problems.push(`期望点名的产物集合为 [${wantProducts.join(", ")}],实际 [${products.join(", ")}]`);
    }
    const wantImages = [...(testCase.expectImages ?? [])].sort();
    if (images.length !== wantImages.length || wantImages.some((rel) => !images.some((line) => line.includes(rel)))) {
      problems.push(`期望点名的图片为 [${wantImages.join(", ")}],实际诊断:\n${images.join("\n") || "(无图片诊断)"}`);
    }
    if (testCase.expectOutput !== undefined && !testCase.expectOutput.test(run.output)) {
      problems.push(`诊断文案不匹配 ${testCase.expectOutput},实际:\n${run.output}`);
    }
    if (problems.length > 0) {
      failures.push(`${testCase.name}:${problems.join("; ")}`);
      continue;
    }
    console.log(`[ok] fixtures-selftest:${testCase.name}(exit ${String(run.code)})`);
  } catch (error) {
    failures.push(`${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
}

/* ---------- 恒绿防护:门禁失效 / 夹具失真都不许静默绿 ---------- */
// 上表的「正向锚点」只挡住「判据恒红」。另有一种失效是**门禁整体坏掉**(比如 import 段失败
// 而门禁改成静默跳过),此时所有负向夹具都会因为「诊断没点名」而红 —— 已经够了。此处再钉
// 一条:正向锚点的 exit 0 必须在**真的没有** [check] 诊断时成立,不能靠「exit 0 但诊断里
// 有一堆点名」蒙混(那说明判定顺序被换过,产物比对没真跑)。
{
  const root = buildTree(null);
  try {
    const run = runGate(root, ['--check']);
    const { products, images } = parseDiagnostics(run.output);
    const problems = [];
    if (run.code !== 0) problems.push(`期望 exit 0,实际 ${String(run.code)}\n${run.output}`);
    if (products.length > 0) problems.push(`产物比对面竟有点名诊断:${products.join(", ")}(判定顺序可能被换过)`);
    if (images.length > 0) problems.push(`图片夹具面竟有诊断:\n${images.join("\n")}`);
    if (!/--check 通过/.test(run.output)) problems.push(`缺「--check 通过」结论行:\n${run.output}`);
    if (problems.length > 0) {
      failures.push(`正向锚点的「真绿」形态:${problems.join("; ")}`);
    } else {
      console.log('[ok] fixtures-selftest:正向锚点的真绿形态(exit 0 + 零点名诊断 + 有「--check 通过」结论行)');
    }
  } catch (error) {
    failures.push(`正向锚点的真绿形态:抛异常:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* ---------- 归因:诊断里那句能定位到文件的话,原文长什么样 ---------- */
// 上表断言的是「名字出现在点名集合里」。这里额外把**可读的那一段原文**打出来,
// 便于人眼确认诊断确实能定位(而不只是名字出现过)。判定与断言在上面,这里只输出。
{
  const root = buildTree((dir) => {
    appendFileSync(join(dir, 'samples', 'docs', PRODUCT_ALPHA), '\n<!-- 故意漂移 -->\n', 'utf8');
  });
  try {
    const run = runGate(root, ['--check']);
    const excerpt = run.output
      .split(/\r?\n/)
      .filter((line) => line.includes(PRODUCT_ALPHA))
      .join("\n");
    if (excerpt === "") {
      failures.push(`归因摘录:诊断里找不到 ${PRODUCT_ALPHA} 的任何一行 —— 点名能力已丢失`);
    } else {
      console.log(`[ok] fixtures-selftest:归因摘录(诊断原文含 ${PRODUCT_ALPHA}):\n${excerpt}`);
    }
  } catch (error) {
    failures.push(`归因摘录:抛异常:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[fixtures-selftest:fail] ${failure}`);
  console.error(`[fixtures-selftest:fail] fixtures 漂移门禁回归守护失败,共 ${failures.length}/${CASES.length + 2} 条`);
  process.exit(1);
}
console.log(`[ok] fixtures-selftest:${CASES.length + 2} 条夹具全部符合预期(未漂移通过 / 注入漂移后判红且点名该 fixture)`);