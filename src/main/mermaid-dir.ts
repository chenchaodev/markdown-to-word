/**
 * Mermaid 资源目录解析(批次 10 功能 1):
 * 定位 node_modules/mermaid/dist,供隐藏渲染窗口的 <script src="file://..."> 使用
 * (IIFE 产物 mermaid.min.js,file:// 直用,规避 v11 ESM 动态 import 的模块 CORS)。
 * 不依赖 electron app.getAppPath():按模块自身位置定位(import.meta.url)——
 * 编译产物恒在 <项目>/dist/main/ 下,../../node_modules 三场景一致:
 * - dev:`electron .` → <项目>/node_modules
 * - test:`electron test/acceptance.mjs` → 同样 <项目>/node_modules
 * - 打包:模块在 app.asar/dist/main/ 下 → app.asar/node_modules(Electron file
 *   协议对 asar 内 file:// 加载透明支持,与 katex 字体 file:// 化先例一致)
 * 为何偏离 katex-dir.ts 的 app.getAppPath() 模式:实测(2026-08-13)
 * `electron test/acceptance.mjs` 启动时 app.getAppPath() 返回入口脚本所在目录
 * (<项目>/test),非项目根,导致 mermaid.min.js 404、渲染恒失败;mermaid 服务
 * 被 main 层测试真实渲染断言直连,目录必须对启动方式无关。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export function getMermaidDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "node_modules",
    "mermaid",
    "dist",
  );
}
