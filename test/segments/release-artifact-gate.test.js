/**
 * ASAR 与发布产物门禁(位于 test/segments/ = 跨域守护段;被测为 scripts/ 下的
 * 发布检查脚本,纯 Node 逻辑不经 dist 编译产物):
 * - check-asar-manifest.mjs:app.asar 的结构(顶层白名单)、入口与 KaTeX/Mermaid 资源
 *   锁定、包内 package.json 版本锁定,以及与 clean dist 清单的逐项哈希核对
 * - check-release-artifacts.mjs:只接受当前 package 版本目标,核对 latest.yml 的
 *   version/path/size/sha512,拒绝历史产物残留,并生成 SHA-256 报告
 *
 * 夹具原则:全部在临时目录现造(asar 由 @electron/asar 现打,安装包为假字节),
 * 不依赖仓库内既有的 release/ 目录(本地残留着历史版本产物,CI 上则不存在);
 * 断言退出码同时断言失败原因,避免「因错误原因失败」也算通过。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EXPECTED_TOP_LEVEL,
  REQUIRED_ENTRIES,
  REQUIRED_PREFIXES,
  loadAsar,
  main as asarMain,
} from "../../scripts/check-asar-manifest.mjs";
import { main as releaseMain } from "../../scripts/check-release-artifacts.mjs";

const FIXTURE_VERSION = "9.9.9";
const FIXTURE_PRODUCT = "FixtureApp";

function assert(cond, msg) {
  if (!cond) throw new Error(`release-artifact-gate 断言失败:${msg}`);
}

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-release-gate-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 跑脚本 main():吞掉 console 输出,返回 { code, output } 供失败原因断言 */
async function runChecker(fn) {
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const code = await fn();
    return { code, output: lines.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function writeFileIn(dir, relative, content) {
  const target = path.join(dir, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

/** 与被测实现无关的 dist 清单计算(相对路径 + size + SHA-256,字典序) */
function independentManifest(distDir) {
  const walk = (base, dir = base, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(base, abs, out);
      else out.push(path.relative(base, abs).split(path.sep).join("/"));
    }
    return out;
  };
  return walk(distDir)
    .sort()
    .map((relative) => {
      const abs = path.join(distDir, ...relative.split("/"));
      const content = fs.readFileSync(abs);
      return { path: relative, size: content.length, sha256: createHash("sha256").update(content).digest("hex") };
    });
}

/** 夹具 package.json:版本 + 目标名模板(发布检查据此推导期望文件名) */
function fixturePackageJson(version = FIXTURE_VERSION) {
  return {
    name: "fixture-app",
    version,
    main: "dist/main/index.js",
    build: {
      productName: FIXTURE_PRODUCT,
      directories: { output: "release" },
      nsis: { artifactName: "${productName}-Setup-${version}.${ext}" },
    },
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/* ---------- ASAR 夹具 ---------- */

/** 现打一个 app.asar:内含全部必备条目 + dist 清单,返回 { asarPath, manifestPath, pkgPath } */
async function makeAsarFixture(tmp, { archiveVersion = FIXTURE_VERSION, skip = [], extraFiles = {}, packageMain = "dist/main/index.js" } = {}) {
  const asarSrc = path.join(tmp, "asar-src");
  writeJson(path.join(asarSrc, "package.json"), { name: "fixture-app", version: archiveVersion, main: packageMain });
  for (const { path: entryPath } of REQUIRED_ENTRIES) {
    if (skip.includes(entryPath) || entryPath.startsWith("package.json")) continue;
    writeFileIn(asarSrc, entryPath, `// ${entryPath}\n`);
  }
  writeFileIn(asarSrc, packageMain, "// main entry\n");
  for (const { prefix, suffix } of REQUIRED_PREFIXES) {
    const name = `${prefix}base${suffix}`;
    if (!skip.includes(name)) writeFileIn(asarSrc, name, "body {}\n");
  }
  for (const [relative, content] of Object.entries(extraFiles)) {
    writeFileIn(asarSrc, relative, content);
  }

  // 夹具归档刻意不叫 *.asar:Electron 主进程的 fs 层会把任何含 ".asar" 的路径交给
  // asar 虚拟文件系统接管(其 splitPath 正则 /\.asar/i),导致 statSync 恒为 0、
  // 目录也删不掉。@electron/asar 按内容读取,与扩展名无关,故用 .bin 命名。
  const asarPath = path.join(tmp, "release", "win-unpacked", "resources", "fixture-archive.bin");
  fs.mkdirSync(path.dirname(asarPath), { recursive: true });
  const asarApi = loadAsar();
  const stream = await asarApi.createPackageWithOptions(asarSrc, asarPath, {});
  await new Promise((resolve, reject) => {
    stream.on("close", resolve);
    stream.on("error", reject);
  });

  const pkgPath = path.join(tmp, "package.json");
  writeJson(pkgPath, fixturePackageJson());
  const manifestPath = path.join(tmp, "dist-manifest.json");
  const files = independentManifest(path.join(asarSrc, "dist"));
  writeJson(manifestPath, {
    schema: "m2w/dist-manifest@1",
    distRoot: "dist",
    fileCount: files.length,
    totalSize: files.reduce((sum, entry) => sum + entry.size, 0),
    files,
  });
  return { asarPath, manifestPath, pkgPath, asarSrc };
}

/* ---------- release 夹具 ---------- */

/** 造一份「当前版本齐全」的发布目录,mutate 用于注入漂移 */
function makeReleaseFixture(tmp, { version = FIXTURE_VERSION, mutate } = {}) {
  const releaseDir = path.join(tmp, "release");
  fs.mkdirSync(releaseDir, { recursive: true });
  const installerName = `${FIXTURE_PRODUCT}-Setup-${version}.exe`;
  const installerPath = path.join(releaseDir, installerName);
  fs.writeFileSync(installerPath, "FAKE-INSTALLER-BYTES\n", "utf8");
  fs.writeFileSync(path.join(releaseDir, `${installerName}.blockmap`), "FAKE-BLOCKMAP\n", "utf8");
  const content = fs.readFileSync(installerPath);
  const sha512 = createHash("sha512").update(content).digest("base64");
  const latestYml = [
    `version: ${version}`,
    'files:',
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${content.length}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-01-01T00:00:00.000Z'",
    '',
  ].join('\n');
  fs.writeFileSync(path.join(releaseDir, "latest.yml"), latestYml, "utf8");
  const pkgPath = path.join(tmp, "package.json");
  writeJson(pkgPath, fixturePackageJson(version));
  if (mutate) mutate({ releaseDir, installerPath, installerName, latestYml, version });
  return { releaseDir, installerPath, installerName, pkgPath, installerSha256: createHash("sha256").update(content).digest("hex") };
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ---------- 0. 契约常量自检:防止必备条目清单被清空后检查变成空转 ----------
  assert(EXPECTED_TOP_LEVEL.length === 3, "顶层白名单应为 dist/node_modules/package.json 三项");
  assert(EXPECTED_TOP_LEVEL.includes("package.json") && EXPECTED_TOP_LEVEL.includes("node_modules"), "顶层白名单须含 package.json 与 node_modules");
  const requiredPaths = REQUIRED_ENTRIES.map((entry) => entry.path);
  for (const mustExist of [
    "dist/main/preload.cjs",
    "dist/renderer/index.html",
    "dist/core/convert.js",
    "node_modules/katex/dist/katex.min.css",
    "node_modules/mermaid/dist/mermaid.min.js",
  ]) {
    assert(requiredPaths.includes(mustExist), `必备条目清单须含 ${mustExist}(否则检查会静默放行)`);
  }
  assert(
    REQUIRED_PREFIXES.some((rule) => rule.prefix.startsWith("dist/renderer/style/") && rule.atLeast >= 1),
    "须有 renderer 样式表的前缀类要求",
  );
  console.log(`[ok] release-artifact-gate:ASAR 契约常量非空(${requiredPaths.length} 条必备条目 + 1 条前缀要求)`);

  // ---------- 1. ASAR 正向:结构/入口/资源/清单核对全通过 ----------
  await withTempDir(async (tmp) => {
    const { asarPath, manifestPath, pkgPath } = await makeAsarFixture(tmp);
    const result = await runChecker(() => asarMain(["--asar", asarPath, "--pkg", pkgPath, "--manifest", manifestPath]));
    assert(result.code === 0, `齐备的 asar 应通过,实际 ${result.code}\n${result.output}`);
    assert(/app\.asar 核对通过/.test(result.output), `通过文案应可读,实际:${result.output}`);
  });
  console.log("[ok] release-artifact-gate:ASAR 齐备夹具通过(结构 + 入口 + 资源 + 清单哈希核对)");

  // ---------- 2. ASAR 负向:缺/坏/旧/污染 一律非零退出 ----------
  const asarCases = [
    {
      name: "asar 文件缺失",
      build: async (tmp) => {
        const fixture = await makeAsarFixture(tmp);
        fs.rmSync(fixture.asarPath, { force: true });
        return fixture;
      },
      expect: /找不到 app\.asar/,
    },
    {
      name: "asar 为空文件(打包中断)",
      build: async (tmp) => {
        const fixture = await makeAsarFixture(tmp);
        fs.writeFileSync(fixture.asarPath, "");
        return fixture;
      },
      expect: /app\.asar 为空文件/,
    },
    {
      name: "包内版本落后(打的是旧 dist)",
      build: (tmp) => makeAsarFixture(tmp, { archiveVersion: "8.0.0" }),
      expect: /包内 package\.json 版本\(8\.0\.0\)与仓库版本/,
    },
    {
      name: "缺 KaTeX 公式资源",
      build: (tmp) => makeAsarFixture(tmp, { skip: ["node_modules/katex/dist/katex.min.css"] }),
      expect: /缺少KaTeX 资源条目/,
    },
    {
      name: "缺主进程入口(包内 main 指向不存在文件)",
      build: (tmp) => makeAsarFixture(tmp, { packageMain: "dist/main/entry.js" }),
      expect: /缺少主进程入口\(package\.json main\)条目/,
    },
    {
      name: "顶层混入预期外文件(误打包)",
      build: (tmp) => makeAsarFixture(tmp, { extraFiles: { "test/acceptance.mjs": "// 不该进包\n" } }),
      expect: /包内出现预期外顶层项:test/,
    },
    {
      name: "包内 dist 与清单哈希不符",
      build: async (tmp) => {
        const fixture = await makeAsarFixture(tmp);
        const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
        manifest.files[0].sha256 = "f".repeat(64);
        writeJson(fixture.manifestPath, manifest);
        return fixture;
      },
      expect: /哈希与清单不符/,
    },
    {
      name: "包内 dist 存在清单未记录的多余文件",
      build: async (tmp) => {
        const fixture = await makeAsarFixture(tmp);
        const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8"));
        manifest.files = manifest.files.slice(1);
        writeJson(fixture.manifestPath, manifest);
        return fixture;
      },
      expect: /包内多余,清单未记录/,
    },
    {
      name: "dist 清单缺失(未纳入发布链)",
      build: async (tmp) => {
        const fixture = await makeAsarFixture(tmp);
        fs.rmSync(fixture.manifestPath, { force: true });
        return fixture;
      },
      expect: /缺少 dist 清单/,
    },
    {
      name: "dist 清单损坏",
      build: async (tmp) => {
        const fixture = await makeAsarFixture(tmp);
        fs.writeFileSync(fixture.manifestPath, "{ broken", "utf8");
        return fixture;
      },
      expect: /dist 清单不可用/,
    },
  ];
  for (const testCase of asarCases) {
    await withTempDir(async (tmp) => {
      const fixture = await testCase.build(tmp);
      const result = await runChecker(() =>
        asarMain(["--asar", fixture.asarPath, "--pkg", fixture.pkgPath, "--manifest", fixture.manifestPath]),
      );
      assert(
        result.code === 1 && testCase.expect.test(result.output),
        `ASAR ${testCase.name} 应以非零码且原因匹配 ${testCase.expect} 失败,实际 exit ${result.code}\n${result.output}`,
      );
    });
  }
  console.log(`[ok] release-artifact-gate:${asarCases.length} 条 ASAR 负向夹具全部被拦截`);

  // ---------- 3. ASAR 显式放行:--skip-manifest 放行但留痕 ----------
  await withTempDir(async (tmp) => {
    const { asarPath, pkgPath, manifestPath } = await makeAsarFixture(tmp);
    fs.rmSync(manifestPath, { force: true });
    const skipped = await runChecker(() =>
      asarMain(["--asar", asarPath, "--pkg", pkgPath, "--manifest", manifestPath, "--skip-manifest"]),
    );
    assert(skipped.code === 0, `--skip-manifest 应显式放行,实际 ${skipped.code}\n${skipped.output}`);
    assert(/已跳过 dist 清单交叉核对/.test(skipped.output), `放行须留痕,实际:${skipped.output}`);
  });
  console.log("[ok] release-artifact-gate:--skip-manifest 放行但输出留痕");

  // ---------- 4. release 正向:目标齐全 + latest.yml 对齐 + SHA-256 报告 ----------
  await withTempDir(async (tmp) => {
    const fixture = makeReleaseFixture(tmp);
    const reportPath = path.join(tmp, "reports", "release-artifacts.json");
    const result = await runChecker(() =>
      releaseMain(["--release", fixture.releaseDir, "--pkg", fixture.pkgPath, "--report", reportPath]),
    );
    assert(result.code === 0, `齐备的发布目录应通过,实际 ${result.code}\n${result.output}`);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert(report.version === FIXTURE_VERSION, `报告版本应为 ${FIXTURE_VERSION},实际 ${report.version}`);
    const installerEntry = report.artifacts.find((entry) => entry.name === fixture.installerName);
    assert(installerEntry !== undefined, "报告应含安装包条目");
    assert(
      installerEntry.sha256 === fixture.installerSha256,
      `报告 SHA-256 应为测试侧独立计算值,实际 ${installerEntry.sha256}`,
    );
    assert(
      installerEntry.size === fs.statSync(fixture.installerPath).size,
      "报告 size 应与实际文件大小一致",
    );
    assert(report.latestYml.version === FIXTURE_VERSION && report.latestYml.path === fixture.installerName, "报告应记录 latest.yml 的 version/path");
    assert(
      report.artifacts.some((entry) => entry.name === "latest.yml") &&
        report.artifacts.some((entry) => entry.name === `${fixture.installerName}.blockmap`),
      "报告应覆盖安装包/blockmap/latest.yml 三件产物",
    );
    // 确定性:同一份产物重跑,报告逐字节一致(可 diff、可追溯)
    const firstReport = fs.readFileSync(reportPath, "utf8");
    await runChecker(() => releaseMain(["--release", fixture.releaseDir, "--pkg", fixture.pkgPath, "--report", reportPath]));
    assert(fs.readFileSync(reportPath, "utf8") === firstReport, "重复生成的报告应逐字节一致");
    // --no-report 只校验不落盘
    const noReportPath = path.join(tmp, "reports", "should-not-exist.json");
    const noReport = await runChecker(() =>
      releaseMain(["--release", fixture.releaseDir, "--pkg", fixture.pkgPath, "--report", noReportPath, "--no-report"]),
    );
    assert(noReport.code === 0, `--no-report 应仍通过校验,实际 ${noReport.code}\n${noReport.output}`);
    assert(!fs.existsSync(noReportPath), "--no-report 不应写报告");
  });
  console.log("[ok] release-artifact-gate:发布产物通过,latest.yml 四项对齐,SHA-256 报告正确且可复现");

  // ---------- 5. release 负向:缺/坏/空/历史产物 一律非零退出 ----------
  const releaseCases = [
    {
      name: "缺当前版本安装包",
      mutate: ({ installerPath }) => fs.rmSync(installerPath, { force: true }),
      expect: /缺少当前版本安装包/,
    },
    {
      name: "安装包为空文件",
      mutate: ({ installerPath }) => fs.writeFileSync(installerPath, "", "utf8"),
      expect: /安装包为空文件/,
    },
    {
      name: "缺 blockmap(自动更新通道依赖)",
      mutate: ({ releaseDir, installerName }) => fs.rmSync(path.join(releaseDir, `${installerName}.blockmap`), { force: true }),
      expect: /缺少安装包差分索引/,
    },
    {
      name: "latest.yml 缺失",
      mutate: ({ releaseDir }) => fs.rmSync(path.join(releaseDir, "latest.yml"), { force: true }),
      expect: /缺少 latest\.yml/,
    },
    {
      name: "latest.yml 不可解析",
      mutate: ({ releaseDir }) => fs.writeFileSync(path.join(releaseDir, "latest.yml"), "::: 不是 yml :::\n", "utf8"),
      expect: /latest\.yml 不可解析/,
    },
    {
      name: "latest.yml 版本落后",
      mutate: ({ releaseDir, latestYml }) => fs.writeFileSync(path.join(releaseDir, "latest.yml"), latestYml.replace(`version: ${FIXTURE_VERSION}`, "version: 1.0.0"), "utf8"),
      expect: /latest\.yml version\(1\.0\.0\)与 package\.json 版本/,
    },
    {
      name: "latest.yml path 指向别的文件",
      mutate: ({ releaseDir, latestYml }) => fs.writeFileSync(path.join(releaseDir, "latest.yml"), latestYml.replace(new RegExp(`^path: .*$`, "m"), "path: other-Setup.exe"), "utf8"),
      expect: /latest\.yml path\(other-Setup\.exe\)应指向/,
    },
    {
      name: "latest.yml size 与实际不符",
      mutate: ({ releaseDir, latestYml }) =>
        fs.writeFileSync(
          path.join(releaseDir, "latest.yml"),
          latestYml.replace(/( {4}size: )\d+/, (_match, prefix) => `${prefix}123`),
          "utf8",
        ),
      expect: /files\[0\]\.size\(123\)与实际安装包大小/,
    },
    {
      name: "latest.yml sha512 与实际不符(自动更新会失败)",
      mutate: ({ releaseDir, latestYml }) => fs.writeFileSync(path.join(releaseDir, "latest.yml"), latestYml.replace(/sha512: .*/g, "sha512: AAAAAA=="), "utf8"),
      expect: /files\[0\]\.sha512 与实际安装包摘要不一致/,
    },
    {
      name: "目录内存在历史版本安装包",
      mutate: ({ releaseDir }) => fs.writeFileSync(path.join(releaseDir, `${FIXTURE_PRODUCT}-Setup-1.0.0.exe`), "OLD\n", "utf8"),
      expect: /历史产物残留\(版本 1\.0\.0/,
    },
    {
      name: "目录内存在其他 target 的历史压缩包",
      mutate: ({ releaseDir }) => fs.writeFileSync(path.join(releaseDir, "fixture-app-1.0.0-x64.nsis.7z"), "OLD\n", "utf8"),
      expect: /历史产物残留\(版本 1\.0\.0/,
    },
  ];
  for (const testCase of releaseCases) {
    await withTempDir(async (tmp) => {
      const fixture = makeReleaseFixture(tmp, { mutate: testCase.mutate });
      const reportPath = path.join(tmp, "report.json");
      const result = await runChecker(() =>
        releaseMain(["--release", fixture.releaseDir, "--pkg", fixture.pkgPath, "--report", reportPath]),
      );
      assert(
        result.code === 1 && testCase.expect.test(result.output),
        `release ${testCase.name} 应以非零码且原因匹配 ${testCase.expect} 失败,实际 exit ${result.code}\n${result.output}`,
      );
      assert(!fs.existsSync(reportPath), "校验失败时不应生成报告(避免留下误导性指纹)");
    });
  }
  console.log(`[ok] release-artifact-gate:${releaseCases.length} 条发布产物负向夹具全部被拦截(缺/坏/空/历史)`);

  // ---------- 6. 发布目录缺失与参数写错 ----------
  await withTempDir(async (tmp) => {
    const pkgPath = path.join(tmp, "package.json");
    writeJson(pkgPath, fixturePackageJson());
    const noDir = await runChecker(() =>
      releaseMain(["--release", path.join(tmp, "no-release"), "--pkg", pkgPath, "--report", path.join(tmp, "r.json")]),
    );
    assert(noDir.code === 1 && /发布目录不存在/.test(noDir.output), `发布目录缺失应失败,实际 ${noDir.code}\n${noDir.output}`);
    const badOption = await runChecker(() => releaseMain(["--ver", "1.0.0"]));
    assert(badOption.code === 1 && /无法识别的选项/.test(badOption.output), "参数写错应失败而非按默认值跑");
    // artifactName 模板含不支持的占位符:应报错而不是拼出不存在的文件名
    const badTemplate = path.join(tmp, "bad-pkg.json");
    const pkg = fixturePackageJson();
    pkg.build.nsis.artifactName = "${name}-${version}.${ext}";
    writeJson(badTemplate, pkg);
    const badName = await runChecker(() =>
      releaseMain(["--release", path.join(tmp, "r"), "--pkg", badTemplate, "--report", path.join(tmp, "r.json")]),
    );
    assert(badName.code === 1 && /不支持的占位符/.test(badName.output), `模板占位符不受支持应失败,实际 ${badName.code}\n${badName.output}`);
  });
  console.log("[ok] release-artifact-gate:发布目录缺失/参数写错/模板占位符不受支持均非零退出");
}
