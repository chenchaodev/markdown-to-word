/**
 * 文档 chrome 组合根:封面页、目录页、页眉页脚——文档外壳构建逻辑,与正文渲染分离。
 * 不变量:纯 docx 组件构造,无 AST 依赖。
 * 双管线对应:src/core/pdf/template.ts 为 pdf 侧对应文件(封面 buildCoverHtml、
 * 页眉 buildPdfHeaderTemplate、页脚 PDF_FOOTER_TEMPLATE、水印样式/占位内联于
 * buildTemplate;HeaderLogoData 类型单源在本文件,template.ts 导入)。差异:
 * 目录页对侧不在 template.ts——pdf 目录为 pdf/postprocess.ts buildTocHtml
 * (与本侧 renderTocPage 同开关、同取 h1-h3 标题)。字号/灰度对齐点见下方
 * 常量区与 template.ts 内联注(如页眉页脚 7pt / #888888);修改
 * 封面/页眉页脚/水印的外观或开关须同步核对 src/core/pdf/template.ts。
 * 水印的角度口径与不透明度两侧已对齐(adr-030 6-B1/6-B2):角度单源在
 * settings-defaults 的 WATERMARK_ANGLE_SIGN / watermarkDmlRotation,本文件
 * 只消费换算结果;不透明度两侧均真消费(本侧走 w14:textFill/w14:alpha)。
 */
import {
  AlignmentType,
  BuilderElement,
  Drawing,
  Footer,
  Header,
  ImageRun,
  PageBreak,
  PageNumber,
  Paragraph,
  Run,
  TableOfContents,
  TextRun,
  Tab,
  TabStopType,
  VerticalAnchor,
} from "docx";
import { MUTED_TEXT_GRAY, SECONDARY_TEXT_GRAY } from "./theme.js";
import { WATERMARK_GRAY, WATERMARK_INK } from "../style/colors.js";
import type { DocMetadata } from "../pipeline/frontmatter.js";
import { imageSizeFromBuffer } from "../image/image-type.js";
import type { TocMode, WatermarkSettings } from "../settings/settings-defaults.js";
import { watermarkDmlRotation } from "../settings/settings-defaults.js";

/* ---------- chrome 版面常量(字号单位 half-points = pt × 2) ---------- */

/** 封面标题字号:44 = 22pt(与 pdf 封面标题一致) */
const COVER_TITLE_SIZE = 44;
/** 封面 author/date 小字号:22 = 11pt */
const COVER_META_SIZE = 22;
/** 目录页标题字号:36 = 18pt */
const TOC_TITLE_SIZE = 36;
/** 页眉/页脚小字号:14 = 7pt */
const HEADER_FOOTER_SIZE = 14;

/** 静态目录条目(docx 库 ToCEntry 为内部类型未导出,结构兼容即可;
 *  href 为标题书签名(无 # 前缀),hyperlink 开启时条目渲染为可点击跳转) */
export interface TocEntry {
  title: string;
  level: number;
  href: string;
}

/**
 * 封面页:标题居中加粗(44 half-points = 22pt,与 pdf 封面标题字号一致)+
 * 下方 author/date 居中灰色小字;末尾 PageBreak 独占一页。
 * 用普通 Paragraph(不用 HeadingLevel),不进导航窗格/标题层级/书签。
 */
export function renderCoverPage(metadata: DocMetadata): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  // 顶部留白:Word 忽略页首段落的 before 间距,故用空段落撑开(视觉居中)
  paragraphs.push(new Paragraph({ spacing: { after: 2400 }, children: [] }));
  paragraphs.push(new Paragraph({ spacing: { after: 2400 }, children: [] }));
  paragraphs.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 600 },
      children: [new TextRun({ text: metadata.title ?? "", bold: true, size: COVER_TITLE_SIZE })],
    }),
  );
  if (metadata.author) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 120 },
        children: [new TextRun({ text: metadata.author, color: SECONDARY_TEXT_GRAY, size: COVER_META_SIZE })],
      }),
    );
  }
  if (metadata.date) {
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: metadata.date, color: SECONDARY_TEXT_GRAY, size: COVER_META_SIZE })],
      }),
    );
  }
  paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
  return paragraphs;
}

