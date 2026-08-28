/**
 * KaTeX/Mermaid 资源目录解析直测(位于 test/main/ = 主进程层;
 * src/main/services/resource-dirs.ts,经 dist/main/services/resource-dirs.js):
 * dev/test/打包三态路径定位逻辑——打包态无法在测试环境真实模拟,
 * 纯逻辑部分(resolveKatexDir/resolveMermaidDir)以依赖注入参数化覆盖三态分支:
 * - resolveKatexDir(appPath):join(appPath,"node_modules","katex","dist")
 *   dev=项目根 / 打包=.../resources/app.asar(node_modules 随 asar 内置)
 * - resolveMermaidDir(moduleDir):resolve(moduleDir,"..","..","..","node_modules","mermaid","dist")
 *   编译产物恒在 <项目>/dist/main/services/,../../../node_modules 三场景一致(设计见源码头注)
 * 实际态一致性:getKatexDir() === resolveKatexDir(app.getAppPath());
 * getMermaidDir() 在本环境(dev/test 同构)应指向真实存在的 mermaid dist
 * (含 mermaid.min.js,mermaid-service 隐藏窗口 file:// 加载依赖)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { getKatexDir, getMermaidDir, resolveKatexDir, resolveMermaidDir } from "../../dist/main/services/resource-dirs.js";
import { ROOT } from "../common/paths.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`resource-dirs 断言失败:${msg}`);
}

export async function run() {
  // ---- 1. resolveKatexDir 三态参数化 ----
  // dev 态:appPath = 项目根
  assert(
    resolveKatexDir(ROOT) === path.join(ROOT, "node_modules", "katex", "dist"),
    "dev 态(appPath=项目根)应解析到 <项目>/node_modules/katex/dist",
  );
  // 打包态模拟:appPath = resources/app.asar(node_modules 随 asar 内置)
  const asarRoot = path.join(ROOT, "release", "win-unpacked", "resources", "app.asar");
  assert(
    resolveKatexDir(asarRoot) === path.join(asarRoot, "node_modules", "katex", "dist"),
    "打包态(appPath=app.asar)应解析到 app.asar/node_modules/katex/dist",
  );
  console.log("[ok] resource-dirs:resolveKatexDir 三态参数化(dev=项目根/打包=app.asar)");

  // ---- 2. getKatexDir 与纯函数一致(实际态经 app.getAppPath() 注入同一实现) ----
  assert(
    getKatexDir() === resolveKatexDir(app.getAppPath()),
    `getKatexDir 应等于 resolveKatexDir(app.getAppPath()),实际 ${getKatexDir()} vs ${resolveKatexDir(app.getAppPath())}`,
  );
  console.log("[ok] resource-dirs:getKatexDir = resolveKatexDir(app.getAppPath()) 一致");

  // ---- 3. resolveMermaidDir 三态同构(moduleDir 相对定位与启动方式无关) ----
  // dev/test:编译产物在 <项目>/dist/main/services;打包:app.asar/dist/main/services → app.asar/node_modules
  const distMainServicesDev = path.join(ROOT, "dist", "main", "services");
  assert(
    resolveMermaidDir(distMainServicesDev) === path.join(ROOT, "node_modules", "mermaid", "dist"),
    "dev/test 态(moduleDir=<项目>/dist/main/services)应解析到 <项目>/node_modules/mermaid/dist",
  );
  const distMainServicesPackaged = path.join(asarRoot, "dist", "main", "services");
  assert(
    resolveMermaidDir(distMainServicesPackaged) === path.join(asarRoot, "node_modules", "mermaid", "dist"),
    "打包态(moduleDir=app.asar/dist/main/services)应解析到 app.asar/node_modules/mermaid/dist",
  );
  console.log("[ok] resource-dirs:resolveMermaidDir 三态同构(dist/main/services 相对定位)");

  // ---- 4. getMermaidDir 实际态:本环境应指向真实存在的 mermaid dist(含 IIFE 产物) ----
  const mermaidDir = getMermaidDir();
  assert(
    mermaidDir === resolveMermaidDir(path.join(ROOT, "dist", "main", "services")),
    `getMermaidDir 应等于 resolveMermaidDir(<项目>/dist/main/services),实际 ${mermaidDir}`,
  );
  await fs.access(path.join(mermaidDir, "mermaid.min.js")); // 不存在则抛错使段失败
  console.log(`[ok] resource-dirs:getMermaidDir 实际态存在且含 mermaid.min.js(${mermaidDir})`);
}
