// 最小 semver 判定器(判重规则唯一的「版本是否落在声明范围内」判据)。
//
// 为什么不引 semver 包:那不是本仓声明的依赖(它是 electron-builder/npm 的传递依赖),
// 发布门禁脚本不该靠未声明的包跑。
//
// 为什么必须自己判:判重要区分「合法并存」与「真缺陷」,判据就是「某版本是否满足某声明
// 范围」。判错的方向是确定的:宁可漏报也不要把正常依赖搞成红灯 —— 故覆盖不到的形态
// 一律返回 null = **判不了**,由调用方走「不可判定 → 只报信息、不判红」。
//
// 覆盖形态(本仓依赖声明里实测出现的 12 种):`^` `~` `>=` `>` `<=` `<` `=`、裸版本、
// 缺省段 `N` / `N.N`、连字符范围 `A - B`、空格并列(AND)、`||` 并列(OR)、`*`。
// 不覆盖(→ null):预发布与构建元数据的范围比较、URL/git/别名(`npm:pkg@x`)、
// `workspace:`、以及本模块刻意不支持的复杂交集写法。
//
// 叶子层:不 import 任何判定层或装配层。

/**
 * 最小 semver 判定器:只覆盖依赖声明里实际出现的形态(`^` `~` `>=` `>` `<=` `<` `=`
 * 裸版本、缺省段 `N`/`N.N`、连字符范围 `A - B`、空格并列(AND)、`||` 并列(OR)、`*`)。
 *
 * 覆盖不到的形态(预发布/构建元数据/URL/别名/workspace: 等)返回 null = **判不了**,
 * 调用方据此走「不可判定 → 只报信息、不判红」:宁可漏报,也不要把正常依赖搞成红灯。
 * 不引 semver 包:那不是本仓声明的依赖。
 *
 * @param {string} version 具体版本
 * @param {string} range 范围字面量
 * @returns {boolean | null} 是否满足;判不了返回 null
 */
export function satisfiesRange(version, range) {
  const target = parseSemver(version);
  if (target === null || typeof range !== 'string') return null;
  const text = range.trim();
  if (text === '') return true;
  const alternatives = text.split('||');
  /** @type {boolean[]} */
  const results = [];
  for (const alternative of alternatives) {
    const verdict = satisfiesAlternative(target, alternative.trim());
    if (verdict === null) return null;
    results.push(verdict);
  }
  return results.some(Boolean);
}

/**
 * 解析完整版本号(带预发布/构建元数据的一律判不了,交由调用方走不可判定路径)。
 * @param {string} text 版本文本
 * @returns {{ major: number, minor: number, patch: number, pre: string | null } | null} 版本
 */
function parseSemver(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? null,
  };
}

/**
 * 版本比较(只处理无预发布的两端)。
 * @param {{major: number, minor: number, patch: number, pre: string | null}} a 左
 * @param {{major: number, minor: number, patch: number, pre: string | null}} b 右
 * @returns {number} -1 / 0 / 1
 */
