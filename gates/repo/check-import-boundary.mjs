// 依赖声明与 import 层向边界自检(无产物、幂等,exit 0/1)。
//
// 用途:三件事都在「构建之前、纯文本层面」判定,不必等 tsc/打包才暴露:
//   1. 传递依赖声明:src 运行时真的 import 的包必须在 dependencies。历史上把
//      jszip 放在 devDependencies、把 mdast/micromark/unified 一族靠别的包的
//      传递依赖偶然就位 —— 一次干净的 `npm ci --omit=dev` 或上游树变动就会在
//      运行时炸掉,而 lockfile 一直看不出问题。本脚本按「源码实际 import」与
//      「package.json 声明」求差集,两个方向都判红。
//   2. type-only import 走独立判定:类型是编译期产物,由 @types/* 或任意已声明
//      包提供即可,不该被「必须进 dependencies」的运行时规则误伤;反过来,只被
//      type-only 引用的包也不构成运行时依赖(仍可在 dependencies 里,只是不再
//      强制)。
//   3. 层向边界:core 是可复用转换核心(不碰宿主、不反向依赖 GUI 两层),
//      renderer 不反向依赖 main,preload 不经上跳引用 main。这是单向依赖的
//      机械断言,替代「靠 code review 记住」的约定。层向规则本身是 deny-list,
//      故另配 allow-list:`src/` 顶层目录必须登记在 SRC_TOP_LAYERS(ADR-060 后果 3),
//      否则新树不命中任何规则、其反向依赖静默放行。
//      另含 core 内部的**目录准入**判据(markdown / image / pipeline / util / i18n 五个
//      子目录):它们钉的是「某条边不存在」而非方向,理由见 LAYER_RULES 里那组规则的注释。
//
// 判定输入是**源码文本**而非类型检查结果:门禁要在 tsc 之前跑,且要在
// 「有人新写了一个 import」的最早时刻就红。正则抽取而非走 TS AST,理由同
// check-ci-contract.mjs(纯 Node,零新增依赖)。
//
// 用法:
//   node gates/repo/check-import-boundary.mjs [--src <dir>] [--package <file>] [--flavor src|dist]
//
//   --src      被扫描的源码子树(默认 src)
//   --package  依赖声明来源(默认 package.json)
//   --flavor   源码形态:src = TS 源(默认);dist = tsc 产物(ESM + CommonJS 混编,
//              type-only 已被编译期擦除,故产物侧一律按运行时判定)
//
// 源码子树(--src)与依赖声明(--package)分开指定:编译产物(dist/)与仓库根的
// package.json 是一对,但两者不同层;合成一个根目录参数会逼着脚本去猜声明在哪。
//
// ---- 本阶段的 pending 机制:每条规则自带标记,而不是一个全局开关 ----
//
// T0 阶段新建的 6 条判据(4 条 core 目录准入 + 2 条层向文本判据)当初一律带 pending: true;
// T2 每转正一条就摘掉一条标记,所以「还剩几条」是变的 —— 要数字去看规则表派生,别手数:
// 它们照常参与扫描与计数,但命中归入 `info` 通道、**不进 `problems`**,故不影响退出码 ——
// 门禁仍 exit 0,同时输出里逐条列出「哪几条 pending 规则当前命中几处」。
// `analyze()` 的 `info` 语义:**只作提示、不参与 exit code 的诊断**(两种来源:
// 未使用的依赖声明,以及 pending 规则的命中)。
//
// 为什么是**逐规则标记**而不是同批 check-src-layout.mjs 那种 `--enforce` 全局开关:
// 全局开关一关就把既有层向规则的 fail-closed 语义一并改掉 —— 那是另一种改动,且与
// 「既有判据本就已生效」在输出上无法区分。ADR-064 的节奏是「T0 只报告 → T2 逐条转判红」,
// 逐条标记让 T2 的进度记录就是**删标记这个动作本身**:可 grep、可 review,
// 「删掉哪一条」与「哪一条从何时开始判红」一一对应,不存在「开关一开全转红」的不可分性。
// T2 核对进度的命令(行锚形态,避开下面对该标记的散文提及):
//   grep -nE '^\s*pending: true,$' gates/repo/check-import-boundary.mjs
//
// ⚠ pending 不是永久豁免:pending 期间它的命中数不参与退出码,若长期命中而没人删标记,
// 这条判据就退化成一次「枚举已知」。故 pending 规则**逐处**打印(可见 ≠ 可忽略):
// 静默放过与漏判在退出码上都表现为 0,只有把命中显式说出来才区分得开。

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, parseArgs } from '../../shared/cli.mjs';
import { lexSource, skipQuoted } from '../../shared/copy-closure.js';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const USAGE =
  '用法: node gates/repo/check-import-boundary.mjs [--src <dir>] [--package <file>] [--flavor src|dist]';

/** 源码形态 → 参与扫描的扩展名与是否抽 require() */
export const FLAVORS = Object.freeze({
  src: { extensions: ['.ts', '.cts'], cjs: false, typeOnlyAware: true },
  dist: { extensions: ['.js', '.cjs'], cjs: true, typeOnlyAware: false },
});

// ---- 规则表(单一来源;诊断文案与判定同处,避免两处漂移)----

/**
 * pending 规则命中在 `info` 里的行前缀(机制见文件头)。
 *
 * 为什么要有可辨识前缀:未使用声明那类 info 行是「事实陈述」,pending 命中是「已知违反、
 * 本阶段放过」—— 两类混在同一通道里时,读者无法从一行字判断它是否参与退出码。
 * 前缀让「哪些行是 pending」在输出上机器可 grep(`grep '^\[info\] boundary:\[pending\]'`),
 * 也让「静默放过」这件事在任何一次 CI 日志里都留得下痕迹。
 */
export const PENDING_PREFIX = '[pending] ';

/**
 * 宿主内建模块:由 Electron 运行时注入,不随包分发,因此只能是 devDependency。
 * 若按「运行时 import 必须在 dependencies」一刀切,主进程全部 import 都会红。
 */
export const HOST_PROVIDED_RUNTIME = Object.freeze({
  electron: '宿主(Electron 运行时)注入,非 node_modules 依赖,只能是 devDependency',
});

/**
 * 「声明了但不经 import 使用」的依赖:以 file:// 直引其产物文件
 * (见 src/main/services/resource-dirs.ts),import 图上看不到。
 * 未列入本表的未使用声明会原样报出。
 */
export const RESOURCE_ONLY_DEPENDENCIES = Object.freeze({
  mermaid: '以 file:// 直引 dist/mermaid.min.js(IIFE 产物),不经 import',
});

/**
 * core 内允许 import node: 内建模块的文件(其余 core 文件一律判红)。
 * 逐个列文件而不是放行「某一组模块」:这五个文件各自因具体原因需要
 * 文件系统/URL 能力,新增一个即代表 core 又漏了宿主依赖面。
 * 书写 .ts 源文件名,匹配时按去扩展名比较(见 stripExtension),使同一份白名单
 * 同时约束 src 源与其编译产物 dist/*.js。
 *
 * 读这份表时请分清两类能力(REF-025 #07 之后):
 * - **真做 IO**:precheck.ts(node:fs 存在性/realpath)、katex-css.ts(node:path 拼装 +
 *   读取经注入,已不含 node:fs);
 * - **纯字符串运算**:image.ts(node:url 转 file://)、merge.ts(node:path)、
 *   image-path-policy.ts(node:path 的 resolve/relative/isAbsolute/sep/win32/posix)。
 *   后者一个字节磁盘都不碰。image-path-policy.ts 的 node:path 是**刻意保留**的 ——
 *   其中 path.relative 与 path.win32/posix 是符号链接逃逸判定(ADR-012)的承重逻辑,
 *   自己实现一份就是制造安全漏洞,故宁可留白名单也不摘。
 */
export const CORE_NODE_BUILTIN_FILES = Object.freeze([
  'core/pipeline/precheck.ts',
  'core/pdf/katex-css.ts',
  'core/pdf/rules/image.ts',
  'core/pipeline/merge.ts',
  'core/image/image-path-policy.ts',
]);

/**
 * 层向规则。scope 匹配相对路径;forbid 语义:
 *   bare:<包名>     —— 该 bare specifier 不得出现在此范围内
 *   layer:<层,层>   —— 不得 import 解析后落在这些层下的模块。`..` 是可取值:
 *                      向上逃逸的相对说明符归一化后首段恒为 `..`(见 ruleHits 的注释)
 *   prefix:<前缀>   —— 不得使用以此前缀开头的相对 specifier
 */
