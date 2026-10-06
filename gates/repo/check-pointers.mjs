// 文档指针门禁判定本体(vendored,只含**项目模式**)——零依赖,仅 node: 内建模块 + shared/paths.js。
//
// ---- 出处与基线 ----
// 本文件的内容**逐字搬自**全局配置目录 `tools/check-pointers.mjs`,基线 commit `72f072a`
// (sha256 `4a82b448…d46e3c0b`)。搬移依据见本仓 `docs/adr/ADR-054-配置仓与项目仓门禁拆分本仓落地.md`
// 决定一(完全拆分 · 只含项目模式)。
//
// **配置仓独占的部分已物理删除**(约 1294 行,不留注释掉的死代码),包括:
// `collectScope` / `SCAN_DIRS` / `EXTRA_SCAN_FILES` / `PROJECT_SIDE` / `PROJECT_DIR` /
// `PROJECT_PROBE` 的模式判定用途 / `CONFIG_REPO_DOC_PREFIXES` / `CONFIG_REPO_DOC_FILES` /
// `isConfigRepoDoc` / `COPY_LIST_FILE` / `COPY_LIST_HEADING` / `copyListLeftColumn` /
// `TOPIC_MAP` / `POINTER_LINE` / `LEGACY_DOC_NAMES` / `LEGACY_NAME_EXEMPT` /
// `LEGACY_NAME_EXEMPT_PREFIXES` / `V2_REPLACEMENTS` / `checkTopics` / `checkTemplateVersion` /
// `checkLedgerLimits` 及其常量 / `TEMPLATE_VERSION_LINE` / `VERSION_FILE` /
// `listTemplateVersionCandidates` / `CONFIG_REF_ORDER` / `atConfigRepo` / `PROBE_MISSED_NOTE` /
// `existsDir` / `checkResolutionBasis` / `PREFIX_REQUIRED_SCOPE` / `GLOBAL_PREFIX_WINDOW` /
// `checkLegacyDocNames` / `RETIRED` 播报 / `main` 里按侧别计退出码的那几段。
// `skipReason` 收敛为只保留**项目模式**那一支(三条跨仓/条件性载体豁免 + 两条与模式无关的豁免)。
// `collectProjectScope` 的项目侧收集逻辑、`EXCLUDE_DIRS` 的 `project` 一支**原样保留**。
//
// ⚠️ **判据从此两份,规则演进要改两处** —— 这是**本仓自己欠的义务**,不是上游的:全局配置目录那份
// 仍兼做它自己那侧(配置仓 + 跨仓全量)的判定。ADR-016 备选方案 3 已否决「留配置仓共用」,故无
// 机器对读;唯一的对冲是本文件头的基线记录 + 上面的删除清单,供人工重核。
//
// ---- 为什么仓根取 process.cwd()(不是自算) ----
// 上游那句 `join(dirname(fileURLToPath(import.meta.url)), '..')` 在**上游的位置**是对的,在**本仓
// 的位置**会算成 `gates/` ⇒ 所有存在性判定全 false 而**静默零覆盖**。根的**语义**唯一定义在
// `shared/paths.js`(其 `ROOT` 恒等于 `process.cwd()`,见 `gates/repo/check-import-boundary.mjs`
// 规则 no-self-computed-root);本文件的扫描根与它同值,故直接写 `process.cwd()` 而不 import
// —— 省掉一次跨树 import 换来的是「本文件不再引用单源」这条**必须解释**的选择,理由是本文件
// 只用根、不产出根,导入它反而让「谁定义根」在本文件里多出一处读者要核对的说法。
// **本文件内不得再出现第二处仓根字面量。**
//
// ⚠️ 根是 cwd 派生的**环境**值,不是代码事实 —— 入口守卫因此**不能**用根反推本文件路径,
// 必须用 `fileURLToPath(import.meta.url)`。这条不是风格选择:本门禁被刻意以「cwd 指向合成仓、
// argv[1] 指向仓内本体」调用,两者恒不相等。详见入口守卫处的注释。
//
// ---- PROJECT_ROOT 恒等于扫描根(实施约束 3) ----
// 上游是 `PROJECT_ROOT = atConfigRepo || !probeHit ? null : process.cwd()`,而
// `atConfigRepo = (cwd === ROOT)`。**在本仓仓根运行时 `atConfigRepo` 恒真** ⇒ `PROJECT_ROOT` 恒 null
// ⇒ 项目模式永不进入、退出码回落 ⇒ **零项目覆盖 + exit 0** —— 这是「以为被查过」的最坏形态,
// 且是**双向失真**:判红侧夹具恒红(测试失效)、豁免侧夹具恒绿(**真洞被永久放过**)。
// 故本文件**物理删除 `atConfigRepo` 与那个三元判定**,`PROJECT_ROOT` 恒等于 `process.cwd()`。
// 自检因此只需 `cwd` 指向合成仓,不需要 `--root` 参数。
//
// ---- resolveRef 收敛为单模式,这是 ADR-014 决定二在单模式下的退化、**不是违反它** ----
// ADR-014 决定二要求「候选基准只有两档(仓根 / 引用方目录),两模式只差顺序且顺序相反 ⇒ 顺序必须由
// 调用方显式传参,不许有默认值」。本仓**只有一种模式**(项目模式),于是只剩一档顺序,「相反」这件事
// 在本仓不存在。但**「顺序必须显式传参、不许有默认值」这半条仍然成立且仍然被守住**:`resolveRef`
// 的 `order` 形参**没有默认值**,`REF_ORDER` 是本仓唯一的顺序常量,调用点必须显式传。
// 写成 `resolveRef(base, ref, fromFile)` + `order = REF_ORDER` 会让「顺序」重新变成可省略的参数,
// 而它恰恰是这套解析里最容易**静默改错**的一档(改错了在正例上完全看不出来)。**不要加默认值。**
//
// ---- EXCLUDE_DIRS 在本仓只排除 docs/evidence,绝不排除 docs/adr ----
// 上游 `EXCLUDE_DIRS.config = ['docs/adr','docs/evidence']`;那条是**配置仓**的口径
// (上游备选方案第 3 条否决过「只豁免 evidence/ 不豁免 adr/」,因为**上游自己的** `docs/adr/` 是不可回改的
// 决策史)。**本仓方向相反**:`docs/adr/` 与 `docs/evidence/` 两棵**都是活载体、都在扫描面内**。
// 把上游那一支抄过来会让本仓的 ADR 静默移出扫描面 ⇒ 覆盖收缩。故本仓只排除 `docs/evidence`
// (历史快照,把历史语境里的裸文件名判成断链属误报,而「修」误报等于篡改历史)。
//
// ---- 跨仓路径只保留分类、不保留判定(ADR-054 决定四) ----
// 该判据的**判红基准**是全局配置目录的 `exists`/`read`,而其**消歧判据**是「项目里解析不到」;
// 拆分后两者在本仓指向同一目录,照搬得到的是**确定性假红**(不是精度下降)。故判红那一步替换为
// **不可判自报**:三条分类口径(裸名无 `/` · 项目里解析不到 · 命中全局指南名或前文带「全局」)原样保留,
// 输出「分类 N 处 · 判定 0 处 · 未判,非『查过没问题』」并推进结论行的 `覆盖:不全(...)`。
// **拆分后没有任何机器会判这一族**(配置仓那份不含本判据且它的项目根恒 null ⇒ 双侧皆无执行体);
// 缓解只有 `docs/DEV-GUIDE.md` 记一条维护者手动跑上游全量门禁的命令,**不引入任何代码路径/环境变量/开关**。
//
// ---- 代码扩展名引用只分类、不判定(与跨仓档同一处置) ----
// `REF_FORMS` 三条正则都以 `\.md` 收尾 ⇒ 文档里以 `.mjs` / `.ts` / `.js` / `.cjs` 结尾的**反引号**
// 路径引用**一条都判不到**(形态级漏法:文件在扫描面内、写法不在正则里,与第 1 档补 markdown 链接
// 形态是同一类漏法)。**为什么不扩 `REF_FORMS`**:扩了会立刻把本仓上百处「路径形态但仓内无此文件」
// 的引用判红,而其中绝大多数是**路径前缀腐坏**(文件真身搬了家,文档还写着旧路径)。那是墙,不是精度 ——
// 墙的代价是这一族被整体关掉,而关掉时连那少数真断链也一起放过。**份数不写死**:想知道当下那个数,
// 把 `REF_FORMS` 第 2 条的扩展名临时扩进来跑一次 `node gates/repo/check-docs.mjs`,
// 结论行的判红条数就是它(判据本体即取数命令,故此处只记命令不记数值)。
//
// **为什么只分类、不判定**:这一族要判红,判红基准是**人的判断** —— 「文件真的搬走了」(该改文档)与
// 「文档记的是决策史」(ADR 里引的那个 `.mjs` 属于当时那个世界,今天本就不该存在)这两类在正则眼里
// **完全一样**,必须分开裁决,正则给不出这个区别。故本档恒不判红,只报
// 「分类 N 处 · 判定 0 处 · 未判,非『查过没问题』」。这与跨仓路径(ADR-054 决定四)是**同一处置**:
// 结构上同类的问题(判红基准不可达 / 不可由正则裁决)用同一套语言。
//
// **为什么本档不做存在性解析(这不是省事,是会被算错的)**:「解析基准与判定档一致」在这里的最强形式
// 是**根本不引入第二个基准** —— 本档只数形态、不解析。若在这里调 `resolveRef`,那几百次分类用解析会
// **灌进「引用解析 … 判定 N 处」那个计数**,而那个数的口径是「判定档解析过多少处」,被分类灌进来后
// 它就不再是自己声称的那个量(实测会从三位数跳到四位数)。**为一个分类计数去污染一个已判定的自报数字,
// 比不解析更坏。** 故:真要解析只有一条路(本文件唯一的解析实现 `resolveRef`),而本档不需要解析 ⇒ 不调。
//
// **份数不写死**:随文档增删而变,运行时数出来、汇总行报出(与 `EXCLUDE_DIRS` 的份数同一处置)。
//
// ---- 未匹配形态的路径引用只分类、不判定(ADR-057 决定二/三 + ADR-058 收窄) ----
// `REF_FORMS` 三条正则的**首字符集**是 `[A-Za-z0-9_一-龥]`,于是落在它之外的引用**既不判存在性、
// 也不进代码扩展名那档的分类计数** ⇒ 写坏的指针**完全隐形**。实测:`` `·撤销跨仓死指针.md` `` 与
// `` `-foo.md` `` 两条一条都不匹配、静默通过。ADR-057 触发事件就是本会话写
// ADR-056 的链接时连踩两次同一个错,而门禁只在第二次(补上前缀、真的成了一条坏链)才响。
//
// **口径(ADR-058 收窄后,只此一条)**:剥掉 `./` / `../` 前缀后**首字符落在 `REF_FORMS` 首字符集之外**、
// 且整体形如「名字.扩展名」的**反引号 / markdown 链接**内容。**首字符非法是本族与「普通写坏的引用」之间
// 的全部区别** —— 首字符合法的那一类要么已被 `REF_FORMS` 判过、要么归 ADR-055 那族、要么是普通失效引用。
// ADR-057 的旧口径还额外要求「扩展名在仓内实测枚举表里」,**那一版过宽**(旧口径 113 处,逐条复核
// **0 条真坏指针**),且那张表是一处无机器对读的同步义务 —— 已在 ADR-058 删掉。
//
// **为什么不扩 `REF_FORMS` 的首字符集**:那是改**判定覆盖面** —— 扩进来的每一条都开始参与判红,而本仓
// 文档里这类内容绝大多数**本来就不是路径**(ADR-057 备选方案表已逐条否决:放宽到「除空白与标点外任意
// 字符」会凭空造出一批假红)。本档治的是「**看不见**」,不是「判得不准」。
//
// **为什么只出声、不判红**:它没有可判红的基准 —— 一条首字符非法的串既可能是写坏的指针,也可能是命名
// 形态的说明或通配写法(`` `·foo-*.md` `` 这类规则文本里的记号),**正则给不出这个区别**。
// 数进来只是出声,漏掉才是问题。偏宽只体现在**名字侧**(名字里是什么字符一律不问),扩展名侧一律放开。
//
// **⚠️ 措辞纪律:「只出声」这四个字在输出层已被 e2e 段独占** —— `check-pointers-e2e.test.js` 里那条
// `assert(!/只出声/.test(out))` 是**全输出**匹配(它守的是「载体形态转判红后不许再自称只出声」)。
// 本族的自报行因此写「只分类自报」,**不要**改回「只出声」,那会让那条段判红。
//
// **与代码扩展名档的差别必须在措辞里保留**:那一档守护的是「**主动摘掉、且有裁决有记录**」的形态
// (ADR-055 就摆在那里),本档守护的是「**没人摘、也没人记**」的漏。形式上相邻(都在 `REF_FORMS` 旁边、
// 都只分类不判定),成因完全不同。
//
// **零覆盖必须出声**(决定二):这一族一条都没有时,结论行**仍须出现该族**,措辞是「零覆盖」而不是
// 「未判 0 处」—— 后者会把「没有东西要查」说成「有东西但没查」。
//
// **为什么本档不解析**:与代码扩展名档逐字同一处置。在本档调 `resolveRef` 会把几百次分类灌进
// 「引用解析 … 判定 N 处」那个计数,而那个数的口径是「判定档解析过多少处」,被分类灌进来后它就不再是
// 自己声称的那个量。**为一个分类计数去污染一个已判定的自报数字,比不解析更坏。**
//
// **份数不写死**:随文档增删而变,运行时数出来、汇总行报出。
//
// ---- 零覆盖必须出声(实施约束 6) ----
// 「跨仓路径判定 0 处」「代码扩展名引用判定 0 处」「未匹配形态的路径引用判定 0 处」与「载体形态零覆盖」一律进结论行的
// `覆盖:不全(...)`。本门禁从不说「0 错误」而不说覆盖 —— 「触发 0 处 = 零覆盖,不是『查过没问题』」。
//
// ---- 不做 ----
// 不给本门禁加任何模式开关、环境变量或「载体不可达即自动降级」的逃生阀:能随时关掉的判据等于给
// 橡皮章留后门。**机械守卫**:`gates/repo/check-docs.selftest.mjs` 断言本文件里读命令行参数的
// 地方**恰好一处**(下面的入口守卫那一处)、读环境变量的地方**零处** —— 加了开关它立刻红。
//
// 退出码:0 = 全过;1 = 有错(逐条打印 `文件:行 → 目标 → 原因`)。
// 每次运行**最后一行**固定输出「门禁结论」行(见 `main` 末尾)。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// → 台账形态三个列上限的**全仓单点持有**在 `shared/`(它与 `shared/paths.js` 是本文件仅有的两处
//   跨树依赖,两侧都在 `TREE_RULES` 的 `gates-stay-in-gates` allow 面内)。归一前本文件另有一份
//   同名常量,写工具因 `tools-stay-in-tools` 引不到 `gates/` 才被迫在 `shared/` 落一份 ——
//   那份曾造成「改数值要改两处」,现已消除,理由链见下方 C1 / C2 上方的 T2 tombstone 注释。
// → 表格**解析层**同样在那一份里单点持有:切格 / 分隔行 / 表块 / 登记表定位 / 围栏遮罩 / 节名映射 /
//   表头与单元格归一 九个解析函数本文件**零私有副本**,一律从 `shared/markdown-table.mjs` 取。
//   归一前本文件另有一整套同名私有实现(其中 `tableBlocks` / `locateRegistry` 的返回形状与
//   `shared/` 那份不同,见下面两处消费点的注释),现已消除 —— 判据本体一行未动,判据行为见
//   `isSeparatorRow` 那条「并集」说明。
import {
  TITLE_LIMIT, WHY_LIMIT, WHY_LIMIT_DONE,
  splitTableRow, isSeparatorRow, tableBlocks, locateRegistry,
  maskFencedLines, sectionByLine, normalizeHeaderCell, normalizeLedgerCell, ledgerTextCols,
} from '../../shared/markdown-table.mjs';

/**
 * 台账载体路径(工作项号台账)。同时是**扫描范围的判定入口**:门禁扫本仓的 `docs/` 就够了,
 * 不再需要「用 cwd 探针猜是不是项目仓」那一层 —— 本仓**就是**项目仓(ADR-054 决定一)。
 */
const PROJECT_PROBE = 'docs/REQ.md';

/**
 * 扫描根 = `process.cwd()`,**恒定有值**。
 *
 * ⚠️ 上游此处是三元判定(`atConfigRepo || !probeHit ? null : cwd`)。在本仓仓根运行时
 * `atConfigRepo` 恒真 ⇒ 恒 null ⇒ 项目模式永不进入 ⇒ **零项目覆盖 + exit 0**。
 * 那个判定已**物理删除**,不是注释掉的(实施约束 3;理由与后果见文件头)。
 */
const PROJECT_ROOT = resolve(process.cwd());

/**
 * docs 骨架刻意不含的文件(BACKLOG 已并入 ROADMAP;WPS-COMPAT 是项目可选适配页)。
 * **本仓自己持有这两份文件**,但规则要求「没有任务时就必须不存在」,故按骨架口径豁免它们的**引用**。
 */
const NOT_IN_SKELETON = new Set(['BACKLOG.md', 'WPS-COMPAT.md']);

