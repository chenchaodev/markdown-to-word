/**
 * OOXML 包级自洽判据(C1–C8):样式引用闭合 / styleId 唯一 / 样式表序列 / 默认样式齐备 /
 * 命名空间前缀声明完整 / 部件声明完整 / 关系可解。
 *
 * 为什么要有这一层(ADR-086 §二):产物「样式表自洽」这件事此前**没有任何机器判据**,
 * 全靠人看;而它的失效形态是**静默**的 —— 悬空引用不改变渲染结果(Word 按「无该样式」
 * 渲染),用户看得见的是「目录层级样式不生效」「第三方工具查不到 Normal」,
 * 查不出根因。判据落在这里而不是新起一道 `gates/repo/` 门禁:门禁面是「仓形状」,
 * 产品级样式断言的既定家是测试层,且 `verify:static` 排在 build 之前,要产物的门禁在
 * `gates/repo/` 跑不到产物。
 *
 * **级别判别式**(ADR-086 §二):闭合性/一致性判据(内容型、稳定)⇒ 判红;
 * 快照/位置型(漂移源)⇒ 告警 + 基线。故 C1–C4、C6–C8 判红,C5(同类多个 `w:default="1"`
 * = 歧义,库升级可能引入)**只告警**。行号漂移只能告警正因为它是位置型。
 *
 * **本文件零 IO**:输入是「包视图」(部件名清单 + XML 部件文本),解包由调用方做
 * (测试侧用 jszip;core 侧的解包原语在 src/core/ooxml/parts.ts,同样是零磁盘 IO)。
 * 判定本体是纯函数 ⇒ 负向夹具能在内存里改坏产物后重跑,不必改写真产物。
 *
 * **有意不判**(ADR-086 §一「有意不补」):`w:latentStyles` 缺失、`word/theme/theme1.xml`
 * 缺失 ⇒ **不落判据**(恒定告警 = 噪声;理由入 ADR)。
 *
 * 互指:XML 读取原语在 src/core/ooxml/xml.ts(本文件不自带解析);关系解析在
 * src/core/ooxml/part-rels.ts;样式表解析在 src/core/ooxml/part-styles.ts。
 */
import { parseRelationships, resolvePartPath } from "./part-rels.js";
import { attrOf, boolAttr, childrenOf, findDescendants, parseXml, type XmlElement } from "./xml.js";

/**
 * 包视图(判据的唯一输入):部件清单 + XML 部件文本。
 *
 * 为什么二进制部件也要进 `partNames`:C7(部件声明完整)与 C8(关系目标存在)要看的是
 * **包里的全部部件**(图片、字体等),只看 XML 部件会让「图片部件没被声明」这类问题
 * 落在判定面之外。
 */
export interface DocxPackageView {
  /** 全部部件名(OOXML 相对路径,如 "word/document.xml");含二进制部件 */
  partNames: readonly string[];
  /** XML 部件的文本(键 = 部件名);二进制部件不入表 */
  texts: ReadonlyMap<string, string>;
}

/** 判据结论:判红项(闭合性/一致性)与告警项(歧义/漂移源)分列 */
export interface DocxIntegrityReport {
  /** 判红项:每条点名判据号与具体事实 */
  problems: string[];
  /** 告警项:每条点名判据号与具体事实 */
  warnings: string[];
}

/** 样式引用元素:值取 `w:val`,指向样式表里的某个 styleId */
const STYLE_REFERENCE_ELEMENTS = ["pStyle", "rStyle", "tblStyle", "basedOn", "next", "link"] as const;

/** 关系引用属性:局部名 + 命名空间前缀 `r`(relationships) */
const RELATIONSHIP_REFERENCE_ATTRS = new Set(["id", "embed", "link"]);

/** 默认样式必须齐备的两个类型(段落 / 字符) */
const DEFAULT_STYLE_TYPES = ["paragraph", "character"] as const;

/**
 * 走一遍元素树(深度优先,含根)。
 * @param root 起点元素
 * @param visit 每个元素的回调
 * @returns {void}
 */
function walkElements(root: XmlElement, visit: (el: XmlElement) => void): void {
  visit(root);
  for (const child of root.children) walkElements(child, visit);
}

/**
 * 判断一个部件是否参与「样式引用」扫描。
 *
 * 排除 `[Content_Types].xml` 与 `.rels`:前者不是 OOXML 样式载体,后者是关系清单
 * (关系由 C8 单独判)。
 * @param partName 部件名
 * @returns 是否扫描
 */
