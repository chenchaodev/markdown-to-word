// 发布产物核对 + SHA-256 报告(exit 0/1)。
//
// 用途:release 目录是累积目录(electron-builder 不清理),历史上已存在多个版本的
// 安装包与 latest.yml。若直接发布,「发出去的是不是刚构建的那一份」没有任何断言,
// 自动更新通道读到的 latest.yml 也可能指向旧包。本脚本只接受**当前 package
// 版本**对应的目标,并核对四件事:
//   1. 当前版本目标齐全:NSIS 安装包、其 .blockmap(自动更新差分用)、latest.yml;
//   2. latest.yml 与实际安装包一致:version / path / size / sha512 全部对齐
//      (sha512 逐字节重算,不是抄写 yml 里的值);
//   3. 目录内无其他版本的历史产物(旧安装包/旧 yml/旧 target 压缩包一律视为污染);
//   4. 全部通过后写出 SHA-256 报告(发布指纹,确定性内容:同一份产物重跑结果一致,
//      可 diff;时间归属由版本号与 git tag 承载,不写易漂移的时间戳)。
//
// 目标文件名不写死:由 package.json 的 build.nsis.artifactName 模板展开
// (productName/version/ext),electron-builder 改模板时本检查自动跟随。
//
// 用法:
//   node scripts/check-release-artifacts.mjs [--release <dir>] [--pkg <file>] [--report <file>] [--no-report]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile, isMainModule, parseArgs, toPosix, writeFileAtomic } from './check-dist-manifest.mjs';

export const REPORT_SCHEMA = 'm2w/release-artifacts@1';
export const LATEST_YML = 'latest.yml';
export const DEFAULT_RELEASE_DIR = 'release';
export const DEFAULT_REPORT_PATH = path.join('output', 'artifacts', 'release-artifacts.json');

/** electron-builder 产物之外允许留在 release 根的构建期副产物(无版本号) */
const NON_ARTIFACT_FILES = new Set(['builder-debug.yml', 'builder-effective-config.yaml']);

const USAGE = `用法: node scripts/check-release-artifacts.mjs [选项]
  --release <dir>  发布产物目录(默认 release;取自 build.directories.output)
  --pkg <file>     版本与目标名来源(默认 package.json)
  --report <file>  SHA-256 报告落盘路径(默认 output/artifacts/release-artifacts.json)
  --no-report      只校验,不写报告
  --help           显示本用法`;

/**
 * 展开 electron-builder 的 artifactName 模板。只支持 productName/version/ext
 * 三个占位符:遇到未知占位符直接报错,避免拼出不存在的文件名后误报「缺产物」。
 */
export function expandArtifactName(template, { productName, version, ext }) {
  const placeholders = { productName, version, ext };
  return template.replace(/\$\{(\w+)\}/g, (_, name) => {
    if (!(name in placeholders)) throw new Error(`artifactName 含不支持的占位符:${name}(支持 productName/version/ext)`);
    return placeholders[name];
  });
}

/**
 * 解析 electron-builder 生成的 latest.yml。只认它的固定形态
 * (顶层 version/path/sha512 + files 列表 + releaseDate),不做通用 YAML 解析:
 * 结构不认识时抛错退出,而不是「尽力解析出部分字段」后给出误导性通过。
 */
