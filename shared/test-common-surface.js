// @ts-check
/**
 * 测试扫描面 · 单一来源(4 处消费方共用)。
 *
 * 本模块**零仓库内依赖**(只 import node: 内建):门禁自检脚本要把它整份拷进临时夹具树
 * 单独跑,牵连别的模块就得连那份一起拷。项目根由调用方注入 —— 全仓唯一允许自算根的位置
 * 是 shared/paths.js(见 check-import-boundary.mjs 的规则 no-self-computed-root),本模块
 * 刻意不 import ROOT。
 *
 * ---- 收口了什么(此前同一份知识散在 4 处,其中 2 处逐字相同)----
 * 1. **段目录集合**(测试发现面):test/acceptance.mjs 交给 runner 的三目录 ·
 *    test/tools/gen-fixtures.mjs 的扫描目录 —— 现为同一数组对象 SEGMENT_DIRS,恒等由
 *    「同一对象」保证,不再靠两处各写一份再比对文本。
 * 2. **扫描面与 walker**:扫描目标 / 排除目录 / 扫描文件数下限 / 递归列目录 —— 原先
 *    check-test-numbering.mjs 与 check-temp-cleanup.mjs 各持一份逐字相同的副本(70 行 diff
 *    的唯一差异是两个 SNIPPET_MAX 常量值),现只此一份。两个门禁各自的规则、白名单、
 *    诊断文案仍留在各自文件(那些不是重复知识,是各自的判定口径)。
 *
 * ---- 两条完整性判据的分工(等式 + 下限,不是二选一)----
 * **等式**(checkSurfaceEquality):声明面(SCAN_TARGETS 的目录集合)必须与实测面(磁盘上真实
 *   存在、且含测试源文件的 test/ 子目录)逐个相同。它是唯一能抓「少扫一个子目录」的判据:
 *   新增一个测试子目录而漏登记时,walker 照样扫到上百个文件,下限照样满足,门禁**静默恒绿**。
 * **下限**(judgeScanFloor):只回答「walker 是不是整体坏了」(目录改名 / 权限 → 退化成零文件
 *   全过,那是假通过)。漏一个子目录时文件数仍远超下限,故下限替代不了等式;反过来,walker
 *   若整体扫不到文件,目录集合仍与磁盘一致,等式照样成立,也替代不了下限。两条各管一件事。
 *
 * ---- 为何目录集合仍是一份手写枚举,而不是从磁盘派生 ----
 * 每个目录的**文件判定**不同(段目录只收 *.test.js,common 收 *.js,tools 收 *.js|.mjs),
 * 磁盘上读不出「这个目录该按哪种谓词扫」;而派生真正要防的那类漏(多一个目录没登记),
 * 等式判据已经覆盖 —— 它判红并点名那个目录。故此处收敛的是「同一份知识只有一处」,
 * 不是把枚举换成猜测。
 */
import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * 段目录(测试发现面):test/ 下的段目录,「验收跑哪些段」的唯一声明。
 * 同一数组既交给 runner 做段发现(acceptance.mjs),也作为门禁扫描面的前几个目标派生
 * —— 从同一处派生,才能保证「验收发现的段」与「门禁扫的段」永远同集合。
 * @type {readonly string[]}
 */
export const SEGMENT_DIRS = Object.freeze(["segments", "main", "renderer"]);

/** 段文件判定(与 test/common/runner.js 的 discoverSegments 同口径:只收 *.test.js) */
const isSegmentFile = (/** @type {string} */ name) => name.endsWith(".test.js");

/**
 * 扫描目标(声明面):目录 + 该目录下的文件判定。
 * 排除写成显式清单(EXCLUDED_DIRS):将来有人把扫描面扩到整个 test/ 时,该目录必须仍然在外,
 * 而不是靠「它恰好不在目标里」蒙对。
 * @type {readonly { dir: string, accept: (name: string) => boolean }[]}
 */
export const SCAN_TARGETS = Object.freeze([
  ...SEGMENT_DIRS.map((name) => ({ dir: `test/${name}`, accept: isSegmentFile })),
  { dir: "test/common", accept: (/** @type {string} */ name) => name.endsWith(".js") },
  { dir: "test/tools", accept: (/** @type {string} */ name) => /\.(js|mjs)$/.test(name) },
]);

/** 显式排除目录(仓库相对 POSIX 路径;前缀匹配)。test/fixtures 是被测样例数据本身,不是断言。 */
const EXCLUDED_DIRS = Object.freeze(["test/fixtures"]);

/**
 * 扫描文件数下限:walker 静默失效(目录改名 / 权限)会退化成「零文件全过」,那是假通过。
 * 留一半余量;它**只**管 walker 整体失效,不管漏目录(那由等式管,见文件头)。
 */
export const MIN_SCAN_FILES = 50;

/** 实测面的「含测试源文件」判据:与三个门禁的接受扩展名并集一致(含 .cjs 以免漏判) */
const SOURCE_FILE_RE = /\.(?:js|mjs|cjs)$/;

/**
 * 排除前缀判定(带 / 边界,避免 test/fixturesX 误判)。
 * @param {string} rel 仓库相对 POSIX 路径
 * @returns {boolean}
 */
