/**
 * G4:markdown → PDF 渲染管线(markdown-it → HTML 模板 → 主进程 printToPDF)。
 * 调研结论见 docs/RESEARCH.md(G4 调研条目):
 * - markdown-it 核心内置表格/删除线;任务列表用 @mdit/plugin-tasklist
 * - highlight.js 走 lib/common ESM 子集;printToPDF 需 printBackground: true 才有代码底色
 * - 图片统一转 file:// URL(markdown-it 原样输出绝对路径会解析失败)
 * - 任务列表 checkbox 有 Chromium 打印 bug,渲染后用 ☐/☑ 字符替代(打印稳定)
 * B8 拆分:本文件为编排层(选项契约 + markdown-it 组装 + 主流程),渲染规则按
 * 类别拆至 rules/(shared/caption/equation/xref/html/image/heading-id),
 * Mermaid 占位替换拆至 mermaid.ts;依赖方向单向(rules/* → core 共享模块,
 * 本文件 → rules/*,不反向)。CROSS_REF_KINDS 契约 re-export 保留在此,
 * 外部 import 路径不变(contract 断言段依赖 dist/core/pdf/render.js)。
 */
import MarkdownIt from "markdown-it";
import { footnote } from "@mdit/plugin-footnote";
import { tasklist } from "@mdit/plugin-tasklist";
import { katex } from "@mdit/plugin-katex";
import hljs from "highlight.js/lib/common";
// 页面设置契约单源(settings-defaults;原经 convert.js 导入形成 convert⇄render 环,B7 解环)
import {
  DEFAULT_PAGE_SETUP,
  mmToPx,
  PAPER_SIZES_MM,
  type PageSetup,
} from "../settings/settings-defaults.js";
import type { DocMetadata } from "../pipeline/frontmatter.js";
import type { TypographySettings } from "../settings/typography.js";
import { DEFAULT_TYPOGRAPHY } from "../settings/typography.js";
import type { ConvertWarning } from "../i18n.js";
import { highlightFallbackWarning } from "../i18n.js";
import type { MermaidResolver } from "../markdown/mermaid.js";
import { buildCoverHtml, buildTemplate, buildTemplateCss, loadKatexCss } from "./template.js";
import { buildTocHtml, checkLocalImages, embedExternalImages } from "./postprocess.js";
// 契约单源(B7):ImageResolver 类型收敛 core 共享模块(仅类型导入;
// 原 re-export 无外部消费者,CORE-9 清理移除)
import type { ImageResolver } from "../image/image-resolver.js";
import { CROSS_REF_KINDS } from "../markdown/cross-ref.js";
export { CROSS_REF_KINDS };
// 渲染规则(B8 拆分):按 rule 类别分文件,共享工具单源 rules/shared.ts
import { overrideCaptionRule } from "./rules/caption.js";
import { overrideEquationRule } from "./rules/equation.js";
import { overrideXrefRule } from "./rules/xref.js";
import { overrideHtmlRules } from "./rules/html.js";
import { overrideFigureRule, overrideImageRule } from "./rules/image.js";
import { overrideHeadingIdRule } from "./rules/heading-id.js";
import { replaceMermaidPlaceholders } from "./mermaid.js";

