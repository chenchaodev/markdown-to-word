#!/usr/bin/env node

/**
 * 输出确定性的运行环境指纹，供本地排障、CI 与 Release 日志复用。
 * JSON schemaVersion 固定为 1；探针失败保留 null/unavailable 并写入 diagnostics。
 * 文本为固定顺序的 key=value；无时间戳、主机名或绝对路径。--strict 使诊断返回非零码。
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_TIMEOUT_MS = 15_000;
const ELECTRON_MARKER = "__M2W_ENV_FINGERPRINT__";
const FONT_EXTENSIONS = new Set([".fon", ".otc", ".otf", ".pfb", ".ttc", ".ttf", ".woff", ".woff2"]);
const FONT_PATTERNS = Object.freeze({
  microsoftYaHei: /(?:^|[/_-])msyh(?:bd|lt)?\./i,
  notoSansCJK: /notosans(?:cjk|sc)[^/]*\./i,
  segoeUI: /segoeui[^/]*\./i,
  simSun: /(?:simsun|nsimsun|simfang)[^/]*\./i,
});
const PROBE_STATUSES = new Set(["ok", "partial", "unavailable"]);

function errorMessage(error) {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
}

function truncate(value, maxLength = 2_000) {
  const text = String(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function result(status, value, source, error = null) {
  if (!PROBE_STATUSES.has(status)) throw new TypeError(`Invalid probe status: ${status}`);
  return { status, value, source, error };
}

function unavailable(source, error) {
  return result("unavailable", null, source, errorMessage(error));
}

/** 捕获短命令失败；不会把子进程 stderr 混入指纹 stdout。 */
export function runCommand(command, args = [], options = {}) {
  const { env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const finish = (exitCode, signal, spawnError = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !timedOut && spawnError === null,
        exitCode,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
        timeoutMs,
        spawnError,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish(null, null, `Command timed out after ${timeoutMs} ms`);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => finish(null, null, errorMessage(error)));
    child.once("close", (exitCode, signal) => finish(exitCode, signal));
  });
}

function commandFailure(label, commandResult) {
  if (commandResult.timedOut) {
    return `Command "${label}" timed out after ${commandResult.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`;
  }
  if (commandResult.spawnError) return `Command "${label}" could not start: ${commandResult.spawnError}`;
  const detail = truncate(commandResult.stderr || commandResult.stdout || "no diagnostic output");
  return `Command "${label}" failed (exitCode ${commandResult.exitCode}, signal ${commandResult.signal ?? "none"}): ${detail}`;
}

async function readNpmVersion(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    runCommand: run = runCommand,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const source = "npm --version";
  const command = platform === "win32" ? env.ComSpec || "cmd.exe" : "npm";
  const args = platform === "win32" ? ["/d", "/s", "/c", "npm.cmd --version"] : ["--version"];
  const commandResult = await run(command, args, { env, timeoutMs });
  if (!commandResult.ok) return unavailable(source, commandFailure(source, commandResult));
  const match = commandResult.stdout.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
  if (!match) {
    return unavailable(source, `Command "${source}" succeeded but returned no recognizable version: ${commandResult.stdout || "<empty>"}`);
  }
  return result("ok", match[1], source);
}

async function loadElectronMetadata(projectRoot = PROJECT_ROOT) {
  const packageDir = path.join(projectRoot, "node_modules", "electron");
  const source = "node_modules/electron/package.json + path.txt";
  const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  if (manifest.name !== "electron" || typeof manifest.version !== "string") {
    throw new Error(`${source} is not a readable Electron package manifest`);
  }
  const relativeExecutable = (await readFile(path.join(packageDir, "path.txt"), "utf8")).trim();
  if (!relativeExecutable) throw new Error(`${source} points to an empty Electron executable path`);
  return result("ok", {
    executable: path.join(packageDir, "dist", relativeExecutable),
    version: manifest.version,
  }, source);
}

