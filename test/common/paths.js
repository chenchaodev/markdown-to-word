// @ts-check
/**
 * 测试路径常量:输入(fixtures,入仓可版本化)与产物(artifacts/smoke,gitignore)分离。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 项目根目录 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 测试输入样例(静态文件,随仓库维护) */
export const FIXTURES_DIR = path.join(ROOT, "test", "fixtures");

/** 验收断言产物(按主题命名,无编号) */
export const ARTIFACTS_DIR = path.join(ROOT, "output", "artifacts");

/** smoke 临时产物(运行时自清理) */
export const SMOKE_DIR = path.join(ROOT, "output", "smoke");

/** 失败段专属产物(失败日志 + 该段 buffer 快照;与成功路径产物目录分离,互不覆盖) */
export const FAILURES_DIR = path.join(ARTIFACTS_DIR, "failures");

/**
 * 某失败段的产物目录:段名 → 目录名(段名 segments/utils.test.js → segments_utils)。
 * 段名带目录前缀,替换分隔符即可保证跨目录同名段不落进同一目录。
 * @param {string} segmentName 段名(如 segments/utils.test.js)
 * @returns {string} 绝对目录路径
 */
export function segmentFailureDir(segmentName) {
  const dirName = segmentName.replace(/[\\/]/g, "_").replace(/\.test\.js$/, "");
  return path.join(FAILURES_DIR, dirName);
}

/**
 * 报告/日志用的仓库相对路径(统一正斜杠,跨平台可比对)。
 * @param {string} target 绝对路径
 * @returns {string}
 */
export function repoRelative(target) {
  return path.relative(ROOT, target).split(path.sep).join("/");
}

/** KaTeX dist 目录(公式相关段使用) */
export const KATEX_DIR = path.join(ROOT, "node_modules", "katex", "dist");
