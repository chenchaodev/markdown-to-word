/**
 * PDF 书签大纲注入:读 printToPDF 产物的命名目标 → pdf-lib 注入 Outlines 树。
 * 不变量:
 * - printToPDF 产物含 /Dests 命名目标但无大纲树(Chromium 上游限制,electron #32288)
 * - 中文标题必须 PDFHexString.fromText(UTF-16BE);PDFString 会被按 PDFDocEncoding 解成乱码(勿回退)
 * - Dest 第 0 元素必须是页面 PDFRef(不是页码);命名目标数组可直接复用
 * - 子项 Count 为负 = 折叠;保存不破坏原 Link 注释/字体/图片
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

/**
 * 命名目标 key → 文本:
 * - PDFName:pdf-lib 的 asString() 返回内部编码(`%` 已转义为 `#25`),必须先
 *   decodeText() 还原为百分号形式(如 `%E7%9B%AE%E6%A0%87`),再 decodeURIComponent
 *   得到 UTF-8 中文(如「目标」);直接用 asString() 会永远匹配不上(实测坑,勿回退)
 * - PDFString/PDFHexString:decodeText() 按字面/UTF-16BE 解码即可
 */
function destKeyText(key: unknown): string | null {
  if (key instanceof PDFString || key instanceof PDFHexString) return key.decodeText();
  if (key instanceof PDFName) {
    const literal = key.decodeText(); // #25 → %,得到百分号编码形式
    try {
      return decodeURIComponent(literal);
    } catch {
      return literal; // 非百分号编码(纯 ASCII 名)原样返回
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
  * 命名目标 → 页码(1-based,与 /Dests 同解析路径)。
 * 给定标题 slug 列表,解析其在已打印 PDF 中的页码:lookupNamedDest 取命名目标,
 * 目标数组第 0 元素为页面 PDFRef,遍历页面树建立「objNum:gen → 序号」映射定位页码
 * (与 setOutline 收集 pageRefs 同源;复用 /Dests,免 pdfjs 文本匹配)。
 * 解析失败的 slug 不出现在返回表中(调用方尽力而为)。
 */
export function pageNumbersForNames(doc: PDFDocument, names: string[]): Record<string, number> {
  const pageRefs: PDFRef[] = [];
  doc.catalog.Pages().traverse((kid, ref) => {
    if (kid.get(kid.context.obj("Type"))?.toString() === "/Page") pageRefs.push(ref);
  });
  const indexOfRef = (ref: PDFRef): number => {
    const key = `${ref.objectNumber}:${ref.generationNumber}`;
    for (let i = 0; i < pageRefs.length; i++) {
      const r = pageRefs[i]!; // 循环边界刚检查
      if (`${r.objectNumber}:${r.generationNumber}` === key) return i;
    }
    return -1;
  };
  const out: Record<string, number> = {};
  for (const name of names) {
    const dest = lookupNamedDest(doc, name);
    if (!dest) continue;
    const ref = dest.asArray()[0];
    if (!(ref instanceof PDFRef)) continue;
    const idx = indexOfRef(ref);
    if (idx >= 0) out[name] = idx + 1;
  }
  return out;
}

/**
 * 注入多级大纲(marp setOutline 样板):向 doc 写入 Outlines 树并挂到 catalog。
 * 若 PDF 已存在大纲会被覆盖(printToPDF 产物无大纲,无影响)。
 *
  * 前置条件(隐式契约):outlines 必须非空——空数组时下方
 * refMap.get(outlines[0]) 为 undefined,产物大纲树损坏。调用方(main/converter
 * single.ts)以 extractHeadings().length > 0 前置把关;本函数不加守卫保持既有行为。
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
      const o = list[i]!; // 循环边界刚检查(i < list.length)
      const ref = refMap.get(o)!;
      const dest =
        typeof o.to === "number"
          ? { Dest: [pageRefs[o.to], "Fit"] }
          : o.to instanceof PDFRef
            ? { Dest: [o.to, "Fit"] } // 命名目标复用:直接引页面 ref
            : { Dest: [pageRefs[o.to[0]], "XYZ", o.to[1], o.to[2], null] };
      const childrenDict = o.children?.length
        ? {
            First: refMap.get(o.children[0]!)!, // 三元条件已保证 children 非空
            Last: refMap.get(o.children[o.children.length - 1]!)!,
            // 折叠为负值(实测 -1 正确)
            Count: o.children.length * (o.open === false ? -1 : 1),
          }
        : {};
      doc.context.assign(
        ref,
        doc.context.obj({
          Title: PDFHexString.fromText(o.title), // ← 中文书签关键(勿回退 PDFString)
          Parent: parentRef,
          ...(i > 0 ? { Prev: refMap.get(list[i - 1]!)! } : {}), // 条件已保证下标有效
          ...(i < list.length - 1 ? { Next: refMap.get(list[i + 1]!)! } : {}),
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
      First: refMap.get(outlines[0]!)!, // outlines 为空时运行时仍为 undefined,保持既有行为不加守卫
      Last: refMap.get(outlines[outlines.length - 1]!)!,
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
  // dest 数组第 0 元素运行时为页面 PDFRef(命名目标解析产物);畸形数据(含
  // noUncheckedIndexedAccess 的 undefined)由下方 instanceof 收窄回退首页,无需断言
  const pageRef = dest ? dest.asArray()[0] : undefined;
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
    while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) stack.pop(); // 长度刚检查
    if (stack.length > 0) {
      const parent = stack[stack.length - 1]!.node; // 上方刚检查 length > 0
      parent.children ??= [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push({ level: h.level, node });
  }
  return roots;
}