/**
 * 目录页:标题居中加粗(36 half-points = 18pt)+ 目录,独占一页。
 * 标题用普通 Paragraph(不用 HeadingLevel,避免被 TOC 域 \o "1-3" 收集到目录自身)。
 * 两种模式:
 * - static(默认,免更新路线):beginDirty:false + 隐藏页码(tab+\z),打开即见静态条目
 *   (纯超链接、无页码),不弹「更新域」提示;条目引用 TOC1..TOC9 样式 + 右对齐点线制表位。
 * - field(Word 域目录):保留 cachedEntries 作初始显示,beginDirty:true 触发 Word/WPS
 *   打开时更新域提示,更新后注入真实页码;不隐藏页码(\z=false)。
 */
export function renderTocPage(
  entries: TocEntry[],
  tocMode: TocMode,
): (Paragraph | TableOfContents)[] {
  const field = tocMode === "field";
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 480 },
      children: [new TextRun({ text: "目录", bold: true, size: TOC_TITLE_SIZE })],
    }),
    new TableOfContents("目录", {
      hyperlink: true, // \h
      headingStyleRange: "1-3", // \o "1-3"
      useAppliedParagraphOutlineLevel: true, // \u
      hideTabAndPageNumbersInWebView: !field, // \z:静态模式隐藏页码占用(web 视图),域目录模式下显示
      beginDirty: field, // 域目录:标记 dirty,Word/WPS 打开弹更新提示并注入真实页码
      cachedEntries: entries,
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

/** 页眉:文档标题居中灰色小字(HEADER_FOOTER_SIZE = 7pt,颜色 MUTED_TEXT_GRAY);无标题时不调用 */

/**
 * 页眉 logo 已读数据:core 层零 IO——文件读取在 main 层,此处只收字节+类型。
 * extension 为魔数嗅探结果(sniffImageType);webp/null 由消费方(render.ts)降级告警。
 */
export interface HeaderLogoData {
  data: Uint8Array;
  extension: "png" | "jpg" | "gif" | "webp" | null;
}

/** 页眉内容:title=现状行为(标题居中)/custom=自定义文字+logo */
export type HeaderContent =
  | { kind: "title"; title: string }
  | {
      kind: "custom";
      /** 已 trim 的自定义文字(空串 = 只显示 logo) */
      text: string;
      logo?: HeaderLogoData;
      layout: "center" | "leftRight";
    };

/** 页眉 logo 显示尺寸上限(px):等比缩小不放大;尺寸不可解析时兜底正方形 */
const HEADER_LOGO_MAX_HEIGHT_PX = 20;
const HEADER_LOGO_MAX_WIDTH_PX = 120;
const HEADER_LOGO_FALLBACK_PX = 20;

/** 页眉 logo ImageRun:按像素上限等比缩放(不放大),字号/颜色无关(图片 run) */
function headerLogoRun(logo: HeaderLogoData): ImageRun {
  const natural =
    imageSizeFromBuffer(Buffer.from(logo.data)) ??
    { width: HEADER_LOGO_FALLBACK_PX, height: HEADER_LOGO_FALLBACK_PX };
  const scale = Math.min(
    1,
    HEADER_LOGO_MAX_HEIGHT_PX / natural.height,
    HEADER_LOGO_MAX_WIDTH_PX / natural.width,
  );
  return new ImageRun({
    // 调用方已保证 extension ∈ png/jpg/gif(webp/null 在 render.ts 降级)
    type: logo.extension as "png" | "jpg" | "gif",
    data: logo.data,
    transformation: {
      width: Math.max(1, Math.round(natural.width * scale)),
      height: Math.max(1, Math.round(natural.height * scale)),
    },
  });
}

/**
 * 页眉构建:
 * - title:现状行为回归——标题居中灰色小字
 * - custom + center:logo 与文字同行居中(logo 在前,与文字间留一个空格)
 * - custom + leftRight:右对齐制表位实现左右分栏(不用表格)——logo 靠左、
 *   文字靠右;无 logo 时文字自然靠左(段落起点即左边界),制表位保留无副作用
 * 字体不显式指定:继承文档默认(typography 设置),避免散落硬编码。
 */
export function renderHeader(content: HeaderContent, contentWidthTwips: number): Header {
  if (content.kind === "title") {
    return new Header({
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: content.title, size: HEADER_FOOTER_SIZE, color: MUTED_TEXT_GRAY })],
      })],
    });
  }
  const textStyle = { size: HEADER_FOOTER_SIZE, color: MUTED_TEXT_GRAY } as const;
  const logoRun = content.logo ? headerLogoRun(content.logo) : null;
  const textRun = content.text
    ? new TextRun({ text: content.text, ...textStyle })
    : null;
  if (content.layout === "leftRight") {
    const children: (ImageRun | TextRun)[] = [];
    if (logoRun) children.push(logoRun);
    if (logoRun && textRun) {
      // Tab run 把后续文字推到右对齐制表位(位置 = 正文可用宽度)
      children.push(new TextRun({ children: [new Tab()], ...textStyle }));
    }
    if (textRun) children.push(textRun);
    return new Header({
      children: [new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: contentWidthTwips }],
        children,
      })],
    });
  }
  // center:logo 与文字同行居中;两者并存时文字前补一个空格分隔
  const centerChildren: (ImageRun | TextRun)[] = [];
  if (logoRun) centerChildren.push(logoRun);
  if (textRun) {
    centerChildren.push(
      logoRun
        ? new TextRun({ text: ` ${content.text}`, ...textStyle })
        : textRun,
    );
  }
  return new Header({
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: centerChildren })],
  });
}