/**
 * 非指针的字面引用。**豁免表会腐烂**(上游已因「能修引用就不登记例外」清空过 `NON_HEADING_QUOTES`),
 * 故每条都要写明「依据是什么、凭什么不会失效」。
 *
 * - `_append.md` —— `{agent}_append.md` 的**通配片段**,任何目录下都不存在这个文件名。
 *   它不会像「已删文件」那样腐烂:没有对应实体,只能当通配写法放过。
 */
const REF_ALLOW = new Set(['_append.md']);

/**
 * **条件性载体** —— 规则要求它们「没有任务时就必须不存在」,于是规则文件对它们的引用在
 * 「无在办任务」态必然解析不到,会被第 1 档当成悬空指针。这是**规则的预期状态被误判成坏引用**,
 * 不是坏引用。
 *
 * 豁免**只放行规则规定的固定名字**(`PLAN.md` 与 `large/` 下两位号文件),拼错的名字仍会被抓出来。
 */
const CONDITIONAL_CARRIERS = /^(docs\/)?(PLAN\.md|large\/(?:NN|\d{2})-[^/]*\.md)$/;

/**
 * 「指针前文」窗口:判「这句有没有说明指针指向哪个仓」时,取指针**前**这么多个字符。
 *
 * 单一常量而非多处各写一个字面量:第 1/3/5 档与跨仓路径判的是**同一件事**(这句指针的基准是不是
 * 全局配置目录),窗口值一旦在两处漂移,就会出现「豁免按 14 判、分类按 12 判」的**覆盖缺口**。
 * 窗口值本身仍是经验值,**不是**语义边界。
 */
const REF_BEFORE_WINDOW = 14;

/**
 * 第 3 档例外:「」里引的**不是小节标题**的写法(概念句 / 约束短语 / 条件词)。
 * 未登记的引号一律按小节名校验。
 */
const NON_HEADING_QUOTES = new Set([]);

/**
 * **扫描范围的排除目录**(仓根相对,posix 分隔,无尾斜杠)。
 *
 * ⚠️ **本仓只排除 `docs/evidence`,绝不排除 `docs/adr`** —— 那是**配置仓**的口径(上游
 * `docs/adr/` 是不可回改的决策史)。本仓的 `docs/adr/` 是**活载体**,排除它就是覆盖收缩
 * (见文件头同名小节)。
 *
 * 排除理由:历史快照里出现的裸文件名描述的是**过去的状态**,按字面判成断链属误报,
 * 而「修」误报等于篡改历史。**份数不写死**:随新快照增长,运行时数出来、汇总行报出。
 *
 * **豁免 ≠ 无门禁**:排除数必须分项可见并推入结论行的 `gaps` —— 静默跳过等于把范围缩小藏起来。
 */
const EXCLUDE_DIRS = {
  project: ['docs/evidence'],
};

/**
 * 全局配置目录的指南文件名 —— 项目里引用它们 = **跨仓引用**(指向本仓之外),
 * 不该在本仓校验存在性/小节名(本仓没有这些文件,查必然误报)。
 * 判别要点:裸文件名(无目录前缀)且命中此表 ⇒ 跨仓;带 `docs/` 前缀的同名文件是**本仓自己的**,仍要查。
 *
 * **名单取上游两版并集**(含 v1 旧名):迁移窗口内两版并存,旧名在本仓仍指向配置仓。
 * 换规则集时本表是必查项 —— 漏一个名字会让切换当天必判红。
 */
const GLOBAL_GUIDE_NAMES = new Set([
  'AGENTS.md', 'META-GUIDE.md', 'NUMBERING-GUIDE.md', 'WORKFLOW-PLAN.md',
  'WORKFLOW-DELIVER.md', 'CAMPAIGN-GUIDE.md', 'CODE-GUIDE.md', 'ENV-GUIDE.md',
  'PUBLISH-GUIDE.md', 'TEMPLATES-GUIDE.md', 'WORKFLOW.md',
]);

// ---------------------------------------------------------------- 基础设施

function readText(root, relPath) {
  try {
    return readFileSync(join(root, relPath), 'utf8');
  } catch {
    return null;
  }
}

function existsAt(root, relPath) {
  try {
    return statSync(join(root, relPath)).isFile();
  } catch {
    return false;
  }
}

/** 去掉围栏代码块,避免示例里的 `# 标题` 被当成真小节。 */
function stripFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '');
}

function collectHeadings(text) {
  const out = [];
  for (const line of stripFences(text).split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) out.push(m[2]);
  }
  return out;
}

/**
 * 头部区块:第一个 `## ` 标题之前的部分。
 *
 * ⚠️ **本仓没有调用方,却刻意保留并 export**:它是「规则文本 ↔ 判据本体」搬移清单点名的
 * **共享基础设施**之一,上游那份文件里的第 2 档(模板头部内容相关性)在决定一里随配置仓独占部分
 * 删掉了,但**这一段取头部区块的纯逻辑属于共享层**,单测搬移(决定五)要直接测它。
 * 留着不 export 会被「未使用的变量」规则判红,而删掉它等于让后续那一步无测试可测 ——
 * 两害相权,保留 + export,并在这里写明它为什么没有调用方,免得下一个人当死代码清掉。
 */
export function headBlockLines(text) {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^##\s/.test(l));
  return lines.slice(0, cut === -1 ? lines.length : cut);
}

/**
 * 逐版摘要 / 历史变更行是**记录**,不是指针 —— 其中出现的文件名与引号描述的是过去的状态,
 * 按字面校验必然误报,且每递增一次版本就复发一次。这类行整体跳过,不做例外登记。
 *
 * 该判定同时管第 1 档与第 3 档。
 */
function isHistoricalLine(line) {
  const t = line.trim();
  return /^>\s*v[\d.]+\s*摘要/.test(t) || /^>\s*历史/.test(t) || /历史(破坏性)?变更[:：]/.test(t);
}

/** 目标文件标题表的按需缓存工厂(第 3 / 第 5 项 / 跨仓路径共用:一次扫描全仓,多处复用)。 */
function makeHeadingsOf(readFile) {
  const cache = new Map();
  return (ref) => {
    if (!cache.has(ref)) cache.set(ref, collectHeadings(readFile(ref)));
    return cache.get(ref);
  };
}

/**
 * 该引用是否属于「不存在也正常」的一类;返回跳过原因,不该跳过则返回 `null`。
 *
 * **本仓只有项目模式**,故只有这一支豁免表(上游两模式方向相反,配置侧那一支已随拆分删除)。
 * 口径不是「文件存不存在」,而是「**这个引用指的不是本仓**」:
 *   1. 指针前带「全局」前缀            ⇒ 明确跨仓,豁免
 *   2. 裸文件名命中全局指南名表        ⇒ 跨仓,豁免
 *   3. 条件性载体(规则要求无任务时不存在)⇒ 豁免
 *   4. docs 骨架不含此文件 / 非指针字面量 ⇒ 骨架与通配写法,豁免
 *   5. 其余                            ⇒ 本仓内引用,**要查**
 *
 * @param ref     引用目标(仓根或 docs/ 相对)
 * @param before  指针在行内的前置文本(判「全局」前缀要用)
 *
 * **导出理由**:豁免表的**形态**是最容易被悄悄放宽/收紧的地方(每一支都是「不存在也正常」的例外),
 * 而它的下游效果(第 1/3/5 档判不判红)有时**分不清是哪一支豁免的**。直接对它取证才能把两者分开钉住。
 */
export function skipReason(ref, before = '') {
  if (ref.includes('<') || ref.includes('>')) return '占位符';
  // 「`docs/xxx.md` 须可点且存在」这类**讲形式要求**的行,`xxx` 是举例不是文件。
  // 判据用「文件名全由 x 组成」而不是登记 `xxx.md` 这一个名字 —— 后者会像已删文件那样腐烂。
  if (/^x+\.md$/i.test(basename(ref))) return '举例占位(xxx.md)';
  // **文件名形态说明**里的占位记号(`0NN` / `NN` / `x.y.z` / `vX.Y` / `YYYYMMDD-HHMMSS`)不是具体文件。
  // 规则文件讲命名规则时必然这么写(如「文件名 `adr-0NN-短标题.md`」),而被讲的那个文件在本仓通常
  // 还不存在。误放过面极小:占位记号出现在文件名里,真文件名只会是 `ADR-001-xxx.md`。
  //
  // ⚠️ **数字形态刻意不豁免,而它才是真形态**:`\d{8}-\d{6}-…` 看着「像同一形态的另一种写法」,
  // 实际上**数字在时间戳这里不是「这不是真值」的标记,它就是真值** —— 把它一并放过等于让
  // 「指向一份并不存在的具体快照」的引用永远不判红,而**坏指针正是这道门禁要治的病**。
  // 正确的依据是:规则文件讲命名规范时写的是**字母形态**,而真文件一律是**数字形态**,两者不相交。
  if (/(?:^|[^A-Za-z0-9])(?:0NN|NN|x\.y\.z|vX\.Y|YYYYMMDD-HHMMSS)(?![A-Za-z0-9])/.test(basename(ref))) {
    return '文件名形态说明(占位记号)';
  }

  if (/全局/.test(before)) return '跨仓引用(带全局前缀)';
  if (!ref.includes('/') && GLOBAL_GUIDE_NAMES.has(basename(ref))) return '跨仓引用(全局指南)';
  if (CONDITIONAL_CARRIERS.test(ref)) return '条件性载体(规则要求无任务时不存在)';

  if (NOT_IN_SKELETON.has(basename(ref))) return 'docs 骨架不含此文件';
  if (REF_ALLOW.has(ref)) return '非指针字面量';
  return null;
}

// ---------------------------------------------------------------- 三档检查

// 第 1 档:`@FILE`、反引号 `FILE`、markdown 链接 `[文字](FILE)` 三种形态,前两种可紧跟「小节名」。
//
// **首部必须允许 `(?:\.{1,2}\/)*` 前缀**(相对上级目录):文档树里引用的 `docs/REQ.md` 在两级之上,
// 只能写 `../../REQ.md` —— 若正则要求首字符是字母数字,这类指针**一条都匹配不到**,本仓会对它们
// 零覆盖且报 0 错误(**绿灯是假的**)。
//
// **第三形态(markdown 链接)**:文档树里最常见的跨文件指针写法就是 `[文字](path.md)`,而这一形态
// 早期**完全逃过检查** —— 文件在扫描范围内,写法不在正则里,即「范围 ≠ 覆盖」的形态级漏法。
// 带 scheme 的外链(`https://…`)与协议相对(`//…`)因首字符不在允许集内而天然不匹配。
const REF_FORMS = [
  { re: /@((?:\.{1,2}\/)*[A-Za-z0-9_一-龥][\w.\/一-龥-]*\.md)(?:\s*「([^」]*)」)?/gu, via: '@' },
  { re: /`((?:\.{1,2}\/)*[A-Za-z0-9_一-龥][\w.\/一-龥-]*\.md)`(?:\s*「([^」]*)」)?/gu, via: '`' },
  { re: /\]\(\s*((?:\.{1,2}\/)*[A-Za-z0-9_一-龥][\w.\/一-龥-]*\.md)(?:#[^)\s]*)?(?:\s+"[^"]*")?\s*\)/gu, via: '](', link: true },
];

/** 第 3 档:`FILE.md`「小节名」——「」紧跟文件名(含反引号包裹)即视为主张一个标题。 */
const SECTION_REF = /((?:\.{1,2}\/)*[A-Za-z0-9_一-龥][\w.\/一-龥-]*\.md)`?\s*「([^」]+)」/gu;

// ------------------------------------------------ 引用解析(单模式)

// ADR-014 决定二:候选基准只有两档(仓根 `''` 与引用方目录 `dir`),**顺序由调用方显式传参**。
// 本仓只有项目模式 ⇒ 只有一个顺序(引用方目录优先:本仓文档互相引用写的是裸文件名)。
//
// ⚠️ **本仓的 `resolveRef` 保留 `order` 形参且不给默认值** —— 这是 ADR-014 决定二在单模式下的
// **退化**,不是违反它(详见文件头同名小节)。`resolveRef(base, ref, fromFile, order = REF_ORDER)`
// 那样的写法会让「顺序」重新变成可省略的参数,而它恰是这套解析里最容易**静默改错**的一档。

/** 仓根基准(仓根相对路径里的空串)。 */
const REF_ROOT_BASE = '';
/** 引用方所在目录基准。 */
const REF_DIR_BASE = 'dir';

/** 本仓唯一的候选顺序:**引用方目录优先**、仓根次之。 */
const REF_ORDER = [REF_DIR_BASE, REF_ROOT_BASE];

/**
 * **兜底基准**:恒为空表,且**必须恒为空**。
 *
 * 它存在的唯一理由是让「兜底解析」这个计数**有处可落** —— 汇总行里那个数字是这套修复的
 * **诚实性开关**:任何「偷偷加了全仓唯一 basename 兜底」的过宽实现都会让它的候选解析成功,
 * 从而让这个数从 0 变成正数并出现在汇总行里。
 */
const EXTRA_REF_BASES = [];

/** 解析口径的累计计数(由 `resolveRef` 写,`refResolutionStats` 读)。 */
const refStats = { refs: 0, byDir: 0, byRoot: 0, ambiguous: 0, fallback: 0 };

/** 解析计数的快照(调用方在自报区取,避免边跑边读)。 */
export function refResolutionStats() {
  return { ...refStats };
}

/** 解析计数清零(测试用;门禁运行期不清 —— 计数覆盖整轮运行)。 */
export function resetRefResolutionStats() {
  refStats.refs = 0;
  refStats.byDir = 0;
  refStats.byRoot = 0;
  refStats.ambiguous = 0;
  refStats.fallback = 0;
}

/** 引用方所在目录(仓根相对,posix 分隔;引用方在根下时是空串)。 */
function refDirOf(fromFile) {
  return fromFile && fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
}

/**
 * 引用解析 —— **单模式**的一档。
 *
 * 候选基准只有两档(`''` = 仓根,`'dir'` = 引用方目录),外加恒空的 `extras`(兜底槽)。
 * `../` 与 `./` 前缀**只允许按引用方目录解析、不回落仓根**:实测有错写法真实存在
 * (一份 evidence 里写了 `../docs/adr/…`,真身是 `docs/adr/…`),回落会把它兜绿 ——
 * 而那正是**判红才有价值**的地方。
 *
 * **返回解析后的仓根相对路径(或 `null`),不是布尔值** —— 调用点必须拿这个返回值去取小节标题表:
 * 只把存在性判定的基准换掉、而后续仍用未解析的裸名取标题,会让**同一批完全正确的引用**全部判
 * 「目标文件里没有这个小节标题」,且报错文案指不到任何真实文件 —— 那比不修更坏。
 *
 * @param base     存在性判据(仓根相对路径 → boolean)。**注入点**:内存夹具靠它。
 * @param ref      引用原文(仓根相对或引用方目录相对)
 * @param fromFile 引用方文件(仓根相对)
 * @param order    候选顺序,**调用方显式传**(本仓恒为 `REF_ORDER`,但不得省略)
 * @param extras   兜底基准表(恒空的 `EXTRA_REF_BASES`)。**只有它有默认值** —— `order` 没有,
 *   理由见文件头:它是最容易被静默改错的一档。
 * @returns 解析后的仓根相对路径;解析不到任何现存文件时返回 `null`
 */
export function resolveRef(base, ref, fromFile, order, extras = EXTRA_REF_BASES) {
  refStats.refs += 1;
  // 基准拼出来的候选先做 posix 规范化:`../` 必须真的被解析掉,否则返回的 key 与
  // 标题表的缓存 key 会带着 `..`,报错文案指向一条不存在的路径。
  const mkDir = () => {
    const dir = refDirOf(fromFile);
    return posix.normalize(dir ? `${dir}/${ref}` : ref);
  };
  // 显式相对前缀 ⇒ 只走引用方目录一档(不回落);`/` 开头 ⇒ 只走仓根一档(绝对锚定)。
  const bases = /^\.{1,2}\//.test(ref) ? [REF_DIR_BASE] : (ref.startsWith('/') ? [REF_ROOT_BASE] : order);
  const probes = [
    ...bases.map((b) => ({ kind: b === REF_DIR_BASE ? 'dir' : 'root', cand: b === REF_DIR_BASE ? mkDir() : posix.normalize(ref) })),
    ...extras.map((fn) => ({ kind: 'fallback', cand: fn(ref, fromFile) })),
  ];
  // **同一路径只探一次**:引用方在仓根时 `dir` 与仓根两档算出的是**同一个**候选,
  // 不去重就会被记成「两档都解析得到」的歧义,而那不是歧义 —— 是同一个文件被判了两次。
  const seenCands = new Set();
  const uniqueProbes = probes.filter((p) => p.cand !== null && !seenCands.has(p.cand) && seenCands.add(p.cand));
  const hits = uniqueProbes.filter((p) => base(p.cand));
  if (!hits.length) return null;
  // 歧义:两档都解析得到 ⇒ 顺序在替作者做决定。计数是可见的代价,不报出来就成了「静默替人挑一个」。
  if (hits.length > 1) refStats.ambiguous += 1;
  const win = hits[0];
  refStats[win.kind === 'fallback' ? 'fallback' : (win.kind === 'dir' ? 'byDir' : 'byRoot')] += 1;
  return win.cand;
}

/**
 * 判断 `index` 处是否落在**行内代码跨度**里(单反引号成对,`` `` `` 双反引号跨度除外)。
 *
 * 只服务第 1 档的链接形态:markdown 渲染器**不会**把代码跨度里的 `](...)` 变成链接,
 * 所以「文档里演示链接写法」是正当用法。不加这条,新形态会把它当成死链报出来。
 * 判据 = 该位置之前单反引号的数量为奇数。判错的方向是**不报**(漏报),与本门禁取向一致。
 */
function insideCodeSpan(line, index) {
  const ticks = line.slice(0, index).match(/(?<!`)`(?!`)/g);
  return ticks !== null && ticks.length % 2 === 1;
}

