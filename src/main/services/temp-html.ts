/**
 * 临时文件生命周期(预览/打印 HTML 与剪贴板 Markdown 源共用本模块):
 * - writeTempHtml:预览/打印页面的临时 HTML,调用方持有 cleanup 负责回收;
 * - writeTempMarkdown:剪贴板文本落成的临时 Markdown 源,返回**一次性释放句柄**,
 *   配合 ClipboardTempRegistry 登记到「消费方(webContents)」名下,保证成功/失败/
 *   取消/窗口关闭/退出五条出口都走到删除,且不进入最近文件。
 * 清理失败(如仍被 Chromium 占用)仅记录,不阻断。
 * 卫生加固:
 * - 文件名随机段改 crypto.randomUUID()(CSPRNG,替代 Math.random);
 * - writeFile 加 'wx' 独占标志(防理论上的文件名碰撞覆盖;碰撞时换名重试);
 * - 剪贴板源落 m2w-clipboard-{pid} 专属子目录:文件基名即文档标题(不再用随机
 *   临时名,产物名与文档标题可直接读),同时目录名可被会话级判定识别,便于回收。
 * 启动期清扫崩溃残留未做:残留仅发生在「写入成功后进程即崩溃」的极端路径,
 *   审计评估风险极低;且扫描共享 %TEMP% 目录需按 pid 存活性判定,误删其他实例
 *   在用文件的风险大于收益——记录在案,暂不实现。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** 文件名碰撞重试次数('wx' 独占写入遇 EEXIST 时换名重试;randomUUID 下实际不可达)。 */
const NAME_COLLISION_RETRIES = 3;

/** 剪贴板源标题长度上限(字符):同时约束临时文件名与由此派生的产物名/输出路径长度。 */
const TITLE_MAX_CHARS = 60;

/** Windows 保留设备名(不区分大小写):整体作文件名会指向设备而非文件。 */
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** ATX 标题行(1-6 级,可含结尾闭合井号)。 */
const ATX_HEADING_RE = /^ {0,3}#{1,6}\s+(.*\S)\s*$/;

