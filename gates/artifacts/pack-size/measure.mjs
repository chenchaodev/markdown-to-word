// 体积实测层:一次 dist 的字节事实(安装包 / 解包目录 / app.asar + 四个关键子项)+ 判重总账。
// 只读产物,不改任何东西;「无产物」不是「体积正常」,故缺产物时返回 ok:false 由上层决定退出码。
//
// 依赖方向:asar.mjs(字节事实)、duplicates.mjs(判重总账)、contract.mjs(条目表与常量)、
// util.mjs(相对路径/转义);不 import baseline/report/cli。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { asarTreeBytes, dirBytes, readAsarTree } from './asar.mjs';
import { analyzeDuplicates } from './duplicates.mjs';
import { ASAR_REL_IN_UNPACKED, MEASURED_ITEMS } from './contract.mjs';
import { escapeRegExp, projectRoot, repoRelative } from './util.mjs';

/** @typedef {import('./contract.mjs').PackSizeMeasurement} PackSizeMeasurement */

/**
 * 读 package.json 的 productName(解包 exe 定位口径;读不到按空串处理)。
 * @returns {string} productName
 */
function readProductName() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return typeof pkg.build?.productName === 'string' ? pkg.build.productName : '';
  } catch {
    return '';
  }
}

/**
 * 在目录里找体积最大的匹配文件(确定性:同体积按名序)。
 * @param {string} dir 目录
 * @param {RegExp} pattern 文件名匹配
 * @returns {{ path: string, bytes: number } | null} 命中项
 */
function largestMatch(dir, pattern) {
  if (!existsSync(dir)) return null;
  let best = null;
  for (const name of readdirSync(dir).sort()) {
    if (!pattern.test(name)) continue;
    const candidate = path.join(dir, name);
    if (!statSync(candidate).isFile()) continue;
    const bytes = statSync(candidate).size;
    if (best === null || bytes > best.bytes) best = { path: candidate, bytes };
  }
  return best;
}

/**
 * 实测一次:所有条目字节 + asar 头信息 + 重复打包事实(纯读,不改任何产物)。
 * @param {object} spec 入参
 * @param {string} spec.unpackedDir 解包目录
 * @param {string} spec.releaseDir 发布产物根目录
 * @param {string} [spec.productName] 应用可执行文件名
 * @returns {{ ok: true, measurement: PackSizeMeasurement } | { ok: false, reason: string }} 实测结果
 */
export function measure({ unpackedDir, releaseDir, productName = readProductName() }) {
  if (!existsSync(unpackedDir) || !statSync(unpackedDir).isDirectory()) {
    return { ok: false, reason: `解包目录不存在:${repoRelative(unpackedDir)}(请先运行 npm run dist)` };
  }
  const asarPath = path.join(unpackedDir, ...ASAR_REL_IN_UNPACKED.split('/'));
  if (!existsSync(asarPath)) {
    return {
      ok: false,
      reason: `应用归档缺失:${repoRelative(asarPath)}(解包目录不完整,打包可能中断;请重跑 npm run dist)`,
    };
  }
  const tree = readAsarTree(asarPath);
  if (!tree.ok) {
    return { ok: false, reason: `app.asar 无法解析:${tree.reason}(无法实测包内子项,请重跑 npm run dist)` };
  }
  const asarFileBytes = statSync(asarPath).size;
  const exe =
    productName === ''
      ? largestMatch(unpackedDir, /\.exe$/i)
      : largestMatch(unpackedDir, new RegExp(`^${escapeRegExp(productName)}\\.exe$`, 'i'));
  const installer = largestMatch(releaseDir, /setup.*\.exe$/i);

  /** @type {Record<string, { id: string, label: string, kind: string, locator: string | null, required: boolean, bytes: number | null, present: boolean, source: string | null }>} */
  const items = {};
  for (const spec of MEASURED_ITEMS) {
    let bytes = null;
    let present = false;
    let source = null;
    if (spec.kind === 'asar-file') {
      bytes = asarFileBytes;
      present = true;
      source = repoRelative(asarPath);
    } else if (spec.kind === 'exe') {
      bytes = exe === null ? null : exe.bytes;
      present = exe !== null;
      source = exe === null ? null : repoRelative(exe.path);
    } else if (spec.kind === 'dir-total') {
      bytes = dirBytes(unpackedDir);
      present = true;
      source = `${repoRelative(unpackedDir)}/**`;
    } else if (spec.kind === 'installer') {
      bytes = installer === null ? null : installer.bytes;
      present = installer !== null;
      source = installer === null ? null : repoRelative(installer.path);
    } else {
      const located = asarTreeBytes(tree.entries, /** @type {string} */ (spec.locator));
      bytes = located;
      present = located !== null;
      source = located === null ? null : `app.asar:${spec.locator}`;
    }
    items[spec.id] = {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      locator: 'locator' in spec ? /** @type {string} */ (spec.locator) : null,
      required: spec.required,
      bytes,
      present,
      source,
    };
  }
  if (exe === null) {
    return {
      ok: false,
      reason:
        `解包目录内找不到应用可执行文件:${repoRelative(unpackedDir)}` +
        `(期望与 productName 同名的 ${productName}.exe;.exe 候选:${readdirSync(unpackedDir)
          .filter((name) => name.toLowerCase().endsWith('.exe'))
          .sort()
          .join(', ') || '(无)'})`,
    };
  }
  const duplicates = analyzeDuplicates({ entries: tree.entries, asarPath, dataStart: tree.dataStart });
  let unpackedEntryBytes = 0;
  for (const entry of tree.entries.values()) if (entry.unpacked) unpackedEntryBytes += entry.size;
  return {
    ok: true,
    measurement: {
      release: {
        releaseDir: repoRelative(releaseDir),
        unpackedDir: repoRelative(unpackedDir),
        asar: repoRelative(asarPath),
        installer: installer === null ? null : repoRelative(installer.path),
      },
      asar: {
        fileBytes: asarFileBytes,
        headerBytes: tree.headerBytes,
        entryCount: tree.entryCount,
        unpackedEntryBytes,
      },
      items,
      duplicates,
    },
  };
}
