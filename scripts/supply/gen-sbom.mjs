// SBOM(CycloneDX 1.6 JSON)生成与漂移校验:唯一输入是 package-lock.json,exit 0/1。
//
// 为什么只用 lockfile:SBOM 要能被任何人离线重跑出同一份结果。掺入 node_modules
// 现场状态(装没装、平台可选包是否落盘、npm 版本差异)会让同一次提交的 SBOM 在
// 两台机器上不一致,漂移校验随即变成随机噪声。lockfile v3 的每个条目都带
// license 字段,组件/版本/依赖边/production 标记全部齐备,不需要读安装树。
//
// 确定性契约(漂移校验的前提,勿破坏):
//   - 不含时间戳、不含主机名/绝对路径;serialNumber 由 lockfile 摘要派生(UUIDv5 形状),
//     同一 lockfile 永远得到同一 serialNumber;
//   - 组件与依赖边按 lock 路径字典序输出,对象键按固定顺序构造,故同输入逐字节相同;
//   - 若确需为某次发布盖时间戳,时间戳属于「发布留痕」而非 SBOM 身份,写进
//     release 侧发布报告,不要塞进本文件(会立刻与 --check 冲突)。
//
// 用法:
//   node scripts/supply/gen-sbom.mjs [--lock <file>] [--output <file>] [--print]
//   node scripts/supply/gen-sbom.mjs --check [--lock <file>] [--output <file>]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOASSERTION,
  SCOPE_DEVELOPMENT,
  SCOPE_PRODUCTION,
  SUPPLY_OUTPUT_DIR,
  componentEdges,
  errorMessage,
  hashBuffer,
  isMainModule,
  lockComponents,
  parseSupplyArgs,
  readJson,
  readLockfile,
  serializeJson,
  toPosix,
  writeJson,
} from './supply-common.mjs';

/** SBOM 报告 schema 版本:格式不兼容变更时递增,--check 遇到不匹配即拒绝(不静默重生成) */
export const SBOM_SCHEMA = 'm2w/sbom@1';

/** CycloneDX 规范版本与格式 */
const CDX_BOM_FORMAT = 'CycloneDX';
const CDX_SPEC_VERSION = '1.6';

/**
 * CycloneDX 组件条目(只声明本生成器实际写出的字段,未写的可选字段不列)。
 * @typedef {object} SbomComponent
 * @property {string} bom-ref 唯一引用(purl,重名时带 qualifier)
 * @property {string} type 组件类型
 * @property {string} name 包名
 * @property {string} version 锁定版本
 * @property {string} scope CycloneDX scope(required/optional)
 * @property {{ license: { id?: string; expression?: string; name: string } }[]} licenses 许可证条目
 * @property {string} purl 包 URL
 * @property {{ name: string; value: string }[]} properties m2w 扩展属性
 */

/**
 * 依赖边条目(「谁依赖谁」)。
 * @typedef {object} SbomDependency
 * @property {string} ref 引入方 bom-ref
 * @property {string[]} dependsOn 被依赖方 bom-ref(已排序)
 */

/**
 * 生成的 SBOM 文档。
 * @typedef {object} SbomDocument
 * @property {string} bomFormat
 * @property {string} specVersion
 * @property {string} serialNumber urn:uuid 形式,由 lockfile 摘要派生
 * @property {number} version
 * @property {{ component: any; properties: { name: string; value: string }[] }} metadata
 * @property {SbomComponent[]} components
 * @property {SbomDependency[]} dependencies
 */

/**
 * 生成统计(供日志与 --check 报告,不入 SBOM 本体)。
 * @typedef {object} SbomStats
 * @property {number} componentCount
 * @property {number} productionCount
 * @property {number} developmentCount
 * @property {number} missingLicenseCount
 * @property {number} unresolvedDependencyCount
 * @property {string[]} unresolvedSample
 */

/** 默认输出路径 */
export const DEFAULT_SBOM_PATH = path.join(SUPPLY_OUTPUT_DIR, 'sbom.cdx.json');

const USAGE = `用法: node scripts/supply/gen-sbom.mjs [选项]
  --lock <file>    输入 lockfile(默认项目根的 package-lock.json)
  --output <file>  SBOM 落盘路径(默认 ${toPosix(DEFAULT_SBOM_PATH)})
  --check          校验模式:与 --output 处既有 SBOM 比对,不写盘
  --print          生成模式下把 SBOM 正文打到 stdout
  --help           显示本用法`;

