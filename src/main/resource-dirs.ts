/**
 * 资源目录解析单一来源(目录重组批⑤由 katex-dir.ts + mermaid-dir.ts 合并):
 * 两者的定位策略刻意不同,合并同文件便于对照维护——
 *
 * KaTeX:全仓库唯一持有 electron app.getAppPath() 依赖的位置——app.getAppPath() 保证
 * dev/打包一致(打包后 node_modules 随 asar 内置);docx 走 MathML 不需要,
 * 仅 pdf 渲染加载 katex.min.css 与字体用(批次 6)。
 * converter(convertImpl/buildConvertContext)不 import electron app,
 * katexDir 由调用方(main 入口层:index.ts / smoke)经 getKatexDir() 计算后传入,
 * 便于 convertImpl 脱离 Electron 直测。
 *
 * Mermaid:定位 node_modules/mermaid/dist,供隐藏渲染窗口的 <script src="file://..."> 使用
 * (IIFE 产物 mermaid.min.js,file:// 直用,规避 v11 ESM 动态 import 的模块 CORS)。
 * 不依赖 electron app.getAppPath():按模块自身位置定位(import.meta.url)——
 * 编译产物恒在 <项目>/dist/main/ 下,../../node_modules 三场景一致:
 * - dev:`electron .` → <项目>/node_modules
 * - test:`electron test/acceptance.mjs` → 同样 <项目>/node_modules
 * - 打包:模块在 app.asar/dist/main/ 下 → app.asar/node_modules(Electron file
 *   协议对 asar 内 file:// 加载透明支持,与 katex 字体 file:// 化先例一致)
 * 为何偏离 getKatexDir 的 app.getAppPath() 模式:实测(2026-08-13)
 * `electron test/acceptance.mjs` 启动时 app.getAppPath() 返回入口脚本所在目录
 * (<项目>/test),非项目根,导致 mermaid.min.js 404、渲染恒失败;mermaid 服务
 * 被 main 层测试真实渲染断言直连,目录必须对启动方式无关。
 */
import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---------- KaTeX(app.getAppPath() 定位) ---------- */

/** 纯路径解析(appPath 注入,三态可参数化直测):
 * - dev:`electron .` → appPath = 项目根 → <项目>/node_modules/katex/dist
 * - test:`electron test/acceptance.mjs` → appPath = 入口脚本目录(实测非项目根,
 *   见下方 Mermaid 说明;调用方按需传 KATEX_DIR 等价路径)
 * - 打包:appPath = .../resources/app.asar(node_modules 随 asar 内置) */
export function resolveKatexDir(appPath: string): string {
  return path.join(appPath, "node_modules", "katex", "dist");
}

export function getKatexDir(): string {
  return resolveKatexDir(app.getAppPath());
}

/* ---------- Mermaid(import.meta.url 相对定位) ---------- */

/** 纯路径解析(moduleDir 注入,三态可参数化直测):编译产物恒在 <项目>/dist/main/
 * 下,../../node_modules 三场景一致(dev/test/打包,见头注)。 */
export function resolveMermaidDir(moduleDir: string): string {
  return path.resolve(moduleDir, "..", "..", "node_modules", "mermaid", "dist");
}

export function getMermaidDir(): string {
  return resolveMermaidDir(path.dirname(fileURLToPath(import.meta.url)));
}
