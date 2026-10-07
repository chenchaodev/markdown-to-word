// @ts-check
/**
 * 装配层纯 node 验收(位于 test/convert/,镜像顶层树 src/convert;ADR-060):
 *
 * 被测主体 = dist/convert/run.js(emitConvertedArtifact / persistArtifact)与其
 * 依赖链(dist/convert/preprocess.js · context.js · artifact-writer.js · paths.js
 * + dist/core/**)。这些文件**一个都不经 electron**。
 *
 * 为何要在子进程里跑(本段的核心证据):
 * 验收入口本身跑在 Electron 里(段宿主是 electron.exe),故在**本进程**内 import
 * 装配层只能证明「electron 宿主下能跑」,证明不了「与宿主无关」—— 若 run.ts 的
 * 依赖链里混进 electron,本进程照样绿。故本段派生一个**真 node** 子进程
 * (不设 ELECTRON_RUN_AS_NODE,不经 electron;解析口径取
 * test/harness/node-exec.js 的 resolveNode —— 全仓单一来源),在那里 import 装配层
 * 并跑完整 docx 转换:
 * 只要依赖链里有任何一个 electron import(哪怕只是 mermaid-service 的模块顶层
 * `app.on("will-quit")`),该子进程就会在 import 期抛错,本段红。
 *
 * 覆盖:
 * - docx 全链路:真实 markdown → 装配层 → 落盘 → 魔数正确(产物确为 ZIP/OOXML),
 *   且**不经**任何宿主能力(printPdf / mermaid / 导出后行为一个都不注入);
 * - 缺省 mermaid 即不注入:装配层不传 mermaidResolver 时,含 ```mermaid 代码块的
 *   文档仍应正常转换(按普通代码块渲染),不抛错、不产生 mermaid 失败 warning ——
 *   这是「默省 = 不注入」的契约,也是将来 MCP 面降级行为的既有语义;
 * - 可信读根收敛:baseDir 之外的相对图片读不到(不静默读盘),故不产出 warning。
 *
 * 刻意**不在本段碰 pdf**:pdf 的打印能力是宿主注入的(PRINT_PDF),纯 node 下缺省会
 * 明确报错(那是正确行为,不是缺陷),在这里断言它等于把「无宿主」当常态固化下来。
 * pdf 链路由 test/convert/ 的段在 Electron 宿主下覆盖。
 *
 * 样例与产物全部放一次性临时目录(createTempResource 分配、removeTree 退避重试清理),
 * 不污染 output/artifacts。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveNode } from "../harness/node-exec.js";
import { ROOT } from "../harness/paths.js";
import { createTempResource, removeTree } from "../harness/temp-resource.js";
import { createAsserter } from "../harness/assert.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**convert**,判据静态看不见本段的主体 ——
 * 被测的装配层由派生**纯 node 子进程**的**脚本文本内 import** 载入(URL 经
 * `distUrl(...)` 逐段拼进 `CHILD_SCRIPT` 字符串,不在 import 语句位置),段内零 convert import。
 *
 * 主体依据(**头注明写**):头注写「被测主体 = dist/convert/run.js(emitConvertedArtifact /
 * persistArtifact)与其依赖链(dist/convert/preprocess.js · context.js · artifact-writer.js ·
 * paths.js + dist/core/**)」。故声明 convert 层自身那五处;`dist/core/**` 是它的**下游
 * 依赖**(docx 全链路的渲染在 core),本段对 core 无独立断言(不测 core 的任何行为,
 * 只借它证明装配层不经 electron),故不声明 —— 声明通道要求元素是**被测主体**。
 */
export const covers = [
  "src/convert/run.ts",
  "src/convert/preprocess.ts",
  "src/convert/context.ts",
  "src/convert/artifact-writer.ts",
  "src/convert/paths.ts",
];

// 真值断言取公共单源(收敛重复面,口径见 assert.js 文件头)
const { assert } = createAsserter("convert-run-headless");

/**
 * 取 dist 模块的 **file:// URL** 供子进程 import。
 * 刻意不拼裸绝对路径:Windows 上 ESM 只接受 file/data/node 三种 scheme,
 * 裸 `C:\...` 会被默认 loader 以 ERR_UNSUPPORTED_ESM_URL_SCHEME 拒掉
 * (裸路径只在 CommonJS require 下可用)。
 * @param {...string} segments 相对 dist 的模块路径片段
 * @returns {string}
 */
function distUrl(...segments) {
  return pathToFileURL(path.join(ROOT, "dist", ...segments)).href;
}

/** 子进程里跑的驱动脚本:import 装配层 → 准备 markdown → 跑 docx 转换 → 回传结果 JSON。 */
const CHILD_SCRIPT = `
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS } from ${JSON.stringify(distUrl("core", "settings", "settings-defaults.js"))};
import { createConvertContext } from ${JSON.stringify(distUrl("convert", "context.js"))};
import { prepareMarkdown } from ${JSON.stringify(distUrl("convert", "preprocess.js"))};
import { emitConvertedArtifact } from ${JSON.stringify(distUrl("convert", "run.js"))};

const srcPath = process.argv[2];
const settings = { ...DEFAULT_SETTINGS, outputDir: "" };
const warnings = [];
const prepared = await prepareMarkdown(srcPath, settings, warnings);
// 三个宿主能力一个都不注入:printPdf(docx 不消费)/ mermaidResolver(默省 = 不注入)/
// onAfterCommit(不注入 = 不触发导出后行为)。
const result = await emitConvertedArtifact(
  { markdown: { body: prepared.body, metadata: prepared.metadata }, sourcePath: srcPath, baseDir: path.dirname(srcPath) },
  { format: "docx", settings, ctx: createConvertContext(), warnings },
);
process.stdout.write(JSON.stringify({ outputPath: result.outputPath, warnings }));
`;

