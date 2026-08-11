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

export function getKatexDir(): string {
  return path.join(app.getAppPath(), "node_modules", "katex", "dist");
}