export function parseLatestYml(text) {
  const result = { version: null, path: null, sha512: null, releaseDate: null, files: [] };
  let currentFile = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const matched = /^(\s*)(- )?([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    if (matched === null) throw new Error(`latest.yml 结构不受支持(第 ${i + 1} 行):${raw.trim()}`);
    const [, indent, dash, key, rawValue] = matched;
    const value = rawValue.replace(/^'(.*)'$/, '$1');
    if (dash !== undefined) {
      if (key !== 'url') throw new Error(`latest.yml 列表项首字段须为 url(第 ${i + 1} 行):${raw.trim()}`);
      currentFile = { url: value, size: null, sha512: null };
      result.files.push(currentFile);
      continue;
    }
    // 顶层键:空值且为 files 时只作分节标记,其余落到结果对象
    if (indent === '') {
      if (key === 'files' && value === '') {
        currentFile = null;
        continue;
      }
      if (key === 'size') {
        const size = Number(value);
        if (!Number.isInteger(size)) throw new Error(`latest.yml size 非整数(第 ${i + 1} 行):${raw.trim()}`);
        result.size = size;
        continue;
      }
      result[key] = value;
      continue;
    }
    // 缩进键:只能出现在 files 列表项内
    if (currentFile === null) throw new Error(`latest.yml 缩进异常(第 ${i + 1} 行):${raw.trim()}`);
    if (key === 'size') {
      const size = Number(value);
      if (!Number.isInteger(size)) throw new Error(`latest.yml size 非整数(第 ${i + 1} 行):${raw.trim()}`);
      currentFile.size = size;
      continue;
    }
    currentFile[key] = value;
  }
  for (const key of ['version', 'path', 'sha512']) {
    if (typeof result[key] !== 'string' || result[key] === '') throw new Error(`latest.yml 缺少 ${key} 字段`);
  }
  if (result.files.length === 0) throw new Error('latest.yml 缺少 files 条目');
  const [first] = result.files;
  if (!first.url || !first.sha512 || first.size === null) throw new Error('latest.yml files[0] 缺 url/sha512/size');
  return result;
}

/** release 根目录内的历史/非预期产物扫描(只看顶层文件) */
export function findForeignArtifacts(releaseDir, { version, expectedNames }) {
  const foreign = [];
  for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (expectedNames.has(name) || NON_ARTIFACT_FILES.has(name)) continue;
    const tokens = name.match(/\d+\.\d+\.\d+/g) ?? [];
    if (tokens.length === 0) continue; // 无版本号的构建期副产物:不在本检查范围
    if (tokens.every((token) => token === version)) {
      foreign.push({ name, reason: '当前版本的非预期产物(目标模板与实际文件名不一致?)' });
    } else {
      foreign.push({ name, reason: `历史产物残留(版本 ${tokens.join('/')} ≠ ${version}),发布前应清理 release 目录` });
    }
  }
  return foreign.sort((a, b) => a.name.localeCompare(b.name));
}

