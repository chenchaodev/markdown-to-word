/**
 * pdf 图片规则:
 * 1. 路径改写:相对/绝对路径统一转 file:// URL,本地 src 收集供存在性检查;
 * 2. 尺寸属性:image 后紧跟的完整 {width=…}/{height=…} 属性块文本
 *    (core/markdown/image-size.ts 单源解析)注入 style——width 百分比原样注入
 *    (CSS 相对容器宽,与「百分比=相对正文内容宽度」语义天然一致);height 百分比
 *    按内容宽换算为 px 注入(打印场景 CSS height 百分比相对容器高、容器高度不定,
 *    与语义不符);px 值原样注入。属性文本从输出中剥除;非法值走 keyed 警告;
 * 3. figure 识别:独立成段的图片段落挂 p.fig-image 类(模板 CSS 居中),
 *    与 docx 侧 isFigureParagraph 同契约(镜像实现,输入为 markdown-it token 流)。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type MarkdownIt from "markdown-it";
import { parseImageSizeAttrs, type ImageDim } from "../../markdown/image-size.js";
import { imageAttrInvalidWarning } from "../../image/image-warning.js";
import { createDepthTracker } from "./shared.js";
import type { ConvertWarning } from "../../i18n.js";

/** 结构化最小契约(与仓库惯例一致,不直接 import markdown-it Token 类型):
 *  applySizeAttrs 只依赖 attrSet 与兄弟 text token 的 type/content。 */
interface StyleToken {
  attrSet(name: string, value: string): void;
}
interface TextLikeToken {
  type: string;
  content: string;
}

/** 图片规则:相对/绝对路径统一转 file:// URL,http(s) 保留原样。
 *  本地 src(保持 markdown 原文)收集到 localSrcs,供 checkLocalImages
 *  经 resolver 做存在性检查(单次 IO,替代 convert 层 stat 预扫)。
 *  contentWidthPx:正文内容区宽(px,96dpi;render.ts 按 pageSetup 计算),
 *  height 百分比换算基准。 */
export function overrideImageRule(
  md: MarkdownIt,
  baseDir: string,
  localSrcs: string[],
  contentWidthPx: number,
): void {
    const defaultRule = md.renderer.rules.image;
    if (!defaultRule) return; // markdown-it 内置 image 规则,理论不可达
    // 非法属性警告去重(pdf 侧自建 Set 口径,与 equation.ts/xref.ts unknownLabels 一致)
    const warned = new Set<string>();
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx]!; // 渲染器契约:idx 必为有效下标
      const src = token.attrGet("src") ?? "";
      if (src && !/^(https?:|data:)/i.test(src)) {
        localSrcs.push(src);
        const abs = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
        token.attrSet("src", pathToFileURL(abs).href);
      }
      applySizeAttrs(token, tokens[idx + 1], src, contentWidthPx, env, warned);
      return defaultRule(tokens, idx, options, env, self);
    };
}

/** 维度 → CSS 声明:% 宽度相对容器宽原样注入;height % 换算 px(见文件头注释 2)。 */
function dimToCss(prop: "width" | "height", dim: ImageDim, contentWidthPx: number): string {
  if (dim.unit === "px") return `${prop}:${Math.round(dim.value)}px`;
  if (prop === "width") return `width:${dim.value}%`;
  return `height:${Math.round((dim.value / 100) * contentWidthPx)}px`;
}

/**
 * 尾随尺寸属性消费:image 的下一个兄弟 text token 恰为完整 {…} 属性块时,
 * 解析结果注入 style、属性文本剥除(next.content = "");无尺寸键的花括号文本
 * 原样保留。非法值经 env.warnings 上报 keyed 警告(warned 按 src+attr 去重)。
 */
function applySizeAttrs(
  token: StyleToken,
  next: TextLikeToken | undefined,
  src: string,
  contentWidthPx: number,
  env: unknown,
  warned: Set<string>,
): void {
  if (!next || next.type !== "text") return;
  const parsed = parseImageSizeAttrs(next.content);
  if (!parsed.hasSizeKeys) return;
  const warnings = (env as { warnings?: ConvertWarning[] }).warnings;
  for (const raw of parsed.invalid) {
    const dedupKey = `${src}:${raw}`;
    if (!warned.has(dedupKey)) {
      warned.add(dedupKey);
      warnings?.push(imageAttrInvalidWarning(src, raw));
    }
  }
  const style: string[] = [];
  if (parsed.attrs.width) style.push(dimToCss("width", parsed.attrs.width, contentWidthPx));
  if (parsed.attrs.height) style.push(dimToCss("height", parsed.attrs.height, contentWidthPx));
  if (style.length > 0) token.attrSet("style", style.join(";"));
  next.content = ""; // 属性文本剥除(不再作为可见文本渲染)
}

/**
 * figure 识别:顶层「段落唯一内容是图片(+尾随尺寸属性块)」→ paragraph_open
 * 挂 fig-image 类(模板 CSS 居中 + 取消首行缩进)。与 docx 侧 isFigureParagraph
 * 同契约:仅顶层段落(容器深度限制,blockquote/list 内不识别,与 docx 侧只遍历
 * ast.children 顶层一致);tight list 的 hidden 隐式段落同样排除。
 */
export function overrideFigureRule(md: MarkdownIt): void {
  md.core.ruler.push("figure_recognize", (state) => {
    const tokens = state.tokens;
    const depth = createDepthTracker();
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      depth.feed(tok.type);
      if (tok.type !== "inline" || !tok.children || tok.children.length === 0 || !depth.isTopLevel()) continue;
      const children = tok.children;
      // 尾随纯空白 text token 不计入内容(与 docx 侧 isFigureParagraph 同口径)
      let end = children.length;
      const last = children[end - 1];
      if (end > 1 && last?.type === "text" && last.content.trim() === "") end--;
      if (end === 0 || end > 2) continue;
      if (children[0]!.type !== "image") continue;
      if (end === 2) {
        const tail = children[1]!;
        if (tail.type !== "text" || !parseImageSizeAttrs(tail.content).hasSizeKeys) continue;
      }
      const open = tokens[i - 1];
      if (open?.type === "paragraph_open" && !open.hidden) open.attrJoin("class", "fig-image");
    }
  });
}