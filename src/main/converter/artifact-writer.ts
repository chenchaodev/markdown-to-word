/**
 * 产物提交器:同目录唯一临时文件 + 硬链接独占提交(docx/PDF/单文件/批量/合并共用同一入口)。
 *
 * 契约(勿回退,详见 docs/OPTIMIZATION-PLAN.md 的输出选名与原子提交条目):
 * - 选名与占位合并为一次独占操作:首选路径不存在即被占用,已存在(EEXIST)→ 递增
 *   「名 (N).ext」。因此不存在「先 stat 判空、再写盘」的 TOCTOU 窗口——多窗口/批量
 *   /外部进程并发同名互不覆盖(写盘前的存在性探测一律不在本链路做)。
 * - 提交前校验产物魔数(docx = ZIP 容器、pdf = %PDF):不符即抛错,最终路径零副作用,
 *   杜绝「截断/半成品被当成成功产物」。
 * - 提交只用同目录硬链接:目标已存在必失败,天然独占且原子(读者要么看不到该路径,要么
 *   看到完整内容);数据在临时文件里就绪,链接成功即完整产物出现在最终路径。
 * - 硬要求(勿降级):拿不到同目录硬链接能力时**没有**原子提交手段。此时不做「独占
 *   创建 + 直写最终路径」的退化写——直写在写失败或进程中断时会留下半截文件,正是
 *   本模块要消灭的产物,再「写完再删」也追不回被强杀的进程。这类环境直接抛可操作
 *   错误(临时文件已清理、最终路径零文件),由用户改选支持硬链接的输出目录;真实故障
 *   (EIO 等)原样上抛,不与「环境不支持」混为一谈。
 * - 任何失败/取消/异常都在 finally 清理临时文件,不留下可被误认成功的最终文件。
 *
 * 依赖方向:本模块只依赖 node 内置,被 paths.ts 的消费方(single.ts)单向调用。
 */
import { randomUUID } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

/**
 * 临时文件名前缀(导出供残留审计/测试断言):点开头,避免与用户可见产物混淆,
 * 也不会被 markdown 收集命中(.md/.markdown 过滤)。
 */
export const ARTIFACT_TEMP_PREFIX = ".m2w-tmp-";

/** 临时文件随机段碰撞重试次数('wx' 独占创建遇 EEXIST 时换名;randomUUID 下实际不可达) */
const TEMP_NAME_ATTEMPTS = 3;

/** 重名序号探测上限:超过视为异常环境(如外部进程批量造同名文件),抛错而非无限找名 */
const MAX_NAME_ATTEMPTS = 1000;

/**
 * 「本文件系统/平台无法创建硬链接」的错误码集合(与真实故障区分,决定错误文案):
 * Windows 非 NTFS(FAT32/exFAT 移动盘、部分网络盘/虚拟盘)返回 EPERM;POSIX 跨设备
 * EXDEV;部分平台无此系统调用(ENOSYS/EOPNOTSUPP/ENOTSUP);EMLINK(链接数上限)、
 * EACCES(目录无硬链接权限)、EINVAL(文件系统拒绝)。其余错误码(如 EIO、ENOSPC)属真实
 * 故障,原样上抛——不得把真实故障改写成「换目录」提示,那会掩盖可修复的磁盘问题。
 */
const LINK_UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
  "EPERM",
  "EACCES",
  "EXDEV",
  "ENOSYS",
  "EOPNOTSUPP",
  "ENOTSUP",
  "EMLINK",
  "EINVAL",
]);

/** 产物魔数(按扩展名,单源):docx = ZIP 容器(三种合法首部),pdf = %PDF */
const MAGIC_SIGNATURES: Readonly<Record<string, ReadonlyArray<ReadonlyArray<number>>>> = {
  ".docx": [
    [0x50, 0x4b, 0x03, 0x04], // 普通条目(local file header)
    [0x50, 0x4b, 0x05, 0x06], // 空归档(end of central directory)
    [0x50, 0x4b, 0x07, 0x08], // 跨卷拼接(spanned)
  ],
  ".pdf": [[0x25, 0x50, 0x44, 0x46]], // "%PDF"
};

/** 硬链接提交实现(依赖注入:测试注入失败以覆盖「环境不支持」与「真实故障」两条分支) */
export type LinkFn = (existingPath: string, newPath: string) => Promise<void>;

