/**
 * clean-artifacts 清理守卫段(位于 test/segments/ = 跨域守护段;被测为
 * scripts/clean-artifacts.mjs 的**进程级 CLI 语义**,纯 Node 子进程调用,不经 dist
 * 编译产物、不启 Electron、不触发 electron-builder):
 *
 * 覆盖(按风险从高到低):
 * 1. 合法路径:dist / release / all 的 --dry-run 预演(逐字节零删除、可重复)、真实
 *    删除、以及重复执行幂等(目标不存在时仍退出 0);
 * 2. dist 连带根目录 *.tsbuildinfo:只删名字匹配的普通文件(`.bak` 留存),非递归
 *    (保护区内的同名文件留存),release 目标不碰增量缓存;
 * 3. 参数面:缺 --target / --target 缺取值 / --target= 空值 / 越界 target
 *    (src、docs、node_modules、..、绝对路径)/ 未知参数与多余位置参数 —— 一律
 *    非零退出 + 附带用法,且零删除;
 * 4. 打包配置对账:build.files 未覆盖 dist/、build.directories.output 不是 release、
 *    build 缺失、package.json 不可读 —— 拒绝执行(对账先于任何删除,dist 与 release
 *    都不得被动过);
 * 5. 目标守卫可达性:生产常量把目标写死为 dist/release,故受保护目录/上跳段/绝对
 *    路径/空路径段/非目录/联接点这些删除级守卫在 CLI 上**无法被真实参数触达**。
 *    本段用「只改 TARGET_DIRS 一行」的沙盒夹具把目标重定向到恶意值来触达它们,
 *    并用「重定向到普通目录应真删」的正向锚点证明夹具本身是忠实通路(否则负向
 *    用例可能只是「脚本根本跑不起来」);改写后除该常量行外与生产脚本逐字节一致。
 * 6. 删除失败:占用目标目录(Windows CWD 占用)复现 EPERM,断言非零退出 + 可操作
 *    诊断(不带调用栈)、目标仍在、释放占用后重试成功。POSIX 允许删除他进程 CWD,
 *    故该用例仅在 win32 执行,平台未复现时显式记 skip。
 *
 * 沙箱纪律(硬约束):被测脚本的 PROJECT_ROOT 由脚本自身位置推导,所以一切执行都在
 * os.tmpdir() 下的临时沙盒里进行 —— 把生产脚本**原样复制**到沙盒的 scripts/ 后调用,
 * 沙盒外不存在任何可达的真实项目根。runClean() 只接受本段自建的沙盒路径,并在
 * 段首/段尾对真实 dist/、release/ 与根目录 *.tsbuildinfo 做快照比对,确保真实产物
 * 零改动(测试自身若误删真实产物会立即判红)。
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../common/paths.js";

const SCRIPT_SOURCE = fs.readFileSync(path.join(ROOT, "scripts", "clean-artifacts.mjs"), "utf8");
const SCRIPT_SHA256 = createHash("sha256").update(SCRIPT_SOURCE).digest("hex");
/** 清理目标常量行(删除目标的单一来源);守卫可达性夹具只改这一行 */
const TARGET_DIRS_RE = /const TARGET_DIRS = Object\.freeze\(\{[^}]*\}\);/;
const SANDBOX_PREFIX = "m2w-clean-gate-";
const USAGE_HINT = "用法: node scripts/clean-artifacts.mjs";
/** 沙盒 package.json:与脚本对账逻辑一致的最小合法形状 */
const SANDBOX_PACKAGE = {
  type: "module",
  build: { files: ["dist/**"], directories: { output: "release" } },
};
/** 本段自建沙盒白名单:runClean 的唯一合法执行域 */
const SANDBOXES = new Set();

function assert(cond, msg) {
  if (!cond) throw new Error(`clean-artifacts-gate 断言失败:${msg}`);
}

/** 解析 node 可执行文件:验收入口跑在 Electron 里(process.execPath 是 electron.exe) */
function resolveNode() {
  for (const candidate of [process.env.npm_node_execpath, process.execPath]) {
    if (candidate && /node(\.exe)?$/i.test(candidate)) return candidate;
  }
  return process.platform === "win32" ? "node.exe" : "node";
}

