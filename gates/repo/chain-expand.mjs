// npm script 链解析的**全仓单源**:递归展开、顶层视图、叶子命令三种语义共用一份实现。
//
// 为什么必须收敛到一处(REQ-111):链解析此前有 5 份独立实现 —— 递归 2 份
// (check-ci-contract.mjs 的 expandScript 与 registry.mjs 的 expand),外加 3 处扁平
// `split('&&')`(check-ci-contract.mjs 自身重复的 topLevelScriptNames 两份 +
// 探针 gates/coverage.mjs 取 c8 参数向量那处)。**扁平的那些只认单层**:一旦有人为了省
// 验证耗时把链上某几步包进子脚本(`verify:ci` → `npm run ci:static` → 内层三道门禁),
// 它们就看不见内层 —— 于是「门禁在链上」被静默降级成「门禁不在链上」,而没有任何东西判红。
// 那不是冗余代码问题,是判据在特定链形态下恒真的问题。
//
// 三种语义(一份实现,不是三个实现):
//   expandChainScriptNames  递归全展开(script 名执行序)—— 断言「某门禁在链内、且在某步之后」。
//                            成环与未定义都回报给调用方,不静默跳过(静默跳过 = 恒绿)。
//   topLevelScriptNames     **只取顶层直接子 script,不递归** —— 断言链的「形态」而非「成员」。
//                            唯一用户是「verify:release 须恰为 verify:ci + dist」:那条断言要的
//                            正是「发布没有自行拼第二份清单」,递归化会把它变成「展开后成员相同」,
//                            从而放过「verify:release 自己重排并复制了内层步骤」这种真实漂移。
//                            故这两种语义必须并存,不得互相顶替。
//   walkChain               通用遍历(逐 script 进入 + 逐叶子命令),上两者与探针的
//                            「c8 参数向量取自 package.json 的 test:coverage」都从它派生。
//
// 刻意零依赖、零 IO:scripts 表由调用方给。本模块**不读 package.json、不取项目根** ——
// ADR-040 规定项目根的单一来源是 shared/paths.js,而这里根本不需要它(需要根的判据在
// 调用方那一侧,它们已经各自 import 单源了)。
//
// 成环保护:按**祖先栈**判定(`Set` 语义的数组栈),不是「访问过就不再进」。后者会把菱形
// 依赖(两个不同父都调同一子脚本)误判成环并丢掉第二次出现,而链内成员计数类断言
// (「全量验收段恰跑一遍」)依赖重复项被如实计出。旧 registry 实现对真成环其实**没有**
// 保护(`seen` 存的是链路径串,a → b → a 的路径串永不重复 ⇒ 无限递归),本模块的祖先栈
// 判定严格强于它。

/**
 * npm script 链的**根**(展开面 = 这三条链的全部 `npm run` 子链)。
 *
 * ⚠ **`gates/probe/gate-probes/registry.mjs:39` 另有一份逐字相同的副本,待 S3 改为从此处 import。**
 * 本条之所以先落在这里而不是留在注册表侧:门禁的「链归属」判据(L12)要读链根,而那段判定
 * 本体住在 `gates/repo/check-test-layout.mjs`;注册表侧与判定侧各写一份链根表,就是本仓反复
 * 批过的那种「两份可漂移的副本」—— 链根少一条时 L12 会在**零诊断**的情况下退化成「什么都不查」
 * (门禁从那一刻起恒绿),而没有任何东西会报红。把定义放在链解析本模块里,两个消费方从同一处取,
 * 漂移面收敛到「复制的那一份」这一个点,且它有 grep 锚。
 *
 * 三条链的语义(为什么正好是这三条):`verify:ci` 是 CI 的验收入口、`verify:release` 是发布入口
 * (形态断言要求它恰为 `verify:ci` + `dist`,见文件头)、`dist` 是打包与产物校验那一段。
 * **新增一条链根必须同改这里** —— 它是「门禁在不在链上」这条判据的判定面,漏改则那条判据对
 * 新链恒真。
 *
 * @type {readonly string[]}
 */
export const CHAIN_ROOTS = Object.freeze(["verify:ci", "verify:release", "dist"]);

/**
 * 整段就是 `npm run [开关…] <name>` 时,取其 script 名。
 *
 * 允许脚本名前夹带 npm 开关(`--silent` 抑制 run 头噪声):开关不参与脚本名捕获。
 * 取两处旧实现中**较宽**的那一形态(registry 侧):宽的一侧只会让链解析多看见东西,
 * 窄的一侧会让 `npm run --silent check:x` 在链上凭空消失(那正是本模块要消灭的失效形态)。
 * 段内夹杂其它命令(`foo && npm run bar` 之外的形态、`npm run a b`)不算嵌套调用 ——
 * npm run 的位置参数只有一个,`npm run a b` 实为多传一个参数,按原样当叶子命令更接近真实执行。
 */
const NESTED_RE = /^npm run (?:-{1,2}[\w-]+ )*([\w:.-]+)$/;

/**
 * 一段命令里嵌套的 script 名。
 * @param {string} segment 已 trim 的命令段
 * @returns {string | null} 嵌套的 script 名;不是纯 `npm run` 段则 null
 */
function nestedName(segment) {
  const m = NESTED_RE.exec(segment);
  return m === null ? null : m[1];
}

