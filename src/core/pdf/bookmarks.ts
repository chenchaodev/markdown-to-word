/**
 * PDF 书签大纲注入(批次 4「长文档」,书签优先)。
 * 方案(规划/ADR-004 定稿,勿改):printToPDF 产物含 /Dests 命名目标但无大纲树
 * (Chromium 上游限制,electron #32288);本模块读命名目标 → pdf-lib 注入 Outlines。
 * 样板来源:pdf-lib 无高层大纲 API,按 marp-cli setOutline(issue #1151)+
 * obsidian-pdf-plus 命名目标解析改造;调研结论见 docs/研究结论.md 2026-08-04 条目。
 * 关键点:
 * - 中文标题必须 PDFHexString.fromText(UTF-16BE);PDFString 会被按 PDFDocEncoding
 *   解成乱码(issue #516,勿回退)
 * - Dest 第 0 元素必须是页面 PDFRef(不是页码);命名目标数组可直接复用
 * - 子项 Count 为负 = 折叠;保存不破坏原 Link 注释/字体/图片(实测)
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
} from "pdf-lib";

/** 单条书签(支持嵌套)。to:页面 PDFRef(命名目标复用)或页码/[pageIndex, x, y](页码定位) */
export interface PdfOutline {
  title: string;
  to: PDFRef | number | [pageIndex: number, x: number, y: number];
  italic?: boolean;
  bold?: boolean;
  open?: boolean;
  children?: PdfOutline[];
}

/** 目录/书签共享的标题结构(由渲染后 HTML 提取) */
export interface PdfHeading {
  level: number; // 1-3
  id: string; // slug,与正文锚点一一对应
  text: string; // 清洗后的标题文本(剥标签 + 实体解码)
}

/** 书签树的中间结构(命名目标名 + 标题 + 子项) */
export interface PdfBookmarkNode {
  name: string; // 命名目标名(= 标题 slug)
  title: string;
  children?: PdfBookmarkNode[];
}

/**
 * 解析已有 PDF 的命名目标(实测 printToPDF 产物为「旧式直接 /Dests 字典」,
 * 兼容两种结构,勿回退):
 * - 旧式:catalog /Dests → { key: dest } 字典(key 为 PDFName 百分号编码 UTF-8)
 * - 新式:catalog /Names → /Dests → /Names 成对数组
 * 目标值两种形态:PDFArray(显式 dest)或 PDFDict(间接目标,取 /D 键)。
 * 注意:pdf-lib 的 dict.lookup(key, type) 在 key 缺失时抛 UnexpectedObjectTypeError
 * (不是返回 undefined),故全部用 get + 手动解引用;PDFName key 需 decodeURIComponent
 * (pdfDocEncodingDecode 会把 UTF-8 中文解成乱码)。
 */
export function lookupNamedDest(doc: PDFDocument, name: string): PDFArray | null {
  const catalog = doc.catalog;
  const deref = (v: unknown): unknown => (v instanceof PDFRef ? doc.context.lookup(v) : v);

  // 新式名称树:/Names → /Dests → /Names 成对数组
  const names = deref(catalog.get(PDFName.of("Names")));
  if (names instanceof PDFDict) {
    const dests = deref(names.get(PDFName.of("Dests")));
    if (dests instanceof PDFDict) {
      const pairs = deref(dests.get(PDFName.of("Names")));
      if (pairs instanceof PDFArray) {
        const arr = pairs.asArray();
        for (let i = 0; i + 1 < arr.length; i += 2) {
          if (destKeyText(arr[i]) === name) return resolveDest(deref(arr[i + 1]), doc);
        }
      }
    }
  }

  // 旧式直接字典:catalog /Dests { key: dest }
  const dests = deref(catalog.get(PDFName.of("Dests")));
  if (dests instanceof PDFDict) {
    for (const [key, value] of dests.entries()) {
      if (destKeyText(key) === name) return resolveDest(deref(value), doc);
    }
  }
  return null;
}

/** 命名目标 key → 文本:PDFName 为百分号编码 UTF-8(如 %E7%9B%AE%E6%A0%87=目标),PDFString/PDFHexString 按字面 */
function destKeyText(key: unknown): string | null {
  if (key instanceof PDFString || key instanceof PDFHexString) return key.decodeText();
  if (key instanceof PDFName) {
    try {
      return decodeURIComponent(key.asString());
    } catch {
      return key.asString();
    }
  }
  return null;
}

/** 目标值 → 显式 dest 数组:PDFArray 直接用;PDFDict 间接目标取 /D */
function resolveDest(target: unknown, doc: PDFDocument): PDFArray | null {
  if (target instanceof PDFArray) return target;
  if (target instanceof PDFDict) {
    const d = target.get(PDFName.of("D"));
    const dRef = d instanceof PDFRef ? doc.context.lookup(d) : d;
    if (dRef instanceof PDFArray) return dRef;
  }
  return null;
}

