// 判重的「定性层」:回答单个包名的问题 —— 这些多副本里哪些是**可避免**的(该判红、可回收
// 字节),哪些是 semver 强制并存的(不判红),以及字节该怎么记。
//
// 输入事实全部来自产物自身:每份副本的 name/version 取自包内 package.json,「谁要求哪个
// 范围」取自各包的 dependencies/optionalDependencies,落点按 Node 逐级上溯解析。
//
// 已裁决的判据(主会话 2026-09 裁决,勿再改):**判红看「可避免」,不看「有几份」**。
// 本仓 release/ 里 katex@0.16.47 确实出现在两处(node_modules/mermaid/node_modules/katex 与
// node_modules/micromark-extension-math/node_modules/katex),但两份分处兄弟分支、没有共同可
// 提升位置(根位置被项目强制的 0.18.1 占据,而 ^0.18.1 与 ^0.16.45/^0.16.0 互不重叠),npm 只能
// 各自放一份 —— 这是不可避免的并存。故判据是「把某份抽掉后,它的引用方是否仍落到同版本
// 的另一份」:仍落得到 = 可避免 = 判红(顶层与嵌套同为 0.18.1 即走这条,见
// test/segments/observability.test.js 的沙盒 8a);落不到 = 不可避免 = 只报信息。
// 规则有牙,并未被放宽:同包名同版本但可避免的冗余嵌套照红不误。
//
// 叶子依赖:仅 semver.mjs(范围判定)。不 import 枚举层或装配层,依赖方向单向。
//
// 「已接受例外」:classifyName 是本层唯一的长函数(判定三类缺陷 + 字节分栏 + 说明生成),
// 它们共享同一批中间量(removable/notes/undecidable),拆开会得到互相传参的碎函数;
// 保持单函数 + 分段注释更可读。

import { satisfiesRange } from './semver.mjs';

/** @typedef {import('./contract.mjs').PackSizeCopy} PackSizeCopy */
/** @typedef {import('./contract.mjs').PackSizeDeclaration} PackSizeDeclaration */
/** @typedef {import('./contract.mjs').PackSizeDuplicateFinding} PackSizeDuplicateFinding */

/**
 * Node 解析:某引用方所在包会落到哪一份副本(自包目录逐级上溯找 node_modules/<name>)。
 * @param {string} requirerRoot 引用方包根('' = 项目自身)
 * @param {string} name 包名
 * @param {Set<string>} copyRoots 包内该包名的全部副本根
 * @returns {string | null} 命中的副本根;没落到包内任何一份返回 null
 */
