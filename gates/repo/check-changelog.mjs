// CHANGELOG 内容口径门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// 守护的契约(全局 AGENTS.md「文档体系」写入判据 ②):`docs/CHANGELOG.md` 的 `[待发版]` 段
// **只许写用户在界面 / 文档 / 行为上可观察到的变化**,且**不含任何内部编号**(REQ-0NN、
// commit hash)。这两条口径此前**没有任何机器判据**:门禁链上守着测试树的编号
// (check-test-numbering.mjs)与删除动作(check-temp-cleanup.mjs),而面向人的那一份
// (CHANGELOG)恰恰是内部工程词最容易长进去的地方 —— 「CI 拦截」「契约守卫补第 15 键」
// 「代码地图更新:DEV-GUIDE 新增 …」这类句子对写的人**零成本**(他刚做完这些事),
// 对读的人**零价值**(终端用户不关心门禁与文件结构),而 CHANGELOG 是发版闸门里唯一的
// 「面向人的说法」载体。本门禁把这条口径变成可判红的判据。
//
// 判定输入是**文件文本**而非任何构建产物:门禁要在「有人新写了一行含内部工程词的条目」
// 的最早时刻就红,故它排在链上文档段内、build 之前(接在 `check:docs:selftest` 之后)。
// 正则 + 逐行扫描,理由同 check-test-numbering.mjs / check-temp-cleanup.mjs(纯 Node、零新增依赖)。
//
// 用法:
//   node gates/repo/check-changelog.mjs
//   node gates/repo/check-changelog.mjs --help
//
// ---- 扫描面(单一来源:本文件顶部的 CHANGELOG_REL)----
//   `docs/CHANGELOG.md` 的**版本条目区** = 首个 `## [待发版]` 标题行**起**到文件末。
// 文件头部那几行(标题 + 「只记录你能感知的变化…」口径说明)**不扫**,理由不是「头部不重要」,
// 而是头部是**写给维护者看的口径声明**,它必须能自由地把被禁的词举成反例(「内部重构、测试、
// 构建与发版流程不在此列出」这句话本身就得写到「重构」二字才说得清)。若连头部一起扫,
// 唯一的「修法」是把口径说明改写成不敢提禁词的绕口令 —— 那是在**损害**本门禁要守护的东西。
// 这条边界有端到端实证:自检脚本里有一夹具专门在头部注入全部六类禁词并断言判绿。
//
// ---- 判据一:禁内部工程词(封闭枚举)----
//   CI · 门禁 · 覆盖率 · 契约守卫 · 代码地图 · DEV-GUIDE · tsconfig · GitHub Actions ·
//   refactor · lint · commit
// 为什么是「封闭枚举」而不是「工程词表从别处推导」:工程词的边界随本仓工具链变(明天多一道
// 门禁、后天换 CI),推导出来的词表每次都要跟着改,且**没有人会在改 CHANGELOG 时想起改词表**
// —— 于是词表腐烂,门禁静默漏判。封闭枚举的代价是「新工程词不会被自动抓」,那个代价由下面
// 「已知不覆盖」里的一条兜着:人写。新词进枚举是一次显式决定,漏掉的代价是「那一版 CHANGELOG
// 混进一句工程词」,不是「门禁失效」。
// 形态上的三条刻意取舍(均为实测结论,改形态前先跑本脚本看命中面):
//   1. **ASCII 词一律加边界**:CI / refactor / lint / commit 用前后非字母数字的断言。否则
//      `CI` 会命中任何含这两个字母的标识符片段,`lint` 会命中 `splint` 一类词 —— 判红会
//      逼着人改 CHANGELOG 文案来讨好门禁,真误报必须归零而不是靠白名单硬扛。
//   2. **`CI` 只认大写**:中文 changelog 里小写 `ci` 只可能出现在真英文句子里,而真英文句子
//      本身就该判红;反过来若用 `/i`,`ci` 会命中 `cid`/`civ` 之类片段,误报面立刻扩大。
//   3. **`commit` 收的是裸词而不是「哈希形态」**:任务口径写的是「commit(哈希形态)」,
//      但裸词是那个形态的**超集** —— 收窄到哈希形态会漏掉「commit 规范」「commit message」
//      这类同样不该进面向用户的 CHANGELOG 的写法,收益为零而漏判面变大。真正的哈希由判据三
//      独立抓(且哈希可以不带 `commit` 一词出现),两者不互相遮掩:一条 `commit a1b2c3d`
//      会在判据一与判据三各报一次,因为它同时违反两条口径,不是重复计数。
//
// ---- 判据二:禁第二人称(汉字 `你`)----
// 口径来源是「CHANGELOG 用第三人称叙述用户」:条目讲的是**产品变了什么**,不是**产品叫你去做什么**
// (「打开设置,调整透明度」是用户手册的句子,不是变更记录的句子)。
// **误报面实测(2026-10-01,本机全仓扫描;分改写前/改写后两次)**:
//   - 改写前(旧版全文):`你` 命中 5 处 / 4 行 —— 头部口径说明 1 处(第 3 行,不扫)+ 条目区 4 处
//     (第 33 行两处、第 42 行、第 117 行),**条目区内 4 处全部是真违规**(第二人称叙述:
//     「你在设置里调透明度」「恢复你上次的选择」「不涉及你的文档内容」),**误报 0 处**。
//   - 改写后(当前全文):`你` 命中 **0 处**(连头部那句也改成了「用户可感知的变化」)。
//   另有两条实测支撑「CHANGELOG 里的 `你` 不可能是引用产品文案」:全仓 `src/` 里 `你` 只出现
//   2 处,且两处都是冒烟夹具的表值「你好」(`src/main/smoke.ts`);界面文案里 `你` 与 `您` **均为 0 处**。
// 故**不收窄**成「`你` + 常见口语搭配」的形态:收窄会把「你上次」「你的文档」这类真违规放过,
// 而换来的误报面下降是 0(误报面两次实测都是 0)。唯一正当形态是问候语「你好」,走白名单。
//
// ---- 判据三:禁内部编号 ----
//   `REQ-\d{3}` 与 7~40 位十六进制 commit hash。
// hash 形态的三个刻意取舍:
//   1. **两端都要非字母数字**:否则 `x1a2b3c4`(变量名)/ `a1b2b3d4e5f6g`(更长标识符)会被切一段命中。
//   2. **必须同时含数字与十六进制字母**:纯数字长串是本仓 changelog 里真实存在的形态(紧凑日期
//      `20261001`、字节数、条目 id),纯字母的 7+ 串也真实存在(`defaced` / `effaced` 是英文词)。
//      只认「字母数字混合且首尾非字母数字」这一族,实测把上述两类假阳性全部挡掉;代价是漏掉
//      理论上的全数字哈希(7 位十六进制全数字的概率约 3.7%,且本门禁的兜底判据是「人写」)。
//   3. **大小写不敏感**:git 允许混合大小写的哈希,只认小写会让 `A1B2C3D` 溜过去。
//
// ---- 判据四:禁文言虚词(`classical-term`)----
//   亦 兹 遂 矣 焉 兮 尔 · 盖(**带成词护栏**,见下)
// 口径来源是 2026-10-01 用户判定的改写质量不合格:满篇「亦／现已／均／同」的文言腔。
// 这类词**有封闭枚举**(不像比喻与调侃),故本判据成立 —— 上一版把「语气词无封闭词表可枚举」
// 写进「已知不覆盖」是**不准确的**,那一节已按本次实测更正。
//
// **实测与题面的一处出入(必须写明,因为它改变了枚举内容)**:`盖` 被列进枚举时的理由是
// 「现代技术中文里几乎没有合法用法」,但实测(改写前 HEAD 快照 308 行 + 当时工作树)证明**恰好相反**:
// 全语料 `盖` 共 9 处命中,**9 处全部落在成词里**(`覆盖` 6 · `遮盖` 1 · `覆盖层`/`涵盖` 2),
// **裸用(文言义)0 处**。`覆盖` 是本仓 changelog 的高频词(条目讲「预设覆盖哪些设置」),
// 按裸 `盖` 判红会把这 6 处正当内容全部打红 —— 那是把门禁变成噪声源,而噪声源的下场是被关掉。
// 故 `盖` **带成词护栏**入库:前接 `覆/遮/涵/铺` 即放行,只对裸用判红。护栏是词级而非行级,
// 因为成词边界就在字上,按行放行会把同行的真裸用一起放过。
//
// **为什么不收 `其` 和 `此`**:`其` 在「其他/其中/其次/尤其」里、`此` 在「因此/此时/此外」里
// 都是**现代汉语的正常构词成分**(实测「其他」在本仓 changelog 里高频出现)。收进去的误报面
// 是「仅/均」那几条的数十倍,而拦截收益是零 —— 文言用法里的「其」几乎总是「其他」的误写,
// 而误写「其」的地方通常也带别的文言特征,那些已被 `亦/兹/遂` 覆盖。
// 这是**有意的设计边界**:宁可漏「其/此」这两种最容易被正常词吸收的字,也不制造噪声。
//
// ---- 判据五:禁装饰性副词(`filler-adverb`)----
//   均 一概 悉 俱 概 · 仅(**带实义限定判定**,见下)
// 口径同属「文言腔」那一类,但这几个字与判据四性质不同:它们**能构成实义词**
// (`平均` 的均 · `概览/概念/概括` 的概 · `俱全` 的俱),故不能无条件命中,必须逐条判语境。
//
// **「实义限定」的判定口径(自定,可辩护)**:`仅` 后面 17 字内出现下列任一即为实义限定 → 放行。
//   ① 引号内的界面元素名(「钤印」「结构改写」) ② 反引号/`$` 包裹的代码符号
//   ③ 拉丁词(格式名 PDF/Word 等)              ④ 数量限定(一处/单个/一组/一批/部分/当前)
//   ⑤ 限定性动词或介词(见于/按/用于/以/能/在/体现/记录于/覆盖/显示/关闭/允许/作用于/保留于/写出/来自)
// 为什么这样划界:实义用法与装饰用法的区别**不在 `仅` 本身**(两者是同一个字),而在**它后面有没有
// 指向一个具体对象的限定**。「仅 PDF」限定了一个格式,信息量在这;「仅略微调整了间距」后面跟的是
// 程度副词,不限定任何对象,纯装饰。逐条列可判的限定形态比「凭语感」稳。
// **实测(HEAD 快照 + 当时工作树)**:`仅` 命中 21 处,**实义限定 21 处 / 装饰用法 0 处**
// ⇒ 这条判定在当前语料上的行为**等价于「仅 不判红」**,它的价值是拦住将来出现的装饰用法。
// 这一点必须写明:一道在真实语料上零命中的判据不是坏判据,但它**不提供任何已发生的保护**,
// 它的保护对象是未来。别把它当成「已验证有效」。
//
// `均/一概/悉/俱/概` 除成词护栏外一律判红(成词护栏:概 后接 览/念/括/述/略/数/观/算;俱 后接 全;
// 悉 后接 数/心/力;均 后接 续/匀 —— 均只跟「续」和「匀」放行,「平均」不放行,理由见 ALLOWLIST):
// 这几个字在技术中文里当副词用就是装饰。`一概` 无任何合法形态。
//
// ---- 判据六:禁载体维护(`carrier-maintenance`)----
//   重拍 重新拍摄 重新截图 重新导图 示例路径 图片格式 · 原生标题栏(**带语境判定**,见下)
// 「截图重拍/路径替换成示例」是**纯载体维护**的指纹:它描述的是文档与图片资产,不是用户可感知的
// 产品变化。用户看 CHANGELOG 是想知道「我的软件变了什么」,而「截图重拍了两张」对他没有任何影响。
//
// **`原生标题栏` 带语境判定**:它**既是载体维护的指纹,又是正当的界面术语** —— 「移除原生标题栏」
// 是一条完全正当的界面变更条目(本仓真的做过这件事,见「已知不覆盖」第 4 条)。实测 1 处命中,
// 语境是「此前截图展示的窗口样式(原生标题栏)已不再使用」= 讲截图而非讲界面。
// 故该词的判红条件是「**同句内出现载体词**(截图/图片/预览/示例/替换)且谈的是旧样式」,
// 纯界面语境(讲动作词而**无**载体词)放行。只按「词在枚举里」无条件判红会把正当界面变更打红 ——
// 那正是把门禁变成噪声源的那一步。
//
// ---- 判据七:破折号单条超过 1 个(**已否决,不实现**)----
// **实测否决**:改写前快照里 `——` 出现 11 行,其中**单条超过 1 个的只有 1 行**,而那一行是
// 「内容 —— 包括**后续所有文件** —— 整段变成一个代码块」—— 这是中文里**标准的夹注用法**
// (成对破折号表夹注),完全正当。11 行里 10 行单破折号、唯一的多破折号样本还是正当用法,
// 说明这条判据在本仓语料上的误报率接近 100%,拦不到真正的「滥用」。
// 而它想拦的东西(一条里塞两个夹注)本身也不确定是不是缺点 —— 夹注密集有时恰恰是叙述清楚。
// 结论:不实现。这是「误报面不可控 ⇒ 不做」,不是遗漏;判据四/五/六已覆盖「文言腔 + 载体维护」
// 这两个真实的改写缺陷,破折号密度不是其中之一。
//
// ---- 已知不覆盖(设计边界,不是遗漏)----
//   1. **比喻、调侃、语气助词**:CHANGELOG 的可读性大半靠「此前…现在…」这类叙事与偶尔的调侃,
//      而中文里没有任何封闭词表能枚举「这句话是不是在开玩笑」——「顺手给它加了条子」既可以是
//      调侃也可以是正经描述。这三类**只能靠人写**;门禁一旦试图枚举,就会开始判红正当的比喻,
//      而正当比喻被逼改写会直接损害这份文档唯一存在的理由。
//      (上一版这条写的是「语气词」,**过宽** —— 文言虚词与装饰性副词**有**封闭枚举,
//      已分别落成判据四与判据五,故收窄为语气**助词**。见本节末的更正说明。)
//   2. **术语一物一名**:同一件事在用户可见文案里叫「题注」在代码里叫 `caption`,这不是违规,
//      但 changelog 里若混进代码符号(`ipc-contract` / `convert.ts`)也**判不出来** ——
//      「用户能不能感知」与「这句话在不在讲用户能感知的事」之间没有机械判据。本门禁只挡
//      **封闭词表里那几十个明确不面向用户的词**,不做语义判断。
//   3. **头部不扫**(见「扫描面」):头部是要写反例的地方。
//   4. **语义层面的「文言腔」仍然判不出来**:判据四/五只挡**封闭枚举里的那几十个字**,
//      而文言腔的真正形态是**句法**(倒装、省略主语、「遂/乃」连用成串、被动化)。
//      一句话可以一个禁字都没有而全是文言腔(「界面于新版中得以调整」)。这部分靠人写。
//   5. **破折号密度**(判据七):实测否决,理由见该节 —— 唯一的多破折号样本是正当夹注。
//   6. **载体维护的语义面**:判据六挡的是**指纹词**,而「这次更新了文档里的示意图」这类
//      以别的方式说出来的载体维护(换了张示意图、文档重新排版)判不出来 ——
//      指纹词挡不住换了说法之后的同一件事。
// 这几条合起来的意思是:本门禁负责「机械可判的那部分口径」,剩下的由写的人负责。它不宣称
// 「CHANGELOG 合规」,只宣称「CHANGELOG 里没有那几类具体的东西」。
//
// **一处需要指名的设计取舍**:判据四/五的枚举是**封闭**的,新出现的文言词不会自动被抓。
// 这是刻意的(词表推导的代价是「没人会在改 CHANGELOG 时想起改词表」,词表一腐烂门禁就静默
// 漏判);代价由第 4 条兜着 —— 语义层面的漏判交人写。
//
// ---- 白名单会腐烂 ----
// 白名单按**内容**匹配(词形 + 同行上下文),**不按行号**:CHANGELOG 每次发版都在改写,
// 按行号登记的条目会静默变成「放行别的句子」。新增条目必须在 `why` 里写明「为什么这不是违规」
// ——没有依据的条目等于把门禁关掉。输出会打印本次白名单命中数与零命中条目:实命中条目可以
// 复核,零命中条目(`cold: true`,按设计不在扫描面内)留着无害,**非** cold 的零命中条目则说明
// 白名单已腐烂,应当复核是否可删 —— 判据写在同一个文件里,这样才不用另开载体。
//
// ---- 入口守卫:必需,不是整洁问题 ----
// 本门禁**没有** `execFileSync`(不像 check-docs.mjs),所以它不属于「import 即在 Electron 里
// 起一个永不退出的 GUI 进程」那一类事故。但守卫仍然必需,两条理由各自独立:
//   1. 顶层自执行会**改写宿主进程的 exitCode**。验收段在 Electron 里跑,而门禁注册表
//      (gates/probe/gate-probes/registry.mjs)会 import 本模块当判定本体指针 —— import 时刻
//      顶层自执行等于「被 import 的模块顺手决定了整个验收进程的退出码」。
//   2. 注册表 R4b 逐项对账 `judgment.load` 声明与「顶层是否自执行」的事实,两者必须一致;
//      有守卫 ⇒ 事实为「无自执行」⇒ 指针走默认的真 import 档(拿到真函数对象,而不是静态文本
//      里的那个名字)。守卫写法与 check-test-numbering.mjs / check-docs.mjs 同形(全仓先例)。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
/** 被扫文件(单一来源:扫描面只此一处登记) */
export const CHANGELOG_REL = 'docs/CHANGELOG.md';
/** 版本条目区的锚点标题行(`## [待发版]`);找不到 ⇒ 判红(扫描面塌缩) */
const ANCHOR_RE = /^##[ \t]*\[待发版\]/;
/** 版本标题行(用于「条目区确实含版本条目」这条下界判据) */
const VERSION_HEADING_RE = /^##[ \t]*\[/;
/** 诊断片段的最大长度(超长行截断,避免刷屏) */
const SNIPPET_MAX = 96;
const USAGE = '用法: node gates/repo/check-changelog.mjs [--help]';

