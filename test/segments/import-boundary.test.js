// @ts-check
/**
 * 依赖声明与 import 层向边界守护段(位于 test/segments/ = 跨域守护段;被测为
 * scripts/check-import-boundary.mjs 的判定逻辑 + 真实仓库的声明/产物事实,
 * 纯 Node 逻辑,不启 Electron):
 *
 * 双侧复核(同一套规则分别落在两侧,任一侧漂移都要红):
 * - src 源文本侧:src/**\/*.{ts,cts} 的 bare import 与 package.json 声明求差、
 *   层向规则、core 的 node: 内建白名单;
 * - dist 产物侧:dist/**\/*.{js,cjs} 的同一套判定。产物侧多两处真实差异 ——
 *   CommonJS 产物(preload.cjs)走 require 而非 import、type-only 已被编译期
 *   擦除(所以 renderer→preload 的放行条目在产物侧必须「不命中也不报错」)。
 *
 * 三层断言:
 * 1. 声明事实(读文本,不调被测实现):jszip 必须在 dependencies 且不在
 *    devDependencies;9 个传递依赖按 package-lock 实际版本钉死;check:boundary
 *    已入 verify:ci 且紧随 check:contract;ASAR 生产依赖判定里的每个
 *    node_modules 条目都归属某个生产依赖(devDependencies 的包不会被
 *    electron-builder 收进包,把它们算进生产依赖判定就是假绿)。
 * 2. 判定逻辑(直接 import 被测模块的纯函数 + CLI main()):真实 src/dist
 *    两侧均零 problem;沙盒负向夹具逐条制造漂移,断言非零退出 **且** 命中
 *    对应诊断(只断言退出码会让「因错误原因失败」蒙混过关);正向锚点证明
 *    夹具通路本身有效(否则负向用例可能只是「脚本跑不起来」)。
 * 3. 独立复核(测试内自带极简 import 抽取器,与被测实现无共享代码):直接从
 *    文本重算四条层向不变量 + 生产依赖覆盖,避免「用被测实现证明被测实现」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../common/paths.js";
import {
  CORE_NODE_BUILTIN_FILES,
  FLAVORS,
  HOST_PROVIDED_RUNTIME,
  LAYER_RULES,
  REVERSE_TYPE_ALLOWLIST,
  RESOURCE_ONLY_DEPENDENCIES,
  analyze,
  classifySpecifier,
  collectImports,
  isTypeOnlyClause,
  main as boundaryMain,
} from "../../scripts/check-import-boundary.mjs";
import { REQUIRED_ENTRIES } from "../../scripts/check-asar-manifest.mjs";

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const SRC_DIR = path.join(ROOT, "src");
const DIST_DIR = path.join(ROOT, "dist");

/** OPT-5.1 补声明的传递依赖:按 package-lock 实际版本钉死,运行时真的被 src import */
const DECLARED_TRANSITIVE_DEPS = {
  "mdast-util-from-markdown": "2.0.3",
  "mdast-util-gfm": "3.1.0",
  "mdast-util-math": "3.0.0",
  "micromark-extension-gfm": "3.0.0",
  "micromark-extension-math": "3.1.0",
  "micromark-util-symbol": "2.0.1",
  "micromark-util-types": "2.0.2",
  unified: "11.0.5",
  "unist-util-visit": "5.1.0",
};

/**
 * 断言辅助。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`import-boundary 断言失败:${msg}`);
}

/**
 * 跑被测脚本的 CLI main():吞掉 console 输出,返回 { code, output }。
 * @param {string[]} args CLI 参数
 * @returns {Promise<{ code: unknown; output: string }>} 退出码与合并后的输出
 */