export interface RenderPdfHtmlOptions {
  /** markdown 文件所在目录,相对路径图片以此为基准 */
  baseDir: string;
  /** frontmatter 元数据(metadata.title 存在时渲染封面页,标题优先级高于 options.title) */
  metadata?: DocMetadata;
  /** 警告收集(图片加载失败统一文案 imageLoadFailedWarning;缺失本地图/外链下载失败同构;
   *  B6 起元素为 ConvertWarning,keyed 警告经显示层 formatWarning 按语言格式化) */
  warnings?: ConvertWarning[];
  /** 外链图片下载注入(主进程提供;失败返回 null) */
  imageResolver?: ImageResolver;
  /** 页面 <title>,缺省取文件名(不含扩展名) */
  title?: string;
  /** 页面设置(缺省 DEFAULT_PAGE_SETUP) */
  pageSetup?: PageSetup;
  /** 排版设置(缺省 DEFAULT_TYPOGRAPHY):模板 CSS body 字体/字号/行距 + 缩进/对齐 */
  typography?: TypographySettings;
  /** 一级标题前分页(默认关) */
  breakBeforeH1?: boolean;
  /** 标题章节编号(1 / 1.1 / 1.1.1,与 docx 侧 decimal 编号语义一致;
   *  显式传值优先,否则取 typography.headingNumbering;默认开) */
  headingNumbering?: boolean;
  /** 图/表题注自动编号(默认开,取 typography.captionNumbering;显式传值优先) */
  captionNumbering?: boolean;
  /** 自动生成目录页(默认开;开时正文含标题则插入静态目录) */
  toc?: boolean;
  /** 公式编号开关(默认开;关时 eq_numbering 规则仍注册但只隐藏 label 段——
   *  公式不编号、label 不登记、引用保持原文本) */
  equationNumbering?: boolean;
  /** 用户自定义样式 CSS(批次 16:模板导入·CSS 覆盖 pdf 路线;追加到默认模板
   *  CSS 之后,同一 <style> 内后声明覆盖默认样式;缺省/空串不注入) */
  pdfCss?: string;
  /** KaTeX 资源目录(绝对路径,含 katex.min.css 与 fonts/ 子目录,即
   *  node_modules/katex/dist;传入则 katex.min.css 内联进模板并改写字体
   *  为 file:// 绝对路径,公式字体样式生效;不传则公式渲染为 KaTeX HTML
   *  但无字体样式,公式仍显示(缺字形美观度)) */
  katexDir?: string;
  /** Mermaid 图表渲染回调(main 进程隐藏窗口服务注入;缺失时 mermaid 围栏保持
   *  原代码块渲染,行为不变) */
  mermaidResolver?: MermaidResolver;
  /** 渲染子阶段上报(B9 进度分阶段):parse(markdown-it 渲染)/ inline(图片检查
   *  与外链内嵌)/ mermaid(占位替换)/ katex(KaTeX 样式装载)四个阶段键,
   *  经 main/converter.ts 的 onProgress 通道转发为 convert:progress;
   *  缺省不上报,行为不变。 */
  onStage?: (stage: string) => void;
}

/**
 * 任务列表 checkbox → 字符(markdown-it 渲染后替换,规避 Chromium 打印 checkbox bug)。
 * 插件(@mdit/plugin-tasklist,label 默认开)实际输出形态(实证):
 *   <input type="checkbox" class="task-list-item-checkbox" id="task-item-N"
 *          checked="checked" disabled="disabled"><label class="task-list-item-label"
 *          for="task-item-N"> 文本</label>
 * - 属性顺序 type 在前、含 id、布尔属性序列化为 ="…" → 不能用「class 在前 + 裸布尔
 *   属性」正则,改为以 class 定位 input、\schecked 判断选中态;
 * - input 移除后 label 的 for 悬空(指向已删除的 id),属多余结构一并解包(保留文本);
 *   label 文本自带前导空格,故字符后不加空格,输出形如「☑ 已完成」。
 */
function replaceTaskCheckboxes(html: string): string {
  return html
    .replace(/<input[^>]*class="task-list-item-checkbox"[^>]*>/g, (tag) =>
      /\schecked/.test(tag) ? "☑" : "☐",
    )
    .replace(/<label[^>]*class="task-list-item-label"[^>]*>([\s\S]*?)<\/label>/g, "$1");
}

function buildMarkdownIt(
  hasMermaidResolver: boolean,
  headingNumbering: boolean,
  captionNumbering: boolean,
  equationNumbering: boolean,
  warnings: ConvertWarning[],
): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight(str: string, lang?: string): string {
      // Mermaid 围栏(且有 resolver 注入时):不经过 hljs,输出占位 div——
      // 内容是 escapeHtml 后的代码文本(占位内不可能出现原生 </div>,替换正则
      // 非贪婪匹配安全);renderPdfHtml 渲染完后经 mermaidResolver 逐个替换为
      // 内联 SVG(mermaid-svg)/失败降级代码块(mermaid-fallback)。
      // 无 resolver 时不产占位,走原代码块渲染(行为不变)。
      if (lang === "mermaid" && hasMermaidResolver) {
        return `<div class="mermaid">${md.utils.escapeHtml(str)}</div>`;
      }
      if (lang && hljs.getLanguage(lang)) {
        try {
          return (
            `<pre class="hljs"><code class="language-${lang}">` +
            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
            "</code></pre>"
          );
        } catch {
          // B4:语言包异常时回退转义输出 + 上报降级警告(与 docx 侧同 key 同文案口径)
          warnings.push(highlightFallbackWarning(lang));
        }
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
    },
  });
  md.use(tasklist);
  md.use(footnote);
  // 批次 6:公式插件($..$ / $$..$$ / \(..\) / \[..\] / ```math 围栏;throwOnError=false,
  // 渲染失败输出 katex-error 标记,不抛)
  md.use(katex);
  overrideHtmlRules(md);
  overrideCaptionRule(md);
  // 公式编号开关关闭时 eq_numbering 规则仍注册(numbering=false):label 段照常
  // 隐藏(语法标记不显示),但公式不编号(无 eq-block/eq-num 包裹)、label 不登记、
  // [式](#eq:label) 引用保持原文本(与 docx 侧 numbering=false 语义一致)
  overrideEquationRule(md, equationNumbering);
  overrideXrefRule(md, { headingNumbering, captionNumbering });
  return md;
}