// ---- 判据定义(封闭枚举;诊断文案与判定同处,避免两处漂移)----

/**
 * @typedef {object} Term 一条词形
 * @property {string} id 词形 id(诊断与白名单匹配用)
 * @property {string} token 命中时打印的词形本身
 * @property {RegExp} re 匹配式(**必须带 g**;只用 matchAll 消费 —— 它会克隆正则,不改本对象的
 *   lastIndex,别改成 .test() 复用同一实例)
 * @property {(token: string) => boolean} [accept] 命中后的二次判定(正则表达不了的形态约束,理由见文件头)
 * @property {string} [guard] 成词护栏:命中**前一个字**匹配 CHENGYU_GUARD[guard] 即放行
 * @property {boolean} [scope] 命中后按 SUBSTANTIVE_SCOPE_RE 判「实义限定」,成立即放行(判据五 `仅`)
 * @property {boolean} [carrier] 命中后按 CARRIER_CONTEXT_RE 判载体语境,成立才判红(判据六 `原生标题栏`)
 */

/**
 * @typedef {object} Rule 一条判据
 * @property {string} id 判据 id
 * @property {string} label 人可读名(诊断文案用)
 * @property {readonly Term[]} terms 该判据下的词形
 */

/** 判据一:禁内部工程词 */
const INTERNAL_TERMS = Object.freeze([
  { id: 'ci', token: 'CI', re: /(?<![A-Za-z0-9_])CI(?![A-Za-z0-9_])/g },
  { id: 'gate', token: '门禁', re: /门禁/g },
  { id: 'coverage', token: '覆盖率', re: /覆盖率/g },
  { id: 'contract-guard', token: '契约守卫', re: /契约守卫/g },
  { id: 'code-map', token: '代码地图', re: /代码地图/g },
  { id: 'dev-guide', token: 'DEV-GUIDE', re: /DEV-GUIDE/g },
  { id: 'tsconfig', token: 'tsconfig', re: /tsconfig/g },
  { id: 'github-actions', token: 'GitHub Actions', re: /GitHub\s+Actions/g },
  { id: 'refactor', token: 'refactor', re: /(?<![A-Za-z0-9_])refactor(?![A-Za-z0-9_])/gi },
  { id: 'lint', token: 'lint', re: /(?<![A-Za-z0-9_])lint(?![A-Za-z0-9_])/gi },
  { id: 'commit', token: 'commit', re: /(?<![A-Za-z0-9_])commit(?![A-Za-z0-9_])/gi },
]);