/**
 * script 正文按 `&&` 切成命令段(逐段 trim,不改写内容)。
 *
 * 刻意不做 shell 语义解析(引号 / 转义 / `||` / 管道):本仓的门禁链一律写成扁平的
 * `a && npm run b && c`,而任何「更聪明」的切法都会让「门禁在不在链上」这条判据在
 * 链形态变化时给出与真实执行不一致的答案。切不出来就当叶子命令交给调用方,判据因此
 * 只会偏保守(看不见内层),不会偏激进(凭空认定内层存在)。
 * @param {string | undefined} body script 正文
 * @returns {string[]} 命令段(顺序即书写序)
 */
function segments(body) {
  if (body === undefined) return [];
  return String(body).split('&&').map((part) => part.trim());
}

/**
 * @typedef {object} ChainNode 遍历到的一个 script
 * @property {string} name script 名
 * @property {string[]} path 从链根到该节点的 script 名序列(含首尾)
 * @property {boolean} defined 该 script 是否在 scripts 表里
 */

/**
 * @typedef {object} ChainLeaf 一个叶子命令段(不是 `npm run` 的段)
 * @property {string} script 所属 script 名
 * @property {string} text 命令原文(已 trim)
 */

/**
 * @typedef {object} ChainWalkHandlers 遍历回调(全部可选;缺省即不消费那一类事件)
 * @property {(node: ChainNode) => void} [onEnter] 进入一个 script。**先于它的内容**触发,
 *   且先于成环/未定义判定 —— 两处旧实现都是「先把名字收下,再发现问题」,顺序反过来会
 *   让「成环链的名字」从链视图里消失。
 * @property {(leaf: ChainLeaf) => void} [onLeaf] 遇到一个非 `npm run` 的命令段(深度优先,
 *   按段在正文里的位置下潜,故叶子序列就是真实执行序)。
 * @property {(name: string) => void} [onMissing] 引用了 scripts 表里没有的 script
 * @property {(path: string[]) => void} [onCycle] 撞上祖先(给出完整环路径,首尾同名)
 */

/**
 * 深度优先遍历一条 npm script 链。
 *
 * 遍历序 = 真实执行序的深度优先投影:进入 script → 逐段处理 → 段是 `npm run` 就下潜,
 * 否则作为叶子命令交出去。**成环保护按祖先栈**判定(见文件头注:为什么不能用「访问过就跳过」)。
 * @param {Record<string, string>} scripts package.json 的 scripts 表
 * @param {string} root 链根 script 名
 * @param {ChainWalkHandlers} [handlers] 遍历回调
 * @returns {void}
 */
export function walkChain(scripts, root, handlers = {}) {
  /**
   * @param {string} name 当前 script 名
   * @param {string[]} stack 祖先 script 名序列(不含 name 自身)
   * @returns {void}
   */
  const walk = (name, stack) => {
    const body = scripts[name];
    const node = { name, path: [...stack, name], defined: body !== undefined };
    handlers.onEnter?.(node);
    if (stack.includes(name)) {
      handlers.onCycle?.([...stack, name]);
      return;
    }
    if (body === undefined) {
      handlers.onMissing?.(name);
      return;
    }
    for (const segment of segments(body)) {
      const child = nestedName(segment);
      if (child === null) {
        handlers.onLeaf?.({ script: name, text: segment });
        continue;
      }
      walk(child, [...stack, name]);
    }
  };
  walk(root, []);
}

/**
 * 递归全展开:返回链上**除根以外**全部 script 名的执行序(深度优先,重复项如实保留)。
 *
 * 「重复项如实保留」是有判据依赖的:契约门禁的「全量验收段恰跑一遍」按展开后的名字精确
 * 计数,若这里做了去重,同一个子脚本被两处调用就会被记成一次,断言自欺。
 * @param {Record<string, string>} scripts package.json 的 scripts 表
 * @param {string} root 链根 script 名
 * @param {Omit<ChainWalkHandlers, "onEnter" | "onLeaf">} [handlers] 只关心异常回报时用
 * @returns {string[]} script 名执行序
 */
export function expandChainScriptNames(scripts, root, handlers = {}) {
  /** @type {string[]} */
  const names = [];
  let rootSeen = false;
  walkChain(scripts, root, {
    ...handlers,
    onEnter: (node) => {
      // 根自身不是链上的一步(它是被请求的入口),故第一项跳过
      if (rootSeen) names.push(node.name);
      else rootSeen = true;
    },
  });
  return names;
}

/**
 * 顶层视图:`name` 正文里**直接**调用的子 script 名(不递归)。
 *
 * 唯一用户是「verify:release 须恰为 verify:ci + dist」那条形态断言,理由见文件头。
 * `missing` 单独返回而不直接判红:摘要行(绿色输出)消费同一个函数,它对「脚本未定义」
 * 的处置是留空而不是报错 —— 判红权归判定本体那一侧。
 * @param {Record<string, string>} scripts package.json 的 scripts 表
 * @param {string} name script 名
 * @returns {{ names: string[], missing: boolean }} 顶层子 script 名 + 该 script 是否已定义
 */
export function topLevelScriptNames(scripts, name) {
  const body = scripts[name];
  if (body === undefined) return { names: [], missing: true };
  const names = [];
  for (const segment of segments(body)) {
    const child = nestedName(segment);
    if (child !== null) names.push(child);
  }
  return { names, missing: false };
}
