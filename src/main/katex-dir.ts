/**
 * KaTeX 资源目录解析(R10-1 从 converter.ts 抽出):
 * 全仓库唯一持有 electron app.getAppPath() 依赖的位置——app.getAppPath() 保证
 * dev/打包一致(打包后 node_modules 随 asar 内置);docx 走 MathML 不需要,
 * 仅 pdf 渲染加载 katex.min.css 与字体用(批次 6)。
 * converter.ts(convertImpl/buildConvertContext)不 import electron app,
 * katexDir 由调用方(main 入口层:index.ts / smoke.ts)经 getKatexDir() 计算后传入,
 * 便于 convertImpl 脱离 Electron 直测。
 */
import { app } from "electron";
import path from "node:path";

/** 纯路径解析(appPath 注入,三态可参数化直测):
 * - dev:`electron .` → appPath = 项目根 → <项目>/node_modules/katex/dist
 * - test:`electron test/acceptance.mjs` → appPath = 入口脚本目录(实测非项目根,
 *   见 mermaid-dir.ts 头注;调用方按需传 KATEX_DIR 等价路径)
 * - 打包:appPath = .../resources/app.asar(node_modules 随 asar 内置) */
export function resolveKatexDir(appPath: string): string {
  return path.join(appPath, "node_modules", "katex", "dist");
}

export function getKatexDir(): string {
  return resolveKatexDir(app.getAppPath());
}