/** 判据二:禁第二人称(只收汉字「你」;形态与误报面实测见文件头) */
const SECOND_PERSON_TERMS = Object.freeze([
  { id: 'ni', token: '你', re: /你/g },
]);

/** 判据三:禁内部编号 */
const INTERNAL_ID_TERMS = Object.freeze([
  { id: 'req', token: 'REQ-0NN', re: /\bREQ-\d{3}(?!\d)/g },
  {
    id: 'commit-hash',
    token: 'commit hash',
    // 两端非字母数字 + 7~40 位;「字母数字混合」由 accept 二次判定(理由见文件头判据三第 2 条)
    re: /(?<![A-Za-z0-9])[0-9a-f]{7,40}(?![A-Za-z0-9])/gi,
    accept: (token) => /[0-9]/.test(token) && /[a-f]/i.test(token),
  },
]);

/**
 * 成词护栏:命中位置的**相邻字**落在指定侧即放行。成词相对命中字的**方向不统一** ——
 * `覆盖`/`偶尔` 在左侧(命中字是词尾),`概览`/`俱全`/`悉数` 在右侧(命中字是词头) ——
 * 而护栏方向搞错的后果是**静默失效**(实测抓到:按左侧判的 `概览` 被判红,那正是要拦的噪声源)。
 * 故护栏显式声明方向,不靠猜。
 * 之所以做成**逐词**护栏而不是逐条白名单:成词边界落在字上,走 ALLOWLIST 只能按整行内容匹配,
 * 会把同行的真裸用一起放过;而实测语料里 `盖` 的成词占比是 **9/9 = 100%**,
 * 这正是「护栏必须精确到字」的证据。
 * @type {Readonly<Record<string, { prev?: RegExp, next?: RegExp }>>}
 */