/**
 * 注入多级大纲(marp setOutline 样板):向 doc 写入 Outlines 树并挂到 catalog。
 * 若 PDF 已存在大纲会被覆盖(printToPDF 产物无大纲,无影响)。
 */
export function setOutline(doc: PDFDocument, outlines: PdfOutline[]): void {
  const rootRef = doc.context.nextRef();
  const refMap = new Map<PdfOutline, PDFRef>();
  const flatten: PdfOutline[] = [];
  const walk = (list: PdfOutline[]): void => {
    for (const o of list) {
      flatten.push(o);
      if (o.children) walk(o.children);
    }
  };
  walk(outlines);
  for (const o of flatten) refMap.set(o, doc.context.nextRef());

  // 收集所有页面 PDFRef(不用 doc.getPage 包装对象,大纲 Dest 需要原始 ref)
  const pageRefs: PDFRef[] = [];
  doc.catalog.Pages().traverse((kid, ref) => {
    if (kid.get(kid.context.obj("Type"))?.toString() === "/Page") pageRefs.push(ref);
  });

  const build = (list: PdfOutline[], parentRef: PDFRef): void => {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const ref = refMap.get(o)!;
      const dest =
        typeof o.to === "number"
          ? { Dest: [pageRefs[o.to], "Fit"] }
          : o.to instanceof PDFRef
            ? { Dest: [o.to, "Fit"] } // 命名目标复用:直接引页面 ref
            : { Dest: [pageRefs[o.to[0]], "XYZ", o.to[1], o.to[2], null] };
      const childrenDict = o.children?.length
        ? {
            First: refMap.get(o.children[0])!,
            Last: refMap.get(o.children[o.children.length - 1])!,
            // 折叠为负值(实测 -1 正确)
            Count: o.children.length * (o.open === false ? -1 : 1),
          }
        : {};
      doc.context.assign(
        ref,
        doc.context.obj({
          Title: PDFHexString.fromText(o.title), // ← 中文书签关键(勿回退 PDFString)
          Parent: parentRef,
          ...(i > 0 ? { Prev: refMap.get(list[i - 1])! } : {}),
          ...(i < list.length - 1 ? { Next: refMap.get(list[i + 1])! } : {}),
          ...childrenDict,
          ...dest,
          F: (o.italic ? 1 : 0) | (o.bold ? 2 : 0),
        }),
      );
      if (o.children?.length) build(o.children, ref);
    }
  };
  build(outlines, rootRef);

  doc.context.assign(
    rootRef,
    doc.context.obj({
      Type: "Outlines",
      First: refMap.get(outlines[0])!,
      Last: refMap.get(outlines[outlines.length - 1])!,
      Count: flatten.length, // 全部展开时的计数
    }),
  );
  doc.catalog.set(doc.context.obj("Outlines"), rootRef);
}

/**
 * 书签树 → 大纲条目:每条经 lookupNamedDest 解析命名目标,
 * 直接复用 dest 数组第 0 元素(页面 PDFRef)作为目标;解析失败回退首页。
 */
function toOutline(doc: PDFDocument, node: PdfBookmarkNode): PdfOutline {
  const dest = lookupNamedDest(doc, node.name);
  const pageRef = dest ? (dest.asArray()[0] as PDFRef) : doc.getPage(0).ref;
  return {
    title: node.title,
    to: pageRef instanceof PDFRef ? pageRef : doc.getPage(0).ref,
    children: node.children?.map((child) => toOutline(doc, child)),
  };
}

/**
 * 主入口:读 PDF bytes → 解析命名目标 → 注入大纲 → 返回新 bytes。
 * 命名目标解析失败的名字自动回退首页(不抛错,书签尽力而为)。
 */
export async function injectBookmarks(
  inputBytes: Uint8Array,
  bookmarks: PdfBookmarkNode[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(inputBytes);
  setOutline(doc, bookmarks.map((b) => toOutline(doc, b)));
  return doc.save();
}

/**
 * 扁平标题列表 → 嵌套书签树(按 level 1-3 层级:h1 顶层,h2/h3 挂最近上级)。
 * 纯逻辑可单测;标题 id 即命名目标名(slug 由 overrideHeadingIdRule 自产,
 * 与 /Dests key 一一对应,免文本提取)。
 */
export function buildBookmarkTree(headings: PdfHeading[]): PdfBookmarkNode[] {
  const roots: PdfBookmarkNode[] = [];
  const stack: { level: number; node: PdfBookmarkNode }[] = [];
  for (const h of headings) {
    const node: PdfBookmarkNode = { name: h.id, title: h.text };
    // 弹出不低于当前级别的祖先(同级别=兄弟,h1 出现则清空)
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length > 0) {
      const parent = stack[stack.length - 1].node;
      parent.children ??= [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push({ level: h.level, node });
  }
  return roots;
}
