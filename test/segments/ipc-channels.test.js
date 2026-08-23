/**
 * IPC channel 单源恒等性断言(B12「IPC 面整理」):
 * - main 侧单源:dist/main/ipc/channels.js 的 IPC_CHANNELS(命名统一「域:动作」);
 * - preload 侧镜像:preload.cts 因沙箱隔离(sandbox:true 下 preload.cjs 运行时
 *   只能 require electron)无法 import ESM 常量模块,侧内镜像同名常量;
 * - 本段对 dist/main/preload.cjs 文本提取全部 ipcRenderer.invoke/on/removeListener
 *   的 channel 字面量,与单源做双向集合恒等断言,防两侧漂移;
 * - 附「域:动作」命名形状断言(域在前 + 冒号分隔),防新 channel 回退混名序。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC_CHANNELS } from "../../dist/main/ipc/channels.js";

const distMain = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "dist",
  "main",
);

export async function run() {
  // ---- 命名形状:「域:动作」(域在前,冒号分隔,两段均非空且无再多冒号) ----
  for (const [key, value] of Object.entries(IPC_CHANNELS)) {
    if (!/^[A-Za-z][\w-]*:[A-Za-z][\w-]*$/.test(value)) {
      throw new Error(`ipc-channels 断言失败:${key}="${value}" 不符合「域:动作」命名`);
    }
  }
  console.log("[ok] ipc-channels:全部 channel 符合「域:动作」命名 断言通过");

  // ---- preload 侧镜像对象提取与恒等(双向键值一致) ----
  // tsc 编译不内联 const 对象属性访问,preload.cjs 内保留镜像对象字面量本体,
  // 直接解析其键值对与单源比对(比逐调用点提字面量更严:镜像对象即全部 channel)。
  const preloadSrc = fs.readFileSync(path.join(distMain, "preload.cjs"), "utf8");
  const mirrorMatch = preloadSrc.match(/const CH = \{([\s\S]*?)\};/);
  if (!mirrorMatch) {
    throw new Error("ipc-channels 断言失败:preload.cjs 未找到 CH 镜像对象(产物结构变化)");
  }
  const mirror = {};
  for (const m of mirrorMatch[1].matchAll(/(\w+):\s*"([^"]+)"/g)) {
    mirror[m[1]] = m[2];
  }
  if (Object.keys(mirror).length === 0) {
    throw new Error("ipc-channels 断言失败:CH 镜像对象未解析到任何键值对");
  }
  const sourceEntries = Object.entries(IPC_CHANNELS);
  for (const [key, value] of sourceEntries) {
    if (mirror[key] !== value) {
      throw new Error(
        `ipc-channels 断言失败:preload 镜像 ${key}="${mirror[key]}" 与单源 "${value}" 漂移`,
      );
    }
  }
  for (const key of Object.keys(mirror)) {
    if (!(key in IPC_CHANNELS)) {
      throw new Error(`ipc-channels 断言失败:preload 镜像多出单源没有的键 "${key}"`);
    }
  }
  console.log(`[ok] ipc-channels:preload 镜像与单源恒等(${sourceEntries.length} 个 channel 键值一致) 断言通过`);

  // ---- preload 调用点抽查:invoke/on/removeListener 不应出现裸字符串 channel ----
  // 全部必须经 CH.* 引用(防绕过镜像直接写字面量、绕开恒等断言)
  for (const m of preloadSrc.matchAll(/\b(?:invoke|on|removeListener)\((["'])([^"']+)\1/g)) {
    throw new Error(`ipc-channels 断言失败:preload 出现裸字符串 channel "${m[2]}"(应经 CH.* 引用)`);
  }

  // ---- main 侧接线抽查:dist/main 全部产物不应残留旧字面量(handle 全部经 CH.* 引用) ----
  // 目录重组批④后 handle 注册分散在 dist/main(含 ipc/、windows/ 子目录),递归全扫
  const mainFiles = fs.readdirSync(distMain, { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith(".js"))
    .map((rel) => path.join(distMain, rel));
  const legacy = [
    "dialog:openMarkdowns",
    "dialog:selectDir",
    "paths:collectMarkdown",
    "paths:filterExisting",
    "import:pdf-css",
    "shell:reveal",
    "shell:open",
    "batch:progress",
  ];
  for (const file of mainFiles) {
    const src = fs.readFileSync(file, "utf8");
    for (const old of legacy) {
      if (src.includes(`"${old}"`)) {
        throw new Error(`ipc-channels 断言失败:${path.basename(file)} 残留旧 channel 字面量 "${old}"`);
      }
    }
  }
  console.log("[ok] ipc-channels:dist/main 全部产物无旧 channel 字面量残留 断言通过");
}