const CHENGYU_GUARD = Object.freeze({
  // 覆盖/遮盖/涵盖/铺盖 —— `盖` 在本仓 changelog 里只以这些成词出现(实测裸用 0 处)
  gai: { prev: /[覆遮涵铺]/ },
  // 概览/概念/概括/概述/概略/概数/概观/概算
  gai_: { next: /[览念括述略数观算]/ },
  // 俱全
  ju: { next: /全/ },
  // 悉数/悉心/悉力
  xi: { next: /[数心力]/ },
  // 均续/均匀。**「平均」刻意不放行**:它是「平均分布」这类实义用法,但它同时也是
  // 「平均每页 3 行」这种纯副词用法,两者字形相同、无机械判据 —— 故不放行,靠 ALLOWLIST
  // 逐条按内容豁免(见 ALLOWLIST 的 pingjun 条),那样新出现的「平均」会被点名而不是被静默放过。
  jun: { next: /[续匀]/ },
  // 偶尔 —— `尔` 在现代中文里只以这个词出现
  er: { prev: /偶/ },
});

/**
 * 判据四:禁文言虚词。`盖` 带成词护栏(实测裸用 0 处、成词 9 处,理由见文件头)。
 */
const CLASSICAL_TERMS = Object.freeze([
  { id: 'yi', token: '亦', re: /亦/g },
  { id: 'zi', token: '兹', re: /兹/g },
  { id: 'sui', token: '遂', re: /遂/g },
  { id: 'yi2', token: '矣', re: /矣/g },
  { id: 'yan', token: '焉', re: /焉/g },
  { id: 'xi2', token: '兮', re: /兮/g },
  { id: 'er', token: '尔', re: /尔/g, guard: 'er' },
  { id: 'gai', token: '盖', re: /盖/g, guard: 'gai' },
]);