export const LAYER_RULES = Object.freeze([
  {
    id: 'core-no-host',
    scope: 'core',
    forbid: 'bare:electron',
    reason: 'core 是与宿主无关的可复用转换核心,不得依赖 Electron 宿主',
  },
  {
    id: 'convert-no-gui',
    scope: 'convert',
    forbid: 'layer:main,renderer',
    reason: 'convert 是 headless 装配层(ADR-060):GUI/CLI/MCP/库四个交付面共用同一套装配,'
      + '消费面一律在它之上;它一旦反向依赖 GUI 两层,装配层就长出宿主的形状,'
      + '各交付面不得不逐个绕开自己的宿主代码',
  },
  {
    id: 'convert-no-host',
    scope: 'convert',
    forbid: 'bare:electron',
    // 为什么不给 convert 单开一条 scope、也不复用 headless-faces:
    // ① 复用 headless-faces 会让本条在 cli/mcp 上与既有 faces-no-host **同判据同目标**
    //    重复报红 —— 同一事实两条规则各有一个 id 可改,正是本文件多处批过的「两份可漂移的副本」。
    //    合并两表的唯一收益(规则表少一行)远小于两份诊断与两份 id 的漂移代价。
    // ② scope 用既有的字面 `convert`:它已在 SRC_TOP_LAYERS 里(ADR-060 后果 3 的预登记),
    //    且 convert-no-gui 用的就是同一个 scope —— 同一棵树的两条纪律共用一个 scope 名,
    //    「convert 上有哪些规则」因此可在一处读完,不必跨两张表拼。
    // ③ 命名与 core-no-host 逐字同形(`<层>-no-host`):两个「与宿主无关」的层用同一个 id 词根。
    // reason 与 faces-no-host 分开写而非共用一个字符串:装配层与交付面的违规后果不同 ——
    // cli/mcp 引 electron 会把宿主拖进**进程外**的可执行面(生产安装根本没有 electron),
    // 而 convert 引 electron 会让**共用装配单元**长出 GUI 的形状,四个交付面都得逐个绕开。
    reason: 'convert 是 headless 装配层(ADR-060),四个交付面共用同一套装配:它一旦 import electron,'
      + 'GUI 就从「一个可选的交付面」变成装配单元的硬依赖,库模式与 MCP 各自的无宿主进程将被迫带着宿主一起装',
  },
  {
    id: 'convert-no-outside-src',
    scope: 'convert',
    // 用 layer:.. 而非 prefix:../../(与 faces-no-outside-src 的选择不同,理由必须写清):
    // 逃出 src/ 的**语义**是「归一化后落在 src/ 之外」,而 prefix:../../ 表达的是
    // 「specifier 字面以 ../../ 开头」—— 两者只在 convert 是**扁平单层目录**时等价。
    // 实测 src/convert/ 现无子目录(唯一子目录就是它自己),故 prefix: 此刻也对;
    // 但 convert 是仍在长的层(ADR-060 后果 5 点名 run.ts / context.ts 尚待落地),
    // 一旦长出 convert/<子目录>/,那里的 `../../core/x` 是**合法**的(落在 src/core/),
    // prefix: 形态会把它判红 —— 一个随目录生长而误报的判据是负资产。
    // layer: 形态按解析结果判,深度无关,故此条用 layer:..(见 LAYER_RULES 表头的 forbid 语义)。
    // faces-no-outside-src / smoke-no-outside-src 原是同一纪律的 prefix: 写法(那两面的目录
    // 当时是扁平的,故 prefix: 恰好等价);ADR-064 已把那两条也换成 layer:..,三条现已同形态。
    forbid: 'layer:..',
    reason: 'convert 的编译产物随 dist/** 分发(build.files 只收 dist/**),凡解析后落在 src/ 之外的相对依赖'
      + '都已指向包外路径,解包后必然跑不起来;node_modules 资源的位置经入参传进来(ADR-060 后果 4),'
      + '不得由本层按目录层级反推',
  },
  {
    id: 'core-no-upward',
    scope: 'core',
    forbid: 'layer:main,renderer',
    reason: 'core 不得反向依赖 GUI 两层(依赖方向单向:core ← main ← renderer)',
  },
  {
    id: 'renderer-no-main',
    scope: 'renderer',
    forbid: 'layer:main',
    reason: 'renderer 不得直接引用主进程模块,跨界只经 preload 暴露的 contextBridge API',
  },
  {
    id: 'preload-no-main',
    scope: 'preload',
    forbid: 'prefix:../main',
    reason: 'preload 运行在沙箱 renderer 侧,不经上跳引用 main 进程模块',
  },
  {
    id: 'main-no-renderer',
    scope: 'main',
    forbid: 'layer:renderer',
    reason: 'main 是 GUI 的宿主而非被依赖方,不得反向引用 renderer 内部模块(依赖方向单向 core ← main ← renderer;跨界只经 preload 暴露的 contextBridge API)',
  },
  // 下面三条是 cli 与 mcp **共用**的交付面纪律:两者是 ADR-060 定的同层 adapter,
  // 边界约束逐字相同。scope 用跨两面的 delivery-faces 形态(见 scopeMatches)而不是
  // 「每个面各写三条」—— 后者会让同一语义有两处可漂移的副本,且新增交付面时
  // 规则条数要翻倍(deny-list 逐条枚举的代价)。
  {
    id: 'faces-no-renderer',
    scope: 'delivery-faces',
    forbid: 'layer:renderer',
    reason: 'cli/mcp 是进程外的两个交付面(ADR-060 的同层 adapter):renderer 是 GUI 面,它们引它会让纯 node 侧把 Electron 一起拖进来',
  },
  {
    id: 'faces-no-host',
    scope: 'delivery-faces',
    forbid: 'bare:electron',
    reason: 'cli/mcp 跑在纯 node 下,import electron 会把 Electron 宿主拖进它的依赖图(且 electron 只是 devDependency,' +
      '生产安装根本没有)。需要宿主能力时由该面用子进程重入 Electron(见 main/cli-pdf-host.ts),不是 import 它',
  },
  {
    id: 'faces-no-outside-src',
    scope: 'delivery-faces',
    // 用 layer:.. 而非 prefix:../../(与 convert-no-outside-src 同一选择,理由见那里的注释):
    // 「逃出 src/」的语义是「解析后落在 src/ 之外」,而 prefix:../../ 表达的是「说明符字面以
    // ../../ 开头」—— 两者只在 cli/mcp 是**扁平单层目录**时等价(实测 src/cli 与 src/mcp
    // 现无子目录,故两种写法此刻同判)。两面一旦长出子目录,那里的 `../../core/x` 解析后落在
    // src/core/、是**合法**的,prefix: 会把它判红 —— 一个随目录生长而误报的判据是负资产。
    // layer: 按解析结果判、与文件深度无关。故本条已从 prefix: 换成 layer:(ADR-064 结清
    // 这笔预登记债);此前注释里「本轮刻意不改 / 应把那条也换成 layer:..」的后续项已了结。
    forbid: 'layer:..',
    reason: 'cli/mcp 的编译产物随 dist/** 分发(build.files 只收 dist/**),凡 ../../ 开头的相对依赖都已指向包外路径,' +
      '解包后必然跑不起来。与 smoke-no-outside-src 同一纪律:不得引用仓库相对路径、test/ 等不入包路径',
  },
  {
    id: 'smoke-no-outside-src',
    scope: 'smoke',
    // 用 layer:.. 而非 prefix:../../(理由同 faces-no-outside-src 与 convert-no-outside-src):
    // 本规则的意图是「不得逃出 src/」,即按**解析结果**判。prefix:../../ 表达的是「说明符字面
    // 以 ../../ 开头」,两者只在 smoke 是扁平单层文件时等价;smoke 一旦搬进子目录
    // (dist/main/ 之下),那里合法的 `../../core/x` 会被 prefix: 误报。
    // resolveLayer 不锚定 src 根、只做「相对文件目录拼接 + 取首段」,故向上逃逸的说明符
    // 归一化后首段恒为 `..` —— `layer:..` 恰好表达「解析后落在扫描根之外」,且与深度无关。
    // 本条已从 prefix: 换成 layer:(ADR-064 结清这笔预登记债)。
    forbid: 'layer:..',
    reason: '冒烟须能在打包产物里运行(build.files 只收 dist/**),smoke 不得逃出 src/(即不得引用仓库相对路径、test/ 等不入包路径);test 侧只做薄转调',
  },
  {
    id: 'renderer-foundation-no-feature-dep',
    scope: 'renderer-foundation',
    // 分层口径(REF-025 #13):renderer 内部**不**整体分层 —— 实测 convert / settings /
    // ui / wizard 四个功能目录两两互依(5 对双向、共 29 条目录边),它们是平铺协作的
    // peer 模块,对它们断言「方向」会一加就红。故只约束**基础层**:元素映射(dom/)与
    // 纯函数核+store(state/)。实测这两层在全部 29 条边中**无任何出边**,即它们是叶子,
    // 任何功能模块都依赖它们、它们不依赖任何功能目录 —— 这条是真不变量,机械可判。
    // 它守住的是两条语义:pure.ts「零 DOM 依赖」与 refs.ts「无业务知识」;一旦反向
    // 依赖,这两条不变量就名存实亡(比如 refs 里塞进设置项判断)。
    forbid: 'prefix:../convert/,../settings/,../ui/,../wizard/',
    reason: 'renderer 基础层(dom/ 元素映射、state/ 纯函数核与 store)是所有功能模块的共同底座,不得反向依赖任何功能目录;唯一合法的向上引用是 ../../core/(跨进程契约单源)',
  },
  {
    id: 'core-pdf-no-fs',
    scope: 'core-pdf',
    // 只禁 node:fs / node:fs/promises 这两个真做 IO 的内建;node:path 与 node:url
    // 在 core/pdf 里是纯字符串运算(file:// 拼装、字体路径绝对化),继续按
    // CORE_NODE_BUILTIN_FILES 的既有口径放行。
    forbid: 'builtin:node:fs,node:fs/promises',
    reason: 'core 的 pdf 渲染路径不做文件 IO:其两次读(图片路径边界的 realpathSync、'
      + 'KaTeX CSS 读取)经 RenderPdfHtmlOptions.fs 由 main 注入(REF-025 #07),'
      + '故 core/pdf/** 不得直接 import node:fs',
  },
  // 下面四条是 core 的**目录准入**判据(ADR-064)。它们与上面那些层向规则的性质不同,
  // 故在此成组登记并共用一段理由 —— 那段理由是这组判据的成立前提,逐条抄一遍必然漂移:
  //
  // **为什么只钉「某条边不存在」而不钉方向**:实测 core/ 内部 9 个子目录的运行期依赖图
  // 几乎是一片 DAG(docx 与 pdf 之间唯一一条边是 type-only,image/text/style/settings 是
  // 叶子),唯一的运行期环是 markdown ⇄ pipeline,且成因是**一个文件放错目录**
  // (ai-cleanup 是「解析之后的变换」,却住在 markdown/ 里)。既然图本身近乎无环,
  // 「A 不得依赖 B」这种方向规则就为它并不存在的病开药 —— 每一加就红。对照 renderer/:
  // 那边实测 5 对双向、47 条 feature 间边,所以那边才只能约束基础层(renderer-foundation)。
  // 故这四条一律写成「这一条边**不存在**」:判据对象是**边是否存在**,不是边指向何处。
  //
  // 目录级边界为什么必须用 prefix: 形态:resolveLayer 只返回**顶层**目录名,core 内部的
  // 目录级边界在 layer: 形态下与 core 自身的层不可区分(见 ruleHits 的 prefix: 注释)。
  //
  // 本组四条里当前仍带 `pending: true` 的那些(见文件头的 pending 机制):本阶段只报告、不判红,
  // T2 搬完文件后**逐条删掉该标记**即转 fail-closed —— 删标记这个动作就是 T2 的进度记录。
  {
    id: 'core-markdown-no-pipeline',
    scope: 'core-markdown',
    forbid: 'prefix:../pipeline/',
    pending: true,
    reason: 'core/markdown/ 只放 markdown 语义原语(slug / cross-ref / comment / 表格宽度 / '
      + 'source-ranges 等),「解析之后」的那一步归 pipeline/。两者的唯一反向边是 '
      + 'markdown/ai-cleanup.ts 对 pipeline/{frontmatter,parse} 的 2 条 import —— 它是'
      + '解析之后的变换却住在 markdown/ 里,是 core 内唯一的运行期环;这条边不该存在,'
      + '而不是「该换个方向」',
  },
  // 本条**不带** pending(ADR-064 T2 步 2 转正):T2 把图片请求级守卫从 core/cancel.ts
  // 搬进 core/image/request-guard.ts,转正前实测 src 与 dist 双侧零命中。新搬入的文件
  // 只新增 ../cancel.js(取消原语)与 ../resource-limits.js(预算取值)两条边,加上同目录
  // 的 ./image-resolver.js(纯类型)—— 三条都不落在本条禁的三个前缀里。故它与
  // core-text-no-core 同属「建时即绿、已完全生效」那一类,不是「已知违反、待搬迁后转判红」。
  {
    id: 'core-image-no-markdown',
    scope: 'core-image',
    forbid: 'prefix:../markdown/,../docx/,../pdf/',
    reason: 'core/image/ 是图片这一份职责的归并处(解析、类型嗅探、尺寸、路径策略),'
      + '它对 markdown / docx / pdf 三条边都不该存在:图片处理不依赖 markdown 语义、'
      + '也不属于任何一条渲染管线。实测现无这三条边,故钉住的是**准入**而非现状描述',
  },
  {
    id: 'core-pipeline-no-render',
    scope: 'core-pipeline',
    forbid: 'prefix:../docx/,../pdf/',
    pending: true,
    reason: 'core/pipeline/ 是解析与预检层,渲染由 docx / pdf 两条管线各自承担;'
      + '解析层一旦引渲染层,「先解析后渲染」的单向次序就被倒过来,两条管线的共用地形'
      + '会开始携带某一管线的形状。实测 pipeline 对 markdown / util / image 的边是设计意图,'
      + '唯独对 docx / pdf 两条边不存在',
  },
  {
    id: 'core-text-no-core',
    scope: 'core-text',
    // T2 步 1 已把 util/ 落成 text/,规则名与 scope 随之改掉 —— 规则名指向一个
    // 不存在的目录就是代码里的假话。本条**不带** pending: 它建时即绿(T2 前后都绿),
    // 属于「已完全生效」的判据,不是那些「已知违反、待搬迁后转判红」的。
    allowTypeOnly: true,
    forbid: 'prefix:../',
    reason: 'core/text/ 放的是与业务无关的文本与错误处理原语(编码探测、HTML 实体、'
      + 'Error 归一),对 core 内其他目录的**值**依赖一条都不该有:原语一旦知道业务知识,'
      + '它就再也不能被任何目录放心复用。type-only 边豁免(allowTypeOnly)—— 类型是'
      + '编译期产物,实测 util/mdast-utils.ts 对 markdown/comment.js 的那条边正是 import type,'
      + '运行期零依赖,豁免它不等于放过一条运行期边',
  },
]);

// ---- 层向治理的 allow-list:src/ 顶层目录必须已登记(ADR-060 后果 3)----

/**
 * `src/` 顶层目录的 **allow-list**:登记 = 「这一层已被某条 LAYER_RULES 的 scope 覆盖」。
 *
 * 为什么必须是 allow-list:LAYER_RULES 是 deny-list,而 scopeMatches 的兜底是
 * `file === scope || file.startsWith(scope + '/')` —— scope 只认表里写过的名字,
 * 新建的顶层目录不命中**任何**规则,`resolveLayer` 算出的层名也无人比对,
 * 于是新树的全部反向依赖静默放行、门禁全绿(本仓在 TREE_RULES 的注释里批过这一形态:
 * deny-list 要逐个枚举,新增目标不在枚举内就退化成一次「枚举已知」)。
 * allow-list 让未登记的新顶层目录默认非法,不依赖任何人记得补规则。
 *
 * 与 TREE_DIRS 的分工:TREE_DIRS 管的是**仓根四棵树**(gates/test/shared/tools)并带
 * 逻辑名 → 实际目录名的映射;本表管的是 `src/` 内各层,名字即目录名,故不经映射。
 *
 * 登记 ≠ 给它留个空位:登记一个没有任何规则 scope 命中的名字,等于把上面那个洞
 * 原样留在该名字上。故表内每个名字都必须已被某条规则的 scope 命中 ——
 * `convert` 由 convert-no-gui 覆盖,`cli` 与 `mcp` 由同一个跨面 scope
 * (delivery-faces)覆盖,树落地当天即受治理。
 */
export const SRC_TOP_LAYERS = Object.freeze(['cli', 'convert', 'core', 'main', 'mcp', 'renderer']);

/**
 * 找出未登记的 src/ 顶层目录名(判据的纯函数本体,便于自检与测试直接消费)。
 * @param {readonly string[]} actualDirs src 顶层的目录名(文件不在其列)
 * @returns {string[]} 未登记的目录名(已排序);空数组 = 全部已登记
 */
export function findUnregisteredSrcLayers(actualDirs) {
  return actualDirs.filter((name) => !SRC_TOP_LAYERS.includes(name)).sort();
}

/**
 * 层向 allow-list 的判定:读 src/ 顶层,未登记的目录名一律判红。
 *
 * 只数**目录**:`src/.gitkeep` 之类文件不是一层,计入即恒红。
 * src/ 不存在时返回空(跳过而非判红):本仓 src/ 常驻,而沙盒调用只铺局部
 * (判据锚在真实仓库的理由见 ROOT_COMPUTE_SCAN_DIRS 与 TREE_RULES 的注释)。
 * @param {string} srcDir src 目录绝对路径
 * @returns {string[]} 判红文案(空数组 = 通过)
 */
export function analyzeSrcTopLayers(srcDir) {
  if (!existsSync(srcDir)) return [];
  const dirs = readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return findUnregisteredSrcLayers(dirs).map(
    (name) => `src/ 顶层目录「${name}/」未登记在 SRC_TOP_LAYERS(${SRC_TOP_LAYERS.join('/')})`
      + ' —— 层向规则按 scope 枚举,未登记的目录不命中任何规则,它的反向依赖将静默放行',
  );
}

// ---- 层向的文本判据:不是「import 了什么」而是「文件里出现了什么」----

/**
 * Windows 专属环境变量:只由 Windows 设置,macOS / Linux 上恒为 `undefined`。
 *
 * 为什么逐个列而不用「凡含 WIN/…」的模糊式:跨平台程序读它们不会抛错,只会静默拿到
 * `undefined` 并走进一条看起来能跑、实则路径全错的分支 —— 这是最贵的一种错。
 * 每项的跨平台对应物都存在(`HOME` / `XDG_*` / `os.homedir()` / `os.tmpdir()`),
 * 故新层读它们没有任何正当理由。
 *
 * 已知边界(勿当漏洞读,当已知限制读):本清单**按字面大小写匹配**,而 Windows 上
 * `process.env` 本身大小写不敏感,故 `process.env.appdata` 是已知绕过面。
 * 补它是靠改成大小写不敏感的正则 —— 那会连带命中 `SystemRoot` 之类词在注释外的
 * 普通用法,误伤面大于收益。要收口这个洞,正解是给新层注入路径入参(ADR-060 的
 * 四个注入点),不是加一条正则。
 */
export const WINDOWS_ONLY_ENV_VARS = Object.freeze([
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'COMSPEC',
  'PATHEXT',
  'HOMEDRIVE',
  'HOMEPATH',
]);

/**
 * Windows 专属可执行文件:只随 Windows 发行,macOS / Linux 上 `spawn` 必得 ENOENT。
 *
 * 逐项都是**无歧义的 Windows 系统程序名**。清单刻意不含 `where` / `attrib` /
 * `reg` / `net` 这类与普通英文词同形的名字 —— 判据只认「子进程首参」一种形态,
 * 误伤面已经压到最小,不值得为多覆盖两个名字把它放大(多写一条豁免表的代价见
 * `ROOT_COMPUTE_SCAN_DIRS` 上方那段)。注册表与 `cmd /c` 组合技已由 `cmd` 覆盖。
 */
export const WINDOWS_ONLY_EXECUTABLES = Object.freeze([
  'cmd',
  'powershell',
  'pwsh',
  'taskkill',
  'wmic',
  'xcopy',
  'robocopy',
  'icacls',
]);

/** 正则元字符转义(清单是单一来源,正则由清单派生,故清单里不能出现元字符) */
function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 环境变量清单 → 整词正则(大小写敏感,理由见 WINDOWS_ONLY_ENV_VARS 的已知边界) */
const WINDOWS_ENV_VAR_RE = new RegExp(
  `\\b(?:${WINDOWS_ONLY_ENV_VARS.map(escapeRegExp).join('|')})\\b`,
  'g',
);

/**
 * 可执行文件清单 → 「子进程首参为它」的形态正则。
 *
 * 只认这一种形态(而不是裸词):`"cmd"` 出现在任何字符串里都不必然是子进程目标,
 * 而 `spawnSync("cmd.exe", …)` 是。收窄到调用形态换来的是零误伤。
 * `.exe` 后缀可选:Windows 上 `spawn` 两种写法都解析到同一个程序。
 */
const WINDOWS_EXE_SPAWN_RE = new RegExp(
  '\\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec)\\s*\\(\\s*[\'"]'
  + `(?:${WINDOWS_ONLY_EXECUTABLES.map(escapeRegExp).join('|')})(?:\\.exe)?['"]`,
  'g',
);