export interface CommitArtifactOptions {
  /**
   * 提交前闸门:抛错即放弃提交(临时文件在 finally 清理,最终路径零副作用)。
   * 调用方注入取消检查——产物已渲染完但用户已取消时不得落盘。
   */
  beforeCommit?: () => void;
  /** 硬链接实现,默认 fs.link */
  link?: LinkFn;
}

/** errno 判定(EEXIST = 名已被占;其他码按语义处理) */
function errnoCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** 首部字节是否命中该扩展名任一合法魔数 */
function hasMagic(data: Uint8Array, signatures: ReadonlyArray<ReadonlyArray<number>>): boolean {
  return signatures.some((signature) => signature.every((byte, index) => data[index] === byte));
}

/**
 * 魔数校验(提交前最后一道闸):未知扩展名与魔数不符都视为产物不可信,
 * 抛错由调用方转成转换失败——绝不写出最终文件。
 */
function assertMagic(ext: string, data: Uint8Array, preferredPath: string): void {
  const signatures = MAGIC_SIGNATURES[ext];
  if (!signatures) {
    throw new Error(`不支持的产物扩展名(${ext}),无法提交:${preferredPath}`);
  }
  if (!hasMagic(data, signatures)) {
    throw new Error(`产物格式校验失败(${ext} 魔数不符,共 ${data.length} 字节),未写出文件:${preferredPath}`);
  }
}

/**
 * 写同目录唯一临时文件:'wx' 独占创建(randomUUID 随机段,碰撞换名重试)→ 落盘 → sync。
 * 必须与最终路径同目录:提交走硬链接,跨目录/跨卷不可链接(EXDEV)。
 * sync 保证提交点上数据已落盘,而非仅在页缓存。
 */
async function writeTempArtifact(dir: string, ext: string, data: Uint8Array): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < TEMP_NAME_ATTEMPTS; attempt++) {
    const tempPath = path.join(dir, `${ARTIFACT_TEMP_PREFIX}${process.pid}-${randomUUID().slice(0, 8)}${ext}`);
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(tempPath, "wx");
      await handle.writeFile(data);
      await handle.sync();
      await handle.close();
      return tempPath;
    } catch (err) {
      await handle?.close().catch(() => undefined);
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      if (errnoCode(err) !== "EEXIST") throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * 独占提交(与选名同一次操作):首选路径 → 硬链接;EEXIST → 递增序号重试。
 * 环境不支持硬链接时抛可操作错误(不降级为直写最终路径,理由见文件头「硬要求」)。
 */
async function commitExclusive(
  tempPath: string,
  preferredPath: string,
  stem: string,
  ext: string,
  link: LinkFn,
): Promise<string> {
  const dir = path.dirname(preferredPath);
  for (let index = 0; index < MAX_NAME_ATTEMPTS; index++) {
    const finalPath = index === 0 ? preferredPath : path.join(dir, `${stem} (${index + 1})${ext}`);
    try {
      // 数据已在临时文件就绪,链接成功即完整产物出现在最终路径(独占 + 原子)
      await link(tempPath, finalPath);
      return finalPath;
    } catch (err) {
      const code = errnoCode(err);
      if (code === "EEXIST") continue; // 已被占(本进程/外部)→ 递增序号
      if (code !== undefined && LINK_UNSUPPORTED_CODES.has(code)) {
        throw new Error(
          `产物提交失败:${finalPath} 所在文件系统不支持硬链接(错误码 ${code}),无法原子提交;` +
            `未产生最终文件。请把输出目录改到本地磁盘等支持硬链接的位置后重试。`,
        );
      }
      throw err; // 真实故障(EIO/ENOSPC 等)原样上抛
    }
  }
  throw new Error(`同名产物过多(重名序号已用尽 ${MAX_NAME_ATTEMPTS} 个):${preferredPath}`);
}

/**
 * 提交产物到首选路径(实际路径可能带重名序号),返回最终路径。
 * 流程:魔数校验 → 同目录唯一临时文件 → 提交前闸门 → 硬链接独占提交 → finally 清理临时文件。
 */
export async function commitArtifact(
  preferredPath: string,
  data: Uint8Array,
  options: CommitArtifactOptions = {},
): Promise<string> {
  const rawExt = path.extname(preferredPath);
  const ext = rawExt.toLowerCase();
  assertMagic(ext, data, preferredPath);
  const tempPath = await writeTempArtifact(path.dirname(preferredPath), ext, data);
  try {
    options.beforeCommit?.(); // 取消/异常:不提交,finally 清临时文件
    const stem = path.basename(preferredPath, rawExt);
    return await commitExclusive(tempPath, preferredPath, stem, ext, options.link ?? fs.link);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}
