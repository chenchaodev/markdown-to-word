// 判重的「枚举与编排层」:枚举包内所有包根(含项目自身)、读出各自的 name/version/依赖声明、
// 按包名归组多副本并交给 verdict.mjs 定性,最后汇总成一份总账(可回收 / 不可回收 /
// 跨版本同名同大小对照 三笔分开记,不混算)。
//
// 依赖方向:asar.mjs(读包内 package.json)→ verdict.mjs(定性);不反向依赖 measure/cli。
//
// 「已接受例外」:TYPES_SCOPE 与 DECLARATION_FIELDS 是本层判定口径的两个常量(排除类型声明
// 副本、只看驱动安装的依赖字段),它们紧贴使用处,故留在本文件而不进 contract.mjs。

/** @types/katex 之类类型声明副本的排除(不随包运行,计入会每次误报) */
const TYPES_SCOPE = '@types';
/**
 * 「谁要求哪个范围」只看这两类依赖字段。
 *
 * 刻意**不含 peerDependencies**:peer 范围不驱动安装(不会因此产生嵌套副本),
 * 把它算进来会把「peer 未被满足」这一类完全不同的問題混进判重;那是 npm 自己的
 * 报告面(以及包内条目断言)该管的事。
 */
const DECLARATION_FIELDS = ['dependencies', 'optionalDependencies'];

import { readAsarText } from './asar.mjs';
import { classifyName, resolveCopy } from './verdict.mjs';
import { escapeRegExp } from './util.mjs';

/** @typedef {import('./contract.mjs').PackSizeCopy} PackSizeCopy */
/** @typedef {import('./contract.mjs').PackSizeDuplicateAnalysis} PackSizeDuplicateAnalysis */

/**
 * 包内副本检测:找出所有 `node_modules/<pkg>`(含嵌套)形态的包根,按包名归组。
 *
 * 副本根是从**文件路径**反推的:asar 目录树里目录本身不落条目(只有文件有 size),
 * 故不能按「路径等于包根」筛,得扫出每个 `…/node_modules/<pkg>/…` 前缀。
 * @types/* 是类型声明、不随包运行,归入 excluded(否则每次都误报)。
 *
 * 注意:本函数只回答「哪些位置上有这个包名」,**不判断是否算缺陷** —— 那要连版本与
 * 声明范围一起看(见 analyzeDuplicates),故本函数对任意包名都成立,不是某包的特判。
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} entries asar 展平条目表
 * @param {string} pkgName 包名(不含 @scope)
 * @returns {{ copies: { path: string, bytes: number, fileCount: number }[], excluded: string[] }} 副本与被排除项
 */
export function findPackageCopies(entries, pkgName) {
  const pattern = new RegExp(`(?:^|/)node_modules/(?:@[^/]+/)?${escapeRegExp(pkgName)}/`, 'g');
  /** @type {Set<string>} */
  const roots = new Set();
  /** @type {Set<string>} */
  const excluded = new Set();
  for (const rel of entries.keys()) {
    pattern.lastIndex = 0;
    let match = pattern.exec(rel);
    while (match !== null) {
      const root = rel.slice(0, match.index + match[0].length - 1);
      if (root.split('/').includes(TYPES_SCOPE)) excluded.add(root);
      else roots.add(root);
      match = pattern.exec(rel);
    }
  }
  const copies = [...roots].sort().map((root) => {
    const prefix = `${root}/`;
    let bytes = 0;
    let fileCount = 0;
    for (const [rel, entry] of entries) {
      if (!rel.startsWith(prefix)) continue;
      fileCount += 1;
      bytes += entry.size;
    }
    return { path: root, bytes, fileCount };
  });
  return { copies, excluded: [...excluded].sort() };
}

/**
 * 枚举包内所有包根(含项目自身),读出各自的 name/version/依赖声明。
 * @param {object} spec 入参
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} spec.entries asar 展平条目表
 * @param {string} spec.asarPath app.asar 路径
 * @param {number} spec.dataStart 载荷起点
 * @returns {{ packages: { root: string, name: string, version: string, declarations: { field: string, range: string }[] }[], excludedTypeOnly: string[] }} 包清单
 */
