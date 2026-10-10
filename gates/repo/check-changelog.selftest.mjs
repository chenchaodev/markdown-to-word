// CHANGELOG 口径门禁自身的回归守护(负向夹具)。
//
// check-changelog.mjs 是一道「扫不到东西就恒绿」风险极高的门禁:判据的输入是**一行 markdown
// 文本**,若词表被清空 / 锚点正则被改坏 / 扫描面塌缩,本脚本会打印 `[ok]` 而六类禁词照旧长在
// CHANGELOG 里。此处用临时夹具逐条制造这些漂移,断言门禁确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体,也不复制它**:夹具 = 临时目录里的一份 docs/CHANGELOG.md。纯函数档
// 直接 import 判定本体 `judgeChangelog` 并注入文本(ADR-074 决定二:判定本体拆出注入面之后,
// 夹具验的就是真规则本身,而不是「进程跑一遍」这种间接证据);进程级档靠 cwd 指夹具根跑仓内
// 真脚本 —— 项目根单一来源是 shared/paths.js 的 process.cwd(),而 ESM 静态 import 按**文件
// 位置**解析、与 cwd 无关,所以真脚本的仓内依赖天然可达,沙盒里不需要(也不应该)再放一份
// shared/。真实仓库只被**读**(实时仓锚点那一条跑真实 docs/CHANGELOG.md)。
//
// 每条负向夹具须命中一个真实漂移形态,而非人造噪声 —— 依据见各夹具的 why 注释。
//
// ---- 形态:一张合成根用例表 + 留在原处的 bespoke case(ADR-068 / ADR-074)----
//
// 进表的是**纯函数判红档**:输入是「合成根里的一份 CHANGELOG 正文」,输出是问题清单,一族
// 形态一致。表行只放纯数据(仓库相对 POSIX 路径 → 正文 + 期望问题清单正则),期望正则
// **不带 `[changelog:fail] ` 前缀** —— 那是 main 打印时才加的,判定本体给出的 `hit.message`
// 本体形如 `docs/CHANGELOG.md:行:列 → 禁内部工程词(CI)「…」`。
//
// 不进表的三族,理由逐条写在各自的组注里:
//   ① 判绿档(期望零问题)—— harness 的表结构表达不了「零问题」这一格(`expect` 必须非空,
//      且恒绿防护把零问题判成失败);
//   ② 扫描面判据(锚点被改名 / 条目区无任何版本条目)—— 这两条的判红文案由 main 里的
//      `auditScanSurface` 产出,而 `judgeChangelog` 在这种情况下返回的是**零问题**
//      (region===null 时 `problems: []` 是设计使然:判定本体只报内容问题,扫描面问题归 CLI
//      层),故它们断的是「退出码 + 输出」,与 ③ 同在进程级 bespoke 里;
//   ③ IO 层失效(文件读不到)与未知参数 —— judge 拿不到「文件不存在」这个事实。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, createCaseSuite } from '../../shared/case.js';
import { runSyntheticRootCases, withSyntheticRoot } from '../../shared/gate-selftest-harness.mjs';
import { ROOT } from '../../shared/paths.js';
import { judgeChangelog } from './check-changelog.mjs';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'gates', 'repo', 'check-changelog.mjs');

/**
 * 合规 CHANGELOG 底板:头部有一句**故意提到禁词**的口径说明(真实仓库头部就是这种形态),
 * 条目区三条都是「用户能感知的变化」的第三人称叙述。
 */
const CLEAN = [
  '# CHANGELOG',
  '',
  '> 版本演进历史,面向终端用户。只记录你能感知的变化;内部重构、测试、构建与发版流程不在此列出。',
  '',
  '## [待发版]',
  '',
  '### 修复',
  '',
  '- 图 / 表题注的字号此前两种导出不一样。现在两者一致,都跟随正文字号。',
  '- 设置的默认值此前是浅拷贝:改动某项设置时默认值本身可能被一并改掉。现在默认值每次独立构造。',
  '',
  '## [1.0.0] - 2026-01-01',
  '',
  '- 首个版本:支持 Markdown 转 Word 与 PDF。',
  '',
].join('\n');

