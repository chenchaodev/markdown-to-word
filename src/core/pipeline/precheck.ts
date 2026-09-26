/**
 * 转换预检(转换前静态体检,单一来源):扫描 Markdown 源码层面的潜在排版问题,
 * 不触碰实际渲染管线。检查项:
 * - 越界/缺失的本地图片引用(只允许源文档目录或显式可信根目录内的相对路径);
 * - 悬空交叉引用(引用 #(eq|sec|fig|tab):label 但全文未定义对应 {#...:label});
 * - 未标注语言的代码块(``` 后无语言标识)。
 * 本地图片边界策略由 createLocalImagePathPolicy 统一提供:先做原始 src 与词法路径
 * 校验,再 realpath 后复核规范路径,symlink/junction 不得把读取目标带出可信根。
 * 无问题返回空数组(renderer 侧静默继续转换)。
 */
import { existsSync, realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
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

/** 本地图片路径策略依赖。realpath 注入仅用于可移植的 symlink/junction 边界测试。 */
export interface LocalImagePathPolicyOptions {
  /** Markdown 源文档所在目录,始终作为可信根。 */
  baseDir: string;
  /** 额外可信根目录(调用方显式授予;相对值按进程 cwd 解析)。 */
  trustedRoots?: readonly string[];
  realpath?: (candidate: string) => Promise<string>;
  realpathSync?: (candidate: string) => string;
}

/** 路径策略结果。filePath 仅在完整边界校验通过时返回;error 保留非缺失类 IO 错误。 */
export interface LocalImagePathResolution {
  filePath: string | null;
  error?: unknown;
}

/** 同步/异步共用同一词法策略,供预检、PDF 规则与 main resolver 复用。 */
export interface LocalImagePathPolicy {
  resolve(src: string): Promise<LocalImagePathResolution>;
  resolveSync(src: string): LocalImagePathResolution;
}

interface PreparedLocalImagePath {
  candidate: string;
  roots: readonly string[];
}

function stripQueryAndFragment(src: string): string {
  const query = src.indexOf("?");
  const fragment = src.indexOf("#");
  const positions = [query, fragment].filter((position) => position >= 0);
  const end = positions.length > 0 ? Math.min(...positions) : src.length;
  return src.slice(0, end);
}

/** 原始 src 必须是非 URL、非绝对路径的相对引用;拒绝 NUL、盘符、file URL 与 .. 越界。 */
function normalizeRelativeImageSource(src: string): string | null {
  const clean = stripQueryAndFragment(src);
  if (!clean || clean.includes("\0")) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\0")) return null;
  if (/^(?:https?:|data:|blob:)/i.test(decoded)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)) return null;
  if (/^[\\/]/.test(decoded)) return null;
  if (path.isAbsolute(decoded) || path.win32.isAbsolute(decoded) || path.posix.isAbsolute(decoded)) return null;
  return decoded;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function prepareLocalImagePath(
  src: string,
  baseDir: string,
  trustedRoots: readonly string[],
): PreparedLocalImagePath | null {
  const normalized = normalizeRelativeImageSource(src);
  if (!normalized) return null;
  const roots = [...new Set([baseDir, ...trustedRoots].map((root) => path.resolve(root)))];
  const candidate = path.resolve(baseDir, normalized);
  if (!roots.some((root) => isWithinRoot(candidate, root))) return null;
  return { candidate, roots };
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function acceptedCanonicalPath(
  canonicalCandidate: string,
  canonicalRoots: readonly string[],
): LocalImagePathResolution {
  if (!canonicalRoots.some((root) => isWithinRoot(canonicalCandidate, root))) {
    return { filePath: null };
  }
  return { filePath: canonicalCandidate };
}

async function canonicalizePreparedPath(
  prepared: PreparedLocalImagePath,
  resolveRealpath: (candidate: string) => Promise<string>,
): Promise<LocalImagePathResolution> {
  let canonicalCandidate: string;
  try {
    canonicalCandidate = path.resolve(await resolveRealpath(prepared.candidate));
  } catch (error) {
    return isMissingPathError(error) ? { filePath: null } : { filePath: null, error };
  }

  const canonicalRoots: string[] = [];
  for (const root of prepared.roots) {
    try {
      canonicalRoots.push(path.resolve(await resolveRealpath(root)));
    } catch (error) {
      if (isMissingPathError(error)) continue;
      return { filePath: null, error };
    }
  }
  return acceptedCanonicalPath(canonicalCandidate, canonicalRoots);
}

function canonicalizePreparedPathSync(
  prepared: PreparedLocalImagePath,
  resolveRealpath: (candidate: string) => string,
): LocalImagePathResolution {
  let canonicalCandidate: string;
  try {
    canonicalCandidate = path.resolve(resolveRealpath(prepared.candidate));
  } catch (error) {
    return isMissingPathError(error) ? { filePath: null } : { filePath: null, error };
  }

  const canonicalRoots: string[] = [];
  for (const root of prepared.roots) {
    try {
      canonicalRoots.push(path.resolve(resolveRealpath(root)));
    } catch (error) {
      if (isMissingPathError(error)) continue;
      return { filePath: null, error };
    }
  }
  return acceptedCanonicalPath(canonicalCandidate, canonicalRoots);
}

/**
 * 创建本地图片可信边界。校验顺序固定为:原始 src → 词法根边界 → realpath →
 * 规范根边界。调用方若执行文件 IO,应在 IO 后再次 resolve 并比较规范路径,
 * 防止校验与读取之间 symlink/junction 被替换。
 */
export function createLocalImagePathPolicy(options: LocalImagePathPolicyOptions): LocalImagePathPolicy {
  const trustedRoots = options.trustedRoots ?? [];
  const resolveRealpath = options.realpath ?? realpath;
  const resolveRealpathSync = options.realpathSync ?? realpathSync;
  return {
    resolve: async (src) => {
      const prepared = prepareLocalImagePath(src, options.baseDir, trustedRoots);
      return prepared ? canonicalizePreparedPath(prepared, resolveRealpath) : { filePath: null };
    },
    resolveSync: (src) => {
      const prepared = prepareLocalImagePath(src, options.baseDir, trustedRoots);
      return prepared ? canonicalizePreparedPathSync(prepared, resolveRealpathSync) : { filePath: null };
    },
  };
}

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
    realpathSync: deps.realpathSync,
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