/**
 * 第 1 档:三种指针形态的目标必须在本仓内存在。
 *
 * 解析走 `resolveRef`(顺序由本函数按**单模式**显式传参),故本档**不自带模式分支**。
 *
 * `base` 是**可注入的存在性判据**(仓根相对路径 → boolean),缺省走真文件系统。
 * 它是 `resolveRef` 的 base 注入点:存在性与**解析口径**的全部价值都在「哪些形态被认出来、
 * 跳过面有多宽、基准怎么选」,而它必须能在**内存夹具**上被证伪 —— 落真文件才能测的判据,
 * 测不到「同目录邻居链接能解析」这件事。
 */
export function checkExistence(root, files, readFile, skipRow = () => false, base = null) {
  const errors = [];
  const seen = new Set();
  const existsAtBase = base ?? ((rel) => existsAt(root, rel));
  for (const file of files) {
    // 围栏内容整段屏蔽:围栏里的是**示例**,不是活指针 —— ADR 字段骨架里就有一个示范用的
    // `[ADR-002](ADR-002-短标题.md)`,那个文件在本仓并不存在。
    const lines = maskFencedLines(readFile(file));
    lines.forEach((line, idx) => {
      if (isHistoricalLine(line)) return;
      // 台账登记表表体行:标题列是自由文本,里面的文件名不是指针(见 `registryDataRows`)。
      if (skipRow(file, idx + 1)) return;
      for (const { re, link } of REF_FORMS) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) {
          // 链接形态:落在行内代码跨度里的跳过(演示写法,渲染器不建链)
          if (link && insideCodeSpan(line, m.index)) continue;
          const ref = m[1];
          if (skipReason(ref, line.slice(Math.max(0, m.index - REF_BEFORE_WINDOW), m.index))) continue;
          if (resolveRef(existsAtBase, ref, file, REF_ORDER) === null) {
            const key = `${file}:${idx + 1}:${ref}`;
            if (seen.has(key)) continue;
            seen.add(key);
            errors.push(`${file}:${idx + 1} → ${ref} → 目标文件不存在`);
          }
        }
      }
    });
  }
  return errors;
}

/**
 * 第 3 档:`FILE「小节名」` 的小节名必须是目标文件里真实存在的标题。
 *
 * ⚠️ **`headingsOf` 的入参必须是 `resolveRef` 的返回值,不是 `ref` 原文**。写 `ref` 会造成**半修法**:
 * 存在性判定的基准换对了,而取标题仍按裸名走 ⇒ 读到空标题表 ⇒ 同一批**完全正确**的引用全部判
 * 「目标文件里没有这个小节标题」,且报错文案指不到任何真实文件。**那是假红里最坏的一种**
 * (逼人改正确的内容去将就门禁),比不修更坏。
 */
export function checkSections(root, files, readFile, skipRow = () => false, base = null) {
  const errors = [];
  const headingsOf = makeHeadingsOf(readFile);
  const existsAtBase = base ?? ((rel) => existsAt(root, rel));
  for (const file of files) {
    readFile(file).split(/\r?\n/).forEach((line, idx) => {
      if (isHistoricalLine(line)) return;
      if (skipRow(file, idx + 1)) return;
      SECTION_REF.lastIndex = 0;
      for (const m of line.matchAll(SECTION_REF)) {
        const ref = m[1];
        const name = m[2].trim();
        if (skipReason(ref, line.slice(Math.max(0, m.index - REF_BEFORE_WINDOW), m.index)) || NON_HEADING_QUOTES.has(name)) continue;
        const target = resolveRef(existsAtBase, ref, file, REF_ORDER);
        if (!target) continue; // 第 1 档已报存在性
        if (headingsOf(target).some((h) => h.includes(name))) continue;
        errors.push(`${file}:${idx + 1} → ${target}「${name}」 → 目标文件里没有这个小节标题`);
      }
    });
  }
  return errors;
}

/**
 * 第 5 项:无引号小节引用。第 3 档只认 `FILE「小节名」`,于是这两种同样主张
 * 「目标文件里存在这个标题」的写法 0 覆盖:
 *
 *   阶段 N   —— `AGENTS.md 阶段 0`
 *   中文序数 —— `CODE-GUIDE.md 四`
 *
 * 序号与文件名之间只允许空白/反引号/连接词,中间夹了别的字(如 `AGENTS.md 编号分配 第③条`)不算 ——
 * 那是「小节 + 节内项」的复合引用。
 *
 * **刻意不收 `第 N 条` / `第 N 步`**:那指某小节内**列表项**的序号,不是标题(标题存在性对它无解);
 * 而且「第 5 条」(第 5 项)与「第 ③ 条」(标号 ③)语义相反,混成一条规则必误报。
 */
const ORDINAL_TOKEN = /阶段\s*(\d+)|([一二三四五六七八九十])(?=[\s、，,。;；)）」』]|$)/g;
const ORDINAL_GAP = /^[\s`]*(?:(?:阶段\s*\d+|与|和|及|、|,|，|\/|／|~|～|-)[\s`]*)*$/;
const MD_NAME = /(?:\.{1,2}\/)*[A-Za-z0-9_一-龥][\w.\/一-龥-]*\.md/gu;

/**
 * 第 5 项:`base` 注入点与 `headingsOf` 入参的口径**与第 3 档逐字一致**:
 * 凡取小节标题表的入参,必须是解析后的路径。
 */
export function checkOrdinalSections(root, files, readFile, skipRow = () => false, base = null) {
  const errors = [];
  const headingsOf = makeHeadingsOf(readFile);
  const existsAtBase = base ?? ((rel) => existsAt(root, rel));
  for (const file of files) {
    readFile(file).split(/\r?\n/).forEach((line, idx) => {
      if (isHistoricalLine(line)) return;
      if (skipRow(file, idx + 1)) return;
      ORDINAL_TOKEN.lastIndex = 0;
      for (const t of line.matchAll(ORDINAL_TOKEN)) {
        const num = t[1] ? `阶段 ${t[1]}` : t[2];
        const before = line.slice(0, t.index);
        const names = [...before.matchAll(MD_NAME)];
        if (!names.length) continue;
        const last = names[names.length - 1];
        const ref = last[0];
        if (!ORDINAL_GAP.test(before.slice(last.index + ref.length))) continue;
        if (skipReason(ref, before)) continue;
        const target = resolveRef(existsAtBase, ref, file, REF_ORDER);
        if (!target) continue; // 第 1 档已报存在性
        if (headingsOf(target).some((h) => h.includes(num))) continue;
        errors.push(
          `${file}:${idx + 1} → ${target} ${num} → 目标文件里没有这个小节标题(无引号形态,第 3 档不覆盖)`,
        );
      }
    });
  }
  return errors;
}

// ------------------------------------------ 跨仓路径(只分类,不判定;ADR-054 决定四)

/**
 * 跨仓路径 —— **只做分类,不做判定**(ADR-054 决定四)。
 *
 * **为什么只剩分类**:该判据的**判红基准**是全局配置目录的 `exists`/`read`,而其**消歧判据**是
 * 「项目里解析不到」;拆分后两者在本仓**指向同一目录**,照搬得到的是**确定性假红**(不是精度下降)——
 * 门禁的跨仓存在性检查只看配置仓**根层**,而 ADR-016 在其 `docs/adr/` 下,于是判红那一支必然全错。
 * 故判红一步整体去掉,替换为**不可判自报**(输出与 `gaps` 两处都写明「未判,非『查过没问题』」)。
 *
 * **保留的三条分类口径**(纯本仓判据,不涉及仓外可达性):
 *   1. 目标**不含 `/`** —— 带目录前缀的路径自带解析基准,而 `docs/` 这类目录**两个仓都有**,
 *      归属无法判定。裸名没有这个问题。
 *   2. 该名**在本仓解析不到任何现存文件** —— 消歧判据:本仓自己有的 `AGENTS.md` / `PLAN.md`
 *      不是跨仓指针。
 *   3. 且满足二者之一:裸名命中 `GLOBAL_GUIDE_NAMES`,**或**指针前 `REF_BEFORE_WINDOW` 字内带「全局」。
 *
 * ⚠️ **拆分后没有任何机器会判这一族**:全局配置目录那份脚本不含本判据(决定三把跨仓判据判给本仓),
 * 而它在配置仓运行时项目根恒 null ⇒ 双侧皆无执行体。缓解只有 `docs/DEV-GUIDE.md` 记一条维护者
 * 手动跑上游全量门禁的命令 —— **不引入任何代码路径、环境变量或开关**。
 *
 * @param files           本仓扫描范围
 * @param readFile        读本仓文件(rel → 文本)
 * @param resolveInProject 消歧判据(rel, fromFile) → 该裸名在本仓里是否解析得到
 * @param skipRow         表体行跳过器(见 `makeCrossRepoRowSkipper`)
 * @returns `{ stats }`;`stats.classified` = 分类出的跨仓指针处数,**恒不产出判红**。
 */
export function classifyCrossRepoRefs(files, readFile, resolveInProject, skipRow) {
  const stats = { classified: 0, files: files.length, freeTextRows: 0 };

  /** 归属判定(口径的三条);不满足则不是本项的对象。 */
  const isCrossRepoRef = (ref, before, fromFile) => (
    !ref.includes('/')
    && !resolveInProject(ref, fromFile)
    && (GLOBAL_GUIDE_NAMES.has(ref) || /全局/.test(before))
  );

  for (const file of files) {
    maskFencedLines(readFile(file)).forEach((line, idx) => {
      if (!line) return;
      if (isHistoricalLine(line)) return;
      if (skipRow(file, idx + 1)) {
        stats.freeTextRows += 1;
        return;
      }
      for (const { re } of REF_FORMS) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) {
          const ref = m[1];
          if (!isCrossRepoRef(ref, line.slice(Math.max(0, m.index - REF_BEFORE_WINDOW), m.index), file)) continue;
          stats.classified += 1;
        }
      }
      SECTION_REF.lastIndex = 0;
      for (const m of line.matchAll(SECTION_REF)) {
        const ref = m[1];
        if (!isCrossRepoRef(ref, line.slice(Math.max(0, m.index - REF_BEFORE_WINDOW), m.index), file)) continue;
        if (NON_HEADING_QUOTES.has(m[2].trim())) continue;
        stats.classified += 1;
      }
      ORDINAL_TOKEN.lastIndex = 0;
      for (const t of line.matchAll(ORDINAL_TOKEN)) {
        const before = line.slice(0, t.index);
        const names = [...before.matchAll(MD_NAME)];
        if (!names.length) continue;
        const last = names[names.length - 1];
        const ref = last[0];
        if (!ORDINAL_GAP.test(before.slice(last.index + ref.length))) continue;
        if (!isCrossRepoRef(ref, before.slice(Math.max(0, last.index - REF_BEFORE_WINDOW), last.index), file)) continue;
        stats.classified += 1;
      }
    });
  }
  return { stats };
}

// ---------------------------- 代码扩展名引用(只分类,不判定;同 ADR-054 决定四的处置)

/**
 * 代码扩展名引用形态 —— **与 `REF_FORMS` 第 2 条(反引号)同形,只把收尾的扩展名集合换掉**。
 *
 * ⚠️ **不复用 `REF_FORMS` 的正则对象,也不从它的正则派生出本条**:那些对象带 `g` 标志、在各档间
 * 共享 `lastIndex`,改动它们就是改动**判定面**。另立一条正则,两条判据面在结构上相邻、在对象上互不
 * 触碰 —— 「形态相同、扩展名不同」这件事必须一眼能从代码上看出来,而不是靠改一处波及两处。
 *
 * 扩展名按**长度降序**排列(`mjs`/`cjs` 在 `js` 之前)。这不是正确性必需(收尾的反引号把扩展名锚死,
 * `x.mjs` 不可能被 `js` 分支吃掉),而是让「读到哪一个分支」与「读到的那个串」始终一致。
 */
const CODE_REF_EXTS = ['mjs', 'cjs', 'ts', 'js'];

/** 反引号包裹 + 上述扩展名收尾的路径。`{1,2}` 前缀与首字符集与 `REF_FORMS` 逐字同形。 */
const CODE_REF_RE = new RegExp(
  '`((?:\\.{1,2}\\/)*[A-Za-z0-9_一-龥][\\w.\\/一-龥-]*\\.(?:' + CODE_REF_EXTS.join('|') + '))`',
  'gu',
);

/**
 * 代码扩展名引用 —— **只分类,不做判定**(处置与跨仓路径同形,理由见文件头同名小节)。
 *
 * **分类的对象是「形态」,不是「有效性」**:命中与否只看「反引号包裹 + 收尾是代码扩展名」,
 * **本档不查该路径在本仓存不存在**。故本档**没有任何解析入参**(与 `classifyCrossRepoRefs` 那三个
 * 入参不同:跨仓档要消歧「本仓解析得到吗」,本档连这个问题都不问)。
 *
 * 扫描面与跳过面**逐字沿用判定档**:`maskFencedLines`(围栏是示例不是活指针)+ `isHistoricalLine`
 * (摘要/历史变更行记的是过去的状态)。**`docs/adr/` 不豁免** —— 它是活载体,引用照常分类
 * (是否豁免只由 `EXCLUDE_DIRS` 决定,本档不另设口径)。
 *
 * ⚠️ **不套 `skipReason`**:豁免表逐条都是 `.md` 指针的语义(条件性载体 / docs 骨架 / 占位记号),
 * 对代码扩展名一条都不适用;套上去只会让「形态计数」依赖一张与本族无关的表。
 *
 * @param files    本仓扫描范围
 * @param readFile 读本仓文件(rel → 文本)
 * @returns `{ stats }`;`stats.classified` = 分类处数,`stats.byExt` = 按扩展名分项。
 *   **恒不产出判红**(返回对象里没有错误通道,与 `classifyCrossRepoRefs` 同形)。
 */
export function classifyCodeRefs(files, readFile) {
  const stats = { files: files.length, classified: 0, byExt: {} };
  for (const file of files) {
    for (const line of maskFencedLines(readFile(file))) {
      if (!line) continue;
      if (isHistoricalLine(line)) continue;
      CODE_REF_RE.lastIndex = 0;
      for (const m of line.matchAll(CODE_REF_RE)) {
        stats.classified += 1;
        const ext = m[1].slice(m[1].lastIndexOf('.') + 1);
        stats.byExt[ext] = (stats.byExt[ext] ?? 0) + 1;
      }
    }
  }
  return { stats };
}

// ---------------------- 未匹配形态的路径引用(只分类,不判定;ADR-057 决定二/三 + ADR-058 收窄)
//
// **这一族守护的是「正则没匹配上」,与代码扩展名那档的「主动摘除」不同**:代码扩展名档是**有裁决、
// 有记录**的决定(ADR-055 决定一 —— 那份 ADR 就摆在那里);本族没有任何人摘过它,是 `REF_FORMS` 三条
// 正则的**首字符集** `[A-Za-z0-9_一-龥]` 把写坏的指针挡在判定面之外。ADR-057 背景里那份实测表就是它:
// `` `·撤销跨仓死指针.md` `` 与 `` `-foo.md` `` 两条**一条都不匹配**,静默通过。
// 两族形式上相邻(都在 `REF_FORMS` 旁边、都只分类不判定),**成因完全不同**,故文件头与结论行分两处措辞。
//
// **收窄理由与枚举表的下场见文件头同名小节**(口径:剥前缀后**首字符非法** + 形如「名字.扩展名」;
// 扩展名不再取任何枚举)。本模块的判据本体只有 `unmatchedExt` 一处。
//
// **为什么不扩 `REF_FORMS` 的首字符集**:那是改**判定覆盖面** —— 扩进来的每一条都会开始参与判红,而
// 本仓文档里那些内容绝大多数**本来就不是路径**(ADR-057 备选方案表已逐条否决:把首字符集放宽到「除空白
// 与标点外任意字符」会凭空造出一批假红)。本档要解决的是「看不见」,不是「判得不准」。
//
// **为什么只出声、不判红**:它没有可判红的基准 —— 一条首字符非法的串既可能是写坏的指针,也可能是命名
// 形态的说明或通配写法(`` `·foo-*.md` `` 这类规则文本里的记号),**正则给不出这个区别**。
// 数进来只是出声,漏掉才是问题。偏宽只体现在**名字侧**(名字里是什么字符一律不问),扩展名侧一律放开。
//
// **为什么不解析**:与代码扩展名档逐字同一处置 —— 在这里调 `resolveRef` 会把几百次分类灌进
// 「引用解析 … 判定 N 处」那个计数,而那个数的口径是「判定档解析过多少处」,被分类灌进来后它就不再是
// 自己声称的那个量。**为一个分类计数去污染一个已判定的自报数字,比不解析更坏。**