/**
 * markdown → 完整 HTML 文档(供 loadFile 后 printToPDF)。
 * 返回 Promise:本地图片存在性检查与外链内嵌经 imageResolver 异步执行。
 */
export async function renderPdfHtml(
  mdSource: string,
  options: RenderPdfHtmlOptions,
): Promise<string> {
  const pageSetup = options.pageSetup ?? DEFAULT_PAGE_SETUP;
  const typography = options.typography ?? DEFAULT_TYPOGRAPHY;
  // 两个编号开关提前计算:core 规则(xref_recognize)与模板 CSS 共用同一取值
  const headingNumbering = options.headingNumbering ?? typography.headingNumbering;
  const captionNumbering = options.captionNumbering ?? typography.captionNumbering;
  const equationNumbering = options.equationNumbering ?? true;
  // B4:warnings 提前创建——buildMarkdownIt 的 highlight 回调需经此上报高亮降级警告
  const warnings: ConvertWarning[] = options.warnings ?? [];
  const md = buildMarkdownIt(
    options.mermaidResolver !== undefined,
    headingNumbering,
    captionNumbering,
    equationNumbering,
    warnings,
  );
  const localImageSrcs: string[] = [];
  // F1:正文内容区宽(px,96dpi)= 内容区 mm ÷ 25.4 × 96(landscape 视觉宽度为
  // 纸高,与 docx 侧 textWidthTwips 同口径);height 百分比属性换算基准
  const paper = PAPER_SIZES_MM[pageSetup.paper];
  const contentWidthPx = mmToPx(
    (pageSetup.orientation === "landscape" ? paper.height : paper.width) -
      pageSetup.marginLeft -
      pageSetup.marginRight,
  );
  overrideImageRule(md, options.baseDir, localImageSrcs, contentWidthPx);
  // F1:独立成段图片段落挂 fig-image 类(模板 CSS 居中),与 docx 侧同契约
  overrideFigureRule(md);
  // seen 生命周期 = 本次渲染闭包,渲染顺序即文档顺序,保证标题 id 文档内唯一
  overrideHeadingIdRule(md, new Map<string, number>());
  // 标题优先级:frontmatter metadata.title > options.title
  const title = options.metadata?.title ?? options.title ?? "文档";
  // warnings 经 env 注入 core 规则(eq_numbering 未知公式标签提示用;脚注插件
  // 对 env.footnotes 惰性初始化,传入额外键无副作用)
  options.onStage?.("parse"); // B9:markdown-it 解析渲染阶段
  const bodyHtml = replaceTaskCheckboxes(md.render(mdSource, { warnings }));
  // M6:本地图片存在性检查并入 resolver 失败路径(单次 IO;HTML 保持 file:// 由 Chromium 渲染)
  options.onStage?.("inline"); // B9:图片检查 + 外链内嵌阶段(两处共用一个阶段键)
  await checkLocalImages(localImageSrcs, options.imageResolver, warnings);
  // Mermaid 占位 → 内联 SVG / 失败降级代码块(异步串行,须在返回 html 前完成)
  options.onStage?.("mermaid"); // B9:Mermaid 占位替换阶段
  const bodyWithMermaid = await replaceMermaidPlaceholders(bodyHtml, options.mermaidResolver, warnings);
  // 封面 + 目录 + 正文:buildCoverHtml/buildTocHtml 各自以 page-break 结尾,
  // 无封面或无目录时返回空串,拼接自然退化为 cover+body / toc+body / body。
  // toc 开关(默认开):关闭时不生成目录页(docx 侧同开关,双格式一致)
  const tocHtml = (options.toc ?? true) ? buildTocHtml(bodyWithMermaid) : "";
  const fullBody = buildCoverHtml(options.metadata) + tocHtml + bodyWithMermaid;
  const processedBody = await embedExternalImages(fullBody, options.imageResolver, warnings);
  options.onStage?.("katex"); // B9:KaTeX 样式装载阶段(loadKatexCss 在 buildTemplate 内执行)
  return buildTemplate(
    processedBody,
    title,
    // 批次 16:用户 CSS 追加到默认 CSS 末尾(同一 <style> 内后声明覆盖默认样式)
    buildTemplateCss(
      pageSetup,
      options.breakBeforeH1 ?? false,
      typography,
      headingNumbering,
      captionNumbering,
      /<h1[\s>]/i.test(bodyHtml),
    ) + (options.pdfCss ? `\n${options.pdfCss}` : ""),
    options.katexDir ? loadKatexCss(options.katexDir, warnings) : "",
  );
}
