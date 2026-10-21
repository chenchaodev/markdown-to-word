/**
 * OOXML 部件的轻量 XML 扫描器:把部件文本解析成元素树,供同目录各 part-*.ts 取子元素与属性。
 * 为什么自己写而不是引第三方 XML 库:本层零新增依赖是硬约束(core 内不引宿主相关包),而 OOXML
 * 只需要「标签扫描 + 取子元素 + 取属性」这一档能力,通用 XML 库带来的是体积与解析严格度。
 * 三条不变量(改本文件时三条都要守住):
 * ① 属性顺序无关 —— 一律按「本地名」取属性/子元素,不按整段 XML 串匹配。前身
 *    src/core/docx/template-import.ts 的正则写法(`<w:style[^>]*w:styleId="X"`)在属性换序时
 *    即失效,那正是本层要替掉的形态(步 #02 会删掉那份正则原语)。
 * ② 命名空间前缀不写死 —— 元素与属性都按本地名(去前缀)匹配;只有需要区分「同名不同前缀」
 *    (如 r:id 与 w:id)时才按全名二次核对。
 * ③ 尽力解析不抛 —— 畸形输入返回「已解析到的部分」或 null,由调用方按「读不到就降级」处理。
 * 互指:本文件是 src/core/ooxml/ 下各 part-*.ts 的唯一 XML 读取原语,那几份不得再自带解析逻辑。
 */

/** 一个 XML 元素(已解析) */
export interface XmlElement {
  /** 元素全名(含前缀,如 "w:p") */
  name: string;
  /** 本地名(去前缀,如 "p");前缀按第一个冒号切分 */
  localName: string;
  /** 属性表:键 = 本地名,值 = 已解码的文本(同名多前缀时保留首个) */
  attrs: Map<string, string>;
  /** 属性全名表:键 = 本地名,值 = 原文写法(如 "r:id") */
  attrQNames: Map<string, string>;
  /** 子元素(文档序) */
  children: XmlElement[];
  /** 直属文本(已解码;CDATA 并入其中) */
  text: string;
}

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", "\""],
  ["apos", "'"],
]);

/** 是否为 XML 空白(空格/制表/换行/回车) */
function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** 元素/属性名的合法结束字符 */
function isNameEnd(ch: string): boolean {
  return isSpace(ch) || ch === "/" || ch === ">" || ch === "=";
}