/**
 * 反引号形态的候选:`REF_FORMS` 的**首字符集**之外、且形如「名字.扩展名」的内容。
 *
 * **首字符集在这里重写一遍是有意的**,但它**不是**第二处事实源:本族要数的正是「`REF_FORMS` 认不出来」
 * 的东西,所以判据必须与那个集合**恰好互补**(首字符落在集内 ⇒ 不是本族对象)。改成从 `REF_FORMS` 派生出
 * 否定式不可能做到可读,故此处写成显式否定集,并由**夹具第 17/18 条从两侧钉住**这个互补关系
 * (首字符非法必进本族 · 首字符合法必不进本族)。**改 `REF_FORMS` 的首字符集时必须同步看这两条夹具。**
 *
 * ⚠️ **名字部分收得极宽(名字里是什么字符一律不问)** —— 那正是本族存在的理由。仍要求**首字符**非法,
 * 这一个条件是本族与「普通写坏的引用」之间的全部区别(ADR-058 收窄口径)。
 *
 * 内容里排除反引号:不把两个反引号跨度之间的正文吃进来。
 */
const UNMATCHED_TICK_RE = /`([^`]*\.[^`\s]*)`/gu;

/**
 * markdown 链接形态的候选(`](目标)`),尾部结构与 `REF_FORMS` 第 3 条同形(允许 `#锚点` 与 `"标题"`)。
 *
 * **内容里同时排除反引号**:`` [文字](见 `foo.md`) `` 这类嵌套写法若被本条吃下,同一份内容会被反引号
 * 形态与链接形态**各数一次** —— 两个族的计数之和就会大于去重后的总数,那正是本族最不能出的错
 * (与代码扩展名档重复计数的同类问题)。
 */
const UNMATCHED_LINK_RE = /\]\(\s*([^()`]*?\.[^()\s]*?)(?:#[^()\s]*)?(?:\s+"[^"]*")?\s*\)/gu;

/** 去掉 `../` `./` 前缀(ADR-057 决定三 / ADR-058 收窄口径的第一步);前缀可叠写(`../../x.md`),故用 `+`。 */
function stripDotSlashPrefix(s) {
  return s.replace(/^(?:\.{1,2}\/)+/, '');
}

/**
 * 「像路径」的判定(ADR-058 收窄后的判据本体):剥掉 `./` / `../` 前缀后,
 * **首字符落在 `REF_FORMS` 首字符集之外**、**且整体形如「名字.扩展名」**。
 *
 * **扩展名是任意非空白串** —— 收窄前这里挂着一张「仓内实测扩展名」枚举表,而那张表是一处**无机器对读的
 * 同步义务**:仓里新增一种扩展名时它不会自己跟上,也没有任何门禁会提醒(ADR-058 已把它删掉)。判「像不像
 * 路径」由首字符那一条承担,扩展名只需**非空**;仍要求「名字.扩展名」这个形状是为了不把 `·` 这类纯符号数进来。
 *
 * **名字部分必须非空** —— `.gitignore` / `.npmrc` 这类点文件名的「名字」部分是空的,不是「名字.扩展名」。
 *
 * @param {string} token 去掉反引号/链接括号后的内容
 * @returns {string|null} 扩展名;不是本族对象则 `null`
 */
export function unmatchedExt(token) {
  const t = stripDotSlashPrefix(token);
  // 首字符非法 —— 本族与「普通写坏的引用」之间的**全部**区别。
  if (/[A-Za-z0-9_一-龥]/.test(t.slice(0, 1))) return null;
  const dot = t.lastIndexOf('.');
  if (dot <= 0) return null;
  if (!t.slice(0, dot).trim()) return null;
  const ext = t.slice(dot + 1);
  return ext || null;
}

/**
 * 本行里**已被 `REF_FORMS` 认出来**的引用串 —— 这些不在本族的对象内。
 *
 * **取 `REF_FORMS` 的实跑结果,而不是把它的路径核心再抄一份判「像不像它匹配得上」**:抄一份就是第二处
 * 「`REF_FORMS` 认什么」的事实源,改判定面时只改一处就会静默分叉 —— 那正是本文件头两处「改一处波及两处」
 * 已经记过一次的坑。故本族对判定面的认知**只能**来自 `REF_FORMS` 自己跑一遍。
 *
 * @param {string} line 已遮罩围栏的一行
 * @returns {Set<string>} 被 `REF_FORMS` 三条形态认出来的引用串
 */
function judgedRefTokens(line) {
  const judged = new Set();
  for (const { re } of REF_FORMS) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) judged.add(m[1]);
  }
  return judged;
}

/**
 * 未匹配形态的路径引用 —— **只分类,不做判定**(措辞骨架与前两族平行)。
 *
 * 分类口径 = 「剥前缀后**首字符落在 `REF_FORMS` 首字符集之外**、且形如「名字.扩展名」」:
 * 按反引号形态与链接形态收候选,逐条交给 `unmatchedExt` 判(判据只有那一处)。
 *
 * ⚠️ **与代码扩展名档去重(逐字比对 `CODE_REF_RE`,不另写一份「它会数什么」)**:那两条判据面在结构上相邻
 * (`` `x.mjs` `` 只可能被其中一档数),而同一个数在两族各出现一次会让结论行自相矛盾。
 * 只能对**反引号形态**做这次去重 —— `CODE_REF_RE` 本就只认反引号,链接形态它一条都不数,
 * 给链接形态也套一遍会把本该由本族数的形态漏掉。
 * **收窄后这次去重几乎恒不触发**(`CODE_REF_RE` 只收首字符合法的写法,而本族只收首字符非法的),
 * 保留它是更严的一层:哪天有人放宽本族的首字符条件,重叠会在这一层被挡住,而不是让结论行自相矛盾。
 *
 * 扫描面与跳过面逐字沿用判定档:`maskFencedLines` + `isHistoricalLine`。**`docs/adr/` 不豁免**。
 *
 * @param files    本仓扫描范围
 * @param readFile 读本仓文件(rel → 文本)
 * @returns `{ stats }`;`stats.classified` = 分类处数,`stats.byExt` = 按扩展名分项
 *   (**扩展名不再是枚举**,故这里是实际出现的那些,顺序按计数降序由调用方排)。**恒不产出判红**。
 */
export function classifyUnmatchedPathRefs(files, readFile) {
  const stats = { files: files.length, classified: 0, byExt: {} };
  for (const file of files) {
    for (const line of maskFencedLines(readFile(file))) {
      if (!line) continue;
      if (isHistoricalLine(line)) continue;
      const judged = judgedRefTokens(line);
      const bump = (ext) => {
        stats.classified += 1;
        stats.byExt[ext] = (stats.byExt[ext] ?? 0) + 1;
      };
      UNMATCHED_TICK_RE.lastIndex = 0;
      for (const m of line.matchAll(UNMATCHED_TICK_RE)) {
        if (judged.has(m[1])) continue; // 判定面内,不是本族对象
        // 去重:已被代码扩展名档数过的形态本档跳过。测的是**整段命中文本**(含反引号),
        // 因为那条判据的正则把反引号写进了模式里,只喂内容会判不出它收不收这一条。
        CODE_REF_RE.lastIndex = 0;
        if (CODE_REF_RE.test(m[0])) continue;
        const ext = unmatchedExt(m[1]);
        if (ext !== null) bump(ext);
      }
      UNMATCHED_LINK_RE.lastIndex = 0;
      for (const m of line.matchAll(UNMATCHED_LINK_RE)) {
        if (judged.has(m[1])) continue;
        const ext = unmatchedExt(m[1]);
        if (ext !== null) bump(ext);
      }
    }
  }
  return { stats };
}

// --------------------------------- 台账一致性:工作项号台账的台账内不变量
//
// 判据 R1–R8(全部为**台账内**不变量,只需读 `docs/REQ.md` 一个文件):
//   R1 号唯一 · R2 状态取值域 · R3 号形态 · R4 已用最大号 == 实算最大号
//   R5 下一个可用号 == 已用最大号+1 · R6 号段连续 · R8 状态⇔所在节(R7 已撤销,见 LEDGER_RULES)
//   R8 状态 ⇔ 所在节(相容;节名不认识时**只出声**不判红)
//
// **判红的前提是解析成功**:解析失败时我分不清「用户写错了」与「我读不懂」,故 B1–B6 全部只出声
// 不判红(B* 落在覆盖度自报区)。这是「判红的前提是解析成功」这条原则的另一个面。
//
// ⚠️ **列数守卫是这条原则的例外,且例外理由不是「它不是解析失败」**:它确实是解析失败,但它的
// 后果不是「读不懂一行」而是「**整行退出全部判定**」—— 静默退出全部判定会让门禁把**没判**的
// 行说成**判过**的行,那比假红坏得多。故守卫**保留退出**(按列名下标取值在错位行上会读到别的列)
// **并同时判红**。判红与退出是两件事:一个管「说得准」,一个管「说得全」。

/** 状态取值域(全局配置目录 `REQ-RULES.md` 的「状态取值域」节)。**刻意不含流转边、不含「所有行都要
 * 收口到终态」**:流转边合法性要 git 历史(本文件至今零外部依赖,只用 `node:fs` / `node:path`);
 * 「全部收口」会让任何一条在办/待拍板需求长期假红 —— 恒红的门禁和永绿的一样是橡皮章。 */
const LEDGER_STATUS = ['待拍板', '未开工', '在办', '已完成', '已作废'];

/**
 * 「状态 ⇔ 所在节」的相容表 —— 节名 → **该节允许的状态集合**。R8 的唯一来源。
 *
 * ⚠️ **与 R2 是两件事,不可互相替代**:R2 只判「状态词在不在取值域内」,而取值域是**扁平**的
 * (`LEDGER_STATUS` 五个词)——「已完成」在取值域内,于是一行**状态与所在节不符**(已完成的活留在
 * 「待拍板」节)**两条都判绿**。实测:把三行改成「已完成」却仍留在「待拍板」节,整档报
 * 「判据判定 7/7 项」全绿。而 R8 手里**同时有 `status` 与 `row.section`**
 * (`locateRegistry` 已把节名挂到每一行上),却从没拿两者比对过 —— 数据全在,只差这一次比对。
 *
 * **键是节名且必须逐字相等**:节名取 `sectionByLine` 的 `## ` 标题原文,带括号注记的写法
 * (`## 已完成(≤100 字)`)取不到键 ⇒ 落入「节不认识」那一档 ⇒ R8 对该行**不出声**(见
 * `checkLedger` 里 `sectionUnknown` 的处理:出声说「零覆盖」,不静默当通过)。
 * 这是**刻意从严**的方向:宁可报「没查」,也不把不认识节名当成「相容」。
 */
const SECTION_STATUS = {
  待拍板: ['待拍板', '未开工'],
  在办: ['在办'],
  已完成: ['已完成'],
  已作废: ['已作废'],
};

/** 判据清单(只作文档与分母,判定逻辑不按 id 分派)。 */
const LEDGER_RULES = [
  'R1 号唯一', 'R2 状态取值域', 'R3 号形态', 'R4 已用最大号', 'R5 下一个可用号',
  'R6 号段连续', 'R8 状态⇔所在节',
];
// ⚠️ R7「墓碑 ⇔ 划掉」已于 2026-10-05 撤销(墓碑行不再要求 `~~` 划线),**R8 保留原号不重排** ——
// 编号是历史标识,重排会断掉既有 ADR 与裁决对它的引用。

/** 台账号形态:**固定三位零填充**且从 1 起。`REQ-000` 是号段的零值占位,不是工作项号。 */
const LEDGER_ID_RE = /^REQ-\d{3}$/;

/**
 * 号段表取值格取**前导**号:台账写的是 `REQ-000(零值占位,表示还没分配过号)`,整格相等永远取不到值。
 * 末尾的 `\b` 兼作四位数拒绝位(`REQ-0030` 不匹配)—— 四位数不在台账的号形态内,
 * 收紧到它算 R3 判红而非静默通过。
 */
const LEDGER_NUM_RE = /^REQ-(\d{3})\b/;

/**
 * 未填的占位格(`<一句话标题>` / `<状态,取值域见 REQ-RULES.md>` / `<YYYY-MM-DD>`)——
 * **整格锚定**:该格 trim 后**整体**就是 `<…>`,不是「格里有 `<…>`」。
 *
 * ⚠️ **为什么必须锚定**(曾把一条真实数据行静默丢弃):旧形态 `/<[^<>\s][^<>]*>/` 是「**含有**」,
 * 于是「为什么停在这」格里写泛型(`Partial<AppSettings>`)的数据行**整行被当骨架占位丢弃** ——
 * `:1181` 那句 `continue` 不出声,该行**从未**被重号 / 状态取值域 / 状态⇔所在节任何一条判据检查过,
 * 随后号段连续检查反推出**误导性**的「缺 REQ-226,说明有行被删了」。行根本没被删。
 * 这类假绿比假红危险:假红逼人改正确内容,假绿让账本缺一行还报告「通过」。
 * 行内代码遮罩(`maskInlineCode`)挡的是**带反引号**的泛型,裸写的泛型它挡不住 ⇒ 只能靠形态区分。
 *
 * **为什么不能改成「号是合法 `REQ-0NN` 就不算占位」**:模板骨架行(`templates/docs-init/REQ.md`)
 * 带着**合法号**(`REQ-001 | <一句话标题> | …`),按号区分会把模板自己的占位行拉进判定 ⇒ 假红。
 * **按形态豁免,不按内容豁免**(同配置仓 `tools/AGENTS.md` V11 的口径):数字形态必须受检。
 *
 * 首个字符不许是空白:否则正文里「x < y > z」这种比较式会被当成占位行。
 */
const LEDGER_PLACEHOLDER_RE = /^<[^<>\s][^<>]*>$/;

/**
 * 把**行内代码跨度**的内容替换成等长空格(围栏已由 `maskFencedLines` 处理)。
 *
 * 占位符判据**必须先做这一步**:`<…>` 形态与**泛型参数**在字面上完全一样 ——
 * `Pick<AiCleanupSettings, "tidy" | "rewrite">` 是正文里的技术内容,却被判成「未填的占位符」。
 * 为什么是**假红里最坏的一种**:它不是漏报,是**逼人改正确的内容去将就门禁** ——
 * 执行方若照着提示去「修」,唯一办法是把那段技术内容删掉或改写掉。
 * 换成长度相同的空格而非删除,是为了让 `文件:行` 的报错仍能对齐原行号。
 */
function maskInlineCode(s) {
  return s.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
}

/**
 * 表格**结构**判据(C7):台账表块必须严格是「表头 → 分隔行 → 数据行…」**逐行紧邻**。
 *
 * **为什么必须单独判**:`tableBlocks` 对空行是「块内跳过,不终止」,而它**只把块首行当表头、
 * 其余一律当数据行** —— 它**不要求第 2 行是分隔行**,也**看不到块内夹着的空行**。于是
 * 「数据行被插到表头与分隔行之间」这种破损会被**静默吸收**:真分隔行被当成一条普通数据行跳过,
 * 错位的行被当成数据读进去 —— **行数照样对得上,门禁照样 exit 0**。
 *
 * 解析器宽容是对的(免得对非台账表格误报),但**宽容不能等于无感** —— 结构坏了必须出声。
 * 故本判据**只对台账表头(含「号」且含「状态」)生效**,不影响其它表格与模板骨架。
 *
 * ⚠️ **判据必须作用在原始行序列上,不能作用在 `rows` 上**:`rows` 只收数据行,**空行早就被
 * 过滤掉了** —— 在它上面判「有没有空行」等于判一个恒假命题(恒绿判据)。故此处比的是
 * 各元素 `lineNo` 的**连号**,那才是空行留下的唯一痕迹。
 *
 * ⚠️ **只比「相邻元素之间」,不比末行之后**:表块最后一个数据行**后面**的空行是 Markdown
 * 里正常的表块终止(后面通常紧跟 `## ` 小节),判它红等于逼人删掉正常排版。
 *
 * @param lines 遮罩后的原始行序列
 * @returns `{ findings, examined }` —— `examined` = 真正判过的登记表块数(零覆盖自报的分母)。
 */
export function checkTableShape(lines) {
  const findings = [];
  let examined = 0;
  const sections = sectionByLine(lines);
  // ⚠️ 形状来自 `shared/markdown-table.mjs` 的 `tableBlocks`:`header` 与 `rows` **已分开**
  // (且每行的 `cells` 已切好),块首行**不在** `rows` 里 —— 故这里取「第 2 行」要从 `rows[0]` 取,
  // 而「块内至少两行(表头 + 分隔行)」这个门槛在**新形状下是 `rows.length < 1`**
  // (旧形状下 `rows` 含表头,故写的是 `< 2`)。两者等价,别照旧形状的数照抄。
  for (const block of tableBlocks(lines)) {
    if (block.rows.length < 1) continue;
    const { header } = block;
    const [second, ...rest] = block.rows;
    const names = splitTableRow(header.text).map(normalizeHeaderCell);
    if (!names.some((n) => n.includes('号')) || !names.some((n) => n.includes('状态'))) continue;
    examined += 1;
    // 节名取本块**首行**所在的 `## ` 小节(与 `locateRegistry` 同一口径)。取不到 → 退化成
    // 「台账」这个泛称,**不因此跳过判据**:节名只是诊断正文的一部分,判据本身不依赖它。
    const section = sections.get(header.lineNo) ?? '';
    const where = section ? `「${section}」节` : '台账';
    if (!isSeparatorRow(second.cells)) {
      findings.push(
        `${PROJECT_PROBE}:${second.lineNo} → 台账表块缺分隔行:表头(第 ${header.lineNo} 行)下一行应是 \`|---|…\`,`
        + `实际是数据行「${second.text.slice(0, 40)}」—— 数据行被插到了表头与分隔行之间(${carrierScope('C7')})`,
      );
      continue;
    }
    // 块内元素序列:表头 → 分隔行 → 第 1..n 个数据行。**只比相邻元素之间的原始行号连号** ——
    // 空行与 `<!-- -->` 注释行都被 `tableBlocks` 跳过,它们只在这处留下行号的空洞。
    const elements = [
      { label: `表头(第 ${header.lineNo} 行)`, lineNo: header.lineNo },
      { label: `分隔行(第 ${second.lineNo} 行)`, lineNo: second.lineNo },
      ...rest.map((r, i) => ({ label: `第 ${i + 1} 个数据行(第 ${r.lineNo} 行)`, lineNo: r.lineNo })),
    ];
    for (let i = 0; i + 1 < elements.length; i += 1) {
      const a = elements[i];
      const b = elements[i + 1];
      if (b.lineNo === a.lineNo + 1) continue;
      const gap = b.lineNo - a.lineNo - 1;
      findings.push(
        `${PROJECT_PROBE}:${a.lineNo + 1} → ${where}登记表块内空行:${a.label}与${b.label}`
        + `之间夹了 ${gap} 行 —— Markdown 表格在空行处断开, 后面的行不再属于本表(${carrierScope('C7')})`,
      );
    }
  }
  return { findings, examined };
}

/**
 * 号段表定位:表头首格 `项`、次格 `值` 的那块;两行按**首格包含**「已用最大号」/「下一个可用号」取
 * (容忍括注写法),值格取**前导**号。定位不到 → `null`。
 *
 * ⚠️ 这里**不**用 `shared/` 的 `rangeTable`:那份刻意**返回原始文本不解析数字**(形态对不对
 * 属判据),而本门禁的 R4 / R5 要拿数字与实算值比,解析在这一层发生。两者不是同一件事。
 */
function locateRangeTable(text) {
  const lines = maskFencedLines(text);
  for (const block of tableBlocks(lines)) {
    const header = splitTableRow(block.header.text);
    if (header.length < 2) continue;
    if (normalizeHeaderCell(header[0] ?? '') !== '项') continue;
    if (normalizeHeaderCell(header[1] ?? '') !== '值') continue;
    const out = { max: null, next: null, maxLine: null, nextLine: null };
    for (const row of block.rows) {
      if (isSeparatorRow(row.cells) || row.cells.length < 2) continue;
      const key = row.cells[0].includes('已用最大号') ? 'max'
        : row.cells[0].includes('下一个可用号') ? 'next' : null;
      if (!key) continue;
      const m = LEDGER_NUM_RE.exec(row.cells[1] ?? '');
      out[key] = m ? Number(m[1]) : null;
      out[`${key}Line`] = row.lineNo;
    }
    return out;
  }
  return null;
}

/**
 * 登记表**表体行**的行号集合 —— 第 1/3/5 档逐档跳过用。
 *
 * 为什么必须遮:登记表的「一句话标题」列是**自由文本**,人很常在里面写文件名(被引号包着),
 * 而这三档只认指针形态、不认语义 ⇒ 标题里的文件名会被当成活指针,报出「`docs/REQ.md:22 →
 * ARCHITECTURE.md` → 目标文件不存在」并 exit 1 —— **报错还完全指错地方**(用户会去建那个文件)。
 *
 * ⚠️ **本表随 `locateRegistry` 的跨节合并一起变宽**(各节全进),方向是「**更多表体行被跳过**」,
 * 即 1/3/5 档在这几行上从「判过」变成「豁免」。判据:跳过面只许沿「表体行是自由文本」这条既有理由
 * 变宽,不得因别的理由。
 */
function registryDataRows(text) {
  const reg = typeof text === 'string' ? locateRegistry(text) : null;
  return new Set(reg ? reg.rows.map((r) => r.lineNo) : []);
}

/** 台账表体行跳过器(按文件缓存一次解析;只对台账文件生效)。 */
function makeLedgerRowSkipper(readFile) {
  const cache = new Map();
  return (file, lineNo) => {
    if (file !== PROJECT_PROBE) return false;
    if (!cache.has(file)) cache.set(file, registryDataRows(readFile(file)));
    return cache.get(file).has(lineNo);
  };
}

/**
 * **台账形态表**的表体行行号集合 —— 跨仓路径分类专用跳过面。
 *
 * 口径 = 「表头含「号」列的表块」的表体行(台账登记表与判断依据表都是这个形状)。比
 * `registryDataRows` 宽一档:后者要求表头**同时**含「号」与「状态」并只认台账一个文件;
 * 本表认形状不认文件。
 *
 * **为什么跨仓路径必须遮**:跨仓指针的**记录**恰好长在这些表里 ——「某文件长期存在一条指向
 * 退役文件的指针,本轮已改对」这类句子是**事故记录**,里面那个文件名**理应不存在**。
 * 按字面分类会把它算成一条跨仓裸名,而正确处置是「什么都不用做」。
 *
 * **只作用于跨仓路径分类**:第 1/3/5 档的跳过面**不动**(它们判的是本仓内引用,台账表格里的
 * `docs/xxx.md` 是活指针)。
 */
function ledgerLikeTableRows(text) {
  const out = new Set();
  for (const block of tableBlocks(maskFencedLines(typeof text === 'string' ? text : ''))) {
    if (!splitTableRow(block.header.text).map(normalizeHeaderCell).some((n) => n.includes('号'))) continue;
    for (const row of block.rows) {
      if (!isSeparatorRow(row.cells)) out.add(row.lineNo);
    }
  }
  return out;
}

/** 跨仓路径分类的表体行跳过器(按文件缓存;口径见 `ledgerLikeTableRows`)。 */
export function makeCrossRepoRowSkipper(readFile) {
  const cache = new Map();
  return (file, lineNo) => {
    if (!cache.has(file)) cache.set(file, ledgerLikeTableRows(readFile(file)));
    return cache.get(file).has(lineNo);
  };
}

const pad3 = (n) => String(n).padStart(3, '0');

/**
 * 台账内不变量 R1–R8。**纯函数,不做任何 IO** —— 判据全部只依赖台账文本本身。
 *
 * @param text `docs/REQ.md` 全文(读不到时传 `null`/`''`)
 * @returns `{ errors, notes, stats }`:`errors` 进错误流(exit 1);`notes` 是解析盲区与正常态提示,
 *   只进覆盖度自报区;`stats.invariants` 是本次真正判定过的判据数(分母 `LEDGER_RULES.length`)。
 *   `stats.columnGuarded` 是**进过列数守卫的行数** —— 守卫自己的存活探针,恒 0 即零覆盖出声。
 */
export function checkLedger(text) {
  const errors = [];
  const notes = [];
  const stats = {
    rows: 0,
    placeholder: 0,
    badColumn: 0,
    // 「进过列数守卫的行数」—— 守卫的存活探针(见函数末尾的零覆盖出声)。与 `badColumn` 是一对:
    // 一个是「判到几行」,一个是「其中判出不符几行」,后者恒 0 时无法区分「干净」与「守卫没跑」。
    columnGuarded: 0,
    max: 0,
    invariants: 0,
    sectionUnknown: 0,
  };
  const done = new Set();

  if (typeof text !== 'string' || !text.trim()) {
    notes.push(`${PROJECT_PROBE} 读不到或为空 ⇒ 台账内不变量零覆盖`);
    return { errors, notes, stats };
  }
  const reg = locateRegistry(text);
  if (!reg) {
    notes.push(`${PROJECT_PROBE} 登记表表头定位不到(没有同时含「号」与「状态」列的表) ⇒ 台账内不变量零覆盖`);
    return { errors, notes, stats };
  }
  if (reg.blocks > 1) {
    notes.push(`${PROJECT_PROBE} 登记表按状态分 ${reg.blocks} 节,**已跨节合并判定**(号唯一 / 已用最大号 / 号段连续 / 状态⇔所在节四条是跨节判据,只判第一节会静默漏掉其余各节)`);
  }

  const seen = new Map();
  const nums = [];
  for (const row of reg.rows) {
    // 列数守卫必须排在一切判定之前:标题里一个**未转义**的 `|` 就会让该行错位,错位后读到的
    // 「状态」格其实是标题 ⇒ R2 假红。列数不符 ⇒ 整行不参与任何判定。
    // 阈值取**本行所属块**的表头宽度(各节表头可以不同宽),不是第一块的。
    //
    // ⚠️ **「退出全部判定」留着,但退出必须同时硬失败**。原先这一格只 `notes.push` 不判红,于是
    // 出现过这个形态:门禁把这一行说成「通过」,而它**一条台账判据都没被查过** —— 静默退出全部
    // 判定会让门禁把没判的说成判过。退出是**解析安全**问题(按列名下标取值在错位行上会读到
    // 别的列),判红是**账本完整性**问题,两件事都要做:退出保不出现假红,判红保不出现假绿。
    // 诊断必须带 文件:行 / 实际格数 / 期望列数 / 所在节 —— 本门禁所有 errors 都带定位。
    stats.columnGuarded += 1;
    if (row.cells.length !== row.headerCount) {
      stats.badColumn += 1;
      errors.push(
        `${PROJECT_PROBE}:${row.lineNo} → ${row.section ? `「${row.section}」节` : '台账'} → 列数错位:`
          + `该行 ${row.cells.length} 格 ≠ 表头 ${row.headerCount} 列`
          + ' ⇒ 该行已退出全部台账判据(重号 / 状态取值域 / 状态⇔所在节一条都没判它)'
          + ' —— 标题里的未转义 `|` 会造成错位,补齐或转义该竖线',
      );
      continue;
    }
    // 骨架原样拷进来时登记表就是一行占位 —— 那不是台账数据,排除但不判错。
    if (row.cells.some(isPlaceholderCell)) {
      stats.placeholder += 1;
      continue;
    }
    const rawId = row.cells[row.idCol].trim();
    if (!rawId) continue; // 空号格:骨架留的续行位,丢弃且不计错
    const id = normalizeLedgerCell(row.cells[row.idCol]);
    const status = normalizeLedgerCell(row.cells[row.statusCol]);

    if (!LEDGER_ID_RE.test(id) || Number(id.slice(4)) < 1) {
      errors.push(
        `${PROJECT_PROBE}:${row.lineNo} → ${id || rawId} → 号形态错:台账号须为 \`REQ-\\d{3}\` 且从 1 起(REQ-000 是号段零值占位,不是工作项号)`,
      );
      continue; // 形态错的行不进数值计算,否则实算 max 会被一个垃圾号带偏
    }
    done.add('R3');

    if (seen.has(id)) {
      errors.push(`${PROJECT_PROBE}:${row.lineNo} → ${id} → 重号:该号已在 ${PROJECT_PROBE}:${seen.get(id)} 登记(同号只能有一行)`);
    } else seen.set(id, row.lineNo);
    done.add('R1');

    const statusInDomain = LEDGER_STATUS.includes(status);
    if (!statusInDomain) {
      // R2 的措辞**必须自带「所在节也要一起改」这条信息** —— R8 在本行**不参与判定**(见下),
      // 若这句只说「状态列非法」,用户改完状态列仍可能把行留在错的节里,而**再没有一条判据会提**。
      // ⚠️ **不能说「去 X 节」**:域外状态下用户还不知道该改成哪个状态,指不出具体的节 ⇒ 误导。
      // 只陈述「两处要一起改」这个动作,不预设目标。
      errors.push(
        `${PROJECT_PROBE}:${row.lineNo} → ${status || '(空)'} → 状态不在取值域内:只能是 ${LEDGER_STATUS.join(' / ')}`
          + ` —— 状态流转要**同时**改状态列与所在节(${PROJECT_PROBE} 的节就是状态分节),`
          + `改完状态列后确认该行落在与新状态相容的那一节`,
      );
    }
    done.add('R2');

    // R8:状态 ⇔ 所在节。紧邻 R2 —— **两条判的是同一格的不同侧面,分开写就会出现「R2 判过、
    // R8 没判」而统计上仍算已判定**的那类缝。数据现成(`row.section` 由 `locateRegistry` 挂上)。
    //
    // ⚠️ **域外状态 ⇒ R8 不参与判定(不是判绿)**:`SECTION_STATUS` 的每个相容集都由
    // `LEDGER_STATUS` 的成员构成,故一个**取值域外**的状态(如「审核中」)对**任何**节都不相容
    // —— R8 的结论完全由 `status` 单独决定,`row.section` 不提供任何信息。那样每行会被报两次
    // **同一个根因**,而判红条数是这条门禁的一等不变量(三处计数必须相等),
    // 重复诊断纯粹是给「不许说谎」那几条断言加维护面。**根因只报一次**(R2 那条已把两条动作说全)。
    //
    // ⚠️ **节名不认识 ⇒ 不判红、只出声**:节名取 `## ` 标题原文,`## 已完成(≤100 字)` 这类
    // 带注记的写法取不到键。判红它会是**假红**(内容完全正确,门禁却逼人去改节名),
    // 那是「逼人改正确的内容去将就门禁」—— 与 `maskInlineCode` 那条注释同一个不可接受的形态。
    // 但**静默当通过更坏**(恒绿判据),故计入 `sectionUnknown` 并推进 notes / 结论行。
    //
    // 两条「不参与」的**次序**:先看域外(状态本身非法)再看节名 —— 域外时**不**计 `sectionUnknown`,
    // 因为那行的状态列已经判红、用户会先改它;把节名问题混进同一次报错只会让根因难认。
    if (!statusInDomain) {
      // 不参与 R8:`done` 不加 R8 ⇒ 该行退出这条判据的判定(统计上可见,不是静默放过)。
    } else {
      const allowed = SECTION_STATUS[row.section];
      if (allowed === undefined) {
        stats.sectionUnknown += 1;
      } else {
        if (!allowed.includes(status)) {
          errors.push(
            `${PROJECT_PROBE}:${row.lineNo} → ${id} → 状态与所在节不符:本行在「${row.section}」节,`
              + `而该节只允许状态 ${allowed.join(' / ')}(实际状态是「${status || '(空)'}」)`
              + ` —— 状态流转要同时改状态列与所在节(${PROJECT_PROBE} 的节就是状态分节)`,
          );
        }
        done.add('R8');
      }
    }

    nums.push({ num: Number(id.slice(4)), lineNo: row.lineNo });
  }

  stats.rows = nums.length;
  const max = nums.length ? Math.max(...nums.map((n) => n.num)) : 0;
  stats.max = max;
  if (nums.length) {
    done.add('R6');
    const sorted = [...nums].sort((a, b) => a.num - b.num);
    const have = new Set(sorted.map((r) => r.num));
    const missing = [];
    for (let i = 1; i <= max; i += 1) if (!have.has(i)) missing.push(i);
    if (missing.length) {
      // 缺口本身没有行号,故锚到缺口前一行(缺口在号段起点时锚到首行)—— 报错不带
      // `文件:行` 就没法定位,而本门禁所有错误都带。
      const before = sorted.filter((r) => r.num < missing[0]).pop();
      const names = missing.map((n) => `REQ-${pad3(n)}`).join(' / ');
      errors.push(
        before
          ? `${PROJECT_PROBE}:${before.lineNo} → 号段不连续:REQ-${pad3(before.num)} 之后缺 ${names}(号不跳号,缺号说明有行被删了)`
          : `${PROJECT_PROBE}:${sorted[0].lineNo} → 号段不连续:首行之前缺 ${names}(号段必须从 REQ-001 起)`,
      );
    }
  } else {
    // 「0 错误」里必须看得见「0 判定」—— 登记表没有可判定行时,台账一致性等于没跑。
    notes.push(`${PROJECT_PROBE} 登记表 0 个可判定数据行 ⇒ 号唯一 / 状态取值域 / 状态⇔所在节判据零覆盖`);
  }
  if (stats.sectionUnknown > 0) {
    // ⚠️ 这条 note 带「零覆盖」字样 ⇒ 会被汇入结论行 `gaps`。**必须出声**:R8 对这些行
    // 完全没判,而 R8 的分母已经计入 `LEDGER_RULES.length` —— 不出声就是「把没查的说成查过」。
    notes.push(
      `${PROJECT_PROBE} 有 ${stats.sectionUnknown} 行落在 R8 不认识的节里`
        + `(节名取 \`## \` 标题原文;相容表只认 ${Object.keys(SECTION_STATUS).join(' / ')})`
        + ` ⇒ 「状态 ⇔ 所在节」判据对这些行零覆盖`,
    );
  }

  const range = locateRangeTable(text);
  if (range && range.max !== null && range.next !== null) {
    if (range.max !== max) {
      const dMax = `REQ-${pad3(range.max)}`;
      const aMax = `REQ-${pad3(max)}`;
      // 两个方向是**两回事**,措辞必须分开:声明大 ⇒ 登记表少行;声明小 ⇒ 号先发出去后补登记。
      const over = nums.find((n) => n.num > range.max);
      errors.push(
        range.max > max
          ? `${PROJECT_PROBE}:${range.maxLine} → ${dMax} → 号段缺行:「已用最大号」声明 ${dMax},但登记表实算最大号是 ${aMax}(中间的行没登记或被删了)`
          : `${PROJECT_PROBE}:${over.lineNo} → 超发号:该行 ${aMax} 超过号段声明的「已用最大号」${dMax}(有号在号段登记之前就发出去了)`,
      );
    }
    done.add('R4');
    if (range.next !== range.max + 1) {
      errors.push(
        `${PROJECT_PROBE}:${range.nextLine} → REQ-${pad3(range.next)} → 「下一个可用号」不等于「已用最大号」+1(应为 REQ-${pad3(range.max + 1)})`,
      );
    }
    done.add('R5');
  } else {
    const missingCells = [];
    if (!range || range.max === null) missingCells.push('已用最大号');
    if (!range || range.next === null) missingCells.push('下一个可用号');
    notes.push(
      `${PROJECT_PROBE} 号段表取不到${missingCells.length ? missingCells.join('与') : '两格'} ⇒ 与号段的一致性判据(已用最大号 / 下一个可用号)零覆盖`,
    );
  }
  if (stats.placeholder) {
    notes.push(`${PROJECT_PROBE} 登记表有 ${stats.placeholder} 行未填的占位行,已排除(不算错);登记第一条需求时替换掉即可`);
  }
  // ⚠️ **列数守卫的「零覆盖」也要出声**,否则守卫恒失效是**不可见**的:守卫一改坏(阈值取错、
  // 条件写反、整段被摘),`badColumn` 恒为 0,而门禁**照样 exit 0** —— 那正是这条判据自己
  // 曾经的样子(只出声 ⇒ 门禁说「通过」而那一行一条都没判)。判据的存活要有可见的探针。
  // **分母取「进过守卫的行数」**而不是表块数:守卫是逐行判的,0 行进过 = 它没在跑。
  if (stats.columnGuarded === 0) {
    notes.push(
      `${PROJECT_PROBE} 列数守卫 0 行进过判定 ⇒ 列数不符这条判据零覆盖`
        + '(守卫恒不命中时,错位行会带着「查过了」的假象通过)',
    );
  }

  stats.invariants = done.size;
  return { errors, notes, stats };
}

// ------------------------------------- 载体形态判据 C1/C2/C4/C5/C6/C7/C8(已判红)
//
// 七条判据的**违反一律进 `errors`**(非零退出)。它们曾整体落在「只出声不判红」区,那段时间是
// **存量治理期**:规则早已写明上限,但历史台账里已有超限内容,判红当天门禁会一直红 ——
// 而恒红的门禁和永绿的一样是橡皮章。故先出声让人看得见欠账,存量清零后转判红。
//
// ⚠️ **编号有洞是刻意的,不是笔误**:原 C3 管一份已撤销的教训载体。**C4/C5/C6 不重排** ——
// 这三个号已被 `docs/adr/`、`docs/evidence/` 与 `docs/DEV-GUIDE.md` 引用,往前挪会让历史引用
// 全部错位。**将来也不要补号**:留一个洞才看得见「这里曾有一条被撤销的判据」。
//
// ⚠️ **刻意不设「模式开关」**:能随时关掉的判据等于给橡皮章留后门,下次存量一涨就会「先关掉」,
// 而没人能查出它曾经红过。转判红是**单向**的。
//
// **本模块里只有「违反」进 `errors`**,分流点是 `runCarrierChecks` 内的唯一一处。仍只出声的只有
// **零覆盖**那几条:它们是「没查」而不是「查了没问题」,但**必须出声**,否则「0 错误」里就掺了
// 没查的部分 —— 那些 note 带「零覆盖」字样,会被汇入结论行的 `gaps`。

/**
 * 台账形态的三个字数上限 —— **判据本体在别处,本文件只 import**。
 *
 * 三者的**唯一声明**是 `shared/markdown-table.mjs`(全仓单点持有,理由见那里的注释),本文件
 * 在文件头 import 它们;`CARRIER_RULES[].name` 与 C1 / C2 的报错文字都从这三个常量拼,
 * 不各写一遍。**本文件不再导出这三个常量** —— 留着转发出口等于开第二条取值路径,
 * 而它们的值一旦要改,只有一处该改。
 *
 * ⚠️ **T2 tombstone(决定三)**:「台账形态上限的**语义对读**」判据(规则文本那一行声明的三个上限
 * ↔ 本仓这三个数字逐字相同)**不在本仓实现**,故本文件内**没有任何代码读 `DOC-SYSTEM.md`**。
 * **理由不是「省事」,是归属已裁定**:那条判据的**对象**是全局配置目录 `DOC-SYSTEM.md` 载体表
 * 那一行,归全局配置目录那份脚本;把它搬下来会让它在本仓指向**自己脚下那份文档**,而对读机制
 * 要求两侧是**两份独立的拷贝** —— 在本仓,「规则文本」与「判据常量」会落在同一个仓、同一条变更里,
 * 对读恒真,**判据零价值**(它会永远判绿,而「永远判绿」正是这道门禁最坏的形态)。
 *
 * **但这不等于本仓不该有这三个数字**:C1 / C2 归本仓(它们判的对象是本仓的台账),而**判据必须有一个
 * 数字才能判**,所以这三个数字必须在本仓留一份 —— 归一后**这一份的位置是 `shared/markdown-table.mjs`
 * 而不是本文件**,`gates/` 与 `tools/` 引同一份(它是两侧唯一共同的合法依赖,见 `TREE_RULES`)。
 * 全局配置目录那份副本与全局配置目录 `DOC-SYSTEM.md` 之间仍有一道 T2 对读机制守着;
 * **本仓这一份与全局文档之间没有机器保证** —— 那是本条已知且已认领的缺口
 * (改全局文档的三个数字时,本仓 `shared/markdown-table.mjs` 那三处要同步改)。
 */

/**
 * 载体形态判据的清单 + 各自现在管什么(分母 = `CARRIER_RULES.length`)。**现为七条**。
 *
 * ⚠️ **取 `scope` 一律按 `id` 查,不要按下标**:C3 已撤销而号不重排(见模块头),
 * 数组下标因此不再等于判据号 —— 按下标取会把 C4 的文案挂到 C5 的违规提示上,
 * 那类错**不判红、只报错文字**,能一路跑到线上。
 */
const CARRIER_RULES = [
  { id: 'C1', name: `台账标题列 ≤${TITLE_LIMIT} 字`, scope: `上限 ${TITLE_LIMIT} 字已生效` },
  { id: 'C2', name: `判断依据 ≤${WHY_LIMIT} 字(已完成节 ≤${WHY_LIMIT_DONE})`, scope: `上限 ${WHY_LIMIT} 字、「已完成」节 ${WHY_LIMIT_DONE} 字已生效` },
  { id: 'C4', name: 'adr 背景行非空', scope: '「## 背景」是必填节,已生效' },
  { id: 'C5', name: 'evidence 头部必带「结论去向」且取值合法', scope: '头部「结论去向」三选一,已生效' },
  { id: 'C6', name: 'evidence 头声明的去向 ↔ adr/·REQ.md 双向对账', scope: '方向 A 去向必须真有该载体,已生效' },
  { id: 'C7', name: '登记表块内无空行(表头→分隔行→数据行逐行紧邻)', scope: '表块内不许夹空行,已生效' },
  { id: 'C8', name: 'adr 文件名前缀编号:形态合规且同号只允许一份', scope: 'ADR-0NN 形态(大写前缀 + 三位零填充 + 非空短标题)且同一编号全仓只允许一份文件,已生效' },
];

/** 按 `id` 取该判据的 `scope` 文案(取不到即代码与清单脱节,当场炸掉而不是静默串台)。 */
function carrierScope(id) {
  const r = CARRIER_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`CARRIER_RULES 里没有 ${id} —— 判据号与清单脱节`);
  return r.scope;
}

/** 字数口径:按**码点**数(不是 UTF-16 码元),中文一字一码点,emoji/生僻字也算一字。 */
const charLen = (s) => [...s].length;

/**
 * 剥掉 markdown 装饰(反引号 / 粗体 / 删除线 / 前后空白),只留正文 —— 字数上限只对正文负责。
 *
 * `~~` 与 `**`、反引号是**同一类装饰**:那对 `~~` 是标记不是内容(早期形态的台账出现过,
 * 现行规则已不再产生)。「装饰不进字数上限」这条口径既然立了,就得剥干净 ——
 * 少剥一种等于上限随写法漂移。
 */
function plainText(cell) {
  return cell.replace(/`+/g, '').replace(/\*\*/g, '').replace(/~~/g, '').trim();
}

// 台账的「标题列」与「判断依据列」在哪 —— **按列名取,不按下标**(同 `locateRegistry` 的理由)——
// 由 `shared/markdown-table.mjs` 的 `ledgerTextCols` 单点持有(本文件原有一份私有副本,已删)。
// 标题列认「标题」;判断依据列认「为什么停在这」/「为什么停在哪」(规则文本自身用词不统一,
// 判据两种都收,否则该列静默零覆盖)。列名不存在时对应项为 `-1`。

/** 未填的占位行不算超限(它是骨架,不是内容)。 */
const isPlaceholderRow = (row) => row.cells.some(isPlaceholderCell);

function isPlaceholderCell(cell) {
  // trim 在这里做(不在正则里做):`:1547` 传进来的是**整节正文**(已 trim),`:1181` / `:1418`
  // 传进来的是**表格格**(两侧带空格)。整格锚定的正则要求 trim 后整体匹配,故归一化只做一处。
  return LEDGER_PLACEHOLDER_RE.test(maskInlineCode(cell).trim());
}

/**
 * 取出 `## <name>` 小节的正文(到下一个 `## ` / `# ` 为止,不含标题行本身)。
 * 找不到该小节 → `null`(调用方据此判「小节不存在」,与「存在但空」区分开 ——
 * 两者的处置不同:前者是写错名字,后者是没填内容)。
 */
function sectionBody(lines, name) {
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^#{1,6}\s+(.*\S)\s*$/.exec(lines[i]);
    if (m && m[1] === name) { start = i + 1; break; }
  }
  if (start === -1) return null;
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^#{1,6}\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

/**
 * C1 / C2:台账形态(标题列上限、判断依据列上限)。
 *
 * 复用 `locateRegistry` 的**跨节合并**行集 —— 与 R1–R8 同一份解析结果,不另立一套表格解析。
 *
 * 「已完成」节靠行上的 `section` 判定,取不到节名时按较宽的 200 字算(判据不确定时取宽,
 * 方向是**少报**)。
 *
 * ⚠️ 节名必须**自己把 section 挂上**:逐块走 `tableBlocks` 时行只有 `{ lineNo, cells }`,
 * 读到 `row.section` 会恒 `undefined` ⇒「已完成 ≤100 字」那条上限**一次都没生效过**
 * (全部按 200 字判)。实测:往已完成节塞 150 字,该判据零命中。
 *
 * ⚠️ **列数守卫在这里是第二个落点,必须与 `checkLedger` 那处同判红**:本函数**逐块**重走一遍
 * `tableBlocks`,与 `locateRegistry` 的合并行集是**两次独立解析** —— 只在 R 族那处判红,本函数
 * 里的 `continue` 仍然是**无声的洞**:C1/C2 的 `examined` 会静默少掉这一行,而「标题列/判断依据
 * 上限对该行零判」这件事没有任何一处会说出来。两族的分母是分开的(`LEDGER_RULES` vs
 * `CARRIER_RULES`),一个洞不会被另一个洞的判红填上。
 *
 * @returns `findings`(每条含文件:行与实测字数);`examined` = 真正量过的数据行数;
 *   `guarded` = 真正进过列数守卫的行数(守卫的存活探针,恒 0 即零覆盖出声)。
 * 键名用 `findings` 而非 `notes`:它装的是**违反**(超上限),不是提示。分流在
 * `runCarrierChecks` 做(违反 → `errors`),本函数不决定判不判红。
 */
export function checkLedgerShape(text) {
  const findings = [];
  let examined = 0;
  let guarded = 0;
  if (typeof text !== 'string' || !text.trim()) return { findings, examined, guarded };
  const reg = locateRegistry(text);
  if (!reg) return { findings, examined, guarded };

  const masked = maskFencedLines(text);
  const sections = sectionByLine(masked);
  // 逐块处理:标题/判断依据列的位置是**块级**的(见 `locateRegistry` 的列映射说明)。
  // ⚠️ **这一遍是刻意的第二次独立解析**,不合并进 `locateRegistry` 的行集(理由见本函数 JSDoc
  // 「列数守卫是第二个落点」那条)。形状来自 `shared/` 的 `tableBlocks`:`header` 与 `rows` 已分开,
  // 故表头取 `block.header`(切格靠 `splitTableRow`),表头列数即 `headerCells.length`。
  for (const block of tableBlocks(masked)) {
    const headerCells = splitTableRow(block.header.text);
    const names = headerCells.map(normalizeHeaderCell);
    if (!names.some((n) => n.includes('号')) || !names.some((n) => n.includes('状态'))) continue;
    const { titleCol, whyCol } = ledgerTextCols(headerCells);
    // 节名取本块**首行**所在的 `## ` 小节(与 `locateRegistry` 同一口径);块内同属一节。
    // 表头恒存在(`tableBlocks` 建块那一刻就放进去了),故不需要旧形状里那个 `rows.length` 三元。
    const section = sections.get(block.header.lineNo) ?? '';
    for (const row of block.rows) {
      if (isSeparatorRow(row.cells)) continue;
      guarded += 1;
      if (row.cells.length !== headerCells.length) {
        // 退出保留(按列名下标取值在错位行上会读到别的列),但**退出必须同时判红** ——
        // 静默退出全部判定会让门禁把没判的说成判过。措辞与 `checkLedger` 那处**分工不重复**:
        // 那处说「退出全部台账判据」(R 族),这里说「C1/C2 对这一行零判」(载体族)。
        findings.push(
          `${PROJECT_PROBE}:${row.lineNo} → ${section ? `「${section}」节` : '台账'} → 列数错位:`
            + `该行 ${row.cells.length} 格 ≠ 表头 ${headerCells.length} 列`
            + ' ⇒ 标题列 / 判断依据上限对该行零判(未量字数)',
        );
        continue;
      }
      if (isPlaceholderRow(row)) continue;
      if (titleCol === -1 && whyCol === -1) continue;
      examined += 1;
      if (titleCol !== -1) {
        const n = charLen(plainText(row.cells[titleCol]));
        if (n > TITLE_LIMIT) {
          findings.push(`${PROJECT_PROBE}:${row.lineNo} → 标题列 ${n} 字 > ${TITLE_LIMIT}(${carrierScope('C1')})`);
        }
      }
      if (whyCol !== -1) {
        const cell = row.cells[whyCol];
        if (!cell.trim()) continue; // 空 = 规则允许(「空表示无阻塞」)
        const n = charLen(plainText(cell));
        const limit = section && section.includes('已完成') ? WHY_LIMIT_DONE : WHY_LIMIT;
        if (n > limit) {
          findings.push(`${PROJECT_PROBE}:${row.lineNo} → 判断依据 ${n} 字 > ${limit}(${carrierScope('C2')})`);
        }
      }
    }
  }
  return { findings, examined, guarded };
}

/** `docs/adr/` 下的**决策条目**(目录说明书 `README.md` 不是决策条目,与 C4 同一豁免口径)。 */
const isAdrEntry = (file) => /^docs\/adr\/.*\.md$/.test(file) && basename(file) !== 'README.md';

/**
 * C4:`adr/` 下每份 ADR 的「背景」节非空。
 *
 * 口径:`## 背景` **必须存在且非空**。判「存在」是因为「背景」是 ADR 的必填字段 ——
 * 一份没有背景的 ADR 无法被复核,而 `adr/` 装的是**会被取代的决定**,复核是它的核心用途。
 * 占位骨架(`<...>`)算空。
 *
 * `README.md` 跳过:它是目录说明书,不是决策条目(骨架里的示例块已被围栏遮罩)。
 */
export function checkAdrBackground(files, readFile) {
  const findings = [];
  let examined = 0;
  for (const file of files) {
    if (!isAdrEntry(file)) continue;
    const body = sectionBody(maskFencedLines(readFile(file) ?? ''), '背景');
    examined += 1;
    if (body === null) {
      findings.push(`${file} → 没有「## 背景」小节(${carrierScope('C4')})`);
    } else if (!body || isPlaceholderCell(body)) {
      findings.push(`${file} → 「## 背景」是空的(${carrierScope('C4')})`);
    }
  }
  return { findings, examined };
}

/**
 * ADR 载体文件名的**规范形态**:`ADR-` + **三位零填充**序号 + `-` + 非空短标题 + `.md`。
 *
 * 取成「恰好三位」而不是「一至多位」:`0NN` 是**定位用**的载体编号,而定位的可靠性来自
 * **位数固定**(等宽才能按字典序读出先后)。放开到四位等于承认总有一天会出现 `ADR-1000`
 * 与 `ADR-0623` 并存,那时「按序号排序」与「按字符串排序」分道扬镳,而重号判据的正则
 * 也要跟着分两支。**固定三位是让「编号」这件事可判的前提,不是文风偏好。**
 *
 * ⚠️ 这条形态判据**只对 `docs/adr/` 下的文件施加**:`docs/evidence/` 按时间戳命名
 * (载体表规定),拿 ADR 的形态去判它等于判一条它不适用的规则 ⇒ 满树假红。
 */
const ADR_CANONICAL_RE = /^ADR-(\d{3})-(.+)\.md$/;

/**
 * 判一个 `docs/adr/` 下的文件名**为什么**不合规范形态(合规范 ⇒ `null`)。
 *
 * **逐项点名而不是只说「不合形态」**:同一条判据下有四种互不相同的写法错误,只回一句
 * 「文件名不合规」会把「忘了加前缀」「序号写成两位」「漏了短标题」压成同一类,改的人
 * 只能自己去猜。诊断正文是判据的产出(见文件头),多写一句前缀比对多跑一轮便宜得多。
 */
function adrNameFault(name) {
  const m = /^ADR-(\d*)(.*)$/.exec(name);
  if (!m) return '文件名不以 `ADR-` 开头(ADR 载体的编号前缀缺失或被改名)';
  if (m[1].length === 0) return '`ADR-` 之后不是数字序号';
  if (m[1].length !== 3) return `序号 \`${m[1]}\` 是 ${m[1].length} 位,载体编号固定三位零填充`;
  if (!ADR_CANONICAL_RE.test(name)) return '序号之后不是 `-短标题.md`(缺分隔符、短标题或扩展名)';
  return null;
}

/**
 * C8:`docs/adr/` 下 ADR 载体编号的**形态**与**唯一性**。
 *
 * 触发事故:并发会话占了 `ADR-062`,另一条泳道照派活时拿到的**过期号也写成 062**,两份
 * 文件同时在位,而 `check:docs` 与整链**都是绿的** —— 没有任何一条判据比对文件名前缀的
 * 编号。载体编号是**引用定位的依据**,重号让「`ADR-062`」这个引用指向不明确,而修法
 * (改其中一份的号)必须由人裁决「哪一份才是那次决定」,机器只能把两份都点出来。
 *
 * **两条判据、两个不同的作用域(刻意不对称)**:
 * - **形态**(只判 `docs/adr/` 下非 README 的文件):那是个**目录契约** —— 这个目录装的是
 *   ADR,里面每个非说明文件都得是合规 ADR 名。与 C4 同一覆盖面。
 * - **唯一性**(判**整个扫描面**上任何名字合规的 ADR 文件,**不看它在哪个目录**):那是个
 *   **标识符契约** —— `ADR-0NN` 在 `docs/` 各处被裸引用(不带路径,例如计划表里写
 *   「ADR-062 那句…」),所以「这个编号对应哪一份文件」是全仓性质,不是目录性质。
 *   ⚠️ **这一条刻意不豁免 `docs/evidence/`**,尽管那棵树按前缀整棵豁免了指针扫描面。
 *   理由:那处豁免的依据是「快照里提到的**别人**的文件名描述的是过去的状态,按字面判成
 *   断链属误报,修误报等于篡改历史」;而本判据的对象是**文件自己的名字**,不是它正文里
 *   的引用 —— 一份叫 `ADR-062-…md` 的快照放在哪儿都不会让「`ADR-062`」变明确。**豁免
 *   的理由不迁移,故不豁免。** 实测代价为 0(证据目录现无一份文件匹配该形态),收益是
 *   「有人把 ADR 草稿拷进 evidence/」这条现实路径当场响。
 *
 * **形态不合规的文件不进唯一性池**:它连一个可比的编号都取不出来,硬凑一个(如 `ADR-6`→`006`)
 * 会造出「两个不同号被判成重号」的假红。形态那条已经点名了它,一条根因只报一次。
 *
 * @returns `findings`(每条含文件与具体形态原因 / 冲突的两份文件);`examined` = 真正量过的对象数。
 */
export function checkAdrNumbering(files) {
  const findings = [];
  let examined = 0;
  /** 序号 → 文件列表(判定与报错都靠它,「是哪两份」只能从这里取)。 */
  const byNumber = new Map();

  for (const file of files) {
    const name = basename(file);
    if (isAdrEntry(file)) {
      examined += 1;
      const fault = adrNameFault(name);
      if (fault) {
        findings.push(`${file} → 文件名不合 ADR 载体形态:${fault}(${carrierScope('C8')})`);
        continue; // 取不出可比编号 ⇒ 不进唯一性池(见 JSDoc「同根因只报一次」)
      }
    } else if (!ADR_CANONICAL_RE.test(name)) {
      continue; // 既不是 adr/ 下的决策条目、名字也不合规 ⇒ 不是本判据的对象
    } else {
      examined += 1;
    }
    const num = ADR_CANONICAL_RE.exec(name)[1];
    if (!byNumber.has(num)) byNumber.set(num, []);
    byNumber.get(num).push(file);
  }

  // 排序后报出:文件系统列举顺序不保证稳定,不排序则同一份仓两次运行可能给出不同的点名顺序。
  for (const num of [...byNumber.keys()].sort()) {
    const group = byNumber.get(num);
    if (group.length < 2) continue;
    findings.push(
      `${group.slice().sort().join('、')} → 同一个 ADR 编号 ${num} 出现在 ${group.length} 份文件上`
        + `(载体编号是引用定位的依据,重号让「ADR-${num}」指向不明确;${carrierScope('C8')})`,
    );
  }
  return { findings, examined };
}

/**
 * C5 的取值域(**三选一**)。
 *
 * 域里那个 `ADR-0NN` 是**占位记号**不是字面量 —— 真快照必须能写 `升 adr/ADR-020` 指到具体某条,
 * 否则所有文件只能各写同一个占位串,「去向」就不成其为去向。故域检查 = 三个字面量 ∪ 带序号形态。
 * **两条判据的取值口径必须同时改,否则又是一处恒真/恒红。**
 */
const EVIDENCE_DESTINATIONS = ['升 adr/ADR-0NN', '落 REQ.md 行', '未升'];

/** 「升 adr/...」的**带序号**形态(域里那个占位记号之外的另一支)。 */
const EVIDENCE_DEST_NUMBERED = /^升 adr\/ADR-\d{3}$/;

/**
 * 从头部文本里取出「结论去向」的值(取不到 → `null`)。
 *
 * 标签与冒号之间**允许 `**` 强调标记**。规范形态是裸的 `> 结论去向:X`,但实际在写的是
 * `> **结论去向**：X` —— 而只认裸形态会让加粗形态**解析不到** ⇒ 一份**头部完全正确**的文件
 * 被报成「头部没有结论去向行」。那是最坏的失败形态:**门禁把人往「把正确的头部删掉」的方向赶**。
 */
function parseEvidenceDestination(headText) {
  const m = /结论去向\**[：:]\s*([^｜|\n]+)/.exec(headText);
  return m ? m[1].trim() : null;
}

/**
 * C5:`evidence/` 下每份快照的**头部**必带「结论去向」,且取值落在三项域内。
 *
 * 「头部」的界定 = 文件**前若干行**里第一处非空、非标题行 —— 判据不锁死「第一行」,
 * 因为快照常有 frontmatter 之类的元信息块在前;但**必须出现在头部**,出现在正文中间不算数。
 *
 * @returns `{ findings, examined, parsed }` —— `parsed` 供 C6 双向对账复用(避免二次解析)。
 */
export function checkEvidenceHead(files, readFile) {
  const findings = [];
  const parsed = [];
  let examined = 0;
  for (const file of files) {
    // `README.md` 是目录说明书、`INDEX.md` 是**脚本生成**的索引(「本表由脚本生成,不手工登记」),
    // 两者都不是「快照」—— 给生成物补「结论去向」要么违反「不手工登记」,要么得让生成器去 emit
    // 一条对它毫无意义的去向。一并豁免,口径同类。
    if (!/^docs\/evidence\/.*\.md$/.test(file) || basename(file) === 'README.md' || basename(file) === 'INDEX.md') continue;
    examined += 1;
    const lines = maskFencedLines(readFile(file) ?? '');
    const head = lines.slice(0, 12).filter((l) => l.trim() && !/^#{1,6}\s/.test(l)).join('\n');
    const dest = parseEvidenceDestination(head);
    if (dest === null) {
      findings.push(`${file} → 头部没有「结论去向」行(三选一:${EVIDENCE_DESTINATIONS.join(' / ')};${carrierScope('C5')})`);
      continue;
    }
    if (!EVIDENCE_DESTINATIONS.includes(dest) && !EVIDENCE_DEST_NUMBERED.test(dest)) {
      findings.push(`${file} → 结论去向「${dest}」不在取值域内(三选一:${EVIDENCE_DESTINATIONS.join(' / ')}(或「升 adr/ADR-0NN」带上真实序号);${carrierScope('C5')})`);
      continue;
    }
    parsed.push({ file, dest });
  }
  return { findings, examined, parsed };
}

/**
 * C6:「evidence 头声明的去向」↔「`adr/` · 台账是否真有该载体」**双向对账**。
 *
 * 方向 A(声明 → 载体):`升 adr/ADR-0NN` 必须真有那份 ADR 文件。**带序号时按序号查**;
 * 不带序号(占位形态)只判 `adr/` 目录非空 —— 门禁分不清「还没决定升哪一条」与「写错了」。
 * `落 REQ.md 行` 必须有台账;`未升` 不对账。
 *
 * 方向 B(载体 → 声明):`adr/` 下每份**现行** ADR 若在同一批 evidence 里没有对应的声明,**只出声**
 * (不是错 —— 决定可以是开会定的,不必然有 evidence 快照)。本函数只产出方向 A 的**违反**。
 *
 * ⚠️ 分派条件必须**覆盖两种形态**(占位与带序号)。精确比对 `=== '升 adr/ADR-0NN'` 的话,带序号的串
 * 虽过了 C5,到了 C6 仍进不来 —— **两处口径不一致,合起来等于方向 A 恒哑**。
 */
export function checkEvidenceReconcile(parsed, { adrFiles, hasReq }) {
  const findings = [];
  const adrBasenames = adrFiles.map((f) => basename(f));
  const declared = [];
  for (const { file, dest } of parsed) {
    if (dest === '未升') continue;
    if (dest === '升 adr/ADR-0NN' || EVIDENCE_DEST_NUMBERED.test(dest)) {
      const m = /(?:ADR|adr)-(\d{3})/.exec(dest);
      if (m) {
        if (!adrBasenames.some((b) => b.toLowerCase().includes(m[1].toLowerCase()))) {
          findings.push(`${file} → 声明「${dest}」但同级 docs/adr/ 下没有序号 ${m[1]} 的 ADR(${carrierScope('C6')})`);
        }
        declared.push(m[1]);
      } else if (!adrFiles.length) {
        findings.push(`${file} → 声明「${dest}」但 docs/adr/ 下没有任何 ADR(${carrierScope('C6')})`);
      }
    } else if (dest === '落 REQ.md 行') {
      if (!hasReq) findings.push(`${file} → 声明「${dest}」但没有 ${PROJECT_PROBE}(${carrierScope('C6')})`);
    }
  }
  // 方向 B 刻意**不**对每份 ADR 逐个报(决定未必来自 evidence),故没有产出面。
  return { findings, declared, adrCount: adrFiles.length };
}

/** 递归列一个目录下的全部 `.md` 相对路径(排除规则与 `collectProjectScope` 的 walk 保持一致)。 */
function listMdFiles(root, dir) {
  const out = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...listMdFiles(root, rel));
    } else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

/**
 * 项目侧的扫描范围:仓根 `*.md` + `docs/` 下递归的全部 `.md`。
 * 不含 `node_modules/`、点目录等(它们不承载指针契约)。
 *
 * `docs/evidence/` 按 `EXCLUDE_DIRS.project` 整棵排除,**排除数随扫描范围一起返回**
 * (不让排除变成看不见的范围缩小)。⚠️ 排除只针对**指针扫描**(`files`):C5 / C6 这两条载体形态
 * 判据的对象**正是** `evidence/` 下的快照,若连它们一起排除,这两条判据在任何项目里都恒为
 * 「零覆盖」—— 即静默死代码。故排除项的路径另装在 `excludedFiles` 里,载体形态检查**只**
 * 把它们追加进去,指针档一份都不看。
 *
 * @returns `{ files, excluded, excludedFiles }` —— `excluded` 为 `{ dir, count }` 列表,
 *   `excludedFiles` 为被排除目录下的 `.md` 相对路径(载体形态判据专用)。
 */
function collectProjectScope(root) {
  const files = [];
  const excluded = [];
  const excludedFiles = [];
  for (const name of readdirSync(root)) {
    if (name.endsWith('.md')) files.push(name);
  }
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return; // docs/ 不存在(无编号体系项目)—— 静默跳过
    }
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        if (EXCLUDE_DIRS.project.includes(rel)) {
          const sub = listMdFiles(root, rel);
          excluded.push({ dir: rel, count: sub.length });
          excludedFiles.push(...sub);
          continue;
        }
        walk(rel);
      } else if (entry.name.endsWith('.md')) files.push(rel);
    }
  };
  walk('docs');
  return { files: files.sort(), excluded, excludedFiles };
}

