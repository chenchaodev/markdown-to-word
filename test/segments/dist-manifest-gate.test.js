// @ts-check
/**
 * dist 构建边界与清单门禁(位于 test/segments/ = 跨域守护段;被测为 scripts/ 下的
 * 构建/发布门禁脚本,纯 Node 逻辑不经 dist 编译产物):
 * - check-dist-manifest.mjs:clean dist 的规范化清单(相对路径 + size + SHA-256),
 *   以及三类漂移检测(stale 残留 / 缺失 / 内容被改写);CLI --dist/--output/--check/--print
 * - check-build-fresh.mjs:mtime 新鲜度判定(纯函数直测,不依赖真实仓库时间)
 * - copy-renderer.mjs:静态资源拷贝与陈旧残留清理(含清理后残留的空目录)
 *
 * 断言方式:临时目录里造正负夹具,断言脚本返回的退出码与失败原因
 * (只看退出码会让「因错误原因失败」的检查蒙混过关),并在最后用真实 dist
 * 走一遍「生成 → 校验」与进程级 CLI 退出码。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MANIFEST_SCHEMA,
  main as distManifestMain,
  parseManifest,
} from "../../scripts/check-dist-manifest.mjs";
import { evaluateFreshness, main as buildFreshMain } from "../../scripts/check-build-fresh.mjs";
import { copyRenderer } from "../../scripts/copy-renderer.mjs";
import { ROOT } from "../common/paths.js";

/**
 * 清单结构视图:被测的 scripts/check-dist-manifest.mjs 为无类型标注的 JS,
 * parseManifest 直接返回 JSON.parse 结果(推为 any),故测试侧显式声明所断言的形状。
 * @typedef {{ path: string; size: number; sha256: string }} ManifestEntry
 * @typedef {{ schema: string; fileCount: number; totalSize: number; files: ManifestEntry[] }} Manifest
 */

/**
 * 断言辅助。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`dist-manifest-gate 断言失败:${msg}`);
}

/**
 * 临时目录 + 兜底清理:测试对象是夹具,finally 保证不留残留(支持异步回调)。
 * @param {(dir: string) => unknown} fn 在临时目录上执行的夹具逻辑
 * @returns {Promise<unknown>} fn 的返回值(透传)
 */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-dist-gate-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 跑脚本 main():吞掉其 console 输出,返回 { code, output } 供失败原因断言。
 * @param {() => unknown} fn 被调用的脚本 main
 * @returns {Promise<{ code: unknown; output: string }>} 退出码与合并后的输出
 */