/** 页脚:第 X 页 / 共 X 页 居中(与 PDF footerTemplate 文案一致;PageNumber 域);
 *  footerEnabled=false 时由调用方(render.ts)不装配 footers,本函数保持无参 */
export function renderFooter(): Footer {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "第 ", size: HEADER_FOOTER_SIZE, color: MUTED_TEXT_GRAY }),
        new TextRun({ size: HEADER_FOOTER_SIZE, color: MUTED_TEXT_GRAY, children: [PageNumber.CURRENT] }),
        new TextRun({ text: " 页 / 共 ", size: HEADER_FOOTER_SIZE, color: MUTED_TEXT_GRAY }),
        new TextRun({ size: HEADER_FOOTER_SIZE, color: MUTED_TEXT_GRAY, children: [PageNumber.TOTAL_PAGES] }),
        new TextRun({ text: " 页", size: HEADER_FOOTER_SIZE, color: MUTED_TEXT_GRAY }),
      ],
    })],
  });
}

/**
 * 文字水印段落:使用 DrawingML(DML) 文本框(wps:wsp)实现旋转水印。
 * VML v:shape 的 rotation 属性在多数 Word 版本中对 v:textbox 内容无效——
 * 文字始终水平;DML 的 a:xfrm rot 属性是 Word 原生水印使用的标准机制,
 * 文字随形状一起旋转,可靠支持任意角度。
 *
 * 结构:Paragraph > Run > Drawing > wp:anchor(behindDoc) > a:graphic >
 *   a:graphicData(wps) > wps:wsp > wps:txbx > w:txbxContent > content
 *   + wps:bodyPr(anchor=ctr) + wps:spPr > a:xfrm(rot)
 *
 * - 无边框:不设置 outline/solidFill → DML 默认无描边
 * - 页面居中:wp:positionH/positionV relativeFrom="page" align="center"
 * - 置底:behindDocument=true
 * - 旋转:rot 取自 watermarkDmlRotation(角度口径与 pdf 侧同源单点,勿在此取负)
 * - 不透明度:经 w14:textFill/w14:alpha 真消费 watermark.opacity(见 WatermarkTextRun)
 */

