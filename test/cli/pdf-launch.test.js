// @ts-check
/**
 * CLI 拉起 pdf 宿主的**真实路径**验收(位于 test/cli/,镜像 src/cli/index.ts 的
 * convertPdfViaHost 及其调用的 host-launch 判定)。
 *
 * 为什么单独一段:`options.test.js` 里那处 `--format pdf` 只是 `expandFormats("pdf")`
 * 的纯函数断言 —— **真跑 pdf 的路径此前没有任何段走过**(链报告里 `cli/index.ts` 的
 * `convertPdfViaHost` 长期未覆盖)。于是两处「漏一行就静默失败」的位置全在覆盖率外:
 * ① `host-launch.ts` 的上下文判定(已装 / dev 两条拉起形态选哪条);
 * ② `hostEnv()` 剔除 `ELECTRON_RUN_AS_NODE`。
 *
 * ② 只有**注入污染态再断言成功**才抓得住 —— 只测「干净 env 能跑」会放过它:
 * 该 bug 的形态正是「干净环境正常、继承到变量就崩」。
 *
 * 为什么派生**纯 node** 子进程而不是在本进程直调 `convertPdfViaHost`:
 * 本段跑在 Electron 宿主里,在其中再 spawn 一个 Electron 会造成嵌套(实测整段超时
 * 180s 被硬终止)。派生子进程同时是既有先例(`options.test.js` 的真 node 子进程段),
 * 且覆盖面更大 —— 子进程里走的是 **dev 分支**,连 `resolveDevElectron` 一并覆盖,
 * 而 Electron 宿主里直调只能覆盖已装分支。子进程的覆盖率同样被计入(options.ts 即如此)。
 */

/** 本段自造最小 markdown,不属夹具区;契约见 gates/fixtures/gen-fixtures.mjs 文件头 */
export const fixtures = null;

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "../harness/paths.js";
// node 解析器取全仓单一来源(原先本段 import 同目录的 options.test.js,那是**段 import 段**,
// 与 check-test-layout.mjs 的 L4 冲突:段是发现与隔离的单位,段间 import 让失败不可归因
// 且让被 import 的段双跑)。改由非段助手承载,单一来源这条纪律不变。
import { resolveNode } from "../harness/node-exec.js";
import { createTempResource, removeTree } from "../harness/temp-resource.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**cli**,判据静态看不见本段的主体 ——
 * 被测的 `dist/cli/index.js` 由派生**纯 node 子进程**经 `spawnSync` 以 argv 拉起
 * (路径 `path.join(ROOT, "dist", "cli", "index.js")` 逐段拼出,不在 import 语句位置),
 * 段内零 cli import。
 *
 * 主体依据(**头注明写**):头注第一行写「位于 test/cli/,镜像 src/cli/index.ts 的
 * convertPdfViaHost 及其调用的 host-launch 判定」,并逐条点名两处「漏一行就静默失败」的
 * 位置 —— ① `host-launch.ts` 的上下文判定(已装/dev 两条拉起形态选哪条);② `hostEnv()`
 * 剔除 `ELECTRON_RUN_AS_NODE`。两处正是本段全部断言的落点。
 */
export const covers = [
  "src/cli/index.ts",
  "src/cli/host-launch.ts",
];

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`cli/pdf-launch 断言失败:${msg}`);
}

/**
 * 在纯 node 子进程里跑一次真 pdf 转换。
 *
 * @param {string} input 输入 md 绝对路径
 * @param {string} output pdf 产物绝对路径(用 `-o` 钉死,免得同名避让让断言找不到)
 * @param {string | undefined} runAsNode `ELECTRON_RUN_AS_NODE` 的取值;`undefined` 表示不设该变量
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runPdfViaCli(input, output, runAsNode) {
  const env = { ...process.env };
  // 刻意显式设/删,不依赖父进程环境恰好干净(options.test.js 同一理由)。
  if (runAsNode === undefined) delete env.ELECTRON_RUN_AS_NODE;
  else env.ELECTRON_RUN_AS_NODE = runAsNode;
  const result = spawnSync(
    resolveNode(),
    [path.join(ROOT, "dist", "cli", "index.js"), input, "--format", "pdf", "-o", output],
    { cwd: ROOT, encoding: "utf8", windowsHide: true, env, timeout: 120000 },
  );
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * 跑一次并断言真的产出了非空 pdf。
 *
 * @param {string} dir 本段临时目录
 * @param {string} name 输入文件名(各用例唯一,避免同名避让把产物挪走)
 * @param {string | undefined} runAsNode `ELECTRON_RUN_AS_NODE` 取值;`undefined` = 不设
 * @param {string} label 失败消息里的场景名
 */
function assertPdfProduced(dir, name, runAsNode, label) {
  const input = path.join(dir, `${name}.md`);
  fs.writeFileSync(input, ["# 标题", "", "正文一段,含公式 $a^2$。", ""].join("\n"), "utf8");
  const output = path.join(dir, `${name}.pdf`);
  const r = runPdfViaCli(input, output, runAsNode);
  assert(r.code === 0, `${label}:退出码应为 0,实际 ${r.code};stderr 末尾=${r.stderr.slice(-200)}`);
  assert(fs.existsSync(output), `${label}:产物应落盘,实际不存在 ${output}`);
  assert(fs.statSync(output).size > 1000, `${label}:产物不应是空文件(字节数 ${fs.statSync(output).size})`);
}

export async function run() {
  const { path: dir } = createTempResource({ label: "cli-pdf-launch" });
  try {
    // 1) 干净环境:真跑一次 pdf(经宿主子进程)
    assertPdfProduced(dir, "干净环境", undefined, "干净环境");

    // 2) 反向锚点:注入 ELECTRON_RUN_AS_NODE 污染态,仍须成功。
    //    已装形态由 launcher 设该变量让 CLI 以纯 node 跑应用 exe;若子进程继承到它,
    //    宿主会跟着以纯 node 启动并以 SyntaxError 崩掉、pdf 静默不产出(退出码 3)。
    //    **`=0` 同样致命** —— Electron 只判存在性不判取值,所以两种取值都要覆盖,
    //    且修法必须是 delete 而不是置 0(见 host-launch.ts 的 hostEnv 注释)。
    assertPdfProduced(dir, "污染1", "1", "ELECTRON_RUN_AS_NODE=1");
    assertPdfProduced(dir, "污染0", "0", "ELECTRON_RUN_AS_NODE=0");

    console.log(
      "[ok] cli/pdf-launch:pdf 宿主真实拉起通过(纯 node 子进程真产出 pdf + 注入 ELECTRON_RUN_AS_NODE=1/0 两种污染态仍成功 —— 后者才是 env 泄漏那个 bug 的抓手)",
    );
  } finally {
    removeTree(dir);
  }
}