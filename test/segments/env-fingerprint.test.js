/**
 * 环境指纹契约段：守护稳定的 JSON/文本接口、可诊断的命令失败路径，以及公开页 Node 下限。
 * 探针均以依赖注入提供夹具，不读取或启动真实 Electron；真实命令失败由 runCommand 短进程断言。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  collectEnvironmentFingerprint,
  formatFingerprintJson,
  formatFingerprintText,
  parseCliOptions,
  runCommand,
} from "../../scripts/print-env-fingerprint.mjs";

function probeResult(status, value, source, error = null) {
  return { status, value, source, error };
}

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

export async function run() {
  const positive = await collectEnvironmentFingerprint(positiveProbes);
  assert.deepEqual(Object.keys(positive), ["schemaVersion", "versions", "system", "diagnostics"]);
  assert.deepEqual(Object.keys(positive.versions), ["node", "npm", "electron", "chromium", "electronNode"]);
  assert.equal(positive.versions.npm.value, "11.6.2");
  assert.equal(positive.versions.electron.value, "43.2.0");
  assert.equal(positive.versions.chromium.value, "144.0.7559.50");
  assert.equal(positive.versions.electronNode.value, "22.21.1");
  assert.equal(positive.system.fonts.value.fileCount, 3);
  assert.equal(positive.system.display.value.logicalDpi, 120);
  assert.deepEqual(positive.diagnostics, []);

  const json = formatFingerprintJson(positive);
  assert.deepEqual(JSON.parse(json), positive);
  assert.equal(json, formatFingerprintJson(positive), "同一 JSON 格式输出应稳定");
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
  assert.equal(formatFingerprintText(positive), expectedText, "文本字段顺序和序列化应稳定");

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
  assert.equal(negative.versions.npm.status, "unavailable");
  assert.equal(negative.versions.electron.value, "43.2.0", "二进制探针失败时仍应保留可读的包版本");
  assert.equal(negative.versions.chromium.status, "unavailable");
  assert.equal(negative.versions.electronNode.status, "unavailable");
  assert.equal(negative.system.fonts.status, "unavailable");
  assert.equal(negative.system.display.status, "unavailable");
  assert.equal(negative.diagnostics.length, 4);
  const npmDiagnostic = negative.diagnostics.find((diagnostic) => diagnostic.source === "npm");
  const electronDiagnostic = negative.diagnostics.find((diagnostic) => diagnostic.source === "electron-process");
  assert.match(npmDiagnostic.message, /npm --version.*exitCode 7.*simulated npm failure/);
  assert.match(electronDiagnostic.message, /Electron version probe.*exitCode 9/);
  assert.doesNotThrow(() => JSON.parse(formatFingerprintJson(negative)), "失败路径的 JSON 仍应可解析");
  assert.match(formatFingerprintText(negative), /diagnostics\.count=4/);

  const nodeExecutable = process.env.npm_node_execpath
    || (process.platform === "win32" ? "node.exe" : "node");
  const commandFailure = await runCommand(nodeExecutable, [
    "-e",
    'process.stderr.write("expected fingerprint probe failure"); process.exit(7);',
  ], { timeoutMs: 5_000 });
  assert.equal(commandFailure.ok, false);
  assert.equal(commandFailure.exitCode, 7);
  assert.match(commandFailure.stderr, /expected fingerprint probe failure/);

  assert.deepEqual(parseCliOptions(["--format=json", "--strict"]), {
    format: "json",
    strict: true,
    help: false,
  });
  assert.throws(() => parseCliOptions(["--format=yaml"]), /requires either json or text/);
  assert.throws(() => parseCliOptions(["--json", "--text"]), /specified more than once/);

  const landingPage = await readFile(new URL("../../docs/index.html", import.meta.url), "utf8");
  assert.match(landingPage, /Node\.js ≥ 22\.13/);
  assert.doesNotMatch(landingPage, /Node\.js ≥ 20\.19/);

  console.log("[ok] env-fingerprint: 稳定 JSON/text、失败诊断、CLI 参数与 Node.js ≥22.13 文档断言通过");
}
