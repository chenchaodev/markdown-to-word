// 解释器/可执行文件解析与命令行分词。被测门禁必须在**正确的宿主**里跑,否则测到的是
// 「用 Electron 当 node 跑脚本」这类假故障:node 解析要兼容「段内跑在 Electron 里」
// (ELECTRON_RUN_AS_NODE),分词要处理 c8 参数里的引号 glob(按空白裸切会把引号切下来,
// glob 失效 → 覆盖率报告为空 → 门禁假绿)。本文件零 IO 副作用,可直测。
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

/**
 * shell 风格分词:双引号内为字面量(含 = 与通配符),其余按空白切。
 * c8 参数向量里有 `--include="dist/**"`,按空白裸切会连引号一起切下来导致 glob 失效。
 * @param {string} input 命令行
 * @returns {string[]} 参数序列
 */
export function tokenizeCommand(input) {
  /** @type {string[]} */
  const tokens = [];
  let current = "";
  let inQuote = false;
  let started = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuote = !inQuote;
      started = true;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}
