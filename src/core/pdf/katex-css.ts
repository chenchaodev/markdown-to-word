/**
 * KaTeX CSS 加载:读 katex.min.css 并改写字体引用为绝对 file:// 路径。
 * 拆自 pdf/template.ts(职责分离:模板结构/CSS 生成/资源加载三分)。
 *
 * REF-025 #07:`read` 由**必填**入参注入,本模块不再 import node:fs。
 * 此前这里是 core/pdf 子树里唯一直接 import node:fs 的地方(默认 readFileSync),
 * 使「core 的 pdf 渲染路径不做文件 IO」无法成为门禁可断言的不变量。
 * 注入方为 core/pdf/render.ts,能力来自 main 层。
 */
import path from "node:path";
import type { ConvertWarning } from "../i18n/index.js";

/** KaTeX CSS 读取依赖(`read` 必填:本模块不持有任何 node:fs 能力) */
export interface KatexCssDeps {
  read: (file: string, encoding: "utf8") => string;
}

/** KaTeX CSS 内联:读 katex.min.css,把相对字体引用改写为 file:// 绝对路径
 *  (katex.min.css 用 url(fonts/X.woff2),fonts 与 css 必须同级,file:// 下相对
 *  路径按 html 文件位置解析会失败,须绝对化),并追加打印/超宽保护规则。
 *  读取失败返回空串(公式仍渲染为 KaTeX HTML,仅缺字体样式,不抛错);
 *  传入 warnings 时经 keyed 警告通道上报失败原因(warn.katexCssLoadFailed)。 */
export function loadKatexCss(
  katexDir: string,
  warnings: ConvertWarning[] | undefined,
  deps: KatexCssDeps,
): string {
  const { read } = deps;
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