/** 夹具底板:合成根里只有这一份 docs/CHANGELOG.md(harness 不预建目录,见其头注⑤) */
const BASE_FILES = Object.freeze({ 'docs/CHANGELOG.md': CLEAN });

/** 把一条待发版条目注入到合规底板的条目区(锚点 `## [待发版]` 之后) */
function injectEntry(line) {
  return CLEAN.replace('## [待发版]\n', `## [待发版]\n\n${line}\n`);
}

/** 表里的一行假仓库树:底板 + 本条用例自己的 CHANGELOG 正文(求值在模块加载期,行内仍是纯数据) */
const withBody = (body) => ({ ...BASE_FILES, 'docs/CHANGELOG.md': body });

/**
 * 纯函数档的判定体:读合成根里那份 CHANGELOG,返回问题清单(措辞 = `hit.message` 本体)。
 * @param {string} root 合成根绝对路径
 * @returns {string[]} 问题清单
 */
const judge = (root) =>
  judgeChangelog(readFileSync(join(root, ...'docs/CHANGELOG.md'.split('/')), 'utf8'))
    .problems.map((hit) => hit.message);

/**
 * 进程级档:以指定 cwd 跑仓内门禁本体。**cwd 即求值根**(shared/paths.js 的 ROOT =
 * process.cwd()),所以这一句同时是「换根」与「不换脚本」—— 夹具里因此不需要、也不该放一份
 * 门禁副本。
 * @param {string} cwd 工作目录
 * @param {string[]} args 传给门禁的参数
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
 * 在合成目录上跑门禁 CLI(进程级档)。造树与清理由 harness 的 withSyntheticRoot 承担(清理在
 * finally,中途断言失败抛异常时同样要删)。
 *
 * 入参是**完整**的假仓库树(不代为铺底板):`{}` = 合成根里什么都没有,这正是「IO 层失效」
 * 那一档要的形态(cwd 指一个没有 docs/CHANGELOG.md 的目录 ⇒ readFileSync 抛 ENOENT)。
 * @param {Record<string, string>} files 假仓库树(仓库相对 POSIX 路径 → 正文)
 * @param {string[]} [args] 传给门禁的参数
 * @returns {Promise<{ code: number | null, output: string }>}
 */
function runChecker(files, args = []) {
  return withSyntheticRoot(files, (root) => runAt(root, args));
}

const suite = createCaseSuite();

// =====================================================================================
// 表一:条目区口径判据的负向夹具(判据收注入的文本、输出是问题清单 —— 这一族形态一致,进表)
// =====================================================================================