function isExcluded(rel) {
  return EXCLUDED_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
}

/**
 * 递归列出该目录下参与扫描的文件(仓库相对 POSIX 路径,已排序)。
 * @param {string} root 仓库根绝对路径(调用方注入)
 * @param {string} relDir 仓库相对目录
 * @returns {string[]} 文件相对路径
 */
function listScannableFiles(root, relDir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel 仓库相对 POSIX 目录 */
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(root, ...rel.split("/")), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${rel}/${entry.name}`;
      if (isExcluded(child)) continue;
      if (entry.isDirectory()) walk(child);
      else if (!entry.name.startsWith(".")) out.push(child);
    }
  };
  walk(relDir);
  return out;
}

/**
 * 收集参与扫描的文件清单(按 SCAN_TARGETS 判定扩展名)。
 * @param {string} root 仓库根绝对路径(调用方注入)
 * @returns {string[]} 仓库相对 POSIX 路径,已排序
 */
export function listScanFiles(root) {
  /** @type {string[]} */
  const files = [];
  for (const target of SCAN_TARGETS) {
    for (const rel of listScannableFiles(root, target.dir)) {
      if (target.accept(path.posix.basename(rel))) files.push(rel);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * 实测面:磁盘上真实存在、且至少含一个测试源文件的 test/ 子目录(排除清单之外),
 * 仓库相对 POSIX 路径,已排序。
 *
 * 这是等式的「实测」一侧,**从磁盘派生**而非从声明派生 —— 否则等式会退化成「自己跟自己比」。
 * 目录里没有任何源文件(只有图片 / 清单等资源)不算测试子目录。
 * @param {string} root 仓库根绝对路径(调用方注入)
 * @returns {string[]}
 */
function discoverSurfaceDirs(root) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(path.join(root, "test"), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const rel = `test/${entry.name}`;
    if (isExcluded(rel)) continue;
    const hasSource = listScannableFiles(root, rel).some((file) => SOURCE_FILE_RE.test(path.posix.basename(file)));
    if (hasSource) out.push(rel);
  }
  return out;
}

/**
 * @typedef {object} SurfaceEquality 扫描面等式判定的结果
 * @property {string[]} declared 声明面(SCAN_TARGETS 的目录集合,已排序)
 * @property {string[]} measured 实测面(磁盘上的测试子目录,已排序)
 * @property {string[]} missing 声明了但磁盘上无测试源文件的目录
 * @property {string[]} extra 磁盘上有测试源文件但未登记进扫描面的目录
 * @property {boolean} ok 等式是否成立
 */

/**
 * 扫描面等式判定:声明面必须与实测面逐个相同。
 *
 * 失败形态与修法一一对应,故诊断必须点名目录:
 *   - extra   —— 新增了测试子目录却没登记:要么补进 SCAN_TARGETS(它该被门禁扫),
 *                要么按「它不是测试代码」的理由补进 EXCLUDED_DIRS;
 *   - missing —— 登记过的目录在磁盘上已经没有测试源文件(改名 / 删除 / 搬空):改声明。
 * @param {string} root 仓库根绝对路径(调用方注入)
 * @returns {SurfaceEquality}
 */
export function checkSurfaceEquality(root) {
  const declared = SCAN_TARGETS.map((target) => target.dir).sort((a, b) => a.localeCompare(b));
  const measured = discoverSurfaceDirs(root);
  const missing = declared.filter((dir) => !measured.includes(dir));
  const extra = measured.filter((dir) => !declared.includes(dir));
  return { declared, measured, missing, extra, ok: missing.length === 0 && extra.length === 0 };
}

/**
 * 等式失败的诊断文案(单一来源:两个门禁都从这里取,避免两处措辞漂移)。
 * @param {SurfaceEquality} surface checkSurfaceEquality 的返回值
 * @returns {string}
 */
export function formatSurfaceMismatch(surface) {
  const parts = [`声明 ${surface.declared.length} 个目录,实测 ${surface.measured.length} 个`];
  if (surface.extra.length > 0) parts.push(`多出(磁盘上有测试源文件但未登记进扫描面):${surface.extra.join(", ")}`);
  if (surface.missing.length > 0) parts.push(`缺失(已登记但磁盘上无测试源文件):${surface.missing.join(", ")}`);
  return parts.join(";");
}

/**
 * @typedef {{ ok: true, text: null } | { ok: false, text: string }} FloorJudgement
 */

/**
 * 下限判定:walker 整体失效时(扫到的文件数塌到下限以下)「零命中」是假通过,须判红。
 * 与等式分工见文件头:等式抓「漏一个子目录」,本判据抓「整体扫不到」。
 * @param {number} fileCount 实测扫描文件数
 * @returns {FloorJudgement}
 */
export function judgeScanFloor(fileCount) {
  if (fileCount >= MIN_SCAN_FILES) return { ok: true, text: null };
  return {
    ok: false,
    text: `只扫到 ${fileCount} 个文件(下限 ${MIN_SCAN_FILES}):扫描面或 walker 失效,`
      + "此时「零命中」是假通过,须先修扫描面",
  };
}
