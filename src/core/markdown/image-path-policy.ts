/**
 * 本地图片可信路径边界(adr-012 图片信任边界的**策略单源**)。
 *
 * 校验顺序固定为:原始 src → 词法根边界 → realpath → 规范根边界。调用方若执行
 * 文件 IO,应在 IO 后再次 resolve 并比较规范路径,防止校验与读取之间
 * symlink/junction 被替换(adr-012 要求的 TOCTOU 防线)。
 *
 * 为什么独立成模块(REF-025 #07):本模块**不导入任何 node:fs / node:fs/promises**,
 * realpath 由调用方注入。`node:path` 是唯一外部依赖,且只做纯字符串运算
 * (resolve/relative/isAbsolute/sep/win32/posix)—— 这些是符号链接逃逸判定的
 * 承重逻辑,**刻意不自己实现**(手搓一份就是制造安全漏洞)。
 *
 * 注入形态与两个消费者的实际需求对齐:
 * - `realpathSync` **必填**:pdf 图片规则(core/pdf/rules/image.ts)与转换预检
 *   (core/pipeline/precheck.ts)都只做同步判定;
 * - `realpath` **可选**:仅 main 侧下载器(core → main/services/image-downloader.ts)
 *   在 IO 前后各判一次。未注入时 `resolve` 按既有 `error` 字段返回失败结果而非抛错,
 *   消费者(image-downloader)本就检查 `resolution.error`,故降级路径是自洽的。
 */
import path from "node:path";
export interface LocalImagePathPolicyOptions {
  /** Markdown 源文档所在目录,始终作为可信根。 */
  baseDir: string;
  /** 额外可信根目录(调用方显式授予;相对值按进程 cwd 解析)。 */
  trustedRoots?: readonly string[];
  realpath?: (candidate: string) => Promise<string>;
  /** 必填:本模块不持有任何 node:fs 能力,同步 realpath 由调用方注入 */
  realpathSync: (candidate: string) => string;
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
 *
 * `realpathSync` 必填(见文件头);`realpath` 未注入时 `resolve` 返回带 `error`
 * 的失败结果而非抛错 —— 消费者 image-downloader 本就检查该字段,降级自洽。
 */
export function createLocalImagePathPolicy(options: LocalImagePathPolicyOptions): LocalImagePathPolicy {
  const trustedRoots = options.trustedRoots ?? [];
  const resolveRealpathSync = options.realpathSync;
  return {
    resolve: async (src) => {
      if (!options.realpath) {
        return {
          filePath: null,
          error: new Error(
            "createLocalImagePathPolicy:调用方未注入 realpath,无法执行异步边界校验(见 adr-012)",
          ),
        };
      }
      const prepared = prepareLocalImagePath(src, options.baseDir, trustedRoots);
      return prepared ? canonicalizePreparedPath(prepared, options.realpath) : { filePath: null };
    },
    resolveSync: (src) => {
      const prepared = prepareLocalImagePath(src, options.baseDir, trustedRoots);
      return prepared ? canonicalizePreparedPathSync(prepared, resolveRealpathSync) : { filePath: null };
    },
  };
}
