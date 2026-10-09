// @ts-check
/**
 * 环境指纹契约段：守护稳定的 JSON/文本接口、可诊断的命令失败路径，以及公开页 Node 下限。
 * 探针均以依赖注入提供夹具，不读取或启动真实 Electron；真实命令失败由 runCommand 短进程断言。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../harness/paths.js";
import {
  collectEnvironmentFingerprint,
  formatFingerprintJson,
  formatFingerprintText,
  parseCliOptions,
  runCommand,
} from "../../gates/repo/print-env-fingerprint.mjs";
import { createCaseSuite } from "../harness/case.js";

/**
 * 构造探针结果(与 gates/repo/print-env-fingerprint.mjs 的 result() 同形)。
 * @param {string} status 探针状态(ok / partial / unavailable)
 * @param {unknown} value 探针值(各探针异构:字符串 / 版本对象 / 字体信息等)
 * @param {string} source 探针来源(诊断与报告文案)
 * @param {unknown} [error] 失败信息(默认 null)
 * @returns {{ status: string, value: unknown, source: string, error: unknown }} 探针结果
 */
function probeResult(status, value, source, error = null) {
  return { status, value, source, error };
}

/**
 * 构造 unavailable 探针结果。
 * @param {string} source 探针来源
 * @param {unknown} error 失败信息
 * @returns {{ status: string, value: unknown, source: string, error: unknown }} 探针结果
 */
function unavailable(source, error) {
  return probeResult("unavailable", null, source, error);
}

const systemInfo = {
  os: {
    platform: "win32",
    type: "Windows_NT",
    release: "10.0.26100",
    version: "Windows 11 Pro",
  },
  architecture: {
    processArch: "x64",
    machineArch: "AMD64",
    endianness: "LE",
  },
};

