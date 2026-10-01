// @ts-check
// Release notes 抽取(纯判定层,无 IO 副作用;IO 由 main() 注入)。
//
// 为什么从 release.yml 里搬出来成模块:原实现是 workflow 里一段内联 `node -e`,
// 没有单测、没有自检,于是它的失效形态是**静默取到错的内容**——见下。
//
// 原实现的判据是「取第一个带日期的版本头」:
//   /## \[[^\]]+\] - [^\n]+\n([\s\S]*?)(?=\n## \[|$)/
// `## [待发版]` 后面**没有 ` - 日期`**,整行匹配不上,正则于是落到下一个
// `## [x.y.z] - 日期`,也就是**上一版**。而「本次发布无用户可感知变化」正是
// 发版纪律明确允许的情形(CHANGELOG 逃生阀:那种情况 `[待发版]` 天然为空),
// 于是每一次这样的发版,GitHub Release 页面都会显示上一版的条目。
// 实测 3.16.2 发布出去的是 3.16.1 的「### 修复 / 修复了一些问题。」——
// 比「什么都不写」更糟:它是一句关于本版的**错误陈述**。
// 原注释承诺的「提取为空时回退 --generate-notes」在有过上一版后**永不触发**。
//
// 本模块的判据改为**按版本号定位**:notes 必须来自 `## [<本次版本号>]` 那一节。
// 于是「notes 与本次发布的版本对应」成为结构保证,而不是「第一个版本头恰好是
// 本次」这种依赖发版顺序的巧合。找不到对应节就返回空串,由调用方回退。

/**
 * 版本节标题:只认 `## [` + 纯数字点分版本号 + `]`。
 *
 * 刻意排除 `[待发版]` 这类非版本头 —— 它不是一次发布,不该被任何版本号命中。
 * 收窄到纯数字点分形态还顺带避免了 `3.16.2` 误匹配 `3.16.20`。
 */
const VERSION_HEADING_PREFIX = /^## \[(\d+\.\d+\.\d+)\]/;

/**
 * 抽取指定版本的 CHANGELOG 条目正文。
 *
 * 边界:只认 `## [<version>]` **之后、下一个 `## ` 之前**的内容;标题行本身不计入
 * 正文(调用方拼装 Release 标题,重复标题是噪声)。找不到该版本节返回空串 ——
 * **空串是合法结果而非错误**,调用方据此回退到 `--generate-notes`。
 * @param {string} md CHANGELOG 全文
 * @param {string} version 本次发布的版本号(不含 `v` 前缀)
 * @returns {string} 条目正文;该版本节不存在或其正文为空时返回空串
 */
export function extractNotes(md, version) {
  if (typeof md !== 'string' || typeof version !== 'string' || version === '') return '';
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = VERSION_HEADING_PREFIX.exec(lines[i]);
    // 版本号逐字相等,不取「第一个版本节」:后者在本次版本尚未写入时会返回上一版。
    if (m !== null && m[1] === version) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return '';
  const body = [];
  for (let i = start; i < lines.length; i += 1) {
    // 下一个 `## `(任意层级形态)即本节末;`###` 是本节内的子标题,不算。
    if (/^## /.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
}

/**
 * 判定:本次发布的 CHANGELOG 是否存在对应版本的条目。
 *
 * 独立于 extractNotes 单独存在,是为了让门禁能区分两种**性质不同**的缺失:
 * 「条目为空」(该节在但没内容)与「版本节不存在」(发版时漏写标题行)。
 * 前者可能是合法的逃生阀用法,后者一定是发版流程漏步。
 * @param {string} md CHANGELOG 全文
 * @param {string} version 本次发布的版本号
 * @returns {{ hasSection: boolean, body: string }}
 */
export function inspectReleaseNotes(md, version) {
  const body = extractNotes(md, version);
  // hasSection 的判据独立于 body:一个空节仍算「节存在」。
  const hasSection = typeof md === 'string' && typeof version === 'string' && version !== ''
    && md.split(/\r?\n/).some((line) => {
      const m = VERSION_HEADING_PREFIX.exec(line);
      return m !== null && m[1] === version;
    });
  return { hasSection, body };
}

export default extractNotes;