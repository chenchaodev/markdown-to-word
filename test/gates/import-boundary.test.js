// @ts-check
/**
 * 依赖声明与 import 层向边界守护段(位于 test/core/ = 跨域守护段;被测为
 * gates/repo/check-import-boundary.mjs 的判定逻辑 + 真实仓库的声明/产物事实,
 * 纯 Node 逻辑,不启 Electron):
 *
 * 双侧复核(同一套规则分别落在两侧,任一侧漂移都要红):
 * - src 源文本侧:src/**\/*.{ts,cts} 的 bare import 与 package.json 声明求差、
 *   层向规则、层向**文本**判据、core 的 node: 内建白名单;
 * - dist 产物侧:dist/**\/*.{js,cjs} 的同一套判定。产物侧多两处真实差异 ——
 *   CommonJS 产物(preload.cjs)走 require 而非 import、type-only 已被编译期
 *   擦除(所以指向 main 的反向引用在产物侧天然不出现 —— 产物侧看不到,只能靠 src 侧断言)。
 *
 * 四层断言:
 * 1. 声明事实(读文本,不调被测实现):jszip 必须在 dependencies 且不在
 *    devDependencies;9 个传递依赖按 package-lock 实际版本钉死;check:boundary
 *    已入 verify:ci 且紧随 check:contract;ASAR 生产依赖判定里的每个
 *    node_modules 条目都归属某个生产依赖(devDependencies 的包不会被
 *    electron-builder 收进包,把它们算进生产依赖判定就是假绿)。
 * 2. 判定逻辑(直接 import 被测模块的纯函数 + CLI main()):真实 src/dist
 *    两侧均零 problem;pending 规则命中归 info、不进 problems 的分流也在此钉住
 *    (否则「零 problem」与「那几条规则被删了」不可区分);沙盒负向夹具逐条制造漂移,
 *    断言非零退出 **且** 命中
 *    对应诊断(只断言退出码会让「因错误原因失败」蒙混过关);正向锚点证明
 *    夹具通路本身有效(否则负向用例可能只是「脚本跑不起来」)。
 * 3. 独立复核(测试内自带极简 import 抽取器,与被测实现无共享代码):直接从
 *    文本重算逐条层向不变量(含 src/ 顶层登记事实)+ 生产依赖覆盖,避免「用被测实现证明被测实现」。
 * 4. (9) 组:层向文本判据(LAYER_TEXT_RULES)的两条新规则 + `--flavor dist` 的判红方向。
 *    与 2 的分工:2 验「import 了什么」,9 验「文件里出现了什么」;9 的每条新规则都跑满
 *    「构造 ⇒ 判红 ⇒ 撤回 ⇒ 复绿」,并对 `--flavor dist` 造合成违例(2/3 只跑真实 dist 的绿支,
 *    恒绿与「有判据但从不变红」在那两处不可区分)。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";
import { ROOT } from "../harness/paths.js";
import { removeTree } from "../harness/temp-resource.js";
import {
  CORE_NODE_BUILTIN_FILES,
  FLAVORS,
  HOST_PROVIDED_RUNTIME,
  LAYER_RULES,
  LAYER_TEXT_RULES,
  PENDING_PREFIX,
  RENDERER_FEATURE_ROOTS,
  RENDERER_FEATURE_SCOPE_EXCEPT_FILES,
  RENDERER_PEER_ROOTS,
  RENDERER_TOP_DIRS,
  RESOURCE_ONLY_DEPENDENCIES,
  SRC_TOP_LAYERS,
  WINDOWS_ONLY_ENV_VARS,
  WINDOWS_ONLY_EXECUTABLES,
  analyze,
  analyzeRendererTopDirs,
  analyzeSrcTopLayers,
  analyzeTreeBoundaries,
  classifySpecifier,
  collectImports,
  findTextLayerViolations,
  findUnregisteredRendererDirs,
  findUnregisteredSrcLayers,
  isTypeOnlyClause,
  main as boundaryMain,
  resolveLayer,
  resolveOwner,
  selfCheckPeerMesh,
  selfCheckTextLayerRules,
  selfCheckTreeLayout,
} from "../../gates/repo/check-import-boundary.mjs";
import { REQUIRED_ENTRIES } from "../../gates/artifacts/check-asar-manifest.mjs";

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const SRC_DIR = path.join(ROOT, "src");
const DIST_DIR = path.join(ROOT, "dist");

/** 补声明的传递依赖:按 package-lock 实际版本钉死,运行时真的被 src import */
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