function isScannableXmlPart(partName: string): boolean {
  if (partName === "[Content_Types].xml") return false;
  if (partName.endsWith(".rels")) return false;
  return partName.endsWith(".xml");
}

/**
 * 收集一个部件里的全部样式引用。
 * @param root 部件根元素
 * @returns 引用清单(元素局部名 + 值)
 */
function styleReferencesOf(root: XmlElement): { element: string; value: string }[] {
  /** @type {{ element: string, value: string }[]} */
  const out: { element: string; value: string }[] = [];
  for (const local of STYLE_REFERENCE_ELEMENTS) {
    for (const el of findDescendants(root, local)) {
      const value = attrOf(el, "val");
      if (value === undefined || value === "") continue;
      out.push({ element: local, value });
    }
  }
  return out;
}

/**
 * 根元素上声明的命名空间前缀。
 *
 * ⚠ **口径**:本层 XML 原语(xml.ts)按「属性本地名」存属性,同名本地名的属性只留首个 ——
 * 声明 `xmlns:w` 与某个恰好叫 `w` 的属性同处一个元素时后者会被吞掉。
 * 样式表根上的属性只有 `xmlns:*` 与 `mc:Ignorable`(本地名互不相同)⇒ 该口径在此处安全。
 * @param root 根元素
 * @returns 已声明的前缀集(默认命名空间记为空串)
 */
function declaredPrefixesOf(root: XmlElement): Set<string> {
  const out = new Set<string>();
  for (const qname of root.attrQNames.values()) {
    if (qname === "xmlns") {
      out.add("");
      continue;
    }
    if (qname.startsWith("xmlns:")) {
      out.add(qname.slice("xmlns:".length));
      continue;
    }
  }
  return out;
}

/**
 * 部件里**用到的**命名空间前缀(元素名与属性名上的前缀)。
 * @param root 根元素
 * @returns 用到的前缀集
 */
function usedPrefixesOf(root: XmlElement): Set<string> {
  const out = new Set<string>();
  /**
   * @param qname 元素名或属性名(全名)
   * @returns {void}
   */
  const add = (qname: string): void => {
    const colon = qname.indexOf(":");
    if (colon === -1) return; // 无前缀 = 默认命名空间,不需要声明
    const prefix = qname.slice(0, colon);
    if (prefix === "xml" || prefix === "xmlns") return; // XML 规范内置前缀
    out.add(prefix);
  };
  walkElements(root, (el) => {
    add(el.name);
    for (const qname of el.attrQNames.values()) {
      if (qname === "xmlns" || qname.startsWith("xmlns:")) continue; // 声明本身不是「用到」
      add(qname);
    }
  });
  return out;
}

/**
 * 收集部件里的关系引用(r:id / r:embed / r:link)。
 * @param root 根元素
 * @returns 关系 id 清单(去重)
 */
function relationshipReferencesOf(root: XmlElement): string[] {
  const out = new Set<string>();
  walkElements(root, (el) => {
    for (const [local, qname] of el.attrQNames) {
      if (!qname.startsWith("r:")) continue;
      if (!RELATIONSHIP_REFERENCE_ATTRS.has(local)) continue;
      const value = el.attrs.get(local);
      if (value === undefined || value === "") continue;
      out.add(value);
    }
  });
  return [...out];
}

/**
 * 关系部件所属的「拥有者部件」。
 *
 * `word/_rels/document.xml.rels` → `word/document.xml`;`_rels/.rels` → 空串(包根)。
 * @param relsName 关系部件名
 * @returns 拥有者部件名(包根为空串)
 */
function ownerPartOfRels(relsName: string): string {
  const slash = relsName.lastIndexOf("/");
  const dir = slash === -1 ? "" : relsName.slice(0, slash);
  const file = slash === -1 ? relsName : relsName.slice(slash + 1);
  if (!file.endsWith(".rels")) return "";
  const base = file.slice(0, -".rels".length);
  if (base === "") return ""; // 包级关系(_rels/.rels)→ 拥有者是包根
  // 关系部件住在 `<目录>/_rels/<名字>.rels` ⇒ 拥有者部件是 `<目录>/<名字>`
  if (!dir.endsWith("_rels")) return dir === "" ? base : `${dir}/${base}`;
  const ownerDir = dir.slice(0, dir.length - "_rels".length).replace(/\/$/, "");
  return ownerDir === "" ? base : `${ownerDir}/${base}`;
}

/**
 * 判据本体(纯函数):对一份包视图跑 C1–C8。
 *
 * @param view 包视图(部件名清单 + XML 部件文本)
 * @returns 判红项与告警项
 */