const NODE = resolveNode();

function writeFileIn(root, relative, content) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

/** 新建沙盒:复制生产脚本(逐字节)+ 合法 package.json,登记到白名单 */
function createSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), SANDBOX_PREFIX));
  SANDBOXES.add(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "clean-artifacts.mjs"), SCRIPT_SOURCE, "utf8");
  writePackageJson(root, SANDBOX_PACKAGE);
  return root;
}

function writePackageJson(root, value) {
  const target = path.join(root, "package.json");
  if (value === null) {
    fs.rmSync(target, { force: true });
    return;
  }
  const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(target, text, "utf8");
}

/**
 * 守卫可达性夹具:只把 TARGET_DIRS.dist 改写成 valueLiteral(其余字节不动)。
 * 只改 dist 一项是必须的 —— 改写 release 会先撞上打包配置对账(拿不到目标守卫),
 * 负向用例就会因「错误的原因失败」而蒙混过关。
 * 断言改写前后的差异只有那一行 —— 否则负向用例可能因夹具自身被改坏而假通过。
 */
function writeRedirectedScript(root, valueLiteral, fileName = "clean-artifacts.redirect.mjs") {
  const matched = SCRIPT_SOURCE.match(TARGET_DIRS_RE);
  assert(matched !== null, "未定位到 TARGET_DIRS 常量行(生产脚本已改动?本段需同步)");
  const [line] = matched;
  const replacement = `const TARGET_DIRS = Object.freeze({ dist: ${valueLiteral}, release: 'release' });`;
  const redirected = SCRIPT_SOURCE.replace(line, replacement);
  assert(redirected !== SCRIPT_SOURCE, "常量改写未生效");
  assert(redirected.replace(replacement, line) === SCRIPT_SOURCE, "除 TARGET_DIRS 行外脚本应逐字节不变");
  const target = path.join(root, "scripts", fileName);
  fs.writeFileSync(target, redirected, "utf8");
  // 夹具自身先过语法门:改写出错也会以退出码 1 结束,若不校验就会让「因错误原因失败」
  // 的负向用例蒙混过关(诊断文案不匹配也拦不住这种「假通过」以外的读解困难)。
  const checked = spawnSync(NODE, ["--check", target], { encoding: "utf8", timeout: 30_000 });
  assert(checked.status === 0, `改写后的夹具脚本语法非法(${fileName}):${checked.stderr}`);
  return fileName;
}

/** 沙盒夹具:dist 编译产物 + release 安装包 + 增量构建信息 + 受保护目录里的同名文件 */
function seedArtifacts(root) {
  writeFileIn(root, "dist/main/index.js", "export const main = 1;\n");
  writeFileIn(root, "dist/renderer/style/app.css", "body { margin: 0 }\n");
  writeFileIn(root, "dist/sub/deep/keep.txt", "deep\n");
  writeFileIn(root, "release/MarkdownToWord-Setup-3.12.0.exe", "stub\n");
  writeFileIn(root, "release/win-unpacked/resources/app.asar", "stub\n");
  writeFileIn(root, "src/main/index.ts", "export const main = 1;\n");
  writeFileIn(root, "docs/keep.md", "# keep\n");
  writeFileIn(root, "node_modules/left-pad/index.js", "module.exports = 1;\n");
  // 增量构建信息:名字匹配的会被 dist 连带删除,其余名字/位置必须留存
  writeFileIn(root, "tsconfig.tsbuildinfo", "{}\n");
  writeFileIn(root, "tsconfig.tsbuildinfo.bak", "{}\n");
  writeFileIn(root, "src/nested.tsbuildinfo", "{}\n");
}

/** 失败路径的固定断言面:退出码 1 + 命中诊断 + 输出已归一化(不回吐调用栈) */
function assertFailure(result, pattern, label, { usage = false } = {}) {
  assert(result.code === 1, `${label} 应以退出码 1 结束,实际 ${result.code};输出:${result.output}`);
  assert(pattern.test(result.output), `${label} 诊断未命中 ${pattern};输出:${result.output}`);
  if (usage) {
    assert(result.output.includes(USAGE_HINT), `${label} 应附带用法说明;输出:${result.output}`);
  }
  assert(!/\n\s+at\s/.test(result.output), `${label} 诊断应已归一化,不得回吐调用栈:${result.output}`);
}