/**
 * 跑 C1/C2/C4/C5/C6/C7/C8 七条载体形态判据,汇总成 `{ errors, notes, examined }`。
 *
 * **分流判据**(本函数是唯一的分流点,别在别处再分一次):
 * - **违反 ⇒ `errors`**:内容写错了(超上限 / 必填节缺失 / 去向落不到载体 / 表块内夹空行)。
 * - **零覆盖 ⇒ `notes`**:**我读不到 / 没有对象**。判红等于用门禁阻塞「还没建这个载体」这件小事。
 *   但**必须出声**,否则「0 错误」里就掺了没查的部分 —— 这些 note 带「零覆盖」字样,会被汇入
 *   结论行的 `gaps`。
 *
 * 单独抽出来而不是内联进 `main`:这七条的输入是**多个文件**,内联会让 `main` 继续膨胀。
 *
 * @param root   扫描根
 * @param files  文件范围 = 指针档范围 + `docs/evidence/` 下被排除的快照(载体形态判据专用)
 * @param readFile 读文件(rel → 文本)
 */
function runCarrierChecks(root, files, readFile) {
  const errors = [];
  const notes = [];
  let examined = 0;
  const bump = (n) => { examined += n; };

  // 结构档先跑:表块坏掉时下面 C1/C2 读到的行数与列都是**解析器的误读**, 报出来只会误导
  const tbl = checkTableShape(maskFencedLines(readFile(PROJECT_PROBE)));
  bump(tbl.examined);
  errors.push(...tbl.findings);
  if (!tbl.examined) {
    notes.push(`${PROJECT_PROBE} 定位不到登记表块(表头须同时含「号」与「状态」) ⇒ 表块结构判据零覆盖`);
  }

  const shape = checkLedgerShape(readFile(PROJECT_PROBE));
  bump(shape.examined);
  errors.push(...shape.findings);
  if (!shape.examined) {
    notes.push(`${PROJECT_PROBE} 没有可量化的台账数据行(载体不可达或全为骨架占位) ⇒ 标题列/判断依据上限判据零覆盖`);
  }
  // ⚠️ **列数守卫的存活探针**:`examined === 0` 那条 note 分不清「表里没有可量的行」与
  // 「守卫把每一行都挡掉了」—— 后者正是「静默退出全部判定」那个洞的形态,必须单独出声。
  if (shape.guarded === 0) {
    notes.push(
      `${PROJECT_PROBE} 载体族的列数守卫 0 行进过判定 ⇒ 该族的列数不符判据零覆盖`
        + '(守卫恒不命中时,错位行会带着「量过了」的假象通过)',
    );
  }

  const adr = checkAdrBackground(files, readFile);
  bump(adr.examined);
  errors.push(...adr.findings);
  if (!adr.examined) notes.push('docs/adr/ 下没有 ADR 文件 ⇒ adr 背景判据零覆盖');

  const adrNum = checkAdrNumbering(files);
  bump(adrNum.examined);
  errors.push(...adrNum.findings);
  if (!adrNum.examined) notes.push('docs/adr/ 下没有 ADR 文件 ⇒ adr 编号形态/唯一判据零覆盖');

  const ev = checkEvidenceHead(files, readFile);
  bump(ev.examined);
  errors.push(...ev.findings);
  if (!ev.examined) notes.push('docs/evidence/ 下没有快照文件 ⇒ 结论去向判据零覆盖');

  const rec = checkEvidenceReconcile(ev.parsed, {
    adrFiles: files.filter(isAdrEntry),
    hasReq: readFile(PROJECT_PROBE).trim() !== '',
  });
  errors.push(...rec.findings);
  if (ev.examined && !ev.parsed.length) {
    notes.push('evidence 快照的头部去向全部解析失败 ⇒ 双向对账判据零覆盖(对账以头部的解析为前提)');
  }

  return { errors, notes, examined };
}