const positiveProbes = {
  systemInfo,
  probeNpm: async () => probeResult("ok", "11.6.2", "npm --version"),
  loadElectronPackage: async () => probeResult("ok", {
    executable: "C:\\fake\\electron.exe",
    version: "43.2.0",
  }, "node_modules/electron/package.json + path.txt"),
  probeElectron: async () => probeResult("ok", {
    electron: "43.2.0",
    chromium: "144.0.7559.50",
    node: "22.21.1",
  }, "Electron process.versions"),
  collectFonts: async () => probeResult("ok", {
    fileCount: 3,
    sha256: "0123456789abcdef",
    commonFamilies: {
      microsoftYaHei: true,
      notoSansCJK: false,
      segoeUI: true,
      simSun: true,
    },
    readableDirectoryCount: 1,
    reason: null,
  }, "installed font files"),
  collectDisplayDpi: async () => probeResult("ok", {
    logicalDpi: 120,
    scalePercent: 125,
    reason: null,
  }, "Windows AppliedDPI registry value"),
};

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  // node:assert/strict 型:按**被测行为**分组,一个 case 覆盖同一行为的多个字段
  // (拆开是把一条结构化 diff 拆成多条噪声)
  const positive = await collectEnvironmentFingerprint(positiveProbes);
  await suite.case("正例指纹的顶层与 versions 键序固定", () => {
    assert.deepEqual(Object.keys(positive), ["schemaVersion", "versions", "system", "diagnostics"]);
    assert.deepEqual(Object.keys(positive.versions), ["node", "npm", "electron", "chromium", "electronNode"]);
  });
  await suite.case("正例指纹各版本探针取值正确", () => {
    assert.equal(positive.versions.npm.value, "11.6.2");
    assert.equal(positive.versions.electron.value, "43.2.0");
    assert.equal(positive.versions.chromium.value, "144.0.7559.50");
    assert.equal(positive.versions.electronNode.value, "22.21.1");
  });
  await suite.case("正例指纹的 fonts/display 探针取值正确", () => {
    assert.equal(positive.system.fonts.value.fileCount, 3);
    assert.equal(positive.system.display.value.logicalDpi, 120);
  });
  await suite.case("正例指纹零诊断项", () => {
    assert.deepEqual(positive.diagnostics, []);
  });

  const json = formatFingerprintJson(positive);
  await suite.case("JSON 格式输出可回读且稳定", () => {
    assert.deepEqual(JSON.parse(json), positive);
    assert.equal(json, formatFingerprintJson(positive), "同一 JSON 格式输出应稳定");
  });
  const expectedText = [
    "schemaVersion=1",
    "versions.node.status=ok",
    `versions.node.value=${JSON.stringify(process.versions.node)}`,
    "versions.npm.status=ok",
    'versions.npm.value="11.6.2"',
    "versions.electron.status=ok",
    'versions.electron.value="43.2.0"',
    "versions.chromium.status=ok",
    'versions.chromium.value="144.0.7559.50"',
    "versions.electronNode.status=ok",
    'versions.electronNode.value="22.21.1"',
    'system.os.platform="win32"',
    'system.os.type="Windows_NT"',
    'system.os.release="10.0.26100"',
    'system.os.version="Windows 11 Pro"',
    'system.architecture.processArch="x64"',
    'system.architecture.machineArch="AMD64"',
    'system.architecture.endianness="LE"',
    "system.fonts.status=ok",
    "system.fonts.value.fileCount=3",
    'system.fonts.value.sha256="0123456789abcdef"',
    "system.fonts.value.readableDirectoryCount=1",
    "system.fonts.value.commonFamilies.microsoftYaHei=true",
    "system.fonts.value.commonFamilies.notoSansCJK=false",
    "system.fonts.value.commonFamilies.segoeUI=true",
    "system.fonts.value.commonFamilies.simSun=true",
    "system.display.status=ok",
    "system.display.value.logicalDpi=120",
    "system.display.value.scalePercent=125",
    "diagnostics.count=0",
    "",
  ].join("\n");
  await suite.case("文本字段顺序和序列化稳定", () => {
    assert.equal(formatFingerprintText(positive), expectedText, "文本字段顺序和序列化应稳定");
  });

  const negative = await collectEnvironmentFingerprint({
    systemInfo,
    probeNpm: async () => unavailable(
      "npm --version",
      'Command "npm --version" failed (exitCode 7, signal none): simulated npm failure',
    ),
    loadElectronPackage: async () => probeResult("ok", {
      executable: "C:\\fake\\electron.exe",
      version: "43.2.0",
    }, "node_modules/electron/package.json + path.txt"),
    probeElectron: async () => unavailable(
      "Electron process.versions",
      'Command "Electron version probe" failed (exitCode 9, signal none): missing shared library',
    ),
    collectFonts: async () => unavailable("installed font files", "font directory is unreadable"),
    collectDisplayDpi: async () => unavailable("Windows AppliedDPI registry value", "registry value is absent"),
  });
  await suite.case("负例指纹的失败探针标为 unavailable", () => {
    assert.equal(negative.versions.npm.status, "unavailable");
    assert.equal(negative.versions.chromium.status, "unavailable");
    assert.equal(negative.versions.electronNode.status, "unavailable");
    assert.equal(negative.system.fonts.status, "unavailable");
    assert.equal(negative.system.display.status, "unavailable");
  });
  await suite.case("二进制探针失败时仍保留可读的包版本", () => {
    assert.equal(negative.versions.electron.value, "43.2.0", "二进制探针失败时仍应保留可读的包版本");
  });
  await suite.case("负例指纹诊断项齐全(含 npm / electron-process 来源)", () => {
    assert.equal(negative.diagnostics.length, 4);
    // 上一行已断言 diagnostics.length === 4,两个来源必然各命中一条;显式校验缺失以免静默跳过断言
    const npmDiagnostic = negative.diagnostics.find((diagnostic) => diagnostic.source === "npm");
    const electronDiagnostic = negative.diagnostics.find((diagnostic) => diagnostic.source === "electron-process");
    if (!npmDiagnostic || !electronDiagnostic) {
      throw new Error("负例指纹缺少 npm / electron-process 诊断项");
    }
    assert.match(npmDiagnostic.message, /npm --version.*exitCode 7.*simulated npm failure/);
    assert.match(electronDiagnostic.message, /Electron version probe.*exitCode 9/);
  });
  await suite.case("失败路径的 JSON 仍可解析,文本输出诊断计数为 4", () => {
    assert.doesNotThrow(() => JSON.parse(formatFingerprintJson(negative)), "失败路径的 JSON 仍应可解析");
    assert.match(formatFingerprintText(negative), /diagnostics\.count=4/);
  });

  const nodeExecutable = process.env.npm_node_execpath
    || (process.platform === "win32" ? "node.exe" : "node");
  const commandFailure = await runCommand(nodeExecutable, [
    "-e",
    'process.stderr.write("expected fingerprint probe failure"); process.exit(7);',
  ], { timeoutMs: 5_000 });
  await suite.case("runCommand 的失败路径上报 ok=false 与退出码", () => {
    assert.equal(commandFailure.ok, false);
    assert.equal(commandFailure.exitCode, 7);
    assert.match(commandFailure.stderr, /expected fingerprint probe failure/);
  });

  await suite.case("parseCliOptions 正常解析 --format/--strict", () => {
    assert.deepEqual(parseCliOptions(["--format=json", "--strict"]), {
      format: "json",
      strict: true,
      help: false,
    });
  });
  await suite.case("parseCliOptions 拒绝非法格式与重复指定", () => {
    assert.throws(() => parseCliOptions(["--format=yaml"]), /requires either json or text/);
    assert.throws(() => parseCliOptions(["--json", "--text"]), /specified more than once/);
  });

  const landingPage = await readFile(path.join(ROOT, "docs", "index.html"), "utf8");
  await suite.case("公开页 Node 下限为 ≥ 22.13(旧下限已移除)", () => {
    assert.match(landingPage, /Node\.js ≥ 22\.13/);
    assert.doesNotMatch(landingPage, /Node\.js ≥ 20\.19/);
  });

  console.log("[ok] env-fingerprint: 稳定 JSON/text、失败诊断、CLI 参数与 Node.js ≥22.13 文档断言通过");
  return { cases: suite.results };
}
