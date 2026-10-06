/**
 * 路径收集与输出路径解析:
 * resolveOutputPath(输出目录/超长回落)、collectMarkdownPaths(目录递归收集)、
 * filterExistingPaths(会话恢复保序过滤)。
 * 「输出写不了」的失败点抛带**稳定错误码**的错(码单源在 artifact-writer 的
 * OUTPUT_UNWRITABLE_CODES;消费方 cli/index.ts 据此判退出码 4,不匹配文案)。
 * 目录扫描有预算:realpath 规范路径去重(junction/symlink 环不再无限递归)、
 * 深度与条目数上限;超限停止收集并经 warnings 通道上报(不静默截断)。
 */
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
// 「输出写不了」的稳定错误码单源在 artifact-writer(落盘侧的两个失败点也在那里);
// 本模块的 mkdir 失败是同一族第三个失败点,故从那里取码而不是就地写字面量。
import { OUTPUT_UNWRITABLE_CODES, outputUnwritableError } from "./artifact-writer.js";
import type { ConvertFormat } from "../core/settings/settings-defaults.js";
import type { ConvertWarning, KeyedWarning } from "../core/i18n/index.js";

/** 目录递归深度上限:超出层级的子目录不再展开(异常深的树不拖垮会话) */
// 刻意非用户可配:环境/资源类硬边界,进设置面板即成「调坏即出事」的旋钮。
export const MAX_SCAN_DEPTH = 32;
/** 单次收集的目录条目上限:超大目录树按上限截断并上报 */
// 刻意非用户可配:环境/资源类硬边界,进设置面板即成「调坏即出事」的旋钮。
export const MAX_SCAN_ENTRIES = 20_000;

/** 扫描预算触顶警告:kind 为触顶维度(条目数/层级),limit 为对应上限值 */
export function pathScanLimitWarning(kind: string, limit: number): KeyedWarning {
  return {
    key: "warn.pathScanLimit",
    params: { kind, limit },
    fallback: `目录扫描达到${kind}上限(${limit}),已停止收集剩余内容`,
  };
}

/** markdown 扩展名判定单源: .md / .markdown,大小写不敏感。 */
export const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;

/** 路径(或文件名)去掉 markdown 扩展名;非 md 后缀原样返回。 */
export function stripMarkdownExt(name: string): string {
  return name.replace(MARKDOWN_EXT_RE, "");
}

/**
 * 解析输出首选路径:
 * - outputDir 空串 → 源文件同目录;非空 → outputDir(不存在则创建,失败回落源目录)
 * - 超长路径(>250 字符)→ 回落源目录并警告(Windows MAX_PATH 限制,宿主侧无解)
 * - **pinPath 非空 → 逐字采用该路径**(CLI 的 `--output`):不套用输出目录、不派生基名、
 *   不做超长回落。调用方点名了产物路径,任何「替他改主意」都是交付了另一个文件;
 *   目录不存在仍创建(用户可能要先输出到尚不存在的子目录),创建失败即抛错由调用方
 *   判为「输出写不了」(退出码 4),不静默回落。
 * - 不做存在性探测:重名序号「名 (2).ext」由产物提交器(artifact-writer)在独占创建时
 *   遇 EEXIST 递增决定(pinPath 形态下该递增被关闭,见 commitArtifact 的 renameOnConflict)。
 *   写盘前先 stat 判空必然留下「判空 → 写盘」之间的 TOCTOU 窗口
 *   (批量/多窗口/外部进程并发同名会互相覆盖),故探测逻辑已从本模块移出。
 * 返回 warnings 携带回落原因;调用方负责把 warnings 并入转换结果。
 */