async function readElectronProcessVersions(executable, options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    runCommand: run = runCommand,
    tempRoot = os.tmpdir(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const source = "Electron process.versions";
  const tempDir = await mkdtemp(path.join(tempRoot, "m2w-env-fingerprint-"));
  const probePath = path.join(tempDir, "probe.cjs");
  try {
    await writeFile(probePath, [
      `const marker = ${JSON.stringify(ELECTRON_MARKER)};`,
      "const versions = { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node };",
      "process.stdout.write(marker + JSON.stringify(versions), () => process.exit(0));",
    ].join("\n"), "utf8");
    const args = platform === "linux"
      ? ["--no-sandbox", "--ozone-platform=headless", probePath]
      : [probePath];
    const electronEnv = { ...env, ELECTRON_ENABLE_LOGGING: "0" };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    const commandResult = await run(executable, args, { env: electronEnv, timeoutMs });
    if (!commandResult.ok) {
      return unavailable(source, commandFailure(`Electron version probe (${executable})`, commandResult));
    }
    const markerIndex = commandResult.stdout.indexOf(ELECTRON_MARKER);
    if (markerIndex < 0) return unavailable(source, "Electron probe succeeded but emitted no version marker");
    const versions = JSON.parse(commandResult.stdout.slice(markerIndex + ELECTRON_MARKER.length).trim());
    if (!Object.values(versions).every((value) => typeof value === "string")) {
      throw new Error("Electron version probe returned an incomplete version set");
    }
    return result("ok", versions, source);
  } catch (error) {
    return unavailable(source, error);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {
      // 清理失败不覆盖已采集的探针结果。
    });
  }
}