async function runCli(args) {
  /** @type {string[]} */
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...a) => lines.push(a.join(" "));
  console.error = (...a) => lines.push(a.join(" "));
  try {
    const code = await boundaryMain(args);
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
 * 沙盒:一份 package.json + 一棵 src 树。
 * @param {unknown} pkg 沙盒 package.json 内容
 * @param {Record<string, string>} files 相对路径 → 文件内容
 * @returns {{ dir: string; srcDir: string; pkgPath: string }} 沙盒路径三元组
 */
function createSandbox(pkg, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-boundary-"));
  const srcDir = path.join(dir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  const pkgPath = writeFileIn(dir, "package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  for (const [relative, content] of Object.entries(files)) writeFileIn(srcDir, relative, content);
  return { dir, srcDir, pkgPath };
}

/**
 * 失败路径的固定断言面:退出码 1 + 命中诊断 + 不回吐调用栈。
 * @param {{ code: unknown; output: string }} result 子进程结果
 * @param {RegExp} pattern 期望命中的诊断
 * @param {string} label 用例标签
 * @returns {void}
 */
function assertFailure(result, pattern, label) {
  assert(result.code === 1, `${label} 应以退出码 1 结束,实际 ${result.code};输出:${result.output}`);
  assert(pattern.test(result.output), `${label} 诊断未命中 ${pattern};输出:${result.output}`);
  assert(!/\n\s+at\s/.test(result.output), `${label} 诊断应已归一化,不得回吐调用栈:${result.output}`);
}

// ---- 独立复核用:与被测实现无共享代码的极简 import 抽取器 ----

/**
 * 抽出 { file → [{ spec, typeOnly }] };只认行首 import/export ... from 与行内 type 说明符。
 * @param {string} root 扫描根目录
 * @param {string[]} extensions 计入的扩展名列表
 * @returns {Map<string, { spec: string; typeOnly: boolean }[]>} 相对路径 → import 列表
 */
function scanImportsIndependently(root, extensions) {
  const walk = (
    /** @type {string} */ dir,
    /** @type {string[]} */ out = [],
  ) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, out);
      else if (extensions.includes(path.extname(entry.name))) out.push(abs);
    }
    return out;
  };
  const byFile = new Map();
  for (const abs of walk(root)) {
    const file = path.relative(root, abs).split(path.sep).join("/");
    const text = fs.readFileSync(abs, "utf8");
    /** @type {{ spec: string; typeOnly: boolean }[]} */
    const found = [];
    for (const m of text.matchAll(/(?:^|\n)[ \t]*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
      // 三个捕获组在该正则下必然参与匹配,此处按非空断言语义收窄
      const clause = /** @type {string} */ (m[2]).trim();
      const typeOnly =
        m[1] !== undefined ||
        (clause.startsWith("{") &&
          clause
            .slice(1, clause.lastIndexOf("}"))
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== "")
            .every((s) => s === "type" || s.startsWith("type ")));
      found.push({ spec: /** @type {string} */ (m[3]), typeOnly });
    }
    byFile.set(file, found);
  }
  return byFile;
}

/**
 * 该相对 specifier 解析后落在哪一层(与被测实现同义但独立实现)。
 * @param {string} file 文件相对路径
 * @param {string} spec import 说明符
 * @returns {string | undefined} 规范化路径的首段(层名)
 */