const { assert } = createAsserter("import-boundary");

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

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  /** @type {string[]} */
  const sandboxes = [];
  const track = (/** @type {string} */ dir) => {
    sandboxes.push(dir);
    return dir;
  };

  try {
    // ================= 1. 声明事实(读文本) =================
    await suite.describe("1 声明事实(读文本)", async (s) => {
      const deps = PKG.dependencies ?? {};
      const devDeps = PKG.devDependencies ?? {};

      // jszip:docx 模板导入在 core 里运行时 import,曾是 devDependencies
      await s.case("jszip 在 dependencies 且不在 devDependencies", () => {
        assert("jszip" in deps, `jszip 应在 dependencies(模板导入运行时需要),实际 dependencies=${Object.keys(deps).join(",")}`);
        assert(!("jszip" in devDeps), "jszip 不应同时留在 devDependencies(两处声明会让 npm 行为随场景分叉)");
      });

      await s.case("传递依赖按 package-lock 实际版本钉死且不同时留在 devDependencies", () => {
        for (const [name, version] of Object.entries(DECLARED_TRANSITIVE_DEPS)) {
          assert(deps[name] === version, `dependencies.${name} 应钉为 ${version},实际 ${String(deps[name])}`);
          assert(!(name in devDeps), `${name} 不应同时出现在 devDependencies`);
        }
      });

      // 门禁接入:check:boundary 已定义,且紧随 check:contract(早于 build)
      await s.case("check:boundary 已定义且已入 verify:ci,紧随 check:contract、早于 build", () => {
        assert(typeof PKG.scripts["check:boundary"] === "string", "package.json 缺 check:boundary script");
        assert(
          PKG.scripts["check:boundary"] === "node gates/repo/check-import-boundary.mjs",
          `check:boundary 应指向 gates/repo/check-import-boundary.mjs,实际 ${String(PKG.scripts["check:boundary"])}`,
        );
        const chain = PKG.scripts["verify:ci"].split("&&").map((/** @type {string} */ s) => s.trim());
        const contractAt = chain.indexOf("npm run check:contract");
        const boundaryAt = chain.indexOf("npm run check:boundary");
        const buildAt = chain.indexOf("npm run build");
        assert(contractAt !== -1 && boundaryAt !== -1, `verify:ci 应含 check:contract 与 check:boundary,实际 ${chain.join(" -> ")}`);
        assert(boundaryAt > contractAt, `check:boundary 应紧随 check:contract,实际 ${chain.join(" -> ")}`);
        assert(boundaryAt < buildAt, `check:boundary 应早于 build(判定不消费 dist),实际 ${chain.join(" -> ")}`);
      });

      // ASAR 生产依赖判定:node_modules 条目必须归属生产依赖
      // (electron-builder 只把 dependencies 收进包;devDependencies 的包若被写进
      //  生产依赖判定,门禁就成了永远为真的假绿)
      await s.case("ASAR 生产依赖判定里每个 node_modules 条目都归属某个生产依赖", () => {
        for (const { path: entryPath } of REQUIRED_ENTRIES) {
          const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(entryPath);
          if (match === null) continue;
          const owner = /** @type {string} */ (match[1]);
          assert(
            owner in deps,
            `ASAR 生产依赖条目 ${entryPath} 的宿主包 ${owner} 不在 dependencies(devDependencies 的包不会进包,该判定形同虚设)`,
          );
        }
      });

      await s.case("REQUIRED_ENTRIES 钉住 jszip 的 zip 解析器", () => {
        assert(
          REQUIRED_ENTRIES.some((e) => e.path === "node_modules/jszip/lib/index.js"),
          "REQUIRED_ENTRIES 应钉住 node_modules/jszip/lib/index.js(模板导入的 zip 解析器)",
        );
      });

      // file:// 资源型依赖登记:mermaid 声明了但不经 import,必须登记否则输出噪声
      await s.case("file:// 资源型依赖与宿主注入已登记", () => {
        assert("mermaid" in RESOURCE_ONLY_DEPENDENCIES, "mermaid 以 file:// 直引产物,应登记在 RESOURCE_ONLY_DEPENDENCIES");
        assert(
          Object.keys(HOST_PROVIDED_RUNTIME).includes("electron"),
          "electron 由宿主注入,应在 HOST_PROVIDED_RUNTIME 登记(否则主进程全部 import 判红)",
        );
      });
      console.log("[ok] import-boundary:声明事实(jszip 生产依赖 + 9 个传递依赖钉版 + 门禁入链 + ASAR 生产依赖判定)");
    });

    // ================= 2. 判定逻辑:真实 src / dist 双侧零 problem =================
    // 「零 problem」的含义要说清:非 pending 判据当前零命中;带 `pending: true` 的那几条
    // (T0 新建、待 T2 转判红)命中归入 info、不进 problems,故它们当前有命中也不影响本断言。
    // 下面两行断言把这个分流本身钉住 —— 否则「零 problem」与「那几条规则被删了」在断言上
    // 不可区分(两者都表现为 problems 为空),等于给恒绿开了口子。
    await suite.describe("2 判定逻辑:真实 src / dist 双侧零 problem", async (s) => {
      // 两次全树 analyze 与「pending 规则 id 清单」留在 case 之外当取数:
      // 下面六条 case 共用同一份结果,而 dist 侧的存在性判定一旦缺失,
      // 后续 case 会在 undefined 上炸出误导性的连带失败(TypeError 盖掉真因)。
      const srcResult = analyze(SRC_DIR, PKG, FLAVORS.src);
      assert(fs.existsSync(DIST_DIR), "缺少 dist 产物(本段需在 build 之后运行)");
      const distResult = analyze(DIST_DIR, PKG, FLAVORS.dist);
      // 分流断言(守的是「pending 只报告不判红」这个机制本身):
      // ① 带 pending 标记的规则一张都不能混进 problems —— T2 逐条删标记后本断言持续成立,
      //    因为删完标记的前提就是那些边已搬走、真代码零命中;
      // ② info 里的 pending 行必须带前缀 —— 「静默放过」与「漏判」在退出码上都表现为 0,
      //    只有把这批命中显式说出来才区分得开,故前缀不可省。
      const pendingIds = [...LAYER_RULES, ...LAYER_TEXT_RULES]
        .filter((r) => r.pending === true)
        .map((r) => r.id);
      // 必须显式标注元组类型:不标注时 TS 把二维数组的元素类型推成「所有元素的并集」,
      // 于是 result 被推成 `string | 分析结果` —— 凭空多出本不该有的 string 分支
      // (表现为 result.info 不存在、result 可能 undefined)。这不是门禁的返回类型问题。
      /** @type {[string, typeof srcResult][]} */
      const sides = [["src", srcResult], ["dist", distResult]];

      await s.case("src 侧零 problem", () => {
        assert(
          srcResult.problems.length === 0,
          `src 侧应零 problem,实际 ${srcResult.problems.length} 项:${srcResult.problems.slice(0, 5).join(" | ")}`,
        );
      });

      // 未使用声明只允许是已登记的 file:// 资源型依赖
      await s.case("src 侧不存在未登记的未使用声明", () => {
        const unregistered = srcResult.info.filter(
          (line) => line.startsWith("未使用声明") && !line.includes("已登记"),
        );
        assert(unregistered.length === 0, `存在未登记的未使用声明:${unregistered.join(" | ")}`);
      });

      await s.case("dist 产物侧零 problem", () => {
        assert(
          distResult.problems.length === 0,
          `dist 产物侧应零 problem,实际 ${distResult.problems.length} 项:${distResult.problems.slice(0, 5).join(" | ")}`,
        );
      });

      await s.case("双侧:pending 规则的命中不得混进 problems", () => {
        for (const [label, result] of sides) {
          const leaked = result.problems.filter((line) =>
            pendingIds.some((id) => line.includes(`层向规则 ${id}`)),
          );
          assert(
            leaked.length === 0,
            `${label} 侧:pending 规则的命中不得进 problems(它只报告不判红),实际混入 ${leaked.length} 项:${leaked.slice(0, 3).join(" | ")}`,
          );
        }
      });

      await s.case("双侧:info 里的 [pending] 行必须点名某条 pending 规则", () => {
        for (const [, result] of sides) {
          const pendingLines = result.info.filter((line) => line.startsWith(PENDING_PREFIX));
          assert(
            pendingLines.every((line) => pendingIds.some((id) => line.includes(`层向规则 ${id}`))),
            `info 里的 [pending] 行必须点名某条 pending 规则:${pendingLines.filter((line) => !pendingIds.some((id) => line.includes(`层向规则 ${id}`))).join(" | ")}`,
          );
        }
      });

      // pending 命中数按规则 id 可见(门禁输出另有汇总是同一份数据的 CLI 面表现)
      await s.case("pendingHits 为 Map 且逐条命中数是已登记规则上的正整数", () => {
        assert(
          srcResult.pendingHits instanceof Map,
          "analyze 应返回 pendingHits(Map<规则 id, 命中处数>),pending 命中数才可被逐条报出",
        );
        for (const [id, count] of srcResult.pendingHits) {
          assert(pendingIds.includes(id), `pendingHits 里的 ${id} 不在带 pending 标记的规则表中`);
          assert(Number.isInteger(count) && count > 0, `${id} 的 pending 命中数应为正整数,实际 ${String(count)}`);
        }
      });
      console.log(
        "[ok] import-boundary:真实 src 与 dist 产物双侧零 problem"
          + `(pending 规则命中归 info、不进 problems;当前 src 侧 ${srcResult.pendingHits.size} 条 pending 规则有命中)`,
      );
    });

    // ================= 3. 独立复核:测试自带抽取器重算逐条层向不变量 =================
    await suite.describe("3 独立复核:测试自带抽取器重算逐条层向不变量", async (s) => {
      // 双侧扫描结果与 rules 表查询留在 case 之外当取数:下面三条 case 共用它们,
      // 而 dist 侧扫描依赖 build 产物 —— 放进任一 case 都会让另外两条在
      // 「产物缺失」时产出误导性的连带失败。
      const srcScan = scanImportsIndependently(SRC_DIR, [".ts", ".cts"]);
      assert(srcScan.size > 0, "独立抽取器未扫到任何 src 文件(抽取器本身失效?)");
      const distScan = scanImportsIndependently(DIST_DIR, [".js", ".cjs"]);
      assert(distScan.size > 0, "独立抽取器未扫到任何 dist 文件(需先 build)");

      /** @type {[string, Map<string, { spec: string; typeOnly: boolean }[]>][]} */
      const scans = [
        ["src", srcScan],
        ["dist", distScan],
      ];

      await s.case("双侧逐条层向不变量重算一致(八条层向规则)", () => {
        for (const [label, scan] of scans) {
          for (const [file, imports] of scan) {
            for (const { spec } of imports) {
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
              // 层向 4:renderer 不反向依赖 main —— 绝对禁止,无放行例外
              // (REF-025 #03 起:PreloadApi 抽到 core/preload-api.ts 后,原先唯一那条
              //  type-only 放行条目已随放行机制一起删除,本断言不再需要例外分支)
              if (file.startsWith("renderer/") && kind === "relative" && layerOf(file, spec) === "main") {
                assert(
                  false,
                  `${label}:${file} 不得 import main 层 ${spec}(renderer→main 已无任何放行例外;`
                    + `window.api 类型单源在 core/preload-api.ts)`,
                );
              }
              // 层向 5:preload 不上跳引用 main
              if (file === "main/preload.cts" || file === "main/preload.cjs") {
                assert(
                  !(kind === "relative" && spec.startsWith("../main")),
                  `${label}:preload 不得 import ../main/**(${file} → ${spec})`,
                );
              }
              // 层向 6:main 不反向依赖 renderer
              if (file.startsWith("main/") && kind === "relative" && layerOf(file, spec) === "renderer") {
                assert(false, `${label}:${file} 不得 import renderer 层 ${spec}(依赖方向单向 core ← main ← renderer)`);
              }
              // 层向 7:convert 是 headless 装配层,消费面在它之上(ADR-060),
              // 不得反向依赖 GUI 两层 —— 否则新树里那些「借 main 拿点配置」的 import
              // 只会因门禁没扫到而全绿(该文件自己批过这一形态)
              if (file.startsWith("convert/") && kind === "relative") {
                const layer = layerOf(file, spec);
                assert(
                  layer !== "main" && layer !== "renderer",
                  `${label}:convert 装配层不得 import ${layer} 层(${file} → ${spec});消费面一律在 convert 之上`,
                );
              }
              // 层向 7b:convert 是四个交付面共用的无宿主装配单元,自身不得 import electron
              // (ADR-060 后果 1 明文)。不靠「core 不 import 它」蕴含 —— core 与 convert
              // 是两棵树,各自独立判。
              if (file.startsWith("convert/")) {
                assert(spec !== "electron", `${label}:convert 不得 import electron(${file} → ${spec})`);
              }
              // 层向 7c:convert 不得解析到 src/ 之外(按解析结果判,与文件深度无关)。
              // 独立实现只用 layerOf 的结果首段 —— 与被测实现的 layer:.. 形态同义但各写各的。
              if (file.startsWith("convert/") && kind === "relative") {
                assert(
                  layerOf(file, spec) !== "..",
                  `${label}:convert 不得逃出 src/(${file} → ${spec} 解析为 ${layerOf(file, spec)}/…)`,
                );
              }
              // 层向 8:cli 是进程外交付面,renderer 是 GUI 面 —— 引它会把 Electron 拖进纯 node 侧
              if (file.startsWith("cli/") && kind === "relative" && layerOf(file, spec) === "renderer") {
                assert(false, `${label}:${file} 不得 import renderer 层 ${spec}(cli 是进程外交付面)`);
              }
            }
          }
        }
      });

      await s.case("生产依赖覆盖:src 运行时 bare import 全在 dependencies", () => {
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
      });

      // REF-025 #03 补充断言:renderer 侧不得残留任何指向 main 层的相对 import。
      // 放行机制已整体删除,故这里改成直接查事实(原先靠 allowlist 空转代替)。
      await s.case("REF-025 #03:renderer 侧零指向 main 层的相对 import", () => {
        for (const [file, imports] of srcScan) {
          if (!file.startsWith("renderer/")) continue;
          for (const i of imports) {
            const kind = classifySpecifier(i.spec).kind;
            assert(
              !(kind === "relative" && layerOf(file, i.spec) === "main"),
              `renderer 侧仍有指向 main 层的 import:${file} → ${i.spec}`,
            );
          }
        }
      });

      await s.case("规则表形态:逐条层向断言 id 都在表内", () => {
        // 规则表形态:十二条层向断言都在
        for (const id of [
          "core-no-host",
          "convert-no-gui",
          "convert-no-host",
          "convert-no-outside-src",
          "core-no-upward",
          "renderer-no-main",
          "preload-no-main",
          "main-no-renderer",
          "faces-no-renderer",
          "faces-no-host",
          "faces-no-outside-src",
          "smoke-no-outside-src",
          "renderer-foundation-no-feature-dep",
          "core-pdf-no-fs",
        ]) {
          assert(LAYER_RULES.some((r) => r.id === id), `层向规则表缺 ${id}`);
        }
      });
      console.log("[ok] import-boundary:独立抽取器复核通过(core 禁宿主/禁上跳、convert 禁 GUI 两层、renderer 禁 main、main 禁 renderer、preload 禁上跳、cli 禁 renderer、生产依赖覆盖)");
    });

    // ================= 4. 沙盒负向夹具:逐条制造漂移,断言精确诊断 =================
    await suite.describe("4 沙盒负向夹具:逐条制造漂移,断言精确诊断", async (s) => {
      // 夹具表留在 case 之外:它是「有哪些漂移形态」的清单,逐条 case 只是在消费它
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
          label: "renderer type-only import main(绝对禁止:放行机制已删除,type-only 不例外)",
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

      // 每个夹具一个 case:漂移形态彼此独立,合成一条会让「哪几类漂移还判得红」看不出来
      for (const item of cases) {
        await s.case(`漂移:${item.label}`, async () => {
          const sb = createSandbox(item.pkg, item.files);
          track(sb.dir);
          const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath, ...(item.args ?? [])]);
          assertFailure(result, item.pattern, item.label);
        });
      }
      console.log(`[ok] import-boundary:${cases.length} 类漂移夹具全部非零退出且命中各自诊断`);
    });

    // ================= 5. 正向锚点:夹具通路有效(否则上面的红可能只是「跑不起来」) =================
    await suite.describe("5 正向锚点:夹具通路有效(否则上面的红可能只是「跑不起来」)", async (s) => {
      // 5a. 同样的沙盒形状,内容合法 → 必须零退出
      await s.case("5a 同样的沙盒形状,内容合法 → 必须零退出", async () => {
        const sb = createSandbox(
          {
            dependencies: { docx: "9.0.0", unified: "11.0.5" },
            devDependencies: { electron: "43.0.0", "@types/mdast": "4.0.4" },
          },
          {
            "core/pipeline/parse.ts": 'import { unified } from "unified";\nimport type { Node } from "mdast";\nexport { unified };\n',
            // core/pdf 只碰 node:path(纯字符串运算);node:fs 已由规则 core-pdf-no-fs 禁止
            // (REF-025 #07:两次读改为经 RenderPdfHtmlOptions.fs 注入)
            "core/pdf/katex-css.ts": 'import path from "node:path";\nexport { path };\n',
            "main/index.ts": 'import { app } from "electron";\nimport { x } from "../core/pipeline/parse.js";\nexport { app, x };\n',
            // renderer 取 preload 类型改从 core 取(REF-025 #03),不再是指向 main 的反向引用
            "renderer/renderer.ts": 'import type { PreloadApi } from "../core/preload-api.js";\nexport type { PreloadApi };\n',
            "renderer/state/state.ts": 'import { x } from "../dom/refs.js";\nexport { x };\n',
          },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(result.code === 0, `合法沙盒应零退出,实际 ${result.code}:${result.output}`);
        assert(!result.output.includes("[boundary:fail]"), `合法沙盒不得有 fail 行:${result.output}`);
        // 白名单文件用 node: 内建不报
        assert(result.output.includes("import 边界自检通过"), `合法沙盒应给出通过结论:${result.output}`);
      });
      // 5b. renderer 反向 type-only 引 main → 必须判红。
      // (REF-025 #03:放行机制已整体删除,原先这条是唯一的放行条目、判绿。
      //  现在 renderer→main 是**绝对**禁止 —— type-only 也不例外,因为编译期擦除
      //  只能证明产物无此依赖,不能证明层向本身合理。)
      await s.case("5b renderer 反向 type-only 引 main → 必须判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "renderer/renderer.ts": 'import type { PreloadApi } from "../main/preload.cjs";\nexport type { PreloadApi };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(result, /renderer\/renderer\.ts:type-only import「\.\.\/main\/preload\.cjs」违反层向规则 renderer-no-main/, "renderer 反向 type-only 引 main");
      });
      // 5b-2. 同一方向改成运行时 import → 同样判红(证明规则不因 type-only 而放松)
      await s.case("5b-2 同一方向改成运行时 import → 同样判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "renderer/renderer.ts": 'import { api } from "../main/preload.cjs";\nexport { api };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(result, /renderer\/renderer\.ts:import「\.\.\/main\/preload\.cjs」违反层向规则 renderer-no-main/, "renderer 反向运行时引 main");
      });
      // 5c. 未知 devDependency 的 @types 缺失时,type-only 判定不被 devDependencies 段掩盖
      await s.case("5c 未知 devDependency 的 @types 缺失时,type-only 判定不被 devDependencies 段掩盖", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "core/docx/ctx.ts": 'import type { X } from "docx";\nexport type { X };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(result.code === 0, `已声明包的 type-only import 应放行,实际 ${result.code}:${result.output}`);
      });
      // 5d. main → renderer 跨层引用必须判红(层向规则 main-no-renderer,补上此前只靠约定的方向)
      await s.case("5d main → renderer 跨层引用必须判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "main/ipc/logic.ts": 'import { el } from "../../renderer/dom/refs.js";\nexport { el };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /main\/ipc\/logic\.ts:import「\.\.\/\.\.\/renderer\/dom\/refs\.js」违反层向规则 main-no-renderer/,
          "main 反向依赖 renderer",
        );
      });
      // 5e. smoke 引入 test/ 必须判红(层向规则 smoke-no-test-import:打包产物只收 dist/**)
      await s.case("5e smoke 引入 test/ 必须判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "main/smoke.ts": 'import { x } from "../../test/common/assert.js";\nexport { x };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /main\/smoke\.ts:import「\.\.\/\.\.\/test\/common\/assert\.js」违反层向规则 smoke-no-outside-src/,
          "smoke 逃出 src/(引入 test/)",
        );
      });
      // 5f. 冒烟正文自身合法(经 main/core 取依赖、只 import 内建与已声明包)不得被新规则误伤
      await s.case("5f 冒烟正文自身合法(经 main/core 取依赖、只 import 内建与已声明包)不得被新规则误伤", async () => {
        const sb = createSandbox(
          { dependencies: { "pdf-lib": "1.17.1" }, devDependencies: { electron: "43.0.0" } },
          {
            "main/smoke.ts":
              'import { app } from "electron";\nimport fs from "node:fs/promises";\nimport { PDFDocument } from "pdf-lib";\nexport { app, fs, PDFDocument };\n',
          },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(result.code === 0, `合法的 smoke 依赖图应零退出,实际 ${result.code}:${result.output}`);
      });
      // 5g. renderer 基础层反向依赖功能目录必须判红
      // (REF-025 #13:实测 convert/settings/ui/wizard 两两互依、无法约束方向,但基础层
      //  dom/ 与 state/ 在全部 29 条目录边中无任何出边 —— 那条才是真不变量)
      await s.case("5g renderer 基础层反向依赖功能目录必须判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "renderer/state/pure.ts": 'import { el } from "../ui/dom-ops.js";\nexport { el };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /renderer\/state\/pure\.ts:import「\.\.\/ui\/dom-ops\.js」违反层向规则 renderer-foundation-no-feature-dep/,
          "renderer 基础层反向依赖功能目录",
        );
      });
      // 5h. 边界:基础层唯一合法的向上逃逸是 ../../core/(跨进程契约单源),不得被 5g 误伤
      await s.case("5h 边界:基础层唯一合法的向上逃逸是 ../../core/", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          {
            "renderer/state/state.ts":
              'import { DEFAULT_SETTINGS } from "../../core/settings/settings-defaults.js";\nexport { DEFAULT_SETTINGS };\n',
            "renderer/dom/refs.ts": 'export const el = null;\n',
          },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(result.code === 0, `基础层引 core 应放行,实际 ${result.code}:${result.output}`);
      });
      // 5i. core/pdf 直接 import node:fs 必须判红(REF-025 #07 的新规则 core-pdf-no-fs)。
      // 此前 core/pdf/katex-css.ts 直接引 readFileSync,使「core 的 pdf 渲染路径不做
      // 文件 IO」只能是约定;能力改为经 RenderPdfHtmlOptions.fs 注入后,这条可门禁强制。
      await s.case("5i core/pdf 直接 import node:fs 必须判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "core/pdf/katex-css.ts": 'import { readFileSync } from "node:fs";\nexport { readFileSync };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /core\/pdf\/katex-css\.ts:import「node:fs」违反层向规则 core-pdf-no-fs/,
          "core/pdf 直接 import node:fs",
        );
      });
      // 5j. node:fs/promises 同样判红。夹具刻意用**白名单内**的文件名
      // (core/pdf/katex-css.ts):若用未登记的文件,它会被「core 未登记 node:」那条
      // 规则先判红,本规则是否生效就被掩盖了。
      await s.case("5j node:fs/promises 同样判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "core/pdf/katex-css.ts": 'import { readFile } from "node:fs/promises";\nexport { readFile };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /core\/pdf\/katex-css\.ts:import「node:fs\/promises」违反层向规则 core-pdf-no-fs/,
          "core/pdf 直接 import node:fs/promises",
        );
      });
      // 5k. 边界:core/pdf 里的 node:url / node:path 是纯字符串运算(转 file://、
      // 字体路径绝对化),不得被 core-pdf-no-fs 误伤 —— 这条规则只禁「真做 IO」的
      // node:fs 与 node:fs/promises,不按前缀一刀切。
      await s.case("5k 边界:core/pdf 里的 node:url / node:path 是纯字符串运算", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          {
            "core/pdf/rules/image.ts": 'import { pathToFileURL } from "node:url";\nexport { pathToFileURL };\n',
            "core/pdf/katex-css.ts": 'import path from "node:path";\nexport { path };\n',
          },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(
          result.code === 0,
          `core/pdf 的 node:url / node:path 是纯字符串运算,应放行,实际 ${result.code}:${result.output}`,
        );
      });
      // 5l. convert 装配层反向依赖 main → 必须判红(ADR-060 的 convert-no-gui)。
      // 夹具刻意用**值导入**(不是 import type):main/persist/settings 是 app.getPath
      // 的持有者,值导入才真的把 Electron 拖进 headless 装配层。
      await s.case("5l convert 装配层反向依赖 main → 必须判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "convert/single.ts": 'import { loadSettings } from "../main/persist/settings.js";\nexport { loadSettings };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /convert\/single\.ts:import「\.\.\/main\/persist\/settings\.js」违反层向规则 convert-no-gui/,
          "convert 装配层反向依赖 main",
        );
      });
      // 5m. convert 反向依赖 renderer → 同样判红(与 5l 分开是因为两个目标层的
      // 失败原因不同,合成一条会让「layer: 列表漏了一个」退化成看不出是哪侧漏放行)
      await s.case("5m convert 反向依赖 renderer → 同样判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "convert/single.ts": 'import { el } from "../renderer/dom/refs.js";\nexport { el };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /convert\/single\.ts:import「\.\.\/renderer\/dom\/refs\.js」违反层向规则 convert-no-gui/,
          "convert 装配层反向依赖 renderer",
        );
      });
      // 5n. cli 引用 renderer → 必须判红(ADR-060 的 faces-no-renderer;scope 是跨 cli/mcp 两面的
      // delivery-faces 形态,故 mcp 侧由 5n-2 承担对等锚点)
      await s.case("5n cli 引用 renderer → 必须判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "cli/index.ts": 'import { el } from "../renderer/dom/refs.js";\nexport { el };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /cli\/index\.ts:import「\.\.\/renderer\/dom\/refs\.js」违反层向规则 faces-no-renderer/,
          "cli 引用 renderer",
        );
      });
      // 5n-2. mcp 侧对等锚点:与 5n 分开是因为两个面的失败原因不同(各自命中 delivery-faces 的
      // 不同前缀),合成一条会让「某个前缀漏进 scope 列表」退化成看不出是哪侧漏放行
      await s.case("5n-2 mcp 侧对等锚点:与 5n 分开是因为两个面的失败原因不同", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "mcp/index.ts": 'import { el } from "../renderer/dom/refs.js";\nexport { el };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /mcp\/index\.ts:import「\.\.\/renderer\/dom\/refs\.js」违反层向规则 faces-no-renderer/,
          "mcp 引用 renderer",
        );
      });
      // 5p. cli import electron → 判红(两个交付面都必须跑在纯 node 下;宿主能力靠子进程重入)
      await s.case("5p cli import electron → 判红", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "cli/index.ts": 'import { app } from "electron";\nexport { app };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /cli\/index\.ts:import「electron」违反层向规则 faces-no-host/,
          "cli import electron",
        );
      });
      // 5p-2. mcp 侧对等锚点:同一条 faces-no-host 在 mcp/ 前缀上同样生效
      await s.case("5p-2 mcp 侧对等锚点:同一条 faces-no-host 在 mcp/ 前缀上同样生效", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "mcp/index.ts": 'import { app } from "electron";\nexport { app };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /mcp\/index\.ts:import「electron」违反层向规则 faces-no-host/,
          "mcp import electron",
        );
      });
      // 5q. cli 逃出 src/(../../ 形态)→ 判红。刻意用 test/ 而非 shared/:
      // layer: 形态解析后首段是「..」,这类边正是 layer: 抓不到、只有 prefix: 能抓的
      await s.case("5q cli 逃出 src/", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "cli/index.ts": 'import { x } from "../../test/common/paths.js";\nexport { x };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /cli\/index\.ts:import「\.\.\/\.\.\/test\/common\/paths\.js」违反层向规则 faces-no-outside-src/,
          "cli 逃出 src/",
        );
      });
      // 5q-2. mcp 侧对等锚点:faces-no-outside-src 在 mcp/ 前缀上同样生效
      await s.case("5q-2 mcp 侧对等锚点:faces-no-outside-src 在 mcp/ 前缀上同样生效", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          { "mcp/index.ts": 'import { x } from "../../test/common/paths.js";\nexport { x };\n' },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /mcp\/index\.ts:import「\.\.\/\.\.\/test\/common\/paths\.js」违反层向规则 faces-no-outside-src/,
          "mcp 逃出 src/",
        );
      });
      // 5o. 正向:convert 引 core(向下)与自身、cli 引 convert(向上)与 core 均合法 ——
      // 若这两条规则的面写错(比如误禁 convert→core 或 core→convert),门禁会在
      // 装配层落地那天判红一片,而那时补规则的成本正是 ADR-060 后果 3 要消灭的那个。
      await s.case("5o 正向:convert 引 core", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          {
            "core/markdown/parse.ts": "export const parse = () => null;\n",
            "convert/paths.ts": 'import { sep } from "node:path";\nexport { sep };\n',
            "convert/single.ts": 'import { parse } from "../core/markdown/parse.js";\nimport { sep } from "./paths.js";\nexport { parse, sep };\n',
            "cli/index.ts": 'import { parse } from "../convert/single.js";\nimport { sep } from "../convert/paths.js";\nexport { parse, sep };\n',
          },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(
          result.code === 0,
          `convert↓core、cli→convert 的合法依赖图不得误伤,实际 ${result.code}:${result.output}`,
        );
      });
      console.log("[ok] import-boundary:正向锚点(合法沙盒零退出 / renderer→main 绝对禁止(含 type-only) / 已声明包的类型引用放行 / main→renderer 跨层引用判红 / smoke 引入 test 判红 / convert 反向依赖 GUI 两层判红 / cli 与 mcp 两个交付面引用 renderer、import electron、逃出 src 均判红 / 合法 smoke、convert→core、cli→convert 依赖图不误伤)");
    });

    // ================= 6. 规则原语的单元断言(判定链的接缝) =================
    await suite.describe("6 规则原语的单元断言(判定链的接缝)", async (s) => {
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

      await s.case("specifier 归类与 packageName 回收", () => {
        for (const [spec, kind] of kinds) {
          assert(classifySpecifier(spec).kind === kind, `specifier「${spec}」应归类为 ${kind},实际 ${classifySpecifier(spec).kind}`);
        }
        assert(classifySpecifier("@mdit/plugin-tasklist").packageName === "@mdit/plugin-tasklist", "scope 包名应保留两段");
        assert(classifySpecifier("highlight.js/lib/common").packageName === "highlight.js", "子路径应回收到宿主包名");
      });

      // type-only 子句判定
      await s.case("type-only 子句判定(五个子句形态)", () => {
        assert(isTypeOnlyClause("type ", "{ A }") === true, "`import type {...}` 应为 type-only");
        assert(isTypeOnlyClause(undefined, "{ type A, type B }") === true, "全 type 说明符应为 type-only");
        assert(isTypeOnlyClause(undefined, "{ a, type B }") === false, "含值绑定应视为运行时");
        assert(isTypeOnlyClause(undefined, "def, { a }") === false, "默认绑定应视为运行时");
        assert(isTypeOnlyClause(undefined, "* as ns") === false, "命名空间绑定应视为运行时");
      });

      await s.case("产物侧抽到 preload.cjs 的 CJS require", () => {
        // 文件事实:preload 产物是 CommonJS(require 而非 import),须被产物侧抽到
        const preloadCjs = path.join(DIST_DIR, "main", "preload.cjs");
        assert(fs.existsSync(preloadCjs), "缺少 dist/main/preload.cjs(本段需在 build 之后运行)");
        const cjsImports = collectImports(preloadCjs, { cjs: true });
        assert(
          cjsImports.some((i) => i.spec === "electron" && i.kind === "bare"),
          "产物侧抽取器未抽到 preload.cjs 的 require(\"electron\")(cjs 抽取失效)",
        );
      });
      console.log("[ok] import-boundary:规则原语断言通过(specifier 归类 / type-only 判定 / CJS require 抽取)");
    });

    // ================= (7) 树边界规则(ADR-038/043/050):allow-list,四棵树各自的双向锚点 =================
    // 判据形态是 allow-list(允许面外一律判红),与 LAYER_RULES 的 deny-list 语义相反。
    // 各棵树缺一不可 —— selfCheckTreeLayout 要求 scope 目录齐备,否则规则形同虚设会判红,
    // 所以每个沙盒都先铺齐 gates/ test/ shared/ tools/ 四棵空树,再只往目标树里放违规文件。
    await suite.describe("(7) 树边界规则:allow-list,四棵树各自的双向锚点", async (s) => {
      /**
       * 铺一棵三树齐备的沙盒,返回根目录(树扫描锚在 projectRoot,而本段验的是原语,
       * 故直接把树文件铺到沙盒根下,由 analyzeTreeBoundaries / selfCheckTreeLayout 直接消费)。
       * @param {Record<string, string>} files 仓库相对路径 → 文件内容
       * @returns {{ dir: string, srcDir: string, pkgPath: string }} 沙盒坐标
       */
      const treeSandbox = (files) => {
        const sb = createSandbox({ dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } }, {});
        for (const dir of ["gates", "test", "shared", "tools"]) writeFileIn(sb.dir, `${dir}/.keep`, "");
        for (const [relative, content] of Object.entries(files)) writeFileIn(sb.dir, relative, content);
        track(sb.dir);
        return sb;
      };

      // 7a. gates-stay-in-gates:门禁树引 test/ 下非夹具 → 判红并点名文件:行号:规则 id
      await s.case("7a gates-stay-in-gates:门禁树引 test/ 下非夹具 → 判红并点名文件:行号:规则 id", async () => {
        const sb = treeSandbox({ "gates/g.mjs": 'import { x } from "../test/common/thing.js";\nexport { x };\n' });
        const problems = analyzeTreeBoundaries(sb.dir);
        assert(
          problems.some((p) => /gates\/g\.mjs:1:/.test(p) && /违反树边界规则 gates-stay-in-gates/.test(p)),
          `门禁树引 test/ 应判红并点名行号+规则 id,实际:${JSON.stringify(problems)}`,
        );
      });

      // 7b. shared-no-out-edge:共享层引 test/ → 判红(共享层零**跨树**出边)
      await s.case("7b shared-no-out-edge:共享层引 test/ → 判红", async () => {
        const sb = treeSandbox({ "shared/s.mjs": 'import { x } from "../test/common/thing.js";\nexport { x };\n' });
        const problems = analyzeTreeBoundaries(sb.dir);
        assert(
          problems.some((p) => /shared\/s\.mjs:1:/.test(p) && /违反树边界规则 shared-no-out-edge/.test(p)),
          `共享层引 test/ 应判红,实际:${JSON.stringify(problems)}`,
        );
      });

      // 7c. test-stay-in-test:测试树引 src/ → 判红(src 不在测试树允许面内)
      await s.case("7c test-stay-in-test:测试树引 src/ → 判红", async () => {
        const sb = treeSandbox({ "test/t.js": 'import { x } from "../src/core/thing.js";\nexport { x };\n' });
        const problems = analyzeTreeBoundaries(sb.dir);
        assert(
          problems.some((p) => /test\/t\.js:1:/.test(p) && /违反树边界规则 test-stay-in-test/.test(p)),
          `测试树引 src/ 应判红,实际:${JSON.stringify(problems)}`,
        );
      });

      // 7d. 路径段安全:引 test/fixtures-old/ 必须判红 —— 若按 startsWith 匹配会被
      // 允许面 test/fixtures 误放行(这正是把「只写 test/ 就放行整棵测试树」的洞补上)
      //
      // ⚠ 这个负例**刻意仍用 test/fixtures**,不跟着 ADR-062 P3 的 samples/ 搬家走:
      // 它的作用是「证明某个前缀的**同级兄弟**不被 startsWith 误放行」,所以必须紧贴
      // 一个**当前真在允许面里**的前缀。允许面里的 test/fixtures 在 P3 之后已是死条目
      // (实测没有任何 import 说明符指向 samples/ —— 样例是静态数据,230 处消费方全走
      // FIXTURES_DIR 常量)。等 P3 把允许面换成 samples 时,本负例要与之同批改成
      // samples-old。
      await s.case("7d 路径段安全:引 test/fixtures-old/ 必须判红", async () => {
        const sb = treeSandbox({ "gates/g.mjs": 'import { x } from "../test/fixtures-old/thing.js";\nexport { x };\n' });
        const problems = analyzeTreeBoundaries(sb.dir);
        assert(
          problems.some((p) => /fixtures-old/.test(p) && /违反树边界规则 gates-stay-in-gates/.test(p)),
          `引 test/fixtures-old/ 应判红(路径段匹配,不得被 test/fixtures 前缀误放行),实际:${JSON.stringify(problems)}`,
        );
      });

      // 7e. 正向:合法跨树引用一条都不许误伤 ——
      //   shared 树内互依 + node: 内建放行(零**跨树**出边,不是零 import);
      //   测试树引 shared/ 门禁树/ dist 编译产物/ 工具树 tools/ 自身 test/ 均合法
      await s.case("7e 正向:合法跨树引用一条都不许误伤", async () => {
        const sb = treeSandbox({
          "shared/s.mjs":
            'import path from "node:path";\nimport { y } from "./other.mjs";\nexport default [path, y];\n',
          "test/t.js":
            'import { a } from "../shared/s.mjs";\nimport { b } from "../gates/g.mjs";\nimport { c } from "../dist/core/thing.js";\nimport { e } from "../tools/copy-renderer.mjs";\nimport { d } from "./other.js";\nexport default [a, b, c, e, d];\n',
          "gates/g.mjs": 'import { p } from "../shared/paths.js";\nexport { p };\n',
          "shared/other.mjs": "export const y = 1;\n",
        });
        const problems = analyzeTreeBoundaries(sb.dir);
        assert(
          problems.length === 0,
          `合法跨树引用不得误伤,实际判红:${JSON.stringify(problems)}`,
        );
      });

      // 7f. tools-stay-in-tools 负向锚点之一:工具树引测试树 → 判红。
      // 合并前 `tools/` 属 TREE_BOUNDARY_LITERAL_PREFIXES,压根没有规则扫它 —— 这条恒绿。
      await s.case("7f tools-stay-in-tools 负向锚点之一:工具树引测试树 → 判红", async () => {
        const sb = treeSandbox({ "tools/t.mjs": 'import { x } from "../test/common/thing.js";\nexport { x };\n' });
        const problems = analyzeTreeBoundaries(sb.dir);
        assert(
          problems.some((p) => /tools\/t\.mjs:1:/.test(p) && /违反树边界规则 tools-stay-in-tools/.test(p)),
          `工具树引 test/ 应判红并点名行号+规则 id,实际:${JSON.stringify(problems)}`,
        );
      });

      // 7g. tools-stay-in-tools 负向锚点之二:工具树引产品源码 → 判红。
      // 与 7f 分开是因为两个目标树的失败原因不同(越过测试树 vs 越过全部树),
      // 合成一条会让「规则写了但 allow 面写错」退化成看不出是哪一侧漏放行。
      await s.case("7g tools-stay-in-tools 负向锚点之二:工具树引产品源码 → 判红", async () => {
        const sb = treeSandbox({ "tools/t.mjs": 'import { x } from "../src/core/thing.js";\nexport { x };\n' });
        const problems = analyzeTreeBoundaries(sb.dir);
        assert(
          problems.some((p) => /tools\/t\.mjs:1:/.test(p) && /违反树边界规则 tools-stay-in-tools/.test(p)),
          `工具树引 src/ 应判红并点名行号+规则 id,实际:${JSON.stringify(problems)}`,
        );
      });

      // 7h. tools 正向锚点:工具树引 shared/ 与自身均合法(合并后 tools 的出边只有这两类,
      // 若它们哪天被判红则规则面与实际布局脱节,说明 allow 面写窄了)
      await s.case("7h tools 正向锚点:工具树引 shared/ 与自身均合法", async () => {
        const sb = treeSandbox({
          "tools/copy-renderer.mjs":
            'import { isMainModule } from "../shared/cli.mjs";\nimport { ROOT } from "../shared/paths.js";\nexport { isMainModule, ROOT };\n',
          "tools/icon.svg": "<svg/>\n",
        });
        const problems = analyzeTreeBoundaries(sb.dir);
        assert(
          problems.length === 0,
          `工具树引 shared/ 与自身不得误伤,实际判红:${JSON.stringify(problems)}`,
        );
      });

      // 7i. 判据写法自检:各棵树缺一即判红 —— 「扫不到就等于没规则」是最危险的失效形态
      await s.case("7i 判据写法自检:各棵树缺一即判红", async () => {
        const sb = createSandbox({ dependencies: {}, devDependencies: {} }, {});
        writeFileIn(sb.dir, "gates/.keep", "");
        track(sb.dir);
        const layoutProblems = selfCheckTreeLayout(sb.dir);
        assert(
          layoutProblems.length > 0 && layoutProblems.some((p) => /scope 目录不存在/.test(p)),
          `缺 test/ 与 shared/ 时自检必须判红(否则树边界规则形同虚设),实际:${JSON.stringify(layoutProblems)}`,
        );
      });
      console.log("[ok] import-boundary:树边界规则断言通过(四规则负向判红 / 五类合法引用零误伤 / 缺树自检判红)");
    });

    // ================= (8) 层向 allow-list:src/ 顶层目录未登记即判红(ADR-060 后果 3)====
    // 与 (7) 的关系:(7) 守仓根四棵树的跨树引用,本组守「src/ 里新增一层会不会没人管」。
    // 层向规则本身是 deny-list,scopeMatches 的兜底只认表里写过的名字 ⇒ 新建顶层目录
    // 不命中任何规则、其反向依赖静默放行。本组断言 allow-list 把这个洞从恒绿变成恒红。
    await suite.describe("(8) 层向 allow-list:src/ 顶层目录未登记即判红", async (s) => {
      // 8a. 真实仓库当前必须全部已登记。目录列举刻意由本段自己读(不经被测实现),
      // 免得「读目录那一步」本身写错时被测实现与本断言一起绿。
      const topDirs = fs
        .readdirSync(SRC_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      const unregistered = topDirs.filter((n) => !SRC_TOP_LAYERS.includes(n));
      await s.case("8a 真实仓库 src/ 顶层目录全部登记(自读目录 + 被测判据)", () => {
        assert(
          unregistered.length === 0,
          `真实仓库 src/ 顶层目录应全部登记,未登记:${unregistered.join(",")}(允许面 ${SRC_TOP_LAYERS.join(",")})`,
        );
        const realProblems = analyzeSrcTopLayers(SRC_DIR);
        assert(
          realProblems.length === 0,
          `真实仓库 src/ 顶层应全部登记在 SRC_TOP_LAYERS,实际 ${realProblems.length} 项:${realProblems.join(" | ")}`,
        );
      });

      await s.case("8b 预登记 ADR-060 规划的 convert 与 cli", () => {
        // 8b. 预登记:ADR-060 规划中的 convert / cli 必须**现在就**在表内 ——
        // allow-list 的价值正在于树落地当天就拦住,落地后再补登记等于给新树发过通行证。
        // 判据写成「在表内」而非「等于 SRC_TOP_LAYERS 的全部取值」,这样将来再加层不必改本断言。
        for (const planned of ["convert", "cli"]) {
          assert(
            SRC_TOP_LAYERS.includes(planned),
            `SRC_TOP_LAYERS 应预登记 ADR-060 规划的 ${planned}/(落地当天即受治理),实际 ${SRC_TOP_LAYERS.join(",")}`,
          );
        }
      });

      // 8c. 反向锚点:合成一棵含未登记顶层 omega/ 的 src 树 → 必须判红并点名 omega。
      // 这是「新树不再静默放行」的可复现证明:同形状的 src/ 只要多一个目录就翻脸。
      await s.case("8c 反向锚点:合成一棵含未登记顶层 omega/ 的 src 树 → 必须判红并点名 omega", async () => {
        const sb = createSandbox({ dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } }, {
          "core/markdown/parse.ts": "export const parse = () => null;\n",
          "omega/x.ts": 'import { app } from "electron";\nexport { app };\n',
        });
        track(sb.dir);
        const problems = analyzeSrcTopLayers(sb.srcDir);
        assert(
          problems.length === 1 && String(problems[0]).includes("omega"),
          `含未登记顶层 omega/ 的合成树必须判红并点名 omega,实际:${JSON.stringify(problems)}`,
        );
        // 8c-2. 同一棵树走 selfCheckTreeLayout(即门禁 main() 的实际路径)也必须判红。
        // 只验 analyzeSrcTopLayers 会漏掉「自检没把这条接进 main()」这种失效。
        const layoutProblems = selfCheckTreeLayout(sb.dir).filter((p) => p.includes("omega"));
        assert(
          layoutProblems.length > 0 && layoutProblems.some((p) => p.startsWith("层向规则自检失守:")),
          `selfCheckTreeLayout 必须对未登记顶层判红(前缀为层向,不得借用树边界前缀),实际:${JSON.stringify(layoutProblems)}`,
        );
      });

      // 8d. 只差一个已登记目录的正向对照:同一形状但顶层全部已登记 → 零判红
      await s.case("8d 只差一个已登记目录的正向对照:同一形状但顶层全部已登记 → 零判红", async () => {
        const sb = createSandbox({ dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } }, {
          "core/markdown/parse.ts": "export const parse = () => null;\n",
          "convert/single.ts": 'import { parse } from "../core/markdown/parse.js";\nexport { parse };\n',
          "cli/index.ts": 'import { parse } from "../convert/single.js";\nexport { parse };\n',
        });
        track(sb.dir);
        const problems = analyzeSrcTopLayers(sb.srcDir);
        assert(problems.length === 0, `已登记的顶层目录不得误伤,实际判红:${JSON.stringify(problems)}`);
      });

      // 8e. 只数目录:src 顶层的普通文件(.gitkeep 之类)不是一层,计入即恒红
      await s.case("8e 只数目录:src 顶层的普通文件", async () => {
        const sb = createSandbox({ dependencies: {}, devDependencies: {} }, {});
        writeFileIn(sb.srcDir, ".gitkeep", "");
        track(sb.dir);
        const problems = analyzeSrcTopLayers(sb.srcDir);
        assert(problems.length === 0, `src/ 顶层的普通文件不该被当成未登记层,实际判红:${JSON.stringify(problems)}`);
      });

      await s.case("8f 判据原语两个方向(已登记零命中 / 未登记命中)", () => {
        // 8f. 判据原语的两个方向(恒绿 / 恒红都是失效,各自钉一个用例)
        assert(
          findUnregisteredSrcLayers(["core", "main", "renderer"]).length === 0,
          "已登记的顶层目录应零命中",
        );
        assert(
          findUnregisteredSrcLayers(["omega"]).length === 1,
          "未登记的顶层目录应命中(漏检即恒绿,正是本条要消灭的失效形态)",
        );
      });

      // 8g. 真实仓库的树布局自检必须整体零问题(含门禁自身的层向自检夹具)
      await s.case("8g 真实仓库的树布局自检零问题", () => {
        const realLayout = selfCheckTreeLayout(ROOT);
        assert(
          realLayout.length === 0,
          `真实仓库自检应零问题,实际 ${realLayout.length} 项:${realLayout.slice(0, 3).join(" | ")}`,
        );
      });
      console.log("[ok] import-boundary:层向 allow-list 断言通过(真实 src 零未登记 / 预登记 convert 与 cli / 含 omega/ 的合成树判红并点名 / 已登记与纯文件不误伤 / 真实仓库自检零问题)");
    });

    // ============ (9) 层向文本判据的两条新规则 + 产物侧判红方向(ADR-060 第 9 / 第 4 条)============
    // 与 (5) 的分工:(5) 验「import 了什么」,本组验「文件里出现了什么」。判据形态不同
    // (LAYER_RULES 走 specifier,LAYER_TEXT_RULES 走抹注释后的源码文本),故分表(理由见
    // 被测模块里两张表的分表注释)。它们守的是 ADR-060 第 9 条那四条跨平台期权里**尚未
    // 被任何规则覆盖**的两条:不 import app.getPath · 不引入 Windows 专属 API。
    //
    // 每条新规则都按「构造 ⇒ 判红 ⇒ **撤回 ⇒ 复绿**」四步走完,不是只跑红支:
    // 只做到红支证明的是「判红存在」,补上复绿才排除「它红得像样但理由是别的」。
    // 9c 另证伪「--flavor dist 是死代码 / 恒绿」——(2) 与 (3) 只跑过真实 dist 的绿支。
    await suite.describe("(9) 层向文本判据的两条新规则 + 产物侧判红方向", async (s) => {
      await s.case("9a 两条文本判据都在表内且 scope 为 headless-faces", () => {
        // 9a. 规则表形态:两条文本判据都在,且 scope 覆盖新层三棵树
        for (const id of ["headless-no-app-getpath", "headless-no-windows-only"]) {
          assert(
            LAYER_TEXT_RULES.some((r) => r.id === id),
            `层向文本判据表缺 ${id}`,
          );
        }
        for (const id of ["headless-no-app-getpath", "headless-no-windows-only"]) {
          const rule = LAYER_TEXT_RULES.find((r) => r.id === id);
          assert(rule !== undefined && rule.scope === "headless-faces", `${id} 的 scope 应是 headless-faces`);
        }
      });

      // 9b. 两条新规则的双向探针(红 → 撤回 → 绿)。
      // 夹具刻意用**真实命名形态**(convert/paths.ts、cli/options.ts…):判据按相对路径
      // 前缀匹配 scope,换个假名字就测不到「这个 scope 到底覆不覆盖这棵树」。
      // 撤回步只改那一个文件里的一行,其余字节不动 —— 复绿因此只能由「撤回」解释。
      /** @type {{ label: string; pkg: unknown; violating: Record<string, string>; legal: Record<string, string>; pattern: RegExp }[]} */
      const textCases = [
        {
          label: "新层向宿主问路径(app.getPath)",
          pkg: { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          violating: {
            "convert/paths.ts": 'import { app } from "electron";\nexport const dir = app.getPath("userData");\n',
          },
          // 撤回:路径改为入参(ADR-060 的四个注入点之一),同时 electron 的 import 一并撤掉
          legal: {
            "convert/paths.ts": "export function dir(injected: string): string {\n  return injected;\n}\n",
          },
          pattern: /convert\/paths\.ts:2 调用 Electron app 的路径解析「app\.getPath\(」违反层向规则 headless-no-app-getpath/,
        },
        {
          label: "新层读 Windows 专属环境变量(%APPDATA%)",
          pkg: { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          violating: {
            "cli/options.ts": 'export const base = process.env.APPDATA;\n',
          },
          // 撤回:换成跨平台存在的 os.homedir()(POSIX 与 macOS 都有 HOME)
          legal: {
            "cli/options.ts": 'import os from "node:os";\nexport const base = os.homedir();\n',
          },
          pattern: /cli\/options\.ts:1 读 Windows 专属环境变量「APPDATA」违反层向规则 headless-no-windows-only/,
        },
      ];
      // 每条新规则一个 case:两条规则的构造/撤回夹具彼此独立,
      // 合成一条会让「哪条规则的四步探针断在哪一步」退化成只看第一条诊断
      for (const item of textCases) {
        await s.case(`9b 双向探针(红 → 撤回 → 绿):${item.label}`, async () => {
          // 构造 ⇒ 判红
          const bad = createSandbox(item.pkg, item.violating);
          track(bad.dir);
          const redResult = await runCli(["--src", bad.srcDir, "--package", bad.pkgPath]);
          assertFailure(redResult, item.pattern, `${item.label}(构造后)`);
          // 撤回 ⇒ 复绿(同形状沙盒,只把那一个文件换成合法写法)
          const good = createSandbox(item.pkg, item.legal);
          track(good.dir);
          const greenResult = await runCli(["--src", good.srcDir, "--package", good.pkgPath]);
          assert(
            greenResult.code === 0,
            `${item.label} 撤回后必须复绿,实际 ${greenResult.code}:${greenResult.output}`,
          );
          // 结论行本身会提到两条新规则的 id(那是覆盖度的声明,不是判红),
          // 故此处只能按 [boundary:fail] 行判 —— 否则这条断言恒红。
          assert(
            !greenResult.output.includes("[boundary:fail]"),
            `撤回后不得有任何 boundary:fail 行:${greenResult.output}`,
          );
        });
      }

      // 9b-2. 合法形态必须绿(正向锚点:否则上面的红可能只是「脚本跑不起来」)
      // 刻意放四种跨平台正当写法:POSIX 环境变量、非 Windows 子进程、platform 守卫、
      // 以及 core 里正当的 Windows 语义(image-path-policy 的符号链接逃逸判定,
      // ADR-012 的承重逻辑 —— 判据按层而非按全仓施加就是为了不误伤它)。
      await s.case("9b-2 合法形态必须绿(正向锚点:否则上面的红可能只是「脚本跑不起来」)", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } },
          {
            "cli/options.ts": 'export const home = process.env.HOME;\n',
            "convert/run.ts": 'import { spawnSync } from "node:child_process";\nexport const r = spawnSync("git", ["status"]);\nif (process.platform === "win32") console.log(r);\n',
            "core/image/image-path-policy.ts": 'import path from "node:path";\nexport const abs = path.win32.isAbsolute("C:/x");\n',
            // 说明性注释里出现 app.getPath 不得判红(它是纪律的书面来源,不是违反)
            "convert/delivery-settings.ts": "/**\n * GUI 的 loadSettings 经 app.getPath(\"userData\"),需 Electron 宿主。\n */\nexport const n = 1;\n",
          },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(result.code === 0, `四种跨平台正当写法不得误伤,实际 ${result.code}:${result.output}`);
      });

      await s.case("9b-3 原语级双向断言(三棵新层树各自有牙齿 / 作用域对照)", () => {
        // 9b-3. 原语级双向断言(不经 CLI):把「撤回后复绿」也钉在被测原语上,
        // 使 CLI 层将来若换了通路,这一层仍然独立地证明规则有牙齿。
        for (const file of ["convert/paths.ts", "cli/options.ts", "mcp/tools.ts"]) {
          assert(
            findTextLayerViolations('const dir = app.getPath("userData");\n', file).length === 1,
            `原语层:${file} 里的 app.getPath 应命中一次(漏检即恒绿,正是本条要消灭的失效形态)`,
          );
          assert(
            findTextLayerViolations("const dir = injectedDir;\n", file).length === 0,
            `原语层:${file} 里的合法写法应零命中(恒红同样是失效)`,
          );
        }
        // 作用域对照:同一条形态在 main/ 判绿(main 层有正当的 app.getPath 用途)
        assert(
          findTextLayerViolations('const p = app.getPath("userData");\n', "main/persist/settings.ts").length === 0,
          "main 层不受 headless 文本判据约束(main 层有正当的 app.getPath 用途)",
        );
      });

      // 9c. 产物侧判红方向:证伪「--flavor dist 是死代码 / 恒绿」。
      // (2)(3) 只跑真实 dist 的绿支,恒绿与「有判据但从不变红」在这两处不可区分。
      // 三条夹具分别覆盖 dist 侧独有的两种可见性:cjs 的 require() 形态、
      // .js 产物里被擦除的类型、以及两条新规则在产物形态下同样生效。
      /** @type {{ label: string; files: Record<string, string>; pattern: RegExp }[]} */
      const distRedCases = [
        {
          // cjs require:这条形态**只在** dist 侧可见(src 侧 .cts 的 import 写法
          // 与 .cjs 的 require 写法在 FROM_RE/REQUIRE_RE 里走两条正则),故它是
          // 「--flavor dist 不是 src 的同义词」最直接的机械证据。
          label: "产物侧 preload.cjs 以 require 反向引用 main",
          files: { "main/preload.cjs": 'const logic = require("../main/ipc/logic.js");\nexport { logic };\n' },
          pattern: /main\/preload\.cjs:import「\.\.\/main\/ipc\/logic\.js」违反层向规则 preload-no-main/,
        },
        {
          // 产物侧 import(非 cjs)形态的反向引用
          label: "产物侧 renderer/index.js 反向引用 main",
          files: { "renderer/index.js": 'import { x } from "../main/ipc/channels.js";\nexport { x };\n' },
          pattern: /renderer\/index\.js:import「\.\.\/main\/ipc\/channels\.js」违反层向规则 renderer-no-main/,
        },
        {
          // 两条新规则在产物形态下同样生效(compiled JS 里注释被 tsc 剥掉,
          // 故这里不存在「注释遮罩救了它」的可能 —— 判红只可能来自真实调用)
          label: "产物侧 convert/paths.js 调 app.getPath",
          files: { "convert/paths.js": 'const dir = app.getPath("userData");\nexport { dir };\n' },
          pattern: /convert\/paths\.js:1 调用 Electron app 的路径解析「app\.getPath\(」违反层向规则 headless-no-app-getpath/,
        },
        {
          label: "产物侧 cli/index.js 以 cmd.exe 为子进程",
          files: { "cli/index.js": 'import { spawnSync } from "node:child_process";\nexport const r = spawnSync("cmd.exe", ["/c", "dir"]);\n' },
          pattern: /cli\/index\.js:2 以 Windows 专属可执行文件为子进程「spawnSync\("cmd\.exe"」违反层向规则 headless-no-windows-only/,
        },
        {
          // 未声明依赖那条也只在产物侧被真实触发(src 侧同一形状由 src 用例覆盖),
          // 证明 --flavor dist 走的是同一套 analyze 而非另一条更松的旁路
          label: "产物侧运行时 import 只在 devDependencies",
          files: { "convert/docx.js": 'import JSZip from "jszip";\nexport { JSZip };\n' },
          pattern: /convert\/docx\.js:运行时 import「jszip」只在 devDependencies 中声明/,
        },
      ];
      // 产物侧五条漂移各自一个 case:每条只在一侧可见(见各条注释),
      // 合成一条会让「哪条产物形态其实没被 --flavor dist 判到」看不出来
      for (const item of distRedCases) {
        await s.case(`9c 产物侧判红(--flavor dist):${item.label}`, async () => {
          const sb = createSandbox({ dependencies: {}, devDependencies: { electron: "43.0.0", jszip: "3.10.1" } }, item.files);
          track(sb.dir);
          const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath, "--flavor", "dist"]);
          assertFailure(result, item.pattern, `${item.label}(--flavor dist)`);
        });
      }

      // 9c-2. 产物侧的**撤回 ⇒ 复绿**:与 9c 同一形状的合法产物树必须零退出。
      // 缺这一步,9c 的红仍可能是「--flavor dist 恒红」而非「它真的在判这条」。
      // 与 9c 的沙盒逐项对照,只把「触发判红的那一处」换成合法形态(jszip 移进
      // dependencies —— 9c 最后一条正是拿它判红的,撤它就得连声明一起撤)。
      await s.case("9c-2 产物侧的撤回 ⇒ 复绿:与 9c 同一形状的合法产物树必须零退出", async () => {
        const sb = createSandbox(
          { dependencies: { docx: "9.0.0", jszip: "3.10.1" }, devDependencies: { electron: "43.0.0" } },
          {
            "main/preload.cjs": 'import { app } from "electron";\nexport { app };\n',
            "renderer/index.js": 'import { x } from "../core/preload-api.js";\nexport { x };\n',
            "convert/paths.js": "export function dir(injected) {\n  return injected;\n}\n",
            "cli/index.js": 'import { spawnSync } from "node:child_process";\nexport const r = spawnSync("git", ["status"]);\n',
            "convert/docx.js": 'import JSZip from "jszip";\nexport { JSZip };\n',
          },
        );
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath, "--flavor", "dist"]);
        assert(result.code === 0, `合法产物树在 --flavor dist 下必须零退出,实际 ${result.code}:${result.output}`);
        assert(result.output.includes("import 边界自检通过(dist 产物)"), `合法产物树应给出产物面通过结论:${result.output}`);
      });

      await s.case("9d 门禁本体的双向自检零问题", () => {
        // 9d. 门禁本体的双向自检必须零问题(它的夹具含 7 红 7 绿,恒绿或恒红都会在这里失守)
        const textSelfCheck = selfCheckTextLayerRules();
        assert(
          textSelfCheck.length === 0,
          `层向文本判据自检应零问题,实际 ${textSelfCheck.length} 项:${textSelfCheck.join(" | ")}`,
        );
      });

      // 9e. 真实仓库的新层当前零命中(独立于 CLI:这一条证明门禁没把已收口的代码误判红)
      await s.case("9e 真实仓库的新层当前零命中", async () => {
        /** @type {{ line: number, id: string, reason: string, what: string }[]} */
        const realHits = [];
        for (const dir of ["convert", "cli", "mcp"]) {
          const abs = path.join(SRC_DIR, dir);
          const walk = (/** @type {string} */ cur) => {
            for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
              const child = path.join(cur, entry.name);
              if (entry.isDirectory()) walk(child);
              else if ([".ts", ".cts"].includes(path.extname(entry.name))) {
                const rel = path.relative(SRC_DIR, child).split(path.sep).join("/");
                realHits.push(...findTextLayerViolations(fs.readFileSync(child, "utf8"), rel));
              }
            }
          };
          if (fs.existsSync(abs)) walk(abs);
        }
        assert(
          realHits.length === 0,
          `真实 src 新层(convert/cli/mcp)应零命中两条新判据,实际 ${realHits.length} 处:`
            + realHits.slice(0, 3).map((h) => `${h.id}@${h.line}`).join(" | "),
        );
      });

      await s.case("9f 两张 Windows 专属清单的事实钉住", () => {
        // 9f. 清单本身的事实钉住:Windows 专属环境变量清单不得为空、不得含 POSIX 也有的名字
        // (清单写错一个名字就是恒绿或误伤,而清单是判据的分母,须在段内可见)
        assert(
          WINDOWS_ONLY_ENV_VARS.includes("APPDATA") && WINDOWS_ONLY_ENV_VARS.includes("LOCALAPPDATA"),
          "Windows 环境变量清单应含 APPDATA 与 LOCALAPPDATA(它们是 Windows 独有的用户目录变量)",
        );
        assert(
          !WINDOWS_ONLY_ENV_VARS.some((name) => ["HOME", "TMPDIR", "PATH", "USER", "SHELL", "PWD"].includes(name)),
          "Windows 环境变量清单不得含 POSIX/macOS 同样存在的变量(否则新层的跨平台正当写法会被判红)",
        );
        assert(WINDOWS_ONLY_EXECUTABLES.includes("cmd"), "可执行文件清单应含 cmd");
        assert(
          !WINDOWS_ONLY_EXECUTABLES.some((name) => ["git", "node", "sh", "bash", "python"].includes(name)),
          "可执行文件清单不得含跨平台都有的程序名",
        );
      });
      console.log(
        "[ok] import-boundary:层向文本判据双向探针通过"
        + "(app.getPath 与 Windows 专属 API 各一条:构造判红 / 撤回复绿 / 正向锚点不误伤 / 原语级有牙齿;"
          + `--flavor dist 五条产物侧判红(cjs require、.js 反向引用、两条新规则、未声明依赖)+ 合法产物树复绿;`
          + "门禁自检零问题;真实新层零命中;清单事实钉住)",
      );
    });

    // ============ (10) convert 层的前两条跨平台期权(ADR-060 第 9 条的第 1、2 项)============
    // (9) 补的是第 3、4 项(app.getPath / Windows 专属 API),作用于新层三层;本组补第 1、2 项
    // (不 import electron / 不解析仓库路径)在 **convert** 这一层的剩余缺口 ——
    // 既有 faces-no-host 与 faces-no-outside-src 的 scope 是 delivery-faces(= cli + mcp),
    // 不含 convert,而 convert-no-gui 只禁 layer:main,renderer。两项在 convert 上此前零覆盖。
    //
    // 每条同样跑满「构造 ⇒ 判红 ⇒ 撤回 ⇒ 复绿」,并各配正向锚点。
    await suite.describe("(10) convert 层的前两条跨平台期权", async (s) => {
      const PKG_BOTH = { dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } };

      await s.case("10a 两条规则的表形态:forbid 与 scope 都钉住", () => {
        // 10a. 规则表形态:两条都在,且 forbid 形态与 reason 的关键约束钉住
        for (const id of ["convert-no-host", "convert-no-outside-src"]) {
          assert(LAYER_RULES.some((r) => r.id === id), `层向规则表缺 ${id}`);
        }
        assert(
          LAYER_RULES.find((r) => r.id === "convert-no-host")?.forbid === "bare:electron",
          "convert-no-host 的 forbid 应是 bare:electron",
        );
        // forbid 形态钉住:convert-no-outside-src 用 layer:..(按解析结果判、深度无关),
        // 不是 prefix:../../。10c 用机械证据说明为什么 —— 那条断言在 prefix: 形态下会失败。
        assert(
          LAYER_RULES.find((r) => r.id === "convert-no-outside-src")?.forbid === "layer:..",
          "convert-no-outside-src 的 forbid 应是 layer:..(prefix:../../ 在子目录里会误报合法的 ../../core/)",
        );
        // 无重复表达:本组两条只作用于 convert,不得顺带管到 cli/mcp
        // (那两侧已由 faces-no-host / faces-no-outside-src 以更贴切的 id 表达;
        //  同一事实两条规则各有一个可改 id,正是两份可漂移的副本)
        for (const id of ["convert-no-host", "convert-no-outside-src"]) {
          const rule = LAYER_RULES.find((r) => r.id === id);
          assert(rule !== undefined && rule.scope === "convert", `${id} 的 scope 应是 convert(不得复用 headless-faces/delivery-faces)`);
        }
      });

      // 10b. convert-no-host:构造 ⇒ 判红 ⇒ 撤回 ⇒ 复绿
      await s.case("10b convert-no-host:构造 ⇒ 判红 ⇒ 撤回 ⇒ 复绿", async () => {
        // 构造:值导入(不是 import type)—— type-only 也判红,但值导入才真的把宿主拖进装配层
        const bad = createSandbox(PKG_BOTH, {
          "convert/paths.ts": 'import { app } from "electron";\nexport const dir = app.getPath("userData");\n',
        });
        track(bad.dir);
        const red = await runCli(["--src", bad.srcDir, "--package", bad.pkgPath]);
        assertFailure(red, /convert\/paths\.ts:import「electron」违反层向规则 convert-no-host/, "convert import electron(构造后)");
        // 撤回:改为注入目录,electron 的 import 一并撤掉
        const good = createSandbox(PKG_BOTH, {
          "convert/paths.ts": "export function dir(injected: string): string {\n  return injected;\n}\n",
        });
        track(good.dir);
        const green = await runCli(["--src", good.srcDir, "--package", good.pkgPath]);
        assert(green.code === 0, `convert-no-host 撤回后必须复绿,实际 ${green.code}:${green.output}`);
        assert(!green.output.includes("[boundary:fail]"), `撤回后不得有 fail 行:${green.output}`);
      });
      // 10b-2. type-only 同样判红:证明规则不因类型擦除而放松(与 renderer-no-main 同一纪律)
      await s.case("10b-2 type-only 同样判红:证明规则不因类型擦除而放松", async () => {
        const bad = createSandbox(PKG_BOTH, {
          "convert/context.ts": 'import type { App } from "electron";\nexport type { App };\n',
        });
        track(bad.dir);
        const red = await runCli(["--src", bad.srcDir, "--package", bad.pkgPath]);
        assertFailure(
          red,
          /convert\/context\.ts:type-only import「electron」违反层向规则 convert-no-host/,
          "convert type-only import electron",
        );
      });

      // 10c. convert-no-outside-src:构造 ⇒ 判红 ⇒ 撤回 ⇒ 复绿
      await s.case("10c convert-no-outside-src:构造 ⇒ 判红 ⇒ 撤回 ⇒ 复绿", async () => {
        const bad = createSandbox(PKG_BOTH, {
          "convert/paths.ts": 'import { x } from "../../test/common/paths.js";\nexport { x };\n',
        });
        track(bad.dir);
        const red = await runCli(["--src", bad.srcDir, "--package", bad.pkgPath]);
        assertFailure(
          red,
          /convert\/paths\.ts:import「\.\.\/\.\.\/test\/common\/paths\.js」违反层向规则 convert-no-outside-src/,
          "convert 逃出 src/(构造后)",
        );
        // 撤回:改为合法的向下引用
        const good = createSandbox(PKG_BOTH, {
          "convert/paths.ts": 'import { convert } from "../core/convert.js";\nexport { convert };\n',
        });
        track(good.dir);
        const green = await runCli(["--src", good.srcDir, "--package", good.pkgPath]);
        assert(green.code === 0, `convert-no-outside-src 撤回后必须复绿,实际 ${green.code}:${green.output}`);
      });

      // 10c-2. 形态选择的机械证据:layer:.. 按**解析结果**判,prefix:../../ 按**字面前缀**判。
      // 同一段源码(`../../core/x` 从 <层>/sub/ 出发,解析后落在 src/core/,是合法的),
      // 在 convert 与 cli 两侧**都判绿**。
      //
      // ⚠ 这里原先断言的是「cli 侧判红」,那是 prefix:../../ 形态的**误报**被当成证据:
      // faces-no-outside-src 与 smoke-no-outside-src 已改成 layer:..(ADR-064 结清的预登记债),
      // 于是同一段合法的 `../../core/x` 不再被报出。**这正是那次改写的收益** ——
      // 原来误报、现在不报,一个随目录生长而误报的判据是负资产。
      // 本条现在的守护对象没变,只是极性翻转:它证明判据确实按**解析结果**而不是
      // **字面前缀**判。若将来有人把 forbid 改回 prefix:../../,本条会先红(误报回来),
      // 而不是等到 cli/mcp 长出子目录那天误报真代码。
      // 10a 另有三条规则的 forbid 形态断言把「同形」这件事钉在表上,不依赖本条的运行结果。
      await s.case("10c-2 形态选择的机械证据:layer:.. 按解析结果判,prefix:../../ 按字面前缀判", async () => {
        const deep = createSandbox(PKG_BOTH, {
          "convert/sub/deep.ts": 'import { convert } from "../../core/convert.js";\nexport { convert };\n',
        });
        track(deep.dir);
        const inConvert = await runCli(["--src", deep.srcDir, "--package", deep.pkgPath]);
        assert(
          inConvert.code === 0,
          `convert/sub/ 里解析后落在 src/core 的 ../../core/ 是合法的,不得误报,实际 ${inConvert.code}:${inConvert.output}`,
        );
        assert(
          !inConvert.output.includes("[boundary:fail]"),
          `convert/sub/ 的合法引用不得产生任何 fail 行:${inConvert.output}`,
        );
        // 同形对照:同一段放到 cli/sub/ 下同样判绿 —— prefix: 形态下它会被误报,layer: 形态下不报
        const asFace = createSandbox(PKG_BOTH, {
          "cli/sub/deep.ts": 'import { convert } from "../../core/convert.js";\nexport { convert };\n',
        });
        track(asFace.dir);
        const inFace = await runCli(["--src", asFace.srcDir, "--package", asFace.pkgPath]);
        assert(
          inFace.code === 0,
          `cli/sub/ 里解析后落在 src/core 的 ../../core/ 是合法的,layer: 形态不得误报`
            + `(prefix:../../ 形态下它会被误报,那正是这次改写修掉的误报),实际 ${inFace.code}:${inFace.output}`,
        );
        assert(
          !inFace.output.includes("[boundary:fail]"),
          `cli/sub/ 的合法引用不得产生任何 fail 行:${inFace.output}`,
        );
      });

      // 10c-3. 「逃出 src/」三条规则现已**同形**:一律 layer:..(按解析结果判、深度无关)。
      // convert-no-outside-src 本来就是 layer:..;faces- / smoke- 两条已从 prefix:../../ 改写成
      // layer:..(ADR-064 结清这笔预登记债)。这里把三处的 forbid 逐条钉住,理由与 10c-2 的
      // 运行结果互补:10c-2 证明「layer: 形态不误报」,本条证明「三条都真的是 layer: 形态」——
      // 只钉运行结果的话,有人把某一条悄悄改回 prefix:../../ 而那段源码恰好不在沙盒里,
      // 断言是不会响的。
      await s.case("10c-3 三条逃出 src/ 的判据同形(一律 layer:..)", () => {
        // 10c-3. 「逃出 src/」三条规则现已**同形**:一律 layer:..(按解析结果判、深度无关)。
        // convert-no-outside-src 本来就是 layer:..;faces- / smoke- 两条已从 prefix:../../ 改写成
        // layer:..(ADR-064 结清这笔预登记债)。这里把三处的 forbid 逐条钉住,理由与 10c-2 的
        // 运行结果互补:10c-2 证明「layer: 形态不误报」,本条证明「三条都真的是 layer: 形态」——
        // 只钉运行结果的话,有人把某一条悄悄改回 prefix:../../ 而那段源码恰好不在沙盒里,
        // 断言是不会响的。
        for (const id of ["convert-no-outside-src", "faces-no-outside-src", "smoke-no-outside-src"]) {
          assert(
            LAYER_RULES.find((r) => r.id === id)?.forbid === "layer:..",
            `${id} 的 forbid 应是 layer:..(三条逃出 src/ 的判据现已同形;prefix:../../ 只在扁平单层目录里`
              + `与它等价,目录一旦长出子目录,子目录里合法的 ../../core/x 会被误报)`,
          );
        }
      });

      // 10d. 正向锚点:convert 的三种合法依赖图必须零误伤
      // (向下引 core · 引同层兄弟 · 深层子目录里合法的 ../../core)
      await s.case("10d 正向锚点:convert 的三种合法依赖图必须零误伤", async () => {
        const sb = createSandbox(PKG_BOTH, {
          "core/convert.ts": "export const convert = () => null;\n",
          "convert/paths.ts": 'import { convert } from "../core/convert.js";\nexport { convert };\n',
          "convert/run.ts": 'import { convert } from "./paths.js";\nexport { convert };\n',
          "convert/sub/deep.ts": 'import { convert } from "../../core/convert.js";\nexport { convert };\n',
        });
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(result.code === 0, `convert 的合法依赖图不得误伤,实际 ${result.code}:${result.output}`);
      });

      // 10e. 原语级双向断言:不经 CLI,使「撤回后复绿」也钉在被测原语上。
      // 复用 (4) 组已建的沙盒助手,写法与该组一致。
      await s.case("10e 原语级双向断言:不经 CLI,使「撤回后复绿」也钉在被测原语上", async () => {
        const pkg = { dependencies: { docx: "9.0.0" } };
        /** @param {string} spec 相对说明符 */
        const convertProblemsFor = (spec) => {
          const sb = createSandbox(pkg, { "convert/paths.ts": `import { x } from "${spec}";\nexport { x };\n` });
          track(sb.dir);
          return analyze(sb.srcDir, pkg, FLAVORS.src).problems.map(String);
        };
        // 逃逸侧
        assert(
          convertProblemsFor("../../test/common/paths.js").some((p) => /convert-no-outside-src/.test(p)),
          "原语层:convert 逃出 src/ 应报 convert-no-outside-src",
        );
        // 合法侧(恒红同样是失效,故两个方向都要钉)
        assert(
          !convertProblemsFor("../core/convert.js").some((p) => /convert-no-outside-src/.test(p)),
          "原语层:合法的 ../core 不得报 convert-no-outside-src",
        );
      });

      // 10f. 真实仓库:convert 当前零命中本组两条(干净不等于有判据 —— 本组是判据,
      // 这一条只是确认它没把已收口的代码误判红;机械证据在 10b/10c)
      // 一次 analyze 覆盖整个 convert 目录即可,不为每个文件各扫一次。
      await s.case("10f 真实仓库:convert 当前零命中本组两条", async () => {
        const convertDir = path.join(SRC_DIR, "convert");
        assert(fs.existsSync(convertDir), "缺少 src/convert/");
        const relevant = analyze(convertDir, PKG, FLAVORS.src).problems
          .map(String)
          .filter((p) => /convert-no-host|convert-no-outside-src/.test(p));
        assert(
          relevant.length === 0,
          `真实 src/convert 应零命中本组两条判据,实际 ${relevant.length} 处:${relevant.slice(0, 3).join(" | ")}`,
        );
      });
      console.log(
        "[ok] import-boundary:convert 层前两条跨平台期权探针通过"
        + "(convert-no-host:值导入与 type-only 双侧判红 / 撤回复绿;"
          + "convert-no-outside-src:../../test 判红 / ../core 复绿 / 子目录里合法的 ../../core 判绿"
          + "并与 prefix: 形态的 faces-no-outside-src 对照判红;"
          + "正向锚点零误伤;原语级双向断言;真实 convert 零命中)",
      );
    });

    // ============ (11) 三样新机制(peer: 形态 / renderer-features scope / renderer 内层布局)============
    // 本组的主体验**机制**:`renderer-features` 这一档 scope 自 ADR-075 阶段③ 起已挂上规则
    // (renderer-features-no-cross-import,阶段⑥ 起已转 fail-closed),而真实仓库当前命中
    // **0 条** —— 「零命中」与「恒绿」在只读真实仓库输出时不可区分,必须由合成树证明它能判红。
    // ⚠ 例外是 11f/11g:`peer:` 形态自阶段②起已被 renderer-foundation-no-feature-dep 换用,
    // 那一条必须由**真实仓库之外的合成树**证明它能判红 —— 真实仓库零命中与恒绿不可区分。
    await suite.describe("(11) 三样新机制(peer: 形态 / renderer-features scope / renderer 内层布局)", async (s) => {
      await s.case("11a resolveOwner 解析原语(深度无关取前两段)", () => {
        // 11a. resolveOwner:独立于被测内部夹具再钉一遍「深度无关」与「两段根」。
        // 11b 的形态断言已覆盖主路径,这里专门钉解析原语本身,少测一层就漏掉
        // 「normalize 被摘掉」这种只在一处生效的失效。
        assert(
          resolveOwner("renderer/convert/events/convert-actions.ts", "../../ui/dom-ops.js") === "renderer/ui",
          "resolveOwner 应把 ../../ 折叠掉后取前两段(深度无关是 peer 形态存在的唯一理由)",
        );
        assert(
          resolveOwner("renderer/convert/convert-flow.ts", "../settings/settings-drawer.js") === "renderer/settings",
          "resolveOwner 对单层上跳同样应取前两段",
        );
        assert(
          resolveOwner("renderer/convert/events/index.ts", "./selection.js") === "renderer/convert",
          "同 feature 内的边解析出的根应与 from 侧相同(二元语义的另一半)",
        );
        assert(
          resolveOwner("renderer/convert/convert-flow.ts", "../../../main/ipc/channels.js").startsWith(".."),
          "逃出扫描根时 resolveOwner 应返回含 .. 的路径(于是不属任何登记根,与 layer:.. 互不代答)",
        );
      });

      await s.case("11a 分工:resolveOwner 与 resolveLayer 对 renderer 内部必须不同答", () => {
        // 与 resolveLayer 分工:后者对 renderer 内部恒答 renderer,故 peer 形态不可能靠它实现。
        // 这条断言是对「不要把两者合并」的机械钉 —— 合并后本条立刻变红。
        assert(
          resolveOwner("renderer/convert/events/x.ts", "../../ui/dom-ops.js")
            !== resolveLayer("renderer/convert/events/x.ts", "../../ui/dom-ops.js"),
          "resolveOwner 与 resolveLayer 对 renderer 内部必须给出不同答案(前者读第二段,后者恒为首段)",
        );
      });

      await s.case("11b 两张 renderer 表是子集关系且排除面恰好只有组合根", async () => {
        // 11b. 两张 renderer 表的关系:功能根是已登记一级目录的**子集**。
        // 这条不是形式检查 —— 少了它,把某个根从 RENDERER_FEATURE_ROOTS 删掉只会静默缩小
        // scope 命中面,而那个洞正是两张表要堵的(未登记的名字静默放行)。
        for (const root of RENDERER_FEATURE_ROOTS) {
          assert(
            RENDERER_TOP_DIRS.includes(root),
            `RENDERER_FEATURE_ROOTS 的 ${root}/ 必须在 RENDERER_TOP_DIRS 内(两张表是子集关系),实际 ${RENDERER_TOP_DIRS.join("/")}`,
          );
        }
        assert(
          RENDERER_FEATURE_ROOTS.length < RENDERER_TOP_DIRS.length,
          `功能根应是 renderer 一级目录的真子集(基础层与样式层不在其中),实际 ${RENDERER_FEATURE_ROOTS.length}/${RENDERER_TOP_DIRS.length}`,
        );
        // 排除面:**恰好只登记组合根一个**,逐字钉住(ADR-075 阶段③)。
        // 豁免的是组合根,理由:它是唯一合法的跨 feature 引用方(ADR-065)—— 跨功能协作经组合根
        // 以构造参数注入,组合根按定义要引四个功能目录(实测 8 条),那是目标形态本身而非违反。
        //
        // ⚠ 钉「恰好一条且逐字相同」而非「至少含它」:多登记一个即意味着某个功能目录被整体豁免,
        // 那正是 ADR-065 目标形态的反面;换成泛化前缀(长度不变)会让「除组合根外一切」静默成立。
        assert(
          RENDERER_FEATURE_SCOPE_EXCEPT_FILES.length === 1
            && RENDERER_FEATURE_SCOPE_EXCEPT_FILES[0] === "renderer/renderer.ts",
          `renderer-features 的排除面应恰好是组合根一个(renderer/renderer.ts —— 豁免的是组合根,`
            + `理由:它是唯一合法的跨 feature 引用方,ADR-065),实际 ${RENDERER_FEATURE_SCOPE_EXCEPT_FILES.join("、") || "(空)"}`,
        );
        // 判绿对照:组合根引全部四个功能目录**不判红**(ADR-065 的目标形态本身)。
        //
        // ⚠ 实测这条为绿的原因**不是**排除面承重,而是 scope 命中面为 `renderer/<功能根>/` 前缀、
        // 组合根作为 `renderer/` 直属文件本就不在其中 ⇒ **排除面这一行当前不承重**
        // (带它 / 去掉它,renderer-features-no-cross-import 的命中数一字不变,见 11e)。
        // 保留这条断言的理由是它守住**可观察行为**(组合根的 import 不判红),而不只是登记的字面;
        // scopeMatches 未导出,故经 analyze 实测而不是直调原语。
        {
          const pkg = { dependencies: { docx: "9.0.0" } };
          const sb = createSandbox(pkg, {
            "renderer/renderer.ts": [
              'import { convertFlow } from "./convert/convert-flow.js";',
              'import { bindSettings } from "./settings/settings-bindings.js";',
              'import { domOps } from "./ui/dom-ops.js";',
              "export const w = [convertFlow, bindSettings, domOps];",
            ].join("\n"),
            "renderer/convert/convert-flow.ts": "export const convertFlow = () => null;\n",
            "renderer/settings/settings-bindings.ts": "export const bindSettings = () => null;\n",
            "renderer/ui/dom-ops.ts": "export const domOps = () => null;\n",
            // 同树里放一条真违规:证明上面那三条判绿不是因为整档规则恒绿
            "renderer/wizard/probe.ts": 'import { domOps } from "../ui/dom-ops.js";\nexport { domOps };\n',
          });
          track(sb.dir);
          const result = analyze(sb.srcDir, pkg, FLAVORS.src);
          const peerHits = [...result.info, ...result.problems]
            .map(String)
            .filter((line) => line.includes("renderer-features-no-cross-import"));
          assert(
            peerHits.length === 1 && peerHits[0]?.includes("renderer/wizard/probe.ts") === true,
            `组合根的 3 条跨 feature import 应判绿、同树的 wizard/ → ui/ 应判红(证明不是整档恒绿),`
              + `实际 ${peerHits.length} 处:${peerHits.join(" | ")}`,
          );
          assert(
            result.problems.length === 1
              && String(result.problems[0]).includes("renderer-features-no-cross-import"),
            `本条已转 fail-closed(ADR-075 阶段⑥):wizard/ → ui/ 这条边应进 problems 判红,`
              + `实际 problems ${result.problems.length} 项:${result.problems.join(" | ")}`,
          );
          // ⚠ 转正后**判红方向必须由 CLI 出口证明**,不只 analyze() 的内部计数:
          // 「命中进了 problems」与「进程因此退出非零」是两件事,后者才是 CI 看得见的那个。
          const cli = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
          assert(
            cli.code === 1 && cli.output.includes("renderer-features-no-cross-import"),
            `fail-closed 后 CLI 应退出 1 并打印该规则 id,实际 code=${cli.code}:${cli.output.slice(0, 200)}`,
          );
        }
      });

      // 11c. renderer 内层布局判据:真实仓库零未登记 + 合成未登记目录判红并点名。
      // 方向与 (8) 组对 src/ 顶层的那套完全一致(判据本体的同形)。
      await s.case("11c renderer 内层布局判据:真实仓库零未登记 + 合成未登记目录判红并点名", async () => {
        const rendererDir = path.join(SRC_DIR, "renderer");
        // 目录列举由本段自己读(不经被测实现),免得「读目录那一步」本身写错时被测实现与
        // 本断言一起绿 —— 同 8a 的取舍。
        const actual = fs
          .readdirSync(rendererDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
        const unregistered = actual.filter((n) => !RENDERER_TOP_DIRS.includes(n));
        assert(
          unregistered.length === 0,
          `真实仓库 src/renderer 的一级目录应全部登记在 RENDERER_TOP_DIRS,未登记:${unregistered.join(",")}`,
        );
        assert(
          analyzeRendererTopDirs(rendererDir).length === 0,
          "真实仓库 src/renderer 应零未登记一级目录",
        );
        // 判红方向:多一个未登记目录 ⇒ 判红并点名(这张判据不走 pending,它是独立的判红项)
        {
          const sb = createSandbox({ dependencies: {}, devDependencies: {} }, {});
          writeFileIn(sb.srcDir, "renderer/omega/probe.ts", "export const n = 1;\n");
          track(sb.dir);
          const problems = analyzeRendererTopDirs(path.join(sb.srcDir, "renderer"));
          assert(
            problems.length === 1 && String(problems[0]).includes("omega"),
            `含未登记一级目录 omega/ 的合成 renderer 树必须判红并点名 omega,实际:${JSON.stringify(problems)}`,
          );
          // 路径不存在时跳过而非判红:沙盒只铺局部树,恒红会掩盖真实诊断
          assert(
            analyzeRendererTopDirs(path.join(sb.srcDir, "no-such-renderer")).length === 0,
            "renderer 目录不存在时应跳过(返回空)而非判红 —— 沙盒只铺局部树",
          );
        }
        // 原语两个方向(恒绿 / 恒红都是失效,各自钉一个用例)
        assert(
          findUnregisteredRendererDirs(["convert", "dom", "settings", "state", "style", "ui", "wizard"]).length === 0,
          "已登记的 renderer 一级目录应零命中",
        );
        assert(
          findUnregisteredRendererDirs(["omega"]).length === 1,
          "未登记的 renderer 一级目录应命中(漏检即恒绿)",
        );
      });

      // 11d. 门禁本体的自检必须零问题。selfCheckPeerMesh 是这两样机制唯一的牙齿 ——
      // 恒绿不会体现在任何真实仓库输出里,只在这里露出来。
      // 门禁自身(main 接线那一处)也跑同一批,故两处独立。
      await s.case("11d 门禁本体的 peer 形态自检零问题", () => {
        const peerSelfCheck = selfCheckPeerMesh();
        assert(
          peerSelfCheck.length === 0,
          `peer 形态与 renderer-features scope 的自检应零问题,实际 ${peerSelfCheck.length} 项:${peerSelfCheck.join(" | ")}`,
        );
      });

      await s.case("11e peer 规则恰好两条(阶段③ 挂第二条)、renderer-features 档恰好一条且带 pending", () => {
        // 11e. 这条断言当初钉的是阶段①「刻意不挂规则」,阶段②(ADR-075)改为「peer 恰好一条」,
        // 阶段③ 又挂上第二条。**每一次都是刻意钉「恰好」而非「至少」**:多一条当场变红,
        // 提醒同批改这里 —— 规则表是 deny-list,「至少」的断言在新增规则那天恒绿。
        const peerRules = LAYER_RULES.filter((r) => r.forbid.startsWith("peer:"));
        assert(
          peerRules.length === 2
            && peerRules[0]?.id === "renderer-foundation-no-feature-dep"
            && peerRules[1]?.id === "renderer-features-no-cross-import",
          `peer: 形态的规则应恰好是 renderer-foundation-no-feature-dep 与 renderer-features-no-cross-import 这两条`
            + `(同族两条、scope 互补),实际 ${peerRules.length} 条:${peerRules.map((r) => r.id).join(",")}`,
        );
        // 换形态的两条机械证据:根名由派生表拼出 + scope 未被顺手扩到整个 renderer
        //
        // ⚠ 取值一律经 `?.` + `??` 兜底再断言,不用 `!` 非空断言:`noUncheckedIndexedAccess`
        // 下「peerRules[0] 可能不存在」正是**要断言的事实本身**(长度不为 1 时它就该是
        // undefined),写成 `!` 等于把那道类型检查关掉,类型面就盖不到「规则被删了」这个形态。
        const foundationRule = peerRules.at(0);
        const foundationForbid = foundationRule?.forbid ?? "(peer 规则缺失)";
        const foundationScope = foundationRule?.scope ?? "(peer 规则缺失)";
        assert(
          foundationForbid === `peer:${RENDERER_PEER_ROOTS.join(",")}`,
          `renderer-foundation-no-feature-dep 的 forbid 应逐字等于 peer: + RENDERER_PEER_ROOTS 拼出的串`
            + `(不得手写第二份名字),实际 ${foundationForbid}`,
        );
        assert(
          foundationScope === "renderer-foundation",
          `renderer-foundation-no-feature-dep 的 scope 应仍是 renderer-foundation(只管 dom/ 与 state/),实际 ${foundationScope}`,
        );
        // 阶段③ 新挂那条的登记:同一张派生表拼出 forbid(不手写第二份名字)+ scope 落在那一档
        // + **已不带 pending**(阶段⑥ 转正删标记即转 fail-closed;转正前置是边拆完+槽清零)。
        const featuresRule = LAYER_RULES.find((r) => r.id === "renderer-features-no-cross-import");
        assert(
          featuresRule !== undefined,
          "LAYER_RULES 里应找得到 renderer-features-no-cross-import(ADR-075 阶段③ 挂的那条)",
        );
        assert(
          featuresRule?.forbid === `peer:${RENDERER_PEER_ROOTS.join(",")}`,
          `renderer-features-no-cross-import 的 forbid 应与 foundation 那条逐字同形(同一张派生表),`
            + `实际 ${featuresRule?.forbid ?? "(规则缺失)"}`,
        );
        // 钉「字段不存在」而非「值不为 true」:`pending: false` 与「没有 pending 字段」在
        // 求值上同义,但只有后者是本仓的形态(其余 pending 规则靠**删整行**表示转正),
        // 留一个 false 字段会让下一个人以为还有开关可拨。
        assert(
          featuresRule !== undefined && !("pending" in featuresRule),
          `renderer-features-no-cross-import 已转 fail-closed,不应再有 pending 字段`
            + `(转正 = 删整行,不是置 false),实际字段 ${JSON.stringify(
              featuresRule === undefined ? "(规则缺失)" : Object.keys(featuresRule),
            )}`,
        );
        // 派生一致性(与门禁 selfCheckPeerMesh 里那组同纪律,但**不**直接消费那个函数:
        // 本段是消费侧的外壳证据,两处任一被摘掉另一处还在)
        assert(
          RENDERER_PEER_ROOTS.length === RENDERER_FEATURE_ROOTS.length
            && RENDERER_FEATURE_ROOTS.every((root, i) => RENDERER_PEER_ROOTS[i] === `renderer/${root}`),
          `RENDERER_PEER_ROOTS 应是 RENDERER_FEATURE_ROOTS 的两段逐项派生(长度相等且逐项等于 renderer/<root>),`
            + `实际 ${JSON.stringify(RENDERER_PEER_ROOTS)} vs ${JSON.stringify(RENDERER_FEATURE_ROOTS)}`,
        );
        // renderer-features 那一档:阶段① 是 0 条,阶段③ 起恰好一条且就是新挂的那条。
        //
        // ⚠ **阶段④ 拆边期间本断言仍成立**(改的是 import,不是规则表);阶段⑥ 转正删掉
        // `pending: true` 后**仍成立**(那条断言只数条数与 id,不读 pending)。
        const featureScoped = LAYER_RULES.filter((r) => r.scope === "renderer-features");
        assert(
          featureScoped.length === 1 && featureScoped[0]?.id === "renderer-features-no-cross-import",
          `renderer-features scope 应恰好挂着 renderer-features-no-cross-import 这一条`
            + `(阶段④ 拆边期间与阶段⑥ 转正后均不变 —— 本断言只数条数与 id,不读 pending),`
            + `实际 ${featureScoped.length} 条:${featureScoped.map((r) => r.id).join(",")}`,
        );
        // pending 计数由规则表派生,结论行里的那个数跟着走(阶段② 是 4 → 阶段③ 挂规则后 5
        // → 阶段⑥ renderer-features-no-cross-import 转正删标记,回到 4)
        const pendingCount = [...LAYER_RULES, ...LAYER_TEXT_RULES].filter((r) => r.pending === true).length;
        assert(
          pendingCount === 4,
          `pending 判据条数应与结论行一致(转正删标记会改动结论行的那个数),实际 ${pendingCount}`,
        );
      });

      // 11f. **负向夹具**(ADR-075 阶段②的验收核心):证明换后的规则真能判红。
      // 只有「零命中」那一步与恒绿不可区分 —— 真实仓库零命中在「forbid 写裸名恒假」与
      // 「forbid 正确」两种实现下输出完全一样,故必须有一棵合成树把它钉死。
      await s.case("11f 负向夹具:换后的 peer 规则能判红(证明它不是恒绿)", () => {
        // 构造:dom/refs.ts 从基础层反向 import 功能目录 convert/。
        // 刻意挑**深一层**的形态(dom/refs.ts 是 renderer/dom/refs.ts,spec 必为 ../convert/…)
        // 来覆盖旧 prefix: 形态的语义;11g 再钉「深两层的子目录」这条旧形态真会漏判的边。
        const pkg = { dependencies: { docx: "9.0.0" } };
        const sb = createSandbox(pkg, {
          "renderer/dom/refs.ts": 'import { convertFlow } from "../convert/convert-flow.js";\nexport { convertFlow };\n',
          "renderer/convert/convert-flow.ts": "export const convertFlow = () => null;\n",
        });
        track(sb.dir);
        const relevant = analyze(sb.srcDir, pkg, FLAVORS.src).problems
          .map(String)
          .filter((p) => /renderer-foundation-no-feature-dep/.test(p));
        assert(
          relevant.length === 1,
          `合成树上 dom/refs.ts → convert/ 必须命中 renderer-foundation-no-feature-dep 一次,实际 ${relevant.length} 次:${relevant.join(" | ")}`,
        );
        // 点名:诊断须同时含 rule id、源文件与那条说明符(只判「命中过一次」不足以定位是谁的边)
        //
        // 同上,取值经 `?? ""` 兜底:上面那条 `relevant.length === 1` 断言失败时本段仍要能
        // 给出可读消息,而不是在读 `relevant[0]` 时先崩成一个 TypeError。
        const firstHit = relevant.at(0) ?? "";
        assert(
          firstHit.includes("renderer/dom/refs.ts")
            && firstHit.includes("../convert/convert-flow.js")
            && firstHit.includes("renderer-foundation-no-feature-dep"),
          `诊断应点名源文件、说明符与规则 id,实际:${firstHit}`,
        );
        // 判绿对照(恒红同样是失效):基础层 → 基础层 / 基础层 → core/ 都不得命中本规则。
        // 错方向的那条 —— 禁「dom → core」而不是「dom → 功能目录」—— 会让下面第一个变红。
        const legalSb = createSandbox(pkg, {
          "renderer/dom/refs.ts": 'import { x } from "../state/pure.js";\nexport { x };\n',
          "renderer/state/pure.ts": "export const x = 1;\n",
          "renderer/state/store.ts": 'import { x } from "../../core/text/error-message.js";\nexport { x };\n',
          "core/text/error-message.ts": "export const x = 1;\n",
        });
        track(legalSb.dir);
        const legalRelevant = analyze(legalSb.srcDir, pkg, FLAVORS.src).problems
          .map(String)
          .filter((p) => /renderer-foundation-no-feature-dep/.test(p));
        assert(
          legalRelevant.length === 0,
          `基础层 → 基础层 与 基础层 → core/ 是合法边,不得命中本规则,实际 ${legalRelevant.length} 次:${legalRelevant.join(" | ")}`,
        );
      });

      // 11h. 该规则的**负向夹具 + 转正后的 fail-closed 证明**。
      //
      // 为什么必须单独一条:真实仓库当前命中 **0 处**,而 fail-closed 规则在零命中时与
      // 「恒绿」在只读真实仓库输出时**完全不可区分**。故必须有一棵合成树证明它会命中、
      // 且会**让进程退出非零** —— 否则「门禁绿」可能只是恒绿的另一种说法。
      //
      // ⚠ 本条随转正改写过一次(阶段⑥ 删 pending 之前它断言「命中只进 info、problems
      // 为空」):转正后同一棵树的命中从 info 移到 problems,并且 CLI 由 0 变 1。改动时
      // 保住的是**意图**(证明这条判据有牙且真会拦人),不是当时那个通道选择。
      await s.case("11h 负向夹具:该规则命中即判红并让 CLI 退出非零(转正后的 fail-closed)", async () => {
        const pkg = { dependencies: { docx: "9.0.0" } };
        const sb = createSandbox(pkg, {
          // 三个方向各一条,覆盖 scope 命中面的形状:一层 / 两层子目录 / 目标在另一功能根
          "renderer/convert/file-list.ts": 'import { domOps } from "../ui/dom-ops.js";\nexport { domOps };\n',
          "renderer/convert/events/drop.ts": 'import { draw } from "../../wizard/book-wizard.js";\nexport { draw };\n',
          "renderer/settings/settings-drawer.ts": 'import { convertFlow } from "../convert/convert-flow.js";\nexport { convertFlow };\n',
          "renderer/ui/dom-ops.ts": "export const domOps = 1;\n",
          "renderer/wizard/book-wizard.ts": "export const draw = 1;\n",
          "renderer/convert/convert-flow.ts": "export const convertFlow = 1;\n",
          // 判绿对照:同 feature 自环 + feature → 基础层/样式层,都不得命中本规则
          "renderer/convert/convert-self.ts": 'import { domOps } from "./file-list.js";\nexport { domOps };\n',
          "renderer/convert/to-dom.ts": 'import { refs } from "../dom/refs.js";\nexport { refs };\n',
          "renderer/dom/refs.ts": "export const refs = 1;\n",
        });
        track(sb.dir);
        const result = analyze(sb.srcDir, pkg, FLAVORS.src);
        // ⚠ 转正前命中落在 info 通道,转正后移到 problems —— 这里**同时**读两通道;
        // 「命中共 3 条」与「命中在 problems 里」是两条独立断言,后者另有一条钉。
        const infoHits = [...result.info, ...result.problems]
          .map(String)
          .filter((l) => l.includes("renderer-features-no-cross-import"));
        assert(
          infoHits.length === 3,
          `合成树上 convert→ui、convert/events→wizard、settings→convert 三条边必须各命中一次,`
            + `实际 ${infoHits.length} 次:${infoHits.join(" | ")}`,
        );
        // 点名:诊断须含源文件、说明符与规则 id(只数次数不足以定位是谁的边)
        for (const needle of [
          "renderer/convert/file-list.ts",
          "../ui/dom-ops.js",
          "renderer/convert/events/drop.ts",
          "../../wizard/book-wizard.js",
          "renderer/settings/settings-drawer.ts",
          "../convert/convert-flow.js",
          "renderer-features-no-cross-import",
        ]) {
          assert(
            infoHits.some((line) => line.includes(needle)),
            `诊断应点名「${needle}」,实际:${infoHits.join(" | ")}`,
          );
        }
        // 判绿对照(恒红同样是失效):同 feature 自环与 feature → 基础层都不该命中
        assert(
          !infoHits.some((line) => line.includes("convert-self.ts") || line.includes("to-dom.ts")),
          `同 feature 自环与 feature → 基础层是合法边,不得命中本规则,实际:${infoHits.join(" | ")}`,
        );
        // ⚠ 转正后**命中必须进 problems**:这是 fail-closed 的定义(判红 + 影响退出码),
        // 阶段③～⑤ 期间本条带 pending 时相反(只进 info、problems 一条也不该有)。
        // 保留与「pendingHits 计数」并列为两条:前者是通道,后者是计数,两者可各自单独坏。
        assert(
          result.problems.length === 3
            && result.problems.every((line) => String(line).includes("renderer-features-no-cross-import")),
          `转正后命中应全部进 problems(共 3 条),实际 ${result.problems.length} 项:${result.problems.join(" | ")}`,
        );
        // 转正后该规则**不再经 pending 通道计数**:pendingHits 只收 pending 规则的命中,
        // 所以这里必须恒为 0。它是「已离开 pending 机制」的机械证据 —— 与上面那条
        // 「命中进了 problems」互为另一侧,任一侧坏掉都说明转正只做了一半。
        assert(
          (result.pendingHits.get("renderer-features-no-cross-import") ?? 0) === 0,
          `转正后该规则不应再被 pendingHits 计数(汇总行的 pending 命中数由它拼出),`
            + `实际 ${result.pendingHits.get("renderer-features-no-cross-import") ?? 0} 处`,
        );
      });

      // 11g. 换形态换掉的那条**真实漏判**:深两层的子目录发 ../../ui/。
      // 旧 forbid 是 `prefix:../ui/`(比说明符字面),`../../ui/dom-ops.js` 不以 `../ui/`
      // 开头 ⇒ 旧形态对这条边恒绿;新形态按解析结果判,深度无关。
      await s.case("11g 换形态换掉的正是深目录漏判(旧 prefix: 恒绿、新 peer: 判红)", async () => {
        const pkg = { dependencies: { docx: "9.0.0" } };
        const sb = createSandbox(pkg, {
          // state/store/ 下的深一层子目录:spec 是 ../../ui/,旧形态漏判它
          "renderer/state/store/slice.ts": 'import { domOps } from "../../ui/dom-ops.js";\nexport { domOps };\n',
          "renderer/ui/dom-ops.ts": "export const domOps = 1;\n",
        });
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assertFailure(
          result,
          /renderer\/state\/store\/slice\.ts.*违反层向规则 renderer-foundation-no-feature-dep/s,
          "深两层的 state/store/ → ui/ 边必须判红",
        );
        // 反证旧形态为何漏判:同一个说明符对 `prefix:../ui/` 恒绿。
        // 这条不是测被测实现,而是把「旧写法错在哪」写成可执行的证据,免得下一个读者
        // 以为两形态等价(它们只在一层子目录上等价)。
        const spec = "../../ui/dom-ops.js";
        assert(
          !spec.startsWith("../ui/"),
          "本组夹具的前提:深目录的说明符不以 ../ui/ 开头,故旧 prefix: 形态对它恒绿 —— 前提不成立时本组无意义",
        );
      });

      await s.case("11e 结论行逐字钉住(零行为变化的机械证据)", async () => {
        // 结论行逐字钉住(最强的「零行为变化」判据):阶段②把 foundation 规则换了 forbid 形态,
        // 机制侧新增了派生表,结论行必须仍提到「当前这 4 条判据带 pending 标记」且不提任何
        // renderer 内层布局。该数**由规则表派生**(门禁自己按 `filter(r => r.pending ===
        // true).length` 取),故它不是手写的期望值,而是真跑出来的口径 —— 阶段③ 挂 pending
        // 时它从 4 变 5,阶段⑥ 转正删标记后回到 4。
        const sb = createSandbox({ dependencies: { docx: "9.0.0" }, devDependencies: { electron: "43.0.0" } }, {
          "core/markdown/parse.ts": "export const parse = () => null;\n",
        });
        track(sb.dir);
        const result = await runCli(["--src", sb.srcDir, "--package", sb.pkgPath]);
        assert(result.code === 0, `本组涉及的合法沙盒应零退出,实际 ${result.code}:${result.output}`);
        assert(
          result.output.includes("当前这 4 条判据带 pending 标记"),
          `结论行的 pending 条数应仍为 4(阶段③ 挂规则时 5,阶段⑥ 转正删标记后回到 4),实际:${result.output}`,
        );
        assert(
          !result.output.includes("RENDERER_TOP_DIRS"),
          "结论行不得提到 RENDERER_TOP_DIRS(它是独立判红项,不挂 pending,不进结论行 —— 加进去就改了结论行)",
        );
      });
      console.log(
        "[ok] import-boundary:三样新机制探针通过"
        + "(resolveOwner 深度无关取前两段 / 两张 renderer 表的子集关系 / 排除面恰好只登记组合根 renderer/renderer.ts"
          + "且组合根 import 判绿、同树真违规仍判红;"
          + "renderer 内层布局真实仓库零未登记 + 合成未登记目录判红并点名 + 目录不存在时跳过 + 原语双向;"
          + "peer 与 renderer-features 自检零问题;"
          + "阶段③挂规则:peer 规则恰好两条(forbid 逐字同形)、renderer-features 档恰好一条、"
          + "阶段⑥转正后该规则已无 pending 字段且 pending 共 4 条;"
          + "负向夹具:dom/refs → convert 判红并点名 + 合法边判绿 + 深目录旧 prefix: 漏判边现判红;"
          + "转正后负向夹具:三条跨 feature 边判红进 problems、CLI 退出 1、同 feature 自环判绿;"
          + "结论行不提 RENDERER_TOP_DIRS)",
      );
    });
  } finally {
    // 走 removeTree(退避重试 + 删后复查):沙盒里刚写过 dist 副本,Windows 上句柄释放
    // 有延迟;删不掉仍即抛,不得静默残留在系统临时区
    for (const dir of sandboxes) {
      const outcome = removeTree(dir, { retryDelay: 200 });
      if (!outcome.ok) throw new Error(`沙盒清理失败:${dir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
    }
  }
  return { cases: suite.results };
}