export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['no-report', 'help'], values: ['release', 'pkg', 'report'] });
  } catch (error) {
    console.error(`[release:fail] ${error.message}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const pkgPath = path.resolve(projectRoot, options.pkg ?? 'package.json');
  if (!existsSync(pkgPath)) {
    console.error(`[release:fail] package.json 不存在:${pkgPath}`);
    return 1;
  }
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    console.error(`[release:fail] package.json 不可读:${error.message}`);
    return 1;
  }

  const version = typeof pkg.version === 'string' ? pkg.version : '';
  const productName = typeof pkg.build?.productName === 'string' ? pkg.build.productName : '';
  const artifactTemplate = pkg.build?.nsis?.artifactName;
  const outputDir = pkg.build?.directories?.output ?? DEFAULT_RELEASE_DIR;
  const releaseDir = path.resolve(projectRoot, options.release ?? outputDir);
  const problems = [];
  if (version === '') problems.push('package.json 缺少 version(发布目标无从确定)');
  if (typeof artifactTemplate !== 'string' || artifactTemplate === '') {
    problems.push('package.json build.nsis.artifactName 缺失(安装包名无从确定)');
  }

  let installerName = '';
  if (version !== '' && typeof artifactTemplate === 'string' && artifactTemplate !== '') {
    try {
      installerName = expandArtifactName(artifactTemplate, { productName, version, ext: 'exe' });
    } catch (error) {
      problems.push(error.message);
    }
  }

  const blockmapName = installerName === '' ? '' : `${installerName}.blockmap`;
  const expectedNames = new Set([installerName, blockmapName, LATEST_YML].filter((name) => name !== ''));

  if (problems.length > 0 || installerName === '') {
    for (const problem of problems) console.error(`[release:fail] ${problem}`);
    console.error('[release:fail] 发布目标定义不完整,无法核对产物');
    return 1;
  }

  if (!existsSync(releaseDir) || !statSync(releaseDir).isDirectory()) {
    console.error(`[release:fail] 发布目录不存在:${toPosix(path.relative(projectRoot, releaseDir))};请先运行打包(dist 步骤)`);
    return 1;
  }

  // ---- 1. 当前版本目标齐全 ----
  const installerPath = path.join(releaseDir, installerName);
  if (!existsSync(installerPath)) {
    problems.push(`缺少当前版本安装包:${installerName}(期望版本 ${version})`);
  } else if (statSync(installerPath).size === 0) {
    problems.push(`安装包为空文件:${installerName}(打包中断?)`);
  }
  const blockmapPath = path.join(releaseDir, blockmapName);
  if (!existsSync(blockmapPath)) {
    problems.push(`缺少安装包差分索引:${blockmapName}(自动更新通道依赖)`);
  } else if (statSync(blockmapPath).size === 0) {
    problems.push(`差分索引为空文件:${blockmapName}`);
  }

  // ---- 3. 历史/非预期产物 ----
  for (const { name, reason } of findForeignArtifacts(releaseDir, { version, expectedNames })) {
    problems.push(`发布目录存在非预期产物:${name} —— ${reason}`);
  }

  // ---- 2. latest.yml 与实际安装包一致 ----
  const latestPath = path.join(releaseDir, LATEST_YML);
  let latest = null;
  if (!existsSync(latestPath)) {
    problems.push(`缺少 ${LATEST_YML}(自动更新通道依赖)`);
  } else if (statSync(latestPath).size === 0) {
    problems.push(`${LATEST_YML} 为空文件(打包中断?)`);
  } else {
    try {
      latest = parseLatestYml(readFileSync(latestPath, 'utf8'));
    } catch (error) {
      problems.push(`${LATEST_YML} 不可解析:${error.message}`);
    }
  }

  const artifactDigests = new Map();
  if (latest !== null) {
    if (latest.version !== version) {
      problems.push(`${LATEST_YML} version(${latest.version})与 package.json 版本(${version})不一致(发的是旧包?)`);
    }
    if (latest.path !== installerName) {
      problems.push(`${LATEST_YML} path(${latest.path})应指向 ${installerName}`);
    }
    const [first] = latest.files;
    if (first.url !== installerName) {
      problems.push(`${LATEST_YML} files[0].url(${first.url})应指向 ${installerName}`);
    }
    if (existsSync(installerPath) && statSync(installerPath).size > 0) {
      const realSize = statSync(installerPath).size;
      const realSha512 = await hashFile(installerPath, 'sha512', 'base64');
      if (first.size !== realSize) {
        problems.push(`${LATEST_YML} files[0].size(${first.size})与实际安装包大小(${realSize})不一致`);
      }
      if (first.sha512 !== realSha512) {
        problems.push(`${LATEST_YML} files[0].sha512 与实际安装包摘要不一致(自动更新会校验失败)`);
      }
      if (latest.sha512 !== realSha512) {
        problems.push(`${LATEST_YML} sha512 与实际安装包摘要不一致(自动更新会校验失败)`);
      }
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`[release:fail] ${problem}`);
    console.error(`[release:fail] 发布产物核对失败,共 ${problems.length} 项(不生成报告)`);
    return 1;
  }

  // ---- 4. SHA-256 报告(仅在全部通过后生成:失败产物不留误导性指纹) ----
  for (const name of expectedNames) {
    const target = path.join(releaseDir, name);
    artifactDigests.set(name, { size: statSync(target).size, sha256: await hashFile(target) });
  }
  const report = {
    schema: REPORT_SCHEMA,
    version,
    productName,
    releaseDir: toPosix(path.relative(projectRoot, releaseDir)),
    artifacts: [...expectedNames].map((name) => ({ name, size: artifactDigests.get(name).size, sha256: artifactDigests.get(name).sha256 })),
    latestYml: { version: latest.version, path: latest.path, size: latest.files[0].size, sha512: latest.files[0].sha512 },
  };
  if (!options['no-report']) {
    const reportPath = path.resolve(projectRoot, options.report ?? DEFAULT_REPORT_PATH);
    writeFileAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[ok] SHA-256 报告:${toPosix(path.relative(projectRoot, reportPath))}`);
  }
  console.log(
    `[ok] 发布产物核对通过:${version} 目标 ${installerName} + ${blockmapName} + ${LATEST_YML};` +
      `无历史产物残留;latest.yml version/path/size/sha512 与安装包一致`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