/**
 * 「实义限定」的形态(判据五的 `仅` 专用;口径与理由见文件头)。
 * 每一条都是「`仅` 后面出现它 ⇒ `仅` 在限定一个具体对象 ⇒ 放行」。
 * @type {RegExp}
 */
const SUBSTANTIVE_SCOPE_RE = new RegExp(
  [
    '「[^」]{1,20}」',            // ① 引号内的界面元素名
    '`[^`]{1,20}`',               // ② 反引号包裹的代码符号
    String.raw`\$[^ ]{1,10}`,     // ② $…$ 包裹的行内公式
    '[A-Za-z][A-Za-z0-9.+-]{1,12}', // ③ 拉丁词(PDF / Word 等格式名)
    '一处|单个|一组|一批|部分|当前', // ④ 数量限定
    '见于|按|用于|以|能|在|体现|记录于|覆盖|显示|关闭|允许|作用于|保留于|写出|来自', // ⑤ 限定性动介
  ].join('|'),
);

/**
 * 判据五:禁装饰性副词。`仅` 带实义限定判定,其余带成词护栏。
 */
const FILLER_TERMS = Object.freeze([
  { id: 'jun', token: '均', re: /均/g, guard: 'jun' },
  { id: 'yigan', token: '一概', re: /一概/g },
  { id: 'xi3', token: '悉', re: /悉/g, guard: 'xi' },
  { id: 'ju2', token: '俱', re: /俱/g, guard: 'ju' },
  { id: 'gai2', token: '概', re: /概/g, guard: 'gai_' },
  { id: 'jin', token: '仅', re: /仅/g, scope: true },
]);

/**
 * 载体语境(判据六的 `原生标题栏` 专用;理由见文件头):同句内出现这些词 ⇒ 讲的是
 * 文档/图片资产而不是界面本身 ⇒ 该命中是载体维护,判红。
 * @type {RegExp}
 */
const CARRIER_CONTEXT_RE = /截图|图片|预览|示例|重拍|重新拍摄|重新截图|重新导图/;

/** 判据六:禁载体维护。`原生标题栏` 带语境判定,其余无条件判红。 */
const CARRIER_TERMS = Object.freeze([
  { id: 'repaint', token: '重拍', re: /重拍/g },
  { id: 'reshoot', token: '重新拍摄', re: /重新拍摄/g },
  { id: 'rescreenshot', token: '重新截图', re: /重新截图/g },
  { id: 'reexport-img', token: '重新导图', re: /重新导图/g },
  { id: 'sample-path', token: '示例路径', re: /示例路径/g },
  { id: 'img-format', token: '图片格式', re: /图片格式/g },
  { id: 'native-titlebar', token: '原生标题栏', re: /原生标题栏/g, carrier: true },
]);

