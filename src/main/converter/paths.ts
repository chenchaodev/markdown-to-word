/**
 * 路径收集与输出路径解析(目录重组批⑤自 converter.ts 拆出):
 * resolveOutputPath(重名序号/超长回落)、collectMarkdownPaths(目录递归收集)、
 * filterExistingPaths(会话恢复保序过滤)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { ConvertFormat } from "../../core/convert.js";
import type { ConvertWarning } from "../../core/i18n.js";

/** markdown 扩展名判定单源(MR-6:原 single/merge/logic 各持一套正则拼写):
 *  .md / .markdown,大小写不敏感。 */
export const MARKDOWN_EXT_RE = /\.(md|markdown)$/i;

/** 路径(或文件名)去掉 markdown 扩展名;非 md 后缀原样返回。 */
export function stripMarkdownExt(name: string): string {
  return name.replace(MARKDOWN_EXT_RE, "");
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析输出路径(批次 7「体验优化」):
 * - outputDir 空串 → 源文件同目录;非空 → outputDir(不存在则创建,失败回落源目录)
 * - 重名自动加序号「名 (2).ext」,绝不覆盖已有文件
 * - 超长路径(>250 字符)→ 回落源目录并警告(Windows MAX_PATH 限制,Electron 侧无解)
 * 返回 warnings 携带回落原因;调用方负责把 warnings 并入转换结果。
 */
export async function resolveOutputPath(
  filePath: string,
  format: ConvertFormat,
  outputDir: string,
  baseName?: string,
): Promise<{ outputPath: string; warnings: ConvertWarning[] }> {
  const warnings: ConvertWarning[] = [];
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
  let i = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(dir, `${name} (${i})${ext}`);
    i++;
  }
  return { outputPath: candidate, warnings };
}

/**
 * 收集 markdown 路径:目录递归收集其下所有 .md/.markdown 文件(跳过点开头的目录,如 .git),
 * 文件直接保留;非 md 的传入路径进 skipped(目录内非 md 文件静默忽略,目录不列入 skipped)。
 * 结果按字典序排序(大小写不敏感);seen 集合防符号链接循环。
 */
export async function collectMarkdownPaths(paths: string[]): Promise<{ files: string[]; skipped: string[] }> {
  const files: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  async function visit(p: string, passedDirectly: boolean): Promise<void> {
    const resolved = path.resolve(p);
    if (seen.has(resolved)) return; // 循环保护
    seen.add(resolved);
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
      st = await fs.stat(resolved);
    } catch {
      if (passedDirectly) skipped.push(p); // 不存在/无法访问的传入路径
      return;
    }
    if (st.isDirectory()) {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue; // 跳过 .git 等点开头目录
        await visit(path.join(resolved, entry.name), false);
      }
      return;
    }
    if (MARKDOWN_EXT_RE.test(resolved)) {
      files.push(resolved);
    } else if (passedDirectly) {
      skipped.push(p);
    }
  }

  for (const p of paths) await visit(p, true);
  files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return { files, skipped };
}

/**
 * 保序过滤仍存在的路径(批次 11 会话恢复用):逐个 fs.stat,存在即保留,缺失剔除,
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
