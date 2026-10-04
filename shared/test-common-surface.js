// @ts-check
/**
 * 测试扫描面 · 单一来源(4 处消费方共用)。
 *
 * 本模块**零仓库内依赖**(只 import node: 内建):门禁自检脚本要把它整份拷进临时夹具树
 * 单独跑,牵连别的模块就得连那份一起拷。项目根由调用方注入 —— 全仓唯一**定义**根语义的位置
 * 是 shared/paths.js(其值恒等于 `process.cwd()`;见 check-import-boundary.mjs 的规则
 * no-self-computed-root),本模块刻意不 import ROOT。
 *
 * ---- 收口了什么(此前同一份知识散在 4 处,其中 2 处逐字相同)----
 * 1. **段目录集合**(测试发现面):test/acceptance.mjs 交给 runner 的段目录 ·
 *    gates/fixtures/gen-fixtures.mjs 的扫描目录 —— 现为同一数组对象 SEGMENT_DIRS,恒等由
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
 * 每个目录的**文件判定**不同(段目录只收 *.test.js,common 收 *.js 与 *.mjs),磁盘上读不出
 * 「这个目录该按哪种谓词扫」;而派生真正要防的那类漏(多一个目录没登记),等式判据已经覆盖
 * —— 它判红并点名那个目录。故此处收敛的是「同一份知识只有一处」,不是把枚举换成猜测。
 * 枚举退化成「随手加一行」的风险由**镜像判据**(checkSegmentMirrors)兜住:段目录名必须
 * 镜像一棵顶层真实存在的树,于是「随手加一行」的最可能形态(开一个杂物抽屉)判红。
 */
import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * 段目录(测试发现面):test/ 下的段目录,「验收跑哪些段」的唯一声明。
 * 同一数组既交给 runner 做段发现(acceptance.mjs),也作为门禁扫描面的前几个目标派生
 * —— 从同一处派生,才能保证「验收发现的段」与「门禁扫的段」永远同集合。
 *
 * 判据不是「恰好这三个」,而是**每个段目录都镜像一棵顶层被断言的树**(见
 * checkSegmentMirrors):core→src/core、main→src/main、renderer→src/renderer、
 * gates→gates/**、shared→shared/**(ADR-062:97「P 以 gates|shared|tools/ 开头 ⇒
 * M = test/<P>」的镜像规则)。故新增段目录不必改本文件,新增**被断言的树**才要。
 *
 * ⚠ **`tools` 刻意不在本数组里**,尽管 `tools/` 是真实存在的顶层树:ADR-062 的目标结构
 * 里有 `test/tools/`,但**当前没有任何段的被测主体真在 `tools/`**(`dist-manifest-gate`
 * 的三个被测脚本里两个在 `gates/`、一个在 `tools/`,主体跨树,故留在 `test/gates/`)。
 * 而 `discoverSurfaceDirs` 只把「至少含一个测试源文件」的目录算进实测面 ⇒ 空目录
 * 登记进来会让 checkSurfaceEquality 判 `missing: test/tools` 而恒红。目录先建、内容
 * 待有真主体时再登记(登记那一刻要同批补两个 selftest 的 BASE_SHAPE)。
 * @type {readonly string[]}
 */
export const SEGMENT_DIRS = Object.freeze(["core", "main", "renderer", "gates", "convert", "cli", "mcp", "shared", "behavior"]);

/**
 * 不得作为段目录的名字(它们是 harness / 数据区 / 入口,不是被断言的树)。
 * 显式列出而非「顶层没有同名树就放行」——否则把段塞进 test/harness 也能过镜像判据。
 *
 * ⚠ 语义是「**禁止**当段目录」,不是「允许存在但豁免镜像义务」—— 往这里加 `behavior`
 *   会把跨层段目录变成**禁止**项(T3 步 4c 实测:两道文本门禁立刻判红「behavior 是
 *   harness/数据区/入口名」)。「允许存在但不要求镜像」是另一张表的职责:
 *   `gates/repo/check-test-layout.mjs` 的 `NON_MIRROR_TOP_DIRS`(它管 L7 的顶层目录集合),
 *   以及 checkSegmentMirrors 里对 `behavior` 的显式跳过。两张表语义相近而方向相反,
 *   混用会得到「以为豁免了、实际被禁止」的结果。
 * @type {readonly string[]}
 */