/** @type {readonly Rule[]} */
export const RULES = Object.freeze([
  { id: 'internal-term', label: '禁内部工程词', terms: INTERNAL_TERMS },
  { id: 'second-person', label: '禁第二人称', terms: SECOND_PERSON_TERMS },
  { id: 'internal-id', label: '禁内部编号', terms: INTERNAL_ID_TERMS },
  { id: 'classical-term', label: '禁文言虚词', terms: CLASSICAL_TERMS },
  { id: 'filler-adverb', label: '禁装饰性副词', terms: FILLER_TERMS },
  { id: 'carrier-maintenance', label: '禁载体维护', terms: CARRIER_TERMS },
]);

// ---- 白名单(逐条写明依据;按内容匹配,不按行号)----

/**
 * @typedef {object} ChangelogHit 一处命中
 * @property {string} file 仓库相对 POSIX 路径
 * @property {number} line 行号(1 起,对文件全文而非条目区切片)
 * @property {number} column 列号(1 起,指向命中词本身)
 * @property {string} ruleId 判据 id
 * @property {string} termId 词形 id
 * @property {string} token 命中的词
 * @property {string} lineSource 命中所在行原文
 * @property {string} message 人可读诊断(判红文案本体,CLI 与驱动器的归一层共用这一份)
 */

/**
 * @typedef {object} AllowEntry 白名单条目
 * @property {string} id 条目 id(失效提示里点名用)
 * @property {string} termId 只对该词形生效(不同判据的词形不共用豁免 —— 合并会让一条豁免
 *   同时放行两类形态,等于把门禁关掉一半)
 * @property {(hit: ChangelogHit) => boolean} match 内容判定
 * @property {string} why 依据:为什么这不是违规
 * @property {boolean} [cold] true = 按设计不在扫描面内,零命中是预期(输出里分开计数)
 */

/** @type {readonly AllowEntry[]} */
export const ALLOWLIST = Object.freeze([
  {
    id: 'nihao-greeting',
    termId: 'ni',
    // 「你好」的「你」是问候语,不是第二人称叙述。判据二收的是「叙述句里的你」,问候语不在
    // 那个集合里 —— 但两者形态上只差后一个字,只能按内容区分。
    // column 是 1 起的命中列号,故切原文要从 column-1 起(column-1 = 命中词本身的位置)
    match: (hit) => hit.lineSource.slice(hit.column - 1).startsWith('你好'),
    cold: true,
    why: '「你好」是问候语固定搭配,不是第二人称叙述。按内容(命中词紧跟「好」)豁免,不按行号 —— '
      + 'CHANGELOG 每次发版都在改写,行号必然漂移。**登记为 cold(按设计零命中)**:实测全仓 '
      + 'CHANGELOG 里 `你` 的正当形态出现 0 次(改写前条目区 4 处命中全为第二人称叙述,改写后全文 0 处),'
      + '本条是**预防**而不是在掩盖现存误报;留着无害,但删掉之后第一条「你好」写进 CHANGELOG 就会误判。',
  },
  {
    id: 'pingjun-average',
    termId: 'jun',
    // 「平均」是「均」唯一稳定的实义形态。CHENGYU_GUARD.jun 只放行 均续/均匀,
    // 「平均」刻意不放行 —— 它同时是实义用法(平均分布)与纯副词用法(平均每页 3 行),
    // 两者字形相同、无机械判据,放进字级护栏等于把整个「平均」永久放行(新出现的装饰用法
    // 也会跟着静默通过)。改成**按内容**豁免:新写一条含「平均」的条目时它会被点名复核。
    match: (hit) => /平均/.test(hit.lineSource),
    cold: true,
    why: '「平均分布」「平均每页 N 行」里的「平均」是实义用法(表示分布的均匀性),不是'
      + '「均」那种纯副词。按内容(同行含「平均」)豁免,不按行号 —— CHANGELOG 每次发版都在改写。'
      + '**与字级护栏分开**是刻意的:字级护栏放行是「永久放行」,内容级豁免每次发版可复核。'
      + '**cold(按设计零命中)**:实测本仓 changelog 的 `均` 只作副词出现,「平均」0 处 —— '
      + '本条是**预防**而不是在掩盖现存误报(与 nihao-greeting 同理)。',
  },
]);

// ---- 扫描与判定 ----

/** 诊断片段:压掉多余空白,超长截断 */
function snippet(lineSource) {
  const flat = lineSource.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat;
}

/**
 * 定位版本条目区。
 * @param {string[]} lines 全文按行切分
 * @returns {{ startLine: number, versionHeadings: number, nonEmpty: number } | null} 条目区首行行号(1 起)
 *   + 条目区的**已发版本条目数**与非空行数;null = 找不到锚点(扫描面塌缩)
 */
export function locateEntryRegion(lines) {
  const startIndex = lines.findIndex((line) => ANCHOR_RE.test(line));
  if (startIndex === -1) return null;
  const region = lines.slice(startIndex);
  return {
    startLine: startIndex + 1,
    // **从锚点下一行起数**:锚点自己也是 `## [` 形态,把「只有锚点」的条目区数成 1 个版本条目
    // 会让下界判据恒真 —— 那正是它要防的那类塌缩(实测:这条判据写成「区域内含 ≥1 个版本标题」
    // 时,一个只剩锚点的 CHANGELOG 判绿,自检当场抓到)。
    versionHeadings: region.slice(1).filter((line) => VERSION_HEADING_RE.test(line)).length,
    nonEmpty: region.filter((line) => line.trim() !== '').length,
  };
}