/** w14:alpha 的单位:100000 = 100% */
const W14_ALPHA_FULL_SCALE = 100_000;

/**
 * 构造 w14 命名空间下的元素(docx 库未暴露文字填充选项,只能自建)。
 * 属性名含前缀且须写成 {key,value} 载荷,故与普通元素分开走这个薄封装。
 */
function w14El(
  name: string,
  attributes?: Record<string, string | number>,
  children?: BuilderElement[],
): BuilderElement {
  const entries = Object.entries(attributes ?? {});
  return new BuilderElement({
    name,
    // 属性为空时不传:空对象会产出一个无属性的 NextAttributeComponent
    ...(entries.length > 0
      ? { attributes: Object.fromEntries(entries.map(([k, v]) => [k, { key: k, value: v }])) }
      : {}),
    ...(children ? { children } : {}),
  });
}

/**
 * 带透明度填充的水印文字 run。
 *
 * 为什么不能靠调浅灰色「近似」:不透明度是独立于取色的一维,配色只能拟合某一个
 * 取值,用户把 opacity 调大或 gray 切 false 时就对不上 —— 那与「完全不消费该设置」
 * 是同一类失效,只是更隐蔽。
 *
 * 表达方式:WordprocessingML 里文字透明度的标准字段是 `w14:textFill`(2010 扩展),
 * 其 `w14:solidFill/w14:srgbClr` 下挂 `w14:alpha`(百分比千分比);docx 9.x 未暴露
 * 该选项,故用 BuilderElement 自建并挂进 RunProperties(库内该字段是 protected,
 * 子类内可见 —— 这是不走 ImportedXmlComponent 的原因:后者会绕开 run 属性的构造,
 * 且实测产出的元素名丢失)。
 *
 * `w:color` 仍同时保留:它是 w14 不可读时的回退,保证无 w14 支持的消费者仍有配色。
 */
class WatermarkTextRun extends TextRun {
  constructor(options: ConstructorParameters<typeof TextRun>[0], opacity: number) {
    super(options);
    const color = String((options as { color?: string }).color ?? "000000");
    const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * W14_ALPHA_FULL_SCALE);
    this.properties.push(
      w14El("w14:textFill", undefined, [
        w14El("w14:solidFill", undefined, [
          w14El("w14:srgbClr", { "w14:val": color }, [
            w14El("w14:alpha", { "w14:val": alpha }),
          ]),
        ]),
      ]),
    );
  }
}

let watermarkShapeSeq = 0;
export function renderWatermarkParagraph(watermark: WatermarkSettings): Paragraph {
  const color = watermark.gray ? WATERMARK_GRAY : WATERMARK_INK;
  const run = new WatermarkTextRun(
    { text: watermark.text, size: 144, color, bold: true },
    watermark.opacity,
  );
  const contentPara = new Paragraph({ alignment: AlignmentType.CENTER, children: [run] });
  // 600pt × 200pt → EMU (1pt = 12700 EMU)
  const widthEmu = 7_620_000;
  const heightEmu = 2_540_000;
  // 旋转量的符号与单位换算单源在 settings-defaults(watermarkDmlRotation):
  // 两侧同号,docx 侧方向待人工渲染确认时只改那一个常量,勿在此处取负
  const rot = watermarkDmlRotation(watermark.angle);
  const seq = watermarkShapeSeq++;
  const drawing = new Drawing(
    {
      type: "wps",
      transformation: {
        pixels: { x: 800, y: 267 },
        emus: { x: widthEmu, y: heightEmu },
        rotation: rot,
      },
      data: {
        children: [contentPara],
        bodyProperties: {
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          verticalAnchor: VerticalAnchor.CENTER,
        },
      },
    },
    {
      floating: {
        horizontalPosition: { relative: "page", align: "center" },
        verticalPosition: { relative: "page", align: "center" },
        behindDocument: true,
        zIndex: 0,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      docProperties: { title: `watermark-${seq}`, name: `Watermark${seq}` },
    },
  );
  return new Paragraph({ children: [new Run({ children: [drawing] })] });
}