function compareSemver(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * 缺省段版本下界(把 `1` / `1.2` 补成 `1.0.0` / `1.2.0`)。
 * @param {{major: number, minor: number | null, patch: number | null}} partial 缺省段版本
 * @returns {{major: number, minor: number, patch: number, pre: null}} 补全后的版本
 */
function lowerBound(partial) {
  return { major: partial.major, minor: partial.minor ?? 0, patch: partial.patch ?? 0, pre: null };
}

/**
 * 缺省段版本上界(开区间上界):`1` → 2.0.0,`1.2` → 1.3.0,`1.2.3` → 无上界(返回 null)。
 * @param {{major: number, minor: number | null, patch: number | null}} partial 缺省段版本
 * @returns {{major: number, minor: number, patch: number, pre: null} | null} 上界
 */
function partialUpperBound(partial) {
  if (partial.minor === null) return { major: partial.major + 1, minor: 0, patch: 0, pre: null };
  if (partial.patch === null) return { major: partial.major, minor: partial.minor + 1, patch: 0, pre: null };
  return null;
}

/**
 * 解析缺省段版本字面量(`1` / `1.2` / `1.2.3` / `1.x` / `*`)。
 * @param {string} text 文本
 * @returns {{major: number, minor: number | null, patch: number | null} | null} 解析结果
 */
function parsePartialVersion(text) {
  const wildcard = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(text.trim());
  if (wildcard === null) return null;
  const minor = wildcard[2];
  const patch = wildcard[3];
  return {
    major: Number(wildcard[1]),
    minor: minor === undefined || /[xX*]/.test(minor) ? null : Number(minor),
    patch: patch === undefined || /[xX*]/.test(patch) ? null : Number(patch),
  };
}

/**
 * 判定单个并列项(AND 串,可含连字符范围)。
 * @param {{major: number, minor: number, patch: number, pre: string | null}} target 目标版本
 * @param {string} alternative 并列项
 * @returns {boolean | null} 是否满足;判不了返回 null
 */
function satisfiesAlternative(target, alternative) {
  if (target.pre !== null) return null;
  const hyphen = /^(.+?)\s+-\s+(.+)$/.exec(alternative);
  if (hyphen !== null) {
    const low = parsePartialVersion(String(hyphen[1]));
    const high = parsePartialVersion(String(hyphen[2]));
    if (low === null || high === null) return null;
    const upper = partialUpperBound(high) ?? lowerBound(high);
    return compareSemver(target, lowerBound(low)) >= 0 && compareSemver(target, upper) < 0;
  }
  const tokens = alternative.split(/\s+/).filter((token) => token !== '');
  for (const token of tokens) {
    const verdict = satisfiesComparator(target, token);
    if (verdict === null) return null;
    if (!verdict) return false;
  }
  return true;
}

/**
 * 判定单个比较项。
 * @param {{major: number, minor: number, patch: number, pre: string | null}} target 目标版本
 * @param {string} token 比较项
 * @returns {boolean | null} 是否满足;判不了返回 null
 */
function satisfiesComparator(target, token) {
  const operatorMatch = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(token);
  if (operatorMatch === null) return null;
  const operator = operatorMatch[1] ?? '=';
  const rest = String(operatorMatch[2]).trim();
  if (rest === '' || rest === '*' || rest === 'x' || rest === 'X') return true;
  const partial = parsePartialVersion(rest);
  if (partial === null) return null;
  const low = lowerBound(partial);
  const upper = partialUpperBound(partial);
  if (operator === '^') {
    // caret 语义(与 npm 一致):0.0.x 锁补丁、0.x.y 锁次版本、其余锁主版本
    /** @type {{major: number, minor: number, patch: number, pre: null}} */
    let bound;
    if (partial.minor === null) bound = { major: partial.major + 1, minor: 0, patch: 0, pre: null };
    else if (partial.major !== 0) bound = { major: partial.major + 1, minor: 0, patch: 0, pre: null };
    else if (partial.patch === null) bound = { major: 0, minor: partial.minor + 1, patch: 0, pre: null };
    else if (partial.minor === 0) bound = { major: 0, minor: 0, patch: partial.patch + 1, pre: null };
    else bound = { major: 0, minor: partial.minor + 1, patch: 0, pre: null };
    return compareSemver(target, low) >= 0 && compareSemver(target, bound) < 0;
  }
  if (operator === '~') {
    const bound = upper ?? { major: partial.major + 1, minor: 0, patch: 0, pre: null };
    return compareSemver(target, low) >= 0 && compareSemver(target, bound) < 0;
  }
  if (operator === '>=') return compareSemver(target, low) >= 0;
  if (operator === '>') return upper === null ? compareSemver(target, low) > 0 : compareSemver(target, upper) >= 0;
  if (operator === '<=') {
    return upper === null ? compareSemver(target, low) <= 0 : compareSemver(target, upper) < 0;
  }
  if (operator === '<') return upper === null ? compareSemver(target, low) < 0 : compareSemver(target, upper) < 0;
  // `=` / 裸版本:缺省段给出闭区间
  if (upper === null) return compareSemver(target, low) === 0;
  return compareSemver(target, low) >= 0 && compareSemver(target, upper) < 0;
}