// ---------------------------------------------------------------- 入口

/**
 * 门禁主体。**单模式** —— 本仓既是配置仓也是项目仓,不存在「按侧别计退出码」那套机制
 * (ADR-054 决定四已判该机制作废):退出码只由本仓自己的判红条数决定。
 *
 * @returns {number} 退出码(0 = 全过,1 = 有错)
 */
export function main() {
  const root = PROJECT_ROOT;
  const { files, excluded: excludedDirs, excludedFiles } = collectProjectScope(root);
  const cache = new Map();
  const readFile = (rel) => {
    if (!cache.has(rel)) cache.set(rel, readText(root, rel) ?? '');
    return cache.get(rel);
  };
  const ledgerSkip = makeLedgerRowSkipper(readFile);
  // 台账一致性在这里算(而不是最后)才有地方把它的解析盲区打进自报区。
  const ledger = checkLedger(readText(root, PROJECT_PROBE));

  // 跨仓路径:**只分类,不判定**(决定四)。消歧判据 = 「该裸名在**本仓**里解析不到」,
  // 故用同一档解析顺序 —— 与下面第 1/3/5 档逐字同一档。
  const crossRepo = classifyCrossRepoRefs(
    files,
    readFile,
    (ref, fromFile) => resolveRef((rel) => existsAt(root, rel), ref, fromFile, REF_ORDER) !== null,
    makeCrossRepoRowSkipper(readFile),
  );

  // 代码扩展名引用:**只分类,不判定**(文件头同名小节)。⚠️ **本档刻意不调 `resolveRef`** ——
  // 它的解析次数会灌进下面「引用解析 … 判定 N 处」那个计数,而那个计数的口径是判定档的解析量。
  const codeRefs = classifyCodeRefs(files, readFile);

  // 未匹配形态的路径引用:**只分类,不判定**(ADR-057 决定一/二/三)。⚠️ 与代码扩展名档逐字同一处置:
  // **不调 `resolveRef`** —— 解析次数会灌进下面那个「判定 N 处」计数。顺序在代码扩展名档**之后**是
  // 刻意的:去重要逐字比对 `CODE_REF_RE`,而那条正则对象在本文件里只此一处消费者。
  const unmatchedRefs = classifyUnmatchedPathRefs(files, readFile);

  const pErrors = [
    ...checkExistence(root, files, readFile, ledgerSkip),
    ...checkSections(root, files, readFile, ledgerSkip),
    ...checkOrdinalSections(root, files, readFile, ledgerSkip),
    ...ledger.errors,
  ];
  // 逐条打印判红正文(诊断正文是**判据**的产出,不是驱动器的责任;驱动器只决定退出码)。
  for (const e of pErrors) console.log(e);

  // 解析口径的覆盖度快照:**必须在这里取**,晚一步就覆盖不到本轮。
  const refProject = refResolutionStats();
  console.log(
    `  · 引用解析(单模式 · 引用方目录优先):判定 ${refProject.refs} 处`
      + ` · 按引用方目录解析 ${refProject.byDir} 处`
      + ` · 仓根解析 ${refProject.byRoot} 处`
      + ` · 歧义解析 ${refProject.ambiguous} 处`
      + ` · 兜底解析 ${refProject.fallback} 处`
      + (refProject.fallback ? ' ⇒ **非 0 即说明解析过宽**' : '(恒为 0:非 0 即说明有人偷偷加了过宽的兜底基准)'),
  );

  // 跨仓路径的覆盖度与其它档同一口径,但**必须写明「判定 0 处 · 未判」** —— 这是决定四的
  // 核心产出:分类数不等于判定数,把它混进「扫描 N 个文件,0 错误」就是「以为被查过」。
  console.log(
    `  · 跨仓路径(只分类,未判):检查 ${crossRepo.stats.files} 份 · 分类 ${crossRepo.stats.classified} 处`
      + ` · **判定 0 处 · 未判,非「查过没问题」**`
      + ' —— 判红基准在仓外(全局配置目录),本仓不可达;拆分后无任何机器判这一族'
      + (crossRepo.stats.freeTextRows ? ` · 台账形态表体行 ${crossRepo.stats.freeTextRows} 行未参与分类(见 makeCrossRepoRowSkipper)` : ''),
  );

  // 代码扩展名引用:与跨仓档**同一措辞骨架**(分类 N 处 · 判定 0 处 · 未判,非「查过没问题」),
  // 但**零命中必须出声** —— 那一档恒绿(判红基准不可由正则裁决),「扫描面内一条都没有」与
  // 「有 N 条但一条都没判」是两种完全不同的覆盖事实,合成一句话就看不出本仓到底有没有这种写法。
  const codeExtByExt = CODE_REF_EXTS
    .filter((ext) => codeRefs.stats.byExt[ext])
    .map((ext) => `.${ext} ${codeRefs.stats.byExt[ext]} 处`)
    .join(' · ');
  console.log(
    `  · 代码扩展名引用(只分类,未判):检查 ${codeRefs.stats.files} 份 · 分类 ${codeRefs.stats.classified} 处`
      + (codeExtByExt ? `(${codeExtByExt})` : '')
      + ` · **判定 0 处 · 未判,非「查过没问题」**`
      + ' —— 判红基准是人的判断(「文件真的搬走了」与「文档记的是决策史」两类只能分开裁决),正则给不出'
      + (codeRefs.stats.classified === 0
        ? ' ⇒ **零覆盖(扫描面内一条代码扩展名引用都没有)** —— 本档的形态正则若被改窄/删掉,'
          + '这里就会变成 0 而没人发现;若 `REF_FORMS` 反被人扩了扩展名,本档不会归零(它自带正则),'
          + '那时要处理的是**两档重叠**,不是零覆盖'
        : ''),
  );

  // 未匹配形态的路径引用:措辞骨架与前两族平行,**零覆盖另用一句**(ADR-057 决定二)。
  // 与代码扩展名档的差别必须在这一行看得见:那一档守护的是「主动摘除且有裁决」,本档守护的是
  // 「**正则压根没匹配上**」—— 前者归零说明没人写这种引用,后者归零说明**没人看得见写坏的指针**。
  //
  // ⚠️ 分项按**计数降序**排(扩展名不再是枚举,`byExt` 的键就是实际出现的那几个,没有预排顺序可用)。
  const unmatchedByExt = Object.entries(unmatchedRefs.stats.byExt)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ext, n]) => `.${ext} ${n} 处`)
    .join(' · ');
  console.log(
    `  · 未匹配形态的路径引用(只分类,未判):检查 ${unmatchedRefs.stats.files} 份 · 分类 ${unmatchedRefs.stats.classified} 处`
      + (unmatchedByExt ? `(${unmatchedByExt})` : '')
      + ` · **判定 0 处 · 未判,非「查过没问题」**`
      + ' —— 这些内容剥掉 `./`/`../` 前缀后**首字符**落在 `REF_FORMS` 的允许集之外,'
      + '于是三条正则一条都匹配不上,连存在性都不判(ADR-058 收窄口径);扩 `REF_FORMS` 会改判定覆盖面'
      + '并凭空造出假红(ADR-057 决定一),故只分类自报'
      + ' · 名字侧不设字符白名单(含空格、`·`、通配一律收下),扩展名侧一律放开'
      + (unmatchedRefs.stats.classified === 0
        ? ' ⇒ **零覆盖(扫描面内一条未匹配形态的路径引用都没有)** —— 本档归零既可能是「没人写这种写法」,'
          + '也可能是这一族的形态正则被改窄/删掉;两种都要看得见'
        : ''),
  );

  console.log(
    `  · 存在性 / 小节名 / 无引号小节:检查 ${files.length} 份(`
      + (excludedDirs.length ? '**不含**下列按前缀整棵豁免的目录)' : '整棵豁免的目录 0 个)'),
  );
  // 排除数**逐棵**报出(合成一个总数正是「没人看得出哪几棵没查」的形态)。
  if (excludedDirs.length) {
    console.log(
      `  · 历史快照目录(按前缀整棵豁免 · **未查** · 依据「修误报等于篡改历史」):`
        + excludedDirs.map((x) => `${x.dir}/ ${x.count} 份`).join(' · ')
        + ` ⇒ 合计 ${excludedDirs.reduce((n, x) => n + x.count, 0)} 份**不在指针扫描面内**`,
    );
  }
  console.log(
    `  · 台账一致性(台账内 ${LEDGER_RULES.length} 项不变量):检查 1 份(${PROJECT_PROBE})`
      + ` · 登记表可判定 ${ledger.stats.rows} 行`
      + ` · 判据判定 ${ledger.stats.invariants}/${LEDGER_RULES.length} 项`
      + (ledger.stats.invariants === 0 ? ' ⇒ **零覆盖(台账解析失败,非「查过没问题」)**' : '')
      + (ledger.notes.length ? ` · 提示/盲区 ${ledger.notes.length} 项(见下,**不判红**)` : ''),
  );

  // C 组载体形态:**违反进 `pErrors`**(非零退出,与 R1–R8 同级);零覆盖提示只出声。
  // 载体形态检查的对象**含**被指针档排除的 `docs/evidence/`(结论去向判据量的是那批快照),
  // 指针档不碰它们 —— 排除是分档的,不是整仓一刀切。
  const carrier = runCarrierChecks(root, [...files, ...excludedFiles], readFile);
  const carrierIds = CARRIER_RULES.map((r) => r.id).join('/');
  for (const e of carrier.errors) {
    console.log(e);
    pErrors.push(e);
  }
  for (const note of carrier.notes) console.log(`  · 载体盲区提示:${note}`);
  console.log(
    `  · 载体形态(${carrierIds},共 ${CARRIER_RULES.length} 条,**已判红**):`
      + `量过 ${carrier.examined} 处 · 判红 ${carrier.errors.length} 条 · 盲区提示 ${carrier.notes.length} 条`
      + (carrier.examined === 0 ? ' ⇒ **零覆盖(载体不可达或全为骨架占位)**' : '')
      + `(盲区提示**不判红**,各条现在管什么见 ${carrierIds})`,
  );

  for (const note of ledger.notes) console.log(`  · 台账提示:${note}`);

  console.log('各档实际覆盖(分母即该档真实查过的份数):');
  const excludedNote = excludedDirs.length
    ? excludedDirs.map((x) => `已排除 ${x.dir}/ 下 ${x.count} 个文件(历史快照,不读/不登记/不入索引)`).join(';')
    : '已排除 0 个文件';
  console.log(
    pErrors.length === 0
      ? `项目模式通过:扫描 ${files.length} 个文件,0 错误(存在性 / 小节名 / 无引号小节 / 台账一致性 / 载体形态;跨仓路径、代码扩展名引用与未匹配形态的路径引用只分类未判);${excludedNote}`
      : `项目模式失败:${pErrors.length} 错误 / 扫描 ${files.length} 个文件(存在性 / 小节名 / 无引号小节 / 台账一致性 / 载体形态;跨仓路径、代码扩展名引用与未匹配形态的路径引用只分类未判);${excludedNote}`,
  );
  // ⚠️ **错误条数必须在打印之后、`pErrors` 追加载体形态错误之后再取** ——
  // `pErrors` 是**先打印、后追加**的:载体形态判据的 errors 在 `runCarrierChecks` 之后才 push 进来。
  // 在打印处快照会漏掉载体形态那一族,表现为「项目模式失败:N 错误」而结论行写「0」——
  // 结论行与退出码双双说谎,正是本条最不能出的错。
  const errorCount = pErrors.length;

  // ---- 门禁结论行(每次运行**最后一行**,固定前缀)--------------------------------
  // `覆盖=` 与自报区同口径:「触发 0 处 / 解析失败」这类**零覆盖**记为「不全」,
  // 而「无对象」(该判据在本仓没有适用对象)不算 —— 两者在门禁规范里是分开的两条。
  const gaps = [];
  if (excludedDirs.length) {
    gaps.push(`历史快照目录按前缀整棵豁免(未查):${excludedDirs.map((x) => `${x.dir} ${x.count} 份`).join(' + ')}`);
  }
  if (ledger && ledger.stats.invariants === 0) gaps.push('台账内不变量零覆盖');
  for (const note of ledger ? ledger.notes : []) {
    if (note.includes('零覆盖')) gaps.push(note);
  }
  // ⚠️ **错位行只要 >0 就进 gaps**(REQ-160,与三族指针同一处置)。
  // 列数 ≠ 表头 ⇒ 该行 `continue` 掉,**退出全部台账判据**(号唯一 / 号段连续 / 上限
  // 一条都不查它)。原先它只在自报区打一行「不参与判定」——**那一行在 CI 输出里没人读**,
  // 而结论行是唯一保证被读到的一行。不推进来的话,「这 N 行我没查」就只存在于一个不会被看的
  // 地方,`通过` 会被误读成「全查过了」—— 这正是 ADR-056 撤销的那类假绿。
  // **已升判红**:原先按「解析失败 ≠ 违规」只出声,但那条定性只覆盖了「报错措辞」,
  // 漏了「整行退出全部判定」这个后果 —— 静默退出全部判定会让门禁把**没判**的行说成**判过**的行。
  // 「退出判定」本身保留(按列名下标取值在错位行上会读到别的列),但退出必须同时硬失败。
  // **为什么是条件式而非像三族那样恒进**:0 错位行说的是「没有行被跳过」——那是**真的查过了**,
  // 与三族的「判定 0 处 = 没人管」不同性质,恒进会把真话报成缺口。
  if (ledger && ledger.stats.badColumn > 0) {
    gaps.push(`台账错位行 ${ledger.stats.badColumn} 行未判(列数 ≠ 表头,该行已退出全部台账判据)`);
  }
  // ⚠️ **R8 的零覆盖同样恒进 gaps**,理由与上面那条相同但更硬:错位行是「解析失败」,
  // 而节名不认识是**判据覆盖面**本身短了一块 —— R8 的分母仍算在 `LEDGER_RULES.length` 里,
  // 不推进来的话「8/8 项」会被读成「八条都判过了」。
  if (ledger && ledger.stats.sectionUnknown > 0) {
    gaps.push(`「状态 ⇔ 所在节」有 ${ledger.stats.sectionUnknown} 行零覆盖(所在节名不在相容表内,该行未参与 R8)`);
  }
  // ⚠️ **跨仓路径的「判定 0 处」恒进 gaps**(实施约束 6):它在本仓**永远**是「未判」,
  // 不是「判定后发现没问题」。不推进 gaps 的话,「0 错误」里就掺了没判的那一族。
  gaps.push(`跨仓路径未判(分类 ${crossRepo.stats.classified} 处 · 判定 0 处,判红基准在仓外不可达)`);
  if (crossRepo.stats.freeTextRows) gaps.push(`跨仓路径台账形态表体行 ${crossRepo.stats.freeTextRows} 行未判`);
  // ⚠️ **代码扩展名引用的 gap 恒进,零命中也进**(与跨仓档同一处置):本族在本仓**永远**是「未判」,
  // 不是「判定后发现没问题」。**零命中时用另一句措辞**:那是「这一族在本仓零覆盖」——
  // 恒绿的一族若在扫描面里彻底没有对象,必须看得见,否则「没人写这种引用」与「这一族没人管」无法区分。
  // ⚠️ **零覆盖这一声是本档形态正则的存活探针,不是 `REF_FORMS` 的**:本档**自带**正则(不复用
  // `REF_FORMS` 的对象),故 `REF_FORMS` 被人扩扩展名时本档**不会**跟着归零 —— 那时的失效形态是
  // 「两档重叠」,由本档的非零计数加上文件头注释提醒,不是靠这一声。
  gaps.push(
    codeRefs.stats.classified === 0
      ? '代码扩展名引用零覆盖(形态 0 处 · 判定 0 处,未判,非「查过没问题」)'
      : `代码扩展名引用未判(分类 ${codeRefs.stats.classified} 处 · 判定 0 处,判红基准需人工裁决「文件真的搬走了」与「文档记的是决策史」)`,
  );
  // ⚠️ **未匹配形态的 gap 恒进,零命中也进**(ADR-057 决定二,与前两族同一规格)。
  // **零命中时措辞必须是「零覆盖」而不是「未判 N 处」**:零覆盖说的是「这一族在本仓没有对象」,
  // 写成「未判 0 处」会把「没有东西要查」说成「有东西但没查」—— 那是把零覆盖**反向误读**成更糟的形态。
  gaps.push(
    unmatchedRefs.stats.classified === 0
      ? '未匹配形态的路径引用零覆盖(形态 0 处 · 判定 0 处,未判,非「查过没问题」)'
      : `未匹配形态的路径引用未判(分类 ${unmatchedRefs.stats.classified} 处 · 判定 0 处,这些内容剥前缀后首字符落在 REF_FORMS 允许集之外,连存在性都不判)`,
  );
  if (carrier.examined === 0) gaps.push(`载体形态 ${carrierIds} 零覆盖`);

  console.log(
    `门禁结论:已判定 | ${errorCount === 0 ? '通过' : `失败(${errorCount})`} | 模式:项目`
      + ` | 范围:${files.length} | 覆盖:${gaps.length ? `不全(${gaps.join(';')})` : '完整'}`,
  );

  // **只返回值,不在本函数里写 `process.exitCode`** —— 写宿主退出码是入口层的事
  // (入口守卫那一处)。判定本体被注册表 import 时不该顺手改宿主进程的退出码。
  return errorCount === 0 ? 0 : 1;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。写法与 gates/repo/check-docs.mjs 同形