/**
 * 层向的**文本判据**表。scope 匹配相对路径;patterns 逐条按源码文本判定(判据输入
 * 是抹掉注释之后的代码,与 import 无关 —— 故与 LAYER_RULES 分表,不混在一起:
 * 同一张表里放两种判据形态会产生读法歧义,同 TREE_RULES 与 LAYER_RULES 分表的理由)。
 *
 * 两条都只作用于 `headless-faces`(convert + cli + mcp,即 ADR-060 的「新层」):
 * 判的是**新层不得长出宿主与平台的形状**,而 core / main / renderer 各自的纪律
 * 由既有规则管(尤其 `core/image/image-path-policy.ts` 的 `path.win32/posix`
 * 是符号链接逃逸判定(ADR-012)的承重逻辑,见 CORE_NODE_BUILTIN_FILES 的注释 ——
 * 那类「为判定 Windows 形态而调用 Windows 语义」的正当用法在新层不存在,
 * 但在 core 存在,这也是本表按层而不是按全仓施加的原因)。
 *
 * **可选字段 `exceptFiles`**:逐文件豁免(去扩展名比较,故 .ts 源与 .js 产物同一份写法)。
 * 为什么需要它:本表其余规则的 scope 是「一层职责类别」,判据对整个 scope 一律成立;
 * 但 core/i18n/ 里 DOM 的使用面被刻意收在 dom.ts 一个文件里(ADR-064:core 内唯一碰
 * DOM 的文件),判据若按 scope 一刀切,就会把「唯一该碰 DOM 的文件」也判红 —— 规则与它
 * 要保护的不变量直接冲突。不开这个字段只有两条路:把 scope 缩到只剩 dom.ts(判据归零,
 * 等于没有规则),或整条豁免 core/i18n/(同一条路的粗放版)。豁免是**逐文件**的、且必须
 * 逐个列出:「除某文件外一律成立」一旦写成「某一类除外」,登记缺失就退化成静默放行。
 *
 * **可选字段 `pending`**(语义见文件头的 pending 机制):`pending: true` 的规则命中后归入
 * `info`、不进 `problems`,本阶段只报告不判红;T2 搬完文件后逐条删掉该标记即转 fail-closed。
 * 表内带标记的是 `core-i18n-dom-only`、`main-windows-no-up` 与 `core-no-duplicate-export`
 * 三条;`headless-*` 两条不带(它们建起即判红,那才是这批判据的常态形态)。
 * 哪几条带标记**不在此手数** —— 以文件头那条 grep 命令为准(转正一条即自动少一条)。
 */
export const LAYER_TEXT_RULES = Object.freeze([
  {
    id: 'headless-no-app-getpath',
    scope: 'headless-faces',
    patterns: Object.freeze([
      {
        id: 'app-getpath-call',
        label: '调用 Electron app 的路径解析',
        // getAppPath 一并收:它与 getPath 同为「向宿主问路径」,只禁其一会留一个
        // 同义绕过口(与 ROOT_COMPUTE_PATTERNS 覆盖 3/4 是同一理由)。
        re: /\bapp\s*\.\s*get(?:App)?Path\s*\(/g,
      },
      {
        id: 'app-getpath-destructure',
        label: '从 app 解构路径解析函数',
        re: /\b(?:const|let|var)\s*\{[^}]*\bgetPath\b[^}]*\}\s*=\s*app\b/g,
      },
    ]),
    reason: '新层(convert/cli/mcp)是四个交付面共用的 headless 装配层,不得向 Electron 宿主问路径:'
      + 'app.getPath 是 Electron 注入的能力,一调就等于把 Electron 拖进它的依赖图,'
      + '且各面的路径来源本就不同(GUI 走 userData,CLI/MCP 由入参与 flag 决定)。'
      + '需要目录就作为入参接进来(ADR-060 的四个注入点)',
  },
  {
    id: 'headless-no-windows-only',
    scope: 'headless-faces',
    patterns: Object.freeze([
      {
        id: 'windows-env-var',
        label: '读 Windows 专属环境变量',
        re: WINDOWS_ENV_VAR_RE,
      },
      {
        id: 'windows-exe-spawn',
        label: '以 Windows 专属可执行文件为子进程',
        re: WINDOWS_EXE_SPAWN_RE,
      },
    ]),
    reason: '新层保留跨平台期权(ADR-060 第 9 条):读 Windows 专属环境变量在 macOS/Linux 上恒为 undefined,'
      + '以 Windows 专属可执行文件为子进程在 macOS/Linux 上必得 ENOENT,两者都不会抛错地退化、'
      + '只在别的平台上静默走到错分支;两者的跨平台对应物都现成(os.homedir / os.tmpdir / '
      + 'node:child_process 跑平台都有的程序),故新层引入它们零成本地放弃跨平台',
  },
  // 本条**不带** pending(ADR-064 T2 步 5 转正):DOM 面从原 201 行的 `core/i18n.ts`
  // 桶里拆进 `core/i18n/dom.ts` 之后,除 dom.ts 外的 core/i18n/** 零命中。
  // 转正前实测 src 与 dist 双侧各 0 处(见规则上方 exceptFiles 的登记:dom.ts 是唯一
  // 允许出现 document/window 的文件)。它与 core-text-no-core 同属「建时即绿、已完全
  // 生效」那一类 —— T2 步 5 之前它带 pending 且实测命中 9 处(全在桶的 applyStaticTexts)。
  {
    id: 'core-i18n-dom-only',
    scope: 'core-i18n',
    exceptFiles: Object.freeze(['core/i18n/dom.ts']),
    patterns: Object.freeze([
      {
        id: 'dom-access',
        label: '触碰宿主 DOM',
        // 只认「取到 DOM 对象」与「在宿主树上查元素」两种形态:`document` / `window` 后面
        // 跟成员访问,或直接出现 querySelectorAll。像 `typeof document === "undefined"`
        // 这种**只读全局判存在**的写法不属本判据 —— 它恰是「本模块可能被 main 进程 import
        // 而不触碰 DOM」的守卫写法(core/i18n/dom.ts 里有一处),判红它等于逼人删掉守卫。
        //
        // querySelectorAll 只认词形、不要求紧跟 `(`:src 侧它带泛型实参(`querySelectorAll<T>(`),
        // dist 侧泛型已被编译期擦除(`querySelectorAll(`)。若要求紧跟左括号,同一条违例在两侧
        // 的命中数会不一样(实测 5 vs 9)—— 一条判据在 src / dist 两侧报出不同的数量,读者
        // 无从判断哪边对。同一行报两次(document. 一次、querySelectorAll 一次)是有意的:
        // 诊断点名的是**构造**而非行数,两条构造各自可读。
        re: /\b(?:document|window)\s*\.\s*|\bquerySelectorAll\b/g,
      },
    ]),
    reason: 'core/i18n/ 是与宿主无关的文案层:翻译表、语言状态、警告构造器三项都与 DOM 无关,'
      + '只有 dom.ts 一个文件持有「把文案刷到宿主树上」这一份职责。DOM 一旦散进 t.ts / '
      + 'index.ts / warning.ts,该层就被绑死在「只能在 renderer 里跑」上 —— 而 60 个消费方里'
      + '有 main 进程那些(main import 本模块不触碰 DOM)。判据只钉「使用面存在且唯一」,'
      + '不钉方向:core 内部依赖图实测近乎无环,方向规则会为它并不存在的病开药',
  },
  // ADR-064 为「桶溶进目录」那一步立的第二道判据。**建时即绿**:实测 src 与 dist 双侧
  // 0 命中(下方两个 pattern 在真实 dom.ts 上都判绿,见 selfCheck 的正反对照夹具)。
  //
  // 它守的正是那次拆分最易静默失效的点:把语言状态(currentLanguage / setLanguage 的
  // 状态)顺手从 t.ts 带一个 export 到 dom.ts,等于给 core/i18n 开了一条绕过「只用面」
  // 纪律的后门 —— dom.ts 是 core 内唯一碰 DOM 的文件,任何可变绑定从它出去,
  // 「DOM 面只写不持有状态」这条不变量就名存实亡。t.ts 侧已经先不犯(它的 current 是
  // 私有 let,只导出读它的 currentLanguage() 函数),本条把同一纪律钉在 dom.ts 上。
  {
    id: 'i18n-dom-no-export-let',
    // scope 精确到**一个文件**(dom.ts)。不用 `core-i18n` + exceptFiles 反向豁免:
    // 那种写法要求「除 dom.ts 外一律成立」,新增文件时默认落在规则内 —— 而本条要判的
    // 恰恰只对 dom.ts 成立。scopeMatches 里按去扩展名比较,故 src 的 .ts 源与 dist 的
    // .js 产物是同一份登记(同 core-i18n 的先例)。
    scope: 'i18n-dom',
    // 本条**不带** pending:建时即绿。转正前实测 src 侧 `core/i18n/dom.ts` 真实全貌
    // 0 处、dist 侧 `.js` 形态 0 处;selfCheck 的四个夹具(两条判红 / 两条判绿)证明
    // 两个 pattern 各自有牙齿 —— 去掉任一条,对应夹具立刻变红。
    patterns: Object.freeze([
      {
        id: 'export-let-or-var',
        label: '导出可变声明(let/var)',
        re: /\bexport\s+(?:let|var)\b/g,
      },
      {
        id: 'export-binding-clause',
        label: '出现 export { … } 再导出子句',
        // 这一条**不**去判「子句里的名字是否可变」—— 那要跨语句解析绑定到它的
        // `let`/`var` 声明,属跨语句符号追踪(同 ADR-064 :236 登记为超出本仓门禁
        // 架构能力的那一类)。改用一条**等价且可机械判定**的收口:本目录的唯一公开桶是
        // index.ts,再导出全部由它承担,所以 dom.ts 里任何 `export { … }` 子句要么是
        // 冗余的,要么正是「把语言状态连带 export 出去」那个失效形态。
        // 合法内容不受影响:`export function applyStaticTexts` 不匹配任何一条。
        re: /\bexport\s*\{[^}]*\}/g,
      },
    ]),
    reason: 'core/i18n/dom.ts 是 core 内唯一持有宿主 DOM 的文件,它的职责是「把文案写到树上」,'
      + '不持有任何状态、更不把状态交出去。它不得 export 可变绑定:那会让语言状态经由'
      + '唯一碰 DOM 的文件流出去,「DOM 面只写不持有」这条不变量随即失守,而这类改动在'
      + '桶溶进目录的拆分里极易顺手发生(把 t.ts 的状态变量一起搬过来并带上 export)',
  },
  {
    id: 'main-windows-no-up',
    scope: 'main-windows',
    pending: true,
    patterns: Object.freeze([
      {
        id: 'up-to-menu',
        label: '上跳引用菜单模块',
        // 只认 `../menu.js` 这一条说明符前缀,不做更宽的上跳:main/windows/ 对 main 其余
        // 目录(services / persist / ipc / converter)的边是正常调用,唯独 menu 是**反向**边
        // —— 菜单定位窗口,窗口不该反过来知道菜单(ADR-064 把 about 窗从 menu 移进 windows/
        // 正是为了让这条边单向)。故只钉这一条,不是「不得上跳」。
        re: /from\s+['"]\.\.\/menu\.js['"]/g,
      },
    ]),
    reason: 'main/windows/ 是窗口的持有方,菜单是它的调用方;反过来知道菜单,窗口就与「有哪些菜单项」'
      + '这件 GUI 决策绑死(改菜单结构要动窗口)。与本表其余规则同一性质:钉的是这条边不存在,'
      + '不是「windows 该往哪依赖」—— main/windows/ 对 services / persist / converter 的边是正常的',
  },
  // ADR-064 判据表的 `core-no-duplicate-export`。**本条仍带 `pending: true`,不转正** ——
  // 建它的动机是删掉 `main/ipc/types.ts`(5 行纯 `export type` 转出),但删掉它之后
  // 实测仍有 3 处同形状的转出(见下方实测),故它是「已知违反、待清理」而非「建时即绿」。
  // 登记为真实违反的 3 处(T2 步 4 实测,src 侧):
  //   main/converter/merge.ts:14  export type { ConvertResult } from "../../core/ipc-contract.js"
  //   main/persist/settings.ts:63 export { DEFAULT_SETTINGS, type AppSettings } from "../../core/settings/settings-defaults.js"
  //   main/persist/settings.ts:66 export type { ExportPresetsResult, ... } from "../../core/ipc-contract.js"
  // 三处的源头均已逐个核实确在 core 声明(ConvertResult / ExportPresetsResult /
  // ImportDocxTemplateResult / AppSettings),故它们与 types.ts 是同一形状的转出。
  // ADR-064 :232 写的「白名单在 main/ipc/types.ts 删除后为空」与实测不符,按实测记。
  {
    id: 'core-no-duplicate-export',
    scope: 'outside-core',
    // 白名单为空:本条不带 `exceptFiles`。将来若确有正当的转出(例如某交付面为兼容
    // 而 re-export 一份),按 `exceptFiles` 逐文件登记并写明理由 ——「某一类除外」写成
    // 登记缺失即静默放行,故不许有粗放形态。
    pending: true,
    patterns: Object.freeze([
      {
        id: 'reexport-core-type',
        label: '把 core 契约的 type 转出给第二个文件',
        // 只认两种形态,因为只有这两种能**逐字**判出「转的是 type」:
        //   ① `export type { … } from "…/core/…"` —— type 说明符紧跟 export;
        //   ② `export { …, type X, … } from "…/core/…"` —— 花括号内带 `type` 修饰符。
        // 刻意**不**覆盖两种形态(它们都是已知边界,不是遗漏):
        //   - `export { 值 } from ".../core/…"`(不带 type 修饰符,如 renderer/state/pure.ts
        //     转出 core/text 的 errorMessage 函数):判据的对象是「core 契约的 type」,
        //     值转出不是它,放开是定义使然而非漏判。
        //   - `export * from ".../core/…"`:实测全树 0 处。补它需要一份「哪些符号是 type」
        //     的跨文件事实,超出本门禁的数据模型(同 ADR-064 :236 登记的已知边界)。
        // 说明符只认含 `/core/` 段的那一种:从 src/ 内任一相对位置走到 core/ 必然经过该段,
        // 故它与文件深度无关;`/core/` 的两侧斜杠同时排掉 `score/`、`corefoo/` 这类同形词。
        re: /\bexport\s+(?:type\s*\{[^}]*\}|\{[^}]*\btype\s+[A-Za-z_$][\w$]*[^}]*\})\s*from\s*['"][^'"]*\/core\/[^'"]*['"]/g,
      },
    ]),
    reason: 'core 契约(如 core/ipc-contract.ts 的 ConvertResult、core/settings/settings-defaults.ts 的 '
      + 'AppSettings)是跨进程数据形状的单源,同名概念在 src 内只允许存在一份(ADR-064 的立论)。'
      + '第二个文件把它 `export type` 出去,消费方就能从那个文件取到同一个类型 —— 于是「声明处」'
      + '与「取用处」不再同名同路径,契约改名或搬家时必然漏改一半,类型系统也拦不住(两处声明都合法)。'
      + 'scope 只覆盖 core 之外:core 内部的文件互相转出(如 settings-defaults 转 typography 的类型)'
      + '是该层对外 API 面的正常聚合,判它会把「聚合」与「复制」混为一谈;`export * from` 与'
      + '跨文件符号来源追踪属 ADR-064 :236 已登记的已知边界。**产物侧天然判不到**:'
      + 'type-only 转出被编译期整体擦除、`type` 修饰符也被擦除,故本条只有 src 侧有牙齿(实测 dist 侧 0 处)'
  },
]);

