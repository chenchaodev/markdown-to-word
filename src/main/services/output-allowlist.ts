/**
 * shell 打开产物的会话级白名单(main 层单源;被 ipc/register.ts 的
 * shellRevealInFolder / shellOpenPath 共用)。
 *
 * 为什么不是「一个 Set 存字符串」:白名单是 renderer 触达宿主文件系统的唯一入口,
 * 集合怎么存直接决定能不能被绕开。三条收口,缺一条即留缺口:
 * - 与真实产物绑定:登记前 stat 校验「存在且是文件」,打开前再校验一次。
 *   登记一个尚未生成/已被删除的路径,等于给攻击者留一个「等它出现」或
 *   「等同名文件被别的程序放进去」的时间窗;同路径被替换后同样不该继续放行。
 * - 规范化后再比对:只收绝对路径,经 path.resolve 归一(消解 `.`/`..`/分隔符写法),
 *   win32 下按小写折叠(Windows 文件名本身大小写不敏感,否则换个大小写就绕过);
 *   相对路径一律拒(会按 cwd 解析,cwd 不可控)。
 * - 有界增长:条目上限 OUTPUT_ALLOWLIST_MAX_ENTRIES,超出按插入序淘汰最旧,
 *   防长会话批量转换把集合撑成无界(内存 + 逐次 stat 成本)。
 *
 * 会话级集合即可覆盖全部合法入口:各转换 handler 成功时登记当次产物,
 * 应用重启后 renderer 侧缓存同样清零,无合法场景受损。
 *
 * 全同步的取舍:stat 走 statSync。判定只发生在「用户点了打开/在资源管理器中显示」
 * 与「转换成功登记」两处,单次 stat 的量级(微秒级)远小于一次转换(百毫秒级),
 * 换来的是白名单判定无 await 缝隙、两个 shell handler 都能保持同步返回。
 */
import { statSync } from "node:fs";
import path from "node:path";

/** 条目上限(超出按插入序淘汰最旧;取值依据:一次批量转换的量级远小于它) */
export const OUTPUT_ALLOWLIST_MAX_ENTRIES = 200;

/** 白名单依赖面(默认真实 fs;测试注入以构造「未生成/已删除/非文件」等边界) */
export interface OutputAllowlistDeps {
  /** 目标是否仍是文件(stat 失败/是目录 → false) */
  isFile: (filePath: string) => boolean;
  /** 比较键规范化:非法输入返回 null(拒) */
  normalize: (filePath: string) => string | null;
}

/** 白名单能力面 */
export interface OutputAllowlist {
  /** 登记产物路径;目标不存在/非文件/路径非法 → false(不登记) */
  allow: (outputPath: string) => boolean;
  /** 成员判定(仅规范化后比对,不做 IO) */
  has: (filePath: string) => boolean;
  /** 打开前判定并取规范化后的绝对路径:非成员或目标已不存在 → null */
  resolveOpenable: (filePath: string) => string | null;
  /** 当前条目数(上限/淘汰断言用) */
  size: () => number;
  /** 清空(测试与显式重置用) */
  clear: () => void;
}

/** 默认 isFile:stat 判定「存在且是普通文件」;任何异常(含权限不足)一律视为否 */
function defaultIsFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * 比较键规范化:空串/非绝对路径 → null(拒);其余经 path.resolve 归一后,
 * win32 折小写(Windows 路径本身大小写不敏感,不折叠等于留一个大小写绕过口)。
 * @param filePath 待规范化路径
 * @returns 规范化比较键;路径非法时 null
 */
export function normalizeOutputPath(filePath: string): string | null {
  if (typeof filePath !== "string" || filePath.trim() === "") return null;
  if (!path.isAbsolute(filePath)) return null;
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** 默认依赖面(真实 fs) */
export const defaultOutputAllowlistDeps: OutputAllowlistDeps = {
  isFile: defaultIsFile,
  normalize: normalizeOutputPath,
};

/**
 * 创建会话级产物白名单。
 * @param options maxEntries 条目上限;deps 可注入依赖面(缺省真实 fs)
 */
export function createOutputAllowlist(
  options: { maxEntries?: number; deps?: OutputAllowlistDeps } = {},
): OutputAllowlist {
  const maxEntries = options.maxEntries ?? OUTPUT_ALLOWLIST_MAX_ENTRIES;
  const deps = options.deps ?? defaultOutputAllowlistDeps;
  /** 比较键 → 规范化后的绝对路径(Map 保插入序,供最旧淘汰) */
  const entries = new Map<string, string>();

  const prune = (): void => {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done === true) return;
      entries.delete(oldest.value);
    }
  };

  return {
    allow(outputPath: string): boolean {
      const key = deps.normalize(outputPath);
      if (key === null) return false;
      // 登记前校验:尚未生成 / 是目录 / 已被删除的路径一律不进白名单
      if (!deps.isFile(outputPath)) return false;
      // 重复登记视为刷新最近使用序(先删后插,否则旧条目会被当最旧淘汰)
      entries.delete(key);
      entries.set(key, key);
      prune();
      return true;
    },
    has(filePath: string): boolean {
      const key = deps.normalize(filePath);
      return key !== null && entries.has(key);
    },
    resolveOpenable(filePath: string): string | null {
      const key = deps.normalize(filePath);
      if (key === null || !entries.has(key)) return null;
      // 打开前复验:登记后被删除/被换成目录的条目不再放行
      if (!deps.isFile(key)) return null;
      return key;
    },
    size: () => entries.size,
    clear: () => entries.clear(),
  };
}