export async function resolveOutputPath(
  filePath: string,
  format: ConvertFormat,
  outputDir: string,
  baseName?: string,
  pinPath?: string,
): Promise<{ outputPath: string; warnings: ConvertWarning[] }> {
  const warnings: ConvertWarning[] = [];
  if (pinPath !== undefined && pinPath !== "") {
    const pinned = path.resolve(pinPath);
    try {
      await fs.mkdir(path.dirname(pinned), { recursive: true });
    } catch (error) {
      // 原始 fs 错误码指向「哪个系统调用失败」,对人无行动价值;这里给可操作文案。
      // 不静默回落:pinPath 的语义是「就是这个路径」,换个目录交付等于骗了调用方。
      // 错误码 OUTPUT_DIR_UNAVAILABLE:与 artifact-writer 的两个「写不了」码同族,
      // cli/index.ts 据此判退出码 4(见 OUTPUT_UNWRITABLE_CODES 的注释)。
      throw outputUnwritableError(
        OUTPUT_UNWRITABLE_CODES.dirUnavailable,
        `无法创建输出目录(${path.dirname(pinned)}):${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { outputPath: pinned, warnings };
  }
  const name = baseName ?? path.basename(filePath).replace(MARKDOWN_EXT_RE, "");
  const ext = format === "docx" ? ".docx" : ".pdf";
  const srcDir = path.dirname(filePath);
  let dir = outputDir && outputDir.trim() !== "" ? path.resolve(outputDir) : srcDir;
  if (dir !== srcDir) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      warnings.push({
        key: "warn.outputDirUnavailable",
        params: { dir },
        fallback: `输出目录不可用(${dir}),已输出到源文件目录`,
      });
      dir = srcDir;
    }
  }
  let candidate = path.join(dir, `${name}${ext}`);
  if (candidate.length > 250) {
    warnings.push({
      key: "warn.outputPathTooLong",
      fallback: "输出路径过长,已输出到源文件目录",
    });
    dir = srcDir;
    candidate = path.join(dir, `${name}${ext}`);
  }
  return { outputPath: candidate, warnings };
}

/**
 * 收集 markdown 路径:目录递归收集其下所有 .md/.markdown 文件(跳过点开头的目录,如 .git),
 * 文件直接保留;非 md 的传入路径进 skipped(目录内非 md 文件静默忽略,目录不列入 skipped)。
 * 结果按字典序排序(大小写不敏感)。
 * 循环与预算(阶段 3 资源预算):
 * - 访问去重按 realpath 规范路径 —— 目录 junction/symlink 指回自身或其祖先时
 *   词法路径不同但规范路径相同,据此终止递归(此前词法去重会无限展开);
 * - 深度超 MAX_SCAN_DEPTH 的子目录不展开,条目累计超 MAX_SCAN_ENTRIES 即整体停止,
 *   两种触顶都经 warnings 上报(pathScanLimitWarning),不静默截断;
 * - files 仍为词法绝对路径(调用方按其展示/打开路径,不改既有语义)。
 */
export async function collectMarkdownPaths(
  paths: string[],
  warnings?: ConvertWarning[],
): Promise<{ files: string[]; skipped: string[] }> {
  const files: string[] = [];
  const skipped: string[] = [];
  const visited = new Set<string>(); // realpath 规范路径(junction/symlink 环去重)
  let scanned = 0;
  let limitWarning: KeyedWarning | undefined;

  async function visit(p: string, passedDirectly: boolean, depth: number): Promise<void> {
    if (limitWarning) return; // 预算已触顶:整体停止
    const resolved = path.resolve(p);
    if (depth > MAX_SCAN_DEPTH) {
      limitWarning = pathScanLimitWarning("层级", MAX_SCAN_DEPTH);
      return;
    }
    // 规范路径用于去重:词法路径相同时同一实体,规范路径相同即同一实体
    // (junction 指向祖先目录时词法路径不同 → 靠这一层终止递归)
    let canonical: string;
    try {
      canonical = await fs.realpath(resolved);
    } catch {
      if (passedDirectly) skipped.push(p); // 不存在/无法访问的传入路径
      return;
    }
    if (visited.has(canonical)) return; // 循环保护(含 junction/symlink 自指)
    visited.add(canonical);
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
      st = await fs.stat(canonical);
    } catch {
      if (passedDirectly) skipped.push(p);
      return;
    }
    if (st.isDirectory()) {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(canonical, { withFileTypes: true });
      } catch {
        return; // 目录不可读:静默跳过(不把整次收集判失败)
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue; // 跳过 .git 等点开头目录
        scanned += 1;
        if (scanned > MAX_SCAN_ENTRIES) {
          limitWarning = pathScanLimitWarning("条目数", MAX_SCAN_ENTRIES);
          return;
        }
        await visit(path.join(canonical, entry.name), false, depth + 1);
      }
      return;
    }
    if (MARKDOWN_EXT_RE.test(resolved)) {
      files.push(resolved);
    } else if (passedDirectly) {
      skipped.push(p);
    }
  }

  for (const p of paths) {
    if (limitWarning) break;
    await visit(p, true, 0);
  }
  if (limitWarning) warnings?.push(limitWarning);
  files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return { files, skipped };
}

/**
 * 保序过滤仍存在的路径(会话恢复用):逐个 fs.stat,存在即保留,缺失剔除,
 * 不改变传入顺序(会话列表顺序 = 用户排列的合并顺序,不可被打乱)。
 * 与 collectMarkdownPaths 不同:不排序、不展开目录、不做扩展名过滤。
 */
export async function filterExistingPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    try {
      await fs.stat(p);
      out.push(p);
    } catch {
      /* 缺失/不可访问:剔除 */
    }
  }
  return out;
}