async function runChecker(fn) {
  /** @type {string[]} */
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

/**
 * 在目录下写入相对路径文件(自动建父目录)。
 * @param {string} dir 基准目录
 * @param {string} relative POSIX 风格相对路径
 * @param {string} content 文件内容
 * @returns {string} 落盘绝对路径
 */
function writeFileIn(dir, relative, content) {
  const target = path.join(dir, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

/**
 * 造一份形状与真实 dist 一致的最小 dist(main/renderer/core + 样式子目录)。
 * @param {string} dir 待填充的 dist 目录
 * @returns {Record<string, string>} 落盘的相对路径 → 内容映射
 */
function makeDist(dir) {
  /** @type {Record<string, string>} */
  const files = {
    "main/index.js": "export const main = 1;\n",
    "main/preload.cjs": '"use strict";\n',
    "core/convert.js": "export const convert = 1;\n",
    "renderer/index.html": "<!doctype html>\n",
    "renderer/style/base.css": "body { margin: 0 }\n",
  };
  for (const [relative, content] of Object.entries(files)) writeFileIn(dir, relative, content);
  return files;
}

/**
 * 与被测实现无关的清单计算:用于交叉验证脚本输出不是「自证」。
 * @param {string} distDir dist 根目录
 * @returns {ManifestEntry[]} 逐字段重算的清单条目
 */
function independentManifest(distDir) {
  const walk = (
    /** @type {string} */ base,
    /** @type {string} */ dir = base,
    /** @type {string[]} */ out = [],
  ) => {
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

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  await withTempDir(async (tmp) => {
    // ---------- 1. 正向:生成 → 校验,清单规范化且可被独立实现复现 ----------
    const distDir = path.join(tmp, "dist");
    const manifestPath = path.join(tmp, "dist-manifest.json");
    makeDist(distDir);

    const generated = await runChecker(() => distManifestMain(["--dist", distDir, "--output", manifestPath]));
    assert(generated.code === 0, `生成模式应通过,实际 ${generated.code}:${generated.output}`);

    const manifest = /** @type {Manifest} */ (parseManifest(fs.readFileSync(manifestPath, "utf8")));
    assert(manifest.schema === MANIFEST_SCHEMA, `schema 应为 ${MANIFEST_SCHEMA},实际 ${manifest.schema}`);
    assert(manifest.fileCount === 5, `fileCount 应为 5,实际 ${manifest.fileCount}`);
    assert(
      manifest.files.map((entry) => entry.path).join(",") ===
        "core/convert.js,main/index.js,main/preload.cjs,renderer/index.html,renderer/style/base.css",
      `清单路径应为 POSIX 相对路径且字典序,实际 ${manifest.files.map((e) => e.path).join(",")}`,
    );
    assert(
      manifest.files.every((entry) => Number.isInteger(entry.size) && /^[0-9a-f]{64}$/.test(entry.sha256)),
      "每条须含整数 size 与 64 位十六进制 sha256",
    );
    assert(
      JSON.stringify(manifest.files) === JSON.stringify(independentManifest(distDir)),
      "清单应与独立实现(测试侧现算)逐字段一致",
    );
    assert(
      manifest.totalSize === independentManifest(distDir).reduce((sum, entry) => sum + entry.size, 0),
      "totalSize 应为各文件字节数之和",
    );

    // 重复生成幂等:同一份 dist 逐字节产出同一清单(可 diff、可复现)
    const firstText = fs.readFileSync(manifestPath, "utf8");
    const regenerated = await runChecker(() => distManifestMain(["--dist", distDir, "--output", manifestPath]));
    assert(regenerated.code === 0, "重复生成应通过");
    assert(fs.readFileSync(manifestPath, "utf8") === firstText, "重复生成应逐字节一致");

    const checked = await runChecker(() =>
      distManifestMain(["--dist", distDir, "--output", manifestPath, "--check"]),
    );
    assert(checked.code === 0, `校验模式应通过,实际 ${checked.code}:${checked.output}`);
    console.log("[ok] dist-manifest-gate:生成/幂等/校验三态通过,清单与独立实现一致(5 个文件)");

    // ---------- 2. 负向:三类漂移 + 清单自身损坏 + 参数/输入异常 ----------
    /** @type {{ name: string; arrange: (target: string, manifestFile: string) => void; expect: RegExp }[]} */
    const negative = [
      {
        name: "stale 残留(clean build 后多出的旧文件)",
        arrange: (target) => writeFileIn(target, "core/legacy-render.js", "export const legacy = 1;\n"),
        expect: /陈旧\(stale\).*core\/legacy-render\.js/,
      },
      {
        name: "缺失(本次构建未产出的文件)",
        arrange: (target) => fs.rmSync(path.join(target, "core", "convert.js")),
        expect: /缺失.*core\/convert\.js/,
      },
      {
        // 同字节数、不同内容:mtime 与 size 都看不出,只有内容哈希能发现
        name: "篡改(字节数相同的内容改写)",
        arrange: (target) => writeFileIn(target, "core/convert.js", "export const convert = 2;\n"),
        expect: /内容与清单不一致.*core\/convert\.js/,
      },
      {
        name: "清单损坏(非 JSON)",
        arrange: (_target, manifestFile) => fs.writeFileSync(manifestFile, "{ not json", "utf8"),
        expect: /不是合法 JSON/,
      },
      {
        name: "清单 schema 不匹配",
        arrange: (_target, manifestFile) => writeFileSyncSchema(manifestFile),
        expect: /schema 不匹配/,
      },
      {
        name: "清单含上跳路径(可疑输入)",
        arrange: (_target, manifestFile) => writeFileSyncTraversal(manifestFile),
        expect: /含非法路径/,
      },
      {
        name: "dist 目录为空",
        arrange: (target) => {
          for (const sub of ["core", "main", "renderer"]) {
            fs.rmSync(path.join(target, sub), { recursive: true, force: true });
          }
        },
        expect: /dist 目录为空/,
      },
    ];

    for (const testCase of negative) {
      // 每条负向用例从「一致状态」重新造夹具,避免相互污染
      const caseTmp = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-dist-gate-case-"));
      try {
        const caseDist = path.join(caseTmp, "dist");
        const caseManifest = path.join(caseTmp, "dist-manifest.json");
        makeDist(caseDist);
        const seed = await runChecker(() => distManifestMain(["--dist", caseDist, "--output", caseManifest]));
        assert(seed.code === 0, "负向用例的基线生成应先通过");
        testCase.arrange(caseDist, caseManifest);
        const result = await runChecker(() =>
          distManifestMain(["--dist", caseDist, "--output", caseManifest, "--check"]),
        );
        assert(
          result.code === 1 && testCase.expect.test(result.output),
          `${testCase.name} 应以非零码且原因匹配 ${testCase.expect} 失败,实际 exit ${result.code}\n${result.output}`,
        );
      } finally {
        fs.rmSync(caseTmp, { recursive: true, force: true });
      }
    }
    console.log(`[ok] dist-manifest-gate:${negative.length} 条负向夹具全部被拦截(stale/缺失/篡改/坏清单/空 dist)`);

    // 校验模式缺清单、dist 目录不存在、参数写错:同样是可操作报错而非静默通过
    const missingManifest = await runChecker(() =>
      distManifestMain(["--dist", distDir, "--output", path.join(tmp, "nope.json"), "--check"]),
    );
    assert(missingManifest.code === 1 && /缺少清单/.test(missingManifest.output), `缺清单应失败,实际 ${missingManifest.code}`);
    const missingDist = await runChecker(() =>
      distManifestMain(["--dist", path.join(tmp, "no-such-dist"), "--output", path.join(tmp, "x.json")]),
    );
    assert(missingDist.code === 1 && /dist 目录不存在/.test(missingDist.output), `缺 dist 应失败,实际 ${missingDist.code}`);
    const badOption = await runChecker(() => distManifestMain(["--distt", distDir]));
    assert(badOption.code === 1 && /无法识别的选项/.test(badOption.output), `参数写错应失败,实际 ${badOption.code}`);
    console.log("[ok] dist-manifest-gate:缺清单/缺 dist/参数写错均非零退出且文案可操作");

    // ---------- 3. 真实 dist:清单可用 + 进程级 CLI 退出码 ----------
    const realDist = path.join(ROOT, "dist");
    assert(fs.existsSync(realDist), "真实 dist 应存在(验收链先于测试执行 build)");
    const realManifest = await runChecker(() => distManifestMain(["--dist", realDist, "--output", manifestPath]));
    assert(realManifest.code === 0, `真实 dist 应能生成清单,实际 ${realManifest.code}:${realManifest.output}`);
    const realParsed = /** @type {Manifest} */ (parseManifest(fs.readFileSync(manifestPath, "utf8")));
    assert(realParsed.fileCount > 100, `真实 dist 文件数应远大于夹具,实际 ${realParsed.fileCount}`);
    assert(
      realParsed.files.some((entry) => entry.path === "main/index.js") &&
        realParsed.files.some((entry) => entry.path === "renderer/index.html") &&
        realParsed.files.some((entry) => entry.path.startsWith("renderer/style/")),
      "真实清单应含主进程入口、renderer 入口与样式表",
    );
    fs.rmSync(manifestPath, { force: true });
    // 进程级退出码契约:Electron 宿主下用 ELECTRON_RUN_AS_NODE 走真实 CLI
    const cli = spawnSync(
      process.execPath,
      ["scripts/check-dist-manifest.mjs", "--dist", realDist, "--output", manifestPath],
      { cwd: ROOT, encoding: "utf8", windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
    );
    assert(cli.status === 0, `CLI 生成模式应 exit 0,实际 ${cli.status}:${cli.stdout}${cli.stderr}`);
    const cliCheck = spawnSync(
      process.execPath,
      ["scripts/check-dist-manifest.mjs", "--dist", realDist, "--output", manifestPath, "--check"],
      { cwd: ROOT, encoding: "utf8", windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
    );
    assert(cliCheck.status === 0, `CLI 校验模式应 exit 0,实际 ${cliCheck.status}:${cliCheck.stdout}${cliCheck.stderr}`);
    console.log(`[ok] dist-manifest-gate:真实 dist(${realParsed.fileCount} 个文件)清单可生成可校验,CLI 退出码 0`);
  });

  // ---------- 4. build-fresh:新鲜度判定(纯函数) ----------
  await withTempDir(async (tmp) => {
    const srcDir = path.join(tmp, "src");
    const distDir = path.join(tmp, "dist");
    writeFileIn(srcDir, "main/index.ts", "export const a = 1;\n");
    writeFileIn(distDir, "main/index.js", "export const a = 1;\n");
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(srcDir, "main", "index.ts"), older, older);
    fs.utimesSync(path.join(distDir, "main", "index.js"), newer, newer);
    assert(
      evaluateFreshness({ srcDir, distDir }).length === 0,
      "src 早于 dist 时应判定新鲜(mtime 比较按文件最大值递归)",
    );

    fs.utimesSync(path.join(srcDir, "main", "index.ts"), later, later);
    const stale = evaluateFreshness({ srcDir, distDir });
    assert(
      stale.length === 1 && /存在晚于 dist 的 src 改动/.test(/** @type {string} */ (stale[0])),
      `src 晚于 dist 应判过期,实际 ${stale[0]}`,
    );

    const absent = evaluateFreshness({ srcDir, distDir: path.join(tmp, "no-dist") });
    assert(
      absent.length === 1 && /dist 为空或不存在/.test(/** @type {string} */ (absent[0])),
      `dist 缺失应判过期,实际 ${absent[0]}`,
    );

    const missingSrc = await runChecker(() => buildFreshMain(["--src", path.join(tmp, "no-src")]));
    assert(missingSrc.code === 1 && /源码目录不存在/.test(missingSrc.output), "源码目录不存在应非零退出");
    console.log("[ok] dist-manifest-gate:build-fresh 新鲜/过期/dist 缺失/源码缺失四态判定正确");
  });

  // ---------- 5. copy-renderer:静态资源拷贝与陈旧清理(含空目录) ----------
  await withTempDir((tmp) => {
    const srcDir = path.join(tmp, "src-renderer");
    const outDir = path.join(tmp, "dist-renderer");
    // 源端:html + css(style 子目录) + 语言引导脚本;没有 about-preload.cjs
    writeFileIn(srcDir, "index.html", "<!doctype html>\n");
    writeFileIn(srcDir, "style/app.css", "body { color: #111 }\n");
    writeFileIn(srcDir, "lang-bootstrap.js", "// bootstrap\n");
    // 目标端预置:tsc 编译产物(须保留)、陈旧 css、陈旧 html(所在目录清理后为空)、
    // 源端已删的引导脚本副本
    writeFileIn(outDir, "state/pure.js", "export const pure = 1;\n");
    writeFileIn(outDir, "style/base.css", "body { color: #000 }\n");
    writeFileIn(outDir, "removed/index.html", "<!doctype html>\n");
    writeFileIn(outDir, "lang-bootstrap.js", "// stale\n");

    const report = copyRenderer({ srcDir, outDir });
    assert(!fs.existsSync(path.join(outDir, "style", "base.css")), "陈旧 css 应被清理");
    assert(
      fs.readFileSync(path.join(outDir, "lang-bootstrap.js"), "utf8") === "// bootstrap\n",
      "引导脚本应被最新内容覆盖",
    );
    assert(!fs.existsSync(path.join(outDir, "removed")), "清理后残留的空目录应被剪除");
    assert(fs.existsSync(path.join(outDir, "state", "pure.js")), "tsc 编译产物不在本脚本管辖范围,须保留");
    assert(fs.readFileSync(path.join(outDir, "index.html"), "utf8") === "<!doctype html>\n", "html 应被拷贝");
    assert(fs.readFileSync(path.join(outDir, "style", "app.css"), "utf8") === "body { color: #111 }\n", "css 应被拷贝并保持子目录结构");
    assert(report.prunedDirs.includes("removed"), `空目录应记入报告,实际 ${JSON.stringify(report.prunedDirs)}`);
    assert(report.removed.includes("style/base.css"), `陈旧文件应记入报告,实际 ${JSON.stringify(report.removed)}`);

    // 源端删掉引导脚本后重跑:目标端旧副本应被对称清掉
    fs.rmSync(path.join(srcDir, "lang-bootstrap.js"));
    copyRenderer({ srcDir, outDir });
    assert(!fs.existsSync(path.join(outDir, "lang-bootstrap.js")), "源端已删的引导脚本应同步清理");
    assert(fs.existsSync(path.join(outDir, "state", "pure.js")), "重跑仍不得误删编译产物");
    console.log("[ok] dist-manifest-gate:copy-renderer 拷贝正确、陈旧文件与空目录清理、编译产物不受影响");
  });
}

/**
 * 把清单的 schema 改成旧版本。
 * @param {string} manifestPath 清单文件路径
 * @returns {void}
 */
function writeFileSyncSchema(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.schema = "m2w/dist-manifest@0";
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * 往清单塞入上跳路径条目(可疑输入,须被拒绝而不是拿去查归档)。
 * @param {string} manifestPath 清单文件路径
 * @returns {void}
 */
function writeFileSyncTraversal(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.push({ path: "../../outside.js", size: 1, sha256: "0".repeat(64) });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
