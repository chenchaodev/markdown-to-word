/**
 * 测试路径常量:输入(fixtures,入仓可版本化)与产物(artifacts/smoke,gitignore)分离。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 项目根目录 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** 测试输入样例(静态文件,随仓库维护) */
export const FIXTURES_DIR = path.join(ROOT, "scripts", "test", "fixtures");

/** 验收断言产物(按主题命名,无编号) */
export const ARTIFACTS_DIR = path.join(ROOT, "output", "test", "artifacts");

/** smoke 临时产物(运行时自清理) */
export const SMOKE_DIR = path.join(ROOT, "output", "test", "smoke");

/** KaTeX dist 目录(公式相关段使用) */
export const KATEX_DIR = path.join(ROOT, "node_modules", "katex", "dist");