// (全仓先例),不另创写法。
//
// 为什么必须有守卫(不是「整洁」问题,是危险):门禁注册表要能**真 import** 本模块取出判定函数
// (`main`),而验收段跑在 **Electron** 里 —— 顶层自执行会在 import 本模块的那一刻起判定,
// 顺手改掉宿主进程的 `process.exitCode`,并把整套台账解析打进别人的输出。守卫之后本模块可被
// 安全 import,注册表因此能登记它并真 import 出判定函数。
//
// ⚠️ **`process.exitCode = main()` 那行必须保持缩进**(自执行探测是行首锚定正则
// `^process\.exitCode\s*=`:顶格写会被判定本体注册表判成「顶层自执行」而与「可安全 import」
// 的声明矛盾)。入参先取进局部变量再比较,是为了让「读命令行参数」在本文件里**恰好只出现一次** ——
// 那是「不读环境变量 / 不加任何开关」这条机械不变量能被机械核对的前提(见文件头「不做」段)。
//
// 比较的右侧是 `fileURLToPath(import.meta.url)`(本文件的**代码位置**),**不是**
// `join(ROOT, 'gates', 'repo', check-pointers.mjs)`:根是 cwd 派生的**环境**值,
// 本门禁被刻意以「cwd 指向合成仓 + argv[1] 指向仓内本体」的方式调用(见 check-docs.selftest.mjs
// 与 test/gates/check-pointers-e2e.test.js),两者恒不相等 ⇒ 拿 ROOT 反推自身路径会让守卫
// **永不成立**:无任何输出、退出码 0。方向只能是「用位置事实断言位置」。
const entryArg = process.argv[1];
if (entryArg !== undefined && resolve(entryArg) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}