/**
 * 扫一个文件里的层向文本判据命中项,返回带行号的清单。
 *
 * 走 `lexSource`:注释与字符串字面量内部的内容不是可执行代码,判红它只会逼人把
 * 文档改写得更含糊(与 `findRootComputes` 同一理由;ADR-041 已有字符串遮罩先例)。
 * 正因如此,`src/cli/options.ts` 与 `src/convert/delivery-settings.ts` 里那两处
 * 「GUI 的 loadSettings 经 app.getPath,本层刻意不引」的说明注释判绿 —— 它们是
 * 纪律的来源而不是纪律的违反。
 * @param {string} text 源码文本
 * @param {string} file 文件相对 src/ 的 POSIX 路径(只用于 scope 匹配)
 * @returns {{ line: number, id: string, reason: string, what: string, pending: boolean }[]} 命中项(按行号)
 */
export function findTextLayerViolations(text, file) {
  const lexed = lexSource(text);
  /** @param {number} index @returns {number} */
  const lineAt = (index) => {
    let line = 1;
    for (let i = 0; i < index && i < lexed.code.length; i += 1) {
      if (lexed.code.charCodeAt(i) === 10) line += 1;
    }
    return line;
  };
  /** @type {{ line: number, id: string, reason: string, what: string, pending: boolean }[]} */
  const hits = [];
  for (const rule of LAYER_TEXT_RULES) {
    if (!scopeMatches(rule.scope, file)) continue;
    // 逐文件豁免(可选字段,理由见 LAYER_TEXT_RULES 表头)。按去扩展名比较,故同一份
    // exceptFiles 同时约束 src 的 .ts 源与 dist 的 .js 产物(同 isCoreBuiltinAllowed)。
    // 放在 scope 匹配之后、patterns 之前:豁免的是**整个文件**,不是某几条形态。
    if (rule.exceptFiles?.some((allowed) => stripExtension(allowed) === stripExtension(file))) continue;
    for (const pattern of rule.patterns) {
      // matchAll 走的是内部克隆的正则,不动共享字面量的 lastIndex(多个文件复用同一
      // 条 pattern 不会串味);直接用 .test() 会推进 lastIndex,故不用。
      for (const m of lexed.code.matchAll(pattern.re)) {
        const start = m.index ?? 0;
        if (insideString(lexed.inString, start)) continue;
        hits.push({
          line: lineAt(start),
          id: rule.id,
          reason: rule.reason,
          what: `${pattern.label}「${m[0].trim()}」`,
          // pending 随命中项一起带出(不读规则表第二遍):分流由 analyze() 决定
          // 归 problems 还是 info,判据本体对两种分流一视同仁(见文件头 pending 机制)。
          pending: rule.pending === true,
        });
      }
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/**
 * 层向文本判据的**双向自检**(纯判定层,不碰真实仓库之外的东西)。
 *
 * 为什么必须有:一条「按正则扫文本」的规则最危险的失效形态是**恒绿**(写错却什么都不报),
 * 与 `selfCheckRootComputes` 同理。此处把两个方向都钉死:
 *   - 违例形态必须命中(多条:app.getPath / getAppPath / 解构 / %APPDATA% / cmd.exe);
 *   - 判绿形态必须不命中 —— 且每条都挑了**有牙齿**的那种:去掉注释遮罩、去掉字符串
 *     遮罩、或把作用域从新层放大到全仓,对应夹具都会翻脸。
 *
 * 刻意**不含**「真实仓库新层零命中」这条反向锚点(与 `selfCheckRootComputes` 不同):
 * `main()` 的 `analyze` 已经对真实 src / dist 跑过同一批判据并在有任何命中时 exit 1,
 * 再读一遍 src/ 只是把同一件事做第二次。`test/gates/import-boundary.test.js` 那侧
 * 另有一条断言把「真实 src 与 dist 双侧零 problem」钉住。
 *
 * @returns {string[]} 自检问题清单(空数组 = 两个方向都符合预期)
 */
export function selfCheckTextLayerRules() {
  /** @type {{ name: string, file: string, text: string, expect: number }[]} */
  const cases = [
    // ---- 违例方向:每条都判红 ----
    { name: 'convert 调 app.getPath', file: 'convert/paths.ts', text: 'const dir = app.getPath("userData");\n', expect: 1 },
    { name: 'cli 调 app.getAppPath', file: 'cli/options.ts', text: 'const root = app.getAppPath();\n', expect: 1 },
    { name: 'mcp 从 app 解构 getPath', file: 'mcp/tools.ts', text: 'const { getPath } = app;\n', expect: 1 },
    { name: '读 %APPDATA%', file: 'cli/options.ts', text: 'const base = process.env.APPDATA;\n', expect: 1 },
    { name: '读 %LOCALAPPDATA%', file: 'convert/paths.ts', text: 'const base = process.env.LOCALAPPDATA;\n', expect: 1 },
    { name: '以 cmd.exe 为子进程', file: 'cli/index.ts', text: 'const r = spawnSync("cmd.exe", ["/c", "dir"]);\n', expect: 1 },
    { name: '以 powershell 为子进程', file: 'convert/run.ts', text: 'const r = spawn("powershell", ["-c", "ls"]);\n', expect: 1 },
    // ---- 判绿对照:每条都挑了有牙齿的那种 ----
    {
      // 注释遮罩:去掉 lexSource 后本夹具立刻变红(两处说明注释是新层「刻意不引
      // app.getPath」这条例外的书面来源,判红它等于逼人把注释删掉)。
      name: '说明为何不用 app.getPath 的注释(应判绿)',
      file: 'convert/delivery-settings.ts',
      text: '/**\n * - 不读用户 settings.json —— GUI 的 `loadSettings()` 经 `app.getPath("userData")`,\n *   需 Electron 宿主,两个交付面都是无宿主进程。\n */\nexport const delivery = 1;\n',
      expect: 0,
    },
    {
      // 字符串遮罩:去掉 insideString 判据后本夹具立刻变红。
      name: '字符串字面量内的 app.getPath(应判绿)',
      file: 'cli/options.ts',
      text: 'const why = "GUI 的 loadSettings 经 app.getPath(userData),CLI 刻意不引";\n',
      expect: 0,
    },
    {
      // 模板串内的子进程形态:lexSource 按整串跳过模板,去掉遮罩后本夹具立刻变红。
      name: '模板串内的 cmd.exe(应判绿)',
      file: 'cli/index.ts',
      text: 'const doc = `spawnSync("cmd.exe", ["/c", "dir"])`;\n',
      expect: 0,
    },
    {
      // 作用域对照:同一条形态在 core 判绿(core 有正当理由 —— 见
      // LAYER_TEXT_RULES 上方那段),把作用域放大到全仓后本夹具立刻变红。
      name: 'core 层的同一形态(应判绿:core 的 Windows 语义是承重逻辑)',
      file: 'core/image/image-path-policy.ts',
      text: 'const abs = path.win32.isAbsolute(decoded);\n',
      expect: 0,
    },
    { name: 'POSIX 的 HOME(应判绿)', file: 'cli/options.ts', text: 'const home = process.env.HOME;\n', expect: 0 },
    { name: '非 Windows 子进程(应判绿)', file: 'cli/index.ts', text: 'const r = spawnSync("git", ["status"]);\n', expect: 0 },
    { name: 'platform 守卫(应判绿:守卫是跨平台写法的正当形态)', file: 'convert/run.ts', text: 'if (process.platform === "win32") run();\n', expect: 0 },
    { name: 'main 层不受本表约束(应判绿)', file: 'main/persist/settings.ts', text: 'const p = path.join(app.getPath("userData"), "settings.json");\n', expect: 0 },
    // ---- core-no-duplicate-export:两个方向都要钉,否则「恒绿」与「恒红」都看不出来 ----
    {
      // 违例方向 ①:export type 整段转出(main/ipc/types.ts 被删前的那一行原样)。
      name: '把 core 契约整段 export type 转出(应判红)',
      file: 'main/persist/settings.ts',
      text: 'export type { ExportPresetsResult } from "../../core/ipc-contract.js";\n',
      expect: 1,
    },
    {
      // 违例方向 ②:混在值里、带 `type` 修饰符的那一种(两条分支不是同一条正则的别名,
      // 去掉任一分支本夹具立刻变绿)。
      name: '混合子句里带 type 修饰符的转出(应判红)',
      file: 'main/persist/settings.ts',
      text: 'export { DEFAULT_SETTINGS, type AppSettings } from "../../core/settings/settings-defaults.js";\n',
      expect: 1,
    },
    {
      // 判绿方向:同样的形状但转的是**值**且不带 type 修饰符 —— 判据的对象是「type」,
      // 把它判红等于逼人把定义改成「连函数也不许转出」,那是本条刻意不覆盖的已知边界。
      name: '只转值不带 type 修饰符(应判绿:判据只管 type)',
      file: 'renderer/state/pure.ts',
      text: 'export { errorMessage } from "../../core/text/error-message.js";\n',
      expect: 0,
    },
    {
      // 判绿方向:core 内部的文件互相转出是 API 面聚合,不是复制(scope 只覆盖 core 之外)。
      name: 'core 内部文件之间的转出(应判绿:聚合不是复制)',
      file: 'core/settings/settings-defaults.ts',
      text: 'export { DEFAULT_TYPOGRAPHY, type TypographySettings } from "./typography.js";\n',
      expect: 0,
    },
    // ---- i18n-dom-no-export-let:scope 精确到一个文件,故两个方向都要用**别的文件名**对照 ----
    {
      name: 'dom.ts 导出 let(应判红:可变绑定不得出 DOM 面)',
      file: 'core/i18n/dom.ts',
      text: 'let current = "zh";\nexport let current2 = "zh";\n',
      expect: 1,
    },
    {
      name: 'dom.ts 出现 export { … } 子句(应判红:再导出只由唯一公开桶 index.ts 承担)',
      file: 'core/i18n/dom.ts',
      text: 'const current = "zh";\nexport { current };\n',
      expect: 1,
    },
    {
      // 判绿方向①:dom.ts 唯一该做的事 —— 导出一个函数。两个 pattern 都不匹配它。
      name: 'dom.ts 导出函数(应判绿:这正是它该有的导出面)',
      file: 'core/i18n/dom.ts',
      text: 'export function applyStaticTexts(): void {\n  if (typeof document === "undefined") return;\n}\n',
      expect: 0,
    },
    {
      // 判绿方向②:作用域对照 —— 同一条形态在**别的** i18n 文件里合法(t.ts 若哪天真的
      // 需要导出可变绑定,那是它自己的决策,本条管不到也不该管)。把 scope 放大到
      // core/i18n/** 后本夹具立刻变红。
      name: 't.ts 里的 export { … }(应判绿:scope 只覆盖 dom.ts 一个文件)',
      file: 'core/i18n/t.ts',
      text: 'const current = "zh";\nexport { current };\n',
      expect: 0,
    },
  ];
  /** @type {string[]} */
  const problems = [];
  for (const testCase of cases) {
    const hits = findTextLayerViolations(testCase.text, testCase.file);
    if (hits.length !== testCase.expect) {
      problems.push(
        `层向文本判据自检失守「${testCase.name}」:期望命中 ${testCase.expect} 处,实际 ${hits.length} 处`
        + `(规则恒绿或恒红都是失效)`,
      );
    }
  }
  return problems;
}

// ---- 规则 no-self-computed-root:项目根的单一来源 ----

/**
 * 全仓唯一**定义**项目根语义的文件。改它的位置必须同步改这里(两处互为对方的校验)。
 *
 * 它取 `process.cwd()`,**不是**按自身位置派生 —— 故它不是「允许自算根的那一处」,而是
 * 「根语义唯一定义处」:它的值恒等于 cwd,**本身不含任何位置耦合**,因此不构成第二条根来源。
 * 这正是本规则豁免它的理由(规则禁的是「按目录层级上跳」这一类**位置耦合**写法)。
 */
export const ROOT_SOURCE_FILE = 'shared/paths.js';

/**
 * ⚠ 本文件曾有一张 `ROOT_COMPUTE_EXEMPT_FILES` 豁免表(9 条),已按 ADR-040 **整表删除**。
 * 那 9 条全部是「被逐字节复制进沙盒、而沙盒不含 shared/」的脚本,如今复制点都补了
 * `shared/paths.js`,故它们改为 import 单源,不再需要豁免。
 * 删表后本规则对全仓**零豁免**(门禁自身 `ROOT_COMPUTE_SELF_EXEMPT` 与单源 `ROOT_SOURCE_FILE` 除外:
 * 前者是规则定义处,后者是根语义定义处,两者都不是「某个实现文件在自算根」)。
 * 不要再把豁免表加回来:若某个脚本将来又需要根,正确做法是 import 单源 —— **不是**自己上跳。
 */

/**
 * 自算项目根的四种写法(逐字匹配源码文本,故门禁与实现无共享代码):
 *   1. url-up         —— 用 URL 构造器在 import.meta.url 上跳一级或多级
 *   2. dirname-resolve —— 同一写法的 import.meta.dirname 形态
 *   3. dirname-chain  —— path.resolve 套 path.dirname 套 fileURLToPath 的连写形态
 *   4. fileurl-up     —— fileURLToPath 取到本文件路径后再手工上跳的变体
 * 覆盖 3/4 是因为它们与 1/2 语义完全相同,却躲过前两条正则 —— 规则若只认字面写法,
 * 等于给出「换个写法就绕过门禁」的提示。
 *
 * 本表刻意不写可读的写法示例:字面示例会被本规则扫到门禁自己(见 ROOT_COMPUTE_SELF_EXEMPT)。
 */
export const ROOT_COMPUTE_PATTERNS = Object.freeze([
  { id: 'url-up', re: /new\s+URL\(\s*(['"])\.\.(?:\/|\\|['"])/ },
  { id: 'dirname-resolve', re: /import\.meta\.dirname\s*,\s*(['"])\.\.(?:\/|\\|['"])/ },
  { id: 'dirname-chain', re: /path\.resolve\(\s*path\.dirname\(\s*fileURLToPath\(\s*import\.meta\.url/ },
  { id: 'fileurl-up', re: /fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)\s*,\s*(['"])\.\.(?:\/|\\|['"])/ },
]);

/**
 * 上跳基准的「origin」表达式:把本文件位置取出来的三种写法。
 * 覆盖 `path.dirname(fileURLToPath(import.meta.url))` / `import.meta.dirname` /
 * `.cjs` 的隐式 `__dirname`(后者没有声明,故由 isCjs 单独特判)。
 */
const ORIGIN_SOURCE = /fileURLToPath\s*\(\s*import\.meta\.url|import\.meta\.dirname|\b__dirname\b/;

/** 声明一个 origin 变量:`const here = …dirname(…)…;`(let/var 同样算) */
const ORIGIN_DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*);/g;

/**
 * 以某个 origin 变量为基准的 path 调用:path.join(here, …) / path.resolve(here, …)。
 * 只抓「origin 紧邻首个实参」这一形态 —— origin 被包一层再传进来不是本规则要管的形态
 * (那属于参数传递而非自算根,判红它只会逼人改函数签名)。
 */
const ORIGIN_BASE_CALL_RE = /path\.(?:join|resolve)\s*\(\s*([A-Za-z_$][\w$]*)\s*(,|[\s)])/g;

/**
 * 纯字面量的多行连写链(无变量):path.join(\n  path.dirname(fileURLToPath(import.meta.url)),\n  '..', …
 * 单独一条是因为它没有 origin 变量可收集,两步法(收变量名 → 查基准)看不见它。
 */
const LITERAL_CHAIN_RE = /path\.(?:join|resolve)\s*\(\s*path\.dirname\s*\(\s*fileURLToPath\s*\(\s*import\.meta\.url\s*\)\s*\)\s*,/g;

/** 单个实参里的上跳段数:`'..'` → 1,`'../../dist'` → 2 */
function countUps(argText) {
  const quoted = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
  let ups = 0;
  for (const m of argText.matchAll(quoted)) {
    for (const seg of (m[2] ?? '').split(/[/\\]/)) if (seg === '..') ups += 1;
  }
  return ups;
}

/** 取 `path.xxx(` 的括号配平范围(跳过引号内的括号),返回实参文本;未配平返回 null */
function callArgs(code, openAt) {
  let depth = 0;
  for (let i = openAt; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipQuoted(code, i) - 1; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(openAt + 1, i);
    }
  }
  return null;
}

/** 该下标是否落在字符串字面量内部(ADR-041 先例:合成夹具串里的写法不是可执行代码) */
function insideString(inString, index) {
  return inString[index] === 1;
}

/**
 * 深度判据的共享实现:origin 基准 / 字面量连写链两类,均要求 `ups === depth`。
 *
 * 语义是「**上跳基准落在仓库根**」,不是「解析结果落在仓库根」:命中的一批里绝大多数
 * 是上跳到根**再下钻**(如 `path.join(here, '..', '..', 'dist', 'main')`),措辞必须
 * 区分这两者,否则下一个人会拿 `../../dist/...` 当反例。
 *
 * `ups >= 1` 是硬守卫:深度 0 的文件(仓库根下的顶层文件)上 `path.join(__dirname, 'x')`
 * 的 ups 与 depth 都是 0,若无此守卫会被判红,而它并没有自算根。
 */
function collectDepthHits({ code, inString, depth, isCjs, origins, literalChain }) {
  /** @type {{ line: number, id: string }[]} */
  const hits = [];
  /** @param {number} index @returns {number} */
  const lineAt = (index) => {
    let line = 1;
    for (let i = 0; i < index && i < code.length; i += 1) if (code.charCodeAt(i) === 10) line += 1;
    return line;
  };

  if (literalChain) {
    for (const m of code.matchAll(LITERAL_CHAIN_RE)) {
      const start = m.index ?? 0;
      if (insideString(inString, start)) continue;
      const args = callArgs(code, code.indexOf('(', start));
      if (args === null) continue;
      const ups = countUps(args);
      if (ups >= 1 && ups === depth) hits.push({ line: lineAt(start), id: 'literal-chain-up' });
    }
  }

  for (const m of code.matchAll(ORIGIN_BASE_CALL_RE)) {
    const start = m.index ?? 0;
    const base = m[1];
    // .cjs 的隐式 __dirname 没有声明句,靠 isCjs 特判收进来(否则这条形态恰好漏掉)
    if (!origins.has(base) && !(isCjs && base === '__dirname')) continue;
    if (insideString(inString, start)) continue;
    const args = callArgs(code, code.indexOf('(', start));
    if (args === null) continue;
    const ups = countUps(args);
    if (ups >= 1 && ups === depth) hits.push({ line: lineAt(start), id: 'origin-base-up' });
  }

  return hits;
}

/** 收集一个文件里的 origin 变量名(声明右侧含 ORIGIN_SOURCE 者) */

/**
 * ⚠ origin 传播**只做一层**:拿已收进来的 origin 变量再赋一次值,不会被收成新 origin,故
 * 「二次赋值」形态不判红 —— `const a = path.join(here,'..'); path.join(a,'..')` 判绿。
 *
 * 唯一的可判红构造是把两跳合并进一次调用(`path.join(here,'..','..')`),故自验须造
 * relPath 深 2 且两跳各 ups1 的文件:同一文件里合并写法判红、二次赋值写法判绿,两者对照
 * 才是这个盲区的完整证据。
 *
 * 有意不补,三条理由:① 传递闭包原型跑遍全树(含 `src/`)的真实代码零活样本,按 ADR-042,
 * 零违规的规则等于拿维护成本换零收益;② 传播会丢掉「中间变量是目录还是文件路径」的语义,
 * 给未来合法代码造假阳性 —— `const a = path.join(here,'..','x')` 里的 a 是**带下钻段的目录**,
 * 其后的 `path.join(a,'..')` 并不落在根,而朴素传播会累计成 ups2 === depth 判红;③ 本仓
 * 不存在「为绕门禁而写两跳」的动机。
 *
 * 将来若要补,先要解决的是中间变量的语义(下钻段该不该从 ups 里扣掉),不是加一行传播。
 */
function collectOrigins(code, inString) {
  const origins = new Set();
  for (const m of code.matchAll(ORIGIN_DECL_RE)) {
    const start = m.index ?? 0;
    if (insideString(inString, start)) continue;
    if (ORIGIN_SOURCE.test(m[2] ?? '')) origins.add(m[1]);
  }
  return origins;
}

/** 文件相对仓库根的深度:`src/main/menu.ts` → 2。供 ups === depth 判据用 */
export function fileDepth(relPath) {
  const slash = relPath.lastIndexOf('/');
  return slash < 0 ? 0 : relPath.slice(0, slash).split('/').length;
}

/**
 * 门禁自身对这条规则的豁免:规则表与自检样例里必然出现被判红的字面写法。
 *
 * 与「沙盒副本豁免」性质不同,这一条豁免的是**规则的定义处**而非某个实现文件 ——
 * 去掉它,门禁会因自己的正则表判红自己,而那既无信息量、也会让人误以为规则坏了。
 */
export const ROOT_COMPUTE_SELF_EXEMPT = 'gates/repo/check-import-boundary.mjs';

/**
 * 扫一个文件里的自算根写法,返回带行号的命中项。
 *
 * 判据只认「自算根」这一语义,不认 import 单源:从 shared/paths.js import ROOT 是正确写法,
 * 同一文件里若另有自算行仍判红(那行本身就是 depth-coupled 的)。
 *
 * ⚠ `options` 是**可选**的,省略时行为与既有四条正则逐字相同 —— 沙盒侧(--src 指向临时目录)
 * 调本函数拿到的必须是同一个答案:那里没有「文件相对仓库根的深度」可言(夹具文件的深度是
 * 夹具自己的,与真实仓库无关),多传一个猜测的 depth 只会让它得到不同的、无人解释的结果。
 * 深度判据只在调用方能给出真实 relPath 时才生效。
 *
 * @param {string} text 源码文本
 * @param {{ relPath?: string }} [options] relPath 为该文件的仓库相对 POSIX 路径;
 *   传了才追加深度判据(origin 基准 / 字面量连写链)
 * @returns {{ line: number, id: string }[]} 命中项(行号从 1 起,按出现序)
 */
export function findRootComputes(text, options = {}) {
  /** @type {Map<number, string>} 行号 → 命中的规则 id(同一行只报一次,取首个命中的) */
  const hits = new Map();
  // 先抹注释再匹配(复用 copy-closure 的 lexSource,等长故行号不变):文档里为了说明
  // 「历史上长这样」而引用的写法不是可执行代码,判红它只会逼人把注释改写得更含糊。
  // ⚠ 面上的四条形态判定不**不过滤字符串内部**(与 findTextLayerViolations 相反的一条取舍):
  //   那两处形状是 `new URL('..')` / `path.dirname(__dirname)`,出现在文档串里的概率低到
  //   不值得单开一条遮罩口径。深度判据那侧则用 inString(collectOrigins 需要它)。
  const lexed = lexSource(text);
  const lines = lexed.code.split('\n');
  for (const pattern of ROOT_COMPUTE_PATTERNS) {
    for (let i = 0; i < lines.length; i += 1) {
      if (hits.has(i + 1)) continue;
      if (pattern.re.test(lines[i] ?? '')) hits.set(i + 1, pattern.id);
    }
  }

  // 深度判据:仅在调用方给出真实 relPath 时追加(理由见 @param options)
  if (options.relPath !== undefined) {
    const depth = fileDepth(options.relPath);
    for (const hit of collectDepthHits({
      code: lexed.code,
      inString: lexed.inString,
      depth,
      isCjs: /\.cjs$/.test(options.relPath),
      origins: collectOrigins(lexed.code, lexed.inString),
      literalChain: true,
    })) {
      if (!hits.has(hit.line)) hits.set(hit.line, hit.id);
    }
  }

  return [...hits.entries()]
    .map(([line, id]) => ({ line, id }))
    .sort((a, b) => a.line - b.line);
}

// ---- 源码文本 → import 事实 ----

/**
 * `import/export ... from 'spec'`(含 `import type` 与行内 `type` 说明符)
 *
 * 惰性跨度原为 `[\s\S]*?`(无界、可跨行)。跨行本身是必需的 —— 多行 import 语句
 * (`import {\n a,\n b\n} from 'x'`)必须能匹配,所以不能改成 `[^'"\n]`。
 * 但无界带来了两个代价:
 *   1. 性能:行首锚 `(^|\n)` 使每个行首都成为起点候选,而对**没有 `from`** 的
 *      import/export 行,引擎要一路扫到文件末尾才放弃 ⇒ 单次匹配代价 O(文件剩余长度)。
 *      实测 233 文件 / 3.59MB,`FROM_RE` 的 matchAll 独占 analyzeTreeBoundaries 的 89%。
 *   2. 正确性:跨度能吞掉引号,于是「`import 'side-effect'` 之后的另一条 import」的
 *      `from` 会被接上,或字符串字面量里的伪 import 语句会被当真实 import 命中。
 * 改为 `[^'"]*?` 后两者同时解决:**有效 ES 模块语法在 `import` 关键字与 `from` 之间
 * 不含引号**(specifier 的引号在 `from` 之后),该约束不漏任何真实 import,仍支持跨行。
 *
 * 行为等价性已按门禁真实输入(`lexSource` 抹注释后的 `code`)对全量 233 文件实测:
 * 新增命中 0 处、移除 8 处;其中 6 处为裸 specifier(`electron`/`node:fs`/`jszip`),
 * 本就在 `analyzeTreeBoundaries` 的 `classifySpecifier(...)!=='relative'` 处被过滤,
 * 移除是 no-op;余 2 处是夹具字符串里的伪 import(相对路径但非真实依赖),属原实现的
 * 假阳性。故该改动只减噪、不改判定。
 */
const FROM_RE = /(^|\n)[ \t]*(?:import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
/** 副作用导入 `import 'spec'` */
const SIDE_EFFECT_RE = /(^|\n)[ \t]*import\s+['"]([^'"]+)['"]/g;
/** CJS 产物里的 `require('spec')`(preload.cjs 等 tsc 编译为 CommonJS 的输出) */
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * specifier 归类:node 内建 / 相对路径 / 外部 URL / bare 包名。
 * @returns {{ kind: 'builtin'|'relative'|'external'|'bare', packageName: string|null }}
 */
export function classifySpecifier(spec) {
  if (spec.startsWith('node:')) return { kind: 'builtin', packageName: null };
  if (spec.startsWith('.') || spec.startsWith('/')) return { kind: 'relative', packageName: null };
  if (SCHEME_RE.test(spec)) return { kind: 'external', packageName: null };
  const parts = spec.split('/');
  const packageName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return { kind: 'bare', packageName };
}

/**
 * 该 import 子句是否被编译期擦除。
 * `import type {...} from` 恒为 type-only;`import { type A, type B } from`
 * 也全是 type-only;出现默认绑定/命名空间绑定即视为运行时(保守判红)。
 */
export function isTypeOnlyClause(typeKeyword, clause) {
  if (typeKeyword !== undefined) return true;
  const trimmed = clause.trim();
  if (!trimmed.startsWith('{')) return false;
  const close = trimmed.lastIndexOf('}');
  const inner = trimmed.slice(1, close === -1 ? undefined : close);
  const bindings = inner
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return bindings.length > 0 && bindings.every((part) => part === 'type' || part.startsWith('type '));
}

/** 递归列出 root 下指定扩展名的文件(相对 root 的 POSIX 路径,已排序) */
export function listSourceFiles(root, extensions) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (extensions.includes(path.extname(entry.name))) out.push(abs);
    }
  };
  walk(root);
  return out
    .map((abs) => ({ abs, file: path.relative(root, abs).split(path.sep).join('/') }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * 抽取一个文件里的全部 import 事实。
 * `cjs` 为真时额外抽 require()(编译产物是 CommonJS);产物里已无 type-only 痕迹。
 */
export function collectImports(absPath, { cjs = false } = {}) {
  const text = readFileSync(absPath, 'utf8');
  const found = new Map();
  const add = (spec, typeOnly) => {
    const key = `${spec}\u0000${String(typeOnly)}`;
    if (!found.has(key)) found.set(key, { spec, typeOnly });
  };
  for (const m of text.matchAll(FROM_RE)) add(m[4], isTypeOnlyClause(m[2], m[3]));
  for (const m of text.matchAll(SIDE_EFFECT_RE)) add(m[2], false);
  if (cjs) for (const m of text.matchAll(REQUIRE_RE)) add(m[1], false);
  return [...found.values()].map((entry) => ({ ...entry, ...classifySpecifier(entry.spec) }));
}

/**
 * 去掉扩展名:白名单按「与形态无关的路径」书写,同一份 core 内建白名单才能同时
 * 约束 src 源(.ts)与其编译产物(.js),不必在两处各维护一份文件名。
 */
export function stripExtension(file) {
  return file.slice(0, file.length - path.posix.extname(file).length);
}

/** 该文件是否在 core 的 node: 内建白名单内(按去扩展名的路径比较) */
export function isCoreBuiltinAllowed(file) {
  const key = stripExtension(file);
  return CORE_NODE_BUILTIN_FILES.some((allowed) => stripExtension(allowed) === key);
}

/** 相对 specifier 解析到「层」:core / main / renderer / 其它(取首段目录名) */
export function resolveLayer(file, spec) {
  const dir = path.posix.dirname(file);
  const joined = path.posix.normalize(path.posix.join(dir, spec));
  return joined.split('/')[0];
}

function scopeMatches(scope, file) {
  if (scope === 'preload') return file === 'main/preload.cts' || file === 'main/preload.cjs';
  // smoke 住在 main/ 下但按「文件」而非「目录」划层:它不是 main 的一个子模块,而是
  // 随包分发的自测入口(build.files 只收 dist/**),边界纪律独立于 main 的一般约束
  if (scope === 'smoke') return file === 'main/smoke.ts' || file === 'main/smoke.js';
  // renderer 的基础层:scope 按 src 顶层目录匹配(core/main/renderer),而这两处在
  // renderer/ 之下,故单列一个 scope 形态
  if (scope === 'renderer-foundation') {
    return file.startsWith('renderer/dom/') || file.startsWith('renderer/state/');
  }
  // core 的 pdf 子树:scope 按 src 顶层目录匹配,故 core/pdf/** 需单列形态
  if (scope === 'core-pdf') return file.startsWith('core/pdf/');
  // core 的其余内部子目录:与 core-pdf 同一形态(单列而非靠兜底分支),逐个写出而不是
  // 用 `core-<名字>` 反推目录 —— 反推写法在名字与目录名不同构时会静默失配(恒绿),
  // 而本表的形态收敛只省四行字面量。
  if (scope === 'core-markdown') return file.startsWith('core/markdown/');
  if (scope === 'core-image') return file.startsWith('core/image/');
  if (scope === 'core-pipeline') return file.startsWith('core/pipeline/');
  if (scope === 'core-text') return file.startsWith('core/text/');
  // core/i18n 与别的 core 子目录**不同构**:目录化之前的现状是「文件 core/i18n.ts」与
  // 「目录 core/i18n/」**两者并存**(前者待拆进后者)。scope 必须同时命中两者 ——
  // 只命中一种,拆分完成那天判据会因文件换了位置而静默失效(恒绿),而恒绿的规则等于
  // 没有规则。两侧形态都按去扩展名比较(同 preload / smoke 的先例),故 src 的 .ts 源与
  // dist 的 .js 产物都命中。
  if (scope === 'core-i18n') {
    return file === 'core/i18n.ts' || file === 'core/i18n.js' || file.startsWith('core/i18n/');
  }
  // core/i18n/ 里的 dom.ts 一个文件(判据 i18n-dom-no-export-let 的 scope):按去扩展名
  // 比较,故 src 的 .ts 源与 dist 的 .js 产物命中同一份登记。上一条 core-i18n 的
  // `file === 'core/i18n.ts'` 分支在原 201 行的桶删除后已无对应文件,留着是防御性的
  // (若桶形态回来,scope 仍能命中),不是遗漏。
  if (scope === 'i18n-dom') {
    return stripExtension(file) === 'core/i18n/dom';
  }
  if (scope === 'main-windows') return file.startsWith('main/windows/');
  // core 之外的全部文件(判据 core-no-duplicate-export 的 scope):core 契约的 type 被第二个
  // 文件转出,判据对象是「core 之外的文件」,故按**排除**写而不是按前缀枚举 —— src 顶层目录
  // 会随 ADR-060/064 增减,枚举前缀会在新增目录那天静默漏判(恒绿)。
  if (scope === 'outside-core') return !file.startsWith('core/');
  // 两个进程外交付面(cli 与 mcp,ADR-060 步序 2/3 定的同层 adapter):一个 scope 命中
  // **两个** src 顶层目录。与 renderer-foundation 同一形态(单条规则约束一组目录),
  // 区别只在这里要表达的是「同层两棵 adapter 树的共同纪律」,故按前缀列表逐个命中,
  // 而不是把三条规则复制成六条(deny-list 表的条数即维护成本,同义规则不应有两份)。
  // 新增同类交付面时只需在此加一个前缀,规则表条数不变。
  if (scope === 'delivery-faces') {
    return ['cli/', 'mcp/'].some((prefix) => file.startsWith(prefix));
  }
  // 新层的文本判据(LAYER_TEXT_RULES 的两条):比 delivery-faces **多一个 convert/** ——
  // 「不向宿主问路径」「不引入 Windows 专属能力」对装配层的要求与对两个交付面完全相同
  // (ADR-060 第 9 条把那四条期权写给的是整个新层,不是某一面)。与 delivery-faces 分表
  // 而不是合并:合并会让 faces-* 三条在 convert/ 上也生效,而那三条的语义(禁 renderer /
  // 禁 electron / 禁逃出 src/)已由 convert-no-gui 与 ADR-060 的分层单独表达,
  // 两组规则的判据形态不同(import 说明符 vs 源码文本),混在一个 scope 里会让
  // 「哪条规则为什么红」不可读。
  if (scope === 'headless-faces') {
    return ['convert/', 'cli/', 'mcp/'].some((prefix) => file.startsWith(prefix));
  }
  return file === scope || file.startsWith(`${scope}/`);
}

/** 规则是否命中这条 import */
function ruleHits(rule, entry) {
  if (rule.forbid.startsWith('bare:')) {
    const name = rule.forbid.slice('bare:'.length);
    return entry.kind === 'bare' && entry.packageName === name;
  }
  if (rule.forbid.startsWith('layer:')) {
    if (entry.kind !== 'relative') return false;
    const layers = rule.forbid.slice('layer:'.length).split(',');
    // `..` 是合法取值:向上逃逸的说明符归一化后首段恒为 `..`(见 resolveLayer),
    // 故 `layer:..` 表达「解析后落在扫描根之外」,且**与文件深度无关** ——
    // 这是它比 `prefix:../../` 强的地方(后者只在扁平单层目录里等价,
    // 目录一旦长出子目录,子目录里合法的 `../../core/x` 会被误报)。
    // 「逃出 src/」这三条(convert / faces / smoke)现已一律用 layer:..。
    return layers.includes(resolveLayer(entry.file, entry.spec));
  }
  if (rule.forbid.startsWith('prefix:')) {
    // 逗号分隔的多个前缀(与 layer: 的列表约定一致)。单前缀是它的退化情形,行为不变。
    // 之所以需要列表:resolveLayer 返回的是**顶层**目录(renderer 内部路径的首段恒为
    // renderer),故 layer: 形态表达不了 renderer 内部的边 —— 要约束 renderer 内部的
    // 方向只能用相对说明符前缀,而一个方向往往要同时禁多个目标目录。
    if (entry.kind !== 'relative') return false;
    // 可选的 type-only 豁免(allowTypeOnly):仅本形态支持,其余三条 forbid 分支不读该字段。
    // 为什么只豁免 type-only 而不豁免整类说明符:词法层已经区分 import type(见
    // isTypeOnlyClause 与 collectImports),豁免可以精确到「这一条边是编译期产物」。
    // 豁免整类(如「凡带 type 说明符即放过」)会把值 import 一起放过,判据退化成
    // 「这条边不存在」而非「这条运行期边不存在」—— 而运行期依赖图才是本规则的判据对象。
    if (rule.allowTypeOnly === true && entry.typeOnly) return false;
    const prefixes = rule.forbid.slice('prefix:'.length).split(',').map((p) => p.trim()).filter(Boolean);
    return prefixes.some((p) => entry.spec.startsWith(p));
  }
  if (rule.forbid.startsWith('builtin:')) {
    // node: 内建的精确名单(逗号分隔)。需要它是因为 classifySpecifier 把 node:*
    // 归为 kind 'builtin' 而非 'bare',故 bare: 形态匹配不到 —— 而我们需要的正是
    // **按能力** 区分:core/pdf 里 node:path/node:url 纯字符串运算可以放行(见
    // CORE_NODE_BUILTIN_FILES),node:fs 却是真 IO,故要单独一条规则禁。
    if (entry.kind !== 'builtin') return false;
    const names = rule.forbid.slice('builtin:'.length).split(',').map((p) => p.trim()).filter(Boolean);
    return names.includes(entry.spec);
  }
  throw new Error(`未知的层向规则形态:${rule.forbid}`);
}

/**
 * 边界判定。返回 { problems, info }。
 *
 * 两个通道的语义(判红的唯一依据是 `problems`,`info` 一律不参与 exit code):
 *   - `problems`:非 pending 规则的命中 + 依赖声明差集 → 门禁判红;
 *   - `info`    :两类只作提示的诊断 ——
 *                 ① 未使用的依赖声明(仅 typeOnlyAware 形态下报,见下);
 *                 ② **pending 规则的命中**:规则照常扫描、照常计数,但本阶段只报告。
 * 两者都在 `main()` 里逐条打印,故「知道但暂时放过」与「漏判」在输出上可区分。
 *
 * 第三个返回值 `pendingHits`(Map<规则 id, 命中处数>)只服务于汇总是
 * 「有 N 条 pending 规则当前命中 M 处」—— 两个数都要有,而 `info` 是给人读的逐条文案。
 * @param root 被扫描源码子树
 * @param pkg package.json 解析结果
 * @param options { extensions, cjs, typeOnlyAware }
 */
export function analyze(
  root,
  pkg,
  { extensions = ['.ts', '.cts'], cjs = false, typeOnlyAware = true } = {},
) {
  const problems = [];
  const info = [];
  const runtimeUsed = new Set();
  const typeOnlyUsed = new Set();
  /**
   * pending 规则的命中数:rule id → 处数。单独计一份而不从 info 里反解,
   * 是因为汇总是「有 N 条 pending 规则当前命中 M 处」——两个数都得有,
   * 而 info 是给人读的逐条文案,不是计数来源。
   * @type {Map<string, number>}
   */
  const pendingHits = new Map();

  for (const { abs, file } of listSourceFiles(root, extensions)) {
    const text = readFileSync(abs, 'utf8');
    // 规则 no-self-computed-root:与 import 无关,按文件判一次(它看的是路径表达式而非 import)
    for (const hit of findRootComputes(text)) {
      problems.push(
        `${file}:${hit.line} 自算项目根(${hit.id})—— 项目根的单一来源是 ${ROOT_SOURCE_FILE},`
          + '请 import 它;按目录层级上跳的写法在目录改层级时会静默指错位置,而门禁查不出这种错',
      );
    }
    // 层向文本判据(LAYER_TEXT_RULES):同样与 import 无关,按文件判一次。
    // ⚠ 两处 find* 共用上面读出的 text,collectImports 仍自己再读一遍(它的签名按
    // 绝对路径收,是导出给测试段直调的纯函数,改成收文本会改掉那条公开契约)。
    // 代价是每个文件读两次 —— 真实 src 侧 233 文件,门禁本身已在 3s 量级,
    // 换「少一次读」去动一条被测试消费的公开签名不划算。
    for (const hit of findTextLayerViolations(text, file)) {
      const line = `${file}:${hit.line} ${hit.what}违反层向规则 ${hit.id} —— ${hit.reason}`;
      if (hit.pending) {
        info.push(`${PENDING_PREFIX}${line}`);
        pendingHits.set(hit.id, (pendingHits.get(hit.id) ?? 0) + 1);
        continue;
      }
      problems.push(line);
    }
    for (const found of collectImports(abs, { cjs })) {
      const entry = { ...found, file };
      if (entry.kind === 'bare' && entry.packageName !== null) {
        const name = entry.packageName;
        const inProd = Object.hasOwn(pkg.dependencies ?? {}, name);
        const inDev = Object.hasOwn(pkg.devDependencies ?? {}, name);
        if (entry.typeOnly) {
          typeOnlyUsed.add(name);
          // 类型由 @types/* 或任意已声明包提供即可,不必是运行时依赖
          if (!inProd && !inDev && !Object.hasOwn(pkg.devDependencies ?? {}, `@types/${name}`)) {
            problems.push(
              `${file}:type-only import「${name}」既不在 dependencies/devDependencies,也无 devDependencies 的 @types/${name} 提供`,
            );
          }
        } else {
          runtimeUsed.add(name);
          // 宿主内建模块豁免的是「必须在 dependencies」这一条,不是豁免层向规则:
          // core import electron 仍须由 core-no-host 拦下(不能用 continue 跳到下一条 import)。
          const hostProvided = Object.hasOwn(HOST_PROVIDED_RUNTIME, name);
          if (hostProvided) {
            if (inProd) {
              problems.push(
                `${file}:宿主内建模块「${name}」不应声明为 dependencies(它不随包分发,声明会误导 electron-builder 去打包)`,
              );
            }
          } else if (inDev && !inProd) {
            problems.push(
              `${file}:运行时 import「${name}」只在 devDependencies 中声明 —— 生产安装会缺件,须移入 dependencies`,
            );
          } else if (!inProd) {
            problems.push(`${file}:运行时 import「${name}」未在任何依赖段声明(当前靠传递依赖偶然就位)`);
          }
        }
      }

      // core 的 node: 内建模块面:白名单逐文件,其余一律判红(两侧都去扩展名比较)
      if (entry.kind === 'builtin' && file.startsWith('core/') && !isCoreBuiltinAllowed(file)) {
        problems.push(
          `${file}:core 侧 import「${entry.spec}」不在内建白名单内(白名单仅 ${CORE_NODE_BUILTIN_FILES.join('、')});`
            + 'core 触碰宿主能力须先评估能否下沉为入参',
        );
      }

      for (const rule of LAYER_RULES) {
        if (!scopeMatches(rule.scope, file)) continue;
        if (!ruleHits(rule, entry)) continue;
        const kindText = entry.typeOnly ? 'type-only ' : '';
        const line = `${file}:${kindText}import「${entry.spec}」违反层向规则 ${rule.id} —— ${rule.reason}`;
        if (rule.pending === true) {
          info.push(`${PENDING_PREFIX}${line}`);
          pendingHits.set(rule.id, (pendingHits.get(rule.id) ?? 0) + 1);
          continue;
        }
        problems.push(line);
      }
    }
  }

  // 未使用声明只在能看见 type-only 关系的形态(src)下报:产物里类型引用已被
  // 编译期擦除,micromark-util-types / unified 这类纯类型依赖在 dist 侧永远
  // 「未被 import」,照报就是纯噪声。
  if (typeOnlyAware) {
    for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
      if (runtimeUsed.has(name) || typeOnlyUsed.has(name)) continue;
      const reason = RESOURCE_ONLY_DEPENDENCIES[name];
      info.push(
        reason === undefined
          ? `未使用声明:dependencies「${name}」在被扫描源码中无任何 import`
          : `未使用声明:dependencies「${name}」不经 import(已登记:${reason})`,
      );
    }
  }

  return { problems, info, pendingHits };
}

/**
 * 规则 no-self-computed-root 的扫描面:仓库里会执行代码的三个子树。
 *
 * 刻意独立于 --src/--flavor:那条参数管的是「被编译的产物形态」,而自算根是**源码布局**问题,
 * 在 src 侧根本不存在(TS 产物里 import.meta.url 已被擦除)。故本扫描固定锚在真实仓库上,
 * 沙盒调用(--src 指向临时目录)也照跑 —— 判的是本仓纪律,不是夹具内容。
 */
export const ROOT_COMPUTE_SCAN_DIRS = Object.freeze(['gates', 'tools', 'test', 'shared']);

/** 参与本扫描的扩展名(与门禁自身所在树一致) */
const ROOT_COMPUTE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs']);

/**
 * 全仓扫描结果的进程内记忆化(按 root 分键)。
 *
 * 起因:`main()` 除 `--src` 目标外,还会无条件做三次**固定锚在真实仓库**的全仓扫描
 * (`analyzeRootComputes` / `selfCheckRootComputes` / `analyzeTreeBoundaries`),
 * 每次重读 ROOT_COMPUTE_SCAN_DIRS 与 TREE_SCAN_DIRS 下的全部源文件(实测 233 文件 / 3.59MB)。
 * 门禁每进程只跑一次 `main()`,这些扫描各只一次;但验收段 `import-boundary.test.js` 的
 * 25 次 `runCli` 会各跑一遍 —— 25 × 约 3.2s ≈ 80s,占该段 84.6s 的 99%(其余断言合计 <1s)。
 *
 * **分键必须是 root 绝对路径**:同一进程里 `analyzeTreeBoundaries` 还会被验收段以 6 个
 * 不同沙盒目录为 root 调用(`import-boundary.test.js` 第 7 组),沙盒各有独立 mkdtemp 路径,
 * 按 root 分键即可各扫各的、互不串味;无 key 的话会命中错误的缓存结果。
 *
 * **生效前提:两次调用之间 root 下的文件未被改动。** 逐条核对当前调用方均满足:
 *   - 门禁自身:单进程一次 `main()`,期间只读;
 *   - 验收段:25 次 `runCli` 的沙盒一律 `fs.mkdtempSync(os.tmpdir())`,写入只落沙盒,
 *     仓库不被触碰;第 7 组的 6 个沙盒各自写入后**只调用一次**。
 * 若将来出现「先扫 → 改 root 下文件 → 再扫」的调用方,必须先调 `resetScanCache()`
 * (缓存只按 root 分键,分不出内容是否变过)。
 */
const scanCache = new Map();

/** 清空全仓扫描缓存。调用方若在两次扫描之间改动过 root 下的文件,必须先调它。 */
export function resetScanCache() {
  scanCache.clear();
}

/**
 * 按 root 记忆化的全仓扫描包装。
 * @template T
 * @param {string} kind 缓存用途标签(仅供排查时辨识)
 * @param {string} root 仓库根绝对路径(分键)
 * @param {() => T} run 真正的扫描动作
 * @returns {T}
 */
function memoizedByRoot(kind, root, run) {
  const key = kind + "\u0001" + path.resolve(root);
  const hit = scanCache.get(key);
  if (hit !== undefined) return /** @type {T} */ (hit);
  const value = run();
  scanCache.set(key, value);
  return value;
}

/**
 * 扫三个子树的全部源文件,返回自算项目根的判红清单(已扣除单源与规则定义处两处豁免)。
 * @param {string} root 仓库根绝对路径
 * @returns {string[]} 判红文案(每条含仓库相对路径与行号)
 */
export function analyzeRootComputes(root) {
  return memoizedByRoot("root-computes", root, () => analyzeRootComputesUncached(root));
}

/** `analyzeRootComputes` 的未记忆化本体(见上方 scanCache 的生效前提)。 */
function analyzeRootComputesUncached(root) {
  const problems = [];
  for (const dir of ROOT_COMPUTE_SCAN_DIRS) {
    const abs = path.resolve(root, dir);
    if (!existsSync(abs)) continue;
    for (const { abs: fileAbs, file } of listSourceFiles(abs, ROOT_COMPUTE_EXTENSIONS)) {
      const rel = `${dir}/${file}`;
      // 单源自身:算自算是它的职责,豁免
      if (rel === ROOT_SOURCE_FILE) continue;
      // 规则定义处:正则表与自检样例含字面写法,豁免(理由见 ROOT_COMPUTE_SELF_EXEMPT)
      if (rel === ROOT_COMPUTE_SELF_EXEMPT) continue;
      for (const hit of findRootComputes(readFileSync(fileAbs, 'utf8'), { relPath: rel })) {
        problems.push(
          `${rel}:${hit.line} 自算项目根(${hit.id})—— 上跳基准落在仓库根,而项目根的单一来源是 ${ROOT_SOURCE_FILE},`
            + '请 import 它;按目录层级上跳的写法在目录改层级时会静默指错位置,而门禁查不出这种错',
        );
      }
    }
  }
  return problems;
}

/**
 * 规则 no-self-computed-root 的自检(纯判定层,不碰真实仓库之外的东西)。
 *
 * 为何需要:一条「按正则扫文本」的规则最危险的失效形态是**恒绿**(写错却什么都不报)。
 * 故此处在门禁自身的运行里固定两个方向的锚点 —— 造出自算样例必须命中、已收口的真实代码
 * 必须不命中 —— 任一方向失守即 exit 1。样例是内联字符串,不落盘、不进版本控制。
 *
 * 放在门禁本体而非测试段:test/segments/import-boundary.test.js 不在本泳道的可写范围,
 * 而没有自检的规则等于没有规则。
 * @param {string} root 仓库根绝对路径
 * @returns {string[]} 自检问题清单(空数组 = 两个方向都符合预期)
 */
export function selfCheckRootComputes(root) {
  const problems = [];
  // 造坏样例:四种语法形态各一,外加若干「该判绿」的对照。
  // 样例是 (relPath, text) 形式 —— relPath 不是装饰:深度判据要靠它算 ups === depth,
  // 只给文本不给路径的话深度恒为 0,深度判据就成了恒绿(正是本函数要防的失效形态)。
  // depth 与 ups 必须相等才判红,故坏样例的 relPath 深度与上跳数逐条对齐。
  const cases = [
    // ---- 形态一:链式单表达式(既有四条正则,不依赖 depth)----
    { name: 'new URL 上跳', relPath: 'gates/x.mjs', text: "const r = fileURLToPath(new URL('..', import.meta.url));\n", expect: 1 },
    { name: 'new URL 两级上跳', relPath: 'gates/x.mjs', text: 'const r = fileURLToPath(new URL("../..", import.meta.url));\n', expect: 1 },
    { name: 'dirname + resolve', relPath: 'gates/x.mjs', text: "const r = path.resolve(import.meta.dirname, '..');\n", expect: 1 },
    { name: 'dirname 连写链', relPath: 'gates/x.mjs', text: 'const r = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");\n', expect: 1 },
    { name: 'fileURLToPath 变体', relPath: 'gates/x.mjs', text: 'const r = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../x");\n', expect: 1 },
    // ---- 形态二:两语句式(origin 存进变量再上跳;depth 2 → ups 2)----
    {
      name: '两语句式(变量中转)',
      relPath: 'test/main/x.test.js',
      text: 'const here = path.dirname(fileURLToPath(import.meta.url));\n'
        + 'const root = path.resolve(here, "..", "..");\n',
      expect: 1,
    },
    // ---- 形态三:多行连写链、无变量(纯字面量正则;depth 2 → ups 2)----
    {
      name: '多行连写链(无变量)',
      relPath: 'test/main/x.test.js',
      text: 'const distMain = path.join(\n'
        + '  path.dirname(fileURLToPath(import.meta.url)),\n'
        + '  "..",\n'
        + '  "..",\n'
        + '  "dist",\n'
        + '  "main",\n'
        + ');\n',
      expect: 1,
    },
    // ---- 形态四:.cjs 隐式 __dirname(无声明句,靠 isCjs 特判;depth 1 → ups 1)----
    {
      name: '.cjs 隐式 __dirname',
      relPath: 'tools/x.cjs',
      text: 'const out = path.resolve(__dirname, "..", "out");\n',
      expect: 1,
    },
    // ---- 判绿对照 ----
    {
      name: '已收口写法(应判绿)',
      relPath: 'test/main/x.test.js',
      text: "import { ROOT } from '../common/paths.js';\nconst r = ROOT;\n",
      expect: 0,
    },
    {
      // ups !== depth:上跳落在 src/ 内而非仓库根,不是本规则要管的形态(ADR-040 只管根)
      name: 'ups 不等于 depth(落在包内,应判绿)',
      relPath: 'src/main/windows/x.ts',
      text: 'const here = path.dirname(fileURLToPath(import.meta.url));\n'
        + 'const p = path.resolve(here, "..", "preload.cjs");\n',
      expect: 0,
    },
    {
      // ups >= 1 守卫:深度 0 的顶层文件上,origin 变量被用作 path 基准但不带任何 ".."。
      // origin 必须是**声明出来的**那个变量(此处 .mjs 无隐式 __dirname,否则 collectOrigins
      // 收不到它,本夹具会因「基准压根不存在」而恒绿 —— 测不到 ups>=1 这一分支)。
      // 去掉守卫后 ups(0) === depth(0) 成立 → 变红,故本夹具对守卫有牙齿。
      name: '深度 0 且 ups 0(应判绿)',
      relPath: 'x.mjs',
      text: 'const here = path.dirname(fileURLToPath(import.meta.url));\n'
        + 'const p = path.join(here, "x");\n',
      expect: 0,
    },
    {
      // 字符串遮罩:合成夹具串里的写法不是可执行代码(ADR-041 先例)。
      // 两个刻意的写法约束,少任一条本夹具就恒绿且无牙齿(两次都实测踩到):
      // ① 不用 `const f = [ ... ]` 包裹 —— ORIGIN_DECL_RE 的 `[^;]*` 会从外层声明一路吞到
      //    串内第一个分号,把内层 origin 声明整个吞掉,collectOrigins 收不到它;
      //    改用 push 到已声明数组,每行独立成句,串内声明能被正则独立匹配。
      // ② 外层串用单引号、内层 ".." 用双引号 —— 若外层是双引号则内层须写成 \"..\",
      //    而 callArgs 的括号配平按词法跳过引号,遇到 \" 这种转义引号会算错配平范围,
      //    切出的实参不完整 → countUps 少数一个 → ups !== depth 恒不成立(实测 countUps 得 1)。
      // 去掉遮罩后 ups(2) === depth(2) 成立 → 变红,故本夹具对遮罩有牙齿。
      name: '字符串字面量内的写法(应判绿)',
      relPath: 'test/segments/x.test.js',
      text: 'const lines = [];\n'
        + 'lines.push(\'const sandbox = path.dirname(fileURLToPath(import.meta.url));\');\n'
        + 'lines.push(\'const root = path.resolve(sandbox, "..", "..", "dist");\');\n',
      expect: 0,
    },
  ];
  for (const testCase of cases) {
    const hits = findRootComputes(testCase.text, { relPath: testCase.relPath });
    if (hits.length !== testCase.expect) {
      problems.push(
        `自算根规则自检失守「${testCase.name}」:期望命中 ${testCase.expect} 处,实际 ${hits.length} 处`
        + `(规则恒绿或恒红都是失效)`,
      );
    }
  }
  // 反向锚点:真实仓库当前必须零命中(证明规则没把已收口的代码误判红)
  const real = analyzeRootComputes(root);
  if (real.length > 0) {
    problems.push(`自算根规则自检失守:真实仓库应零自算写法,实际 ${real.length} 处:${real.slice(0, 3).join(' | ')}`);
  }
  // 两处豁免的存在性:单源与规则定义处。拼错路径会让豁免静默失效(规则恒红)或
  // 恒绿(豁免了不该豁免的文件),两种都是失效,故在此钉住。
  // ADR-040 删表后不再有「沙盒副本豁免」,故此处只校验这两处。
  for (const [rel, what] of [[ROOT_SOURCE_FILE, '项目根单源'], [ROOT_COMPUTE_SELF_EXEMPT, '规则定义处']]) {
    if (!existsSync(path.resolve(root, rel))) {
      problems.push(`自算根规则自检失守:${what}不存在:${rel}(豁免将静默失效)`);
    }
  }
  return problems;
}

// ===== 树边界规则(ADR-038 / ADR-043)=====

/**
 * 逻辑树名 → 实际目录名。规则表按**逻辑名**书写、判定时才换实际目录名,
 * 树改名(逻辑名 gates ↔ 实际目录名)只改这一行,避免改名漏改诊断文案里的路径。
 * @type {Readonly<Record<string, string>>}
 */
export const TREE_DIRS = Object.freeze({ gates: 'gates', test: 'test', shared: 'shared', tools: 'tools' });

/**
 * 允许面里可用、但**没有对应顶层目录规则**的字面前缀。
 *
 * `dist` 是编译产物目录 —— 它与 ADR-044 当年一并归入本组的 `build/` `dev/` **并不同形**:
 * `dist` 是输出(可被引用,自身无出边),而那两棵是有出边的代码树。ADR-050 把两棵树
 * 合并为受管树 `tools/` 后,本组只剩真同形的 `dist`,判据名与内容重新对齐。
 */
export const TREE_BOUNDARY_LITERAL_PREFIXES = Object.freeze(['dist']);

/**
 * 树边界规则表,判据形态是 **allow-list**(允许面之外一律判红),
 * 与 LAYER_RULES 的 deny-list 语义相反,故分表不合并 —— 同一张表里放两种
 * 语义相反的判据会产生读法歧义。
 *
 * 为什么必须是 allow-list:deny-list 要逐个枚举 test/ 下的子目录,而新增任何
 * 子目录都不在枚举内 —— 那就退化成一次「枚举已知」,新目录静默放行。allow-list
 * 让新目标默认非法,无需登记即被拦。
 */
export const TREE_RULES = Object.freeze([
  {
    id: 'gates-stay-in-gates',
    scope: 'gates',
    reason: '门禁树只许引用门禁树自身、共享机制层,以及测试树的夹具数据(只读)',
    // 允许面里保留死条目 `test/fixtures`:ADR-062 P3 已把数据区搬到顶层 `samples/`,但
    // **实测没有任何 import 说明符指向 samples/** —— 样例是静态数据(图片 / md),230 处
    // 消费方全部经 shared/paths.js 的 FIXTURES_DIR 常量取路径,而该常量已改指 samples/。
    // 故这里不需要换成 'samples';而换成 'samples' 会让本规则的自检判红(见下方
    // selfCheckTreeRules:允许元素首段必须是已登记树名或字面前缀 dist,samples 两者皆非
    // —— 把新顶层树登记进去属 ADR-062 P3 的后续子步)。死条目无害:允许面是 allow-list,
    // 多列一项只会更宽松,而当前无人用到它。
    allow: Object.freeze(['gates', 'shared', 'test/fixtures']),
  },
  {
    id: 'test-stay-in-test',
    scope: 'test',
    reason: '测试树可引编译产物(dist)、工具树(tools)、共享机制层,以及门禁树的驱动器级纯静态函数',
    allow: Object.freeze(['test', 'dist', 'tools', 'shared', 'gates']),
  },
  {
    id: 'tools-stay-in-tools',
    scope: 'tools',
    reason: '工具树零跨树出边(ADR-050):只许引用自身与共享机制层',
    allow: Object.freeze(['tools', 'shared']),
  },
  {
    id: 'shared-no-out-edge',
    scope: 'shared',
    reason: '共享机制层的「零出边」精确为**零跨树出边**:树内互依与 node: 内建放行',
    allow: Object.freeze(['shared']),
  },
]);

const TREE_SCAN_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs']);

/**
 * 把允许面元素(逻辑树名)解析成实际的仓库相对前缀。
 * 首段是已登记树名则换成实际目录名,否则按字面前缀处理。
 * @param {string} element 允许面元素,如 'gates' / 'samples' / 'dist'
 * @returns {string} 实际的仓库相对 POSIX 前缀
 */
function resolveAllowedPrefix(element) {
  const segments = element.split('/');
  const [head, ...rest] = segments;
  const actualHead = Object.hasOwn(TREE_DIRS, head) ? TREE_DIRS[head] : head;
  return [actualHead, ...rest].join('/');
}

/**
 * 抽一个文件里全部**相对说明符** import 及其行号。
 * 复用既有三条正则,另用 `d` 标志取捕获组的精确下标换算行号 —— 不用 indexOf
 * 反推:文档字符串里含相同引号字符时 indexOf 会算错位置,而那恰是要处理的形态。
 * 多行 import(`import {\n a\n} from 'x'`)的行号取 from 那一行,故按 spec 位置算。
 * @param {string} text 已抹注释的源码文本
 * @returns {{ spec: string, line: number }[]}
 */
function collectRelativeImportsWithLine(text) {
  /** @param {number} index 字符下标 → 行号(从 1 起) */
  const lineAt = (index) => {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) line += 1;
    }
    return line;
  };
  /** @type {{ spec: string, line: number }[]} */
  const out = [];
  /** @param {RegExp} re @param {number} groupIndex 捕获组号 */
  const scan = (re, groupIndex) => {
    // 只剥 sticky(y 会把扫描锚在 lastIndex 上,与整段扫描不符);保留 g —— matchAll 要求它
    const withIndex = new RegExp(re.source, `${re.flags.replace(/y/g, '')}d`);
    for (const match of text.matchAll(withIndex)) {
      const range = match.indices[groupIndex];
      if (range == null) continue;
      out.push({ spec: match[groupIndex], line: lineAt(range[0]) });
    }
  };
  scan(FROM_RE, 4);
  scan(SIDE_EFFECT_RE, 2);
  scan(REQUIRE_RE, 1);
  return out;
}

/**
 * 扫三棵树的跨树 import,返回判红项。
 *
 * 喂 `lexSource(...).code`(已抹注释):文档/注释里为说明「历史上长这样」而写的
 * specifier 不是可执行依赖,判红它只会逼人把注释改写得更含糊。cjs 一并覆盖,
 * 免得 .cjs 的 require() 走另一条判据。
 * @param {string} root 被扫描仓库的根(锚在 --package 所在仓库,见 main)
 * @returns {string[]} 判红项(空数组 = 通过)
 */
export function analyzeTreeBoundaries(root) {
  return memoizedByRoot("tree-boundaries", root, () => analyzeTreeBoundariesUncached(root));
}

/** `analyzeTreeBoundaries` 的未记忆化本体(见上方 scanCache 的生效前提)。 */
function analyzeTreeBoundariesUncached(root) {
  /** @type {string[]} */
  const problems = [];
  for (const rule of TREE_RULES) {
    const scopeDir = TREE_DIRS[rule.scope];
    const scopeRoot = path.join(root, scopeDir);
    if (!existsSync(scopeRoot)) continue;
    const allowed = rule.allow.map(resolveAllowedPrefix);
    for (const { abs, file } of listSourceFiles(scopeRoot, TREE_SCAN_EXTENSIONS)) {
      const relPath = `${scopeDir}/${file}`;
      const code = lexSource(readFileSync(abs, 'utf8')).code;
      for (const { spec, line } of collectRelativeImportsWithLine(code)) {
        if (classifySpecifier(spec).kind !== 'relative') continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), spec));
        // 按**路径段**比而非 startsWith:否则 samples-old/ 会被 samples 放行
        const ok = allowed.some((prefix) => target === prefix || target.startsWith(`${prefix}/`));
        if (ok) continue;
        problems.push(
          `${relPath}:${line}:import「${spec}」(解析为 ${target})越出 ${scopeDir}/ 的允许面`
            + `(只许 ${allowed.join('、')});违反树边界规则 ${rule.id}`,
        );
      }
    }
  }
  return problems;
}

/**
 * 树边界规则的存在性自检:「扫不到就等于没规则」是这类判据最危险的失效形态,
 * 故每次 check:boundary 都验各棵树齐备、规则表覆盖完整、允许元素的首段不是拼错的树名。
 *
 * 这里同时挂**层向** allow-list(SRC_TOP_LAYERS)的存在性自检,前缀刻意与树边界那条
 * 分开(`层向规则自检失守:` 而非 `树边界规则自检失守:`):前者判的是 `src/` 内各层是否
 * 受层向规则治理,与仓根四棵树无关,混用前缀会让诊断把人引到错误的树上去找原因。
 * @param {string} root 被扫描仓库的根
 * @returns {string[]} 自检问题(空数组 = 通过)
 */
export function selfCheckTreeLayout(root) {
  /** @type {string[]} */
  const problems = [];
  const known = [...Object.keys(TREE_DIRS), ...TREE_BOUNDARY_LITERAL_PREFIXES];

  // 层向 allow-list 的自检:合成顶层目录清单,正反两个方向都钉死(形态同 selfCheckRootComputes:
  // 内联表 + expect + 文案模板,样例是字符串不落盘、不进版本控制)。
  // 清单**刻意不展开 SRC_TOP_LAYERS**:自检锚点必须独立于被检常量,否则常量写漏一个名字时
  // 夹具跟着写漏 → 恒绿(正是本函数要防的失效形态)。恒红方向由「全部已登记」那条兜住。
  const layerCases = [
    { name: '全部已登记(应判绿)', dirs: ['cli', 'convert', 'core', 'main', 'mcp', 'renderer'], expect: 0 },
    { name: '多出一个未登记顶层(应判红)', dirs: ['cli', 'convert', 'core', 'main', 'mcp', 'renderer', 'omega'], expect: 1 },
    { name: '两个未登记顶层(应判红)', dirs: ['core', 'main', 'renderer', 'omega', 'psi'], expect: 2 },
  ];
  for (const testCase of layerCases) {
    const hits = findUnregisteredSrcLayers(testCase.dirs);
    if (hits.length !== testCase.expect) {
      problems.push(
        `层向规则自检失守「${testCase.name}」:期望命中 ${testCase.expect} 处,实际 ${hits.length} 处`
        + '(规则恒绿或恒红都是失效)',
      );
    }
  }
  // 反向锚点:真实仓库的 src/ 顶层必须全部已登记(未登记即新树静默放行)
  for (const line of analyzeSrcTopLayers(path.join(root, 'src'))) {
    problems.push(`层向规则自检失守:${line}`);
  }

  for (const rule of TREE_RULES) {
    const scopeDir = TREE_DIRS[rule.scope];
    if (!existsSync(path.join(root, scopeDir))) {
      problems.push(`树边界规则自检失守:${rule.id} 的 scope 目录不存在:${scopeDir}/(规则形同虚设)`);
    }
    for (const element of rule.allow) {
      const head = element.split('/')[0] ?? '';
      if (!known.includes(head)) {
        problems.push(
          `树边界规则自检失守:${rule.id} 的允许元素「${element}」首段既不是已登记树名`
            + `(${Object.keys(TREE_DIRS).join('/')})也不是字面前缀(${TREE_BOUNDARY_LITERAL_PREFIXES.join('/')})`
            + '—— 拼错的树名会退化成字面量、整条规则恒绿',
        );
      }
    }
  }
  return problems;
}

export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['help'], values: ['src', 'package', 'flavor'] });
  } catch (error) {
    console.error(`[boundary:fail] ${error.message}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const flavor = options.flavor ?? 'src';
  if (!Object.hasOwn(FLAVORS, flavor)) {
    console.error(`[boundary:fail] 未知形态:${flavor}(只接受 ${Object.keys(FLAVORS).join('/')})`);
    return 1;
  }

  const root = path.resolve(projectRoot, options.src ?? 'src');
  const pkgPath = path.resolve(projectRoot, options.package ?? 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    console.error(`[boundary:fail] 依赖声明不可读:${pkgPath}(${error.message})`);
    return 1;
  }

  let result;
  try {
    result = analyze(root, pkg, FLAVORS[flavor]);
  } catch (error) {
    console.error(`[boundary:fail] 扫描失败:${error.message}`);
    return 1;
  }
  // 规则 no-self-computed-root:固定锚在真实仓库,与 --src/--flavor 无关(理由见 ROOT_COMPUTE_SCAN_DIRS)
  let rootComputeProblems;
  try {
    rootComputeProblems = analyzeRootComputes(projectRoot);
    const selfCheckProblems = selfCheckRootComputes(projectRoot);
    if (selfCheckProblems.length > 0) {
      for (const problem of selfCheckProblems) console.error(`[boundary:fail] ${problem}`);
      return 1;
    }
  } catch (error) {
    console.error(`[boundary:fail] 项目根单源扫描失败:${error.message}`);
    return 1;
  }
  // 规则 gates-stay-in-gates / test-stay-in-test / shared-no-out-edge:与 --src/--flavor 无关,
  // 固定锚在真实仓库(理由同 ROOT_COMPUTE_SCAN_DIRS):树边界守的是**本仓的三棵树**,
  // 而 --src/--package 描述的是「某个子树的某次局部扫描」—— 沙盒只铺 src/ 一棵树,
  // 让它参与树边界判定会因「缺 test/ 与 shared/」而恒红,反而掩盖 src 层的真实诊断。
  let treeBoundaryProblems;
  try {
    treeBoundaryProblems = analyzeTreeBoundaries(projectRoot);
    const layoutProblems = selfCheckTreeLayout(projectRoot);
    if (layoutProblems.length > 0) {
      for (const problem of layoutProblems) console.error(`[boundary:fail] ${problem}`);
      return 1;
    }
  } catch (error) {
    console.error(`[boundary:fail] 树边界扫描失败:${error.message}`);
    return 1;
  }
  // 层向文本判据(LAYER_TEXT_RULES)的双向自检:纯判定层,与 --src/--flavor 无关,
  // 也不需要真实仓库(自检夹具全是内联串)。故不并进上面的 analyze try 块 ——
  // analyze 抛错时的诊断是「扫描失败」,把自检失守混进去会让两类原因不可分。
  try {
    const textSelfCheckProblems = selfCheckTextLayerRules();
    if (textSelfCheckProblems.length > 0) {
      for (const problem of textSelfCheckProblems) console.error(`[boundary:fail] ${problem}`);
      return 1;
    }
  } catch (error) {
    console.error(`[boundary:fail] 层向文本判据自检失败:${error.message}`);
    return 1;
  }
  for (const line of result.info) console.log(`[info] boundary:${line}`);
  // pending 命中汇总:必须独立成行。逐处 info 行只在 info 非空时才有,而「零命中」与
  // 「有命中但被静默吞掉」在那一处无从区分 —— 退出码两者都是 0,故这里显式报出
  // 「有 N 条 pending 规则当前命中 M 处(不判红)」,让「知道但暂时放过」可见。
  // 这行只在有命中时打:pending 规则当前干净时不必噪声,但也不靠它证明「零命中」
  // (那条反向锚点由门禁内的自检与验收段各自独立承担)。
  if (result.pendingHits.size > 0) {
    const total = [...result.pendingHits.values()].reduce((sum, n) => sum + n, 0);
    const detail = [...result.pendingHits.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, count]) => `${id} ${count} 处`)
      .join('、');
    console.log(
      `[info] boundary:pending 规则当前命中 ${total} 处(共 ${result.pendingHits.size} 条规则:${detail})`
        + '—— 本阶段只报告不判红(不进 problems、不参与退出码);'
        + 'T2 搬完文件后逐条删掉对应规则的 `pending: true` 即转 fail-closed,删标记就是 T2 的进度记录',
    );
  }
  const allProblems = [...result.problems, ...rootComputeProblems, ...treeBoundaryProblems];
  if (allProblems.length > 0) {
    for (const problem of allProblems) console.error(`[boundary:fail] ${problem}`);
    console.error(`[boundary:fail] 依赖声明与 import 层向自检失败,共 ${allProblems.length} 项`);
    return 1;
  }
  const scopeText = flavor === 'src' ? 'src' : 'dist 产物';
  console.log(
    `[ok] import 边界自检通过(${scopeText}):`
      + `运行时 import 的包均在 dependencies(host 内建 ${Object.keys(HOST_PROVIDED_RUNTIME).join('/')} 除外);`
      + `core 不依赖宿主且不反向依赖 GUI 两层;`
      + `convert 是 headless 装配层,不反向依赖 main/renderer;`
      + `convert 自身零 electron import(判据 convert-no-host)且零逃出 src/ 的相对依赖(判据 convert-no-outside-src,按解析结果判、深度无关);`
      + `renderer 不反向依赖 main;main 不反向依赖 renderer;preload 不上跳引用 main;`
      + `cli/mcp 两个进程外交付面(同层 adapter)不引用 renderer、不 import electron、不逃出 src/;`
      + `smoke 不逃出 src/;`
      + `renderer 基础层(dom/state)不反向依赖功能目录;`
      + `core 的 pdf 渲染路径不 import node:fs(能力经入参注入);`
      + `core 内部目录准入、core/i18n 的 DOM 使用面、main/windows 不上跳 menu`
      + `—— 当前这 ${[...LAYER_RULES, ...LAYER_TEXT_RULES].filter((r) => r.pending === true).length} 条判据带 pending 标记(条数由规则表派生,转正一条即自动少一条,不手数),本阶段只报告不判红(命中数见上方 pending 汇总行),`
      + `T2 删掉标记即转 fail-closed;`
      + `新层(convert/cli/mcp)零 app.getPath / getAppPath 调用(判据 headless-no-app-getpath);`
      + `新层零 Windows 专属能力:环境变量清单 ${WINDOWS_ONLY_ENV_VARS.length} 项`
      + `(${WINDOWS_ONLY_ENV_VARS.join('/')})、子进程可执行文件清单 ${WINDOWS_ONLY_EXECUTABLES.length} 项`
      + `(${WINDOWS_ONLY_EXECUTABLES.join('/')})(判据 headless-no-windows-only);`
      + `core 的 node: 内建白名单限 ${CORE_NODE_BUILTIN_FILES.length} 个文件;`
      + `项目根单源为 ${ROOT_SOURCE_FILE}(零豁免,ADR-040);`
      + `src/ 顶层层向 allow-list(未登记即判红):${SRC_TOP_LAYERS.join('/')};`
      + `树边界(ADR-038/043)按实际目录名:`
      + TREE_RULES.map((rule) => `${TREE_DIRS[rule.scope]}→${rule.allow.map(resolveAllowedPrefix).join('/')}`).join(';'),
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
