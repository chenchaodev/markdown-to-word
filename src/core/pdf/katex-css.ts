/**
 * KaTeX CSS 加载:pdf 领域唯一 fs 访问点(依赖注入,默认 node:fs.readFileSync)。
 * 拆自 pdf/template.ts(职责分离:模板结构/CSS 生成/资源加载三分)。
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import type { ConvertWarning } from "../i18n.js";

/** KaTeX CSS 读取依赖(注入点:默认 node:fs.readFileSync,便于测试与无盘环境复用) */
export interface KatexCssDeps {
  read?: (file: string, encoding: "utf8") => string;
}

/** KaTeX CSS 内联:读 katex.min.css,把相对字体引用改写为 file:// 绝对路径
 *  (katex.min.css 用 url(fonts/X.woff2),fonts 与 css 必须同级,file:// 下相对
 *  路径按 html 文件位置解析会失败,须绝对化),并追加打印/超宽保护规则。
 *  读取失败返回空串(公式仍渲染为 KaTeX HTML,仅缺字体样式,不抛错);
 *  传入 warnings 时经 keyed 警告通道上报失败原因(warn.katexCssLoadFailed)。
 *  文件读取经 deps 注入(默认 readFileSync),core 不硬依赖 node:fs。 */
export function loadKatexCss(
  katexDir: string,
  warnings?: ConvertWarning[],
  deps: KatexCssDeps = {},
): string {
  const read = deps.read ?? readFileSync;
  try {
    const fontsBase = path.join(katexDir, "fonts").replace(/\\/g, "/");
    const css = read(path.join(katexDir, "katex.min.css"), "utf8");
    return (
      css.replace(/url\(fonts\//g, `url(file://${fontsBase}/`) +
      "\n/* 打印色彩保真 + 超宽公式保护(KaTeX 超宽溢出固有,保守处理) */\n" +
      "body { print-color-adjust: exact; }\n" +
      ".katex-display { max-width: 100%; overflow-x: auto; }\n"
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnings?.push({
      key: "warn.katexCssLoadFailed",
      params: { error: reason },
      fallback: `KaTeX 样式加载失败,公式字体样式缺失: ${reason}`,
    });
    return "";
  }
}