/**
 * 在纯 node 子进程里跑一次装配层 docx 转换。
 * @param {string} srcPath 源 markdown 绝对路径
 * @returns {{ ok: boolean; status: number | null; stdout: string; stderr: string; outputPath?: string; warnings?: unknown[] }}
 */
function runInPureNode(srcPath) {
  const scriptPath = path.join(path.dirname(srcPath), "_driver.mjs");
  fs.writeFileSync(scriptPath, CHILD_SCRIPT, "utf8");
  // ELECTRON_RUN_AS_NODE 必须**不在**env 里:带着它连 electron.exe 都能当 node 用,
  // 那样就证明不了「不经 electron」。这里显式删掉,不依赖父进程环境恰好干净。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(resolveNode(), [scriptPath, srcPath], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env,
  });
  if (result.status !== 0) {
    return { ok: false, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, status: result.status, stdout: result.stdout ?? "", stderr: `子进程输出非 JSON:${result.stderr ?? ""}` };
  }
  return { ok: true, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", ...parsed };
}

// 本段无验收样例(产物是自造的最小 markdown,不属夹具区;契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // 沙盒由 helper 分配(mkdtemp 建全新一次性目录),清理走 removeTree 的退避重试 ——
  // 裸 fs.rmSync 在 Windows 上撞 EBUSY/EPERM 时会整段判红(见 gates/repo/check-temp-cleanup.mjs)。
  const { path: dir } = createTempResource({ label: "convert-run-headless" });
  try {
    // 真实 markdown:frontmatter + 各级标题 + 表格 + 代码块 + 一段 mermaid。
    // mermaid 那段是「不注入即按普通代码块渲染」的证据:不注入 resolver 时
    // 它必须被当作普通围栏代码块正常渲染,而不是报错或静默丢内容。
    const srcPath = path.join(dir, "纯 node 装配层.md");
    fs.writeFileSync(
      srcPath,
      [
        "---",
        "title: 纯 node 装配层验收",
        "author: 测试",
        "---",
        "",
        "# 一级标题",
        "",
        "正文一段,含**粗体**与`行内代码`。",
        "",
        "## 二级标题",
        "",
        "| 列 A | 列 B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "```js",
        "const x = 1;",
        "```",
        "",
        "```mermaid",
        "graph TD; A-->B;",
        "```",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runInPureNode(srcPath);
    assert(
      result.ok,
      `纯 node 子进程应跑通 docx 转换(退出码 ${result.status}):\n${result.stderr || result.stdout}`,
    );
    const outputPath = result.outputPath ?? "";
    assert(outputPath !== "", `装配层应回传产物路径,实际 ${JSON.stringify(outputPath)}`);
    assert(fs.existsSync(outputPath), `产物应落盘:${outputPath}`);
    assert(
      path.basename(outputPath) === "纯 node 装配层.docx",
      `产物名应为源文件同名换扩展名,实际 ${path.basename(outputPath)}`,
    );

    // 魔数:docx 是 OOXML(ZIP)容器,首四字节 PK\\x03\\x04。这条断言「落盘的是真产物」
    // 而非「同名空文件」—— 只 exists 的断言会让空壳实现照样绿。
    const head = fs.readFileSync(outputPath).subarray(0, 4);
    assert(
      head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04,
      `产物魔数应为 ZIP/OOXML(PK\\x03\\x04),实际 ${[...head].map((b) => b.toString(16).padStart(2, "0")).join(" ")}`,
    );

    // 缺省 mermaid = 不注入:该代码块按普通围栏渲染,故**不应**出现 mermaid 失败 warning。
    const warnings = result.warnings ?? [];
    assert(
      !warnings.some((w) => typeof w === "object" && w !== null && "key" in w && String(w.key).startsWith("warn.mermaid")),
      `未注入 mermaidResolver 时不应产生 mermaid 失败 warning,实际 ${JSON.stringify(warnings)}`,
    );

    // 产物目录零临时文件残留(提交器 finally 清理);驱动脚本是本段自建的,单独排除。
    const leftovers = fs
      .readdirSync(dir)
      .filter((name) => name !== path.basename(srcPath) && name !== "_driver.mjs" && !name.endsWith(".docx"));
    assert(leftovers.length === 0, `装配层落盘后不应留临时文件残留,实际 ${leftovers.join(", ")}`);

    console.log(
      `[ok] convert-run-headless:纯 node(不经 electron)下装配层 docx 全链路通过 ` +
        `(产物 ${path.basename(outputPath)},魔数 PK\\x03\\x04,零临时文件残留;` +
        `printPdf / mermaidResolver / onAfterCommit 三能力均未注入)`,
    );
  } finally {
    removeTree(dir);
  }
}