/**
 * 表面判据:条目区是否真的被扫到了(防「扫不到任何东西所以恒绿」)。
 * 这组判据与内容判据分工:内容判据只看「扫到的东西里有没有违规」,扫空了它只会报 0 项,于是
 * 「锚点被改名」「条目区被清空」这类漂移会静默变成通过 —— 而恒绿是纯文本门禁最危险的失效形态
 * (没人会去看一个总是 exit 0 的脚本)。
 * @param {{ versionHeadings: number, nonEmpty: number } | null} region locateEntryRegion 的返回
 * @returns {{ code: string, message: string }[]} 违规结论(空数组 = 通过)
 */
export function auditScanSurface(region) {
  /** @type {{ code: string, message: string }[]} */
  const problems = [];
  if (region === null) {
    problems.push({
      code: 'anchor-missing',
      message: `${CHANGELOG_REL} 找不到版本条目区锚点(首个 \`## [待发版]\` 标题行):扫描面塌缩成`
        + '「什么都扫不到」⇒ 本次一个条目都没查。锚点被改名/删除时必须改本门禁的 ANCHOR_RE,'
        + '不许顺手把 CHANGELOG 的待发版段标题改掉',
    });
    return problems;
  }
  if (region.versionHeadings < 1) {
    problems.push({
      code: 'region-empty',
      message: `${CHANGELOG_REL} 的版本条目区(第 ${region.startLine} 行起)在锚点之后没有任何 `
        + '`## [` 版本条目:条目区被清空 ⇒ 本次一个条目都没查'
        + `(锚点之后扫到非空 ${region.nonEmpty - 1} 行;锚点自己不计入 —— 把锚点算成「一个版本条目」`
        + '会让这条下界判据恒真,而恒真的下界判据等于没有)',
    });
  }
  return problems;
}

/**
 * 扫描条目区,返回违规命中(白名单条目在此处扣除)。
 * 纯函数:analyze 与自检夹具共用这一条路径,否则夹具验的就不是真规则。
 * @param {string[]} lines 全文按行切分
 * @param {number} startLine 条目区首行的行号(1 起)
 * @returns {{ hits: ChangelogHit[], allowUsed: Set<number> }}
 */