/**
 * lockfile 内容摘要 → 确定性 UUIDv5 形状的 serialNumber。
 * 取 sha256 前 16 字节,置 version=5 与 RFC 4122 variant 位,故格式合法且同输入恒定。
 * @param {string} rootName 根包名
 * @param {string} rootVersion 根包版本
 * @param {string} lockDigest lockfile 文本的 sha256
 * @returns {string} urn:uuid: 形式的 serialNumber
 */
export function deriveSerialNumber(rootName, rootVersion, lockDigest) {
  const bytes = Buffer.from(hashBuffer(Buffer.from(`${rootName}\u0000${rootVersion}\u0000${lockDigest}`)), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  const groups = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)];
  return `urn:uuid:${groups.join('-')}`;
}

/**
 * license 字段 → CycloneDX licenses 条目 + 状态标记。
 *
 * 离线没有 SPDX 许可证清单可校验,故按「能否当单个 id 用」分流:裸标识符
 * (MIT / Apache-2.0)走 license.id,含括号或 AND/OR 的复合表达式走 license.expression,
 * 缺失走 NOASSERTION 名称。三种形态都是 CycloneDX 1.6 允许的写法。
 * @param {string | null} license lockfile 中的 license 字段
 * @returns {{ licenses: { license: { id?: string; expression?: string; name?: string } }[]; status: string }}
 */
export function toCycloneDxLicenses(license) {
  if (license === null) {
    return { licenses: [{ license: { name: NOASSERTION } }], status: 'missing' };
  }
  const bare = /^[\w.+-]+$/.test(license);
  return {
    licenses: [bare ? { license: { id: license } } : { license: { expression: license } }],
    status: 'declared',
  };
}

/**
 * lock 路径 → 唯一 bom-ref。同一 name@version 在树上出现多次(nested 重复)时用 purl
 * qualifier 带上 lock 路径消歧 —— bom-ref 必须唯一,重名会让依赖边指向错误组件。
 * @param {import('./supply-common.mjs').SupplyComponent[]} components 组件列表
 * @returns {Map<string, string>} lock 路径 → bom-ref
 */