const NON_MIRROR_DIR_NAMES = Object.freeze(["harness", "fixtures", "acceptance"]);

/**
 * 「是段目录,但不要求镜像一棵顶层树」的**唯一**段目录名(ADR-062 的 `test/behavior/`)。
 *
 * 它与 `NON_MIRROR_DIR_NAMES` 是**方向相反**的两张表,混用会得到「以为豁免了、
 * 实际被禁止」的结果(见 checkSegmentMirrors 里那处分支的注释)。
 * @type {string}
 */
const NON_MIRROR_SEGMENT_DIR = "behavior";

/** 段文件判定(与 test/harness/runner.js 的 discoverSegments 同口径:只收 *.test.js) */
const isSegmentFile = (/** @type {string} */ name) => name.endsWith(".test.js");

/**
 * 扫描目标(声明面):目录 + 该目录下的文件判定。
 * 排除写成显式清单(EXCLUDED_DIRS):将来有人把扫描面扩到整个 test/ 时,该目录必须仍然在外,
 * 而不是靠「它恰好不在目标里」蒙对。
 * @type {readonly { dir: string, accept: (name: string) => boolean }[]}
 */
export const SCAN_TARGETS = Object.freeze([
  ...SEGMENT_DIRS.map((name) => ({ dir: `test/${name}`, accept: isSegmentFile })),
  // test/harness 下 harness 与桩件的实际载体是 .mjs(ESM 显式扩展名),只收 .js 会让它们
  // 落在这两道文本门禁的扫描面之外 —— 同一批文件在 tsc / eslint 口径里却要被当作源文件
  // 逐个校验。谓词只收 .js 会造成「别的门禁看得见、这两道看不见」的非对称盲区,故此处
  // 必须与三处口径对齐:本文件 SOURCE_FILE_RE(实测面)、test/core/tscheck-coverage.test.js
  // 的 SOURCE_EXT_RE(@ts-check 覆盖面)、eslint.config.js 的 NON_PROGRAM_EXTS
  // (allowDefaultProject 生成 glob 的纳入集)。
  //
  // ⚠ 这一行与上面的排除名单是**两处**独立的登记,改名时必须同批改(T3 步 1 实测):
  // 只改排除名单而漏了这里,两道文本门禁的扫描面会指向一个不存在的目录 → walker 扫到
  // 0 个文件 → 判据恒绿且**不报任何错**(本仓反复批过的「恒绿即失效」形态)。
  { dir: "test/harness", accept: (/** @type {string} */ name) => /\.(?:js|mjs)$/.test(name) },
]);

/** 显式排除目录(仓库相对 POSIX 路径;前缀匹配)。samples 是被测样例数据本身,不是断言。 */
const EXCLUDED_DIRS = Object.freeze(["samples"]);

/**
 * 扫描文件数下限:walker 静默失效(目录改名 / 权限)会退化成「零文件全过」,那是假通过。
 * 留一半余量;它**只**管 walker 整体失效,不管漏目录(那由等式管,见文件头)。
 */
export const MIN_SCAN_FILES = 50;

/** 实测面的「含测试源文件」判据:与三个门禁的接受扩展名并集一致(含 .cjs 以免漏判) */
const SOURCE_FILE_RE = /\.(?:js|mjs|cjs)$/;

/**
 * 排除前缀判定(带 / 边界,避免 samplesX 误判)。
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
 * @typedef {object} MirrorJudgement 段目录镜像判据的结果
 * @property {string[]} offenders 违规段目录(test/ 相对路径)
 * @property {string[]} reasons 逐条违规的原因(与 offenders 同序)
 * @property {boolean} ok 是否每个段目录都镜像一棵顶层被断言的树
 */

/**
 * 顶层不参与镜像判定的目录:自身就是判据对象(test)、依赖树(装不装依赖不该改判据结论)、
 * 以及点目录(VCS 元数据)。
 */
const MIRROR_SCAN_SKIP = Object.freeze(new Set(["test", "node_modules"]));

/**
 * 收集可镜像的目录名:顶层目录自身 + 顶层目录的直接子目录。
 *
 * 两层的由来:四对镜像里 `test/gates/` 镜像的是**顶层树自身**(`gates/`),
 * `test/core|main|renderer/` 镜像的是 `src/` 的直接子目录 —— 故「顶层或其下一层」正是
 * 「一棵被断言的树里那个被断言的目录名」。再多一层就成了「仓库里某处有个同名文件夹」,
 * 判据会松到抓不住抽屉。
 * @param {string} root 仓库根绝对路径(调用方注入)
 * @returns {Set<string>} 目录名集合
 */
