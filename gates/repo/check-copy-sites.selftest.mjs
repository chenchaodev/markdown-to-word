// 复制点白名单门禁自身的回归守护(负向夹具)。
//
// check-copy-sites.mjs 是 fail-closed 判据,而「按正则扫文本」这类门禁最危险的失效形态是**恒绿**
// (判据写错却什么都不报)。故此处用合成夹具树逐条制造三种违例,断言它确实以非零码拒绝并点名,
// 并断言真实仓库当前判绿 —— 否则上面那个「全绿」无意义。
//
// **夹具树不复制被测门禁**:门禁**原位**从仓内跑、只靠 cwd 指夹具(项目根单一来源是
// shared/paths.js 的 process.cwd(),而入口守卫用代码位置自比,两者恒成立)。
// 被造出来的违例通过「判定层纯函数 judgeCopySites(白名单, 扫描结果)」注入 —— CLI 那一路
// 永远传模块常量,没有「从命令行换一份白名单」的口子(那本身就是一个 fail-open)。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则
// 系统临时区会堆满夹具树。

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../../shared/paths.js';
import {
  COPY_SITE_WHITELIST,
  checkPrimitiveTables,
  collectCopySites,
  formatCopyProblems,
  judgeCopySites,
} from './check-copy-sites.mjs';

const gatePath = fileURLToPath(import.meta.url).replace(/check-copy-sites\.selftest\.mjs$/, 'check-copy-sites.mjs');

/** 合成树里必须存在的四个顶层目录(与门禁的 SCAN_DIRS 同形;门禁遍历它们,缺一个就抛) */
const TREE_DIRS = ['gates', 'shared', 'test', 'tools'];

/**
 * 造一棵合成夹具树。
 * @param {Record<string, string>} files 仓库相对 POSIX 路径 → 正文
 * @returns {string} 夹具根绝对路径
 */
function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'm2w-copy-sites-selftest-'));
  for (const dir of TREE_DIRS) mkdirSync(join(root, ...dir.split('/')), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const target = join(root, ...rel.split('/'));
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, body, 'utf8');
  }
  return root;
}

/** 一份含复制原语的最小文件正文 */
const COPY_BODY = 'import { copyFileSync } from "node:fs";\ncopyFileSync(join(ROOT, "a.mjs"), join(dir, "a.mjs"));\n';
/** 一份不含任何复制原语的最小文件正文 */
const CLEAN_BODY = 'export const x = 1;\n';

/**
 * 只保留「在夹具树里真实存在」的登记项。
 *
 * 为何要这一步:负向①那棵树只放一个文件,若把整份白名单传进去,另外六项会各自额外报一条
 * entry-missing-file,总数就不再等于「新增的那一条」,断言会退化成数个数而非数**判红种类**。
 * @param {string} dir 夹具根
 * @param {typeof COPY_SITE_WHITELIST} [entries] 候选登记项
 * @returns {typeof COPY_SITE_WHITELIST} 过滤后的登记项
 */
function whitelistInTree(dir, entries = COPY_SITE_WHITELIST) {
  const files = new Set(collectCopySites(dir).files);
  return entries.filter((entry) => files.has(entry.file));
}

/**
 * 以某一层 cwd 跑真门禁。
 * @param {string} cwd 工作目录(决定 ROOT)
 * @returns {{ code: number | null; output: string }} 退出码与合并输出
 */