export function resolveCopy(requirerRoot, name, copyRoots) {
  const segments = requirerRoot === '' ? [] : requirerRoot.split('/');
  for (let i = segments.length; i >= 0; i -= 1) {
    const candidate = [...segments.slice(0, i), 'node_modules', name].join('/');
    if (copyRoots.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Node 解析(排除某一份副本):用来判「把这份副本抽掉,引用方会落到哪」——
 * 兄弟分支里的副本对彼此不可见,所以只能沿解析链向上找。
 * @param {string} requirerRoot 引用方包根('' = 项目自身)
 * @param {string} name 包名
 * @param {Set<string>} copyRoots 包内该包名的全部副本根
 * @param {string} exclude 要排除的副本根
 * @returns {string | null} 抽掉 exclude 后命中的副本根;抽掉后无处可落返回 null
 */
export function resolveCopyExcept(requirerRoot, name, copyRoots, exclude) {
  const segments = requirerRoot === '' ? [] : requirerRoot.split('/');
  for (let i = segments.length; i >= 0; i -= 1) {
    const candidate = [...segments.slice(0, i), 'node_modules', name].join('/');
    if (candidate !== exclude && copyRoots.has(candidate)) return candidate;
  }
  return null;
}

/**
 * 跨版本同名同大小文件(仅作对照,**不计入任何可回收口径**):同一个相对文件名在两份
 * 不同版本副本里都存在且大小一致。0.16 与 0.18 之间这类文件很多,它们内容不同、各自
 * 需要,把字节记成「省下来的」是错误记账。
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} entries asar 展平条目表
 * @param {PackSizeCopy[]} copies 该包名的各副本
 * @returns {{ count: number, bytes: number }} 对照数字
 */
export function crossVersionIdenticalFiles(entries, copies) {
  /** @type {Map<string, Map<string, number>>} */
  const perCopy = new Map();
  for (const copy of copies) {
    /** @type {Map<string, number>} */
    const sizes = new Map();
    const prefix = `${copy.path}/`;
    for (const [rel, entry] of entries) {
      if (rel.startsWith(prefix)) sizes.set(rel.slice(prefix.length), entry.size);
    }
    perCopy.set(copy.path, sizes);
  }
  /** @type {Map<string, number>} */
  const matched = new Map();
  for (let i = 0; i < copies.length; i += 1) {
    for (let j = i + 1; j < copies.length; j += 1) {
      const left = copies[i];
      const right = copies[j];
      if (left === undefined || right === undefined || left.version === right.version) continue;
      const leftSizes = perCopy.get(left.path);
      const rightSizes = perCopy.get(right.path);
      if (leftSizes === undefined || rightSizes === undefined) continue;
      for (const [file, size] of leftSizes) {
        if (rightSizes.get(file) === size) matched.set(file, size);
      }
    }
  }
  let bytes = 0;
  for (const size of matched.values()) bytes += size;
  return { count: matched.size, bytes };
}

/**
 * 给单个包名定性(判红三类 + 合法并存 + 不可提升位置的同版本并存)。
 * @param {object} spec 入参
 * @param {string} spec.name 包名
 * @param {PackSizeCopy[]} spec.copies 各副本
 * @param {PackSizeDeclaration[]} spec.declarations 该包名的声明与解析落点
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} spec.entries asar 展平条目表
 * @returns {PackSizeDuplicateFinding} 结论
 */
export function classifyName({ name, copies, declarations, entries }) {
  const copyRoots = new Set(copies.map((copy) => copy.path));
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const removable = new Set();
  /** @type {PackSizeDuplicateFinding['classification'][]} */
  const detected = [];
  let undecidable = 0;

  // ① semver 违规:引用方声明的范围不被实际解析到的版本满足(强行统一版本的危害)
  for (const decl of declarations) {
    if (decl.resolvedTo === null) {
      undecidable += 1;
      continue;
    }
    const copy = copies.find((item) => item.path === decl.resolvedTo);
    if (copy === undefined) continue;
    const satisfied = satisfiesRange(copy.version, decl.range);
    if (satisfied === null) undecidable += 1;
    else if (satisfied === false) {
      if (!detected.includes('semver-violation')) detected.push('semver-violation');
      problems.push(
        `${decl.requirer}[${decl.field}] 声明 ${name}@${decl.range},实际解析到 ${copy.path}@${copy.version}(不满足其声明范围)`,
      );
    }
  }
  // ② 同包名同版本多副本,且祖先位置已有同版本 → 多出来的那份是冗余嵌套
  /** @type {Map<string, PackSizeCopy[]>} */
  const byVersion = new Map();
  for (const copy of copies) {
    const list = byVersion.get(copy.version) ?? [];
    list.push(copy);
    byVersion.set(copy.version, list);
  }
  for (const [version, group] of byVersion) {
    if (group.length < 2) continue;
    for (const copy of group) {
      // 「祖先位置」按 Node 解析算,不是路径前缀(顶层 node_modules/x 之于
      // node_modules/m/node_modules/x 也是可达的祖先位置)
      const resolvers = declarations.filter((decl) => decl.resolvedTo === copy.path);
      if (resolvers.length === 0) continue;
      const targets = resolvers.map((decl) =>
        resolveCopyExcept(decl.requirer === 'package.json' ? '' : decl.requirer, name, copyRoots, copy.path),
      );
      const first = targets[0];
      if (first === null || first === undefined || targets.some((item) => item !== first)) continue;
      const target = group.find((other) => other.path === first);
      if (target === undefined) continue;
      removable.add(copy.path);
      if (!detected.includes('redundant-same-version')) detected.push('redundant-same-version');
      problems.push(
        `同包名同版本多副本且上方已有同版本(${target.path}@${version}):` +
          `${copy.path}@${version}(${copy.bytes} 字节,可回收);` +
          `抽掉后其引用方(${resolvers.map((decl) => `${decl.requirer} 的 ${decl.range}`).join('、')})` +
          `仍落到 ${target.path}@${target.version}`,
      );
    }
  }
  // ③ 整份副本可去掉:把它抽掉后,它的全部引用方仍会落到**同一份**同包名副本上,
  //    且那份的版本满足它们声明的范围 ⇒ 本可统一到同一版本(声明范围其实重叠)。
  //    同样按真实解析走:兄弟分支里的副本对彼此不可见(mermaid 与
  //    micromark-extension-math 各自目录下的 katex 互不可见,不能算「统一」)。
  for (const copy of copies) {
    if (removable.has(copy.path)) continue;
    const own = declarations.filter((decl) => decl.resolvedTo === copy.path);
    if (own.length === 0) continue;
    const after = own.map((decl) => ({
      decl,
      target: resolveCopyExcept(decl.requirer === 'package.json' ? '' : decl.requirer, name, copyRoots, copy.path),
    }));
    if (after.some((item) => item.target === null)) {
      if (after.some((item) => satisfiesRange(copy.version, item.decl.range) === null)) undecidable += 1;
      continue;
    }
    const target = after[0]?.target ?? null;
    if (target === null || after.some((item) => item.target !== target)) continue;
    const targetCopy = copies.find((item) => item.path === target);
    if (targetCopy === undefined || targetCopy.version === copy.version) continue;
    // 落点是同一份还不够:那份的版本必须**满足每个引用方声明的范围**,否则抽掉就是 semver 违规
    if (!own.every((decl) => satisfiesRange(targetCopy.version, decl.range) === true)) {
      if (own.some((decl) => satisfiesRange(targetCopy.version, decl.range) === null)) undecidable += 1;
      continue;
    }
    removable.add(copy.path);
    if (!detected.includes('unifyable-versions')) detected.push('unifyable-versions');
    problems.push(
      `同包名不同版本但声明范围重叠(本可统一):${copy.path}@${copy.version}(${copy.bytes} 字节,可回收)` +
        `抽掉后其全部引用方(${own.map((decl) => `${decl.requirer} 的 ${decl.range}`).join('、')})` +
        `都会落到 ${targetCopy.path}@${targetCopy.version}`,
    );
  }

  // 字节分栏:可回收 = 可避免的副本;不可回收 = 同版本却无可提升位置的并存
  let reclaimableBytes = 0;
  for (const copy of copies) if (removable.has(copy.path)) reclaimableBytes += copy.bytes;
  let unavoidableBytes = 0;
  if (reclaimableBytes === 0) {
    for (const [version, group] of byVersion) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => b.bytes - a.bytes);
      const droppable = sorted.slice(1);
      const bytes = droppable.reduce((sum, copy) => sum + copy.bytes, 0);
      unavoidableBytes += bytes;
      const otherVersions = [...new Set(copies.filter((copy) => copy.version !== version).map((copy) => copy.version))];
      notes.push(
        `同版本 ${version} 分处兄弟分支(${group.map((copy) => copy.path).join('、')}),` +
          `${otherVersions.length === 0 ? '无可提升的祖先位置' : `根/祖先位置被 ${otherVersions.join('/')} 占据`},` +
          `当前树形下无法合并,${bytes} 字节不可回收`,
      );
    }
  } else {
    const sameVersionElsewhere = copies.some(
      (copy) => !removable.has(copy.path) && copies.some((other) => other.version === copy.version && other.path !== copy.path),
    );
    if (sameVersionElsewhere) {
      notes.push('同包名同版本仍有并存副本,未计入不可回收(避免同一批字节被记两次)');
    }
  }
  if (problems.length === 0) {
    notes.push(
      `各版本互斥(${copies.map((copy) => `${copy.version}@${copy.path}`).join('、')}),` +
        '由各自引用方声明的范围强制并存,不是误打包',
    );
  }
  if (undecidable > 0) {
    notes.push(`${undecidable} 条声明范围无法用最小 semver 判定器解析(含预发布/URL/别名),未据此判红,需人工复核`);
  }
  const crossVersion = crossVersionIdenticalFiles(entries, copies);
  if (crossVersion.count > 0) {
    notes.push(
      `跨版本同名同大小文件 ${crossVersion.count} 个 / ${crossVersion.bytes} 字节仅作对照:` +
        '不同版本内容不同、各自需要,不是冗余,不计入可回收',
    );
  }

  // 分类取「最严重的那个」:判定顺序 ① → ② → ③ 即优先级;都不成立时,多版本 = 合法并存,
  // 单版本多副本 = 同版本却无可提升位置(两者都不判红)
  /** @type {PackSizeDuplicateFinding['classification']} */
  const classification =
    detected[0] ?? (byVersion.size > 1 ? 'parallel-versions' : 'unavoidable-duplicate');
  return {
    name,
    classification,
    red: problems.length > 0,
    copies,
    declarations,
    reclaimableBytes,
    unavoidableBytes,
    crossVersionIdenticalFiles: crossVersion,
    reasons: problems,
    notes,
  };
}