function layerOf(file, spec) {
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  return joined.split("/")[0];
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  /** @type {string[]} */
  const sandboxes = [];
  const track = (/** @type {string} */ dir) => {
    sandboxes.push(dir);
    return dir;
  };

  try {
    // ================= 1. 声明事实(读文本) =================
    {
      const deps = PKG.dependencies ?? {};
      const devDeps = PKG.devDependencies ?? {};

      // jszip:docx 模板导入在 core 里运行时 import,曾是 devDependencies
      assert("jszip" in deps, `jszip 应在 dependencies(模板导入运行时需要),实际 dependencies=${Object.keys(deps).join(",")}`);
      assert(!("jszip" in devDeps), "jszip 不应同时留在 devDependencies(两处声明会让 npm 行为随场景分叉)");

      for (const [name, version] of Object.entries(DECLARED_TRANSITIVE_DEPS)) {
        assert(deps[name] === version, `dependencies.${name} 应钉为 ${version},实际 ${String(deps[name])}`);
        assert(!(name in devDeps), `${name} 不应同时出现在 devDependencies`);
      }

      // 门禁接入:check:boundary 已定义,且紧随 check:contract(早于 build)
      assert(typeof PKG.scripts["check:boundary"] === "string", "package.json 缺 check:boundary script");
      assert(
        PKG.scripts["check:boundary"] === "node scripts/check-import-boundary.mjs",
        `check:boundary 应指向 scripts/check-import-boundary.mjs,实际 ${String(PKG.scripts["check:boundary"])}`,
      );
      const chain = PKG.scripts["verify:ci"].split("&&").map((/** @type {string} */ s) => s.trim());
      const contractAt = chain.indexOf("npm run check:contract");
      const boundaryAt = chain.indexOf("npm run check:boundary");
      const buildAt = chain.indexOf("npm run build");
      assert(contractAt !== -1 && boundaryAt !== -1, `verify:ci 应含 check:contract 与 check:boundary,实际 ${chain.join(" -> ")}`);
      assert(boundaryAt > contractAt, `check:boundary 应紧随 check:contract,实际 ${chain.join(" -> ")}`);
      assert(boundaryAt < buildAt, `check:boundary 应早于 build(判定不消费 dist),实际 ${chain.join(" -> ")}`);

      // ASAR 生产依赖判定:node_modules 条目必须归属生产依赖
      // (electron-builder 只把 dependencies 收进包;devDependencies 的包若被写进
      //  生产依赖判定,门禁就成了永远为真的假绿)
      for (const { path: entryPath } of REQUIRED_ENTRIES) {
        const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(entryPath);
        if (match === null) continue;
        const owner = /** @type {string} */ (match[1]);
        assert(
          owner in deps,
          `ASAR 生产依赖条目 ${entryPath} 的宿主包 ${owner} 不在 dependencies(devDependencies 的包不会进包,该判定形同虚设)`,
        );
      }
      assert(
        REQUIRED_ENTRIES.some((e) => e.path === "node_modules/jszip/lib/index.js"),
        "REQUIRED_ENTRIES 应钉住 node_modules/jszip/lib/index.js(模板导入的 zip 解析器)",
      );

      // file:// 资源型依赖登记:mermaid 声明了但不经 import,必须登记否则输出噪声
      assert("mermaid" in RESOURCE_ONLY_DEPENDENCIES, "mermaid 以 file:// 直引产物,应登记在 RESOURCE_ONLY_DEPENDENCIES");
      assert(
        Object.keys(HOST_PROVIDED_RUNTIME).includes("electron"),
        "electron 由宿主注入,应在 HOST_PROVIDED_RUNTIME 登记(否则主进程全部 import 判红)",
      );
      console.log("[ok] import-boundary:声明事实(jszip 生产依赖 + 9 个传递依赖钉版 + 门禁入链 + ASAR 生产依赖判定)");
    }

    // ================= 2. 判定逻辑:真实 src / dist 双侧零 problem =================
    {
      const srcResult = analyze(SRC_DIR, PKG, FLAVORS.src);
      assert(
        srcResult.problems.length === 0,
        `src 侧应零 problem,实际 ${srcResult.problems.length} 项:${srcResult.problems.slice(0, 5).join(" | ")}`,
      );
      // 未使用声明只允许是已登记的 file:// 资源型依赖
      const unregistered = srcResult.info.filter(
        (line) => line.startsWith("未使用声明") && !line.includes("已登记"),
      );
      assert(unregistered.length === 0, `存在未登记的未使用声明:${unregistered.join(" | ")}`);
      // 放行条目必须都被真实命中(否则 allowlist 已失效,注释会骗人)
      const stale = srcResult.info.filter((line) => line.startsWith("放行条目已失效"));
      assert(stale.length === 0, `放行条目已失效但仍在表内:${stale.join(" | ")}`);

      assert(fs.existsSync(DIST_DIR), "缺少 dist 产物(本段需在 build 之后运行)");
      const distResult = analyze(DIST_DIR, PKG, FLAVORS.dist);
      assert(
        distResult.problems.length === 0,
        `dist 产物侧应零 problem,实际 ${distResult.problems.length} 项:${distResult.problems.slice(0, 5).join(" | ")}`,
      );
      console.log("[ok] import-boundary:真实 src 与 dist 产物双侧零 problem(放行条目在两侧都被正确处理)");
    }

    // ================= 3. 独立复核:测试自带抽取器重算四条不变量 =================
    {
      const srcScan = scanImportsIndependently(SRC_DIR, [".ts", ".cts"]);
      assert(srcScan.size > 0, "独立抽取器未扫到任何 src 文件(抽取器本身失效?)");
      const distScan = scanImportsIndependently(DIST_DIR, [".js", ".cjs"]);
      assert(distScan.size > 0, "独立抽取器未扫到任何 dist 文件(需先 build)");

      /** @type {[string, Map<string, { spec: string; typeOnly: boolean }[]>][]} */
      const scans = [
        ["src", srcScan],
        ["dist", distScan],
      ];
      for (const [label, scan] of scans) {
        for (const [file, imports] of scan) {
          for (const { spec, typeOnly } of imports) {
            const { kind } = classifySpecifier(spec);
            // 层向 1:core 不碰宿主
            if (file.startsWith("core/")) {
              assert(spec !== "electron", `${label}:core 不得 import electron(${file} → ${spec})`);
              // 层向 2:core 不反向依赖 GUI 两层
              if (kind === "relative") {
                const layer = layerOf(file, spec);
                assert(
                  layer !== "main" && layer !== "renderer",
                  `${label}:core 不得 import ${layer} 层(${file} → ${spec})`,
                );
              }
              // 层向 3:core 的 node: 内建面限白名单四文件
              if (spec.startsWith("node:")) {
                const key = file.slice(0, file.length - path.posix.extname(file).length);
                assert(
                  CORE_NODE_BUILTIN_FILES.some((f) => f.slice(0, f.length - path.posix.extname(f).length) === key),
                  `${label}:${file} 的 node: 内建 import ${spec} 不在白名单内`,
                );
              }
            }
            // 层向 4:renderer 不反向依赖 main(仅 type-only 的放行条目例外)
            if (file.startsWith("renderer/") && kind === "relative" && layerOf(file, spec) === "main") {
              const allowed =
                typeOnly && REVERSE_TYPE_ALLOWLIST.some((a) => a.spec === spec && a.file.startsWith("renderer/"));
              assert(allowed, `${label}:${file} 不得 import main 层 ${spec}(type-only 放行表:${REVERSE_TYPE_ALLOWLIST.map((a) => a.spec).join(",")})`);
            }
            // 层向 5:preload 不上跳引用 main
            if (file === "main/preload.cts" || file === "main/preload.cjs") {
              assert(
                !(kind === "relative" && spec.startsWith("../main")),
                `${label}:preload 不得 import ../main/**(${file} → ${spec})`,
              );
            }
          }
        }
      }

      // 生产依赖覆盖:src 里每个运行时 bare import(宿主内建除外)都在 dependencies
      const prodDeps = new Set(Object.keys(PKG.dependencies ?? {}));
      const hostProvided = new Set(Object.keys(HOST_PROVIDED_RUNTIME));
      const missing = new Set();
      for (const imports of srcScan.values()) {
        for (const { spec, typeOnly } of imports) {
          if (typeOnly) continue;
          const { kind, packageName } = classifySpecifier(spec);
          if (kind !== "bare" || packageName === null || hostProvided.has(packageName)) continue;
          if (!prodDeps.has(packageName)) missing.add(packageName);
        }
      }
      assert(
        missing.size === 0,
        `src 运行时 import 的包未在 dependencies 声明:${[...missing].sort().join(",")}(传递依赖偶然就位)`,
      );

      // 放行条目在 src 里必须真实存在且为 type-only(否则它已名存实亡)
      for (const allow of REVERSE_TYPE_ALLOWLIST) {
        const imports = srcScan.get(allow.file) ?? [];
        const hit = imports.find((i) => i.spec === allow.spec);
        assert(hit !== undefined, `放行条目 ${allow.file} → ${allow.spec} 在 src 中已不存在(请删除该条目)`);
        assert(/** @type {{ typeOnly: boolean }} */ (hit).typeOnly, `放行条目 ${allow.file} → ${allow.spec} 已不是 type-only(编译期不再擦除,应改判红)`);
        assert(allow.note.includes("OPT-5.1"), `放行条目 ${allow.file} → ${allow.spec} 的注释须标注 OPT-5.1 收口项`);
      }
      // 规则表形态:四条层向断言都在
      for (const id of ["core-no-host", "core-no-upward", "renderer-no-main", "preload-no-main"]) {
        assert(LAYER_RULES.some((r) => r.id === id), `层向规则表缺 ${id}`);
      }
      // 沙盒基线:放行条目失效不报错(条目对应文件不在沙盒里)
      {
        const sb = createSandbox({ dependencies: { docx: "9.0.0" } }, { "core/a.ts": 'import { x } from "docx";\nexport { x };\n' });
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(result.code === 0, `放行条目失效时不应报错,实际 ${result.code}:${result.output}`);
        assert(
          result.output.includes("放行条目已失效"),
          `失效的放行条目应作为提示输出(便于择机删除),实际:${result.output}`,
        );
        assert(!result.output.includes("[boundary:fail]"), `失效条目不得产生 fail 行:${result.output}`);
      }
      console.log("[ok] import-boundary:独立抽取器复核通过(core 禁宿主/禁上跳、renderer 禁 main、preload 禁上跳、生产依赖覆盖、放行条目有效性)");
    }

    // ================= 4. 沙盒负向夹具:逐条制造漂移,断言精确诊断 =================
    {
      /** @type {{ label: string; pkg: unknown; files: Record<string, string>; args?: string[]; pattern: RegExp }[]} */
      const cases = [
        {
          label: "运行时依赖只在 devDependencies(生产安装会缺件)",
          pkg: { dependencies: {}, devDependencies: { jszip: "3.10.1" } },
          files: { "core/docx/template-import.ts": 'import JSZip from "jszip";\nexport { JSZip };\n' },
          pattern: /core\/docx\/template-import\.ts:运行时 import「jszip」只在 devDependencies 中声明/,
        },
        {
          label: "运行时依赖完全未声明(靠传递依赖偶然就位)",
          pkg: { dependencies: { docx: "9.0.0" } },
          files: { "core/pipeline/parse.ts": 'import { unified } from "unified";\nexport { unified };\n' },
          pattern: /core\/pipeline\/parse\.ts:运行时 import「unified」未在任何依赖段声明/,
        },
        {
          label: "type-only 依赖既未声明也无 @types 提供",
          pkg: { dependencies: { docx: "9.0.0" } },
          files: { "core/markdown/comment.ts": 'import type { Options } from "vfile";\nexport type { Options };\n' },
          pattern: /core\/markdown\/comment\.ts:type-only import「vfile」既不在 dependencies\/devDependencies/,
        },
        {
          label: "core import electron(核心不得依赖宿主)",
          pkg: { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          files: { "core/docx/ctx.ts": 'import { app } from "electron";\nexport { app };\n' },
          pattern: /core\/docx\/ctx\.ts:import「electron」违反层向规则 core-no-host/,
        },
        {
          label: "core 反向依赖 main(层级方向倒置)",
          pkg: { dependencies: { docx: "9.0.0" } },
          files: { "core/docx/ctx.ts": 'import { x } from "../../main/persist/settings.js";\nexport { x };\n' },
          pattern: /core\/docx\/ctx\.ts:import「\.\.\/\.\.\/main\/persist\/settings\.js」违反层向规则 core-no-upward/,
        },
        {
          label: "core 反向依赖 renderer",
          pkg: { dependencies: { docx: "9.0.0" } },
          files: { "core/docx/ctx.ts": 'import { x } from "../../renderer/state/state.js";\nexport { x };\n' },
          pattern: /违反层向规则 core-no-upward/,
        },
        {
          label: "core 在白名单外触碰 node: 内建",
          pkg: { dependencies: { docx: "9.0.0" } },
          files: { "core/docx/ctx.ts": 'import path from "node:path";\nexport { path };\n' },
          pattern: /core\/docx\/ctx\.ts:core 侧 import「node:path」不在内建白名单内/,
        },
        {
          label: "renderer 运行时 import main(绕过 contextBridge)",
          pkg: { dependencies: { docx: "9.0.0" } },
          files: { "renderer/renderer.ts": 'import { x } from "../main/ipc/channels.js";\nexport { x };\n' },
          pattern: /renderer\/renderer\.ts:import「\.\.\/main\/ipc\/channels\.js」违反层向规则 renderer-no-main/,
        },
        {
          label: "renderer type-only import main 且不在放行表(反向依赖收窄后无人放行)",
          pkg: { dependencies: { docx: "9.0.0" } },
          files: { "renderer/state/state.ts": 'import type { A } from "../../main/ipc/types.js";\nexport type { A };\n' },
          pattern: /renderer\/state\/state\.ts:type-only import「\.\.\/\.\.\/main\/ipc\/types\.js」违反层向规则 renderer-no-main/,
        },
        {
          label: "preload 上跳引用 main",
          pkg: { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          files: { "main/preload.cts": 'import { x } from "../main/ipc/logic.js";\nexport { x };\n' },
          pattern: /main\/preload\.cts:import「\.\.\/main\/ipc\/logic\.js」违反层向规则 preload-no-main/,
        },
        {
          label: "未知参数(不留隐式默认扫描范围)",
          pkg: { dependencies: {} },
          files: { "core/a.ts": "export {};\n" },
          args: ["--scan", "src"],
          pattern: /无法识别的选项:--scan/,
        },
        {
          label: "--src 缺取值",
          pkg: { dependencies: {} },
          files: { "core/a.ts": "export {};\n" },
          args: ["--src"],
          pattern: /选项 --src 缺少取值/,
        },
        {
          label: "未知形态(不猜 src/dist)",
          pkg: { dependencies: {} },
          files: {},
          args: ["--flavor", "bundle"],
          pattern: /未知形态:bundle/,
        },
      ];

      for (const item of cases) {
        const sb = createSandbox(item.pkg, item.files);
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath, ...(item.args ?? [])]);
        assertFailure(result, item.pattern, item.label);
      }
      console.log(`[ok] import-boundary:${cases.length} 类漂移夹具全部非零退出且命中各自诊断`);
    }

    // ================= 5. 正向锚点:夹具通路有效(否则上面的红可能只是「跑不起来」) =================
    {
      // 5a. 同样的沙盒形状,内容合法 → 必须零退出
      {
        const sb = createSandbox(
          {
            dependencies: { docx: "9.0.0", unified: "11.0.5" },
            devDependencies: { electron: "43.0.0", "@types/mdast": "4.0.4" },
          },
          {
            "core/pipeline/parse.ts": 'import { unified } from "unified";\nimport type { Node } from "mdast";\nexport { unified };\n',
            "core/pdf/katex-css.ts": 'import fs from "node:fs";\nexport { fs };\n',
            "main/index.ts": 'import { app } from "electron";\nimport { x } from "../core/pipeline/parse.js";\nexport { app, x };\n',
            "renderer/renderer.ts": 'import type { PreloadApi } from "../main/preload.cjs";\nexport type { PreloadApi };\n',
            "renderer/state/state.ts": 'import { x } from "../dom/refs.js";\nexport { x };\n',
          },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(result.code === 0, `合法沙盒应零退出,实际 ${result.code}:${result.output}`);
        assert(!result.output.includes("[boundary:fail]"), `合法沙盒不得有 fail 行:${result.output}`);
        // 白名单文件用 node: 内建不报;放行条目被命中也不报
        assert(result.output.includes("import 边界自检通过"), `合法沙盒应给出通过结论:${result.output}`);
      }
      // 5b. 同一放行条目改成运行时 import → 必须立刻判红(证明放行是 type-only 限定而非按文件放行)
      {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "renderer/renderer.ts": 'import { api } from "../main/preload.cjs";\nexport { api };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(result, /renderer\/renderer\.ts:import「\.\.\/main\/preload\.cjs」违反层向规则 renderer-no-main/, "放行条目被改成运行时 import");
      }
      // 5c. 未知 devDependency 的 @types 缺失时,type-only 判定不被 devDependencies 段掩盖
      {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "core/docx/ctx.ts": 'import type { X } from "docx";\nexport type { X };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(result.code === 0, `已声明包的 type-only import 应放行,实际 ${result.code}:${result.output}`);
      }
      console.log("[ok] import-boundary:正向锚点(合法沙盒零退出 / 放行条目仅对 type-only 生效 / 已声明包的类型引用放行)");
    }

    // ================= 6. 规则原语的单元断言(判定链的接缝) =================
    {
      // specifier 归类:node 内建 / 相对 / 外部 URL / bare(含 scope 与子路径)
      const kinds = [
        ["node:fs", "builtin"],
        ["../a/b.js", "relative"],
        ["./b.js", "relative"],
        ["https://example.com/x.js", "external"],
        ["docx", "bare"],
        ["@mdit/plugin-tasklist", "bare"],
        ["highlight.js/lib/common", "bare"],
        ["electron", "bare"],
      ];
      for (const [spec, kind] of kinds) {
        assert(classifySpecifier(spec).kind === kind, `specifier「${spec}」应归类为 ${kind},实际 ${classifySpecifier(spec).kind}`);
      }
      assert(classifySpecifier("@mdit/plugin-tasklist").packageName === "@mdit/plugin-tasklist", "scope 包名应保留两段");
      assert(classifySpecifier("highlight.js/lib/common").packageName === "highlight.js", "子路径应回收到宿主包名");

      // type-only 子句判定
      assert(isTypeOnlyClause("type ", "{ A }") === true, "`import type {...}` 应为 type-only");
      assert(isTypeOnlyClause(undefined, "{ type A, type B }") === true, "全 type 说明符应为 type-only");
      assert(isTypeOnlyClause(undefined, "{ a, type B }") === false, "含值绑定应视为运行时");
      assert(isTypeOnlyClause(undefined, "def, { a }") === false, "默认绑定应视为运行时");
      assert(isTypeOnlyClause(undefined, "* as ns") === false, "命名空间绑定应视为运行时");

      // 文件事实:preload 产物是 CommonJS(require 而非 import),须被产物侧抽到
      const preloadCjs = path.join(DIST_DIR, "main", "preload.cjs");
      assert(fs.existsSync(preloadCjs), "缺少 dist/main/preload.cjs(本段需在 build 之后运行)");
      const cjsImports = collectImports(preloadCjs, { cjs: true });
      assert(
        cjsImports.some((i) => i.spec === "electron" && i.kind === "bare"),
        "产物侧抽取器未抽到 preload.cjs 的 require(\"electron\")(cjs 抽取失效)",
      );
      console.log("[ok] import-boundary:规则原语断言通过(specifier 归类 / type-only 判定 / CJS require 抽取)");
    }
  } finally {
    for (const dir of sandboxes) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}