export function scanLines(lines, startLine) {
  /** @type {ChangelogHit[]} */
  const hits = [];
  /** 本次实命中的白名单条目下标(用于「零命中条目」判据) */
  const allowUsed = new Set();
  /** 同一 (行, 判据, 词形, 词) 只报一次:一个词在同一句里重复出现不构成两条可行动作 */
  const seen = new Set();

  for (let i = startLine - 1; i < lines.length; i += 1) {
    const lineSource = lines[i] ?? '';
    if (lineSource === '') continue;
    for (const rule of RULES) {
      for (const term of rule.terms) {
        for (const m of lineSource.matchAll(term.re)) {
          if (term.accept !== undefined && !term.accept(m[0])) continue;
          const column = (m.index ?? 0) + 1;
          // 成词护栏:护栏方向由词形自己声明(左邻/右邻),不靠猜 —— 方向搞错的后果是
          // 静默失效(判据五的 `概览` 就是这么被误判红的,自检夹具已钉住)。
          if (term.guard !== undefined) {
            const rule = CHENGYU_GUARD[term.guard];
            const offset = m.index ?? 0;
            if (rule?.prev?.test(lineSource.slice(0, offset).slice(-1)) === true) continue;
            if (rule?.next?.test(lineSource.slice(offset + term.token.length, offset + term.token.length + 1)) === true) continue;
          }
          // 实义限定:`仅` 后面跟的是具体对象 → 实义用法,放行。窗口 17 字是实测定的:
          // 语料里 `仅` 到其限定对象的距离最大 16 字,再宽就吃到无意义的远距离搭配。
          if (term.scope === true
            && SUBSTANTIVE_SCOPE_RE.test(lineSource.slice(column, column + 16))) {
            continue;
          }
          // 载体语境:「原生标题栏」只在讲截图/图片资产时才判红,纯界面语境放行
          if (term.carrier === true && !CARRIER_CONTEXT_RE.test(lineSource)) continue;
          /** @type {ChangelogHit} */
          const hit = {
            file: CHANGELOG_REL,
            line: i + 1,
            column,
            ruleId: rule.id,
            termId: term.id,
            token: m[0],
            lineSource,
            message: `${CHANGELOG_REL}:${i + 1}:${column} → ${rule.label}(${term.token})「${snippet(lineSource)}」`,
          };
          const allowIndex = ALLOWLIST.findIndex(
            (entry) => entry.termId === term.id && entry.match(hit),
          );
          if (allowIndex !== -1) {
            allowUsed.add(allowIndex);
            continue;
          }
          const key = `${hit.line}:${hit.ruleId}:${hit.termId}:${hit.token}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push(hit);
        }
      }
    }
  }
  return { hits, allowUsed };
}

/**
 * 白名单零命中条目(非 cold):它们说明白名单已腐烂 —— 该形态现在不出现了,条目留着等于
 * 「静默放行别的内容」。cold 条目按设计零命中,不进这份名单。
 * @param {Set<number>} allowUsed scanLines 回传的白名单实命中下标
 * @returns {string[]} 条目 id
 */
export function staleAllowlistIds(allowUsed) {
  return ALLOWLIST
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => entry.cold !== true && !allowUsed.has(index))
    .map(({ entry }) => entry.id);
}

/**
 * 全量判定(判定本体;注册表把本函数登记为这道门禁的指针)。
 * @returns {{ problems: ChangelogHit[], allowHits: number, allowCold: number, staleAllow: string[],
 *   region: { startLine: number, versionHeadings: number, nonEmpty: number } | null }}
 */
export function analyze() {
  const text = readFileSync(path.join(projectRoot, ...CHANGELOG_REL.split('/')), 'utf8');
  const lines = text.split('\n');
  const region = locateEntryRegion(lines);
  if (region === null) {
    return { problems: [], allowHits: 0, allowCold: 0, staleAllow: [], region: null };
  }
  const scanned = scanLines(lines, region.startLine);
  return {
    problems: scanned.hits,
    allowHits: scanned.allowUsed.size,
    allowCold: ALLOWLIST.filter((entry) => entry.cold === true).length,
    staleAllow: staleAllowlistIds(scanned.allowUsed),
    region,
  };
}

export async function main(argv = []) {
  if (argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((arg) => !arg.startsWith('--'));
  if (unknown.length > 0) {
    console.error(`[changelog:fail] 无法识别的参数:${unknown.join(' ')}(${USAGE})`);
    return 1;
  }

  let lines;
  try {
    lines = readFileSync(path.join(projectRoot, ...CHANGELOG_REL.split('/')), 'utf8').split('\n');
  } catch (error) {
    // 文件读不到 ⇒ 判红。**这条不能靠「扫不到东西所以恒绿」蒙过去**:扫描面为空是最坏的失效形态
    // (路径写错时若静默按空集通过,门禁从那一刻起什么也没查,而输出是 exit 0)。
    console.error(
      `[changelog:fail] 扫描失败:${error instanceof Error ? error.message : String(error)}`
      + `(CHANGELOG 路径取自本文件顶部的 CHANGELOG_REL;路径写错时 readFileSync 抛 ENOENT —— `
      + '扫描面为空是最坏的失效形态,故此处判红而非跳过)',
    );
    return 1;
  }

  const region = locateEntryRegion(lines);
  const surfaceProblems = auditScanSurface(region);
  if (surfaceProblems.length > 0) {
    for (const item of surfaceProblems) console.error(`[changelog:fail] ${item.message}`);
    return 1;
  }
  const { startLine, versionHeadings, nonEmpty } = /** @type {NonNullable<typeof region>} */ (region);

  const scanned = scanLines(lines, startLine);
  for (const id of staleAllowlistIds(scanned.allowUsed)) {
    console.log(`[info] changelog:白名单条目本次零命中(可能已失效,请复核是否可删):${id}`);
  }

  if (scanned.hits.length > 0) {
    for (const hit of scanned.hits) console.error(`[changelog:fail] ${hit.message}`);
    console.error(
      `[changelog:fail] CHANGELOG 版本条目区口径不合规,共 ${scanned.hits.length} 项`
      + `(条目区自第 ${startLine} 行起 / 非空 ${nonEmpty} 行;${RULES.length} 类判据`
      + `(${RULES.map((rule) => rule.label).join(' / ')});白名单 ${ALLOWLIST.length} 条,`
      + `本次命中 ${scanned.allowUsed.size} 条,按设计零命中 `
      + `${ALLOWLIST.filter((entry) => entry.cold === true).length} 条)`,
    );
    console.error(
      '[changelog:fail] CHANGELOG 只写用户在界面/文档/行为上可观察到的变化,共六类判据:'
      + '①不写内部工程词(门禁 / CI / 覆盖率 / 契约守卫 / 代码地图 / DEV-GUIDE / tsconfig / '
      + 'GitHub Actions / refactor / lint / commit)②不用第二人称叙述(你)'
      + '③不含内部编号(REQ-0NN、commit hash)④不用文言虚词(亦 / 兹 / 遂 / 矣 / 焉 / 兮 / 尔 / 裸「盖」)'
      + '⑤不用装饰性副词(均 / 一概 / 悉 / 俱 / 概 / 无实义限定的「仅」)'
      + '⑥不写载体维护(截图重拍 / 重新拍摄 / 重新截图 / 重新导图 / 示例路径 / 图片格式)。'
      + '若确属误报,请在 gates/repo/check-changelog.mjs 的 ALLOWLIST 加条目并写明依据'
      + '(按内容匹配,勿按行号登记 —— CHANGELOG 每次发版都在改写,行号必然漂移)。',
    );
    return 1;
  }

  console.log(
    `[ok] CHANGELOG 口径扫描通过:条目区自第 ${startLine} 行起(非空 ${nonEmpty} 行 / 版本标题 `
    + `${versionHeadings} 个),${RULES.length} 类判据零命中;白名单 ${ALLOWLIST.length} 条(本次命中 `
    + `${scanned.allowUsed.size} 条,按设计零命中 `
    + `${ALLOWLIST.filter((entry) => entry.cold === true).length} 条)`,
  );
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.join(projectRoot, 'gates', 'repo', 'check-changelog.mjs')) {
  process.exitCode = await main(process.argv.slice(2));
}