function runGate(cwd) {
  const result = spawnSync(process.execPath, [gatePath], { cwd, encoding: 'utf8', windowsHide: true });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

const failures = [];
/**
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

/** @type {string[]} 夹具根,末尾统一清理 */
const trees = [];
try {
  // ---- 0. 原语表形态:冻结的标识符字面量(它是「不可派生」这条约束的唯一执行点) ----
  {
    const problems = checkPrimitiveTables();
    assert(problems.length === 0, `原语表应判绿,实际:${problems.join("; ")}`);
  }

  // ---- 1. 正向:真实仓库三条断言全过(下面所有负向的「红」才有意义) ----
  {
    const real = judgeCopySites(COPY_SITE_WHITELIST, collectCopySites(ROOT));
    assert(
      real.length === 0,
      `真实仓库的复制点白名单应成立,实际 ${real.length} 项:${formatCopyProblems(real)}`,
    );
    const { code, output } = runGate(ROOT);
    assert(code === 0, `门禁对真实仓库应零退出,实际 exit ${code}\n${output}`);
    console.log(`[ok] copy-sites-selftest:真实仓库三条断言全过(门禁 exit 0)`);
  }

  // ---- 2. 负向①:未登记的文件含复制原语 ⇒ 恰好一条 unregistered,并点名文件与行号 ----
  {
    const dir = makeTree({ 'test/sandbox/new-probe.mjs': COPY_BODY });
    trees.push(dir);
    const problems = judgeCopySites(whitelistInTree(dir), collectCopySites(dir));
    assert(
      problems.length === 1,
      `未登记的复制点应恰好判一条红,实际 ${problems.length} 条:${formatCopyProblems(problems)}`,
    );
    assert(problems[0]?.kind === 'unregistered', `判红种类应为 unregistered,实际 ${problems[0]?.kind}`);
    assert(problems[0]?.file === 'test/sandbox/new-probe.mjs', `须点名那个文件,实际 ${problems[0]?.file}`);
    assert(problems[0]?.line === 2, `须点名复制调用所在行(第 2 行),实际 ${String(problems[0]?.line)}`);
    // 端到端:同一棵树下 CLI 也必须非零退出(证明判据真接在出口上,不是只有纯函数红)
    const { code, output } = runGate(dir);
    assert(
      code !== 0 && /unregistered/.test(output) && /new-probe\.mjs/.test(output),
      `CLI 对未登记复制点应非零退出并点名,实际 exit ${code}\n${output}`,
    );
    console.log(`[ok] copy-sites-selftest:负向①未登记文件含复制原语 → 判红并点名文件与行号(纯函数与 CLI 双路)`);
  }

  // ---- 3. 负向②:登记项的文件还在、但已无复制原语 ⇒ 逐条 entry-has-no-site ----
  //   (正向对照在步骤 1:同一份白名单在真实仓库上判绿)
  {
    /** @type {Record<string, string>} */
    const files = {};
    for (const entry of COPY_SITE_WHITELIST) files[entry.file] = CLEAN_BODY;
    const dir = makeTree(files);
    trees.push(dir);
    const problems = judgeCopySites(COPY_SITE_WHITELIST, collectCopySites(dir));
    const rotted = problems.filter((p) => p.kind === 'entry-has-no-site');
    assert(
      rotted.length === COPY_SITE_WHITELIST.length,
      `复制点全被删时应逐条判红(期望 ${COPY_SITE_WHITELIST.length} 条),实际 ${rotted.length} 条`
      + `:${formatCopyProblems(problems)}`,
    );
    for (const entry of COPY_SITE_WHITELIST) {
      assert(
        rotted.some((p) => p.file === entry.file),
        `须点名已腐烂的登记项 ${entry.file}(漏点名会让「清单越养越宽」这条失效方向看不见)`,
      );
    }
    console.log(
      `[ok] copy-sites-selftest:负向②登记项文件已无复制点 → 逐条判红并逐个点名(${COPY_SITE_WHITELIST.length} 项)`,
    );
  }

  // ---- 4. 负向③:声明清单多一项(登记了一个文件已无复制点的条目)⇒ 判红并点名 ----
  {
    const dir = makeTree({ 'test/sandbox/ok.mjs': COPY_BODY, 'test/sandbox/extra.mjs': CLEAN_BODY });
    trees.push(dir);
    const padded = [
      { file: 'test/sandbox/ok.mjs', copies: ['a.mjs'], why: '自测夹具:唯一那个真有复制点的文件' },
      { file: 'test/sandbox/extra.mjs', copies: null, why: '自测夹具:多出来的一项(extra.mjs 在树里且无复制点)' },
      // 刻意放一条树里根本没有的文件,证明「登记指向不存在的文件」也是红(否则删文件即免罪)
      { file: 'test/sandbox/ghost.mjs', copies: null, why: '自测夹具:多出来的一项(文件根本不存在)' },
    ];
    const problems = judgeCopySites(padded, collectCopySites(dir));
    assert(
      problems.length === 2,
      `两项多余登记应各判一条红,实际 ${problems.length} 条:${formatCopyProblems(problems)}`,
    );
    assert(
      problems.some((p) => p.kind === 'entry-has-no-site' && p.file === 'test/sandbox/extra.mjs'),
      `须点名「已无复制点」的那一项,实际:${formatCopyProblems(problems)}`,
    );
    assert(
      problems.some((p) => p.kind === 'entry-missing-file' && p.file === 'test/sandbox/ghost.mjs'),
      `须点名「文件不存在」的那一项(删文件不得成为免罪符),实际:${formatCopyProblems(problems)}`,
    );
    assert(
      problems.every((p) => p.file !== 'test/sandbox/ok.mjs'),
      `真有复制点且登记齐了的那一项不该被牵连:${formatCopyProblems(problems)}`,
    );
    console.log(`[ok] copy-sites-selftest:负向③声明清单多一项 → 判红并点名(已无复制点 / 文件不存在两种形态)`);
  }
} finally {
  for (const dir of trees) rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[copy-sites-selftest:fail] ${failure}`);
  console.error(`[copy-sites-selftest:fail] 复制点白名单门禁回归守护失败,共 ${failures.length} 项`);
  process.exit(1);
}
console.log('[ok] copy-sites-selftest:4 组夹具全部符合预期(真实仓库判绿 / 三种违例各判红并点名)');