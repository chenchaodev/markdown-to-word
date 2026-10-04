// @ts-check
/**
 * 测试路径常量:输入(fixtures,入仓可版本化)与产物(artifacts/smoke,gitignore)分离。
 */
import path from "node:path";
import {
  ARTIFACTS_DIR,
  FAILURES_DIR,
  FIXTURES_DIR,
  ROOT,
  SMOKE_DIR,
} from "../../shared/paths.js";

// 路径常量的单一来源在 shared/paths.js(项目根在那里唯一定义,取值恒等于 `process.cwd()`)。
// 本文件保留同名再导出,是测试树的历史入口:约 40 个段经 `../harness/paths.js` 取值,
// 改导入路径属纯机械 churn 且无收益,故维持转出面不变。
export { ARTIFACTS_DIR, FAILURES_DIR, FIXTURES_DIR, ROOT, SMOKE_DIR };

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