export function enumeratePackages({ entries, asarPath, dataStart }) {
  /** @type {{ root: string, name: string, version: string, declarations: { field: string, range: string }[] }[]} */
  const packages = [];
  /** @type {string[]} */
  const excludedTypeOnly = [];
  /** @type {string[]} */
  const manifests = [];
  for (const rel of entries.keys()) {
    if (rel === 'package.json') {
      manifests.push('');
      continue;
    }
    if (!rel.endsWith('/package.json') || !/(?:^|\/)node_modules\//.test(rel)) continue;
    // 包根 = 去掉末尾 /package.json;包名 = 包根里最后一个 node_modules/ 之后那段
    const root = rel.slice(0, rel.length - '/package.json'.length);
    const nameFromPath = root.slice(root.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (nameFromPath === '' || nameFromPath.endsWith('/')) continue;
    if (nameFromPath.startsWith(`${TYPES_SCOPE}/`)) {
      excludedTypeOnly.push(root);
      continue;
    }
    manifests.push(`${root}\t${nameFromPath}`);
  }
  for (const record of manifests.sort()) {
    const [root, nameFromPath = ''] = record.split('\t');
    const manifestRel = root === '' ? 'package.json' : `${root}/package.json`;
    const text = readAsarText(asarPath, entries, dataStart, manifestRel);
    if (text === null) continue;
    /** @type {{ name?: unknown, version?: unknown, dependencies?: unknown, optionalDependencies?: unknown } | null} */
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (parsed === null) continue;
    const name = typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : nameFromPath;
    if (name === '' || name === undefined) continue;
    /** @type {{ field: string, range: string }[]} */
    const declarations = [];
    for (const field of DECLARATION_FIELDS) {
      const bag = /** @type {Record<string, unknown> | undefined} */ (parsed[field]);
      if (bag === null || bag === undefined || typeof bag !== 'object') continue;
      for (const dep of Object.keys(bag).sort()) {
        const range = bag[dep];
        if (typeof range === 'string') declarations.push({ field, range, name: dep });
      }
    }
    packages.push({
      root,
      name,
      version: typeof parsed.version === 'string' ? parsed.version : '',
      declarations: /** @type {{ field: string, range: string }[]} */ (declarations),
      /** 依赖名 → 范围的旁路表(下面按名取用) */
      byName: Object.fromEntries(declarations.map((decl) => [decl.name, decl])),
    });
  }
  return { packages, excludedTypeOnly: [...new Set(excludedTypeOnly)].sort() };
}

/**
 * 判重主逻辑:按「包名 + 版本 + 声明范围」给每个多副本包名定性,并把字节分成
 * 可回收 / 不可回收两栏(跨版本同名同大小文件两侧都不计入)。
 * @param {object} spec 入参
 * @param {Map<string, { size: number, offset: number, unpacked: boolean }>} spec.entries asar 展平条目表
 * @param {string} spec.asarPath app.asar 路径
 * @param {number} spec.dataStart 载荷起点
 * @returns {PackSizeDuplicateAnalysis} 判重总账
 */
export function analyzeDuplicates({ entries, asarPath, dataStart }) {
  const { packages, excludedTypeOnly } = enumeratePackages({ entries, asarPath, dataStart });
  /** @type {Map<string, PackSizeCopy[]>} */
  const byName = new Map();
  for (const pkg of packages) {
    const found = findPackageCopies(entries, pkg.name);
    const copy = found.copies.find((item) => item.path === pkg.root);
    if (copy === undefined) continue;
    const list = byName.get(pkg.name) ?? [];
    list.push({ path: pkg.root, name: pkg.name, version: pkg.version, bytes: copy.bytes, fileCount: copy.fileCount });
    byName.set(pkg.name, list);
  }
  /** @type {PackSizeDuplicateFinding[]} */
  const findings = [];
  for (const name of [...byName.keys()].sort()) {
    const copies = (byName.get(name) ?? []).sort((a, b) => a.path.localeCompare(b.path));
    if (copies.length < 2) continue;
    const copyRoots = new Set(copies.map((copy) => copy.path));
    /** @type {PackSizeDeclaration[]} */
    const declarations = [];
    for (const pkg of packages) {
      const decl = pkg.byName[name];
      if (decl === undefined) continue;
      declarations.push({
        requirer: pkg.root === '' ? 'package.json' : pkg.root,
        field: decl.field,
        range: decl.range,
        resolvedTo: resolveCopy(pkg.root, name, copyRoots),
      });
    }
    findings.push(classifyName({ name, copies, declarations, entries }));
  }
  let reclaimableBytes = 0;
  let unavoidableBytes = 0;
  let crossCount = 0;
  let crossBytes = 0;
  for (const finding of findings) {
    reclaimableBytes += finding.reclaimableBytes;
    unavoidableBytes += finding.unavoidableBytes;
    crossCount += finding.crossVersionIdenticalFiles.count;
    crossBytes += finding.crossVersionIdenticalFiles.bytes;
  }
  return {
    packagesAnalyzed: packages.length,
    multiCopyNames: findings.length,
    excludedTypeOnly,
    reclaimableBytes,
    unavoidableBytes,
    crossVersionIdenticalFiles: { count: crossCount, bytes: crossBytes },
    redCount: findings.filter((finding) => finding.red).length,
    findings,
  };
}