export function buildComponentRefs(components) {
  const counts = new Map();
  for (const component of components) {
    const key = `${component.name}@${component.version}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const refs = new Map();
  for (const component of components) {
    const key = `${component.name}@${component.version}`;
    const purl = `pkg:npm/${component.name}@${component.version}`;
    refs.set(component.lockPath, (counts.get(key) ?? 0) > 1 ? `${purl}?m2w_path=${encodeURIComponent(component.lockPath)}` : purl);
  }
  return refs;
}

/**
 * 构建 SBOM 文档(纯函数:同 lockfile 必得同结果)。
 * @param {{ lock: object; lockDigest: string; lockLabel: string }} input 输入
 * @returns {{ document: SbomDocument; stats: SbomStats }}
 */
export function buildSbom({ lock, lockDigest, lockLabel }) {
  const { root, components } = lockComponents(lock);
  const { edges, unresolved } = componentEdges(lock, components);
  const rootName = typeof root.name === 'string' ? root.name : 'unknown';
  const rootVersion = typeof root.version === 'string' ? root.version : '0.0.0';
  const rootLicense = typeof root.license === 'string' && root.license.trim() !== '' ? root.license.trim() : null;
  const refs = buildComponentRefs(components);
  const rootRef = `pkg:npm/${rootName}@${rootVersion}`;

  const bomComponents = components.map((component) => {
    const { licenses, status } = toCycloneDxLicenses(component.license);
    return {
      'bom-ref': refs.get(component.lockPath),
      type: 'library',
      name: component.name,
      version: component.version,
      // CycloneDX scope 只有 required/optional/excluded 三档:生产树记 required,
      // 纯 dev 记 optional;精确的 dev/production 判定另由下方 m2w 属性给出
      scope: component.dependencyScope === SCOPE_PRODUCTION ? 'required' : 'optional',
      licenses,
      purl: `pkg:npm/${component.name}@${component.version}`,
      properties: [
        { name: 'm2w:dependencyScope', value: component.dependencyScope },
        { name: 'm2w:direct', value: String(component.direct) },
        { name: 'm2w:licenseStatus', value: status },
        { name: 'm2w:lockPath', value: component.lockPath },
        { name: 'm2w:optional', value: String(component.optional) },
      ],
    };
  });

  const dependencyEntries = [...edges.entries()]
    .map(([from, targets]) => ({
      ref: from === '' ? rootRef : (refs.get(from) ?? from),
      dependsOn: targets.map((target) => refs.get(target) ?? target),
    }))
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

  const document = {
    bomFormat: CDX_BOM_FORMAT,
    specVersion: CDX_SPEC_VERSION,
    serialNumber: deriveSerialNumber(rootName, rootVersion, lockDigest),
    version: 1,
    metadata: {
      component: {
        'bom-ref': rootRef,
        type: 'application',
        name: rootName,
        version: rootVersion,
        licenses: rootLicense === null ? [{ license: { name: NOASSERTION } }] : toCycloneDxLicenses(rootLicense).licenses,
      },
      properties: [
        { name: 'm2w:sbom:determinism', value: 'no-timestamp;serialNumber=uuidv5(rootName,rootVersion,sha256(lockfile))' },
        { name: 'm2w:sbom:schema', value: SBOM_SCHEMA },
        { name: 'm2w:sbom:source', value: lockLabel },
      ],
    },
    components: bomComponents,
    dependencies: dependencyEntries,
  };

  return {
    document,
    stats: {
      componentCount: bomComponents.length,
      productionCount: components.filter((component) => component.dependencyScope === SCOPE_PRODUCTION).length,
      developmentCount: components.filter((component) => component.dependencyScope === SCOPE_DEVELOPMENT).length,
      missingLicenseCount: components.filter((component) => component.license === null).length,
      unresolvedDependencyCount: unresolved.size,
      unresolvedSample: [...unresolved.entries()].slice(0, 10).map(([from, names]) => `${from} → ${names.join(',')}`),
    },
  };
}

/**
 * 比对既有 SBOM 与当前 lockfile 推导结果,返回可读漂移列表(空数组 = 无漂移)。
 * 逐组件比 ref/版本/范围与依赖边,不只比数量 —— 数量相同而内容换包是最常见的漂移。
 * @param {any} expected 已落盘的 SBOM(JSON.parse 结果,未做形状校验,故按 any 处理)
 * @param {SbomDocument} actual 当前推导出的 SBOM 文档
 * @returns {string[]} 漂移说明
 */
export function diffSbom(expected, actual) {
  const problems = [];
  if (expected?.bomFormat !== actual.bomFormat || expected?.specVersion !== actual.specVersion) {
    problems.push(
      `SBOM 格式/规范版本与当前生成器不一致(既有 ${String(expected?.bomFormat)}@${String(expected?.specVersion)},` +
        `当前 ${actual.bomFormat}@${actual.specVersion});请重新生成后提交`,
    );
    return problems;
  }
  if (expected?.serialNumber !== actual.serialNumber) {
    problems.push('serialNumber 不一致:lockfile 已变更但 SBOM 未重新生成(或该 SBOM 来自其它 lockfile)');
  }
  const expectedComponents = new Map((expected.components ?? []).map((component) => [component['bom-ref'], component]));
  const actualComponents = new Map(actual.components.map((component) => [component['bom-ref'], component]));
  const added = [...actualComponents.keys()].filter((ref) => !expectedComponents.has(ref));
  const removed = [...expectedComponents.keys()].filter((ref) => !actualComponents.has(ref));
  for (const ref of added.slice(0, 20)) problems.push(`新增组件未记入 SBOM:${ref}`);
  if (added.length > 20) problems.push(`新增组件另有 ${added.length - 20} 项未逐一列出`);
  for (const ref of removed.slice(0, 20)) problems.push(`SBOM 中的组件已不在 lockfile:${ref}`);
  if (removed.length > 20) problems.push(`移除组件另有 ${removed.length - 20} 项未逐一列出`);
  for (const [ref, actualComponent] of actualComponents) {
    const expectedComponent = expectedComponents.get(ref);
    if (expectedComponent === undefined) continue;
    const expectedLicenses = (expectedComponent.licenses ?? []).map((entry) => JSON.stringify(entry)).join('|');
    const actualLicenses = (actualComponent.licenses ?? []).map((entry) => JSON.stringify(entry)).join('|');
    if (expectedLicenses !== actualLicenses) {
      problems.push(`组件许可证变化未同步 SBOM:${ref}(既有 ${expectedLicenses},当前 ${actualLicenses})`);
    }
    const expectedScope = expectedComponent.properties?.find((property) => property.name === 'm2w:dependencyScope')?.value;
    const actualScope = actualComponent.properties?.find((property) => property.name === 'm2w:dependencyScope')?.value;
    if (expectedScope !== actualScope) {
      problems.push(`组件依赖范围变化未同步 SBOM:${ref}(既有 ${String(expectedScope)},当前 ${String(actualScope)})`);
    }
  }
  const expectedEdges = new Map((expected.dependencies ?? []).map((entry) => [entry.ref, (entry.dependsOn ?? []).join(',')]));
  const actualEdges = new Map(actual.dependencies.map((entry) => [entry.ref, (entry.dependsOn ?? []).join(',')]));
  for (const [ref, actualDeps] of actualEdges) {
    const expectedDeps = expectedEdges.get(ref);
    if (expectedDeps === undefined) problems.push(`SBOM 缺少依赖边条目:${ref}`);
    else if (expectedDeps !== actualDeps) problems.push(`依赖关系变化未同步 SBOM:${ref}`);
  }
  for (const ref of expectedEdges.keys()) {
    if (!actualEdges.has(ref)) problems.push(`SBOM 中的依赖边已不存在:${ref}`);
  }
  return problems;
}

/**
 * 从 lockfile 读文本 + 解析,返回构建 SBOM 所需的三元组(供 CLI 与测试复用)。
 * @param {string} lockPath lockfile 路径
 * @param {string} lockLabel 报告里记录的输入标识
 * @returns {{ document: SbomDocument; stats: SbomStats }}
 */
export function generateSbom(lockPath, lockLabel) {
  // 先 readLockfile:它对「文件不存在」给的是带修复建议的文案,直接 readFileSync 只会抛裸 ENOENT
  const lock = readLockfile(lockPath);
  const text = readFileSync(lockPath, 'utf8');
  return buildSbom({ lock, lockDigest: hashBuffer(Buffer.from(text, 'utf8')), lockLabel });
}

export async function main(argv = []) {
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
  let options;
  try {
    options = parseSupplyArgs(argv, { booleans: ['check', 'print', 'help'], values: ['lock', 'output'], usage: USAGE });
  } catch (error) {
    console.error(`[sbom:fail] ${errorMessage(error)}`);
    return 1;
  }
  if (options.help === true) {
    console.log(USAGE);
    return 0;
  }

  const lockPath = path.resolve(projectRoot, typeof options.lock === 'string' ? options.lock : 'package-lock.json');
  const outputPath = path.resolve(projectRoot, typeof options.output === 'string' ? options.output : DEFAULT_SBOM_PATH);
  const lockLabel = toPosix(path.relative(projectRoot, lockPath)) || 'package-lock.json';

  let built;
  try {
    built = generateSbom(lockPath, lockLabel);
  } catch (error) {
    console.error(`[sbom:fail] 无法读取 lockfile:${errorMessage(error)}`);
    return 1;
  }
  const { document, stats } = built;

  if (options.check !== true) {
    writeJson(outputPath, document);
    if (options.print === true) process.stdout.write(serializeJson(document));
    console.log(
      `[ok] SBOM 已生成:${toPosix(path.relative(projectRoot, outputPath))}(CycloneDX ${CDX_SPEC_VERSION},` +
        `${stats.componentCount} 个组件:生产 ${stats.productionCount} / 开发 ${stats.developmentCount};` +
        `无声明许可证 ${stats.missingLicenseCount};serialNumber ${document.serialNumber})`,
    );
    if (stats.unresolvedDependencyCount > 0) {
      console.log(
        `[warn] SBOM 有 ${stats.unresolvedDependencyCount} 个组件的依赖未落到 lock 条目(平台可选依赖或已被剪枝):` +
          `${stats.unresolvedSample.join(';')}`,
      );
    }
    return 0;
  }

  let existing;
  try {
    existing = readJson(outputPath);
  } catch (error) {
    console.error(
      `[sbom:fail] 校验模式缺少可用 SBOM:${toPosix(path.relative(projectRoot, outputPath))}(${errorMessage(error)});` +
        '请先以生成模式运行本脚本并提交产物',
    );
    return 1;
  }
  const problems = diffSbom(existing, document);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[sbom:fail] ${problem}`);
    console.error(`[sbom:fail] SBOM 与 lockfile 漂移,共 ${problems.length} 项(重新生成并提交 SBOM 后再放行)`);
    return 1;
  }
  console.log(
    `[ok] SBOM 与 lockfile 一致(${stats.componentCount} 个组件,${toPosix(path.relative(projectRoot, outputPath))})`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
