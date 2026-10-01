#!/usr/bin/env node
/**
 * 一次性测量:验收段的「每段启动成本」在当前机器上到底是多少(临时测量工具)。
 *
 * 为什么需要在 CI 上测:此前所有地板数字都取自「轮次外单独起 Electron」,
 * 那测的是「独立启动一个 Electron 二进制」,不是「段在编排器里的成本」——
 * 实测该法高估约 4.2 倍(本机得 598ms,而真实轮次内最快段仅 143ms)。
 * 故本脚本按真实口径测:起一个子进程、跑完最小段体、等它退出。
 *
 * 三档对照(每档 N 次,取中位):
 *   node   : 裸 node 冷启 —— 「纯逻辑段迁到纯 node 宿主」后的地板
 *   segnode: node + electron-mock-loader + 跑真实段 run() —— 迁移后的实际段成本
 *   segel  : electron + segment-host + 跑同一条段 —— 现状的段成本
 *
 * 用法:node dev/measure-segment-floor.mjs [样本数]
 * 输出:JSON 打到 stdout,便于从 CI 日志里直接读。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const N = Number(process.argv[2] ?? 5);
/** 取「最轻」的一条段作地板锚点 */
const SEGMENT = path.join(ROOT, "test", "renderer", "init-barrier.test.js");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const ELECTRON_POSIX = path.join(ROOT, "node_modules", "electron", "dist", "electron");

/**
 * 一次计时的中位数。
 * @param {() => void} once 单次执行
 * @param {number} times 次数
 * @returns {{ median: number, all: number[] }} 中位与全部样本
 */
function timeOnce(once, times) {
  const all = [];
  for (let i = 0; i < times; i += 1) {
    const start = Date.now();
    once();
    all.push(Date.now() - start);
  }
  const sorted = [...all].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)] ?? 0, all };
}

const work = mkdtempSync(path.join(os.tmpdir(), "m2w-floor-"));

/** 纯 node 子进程里跑段:注册 mock loader 后 import 段并调用 run()。 */
const nodeRunner = path.join(work, "seg-node.mjs");
writeFileSync(
  nodeRunner,
  [
    'import { register } from "node:module";',
    `register(${JSON.stringify(path.join(ROOT, "test", "common", "electron-mock-loader.mjs"))});`,
    `const mod = await import(${JSON.stringify(SEGMENT)});`,
    "await mod.run();",
    "",
  ].join("\n"),
  "utf8",
);

const electron = process.platform === "win32" && ELECTRON !== "" ? ELECTRON : ELECTRON_POSIX;

const results = {
  node: timeOnce(() => spawnSync(process.execPath, ["-e", ""], { stdio: "ignore", windowsHide: true }), N),
  segnode: timeOnce(
    () => spawnSync(process.execPath, [nodeRunner], { stdio: "ignore", windowsHide: true, timeout: 120_000 }),
    N,
  ),
  segel: timeOnce(
    () =>
      spawnSync(electron, [path.join(ROOT, "test", "common", "segment-host.mjs")], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 120_000,
        env: {
          ...process.env,
          M2W_SEGMENT_FILE: SEGMENT,
          M2W_SEGMENT_RESULT: path.join(work, "r.json"),
          M2W_SEGMENT_USER_DATA: path.join(work, "ud"),
        },
      }),
    N,
  ),
};

rmSync(work, { recursive: true, force: true });

console.log(
  `[floor] n=${N} node=${results.node.median}ms segnode=${results.segnode.median}ms segel=${results.segel.median}ms`,
);
console.log(`[floor] samples ${JSON.stringify(results)}`);