function fontRootCandidates(platform, env, homeDirectory) {
  if (platform === "win32") {
    const windowsDirectory = env.WINDIR || env.SystemRoot || "C:\\Windows";
    return [
      { label: "windows", directory: path.join(windowsDirectory, "Fonts") },
      ...(env.LOCALAPPDATA ? [{ label: "user", directory: path.join(env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts") }] : []),
    ];
  }
  if (platform === "darwin") {
    return [
      { label: "system", directory: "/System/Library/Fonts" },
      { label: "library", directory: "/Library/Fonts" },
      ...(homeDirectory ? [{ label: "user", directory: path.join(homeDirectory, "Library", "Fonts") }] : []),
    ];
  }
  return [
    { label: "usr-share", directory: "/usr/share/fonts" },
    { label: "usr-local-share", directory: "/usr/local/share/fonts" },
    ...(homeDirectory ? [{ label: "user", directory: path.join(homeDirectory, ".local", "share", "fonts") }] : []),
  ];
}

async function collectFontFileKeys(root, current = root, keys = []) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFontFileKeys(root, fullPath, keys);
    } else if (entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      keys.push(path.relative(root, fullPath).split(path.sep).join("/").toLowerCase());
    }
  }
  return keys;
}

function commonFontAvailability(fileKeys) {
  return Object.fromEntries(Object.entries(FONT_PATTERNS).map(([name, pattern]) => [
    name,
    fileKeys.some((fileKey) => pattern.test(fileKey)),
  ]));
}

async function readFontInfo(options = {}) {
  const { env = process.env, homeDirectory = os.homedir(), platform = process.platform } = options;
  const source = "installed font files";
  const seenDirectories = new Set();
  const fileKeys = [];
  const failedLabels = [];
  let readableDirectoryCount = 0;
  for (const candidate of fontRootCandidates(platform, env, homeDirectory)) {
    const directory = path.resolve(candidate.directory);
    if (seenDirectories.has(directory)) continue;
    seenDirectories.add(directory);
    try {
      const keys = await collectFontFileKeys(directory);
      fileKeys.push(...keys.map((key) => `${candidate.label}/${key}`));
      readableDirectoryCount += 1;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN";
      if (code !== "ENOENT" && code !== "ENOTDIR") failedLabels.push(`${candidate.label}:${code}`);
    }
  }
  fileKeys.sort();
  const commonFamilies = commonFontAvailability(fileKeys);
  const value = {
    fileCount: fileKeys.length,
    sha256: readableDirectoryCount > 0
      ? createHash("sha256").update(fileKeys.join("\n")).digest("hex")
      : null,
    commonFamilies,
    readableDirectoryCount,
    reason: failedLabels.length > 0 ? failedLabels.join(", ") : null,
  };
  if (readableDirectoryCount === 0) {
    return result("unavailable", value, source, `No font directory is readable (${failedLabels.join(", ") || "all candidates absent"})`);
  }
  return failedLabels.length > 0
    ? result("partial", value, source, `Some font directories could not be read: ${failedLabels.join(", ")}`)
    : result("ok", value, source);
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function readDisplayDpi(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    runCommand: run = runCommand,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  if (platform === "win32") {
    const source = "Windows AppliedDPI registry value";
    const windowsDirectory = env.SystemRoot || env.WINDIR || "C:\\Windows";
    const powershell = path.join(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const query = "$ErrorActionPreference='Stop'; [Console]::Out.Write((Get-ItemPropertyValue -LiteralPath 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name 'AppliedDPI'))";
    const commandResult = await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", query], { env, timeoutMs });
    if (!commandResult.ok) return unavailable(source, commandFailure(source, commandResult));
    const logicalDpi = Number.parseInt(commandResult.stdout, 10);
    if (!Number.isFinite(logicalDpi) || logicalDpi <= 0) {
      return unavailable(source, `${source} returned an invalid value: ${commandResult.stdout || "<empty>"}`);
    }
    return result("ok", { logicalDpi, scalePercent: Math.round((logicalDpi / 96) * 100), reason: null }, source);
  }
  const scales = [env.GDK_SCALE, env.GDK_DPI_SCALE].map(positiveNumber).filter((value) => value !== null);
  if (scales.length > 0) {
    const scale = scales.reduce((product, value) => product * value, 1);
    const value = { logicalDpi: Math.round(96 * scale), scalePercent: Math.round(scale * 100), reason: null };
    return result("ok", value, "GDK_SCALE/GDK_DPI_SCALE");
  }
  const source = platform === "darwin" ? "macOS display session" : "GDK_SCALE/GDK_DPI_SCALE";
  const value = { logicalDpi: null, scalePercent: null, reason: "DPI is display-session dependent and no scale environment value is available" };
  return result("unavailable", value, source, `No non-interactive DPI probe is available for platform ${platform}`);
}

function readSystemInfo(platform = process.platform) {
  return {
    os: { platform, type: os.type(), release: os.release(), version: os.version() },
    architecture: { processArch: process.arch, machineArch: os.machine(), endianness: os.endianness() },
  };
}

async function captureProbe(source, probe, diagnostics) {
  try {
    const probeValue = await probe();
    if (!probeValue || !PROBE_STATUSES.has(probeValue.status)) throw new TypeError(`${source} probe returned an invalid result`);
    if (probeValue.status !== "ok") {
      diagnostics.push({ source, message: probeValue.error || `${source} probe returned ${probeValue.status}` });
    }
    return probeValue;
  } catch (error) {
    const message = errorMessage(error);
    diagnostics.push({ source, message });
    return unavailable(source, message);
  }
}

export async function collectEnvironmentFingerprint(options = {}) {
  const diagnostics = [];
  const {
    systemInfo = readSystemInfo(options.platform),
    probeNpm = () => readNpmVersion(options),
    loadElectronPackage = () => loadElectronMetadata(options.projectRoot),
    probeElectron = (executable) => readElectronProcessVersions(executable, options),
    collectFonts = () => readFontInfo(options),
    collectDisplayDpi = () => readDisplayDpi(options),
  } = options;
  const [npmValue, electronPackage, fonts, display] = await Promise.all([
    captureProbe("npm", probeNpm, diagnostics),
    captureProbe("electron-package", loadElectronPackage, diagnostics),
    captureProbe("fonts", collectFonts, diagnostics),
    captureProbe("display-dpi", collectDisplayDpi, diagnostics),
  ]);
  let electronProcess = electronPackage.status === "ok"
    ? await captureProbe("electron-process", () => probeElectron(electronPackage.value.executable), diagnostics)
    : unavailable("Electron process.versions", electronPackage.error);
  if (electronProcess.status === "ok" && electronProcess.value.electron !== electronPackage.value?.version) {
    diagnostics.push({
      source: "electron-version",
      message: `Electron package version ${electronPackage.value.version} does not match binary version ${electronProcess.value.electron}`,
    });
  }
  const processVersion = (key, source) => electronProcess.status === "ok"
    ? result("ok", electronProcess.value[key], source)
    : unavailable(source, electronProcess.error);
  const electron = electronProcess.status === "ok"
    ? processVersion("electron", "Electron process.versions.electron")
    : electronPackage.status === "ok"
      ? result("ok", electronPackage.value.version, electronPackage.source)
      : unavailable("node_modules/electron/package.json", electronPackage.error);
  return {
    schemaVersion: 1,
    versions: {
      node: result("ok", process.versions.node, "process.versions.node"),
      npm: npmValue,
      electron,
      chromium: processVersion("chromium", "Electron process.versions.chrome"),
      electronNode: processVersion("node", "Electron process.versions.node"),
    },
    system: { ...systemInfo, fonts, display },
    diagnostics,
  };
}

function formatValue(value) {
  return value === null ? "null" : JSON.stringify(value);
}

export function formatFingerprintJson(fingerprint) {
  return `${JSON.stringify(fingerprint, null, 2)}\n`;
}

export function formatFingerprintText(fingerprint) {
  const lines = [`schemaVersion=${fingerprint.schemaVersion}`];
  for (const [name, value] of Object.entries(fingerprint.versions)) {
    lines.push(`versions.${name}.status=${value.status}`, `versions.${name}.value=${formatValue(value.value)}`);
  }
  for (const [group, values] of Object.entries(fingerprint.system)) {
    if (group === "fonts") {
      const fonts = values.value ?? {};
      lines.push(
        `system.fonts.status=${values.status}`,
        `system.fonts.value.fileCount=${formatValue(fonts.fileCount ?? null)}`,
        `system.fonts.value.sha256=${formatValue(fonts.sha256 ?? null)}`,
        `system.fonts.value.readableDirectoryCount=${formatValue(fonts.readableDirectoryCount ?? null)}`,
      );
      for (const [family, available] of Object.entries(fonts.commonFamilies ?? {})) {
        lines.push(`system.fonts.value.commonFamilies.${family}=${available}`);
      }
    } else if (group === "display") {
      const display = values.value ?? {};
      lines.push(
        `system.display.status=${values.status}`,
        `system.display.value.logicalDpi=${formatValue(display.logicalDpi ?? null)}`,
        `system.display.value.scalePercent=${formatValue(display.scalePercent ?? null)}`,
      );
    } else {
      for (const [name, value] of Object.entries(values)) lines.push(`system.${group}.${name}=${formatValue(value)}`);
    }
  }
  lines.push(`diagnostics.count=${fingerprint.diagnostics.length}`);
  fingerprint.diagnostics.forEach((value, index) => { lines.push(`diagnostics.${index}=${formatValue(value)}`); });
  return `${lines.join("\n")}\n`;
}

export function parseCliOptions(args) {
  let format = "text";
  let formatWasSet = false;
  let strict = false;
  let help = false;
  const setFormat = (value) => {
    if (formatWasSet) throw new Error("Output format was specified more than once");
    format = value;
    formatWasSet = true;
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--strict") strict = true;
    else if (argument === "--json") setFormat("json");
    else if (argument === "--text") setFormat("text");
    else if (argument === "--format") {
      const value = args[index + 1];
      if (value !== "json" && value !== "text") throw new Error("--format requires either json or text");
      setFormat(value);
      index += 1;
    } else if (argument.startsWith("--format=")) {
      const value = argument.slice("--format=".length);
      if (value !== "json" && value !== "text") throw new Error("--format requires either json or text");
      setFormat(value);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return { format, strict, help };
}

const HELP_TEXT = `Usage: node scripts/print-env-fingerprint.mjs [options]

Options:
  --format json|text  Output format (default: text)
  --json              Alias for --format json
  --text              Alias for --format text
  --strict            Exit 1 when diagnostics are present
  -h, --help          Show this help
`;

export async function runCli(args, streams = {}) {
  const { stderr = process.stderr, stdout = process.stdout } = streams;
  try {
    const options = parseCliOptions(args);
    if (options.help) {
      stdout.write(HELP_TEXT);
      return 0;
    }
    const fingerprint = await collectEnvironmentFingerprint();
    stdout.write(options.format === "json" ? formatFingerprintJson(fingerprint) : formatFingerprintText(fingerprint));
    if (options.strict && fingerprint.diagnostics.length > 0) {
      stderr.write(`Environment fingerprint is incomplete: ${fingerprint.diagnostics.length} diagnostic(s).\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    stderr.write(`[print-env-fingerprint] ${errorMessage(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
