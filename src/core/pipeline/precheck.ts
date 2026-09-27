/**
 * 转换预检(转换前静态体检,单一来源):扫描 Markdown 源码层面的潜在排版问题,
 * 不触碰实际渲染管线。检查项:
 * - 越界/缺失的本地图片引用(只允许源文档目录或显式可信根目录内的相对路径);
 * - 悬空交叉引用(引用 #(eq|sec|fig|tab):label 但全文未定义对应 {#...:label});
 * - 未标注语言的代码块(``` 后无语言标识)。
 * 本地图片边界策略由 core/markdown/image-path-policy.ts 的 createLocalImagePathPolicy
 * 统一提供(REF-025 #07 自本模块迁出):先做原始 src 与词法路径校验,再 realpath 后
 * 复核规范路径,symlink/junction 不得把读取目标带出可信根。策略模块自身不持有
 * node:fs 能力,realpathSync 由本层注入(见下方调用点)。
 * 无问题返回空数组(renderer 侧静默继续转换)。
 */
import { existsSync, realpathSync } from "node:fs";
import { visit } from "unist-util-visit";
import { parseMarkdown } from "./parse.js";
import { createLocalImagePathPolicy } from "../markdown/image-path-policy.js";
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
  /** 文件存在性判定(注入点:默认 node:fs.existsSync);仅在边界校验通过后调用。 */
  exists?: (p: string) => boolean;
  /** 显式可信根目录(默认可信范围仅 baseDir)。 */
  trustedRoots?: readonly string[];
  /** realpath 同步注入点,用于平台可移植的链接越界测试。 */
  realpathSync?: (candidate: string) => string;
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
  const localImagePolicy = createLocalImagePathPolicy({
    baseDir,
    trustedRoots: deps.trustedRoots,
    // 策略模块不持有 node:fs 能力(REF-025 #07),realpathSync 由本层注入。
    // deps 侧保持可选 + 默认 node:fs.realpathSync:预检段的 14 个调用点与
    // PrecheckDeps 公开形状因此零改动,而 deps 注入仍能替换它做可移植的越界测试。
    realpathSync: deps.realpathSync ?? realpathSync,
  });
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
      const resolution = localImagePolicy.resolveSync(url);
      if (!resolution.filePath || !exists(resolution.filePath)) warnings.push(imageNotFoundWarning(url));
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