export function checkDocxIntegrity(view: DocxPackageView): DocxIntegrityReport {
  /** @type {string[]} */
  const problems: string[] = [];
  /** @type {string[]} */
  const warnings: string[] = [];
  const partNames = new Set(view.partNames);
  const texts = view.texts;

  // ---- styles.xml:缺失即判红(样式引用无从闭合)----
  const stylesText = texts.get("word/styles.xml");
  if (stylesText === undefined) {
    problems.push("C1-style-reference-closure:包内没有 word/styles.xml —— 样式引用无从闭合");
    return { problems, warnings };
  }
  const stylesRoot = parseXml(stylesText);
  if (stylesRoot === null) {
    problems.push("C1-style-reference-closure:word/styles.xml 解析不出根元素 —— 样式表读不出,判定面为空");
    return { problems, warnings };
  }

  // ---- C2:styleId 唯一 ----
  const styleElements = childrenOf(stylesRoot, "style");
  /** @type {Map<string, number>} styleId → 出现次数 */
  const idCounts = new Map<string, number>();
  /** @type {Set<string>} 已定义的 styleId */
  const definedIds = new Set<string>();
  for (const el of styleElements) {
    const id = attrOf(el, "styleId");
    if (id === undefined || id === "") {
      problems.push("C2-style-id-unique:word/styles.xml 里有 w:style 缺 w:styleId 属性");
      continue;
    }
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    definedIds.add(id);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      problems.push(`C2-style-id-unique:word/styles.xml 的 styleId「${id}」重复定义了 ${count} 次`);
    }
  }

  // ---- C3:docDefaults 恰好一份;latentStyles 排在所有 w:style 之前 ----
  const styleChildren = stylesRoot.children;
  const docDefaultsCount = styleChildren.filter((child) => child.localName === "docDefaults").length;
  if (docDefaultsCount !== 1) {
    problems.push(`C3-styles-sequence:word/styles.xml 的 w:docDefaults 有 ${docDefaultsCount} 个(应恰好 1 个)`);
  }
  const firstStyleIndex = styleChildren.findIndex((child) => child.localName === "style");
  const docDefaultsIndex = styleChildren.findIndex((child) => child.localName === "docDefaults");
  const latentStylesIndex = styleChildren.findIndex((child) => child.localName === "latentStyles");
  if (docDefaultsIndex >= 0 && firstStyleIndex >= 0 && docDefaultsIndex > firstStyleIndex) {
    problems.push("C3-styles-sequence:word/styles.xml 的 w:docDefaults 排在 w:style 之后 —— CT_Styles 要求它在前");
  }
  if (latentStylesIndex >= 0 && firstStyleIndex >= 0 && latentStylesIndex > firstStyleIndex) {
    problems.push(
      "C3-styles-sequence:word/styles.xml 的 w:latentStyles 排在 w:style 之后 —— CT_Styles 要求它在所有 w:style 之前",
    );
  }

  // ---- C4 / C5:段落与字符类型各有唯一 w:default="1" ----
  /** @type {Map<string, string[]>} 类型 → 该类型下带 w:default="1" 的 styleId 清单 */
  const defaultsByType = new Map<string, string[]>();
  for (const el of styleElements) {
    if (boolAttr(el, "default") !== true) continue;
    const type = attrOf(el, "type") ?? "(未标类型)";
    const id = attrOf(el, "styleId") ?? "(无 styleId)";
    const list = defaultsByType.get(type) ?? [];
    list.push(id);
    defaultsByType.set(type, list);
  }
  for (const type of DEFAULT_STYLE_TYPES) {
    const ids = defaultsByType.get(type) ?? [];
    if (ids.length === 0) {
      problems.push(`C4-default-style:word/styles.xml 没有类型为 ${type} 的 w:default="1" 样式(默认样式缺位)`);
      continue;
    }
    if (ids.length > 1) {
      // ⚠ **多于一个走 C5 告警而不是 C4 判红**:这类歧义由库升级引入(库自带样式集可能
      // 变化),不是本仓的错 ⇒ 判红会让「库升级」变成一次失败发布,而告警仍让它可见。
      warnings.push(
        `C5-ambiguous-default:类型为 ${type} 的 w:default="1" 样式有 ${ids.length} 个(${ids.join("、")})`
          + " —— 同类多默认属歧义(库升级可能引入),只告警不判红",
      );
    }
  }

  // ---- C6:命名空间前缀声明完整(只判 styles.xml:它的根属性由本仓接管)----
  const declared = declaredPrefixesOf(stylesRoot);
  for (const prefix of usedPrefixesOf(stylesRoot)) {
    if (declared.has(prefix)) continue;
    problems.push(`C6-namespace-prefix:word/styles.xml 用到了前缀「${prefix}」,但根元素上没声明它`);
  }
  const ignorable = attrOf(stylesRoot, "mc:Ignorable");
  if (ignorable !== undefined) {
    for (const prefix of ignorable.split(/\s+/).filter((token) => token !== "")) {
      if (declared.has(prefix)) continue;
      problems.push(
        `C6-namespace-prefix:word/styles.xml 的 mc:Ignorable 列了前缀「${prefix}」,但根元素上没声明它`
          + " —— MCE 非法文档(Word 可能弹「内容有问题」)",
      );
    }
  }

  // ---- C1:样式引用闭合(各部件的引用都要落在已定义的 styleId 上)----
  for (const partName of view.partNames) {
    if (!isScannableXmlPart(partName)) continue;
    const text = texts.get(partName);
    if (text === undefined) continue;
    const root = parseXml(text);
    if (root === null) continue;
    // 同一处悬空引用可能被引用多次(目录里两个同级条目都指向 TOC1)⇒ 按「部件+元素+值」
    // 归并成一条并带上处数,免得诊断行被同一条事实刷屏(刷屏会淹没别的判据)。
    /** @type {Map<string, number>} */
    const counts = new Map<string, number>();
    for (const ref of styleReferencesOf(root)) {
      if (definedIds.has(ref.value)) continue;
      const key = `${ref.element} ${ref.value}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      const [element, value] = key.split(" ");
      problems.push(
        `C1-style-reference-closure:${partName} 的 w:${element} 引用了未定义的样式 id「${value}」`
          + (count > 1 ? `(${count} 处)` : ""),
      );
    }
  }

  // ---- C7:每个部件都被 [Content_Types].xml 覆盖(Default 扩展名或 Override 皆可)----
  const contentTypesText = texts.get("[Content_Types].xml");
  if (contentTypesText === undefined) {
    problems.push("C7-content-types:包内没有 [Content_Types].xml —— 部件声明无从核对");
  } else {
    const contentTypesRoot = parseXml(contentTypesText);
    if (contentTypesRoot === null) {
      problems.push("C7-content-types:[Content_Types].xml 解析不出根元素 —— 部件声明无从核对");
    } else {
      /** @type {Set<string>} */
      const defaultExtensions = new Set<string>();
      /** @type {Set<string>} */
      const overriddenParts = new Set<string>();
      for (const el of childrenOf(contentTypesRoot, "Default")) {
        const extension = attrOf(el, "Extension");
        if (extension !== undefined) defaultExtensions.add(extension.toLowerCase());
      }
      for (const el of childrenOf(contentTypesRoot, "Override")) {
        const partName = attrOf(el, "PartName");
        if (partName !== undefined) overriddenParts.add(partName.replace(/^\//, ""));
      }
      for (const partName of view.partNames) {
        if (partName === "[Content_Types].xml") continue;
        if (overriddenParts.has(partName)) continue;
        const dot = partName.lastIndexOf(".");
        const extension = dot === -1 ? "" : partName.slice(dot + 1).toLowerCase();
        if (defaultExtensions.has(extension)) continue;
        problems.push(
          `C7-content-types:部件 ${partName} 既没有 Override、也没有 Default 扩展名覆盖(扩展名「${extension}」)`,
        );
      }
    }
  }

  // ---- C8:r:id 可解 + 非外部关系的目标在包内存在 ----
  for (const relsName of view.partNames) {
    if (!relsName.endsWith(".rels")) continue;
    const relsText = texts.get(relsName);
    if (relsText === undefined) continue;
    const relationships = parseRelationships(relsText);
    const owner = ownerPartOfRels(relsName);
    for (const relationship of relationships.values()) {
      if (relationship.external) continue;
      const target = resolvePartPath(owner, relationship.target);
      if (partNames.has(target)) continue;
      problems.push(
        `C8-relationship:${relsName} 的关系 ${relationship.id} 指向 ${relationship.target}(解析为 ${target}),包内没有这个部件`,
      );
    }
    if (owner === "") continue;
    const ownerText = texts.get(owner);
    if (ownerText === undefined) continue;
    const ownerRoot = parseXml(ownerText);
    if (ownerRoot === null) continue;
    for (const reference of relationshipReferencesOf(ownerRoot)) {
      if (relationships.has(reference)) continue;
      problems.push(`C8-relationship:${owner} 引用了关系 ${reference},${relsName} 里没有这一条`);
    }
  }

  return { problems, warnings };
}
