/**
 * 转换预检(转换前静态体检,单一来源):扫描 Markdown 源码层面的潜在排版问题,
 * 不触碰实际渲染管线。检查项:
 * - 缺失的本地图片引用(相对/绝对路径,文件不存在);
 * - 悬空交叉引用(引用 #(eq|sec|fig|tab):label 但全文未定义对应 {#...:label});
 * - 未标注语言的代码块(``` 后无语言标识)。
 * 纯函数 + 依赖注入(exists 默认 fs.existsSync,便于测试与沙箱复用)。
 * 无问题返回空数组(renderer 侧静默继续转换)。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { visit } from "unist-util-visit";
import { parseMarkdown } from "../pipeline/parse.js";
import type { ConvertWarning } from "../i18n.js";
import { crossRefNotFoundWarning, unlabeledCodeBlockWarning } from "../i18n.js";
import { imageNotFoundWarning } from "../image/image-warning.js";

/** 标签定义:{#(sec|eq|fig|tab):label}(label 含前导 #,见 core/markdown/cross-ref.ts) */
const DEF_RE = /\{\s*#(sec|eq|fig|tab):([\w-]+)\}/g;
/** 交叉引用:#(eq|sec|fig|tab):label(仅 markdown 链接节点视为引用) */
const REF_RE = /^#(eq|sec|fig|tab):([\w-]+)$/;
/** 远程/内嵌资源不检查存在性 */
const REMOTE_RE = /^(https?:|data:|blob:)/i;

export interface PrecheckDeps {
  /** 文件存在性判定(注入点:默认 node:fs.existsSync) */
  exists?: (p: string) => boolean;
}

/**
 * 预检 Markdown 源码。content 为文件文本,baseDir 为文件所在目录(用于解析
 * 相对图片路径)。解析异常时返回 [] 不阻断转换(转换管线有独立解析与报错)。
 */
export function precheckMarkdown(
  content: string,
  baseDir: string,
  deps: PrecheckDeps = {},
): ConvertWarning[] {
  const exists = deps.exists ?? existsSync;
  let ast: unknown;
  try {
    ast = parseMarkdown(content);
  } catch {
    return [];
  }

  const defined = new Set<string>();
  const refs: Array<{ kind: string; label: string }> = [];
  const warnings: ConvertWarning[] = [];

  // mdast 节点异构,字段按需访问;visit 的树参数与节点类型此处统一放宽
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(ast as any, (node: any): void => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "image") {
      const url: string = node.url ?? "";
      if (!url || REMOTE_RE.test(url)) return;
      const withoutAnchor = url.split("#")[0] ?? "";
      const clean = withoutAnchor.split("?")[0] ?? "";
      if (!clean) return;
      const abs = path.isAbsolute(clean) ? clean : path.resolve(baseDir, clean);
      if (!exists(abs)) warnings.push(imageNotFoundWarning(url));
    } else if (node.type === "code") {
      const lang: string = node.lang ?? "";
      if (!lang.trim()) warnings.push(unlabeledCodeBlockWarning());
    } else if (node.type === "text") {
      const value: string = node.value ?? "";
      let m: RegExpExecArray | null;
      DEF_RE.lastIndex = 0;
      while ((m = DEF_RE.exec(value))) defined.add(`${m[1]!}:${m[2]!}`);
    } else if (node.type === "link") {
      const url: string = node.url ?? "";
      const m = REF_RE.exec(url);
      if (m) refs.push({ kind: m[1]!, label: m[2]! });
    }
  });

  for (const ref of refs) {
    if (!defined.has(`${ref.kind}:${ref.label}`)) {
      warnings.push(crossRefNotFoundWarning(ref.kind, `#${ref.kind}:${ref.label}`));
    }
  }
  return warnings;
}