/** @type {import("../../shared/gate-selftest-harness.mjs").SyntheticRootCase[]} */
const JUDGE_CASES = [
  {
    // 判据一:禁内部工程词。逐词覆盖过一半枚举,证明词表不是只挂着两三个词。
    name: '判据一:条目里出现「CI 拦截」→ 判红',
    files: withBody(injectEntry('- 设置契约守卫补第 15 键(此前漏更致 CI 拦截)。')),
    expect: /docs\/CHANGELOG\.md:\d+:\d+ → 禁内部工程词\(CI\)/,
  },
  {
    name: '判据一:条目里出现「门禁」→ 判红',
    files: withBody(injectEntry('- 新增一道门禁,校验导出产物的结构。')),
    expect: /→ 禁内部工程词\(门禁\)/,
  },
  {
    name: '判据一:条目里出现「DEV-GUIDE」与「代码地图」→ 判红',
    files: withBody(injectEntry('- 代码地图更新:DEV-GUIDE 新增若干文件说明。')),
    expect: /→ 禁内部工程词\((DEV-GUIDE|代码地图)\)/,
  },
  {
    name: '判据一:条目里出现「GitHub Actions」→ 判红',
    files: withBody(injectEntry('- 升级 GitHub Actions 至 v5,消除弃用警告。')),
    expect: /→ 禁内部工程词\(GitHub Actions\)/,
  },
  {
    name: '判据一:条目里出现「tsconfig」→ 判红',
    files: withBody(injectEntry('- 开启 tsconfig 的严格开关,暴露若干潜在问题。')),
    expect: /→ 禁内部工程词\(tsconfig\)/,
  },
  {
    name: '判据一:条目里出现「覆盖率」→ 判红',
    files: withBody(injectEntry('- 覆盖率阈值上调,顺带把断言补齐。')),
    expect: /→ 禁内部工程词\(覆盖率\)/,
  },
  {
    name: '判据一:条目里出现「lint」→ 判红',
    files: withBody(injectEntry('- lint 规则清掉了两条误报。')),
    expect: /→ 禁内部工程词\(lint\)/,
  },
  // ---- 2026-10-05 用户裁决补入的四个词(上游「工程状态」类不写清单)----
  // 每条**各自断言自己的词**,诊断文案点名到词而不是笼统说「含内部工程词」——
  // 否则一次实现写错(比如四个词只挂上其中一个)时,这份 selftest 仍会全绿。
  {
    name: '判据一:条目里出现「依赖升级」→ 判红(点名该词)',
    files: withBody(injectEntry('- 依赖升级:markdown-it 提到 14.3,顺带修掉一处解析差异。')),
    expect: /→ 禁内部工程词\(依赖升级\)/,
  },
  {
    name: '判据一:条目里出现「测试补齐」→ 判红(点名该词)',
    files: withBody(injectEntry('- 测试补齐:导出链路的边界用例补了一批。')),
    expect: /→ 禁内部工程词\(测试补齐\)/,
  },
  {
    name: '判据一:条目里出现「目录重组」→ 判红(点名该词)',
    files: withBody(injectEntry('- 目录重组:src 下的模块按职责重新分目录。')),
    expect: /→ 禁内部工程词\(目录重组\)/,
  },
  {
    name: '判据一:条目里出现「类型开关」→ 判红(点名该词)',
    files: withBody(injectEntry('- 类型开关:严格模式默认关闭。')),
    expect: /→ 禁内部工程词\(类型开关\)/,
  },
  {
    // 边界一(不带成词护栏):这四个是完整名词短语,后面续什么都还是同一件事。
    // 若有人给它们套上 `CHENGYU_GUARD`,「依赖升级了」会被静默放过 ⇒ 这条夹具当场变红。
    name: '边界:「依赖升级」后接助词仍判红(四个新词不带成词护栏)',
    files: withBody(injectEntry('- 依赖升级了,导出长文档的速度略有提升。')),
    expect: /→ 禁内部工程词\(依赖升级\)/,
  },
  {
    // `文件拆分` 的负向夹具:上游「工程状态」清单第五项,REQ-192 用户裁决后入枚举。
    // 与其余四个新词同样**各自断言自己的词**,防止「五个词只挂上其中一个」时 selftest 仍全绿。
    // ⚠️ 正文必须字面含「文件拆分」四字 —— 门禁只认连续字面,写成「拆成多个文件」则与本词无关。
    //
    // ⚠️⚠️ **原第 18 条钉子夹具就在本条之前,已随本批撤除**,撤除理由记在下面 ——
    // 撤钉子必须有痕迹,否则后人看到词表里有 `文件拆分` 会误以为「从没考虑过加」,
    // 也看不到当初**为什么不加**的那条理由是被实测推翻的。
    //   原夹具名(**历史裁决,已作废**):`钉子:上游清单里的「文件拆分」刻意不加 → 条目里写它不判红`
    //   (expect: null,正文 `- 长文档导出按章节文件拆分,便于分批交付。`)。
    //   它断言的正是「加了词 ⇒ 必红」,所以加词与撤它**只能同批做**,否则两者互相矛盾、
    //   门禁必红 —— 这正是钉子的设计目的:让推翻裁决必然伴随一次显式删除。
    //   撤除依据(2026-10-05 用户裁决「可以加了」,REQ-192):原裁决不加的唯一理由是
    //   「本产品导出 Word/PDF 时长文档本来就会拆,用户说『文件被拆开』是完全合理的表述」。
    //   **该理由已被全仓检索推翻**:界面文案(`src/core/i18n/*.ts` + `src/renderer/index.html`)
    //   与 `docs/USER-GUIDE.md` 除代码注释里的「拆分自 X 模块」外**零处「拆」字**;批量转换是
    //   「每个**源文件**单独生成一个文档」、合并是「多个**源文件**合成一个文档」—— 两者都以源
    //   文件为界,本产品**没有把一份长文档拆成多份产物的功能**,那个担心不成立。
    //   ⚠️ 词表侧的实测结论(动词形态全绿 / 名词形态判红)记在门禁本体文件头判据一节,不复制到此处。
    name: '判据一:条目里出现「文件拆分」→ 判红(点名该词)',
    files: withBody(injectEntry('- 文件拆分:长文档导出按章节文件拆分,便于分批交付。')),
    expect: /→ 禁内部工程词\(文件拆分\)/,
  },
  {
    // 判据二:禁第二人称。测的是**叙述句**里的你,而白名单里那条「你好」是另一形态。
    name: '判据二:条目里出现第二人称「你」→ 判红',
    files: withBody(injectEntry('- 水印透明度此前只在 PDF 生效 —— 你在设置里调透明度,Word 那边看不出变化。')),
    expect: /→ 禁第二人称\(你\)/,
  },
  {
    name: '判据三:条目里出现 REQ-138 → 判红',
    files: withBody(injectEntry('- 修复若干问题(REQ-138)。')),
    expect: /→ 禁内部编号\(REQ-0NN\)/,
  },
  {
    name: '判据三:条目里出现 commit hash → 判红',
    files: withBody(injectEntry('- 升级依赖,commit 为 a1b2c3d。')),
    expect: /→ 禁内部编号\(commit hash\)/,
  },
  {
    // 判据一的 commit 裸词形态:它与判据三是两条独立口径,故两条都会报(不互相遮掩)。
    name: '判据一:条目里出现「commit」裸词(无哈希)→ 判红',
    files: withBody(injectEntry('- 仓库补了一份 commit 规范说明。')),
    expect: /→ 禁内部工程词\(commit\)/,
  },
  {
    // 判据四:禁文言虚词。逐字覆盖枚举 —— 文言腔正是本次改写质量不合格的主因之一。
    name: '判据四:条目里出现文言虚词「亦」→ 判红',
    files: withBody(injectEntry('- 题注此前两处导出不一致，图上版本号亦停留在旧版本。')),
    expect: /→ 禁文言虚词\(亦\)/,
  },
  {
    name: '判据四:条目里出现「遂」→ 判红',
    files: withBody(injectEntry('- 改用统一解析后，遂不再出现重复题注。')),
    expect: /→ 禁文言虚词\(遂\)/,
  },
  {
    name: '判据四:条目里出现「兹 / 矣 / 焉 / 兮 / 尔」→ 判红',
    files: withBody(injectEntry('- 兹项修复已生效，界面矣 cleaner，行为焉 cleaner，标题兮 cleaner，待尔复验。')),
    expect: /→ 禁文言虚词\((兹|矣|焉|兮|尔)/,
  },
  {
    // 反向锚点:护栏是**逐词**的,不能因为一行里有「覆盖」就把同行的裸「盖」一起放过。
    name: '判据四:成词护栏不掩盖同行裸用「盖」→ 判红',
    files: withBody(injectEntry('- 预设覆盖范围扩展，此外盖住了原先的例外项。')),
    expect: /→ 禁文言虚词\(盖\)/,
  },
  // 判据五:禁装饰性副词。均/一概/俱/概 在真实语料里确有副词用法(实测均 2 处、概览 1 处已放行)。
  {
    name: '判据五:条目里出现装饰性副词「均」→ 判红',
    files: withBody(injectEntry('- 两种导出的字号此前不一致，现两者均跟随正文字号。')),
    expect: /→ 禁装饰性副词\(均\)/,
  },
  {
    name: '判据五:条目里出现「一概 / 悉 / 俱 / 概」→ 判红',
    files: withBody(injectEntry('- 该问题一概不再出现；错误界面悉已对齐；图标俱已就位；功能概已补齐。')),
    expect: /→ 禁装饰性副词\((一概|悉|俱|概)/,
  },
  {
    // 实义限定判定:语料实测 `仅` 的 21 处命中全是实义限定,故这条分支必须放行 ——
    // 反过来,「仅」后面跟程度副词(无限定对象)才是装饰用法,必须判红。
    name: '判据五:无实义限定的装饰性「仅」→ 判红',
    files: withBody(injectEntry('- 题注字号仅略微缩小了一点，两种导出现已一致。')),
    expect: /→ 禁装饰性副词\(仅\)/,
  },
  // 判据六:禁载体维护。这三个是本次改写被判定不合格的另一主因。
  {
    name: '判据六:条目里出现「截图重拍」→ 判红',
    files: withBody(injectEntry('- 界面预览图重拍主窗口与空状态两张。')),
    expect: /→ 禁载体维护\(重拍\)/,
  },
  {
    name: '判据六:条目里出现「重新拍摄 / 示例路径 / 图片格式」→ 判红',
    files: withBody(injectEntry('- README 截图按新版重新拍摄；本机路径已换成示例路径；修正图片格式为 .jpg。')),
    expect: /→ 禁载体维护\((重新拍摄|示例路径|图片格式)/,
  },
  {
    // `原生标题栏` 的语境判定:讲截图(载体维护)判红,讲界面变更(正当条目)放行。
    name: '判据六:截图语境里的「原生标题栏」→ 判红',
    files: withBody(injectEntry('- 官网截图展示的还是早已不用的原生标题栏样式，现已重拍。')),
    expect: /→ 禁载体维护\(原生标题栏\)/,
  },
];

// -------------------------------------------------------------------------------------
// bespoke case:留在原处的那些(不进表),理由逐组写在组注里
// -------------------------------------------------------------------------------------

/**
 * 组一 · 判绿档(**不进表**):断言的是**零问题**,而 harness 的表结构表达不了这一格 ——
 * `expect` 必须非空(空表行恒绿、判红信息为零),且恒绿防护把「零问题」判成失败。
 * 这正是 harness 头注里写明的「要断『零问题』请写 bespoke case」。
 * 十五条反向锚点全在这一组:判绿档若整体失效,上面那一整组负向夹具的「红」就失去意义。
 */
const JUDGE_GREEN_CASES = Object.freeze([
  {
    name: '夹具基线未漂移 → 通过',
    files: {},
  },
  {
    // 边界二(短词不收):条目区实测 `目录` 19 处、`补齐` 3 处、`重组` / `拆分` / `类型` 各 1 处,
    // 而 `目录` 指的是**生成目录(TOC)本身**——本产品的核心用户功能;`补齐跨级` 是一条
    // 正当的排版修复条目。若按短词收,这批正当条目全部被打红 ⇒ 噪声源的下场是被关掉。
    // 下面三条的措辞**取自真实条目**(L103 / L234 / L327),不是人造样本。
    name: '边界:短词「补齐 / 重组 / 目录 / 拆分」不成词 → 通过',
    files: withBody(injectEntry('- 标题层级错位自动上移一级并补齐跨级；设置面板重组为 6 组标签页导航（编号与目录）；i18n 字典按语言拆分并建立回退链。')),
  },
  {
    // 边界三(语序):`升级依赖` 是另一种正当说法(实测条目区 2 处「升级」均非本词),
    // `依赖` 单独也常见(「不依赖系统已安装的字体」)。连续字面收词才不至于误伤这两种。
    name: '边界:「依赖」单独与语序相反的「升级依赖」→ 通过',
    files: withBody(injectEntry('- 导出不依赖系统已安装的字体；升级依赖后需重装一次。')),
  },
  {
    // 反向锚点:一条正常用户措辞的条目(讲依赖与格式、恰好含「依赖」但不含四个新词)
    // 必须判绿 —— 防「凡提到这四个词就红」的实现走偏(例如退化成整行匹配)。
    name: '反向锚点:正常用户措辞提到依赖与格式 → 通过',
    files: withBody(injectEntry('- 大文档导出不再依赖系统已安装的字体,Word 与 PDF 的产物排版保持一致。')),
  },
  {
    // `文件拆分` 的误报面锚点(反向):动词形态是**正当的用户措辞**,与名词形态只差两个字序,
    // 而门禁只收连续字面「文件拆分」⇒ 下列三条全部判绿。其中第二条取自真实条目 L327。
    // 这条夹具把「误伤面到底在哪」钉成事实,而不是留一句「误报概率低」的断言。
    name: '反向锚点:动词形态的正当用户措辞「按章节拆成多个文件」等 → 通过',
    files: withBody(injectEntry('- 长文档导出按章节拆成多个文件,便于分批交付；i18n 字典按语言拆分并建立回退链；Word 导出结果按一级标题拆分成多份。')),
  },
  {
    // 白名单按内容匹配的正向锚点:问候语「你好」是白名单登记的唯一形态,它必须仍判绿,
    // 否则白名单一旦腐烂成「整行放行」,自检也发现不了。
    name: '判据二:问候语「你好」走白名单 → 通过',
    files: withBody(injectEntry('- 首次启动的问候语改成「你好」,并补上副标题。')),
  },
  {
    // hash 形态的误报面锚点(反向):纯数字长串与纯字母长串都不是 commit hash,
    // 判红它们会逼着人把正常数据从 changelog 里删掉。
    name: '判据三:紧凑日期 20261001 不是 hash → 通过',
    files: withBody(injectEntry('- 打包时间戳此前取构建日 20261001,导致同日多次构建产物不一致。')),
  },
  {
    name: '判据三:纯字母长串(defaced)不是 hash → 通过',
    files: withBody(injectEntry('- 界面上的一处英文文案 defaced 拼错了,现已改对。')),
  },
  {
    // 结构性负向:头部是要写反例的地方(真实仓库头部就写着「内部重构」与「你」),
    // 连头部一起扫的话唯一的修法是把口径说明改成绕口令 —— 那是损害而不是守护。
    name: '结构性负向:头部含全部六类禁词 → 通过(只扫条目区)',
    files: withBody([
      '# CHANGELOG',
      '',
      '> 只记录你能感知的变化;内部重构(门禁 / CI / 覆盖率 / 契约守卫 / 代码地图 / DEV-GUIDE /',
      '> tsconfig / GitHub Actions / refactor / lint / commit / 依赖升级 / 测试补齐 / 目录重组 /',
      '> 文件拆分 / 类型开关)与 REQ-138 等内部编号不在此列出。',
      '> 文言虚词(亦 / 兹 / 遂 / 矣 / 焉 / 兮 / 尔)、装饰性副词(均 / 一概 / 悉 / 俱 / 概 / 仅)',
      '> 与载体维护(截图重拍 / 重新拍摄 / 重新截图 / 重新导图 / 示例路径 / 图片格式)一概不列出。',
      '',
      '## [待发版]',
      '',
      '### 修复',
      '',
      '- 题注字号此前两种导出不一致。现在两者一致。',
      '',
      '## [1.0.0] - 2026-01-01',
      '',
      '- 首个版本。',
      '',
    ].join('\n')),
  },
  {
    // 成词护栏的反向锚点:`覆盖` 是本仓 changelog 的高频正当用词(实测 9/9 命中全在成词里),
    // 按裸「盖」判红会把它们全部打红 —— 噪声源的下场是被关掉,故护栏必须逐词钉住。
    name: '判据四:成词「覆盖 / 遮盖 / 涵盖 / 均匀 / 俱全 / 概览 / 偶尔」→ 通过',
    files: withBody(injectEntry('- 预设覆盖页眉页脚与公式编号；灰底遮盖住引用块边界；目录涵盖全部源文件；字距均匀；图标俱全；附功能概览；偶尔出现。')),
  },
  {
    name: '判据五:实义限定的「仅 PDF」→ 通过',
    files: withBody(injectEntry('- 水印不透明度此前仅 PDF 导出有效，现 Word 侧也生效。')),
  },
  {
    name: '判据五:实义限定的「仅显示当前分组」→ 通过',
    files: withBody(injectEntry('- 设置抽屉改为两栏，左侧为标签栏，右侧仅显示当前分组的选项。')),
  },
  {
    name: '判据五:「平均」走白名单(实义用法)→ 通过',
    files: withBody(injectEntry('- 灰底此前仅部分内容带底，现整块平均覆盖引用块。')),
  },
  {
    name: '判据六:纯界面语境的「原生标题栏」→ 通过(正当界面变更)',
    files: withBody(injectEntry('- 主窗口移除原生标题栏，改用自定义标题区，拖动与双击行为不变。')),
  },
]);

/**
 * 组二 · 进程级档(**不进表**):断言的是**退出码 + 合并输出**,不是「问题清单」——
 * harness 的 judge 契约是 `(合成根) => string[]`,把退出码塞进返回数组就是把「问题清单」
 * 那一格撑成通用返回通道(ADR-074 后果节的半齿纪律:期望必须在表里,才谈得上「删一条会留痕」;
 * 这一族一旦改成表,退出码的期望就会离开表)。四条分三种理由,逐条写在各自注释里。
 */
const CLI_CASES = Object.freeze([
  {
    // 防空过(判据一):锚点被改名 ⇒ 扫描面塌缩成「扫不到任何东西」⇒ 必须判红,
    // 否则这类漂移会静默恒绿(恒绿是纯文本门禁最危险的失效形态)。
    // 判红文案由 main 里的 auditScanSurface 产出(判定本体此时返回零问题,见文件头 ②)。
    name: '防空过:锚点 `## [待发版]` 被改名 → 判红(扫描面塌缩)',
    files: withBody(CLEAN.replace('## [待发版]', '## 待发版')),
    expectCode: 1,
    expect: /找不到版本条目区锚点/,
  },
  {
    // 防空过(判据二):条目区被清空(只剩锚点与空小节)⇒ 扫不到任何版本条目 ⇒ 判红。
    name: '防空过:条目区无任何版本条目 → 判红',
    files: withBody(['# CHANGELOG', '', '## [待发版]', '', '（空）', ''].join('\n')),
    expectCode: 1,
    expect: /在锚点之后没有任何 `## \[` 版本条目/,
  },
  {
    // 防空过(判据三):CHANGELOG 路径写成不存在的 ⇒ 读不到 ⇒ 判红,
    // 而不是「扫不到东西所以恒绿」。这条同时证明 CHANGELOG_REL 是真的被用上了。
    // **合成根是空的**:judge 拿不到「文件不存在」这个事实(那是 IO 层的事)。
    name: '防空过:CHANGELOG 路径不存在 → 判红',
    files: {},
    expectCode: 1,
    expect: /扫描失败/,
  },
  {
    name: '未知参数(不得静默按默认扫描面跑一遍报绿)',
    files: { ...BASE_FILES },
    args: ['oops'],
    expectCode: 1,
    expect: /无法识别的参数:oops/,
  },
  {
    // 正向对照:真实仓库只被读。判红面是**当前事实**,故断言写成「exit 0」而不是写死条数 ——
    // 写死会在下一次改写 CHANGELOG 时变成一条自己把自己判红的夹具。
    // **不进表**:读的是真实仓而不是注入面,harness 的 judge 只拿得到合成根。
    name: '真实仓库当前未漂移 → 通过',
    realRepo: true,
    expectCode: 0,
    expect: null,
  },
]);

// -------------------------------------------------------------------------------------
// 跑:表内用例走 harness(它自己建树、跑判定、比对、汇成 case),bespoke 逐条 suite.case。
// -------------------------------------------------------------------------------------

await runSyntheticRootCases({
  group: '条目区口径判据(合成根 · 判红档)',
  judge,
  cases: JUDGE_CASES,
  suite,
});

// ---- bespoke:判绿档(零问题,harness 的表结构表达不了这一格) ----
await suite.describe('判绿档(bespoke · 零问题)', async () => {
  for (const testCase of JUDGE_GREEN_CASES) {
    await suite.case(testCase.name, async () => {
      const problems = await withSyntheticRoot({ ...BASE_FILES, ...testCase.files }, (root) => judge(root));
      assert(
        problems.length === 0,
        `期望零判红,实际 ${String(problems.length)} 条:${problems.join('\n')}`,
      );
    });
  }
});

// ---- bespoke:进程级档(退出码 + 合并输出,不是「问题清单」) ----
await suite.describe('进程级档(bespoke · 退出码与输出)', async () => {
  for (const testCase of CLI_CASES) {
    await suite.case(testCase.name, async () => {
      const run = testCase.realRepo === true
        ? runAt(projectRoot, [])
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
    console.error(`[changelog-selftest:fail] ${failure.name}:${failure.message ?? '(无失败消息)'}`);
  }
  console.error(
    `[changelog-selftest:fail] CHANGELOG 口径门禁回归守护失败,共 ${String(failures.length)}/${String(cases.length)} 条`,
  );
  process.exit(1);
}
console.log(`[ok] changelog-selftest:${String(cases.length)} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);