/** 剥掉标题行末尾的闭合井号(CommonMark 要求闭合井号前有空白,否则属标题正文)。 */
function stripClosingHashes(text: string): string {
  return text.replace(/\s+#+$/, "").trim();
}

/** 围栏行(``` / ~~~):代码块边界本身不作标题。 */
const CODE_FENCE_RE = /^\s*(?:```+|~~~+)/;

/** 含可见文字(字母/数字,含中日韩等)的判定:纯标点/分隔线不作标题。 */
const HAS_VISIBLE_TEXT_RE = /[\p{L}\p{N}]/u;

/** 剪贴板临时源专属子目录(按 pid 隔离:仅本进程写入,空目录随释放回收)。 */
export function clipboardTempDir(): string {
  return path.join(os.tmpdir(), `m2w-clipboard-${process.pid}`);
}

/**
 * 独占写入 + 换名重试:同一目录内按 attempt 生成候选名,'wx' 独占创建
 * (已存在即 EEXIST 换名);ENOENT 视为「子目录刚被并发释放回收」→ 重建目录重试。
 * 目录每次尝试前 mkdir -p(递归,已存在为空操作),既防 %TEMP% 被外部清理,
 * 也消除「写入前目录被回收」的竞态。
 */
async function writeExclusiveTemp(
  dir: string,
  candidateName: (attempt: number) => string,
  content: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < NAME_COLLISION_RETRIES; attempt++) {
    const filePath = path.join(dir, candidateName(attempt));
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST" && code !== "ENOENT") throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * 写入临时 HTML(os.tmpdir,命名 m2w-{pid}-{time}-{uuid短}.html),返回路径与清理函数。
 * 注意:调用方须在窗口 closed/销毁路径上调用 cleanup,避免残留。
 */
export async function writeTempHtml(
  html: string,
): Promise<{ htmlPath: string; cleanup: () => Promise<void> }> {
  const htmlPath = await writeExclusiveTemp(
    os.tmpdir(),
    () => `m2w-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}.html`,
    html,
  );
  return {
    htmlPath,
    cleanup: async () => {
      await fs.rm(htmlPath, { force: true }).catch(() => undefined);
    },
  };
}

/** 文件名安全化:Windows 禁用字符/控制字符→空格,折叠空白,去首尾空白与尾点,限长;空则返回空串。 */
function sanitizeFileTitle(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, TITLE_MAX_CHARS)
    .trim();
  if (cleaned === "") return "";
  return RESERVED_DEVICE_NAMES.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * 剪贴板源标题:首个 ATX 标题 → 首个含可见文字的非围栏行 → fallback。
 * 围栏内是代码不作标题(成对围栏切换,未闭合则其后全部跳过);
 * 标题决定临时文件基名(进而决定产物名与文档标题),故不用随机临时名。
 */
export function clipboardTitle(text: string, fallback: string): string {
  let inFence = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (CODE_FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === "") continue;
    const heading = ATX_HEADING_RE.exec(line);
    const candidate = heading ? stripClosingHashes(heading[1] ?? "") : line;
    if (!HAS_VISIBLE_TEXT_RE.test(candidate)) continue;
    return candidate;
  }
  return fallback;
}

/** 剪贴板临时源句柄:路径 + 一次性释放(幂等,重复调用为空操作)。 */
export interface ClipboardTempSource {
  readonly mdPath: string;
  /** 释放:删除临时文件(并回收空的专属子目录);可重复调用。 */
  release(): Promise<void>;
}

/** writeTempMarkdown 可选参数:标题决定文件名;dir 决定落盘目录(缺省临时根目录)。 */
export interface WriteTempMarkdownOptions {
  /** 文档标题(经文件名安全化);缺省用通用名 clipboard。 */
  title?: string;
  /** 落盘子目录(如剪贴板专属目录);缺省 os.tmpdir()。 */
  dir?: string;
}

/**
 * 写入临时 Markdown,返回一次性释放句柄。
 * 文件名 = 标题.md(标题同名仍在时换名重试为 标题-2.md/-3.md),因此产物名与
 * 文档标题直接来自剪贴板内容,不再暴露 m2w-{pid}-{time}-{uuid} 随机临时名。
 */
export async function writeTempMarkdown(
  text: string,
  options: WriteTempMarkdownOptions = {},
): Promise<ClipboardTempSource> {
  const dir = options.dir ?? os.tmpdir();
  const base = sanitizeFileTitle(options.title ?? "") || "clipboard";
  const mdPath = await writeExclusiveTemp(
    dir,
    (attempt) => (attempt === 0 ? `${base}.md` : `${base}-${attempt + 1}.md`),
    text,
  );
  let released = false;
  return {
    mdPath,
    release: async () => {
      if (released) return; // 一次性:多处出口(finally/窗口关闭/退出)重复调用不重复删
      released = true;
      await fs.rm(mdPath, { force: true }).catch(() => undefined);
      // 专属子目录空则回收(非空或已被回收时静默失败;下次写入会重建)
      if (dir !== os.tmpdir()) await fs.rm(dir).catch(() => undefined);
    },
  };
}

/** 登记条目:ownerId(webContents id)+ 释放函数。 */
interface ClipboardTempRecord {
  readonly ownerId: string;
  readonly release: () => Promise<void>;
}

/**
 * 剪贴板临时源注册表(纯 Node,零 Electron 依赖,可直测):
 * - 同一消费方同时至多一个存活句柄(再次粘贴先释放上一份);
 * - 释放出口三选一:按路径(转换收尾,成功/失败/取消同一处)、按消费方
 *   (窗口关闭)、全量(退出);
 * - isTempSource 判定覆盖「本会话出现过的全部临时源(含已释放)」,供最近文件
 *   等需要会话级历史的过滤使用——只看在活集合会漏掉已释放的路径。
 */
export class ClipboardTempRegistry {
  /** 存活句柄:消费方 → 路径。 */
  readonly #byOwner = new Map<string, string>();
  /** 存活句柄:路径 → 条目。 */
  readonly #byPath = new Map<string, ClipboardTempRecord>();
  /** 本会话出现过的全部临时源路径(含已释放)。 */
  readonly #seen = new Set<string>();

  /** 登记新的临时源:先释放同一消费方的旧句柄,再登记(返回登记是否落地)。 */
  async add(ownerId: string, source: ClipboardTempSource): Promise<void> {
    await this.releaseOwner(ownerId);
    this.#byOwner.set(ownerId, source.mdPath);
    this.#byPath.set(source.mdPath, { ownerId, release: () => source.release() });
    this.#seen.add(source.mdPath);
  }

  /** 是否本会话的剪贴板临时源(含已释放):最近文件等过滤的唯一判定。 */
  isTempSource(mdPath: string): boolean {
    return this.#seen.has(mdPath);
  }

  /** 尚未消费(等待转换收尾)的临时源数量:诊断与测试用。 */
  get pendingCount(): number {
    return this.#byPath.size;
  }

  /** 按路径释放(转换收尾出口);非托管路径为空操作。 */
  async releaseByPath(mdPath: string): Promise<void> {
    await this.#take(mdPath)?.();
  }

  /** 释放某消费方名下的临时源(窗口关闭/退出);无登记为空操作。 */
  async releaseOwner(ownerId: string): Promise<void> {
    const mdPath = this.#byOwner.get(ownerId);
    if (mdPath === undefined) return;
    await this.#take(mdPath)?.();
  }

  /** 释放全部存活句柄(进程退出兜底)。 */
  async releaseAll(): Promise<void> {
    for (const mdPath of [...this.#byPath.keys()]) {
      await this.#take(mdPath)?.();
    }
  }

  /** 从索引摘除并返回释放函数(先摘除后释放:并发重复释放退化为幂等空操作)。 */
  #take(mdPath: string): (() => Promise<void>) | undefined {
    const record = this.#byPath.get(mdPath);
    if (record === undefined) return undefined;
    this.#byPath.delete(mdPath);
    if (this.#byOwner.get(record.ownerId) === mdPath) this.#byOwner.delete(record.ownerId);
    return record.release;
  }
}

/** 进程内单例:IPC 注册与主窗口关闭共用同一注册表(生命周期接线方唯一)。 */
export const clipboardTempSources = new ClipboardTempRegistry();
