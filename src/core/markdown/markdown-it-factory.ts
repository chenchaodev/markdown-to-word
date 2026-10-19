/**
 * markdown-it 基础实例工厂:pdf 管线与剪贴板管线共用的**解析底座**。
 *
 * 这里只装两侧语义一致的三件事:MarkdownIt 选项(html/linkify/typographer)、
 * 任务列表插件、脚注插件、公式插件(资源边界单源 core/resource-limits.ts)。
 * 各管线自己的渲染规则(题注/公式编号/交叉引用/HTML/图片/表格/标题 id 等)
 * 仍留在各自目录 —— 它们语义并不一致,抽进来只会把两条管线的差异挤成 if 分支。
 *
 * 为什么要有这个文件:剪贴板路径不得 import `core/pdf/**`(两条渲染路径独立),
 * 而「同一套 markdown 语法识别」是它们必须共享的事实。此处的 `highlight` 与
 * `katex` 是仅有的差异项:pdf 把 highlight 回调交给 hljs,剪贴板不需要高亮;
 * katex 默认开启,剪贴板随后覆盖 math_inline/math_block 的渲染规则降级为 TeX 源码
 * (识别语法 ≠ 输出 KaTeX DOM)。
 */
import MarkdownIt from "markdown-it";
import { footnote } from "@mdit/plugin-footnote";
import { tasklist } from "@mdit/plugin-tasklist";
import { katex } from "@mdit/plugin-katex";
import { DEFAULT_KATEX_RESOURCE_LIMITS } from "../resource-limits.js";

/** 两侧仅允许存在的差异项(新增差异必须同时说明为何不能共享) */
export interface MarkdownItFactoryOptions {
  /** 代码围栏高亮回调(pdf 用 hljs;剪贴板不传,围栏由其自己的渲染规则接管) */
  highlight?: (str: string, lang?: string) => string;
  /** 是否注册 @mdit/plugin-katex(默认 true;false 仅用于不需要公式语法的调用方) */
  katex?: boolean;
}

/**
 * 创建两侧共用的 markdown-it 基础实例。
 *
 * 注册顺序(tasklist → footnote → katex)与抽取前 pdf/render.ts 的 buildMarkdownIt
 * 逐字一致;pdf 侧后续再注册 guardUntrustedMath 与 rules/*,行为不变。
 */
export function createBaseMarkdownIt(options: MarkdownItFactoryOptions = {}): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    ...(options.highlight ? { highlight: options.highlight } : {}),
  });
  md.use(tasklist);
  md.use(footnote);
  if (options.katex !== false) md.use(katex, DEFAULT_KATEX_RESOURCE_LIMITS);
  return md;
}
