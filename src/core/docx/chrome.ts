/**
 * 文档 chrome(B8 拆分):封面页、目录页、页眉页脚——文档「外壳」构建逻辑,
 * 与正文渲染(render.ts)分离。纯 docx 组件构造,无 AST 依赖。
 */
import {
  AlignmentType,
  Footer,
  Header,
  ImageRun,
  PageBreak,
  PageNumber,
  Paragraph,
  TableOfContents,
  TextRun,
  Tab,
  TabStopType,
} from "docx";
import { MUTED_TEXT_GRAY, SECONDARY_TEXT_GRAY } from "./theme.js";
import type { DocMetadata } from "../pipeline/frontmatter.js";
import { imageSizeFromBuffer } from "../image/image-type.js";

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
 * 目录页:标题居中加粗(36 half-points = 18pt)+ 静态目录,独占一页。
 * 标题用普通 Paragraph(不用 HeadingLevel,避免被 TOC 域 \o "1-3" 收集到目录自身)。
 * 免更新路线(beginDirty:false + cachedEntries):打开即见静态条目(纯超链接、
 * 无页码),不弹「更新域」提示;条目引用 TOC1..TOC9 样式 + 右对齐点线制表位。
 */
export function renderTocPage(entries: TocEntry[]): (Paragraph | TableOfContents)[] {
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
      hideTabAndPageNumbersInWebView: true, // \z
      beginDirty: false, // 免更新:不标记 dirty,打开不提示
      cachedEntries: entries,
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

/** 页眉:文档标题居中灰色小字(HEADER_FOOTER_SIZE = 7pt,颜色 MUTED_TEXT_GRAY);无标题时不调用 */

/**
 * 页眉 logo 已读数据(F4;core 层零 IO——文件读取在 main 层,此处只收字节+类型)。
 * extension 为魔数嗅探结果(sniffImageType);webp/null 由消费方(render.ts)降级告警。
 */
export interface HeaderLogoData {
  data: Uint8Array;
  extension: "png" | "jpg" | "gif" | "webp" | null;
}

/** 页眉内容(F4 分流契约):title=现状行为(标题居中)/custom=自定义文字+logo */
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
 * 页眉构建(F4 自 renderHeader(title) 扩展):
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