function collectMirrorCandidateNames(root) {
  /** @type {Set<string>} */
  const names = new Set();
  /** @param {string} abs @param {string} name */
  const addDir = (abs, name) => {
    names.add(name);
    for (const child of readdirSync(abs, { withFileTypes: true })) {
      if (child.isDirectory()) names.add(child.name);
    }
  };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || MIRROR_SCAN_SKIP.has(entry.name)) continue;
    addDir(path.join(root, entry.name), entry.name);
  }
  return names;
}

/**
 * 段目录镜像判据:每个段目录名必须是**顶层一棵被断言的树**里的那个目录名。
 *
 * 为何要有这条(它是「段目录集合」那份枚举的护栏):判据的意图是「不许开杂物抽屉」,
 * 早先写成「三目录为全集」时,新增第四个段目录必须同时改判据表述 —— 漏改就出现
 * 「三目录恒等」与实际并存的误读,改了就等于给抽屉发许可证。改成镜像判据后:
 *   - 新增被断言的树(如 `gates/**` ⇒ `test/gates/`)天然满足,不必改任何文字;
 *   - 新增杂物抽屉(如 `test/pending/`)因顶层找不到同名树而判红。
 * 故枚举退化的最可能形态被机械拦住,不靠「记得同步文档」。
 *
 * 第二个名字:段目录不得占用 harness / 数据区 / 入口的名字(common · fixtures · acceptance)——
 * 那三个不是被断言的树,把段塞进去等于让镜像判据形同虚设。
 *
 * @param {string} root 仓库根绝对路径(调用方注入)
 * @param {readonly string[]} [segmentDirs] 段目录名;默认取 SEGMENT_DIRS(负向夹具注入替身)
 * @returns {MirrorJudgement}
 */
export function checkSegmentMirrors(root, segmentDirs = SEGMENT_DIRS) {
  /** @type {string[]} */
  const offenders = [];
  /** @type {string[]} */
  const reasons = [];
  const candidates = collectMirrorCandidateNames(root);
  for (const name of segmentDirs) {
    const head = name.split("/")[0] ?? name;
    if (NON_MIRROR_DIR_NAMES.includes(head)) {
      offenders.push(`test/${name}`);
      reasons.push(`「${head}」是 harness/数据区/入口名,不是被断言的树`);
      continue;
    }
    // `behavior` 是**段目录**,但它不对应任何一棵被断言的顶层树(ADR-062:一个段横跨多层
    // 正是它的定义)⇒ 豁免「必须镜像」这条义务,但**不豁免**它作为段目录的存在 ——
    // 它在 SEGMENT_DIRS 里、被 runner 发现、被 L6 的 covers 判据管。
    //
    // 为什么单列而不并进 NON_MIRROR_DIR_NAMES:那张表的语义是「**禁止**当段目录」
    // (harness / fixtures / acceptance),把 behavior 放进去等于把跨层段目录变成禁止项 ——
    // 实测两道文本门禁会立刻判红「behavior 是 harness/数据区/入口名」。两张表语义相近
    // 而方向相反,必须分开,否则「以为豁免了、实际被禁止」。
    if (head === NON_MIRROR_SEGMENT_DIR) continue;
    if (!candidates.has(head)) {
      offenders.push(`test/${name}`);
      reasons.push(
        `顶层没有可镜像的 ${head}/(顶层既无 ${head}/ 目录,也无任一棵顶层树下的 ${head}/ 子目录;`
        + "段目录须按被测主体归属,勿另开暂存区)",
      );
    }
  }
  return { offenders, reasons, ok: offenders.length === 0 };
}

/**
 * 镜像判据失败的诊断文案(单一来源:两个门禁都从这里取)。
 * @param {MirrorJudgement} mirror checkSegmentMirrors 的返回值
 * @returns {string}
 */
export function formatMirrorMismatch(mirror) {
  return mirror.offenders
    .map((dir, index) => `${dir}(${mirror.reasons[index] ?? "不镜像任何顶层树"})`)
    .join(";");
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