/** 取全名的本地名(去前缀) */
export function localNameOf(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

/**
 * 解码 XML 实体:五个具名实体 + 十进制/十六进制数字实体;未知实体原样保留。
 * @param text 原文
 * @returns 解码后的文本
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body.charAt(1) === "x" || body.charAt(1) === "X";
      const digits = isHex ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES.get(body);
    return named ?? whole;
  });
}

/**
 * 解析 XML 文本 → 根元素;畸形输入不抛(返回已解析到的部分,完全读不出根时返回 null)。
 * @param source XML 文本(部件缺失时上层可能拿到 null/空串 —— 一律按「读不到」处理)
 * @returns 根元素或 null
 */
export function parseXml(source: string | null | undefined): XmlElement | null {
  if (!source) return null;
  const len = source.length;
  let i = 0;

  /** 跳过空白 */
  const skipSpace = (): void => {
    while (i < len && isSpace(source[i]!)) i++;
  };

  /** 跳过声明/注释/DOCTYPE 等杂项 */
  const skipMisc = (): void => {
    for (;;) {
      skipSpace();
      if (source.startsWith("<?", i)) {
        const end = source.indexOf("?>", i);
        i = end === -1 ? len : end + 2;
        continue;
      }
      if (source.startsWith("<!--", i)) {
        const end = source.indexOf("-->", i);
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (source.startsWith("<!", i)) {
        const end = source.indexOf(">", i);
        i = end === -1 ? len : end + 1;
        continue;
      }
      return;
    }
  };

  /** 登记一个属性(同本地名保留首个) */
  const setAttr = (el: XmlElement, attrName: string, value: string): void => {
    if (attrName === "") return;
    const local = localNameOf(attrName);
    if (el.attrs.has(local)) return;
    el.attrs.set(local, value);
    el.attrQNames.set(local, attrName);
  };

  /** 解析一个元素(调用时 source[i] === "<") */
  const parseElement = (): XmlElement | null => {
    if (source[i] !== "<") return null;
    i += 1;
    const nameStart = i;
    while (i < len && !isNameEnd(source[i]!)) i++;
    const name = source.slice(nameStart, i);
    if (name === "") return null;
    const el: XmlElement = {
      name,
      localName: localNameOf(name),
      attrs: new Map(),
      attrQNames: new Map(),
      children: [],
      text: "",
    };
    // 属性
    for (;;) {
      skipSpace();
      if (i >= len) break;
      const ch = source[i]!;
      if (ch === ">") {
        i += 1;
        break;
      }
      if (ch === "/") {
        i += 1;
        if (source[i] === ">") i += 1;
        return el; // 自闭合
      }
      const attrStart = i;
      while (i < len && source[i] !== "=" && !isSpace(source[i]!)) i++;
      const attrName = source.slice(attrStart, i);
      skipSpace();
      if (source[i] === "=") {
        i += 1;
        skipSpace();
        const quote = source[i];
        if (quote === "\"" || quote === "'") {
          i += 1;
          const end = source.indexOf(quote, i);
          const raw = end === -1 ? source.slice(i) : source.slice(i, end);
          i = end === -1 ? len : end + 1;
          setAttr(el, attrName, decodeEntities(raw));
        } else {
          const valStart = i;
          while (i < len && !isSpace(source[i]!) && source[i] !== ">" && source[i] !== "/") i++;
          setAttr(el, attrName, decodeEntities(source.slice(valStart, i)));
        }
      } else {
        setAttr(el, attrName, "");
      }
    }
    // 内容
    const textParts: string[] = [];
    for (;;) {
      if (i >= len) break;
      const ch = source[i]!;
      if (ch !== "<") {
        const next = source.indexOf("<", i);
        const raw = next === -1 ? source.slice(i) : source.slice(i, next);
        textParts.push(decodeEntities(raw));
        i = next === -1 ? len : next;
        continue;
      }
      if (source.startsWith("</", i)) {
        const end = source.indexOf(">", i);
        i = end === -1 ? len : end + 1;
        break; // 本元素结束
      }
      if (source.startsWith("<!--", i)) {
        const end = source.indexOf("-->", i);
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (source.startsWith("<![CDATA[", i)) {
        const end = source.indexOf("]]>", i);
        textParts.push(end === -1 ? source.slice(i + 9) : source.slice(i + 9, end));
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (source.startsWith("<?", i)) {
        const end = source.indexOf("?>", i);
        i = end === -1 ? len : end + 2;
        continue;
      }
      const child = parseElement();
      if (child === null) {
        i += 1;
        continue;
      }
      el.children.push(child);
    }
    el.text = textParts.join("");
    return el;
  };

  skipMisc();
  if (i >= len || source[i] !== "<") return null;
  return parseElement();
}

/**
 * 取第一个同名子元素(按本地名匹配)。
 * @param el 父元素(可空)
 * @param localName 本地名
 * @returns 子元素或 null
 */
export function childOf(el: XmlElement | null | undefined, localName: string): XmlElement | null {
  if (!el) return null;
  for (const child of el.children) {
    if (child.localName === localName) return child;
  }
  return null;
}

/**
 * 取全部同名子元素(按本地名匹配,文档序)。
 * @param el 父元素(可空)
 * @param localName 本地名
 * @returns 子元素数组
 */
export function childrenOf(el: XmlElement | null | undefined, localName: string): XmlElement[] {
  if (!el) return [];
  return el.children.filter((child) => child.localName === localName);
}

/**
 * 在子树里深度优先找第一个同名元素(按本地名匹配)。
 * @param el 起点元素(可空)
 * @param localName 本地名
 * @returns 命中的元素或 null
 */
export function findDescendant(el: XmlElement | null | undefined, localName: string): XmlElement | null {
  if (!el) return null;
  for (const child of el.children) {
    if (child.localName === localName) return child;
    const deeper = findDescendant(child, localName);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * 在子树里收集全部同名元素(按本地名匹配,文档序)。
 * @param el 起点元素(可空)
 * @param localName 本地名
 * @returns 命中的元素数组
 */
export function findDescendants(el: XmlElement | null | undefined, localName: string): XmlElement[] {
  if (!el) return [];
  const out: XmlElement[] = [];
  for (const child of el.children) {
    if (child.localName === localName) out.push(child);
    out.push(...findDescendants(child, localName));
  }
  return out;
}

/**
 * 取属性值:不带冒号时按本地名取;带冒号时先按本地名取再核对全名(区分 r:id 与 w:id)。
 * @param el 元素(可空)
 * @param name 属性名(本地名或全名)
 * @returns 属性值或 undefined
 */
export function attrOf(el: XmlElement | null | undefined, name: string): string | undefined {
  if (!el) return undefined;
  const colon = name.indexOf(":");
  if (colon === -1) return el.attrs.get(name);
  const local = name.slice(colon + 1);
  const value = el.attrs.get(local);
  if (value === undefined) return undefined;
  return el.attrQNames.get(local) === name ? value : undefined;
}

/**
 * 取数值属性(非数字/缺失 ⇒ undefined)。
 * @param el 元素(可空)
 * @param name 属性名
 * @returns 数值或 undefined
 */
export function numAttr(el: XmlElement | null | undefined, name: string): number | undefined {
  const raw = attrOf(el, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * 取布尔属性(OOXML 的 on/off 形态):缺 val ⇒ true;"0"/"false"/"off" ⇒ false。
 * @param el 元素(可空)
 * @param name 属性名
 * @returns 布尔值或 undefined
 */
export function boolAttr(el: XmlElement | null | undefined, name: string): boolean | undefined {
  const raw = attrOf(el, name);
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "" || normalized === "1" || normalized === "true" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "off") return false;
  return undefined;
}

/**
 * 取开关元素(OOXML 的 ST_OnOff 形态:元素本身即开关,val 只是覆盖)。
 *
 * ⚠ **与 boolAttr 的分工**:boolAttr 读的是「属性」,缺属性即 undefined;而开关元素
 * `<w:b/>` 表示「开」,`<w:b w:val="0"/>` 才表示「关」。两者语义不同,混用会让
 * 「元素存在但无 val」这一最常见的形态被读成「未设置」(继承链上就少一层)。
 * @param el 开关元素(可空)
 * @returns 开关值;元素不存在 ⇒ undefined
 */
export function toggleOf(el: XmlElement | null | undefined): boolean | undefined {
  if (!el) return undefined;
  const raw = attrOf(el, "val");
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "off") return false;
  return true;
}
