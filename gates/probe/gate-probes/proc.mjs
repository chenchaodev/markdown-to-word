// 解释器/可执行文件解析。被测门禁必须在**正确的宿主**里跑,否则测到的是
// 「用 Electron 当 node 跑脚本」这类假故障:node 解析要兼容「段内跑在 Electron 里」
// (ELECTRON_RUN_AS_NODE)。本文件零 IO 副作用,可直测。
//
// ⚠ **shell 风格分词已迁出**(迁到 `gates/repo/coverage-baseline-io.mjs` 的 `tokenizeCommand`):
// 它原先只被 c8 探针的 `parseCoverageScript` 用,而那个函数的唯一职责是解析
// package.json 的 `test:coverage` 参数向量 —— 判定本体 `gates/repo/check-coverage-zero.mjs`
// 与探针共用同一份向量,故它必须住在**两者都不依赖沙盒**的地方。留在本文件会让那条共用
// 读取点反向依赖 `contract.mjs`(顶层执行 `topLevel(ROOT)` ⇒ import 即 IO),判定本体就迁不出去。
// 「c8 参数里有引号 glob,按空白裸切会把引号切下来 → glob 失效 → 覆盖率报告为空 → 门禁假绿」
// 这条踩坑记录随函数一起迁到新模块的文件头注,勿在本文件留副本(会漂移)。
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./contract.mjs";

/**
 * node 解释器解析:段内跑在 Electron 里(process.execPath 是 electron.exe),
 * 门禁脚本与 c8 harness 必须由真正的 node 跑,故优先取 npm 注入的解释器路径,
 * 退而求其次用 ELECTRON_RUN_AS_NODE 让当前可执行文件当 node 用。
 * @returns {{ command: string, env: Record<string, string> }} 启动命令与环境覆盖
 */
export function resolveNode() {
  for (const candidate of [process.env.npm_node_execpath, process.env.NODE]) {
    if (typeof candidate === "string" && candidate !== "" && /node(\.exe)?$/i.test(candidate) && fs.existsSync(candidate)) {
      return { command: candidate, env: {} };
    }
  }
  if (/electron(\.exe)?$/i.test(path.basename(process.execPath))) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  return { command: process.execPath, env: {} };
}

/**
 * Electron 可执行文件解析(node_modules/electron 的 path.txt 为准,读不到才退回当前进程)。
 * @returns {string | null} 可执行文件路径;未安装返回 null
 */
export function resolveElectron() {
  const pathTxt = path.join(ROOT, "node_modules", "electron", "path.txt");
  if (fs.existsSync(pathTxt)) {
    const exe = fs.readFileSync(pathTxt, "utf8").trim();
    const full = path.join(ROOT, "node_modules", "electron", "dist", exe);
    if (exe !== "" && fs.existsSync(full)) return full;
  }
  return /electron(\.exe)?$/i.test(path.basename(process.execPath)) ? process.execPath : null;
}

