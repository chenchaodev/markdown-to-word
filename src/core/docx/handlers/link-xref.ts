/**
 * 链接/交叉引用行内渲染(B8 拆分):pushRuns 的 link case 原样抽出。
 * 覆盖四类目标:#eq: 公式引用、#fig/#tab/sec 交叉引用、#slug 内部锚点、
 * http(s) 外链;其余(相对路径等)保持假链接样式。行为与拆分前逐字一致。
 */
import { ExternalHyperlink, InternalHyperlink, TextRun } from "docx";
import type { Link } from "mdast";
import { LINK_COLOR } from "../theme.js";
import { docxBookmarkId } from "../../markdown/slug.js";
import { collectPlainText } from "../../util/mdast-utils.js";
import { CROSS_REF_KINDS, type CrossRefKind } from "../../markdown/cross-ref.js";
import { crossRefNotFoundWarning } from "../../i18n.js";
import { warnDedup, type Ctx, type InlineChild, type RunStyle } from "../ctx.js";

/**
 * link 节点 → runs(同步;无 await 点,pushRuns 调用处无需等待)。
 * 链接文本 = 子树纯文本(复用 collectPlainText 单源,替代逐子节点 value 拼接 +
 * 类型断言;与目录条目/题注识别同一取文本路径)。
 */
export function pushLinkRuns(runs: InlineChild[], node: Link, ctx: Ctx, style: RunStyle): void {
  const text = collectPlainText(node);
  const url = node.url;
  // 公式交叉引用(9d):[式](#eq:label) / [公式](#eq:label) → 文本替换为
  // 「式 (N)」/「公式 (N)」并跳转公式书签 eq-label;未知 label → 普通文本
  // 「式 (?)」无链接 + 警告;其他文本的 #eq: 链接保持原文本跳转公式书签。
  // 公式编号开关关闭时整个分支不生效:按普通 # 锚点链接渲染(保持原文本,
  // 不降级「(?)」、不追加警告,与 pdf 侧不注册 eq_numbering 规则行为一致)
  const eqMatch = ctx.equationNumbering === false ? null : /^#eq:([\w-]+)$/.exec(url);
  if (eqMatch) {
    const label = eqMatch[1]!; // 正则含捕获组且已匹配,组必存在
    const n = ctx.equationLabels?.get(label);
    if (text === "式" || text === "公式") {
      if (n !== undefined) {
        runs.push(
          new InternalHyperlink({
            anchor: docxBookmarkId(`eq-${label}`),
            children: [new TextRun({ text: `${text} (${n})`, color: LINK_COLOR, underline: {}, ...style })],
          }),
        );
      } else {
        // 与图/表/章节悬空同一文案族(「交叉引用未找到<类别> label: <ref>」);
        // pdf 侧同场景文案不同(「引用未定义的公式标签: eq:<label>」),用独立 key
        warnDedup(ctx, crossRefNotFoundWarning("公式", label));
        runs.push(new TextRun({ text: `${text} (?)`, ...style }));
      }
      return;
    }
    runs.push(
      new InternalHyperlink({
        anchor: docxBookmarkId(`eq-${label}`),
        children: [new TextRun({ text, color: LINK_COLOR, underline: {}, ...style })],
      }),
    );
    return;
  }
  // 图/表/章节交叉引用(批次 10 功能 2,文案与占位见 CROSS_REF_KINDS,勿散落硬编码):
  // [图](#fig:label) → 静态编号文本「图 3.1」+ 跳题注书签 fig-<label>;
  // [表](#tab:label) → 「表 1」+ 跳 tab-<label>;[章节](#sec:label) →
  // 静态章节号「3.2」+ 跳标题书签;引用文本非约定文本 → 保持原文本仍跳转
  // (与 #eq: 非「式/公式」行为一致);悬空 → 默认文本占位 + 警告,非约定
  // 文本保持原样不带链接(目标书签不存在,不生成死链;公式悬空非默认文本
  // 无警告的死链行为不复制,此处更安全)
  const crossMatch = /^#(fig|tab|sec):([\w-]+)$/.exec(url);
  if (crossMatch) {
    const kind = crossMatch[1] as CrossRefKind;
    const label = crossMatch[2]!; // 正则第二捕获组已匹配,组必存在
    const def = CROSS_REF_KINDS[kind];
    let numberText: string | undefined;
    let anchor: string | undefined;
    if (kind === "sec") {
      const info = ctx.headingLabels.get(label);
      if (info) {
        numberText = info.chapterText;
        anchor = docxBookmarkId(info.slug);
      }
    } else {
      const info = ctx.captionLabels.get(label);
      // captionLabels 登记时已限定 kind 与前缀一致(见 captions.ts),此处防御性校验
      if (info && info.kind === kind) {
        numberText = info.numberText;
        anchor = docxBookmarkId(`${kind}-${label}`);
      }
    }
    if (numberText !== undefined && anchor !== undefined) {
      runs.push(
        new InternalHyperlink({
          anchor,
          children: [new TextRun({ text: text === def.defaultText ? numberText : text, color: LINK_COLOR, underline: {}, ...style })],
        }),
      );
    } else {
      warnDedup(ctx, crossRefNotFoundWarning(def.kindName, `${kind}:${label}`));
      runs.push(new TextRun({ text: text === def.defaultText ? def.danglingText : text, ...style }));
    }
    return;
  }
  if (url.startsWith("#")) {
    // 内部锚点:[text](#slug) → 跳转同名书签(标题已用 docxBookmarkId 生成)
    runs.push(
      new InternalHyperlink({
        anchor: docxBookmarkId(url.slice(1)),
        children: [new TextRun({ text, color: LINK_COLOR, underline: {}, ...style })],
      }),
    );
    return;
  }
  if (/^https?:/i.test(url)) {
    runs.push(
      new ExternalHyperlink({
        link: url,
        children: [new TextRun({ text, color: LINK_COLOR, underline: {}, ...style })],
      }),
    );
    return;
  }
  // 相对路径等:保持假链接样式
  runs.push(new TextRun({ text, color: LINK_COLOR, underline: {}, ...style }));
}