/** 在沙盒里执行清理脚本(只接受白名单沙盒) */
function runClean(root, args, scriptName = "clean-artifacts.mjs") {
  assert(SANDBOXES.has(root), `只允许对本段自建的沙盒执行清理脚本,实际 ${root}`);
  const script = path.join(root, "scripts", scriptName);
  assert(fs.existsSync(script), `沙盒内缺少脚本副本:${script}`);
  const result = spawnSync(NODE, [script, ...args], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert(result.error === undefined, `子进程启动失败:${result.error?.message ?? "未知错误"}`);
  return { code: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** 沙盒内关键夹具是否原样留存(用于「零删除」断言) */
function fixtureIntact(root) {
  const kept = [
    "dist/main/index.js",
    "release/MarkdownToWord-Setup-3.12.0.exe",
    "tsconfig.tsbuildinfo",
    "src/main/index.ts",
    "docs/keep.md",
    "node_modules/left-pad/index.js",
  ];
  return kept.filter((relative) => !fs.existsSync(path.join(root, ...relative.split("/"))));
}

function assertFixtureIntact(root, label) {
  const missing = fixtureIntact(root);
  assert(missing.length === 0, `${label} 应零删除,但这些夹具消失了:${missing.join(",")}`);
}

/** 真实产物快照(段首/段尾比对,证明本段没碰真实 dist/release/增量缓存) */
function listTree(dir) {
  if (!fs.existsSync(dir)) return "<absent>";
  const rows = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else rows.push(`${path.relative(dir, abs).split(path.sep).join("/")}:${fs.statSync(abs).size}`);
    }
  };
  walk(dir);
  return rows.join("|");
}

function snapshotRealOutputs() {
  return JSON.stringify({
    dist: listTree(path.join(ROOT, "dist")),
    release: listTree(path.join(ROOT, "release")),
    buildInfo: fs
      .readdirSync(ROOT)
      .filter((name) => name.endsWith(".tsbuildinfo"))
      .sort()
      .join(","),
  });
}

/** 占住目标目录的子进程:Windows 下 CWD 被占用时递归删除必失败(EPERM) */
function holdDirectory(dir) {
  const child = spawn(NODE, ["-e", "setTimeout(() => {}, 15000)"], { cwd: dir, stdio: "ignore" });
  let released = false;
  return {
    ready: new Promise((resolve, reject) => {
      child.once("spawn", () => setTimeout(resolve, 500));
      child.once("error", reject);
    }),
    release() {
      if (released) return;
      released = true;
      child.kill();
    },
  };
}

export async function run() {
  const realBefore = snapshotRealOutputs();
  const sandboxes = [];
  const create = () => {
    const root = createSandbox();
    sandboxes.push(root);
    return root;
  };
  let failure = null;
  try {
    // ---------- 0. 沙箱纪律:脚本逐字节一致 + 真实产物零改动 ----------
    {
      const root = create();
      const copy = path.join(root, "scripts", "clean-artifacts.mjs");
      assert(
        createHash("sha256").update(fs.readFileSync(copy)).digest("hex") === SCRIPT_SHA256,
        "沙盒脚本副本应与生产脚本逐字节一致(否则测的不是被测实现)",
      );
      const matched = SCRIPT_SOURCE.match(TARGET_DIRS_RE);
      assert(matched !== null, "未定位到 TARGET_DIRS 常量行(生产脚本已改动?本段需同步)");
      assert(
        matched[0] === "const TARGET_DIRS = Object.freeze({ dist: 'dist', release: 'release' });",
        `清理目标应只写死 dist/release 两个生成目录,实际 ${matched[0]}`,
      );
      assert(/--target <dist\|release\|all>/.test(SCRIPT_SOURCE), "用法说明应声明只接受三个目标关键字");
    }

    // ---------- 1. 合法 dry-run:dist / release / all,零删除且幂等 ----------
    {
      const root = create();
      seedArtifacts(root);

      const distDry = runClean(root, ["--target", "dist", "--dry-run"]);
      assert(distDry.code === 0, `dist dry-run 应成功,实际 ${distDry.code}:${distDry.output}`);
      assert(distDry.output.includes("[dry-run] clean:dist 将递归删除:dist"), `dist dry-run 应预告递归删除;实际 ${distDry.output}`);
      assert(distDry.output.includes("[dry-run] clean:dist 将删除增量构建信息:tsconfig.tsbuildinfo"), `dist dry-run 应预告连带删增量缓存;实际 ${distDry.output}`);
      assert(!distDry.output.includes("tsconfig.tsbuildinfo.bak"), `非匹配名字的构建信息不该进入计划;实际 ${distDry.output}`);
      assert(!distDry.output.includes("src/nested.tsbuildinfo"), "增量缓存清理非递归,不该预告保护区内的同名文件");
      assertFixtureIntact(root, "dist dry-run");
      // 幂等:重复预演逐字节一致,且依然零删除
      const again = runClean(root, ["--target", "dist", "--dry-run"]);
      assert(again.output === distDry.output, `重复 dry-run 输出应稳定;实际 ${again.output}`);
      assertFixtureIntact(root, "重复 dist dry-run");

      const releaseDry = runClean(root, ["--target", "release", "--dry-run"]);
      assert(releaseDry.code === 0, `release dry-run 应成功,实际 ${releaseDry.code}:${releaseDry.output}`);
      assert(releaseDry.output.includes("[dry-run] clean:release 将递归删除:release"), `release dry-run 应预告递归删除;实际 ${releaseDry.output}`);
      assert(!/tsbuildinfo/.test(releaseDry.output), `release 目标不牵连 tsc 增量缓存;实际 ${releaseDry.output}`);
      assertFixtureIntact(root, "release dry-run");

      const allDry = runClean(root, ["--target", "all", "--dry-run"]);
      assert(allDry.code === 0, `all dry-run 应成功,实际 ${allDry.code}:${allDry.output}`);
      assert(allDry.output.includes("clean:dist 将递归删除:dist") && allDry.output.includes("clean:release 将递归删除:release"), `all dry-run 应同时预告两者;实际 ${allDry.output}`);
      assert(allDry.output.indexOf("clean:dist") < allDry.output.indexOf("clean:release"), "all 应先 dist 后 release");
      assertFixtureIntact(root, "all dry-run");
      console.log("[ok] clean-artifacts-gate:dist/release/all 预演零删除、输出可重复,增量缓存连带规则正确");
    }

    // ---------- 2. 真实删除 + 重复执行幂等 ----------
    {
      const root = create();
      seedArtifacts(root);

      const distClean = runClean(root, ["--target", "dist"]);
      assert(distClean.code === 0, `dist 清理应成功,实际 ${distClean.code}:${distClean.output}`);
      assert(!fs.existsSync(path.join(root, "dist")), "dist 应被递归删除");
      assert(distClean.output.includes("[ok] clean:dist 已删除:dist"), `应报告删除的相对路径;实际 ${distClean.output}`);
      assert(distClean.output.includes("[ok] clean:dist 已删除增量构建信息:tsconfig.tsbuildinfo"), "应连带删除根目录增量构建信息");
      assert(!fs.existsSync(path.join(root, "tsconfig.tsbuildinfo")), "tsconfig.tsbuildinfo 应被连带删除");
      assert(fs.existsSync(path.join(root, "tsconfig.tsbuildinfo.bak")), "非匹配名字的文件不得删除");
      assert(fs.existsSync(path.join(root, "src", "nested.tsbuildinfo")), "增量缓存清理非递归,保护区内的同名文件须留存");
      assert(fs.existsSync(path.join(root, "release", "MarkdownToWord-Setup-3.12.0.exe")), "--target dist 不得波及 release");
      assert(fs.existsSync(path.join(root, "src", "main", "index.ts")) && fs.existsSync(path.join(root, "docs", "keep.md")), "源码与文档不得被清理波及");

      const distAgain = runClean(root, ["--target", "dist"]);
      assert(distAgain.code === 0, `目标缺失时重复清理应仍成功,实际 ${distAgain.code}:${distAgain.output}`);
      assert(distAgain.output.includes("[ok] clean:dist 目标不存在"), `应报告无需清理;实际 ${distAgain.output}`);
      assert(fs.existsSync(path.join(root, "tsconfig.tsbuildinfo.bak")), "重复清理仍不得越界到非匹配文件");

      const releaseClean = runClean(root, ["--target", "release"]);
      assert(releaseClean.code === 0, `release 清理应成功,实际 ${releaseClean.code}:${releaseClean.output}`);
      assert(releaseClean.output.includes("[ok] clean:release 已删除:release"), `应报告删除的相对路径;实际 ${releaseClean.output}`);
      assert(!fs.existsSync(path.join(root, "release")), "release 应被递归删除");
      const releaseAgain = runClean(root, ["--target", "release"]);
      assert(releaseAgain.code === 0 && releaseAgain.output.includes("[ok] clean:release 目标不存在"), "release 重复清理应幂等");

      const allClean = runClean(root, ["--target", "all"]);
      assert(allClean.code === 0, `all 清理应成功,实际 ${allClean.code}:${allClean.output}`);
      assert(allClean.output.includes("clean:dist 目标不存在") && allClean.output.includes("clean:release 目标不存在"), `全空沙盒上 all 应双路幂等;实际 ${allClean.output}`);
      console.log("[ok] clean-artifacts-gate:真实删除、连带增量缓存、重复执行幂等(dist/release/all)");
    }

    // ---------- 3. 目标缺失(干净检出 / 只建了一半) ----------
    {
      const root = create();
      const allMissing = runClean(root, ["--target", "all"]);
      assert(allMissing.code === 0, `全新沙盒上 all 应成功,实际 ${allMissing.code}:${allMissing.output}`);
      assert(allMissing.output.includes("[ok] clean:dist 目标不存在,无需清理:dist"), `dist 缺失应幂等跳过;实际 ${allMissing.output}`);
      assert(allMissing.output.includes("[ok] clean:release 目标不存在,无需清理:release"), `release 缺失应幂等跳过;实际 ${allMissing.output}`);
      assert(!/tsbuildinfo/.test(allMissing.output), "无增量缓存时不应输出缓存相关行");

      writeFileIn(root, "release/app.exe", "stub\n");
      const onlyRelease = runClean(root, ["--target", "dist"]);
      assert(onlyRelease.code === 0 && onlyRelease.output.includes("[ok] clean:dist 目标不存在"), "只有 release 时 dist 目标应幂等跳过");
      assert(fs.existsSync(path.join(root, "release", "app.exe")), "跳过的目标不得影响另一个目标目录");
      console.log("[ok] clean-artifacts-gate:目标缺失幂等跳过(全新沙盒 / 只有 release)");
    }

    // ---------- 4. 参数面:缺目标 / 缺取值 / 越界 target / 未知参数,全部零删除 ----------
    {
      const root = create();
      seedArtifacts(root);
      const posixAbsolute = "/etc";
      const windowsAbsolute = path.join(`${root}-outside`, "keep");
      const cases = [
        { label: "缺 --target", args: [], pattern: /缺少 --target\(只接受 dist\/release\/all\),不做任何删除/, usage: true },
        { label: "--target 缺取值", args: ["--target"], pattern: /--target 缺少取值/, usage: true },
        { label: "--target= 空值", args: ["--target="], pattern: /缺少 --target/, usage: true },
        { label: "只给 --dry-run", args: ["--dry-run"], pattern: /缺少 --target/, usage: true },
        { label: "target=src(源码)", args: ["--target", "src"], pattern: /只接受 dist\/release\/all,实际 src\(不做任何删除\)/ },
        { label: "target=docs(文档)", args: ["--target", "docs"], pattern: /只接受 dist\/release\/all,实际 docs\(不做任何删除\)/ },
        { label: "target=test", args: ["--target", "test"], pattern: /只接受 dist\/release\/all,实际 test/ },
        { label: "target=node_modules", args: ["--target", "node_modules"], pattern: /只接受 dist\/release\/all,实际 node_modules/ },
        { label: "target=..(上跳)", args: ["--target", ".."], pattern: /只接受 dist\/release\/all,实际 \.\./ },
        { label: "target=../dist", args: ["--target", "../dist"], pattern: /只接受 dist\/release\/all,实际 \.\.\/dist/ },
        { label: "target=POSIX 绝对路径", args: ["--target", posixAbsolute], pattern: /只接受 dist\/release\/all,实际 \/etc/ },
        { label: "target=Windows 绝对路径", args: ["--target", windowsAbsolute], pattern: /只接受 dist\/release\/all,实际 [A-Za-z]:/ },
        { label: "未知长选项", args: ["--target", "dist", "--force"], pattern: /无法识别的参数:--force/, usage: true },
        { label: "未知短选项", args: ["-x"], pattern: /无法识别的参数:-x/, usage: true },
        { label: "多余位置参数", args: ["--target", "dist", "leftover"], pattern: /无法识别的参数:leftover/, usage: true },
      ];
      for (const item of cases) {
        const result = runClean(root, item.args);
        assertFailure(result, item.pattern, item.label, { usage: item.usage === true });
        assertFixtureIntact(root, item.label);
        assert(fs.existsSync(path.join(root, "tsconfig.tsbuildinfo")), `${item.label} 不得连带删除增量缓存`);
      }
      const help = runClean(root, ["--help"]);
      assert(help.code === 0 && help.output.includes(USAGE_HINT), `--help 应打印用法并零退出,实际 ${help.code}:${help.output}`);
      assertFixtureIntact(root, "--help");
      console.log(`[ok] clean-artifacts-gate:${cases.length} 个参数面负例全部非零退出 + 零删除,--help 零退出`);
    }

    // ---------- 5. 打包配置对账:不一致即拒绝,且先于任何删除 ----------
    {
      const cases = [
        { label: "build.files 未覆盖 dist", pkg: { build: { files: ["out/**"], directories: { output: "release" } } }, pattern: /build\.files 未覆盖 dist\//, args: ["--target", "all"] },
        { label: "build.files 只同名不同目录", pkg: { build: { files: ["dist-main.js"], directories: { output: "release" } } }, pattern: /build\.files 未覆盖 dist\//, args: ["--target", "dist"] },
        { label: "build.files 非数组", pkg: { build: { files: "dist/**", directories: { output: "release" } } }, pattern: /build\.files 未覆盖 dist\//, args: ["--target", "dist"] },
        { label: "无 build 段", pkg: { type: "module" }, pattern: /build\.files 未覆盖 dist\//, args: ["--target", "dist"] },
        { label: "输出目录已迁移", pkg: { build: { files: ["dist/**"], directories: { output: "out" } } }, pattern: /directories\.output\(out\)与清理目标 release 不一致/, args: ["--target", "release"] },
        { label: "输出目录缺失", pkg: { build: { files: ["dist/**"] } }, pattern: /directories\.output\(undefined\)与清理目标 release 不一致/, args: ["--target", "all"] },
        { label: "package.json 非法 JSON", pkg: "{ not json", pattern: /package\.json 不可读/, args: ["--target", "all"] },
        { label: "package.json 缺失", pkg: null, pattern: /package\.json 不可读/, args: ["--target", "all"] },
      ];
      for (const item of cases) {
        const root = create();
        seedArtifacts(root);
        writePackageJson(root, item.pkg);
        const result = runClean(root, item.args);
        assertFailure(result, item.pattern, item.label);
        assertFixtureIntact(root, item.label);
      }
      console.log(`[ok] clean-artifacts-gate:${cases.length} 类打包配置不一致均拒绝执行且零删除`);
    }

    // ---------- 6. 删除级守卫可达性(只改 TARGET_DIRS 一行的沙盒夹具) ----------
    {
      // 正向锚点:夹具通路本身是忠实的 —— 重定向到普通目录会真删(否则负向用例无意义)
      const anchor = create();
      seedArtifacts(anchor);
      writeFileIn(anchor, "build-out/keep.txt", "x\n");
      writeRedirectedScript(anchor, "'build-out'");
      const anchored = runClean(anchor, ["--target", "dist"], "clean-artifacts.redirect.mjs");
      assert(anchored.code === 0, `重定向到普通目录应可正常删除,实际 ${anchored.code}:${anchored.output}`);
      assert(!fs.existsSync(path.join(anchor, "build-out")), "重定向到普通目录时应真删(夹具通路有效)");
      assert(anchored.output.includes("[ok] clean:dist 已删除:build-out"), `应报告被删的相对路径;实际 ${anchored.output}`);

      // value: 以沙盒根与项目外的兄弟目录为参数,产出写进常量行的字符串字面量
      const cases = [
        { label: "目标=src(受保护)", value: () => "'src'", expect: /受保护目录\(源码\/测试\/文档\/依赖\),拒绝删除/, sentinels: ["src/main/index.ts", "src/nested.tsbuildinfo"] },
        { label: "目标=docs(受保护)", value: () => "'docs'", expect: /受保护目录/, sentinels: ["docs/keep.md"] },
        { label: "目标=node_modules(受保护)", value: () => "'node_modules'", expect: /受保护目录/, sentinels: ["node_modules/left-pad/index.js"] },
        { label: "目标=src/dist(中途命中保护区)", value: () => "'src/dist'", expect: /受保护目录/, sentinels: ["src/main/index.ts"] },
        { label: "目标含上跳段(..)", value: (_root, outside) => `'../${path.basename(outside)}'`, expect: /含上跳段\(\.\.\),拒绝/, sentinels: [] },
        { label: "目标=Windows 绝对路径", value: (_root, outside) => JSON.stringify(path.join(outside, "keep")), expect: /必须是相对路径,拒绝/, sentinels: [] },
        { label: "目标=POSIX 绝对路径", value: () => "'/etc'", expect: /必须是相对路径,拒绝/, sentinels: [] },
        { label: "目标含空路径段(./)", value: () => "'./dist'", expect: /含空路径段/, sentinels: ["dist/main/index.js"] },
        { label: "目标含空路径段(//)", value: () => "'a//dist'", expect: /含空路径段/, sentinels: [] },
      ];
      for (const item of cases) {
        const root = create();
        seedArtifacts(root);
        const outside = `${root}-outside`;
        writeFileIn(outside, "keep.txt", "sentinel\n");
        sandboxes.push(outside);
        writeRedirectedScript(root, item.value(root, outside));
        const result = runClean(root, ["--target", "dist"], "clean-artifacts.redirect.mjs");
        assertFailure(result, item.expect, item.label);
        assert(fs.existsSync(path.join(outside, "keep.txt")), `${item.label} 不得删到项目根之外`);
        for (const sentinel of item.sentinels) {
          assert(fs.existsSync(path.join(root, ...sentinel.split("/"))), `${item.label} 不得删到 ${sentinel}`);
        }
        assertFixtureIntact(root, item.label);
      }

      // 目标不是目录
      {
        const root = create();
        seedArtifacts(root);
        writeFileIn(root, "notadir", "i am a file\n");
        writeRedirectedScript(root, "'notadir'");
        const result = runClean(root, ["--target", "dist"], "clean-artifacts.redirect.mjs");
        assertFailure(result, /目标不是目录,拒绝删除/, "目标不是目录");
        assert(fs.readFileSync(path.join(root, "notadir"), "utf8") === "i am a file\n", "非目录目标不得被删");
      }

      // 目标是联接点(目录 junction;lstat 报符号链接 → 走拒绝分支,项目外目录不受影响)
      {
        const root = create();
        seedArtifacts(root);
        const outside = `${root}-outside`;
        writeFileIn(outside, "keep.txt", "sentinel\n");
        sandboxes.push(outside);
        let junction = true;
        try {
          fs.symlinkSync(outside, path.join(root, "link-dist"), "junction");
        } catch (error) {
          junction = false;
          console.log(`[skip] 联接点夹具创建失败(${error.code ?? "unknown"}),符号链接守卫未覆盖`);
        }
        if (junction) {
          writeRedirectedScript(root, "'link-dist'");
          const result = runClean(root, ["--target", "dist"], "clean-artifacts.redirect.mjs");
          // Windows 上 lstat(junction).isSymbolicLink() 为真,故命中符号链接分支;
          // 若某平台改为先命中 realpath 越界分支,两条都是拒绝语义,故接受二者之一。
          assertFailure(result, /符号链接\/联接点,拒绝递归删除|realpath 越出项目根,拒绝删除/, "目标是联接点");
          assert(fs.existsSync(path.join(outside, "keep.txt")), "联接点目标不得波及项目外真实目录");
          assertFixtureIntact(root, "目标是联接点");
        }
      }
      console.log("[ok] clean-artifacts-gate:保护区/上跳段/绝对路径/空段/非目录/联接点守卫均拒绝(夹具通路已由正向锚点验证)");
    }

    // ---------- 7. 删除失败:非零退出 + 可操作诊断 + 释放后重试成功 ----------
    {
      const root = create();
      seedArtifacts(root);
      const holder = holdDirectory(path.join(root, "dist"));
      let reproduced = false;
      try {
        await holder.ready;
        if (process.platform === "win32") {
          const result = runClean(root, ["--target", "dist"]);
          if (result.code === 0) {
            console.log("[skip] 本机未复现占用导致的删除失败(平台允许删除他进程 CWD),失败诊断未覆盖");
          } else {
            assertFailure(result, /删除 dist 失败\(EPERM/, "占用导致的删除失败");
            assert(/Windows 上多为文件占用/.test(result.output), `应给出 Windows 占用提示;实际 ${result.output}`);
            assert(/退出正在运行的 MarkdownToWord/.test(result.output), `提示应可操作(点名退进程);实际 ${result.output}`);
            assert(fs.existsSync(path.join(root, "dist")), "删除失败后目标必须仍在");
            assert(fs.existsSync(path.join(root, "tsconfig.tsbuildinfo")), "删除失败不得连带删增量缓存(先失败即中止)");
            assert(fs.existsSync(path.join(root, "release")), "删除失败不得波及 release");
            reproduced = true;
          }
        } else {
          console.log("[skip] 非 win32 平台无法用 CWD 占用复现删除失败,失败诊断未覆盖");
        }
      } finally {
        holder.release();
      }
      if (reproduced) {
        const retry = runClean(root, ["--target", "dist"]);
        assert(retry.code === 0, `释放占用后重试应成功,实际 ${retry.code}:${retry.output}`);
        assert(!fs.existsSync(path.join(root, "dist")), "重试成功后 dist 应被删除");
      }
      console.log("[ok] clean-artifacts-gate:删除失败路径(占用夹具)退出码与诊断符合预期,释放后可重试");
    }

    // ---------- 8. 生产配置契约(只读):真实 package.json 与 clean 链 ----------
    {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
      const files = Array.isArray(pkg.build?.files) ? pkg.build.files : [];
      assert(
        files.some((pattern) => pattern === "dist/**" || (typeof pattern === "string" && pattern.startsWith("dist/"))),
        `真实 package.json build.files 应覆盖 dist/(实际 ${JSON.stringify(files)}),否则清理守卫会拒绝执行`,
      );
      assert(pkg.build?.directories?.output === "release", `真实输出目录应为 release,实际 ${String(pkg.build?.directories?.output)}`);
      assert(pkg.scripts["clean:dist"] === "node scripts/clean-artifacts.mjs --target dist", `clean:dist 应走守卫脚本,实际 ${pkg.scripts["clean:dist"]}`);
      assert(pkg.scripts["clean:release"] === "node scripts/clean-artifacts.mjs --target release", `clean:release 应走守卫脚本,实际 ${pkg.scripts["clean:release"]}`);
      const distChain = pkg.scripts.dist;
      assert(/npm run clean:dist && npm run clean:release && npm run build/.test(distChain), `dist 链应先清理后构建,实际 ${distChain}`);
      console.log("[ok] clean-artifacts-gate:真实打包配置与 clean 链顺序(清理先于 build)符合契约");
    }
  } catch (error) {
    failure = error;
  } finally {
    // maxRetries/retryDelay 吸收 Windows 上短暂的 EBUSY(占用夹具的子进程刚被 kill 时);
    // 清理失败必须显式暴露,不能静默留在系统临时目录
    for (const root of sandboxes) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
    // 安全网:本段绝不允许改动真实产物(段首/段尾快照必须逐字节一致)
    try {
      assert(snapshotRealOutputs() === realBefore, "真实 dist/release/*.tsbuildinfo 被本段改动(清理脚本只应在沙盒内执行)");
    } catch (error) {
      failure = failure === null ? error : new Error(`${failure.message}\n[附加]${error.message}`);
    }
  }
  if (failure !== null) throw failure;
}
