// ESLint 10 flat config(ESM)。typescript-eslint 经 side-by-side 使用 TS 6 API
// (package.json: typescript 别名 @typescript/typescript6,tsc 二进制仍为 TS 7)。
// 规则集:仅 correctness(方向 B 决策,2026-08-14,见 archive/20260814-185113)。
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import tseslint from "typescript-eslint";

// allowDefaultProject 目录 glob 运行时扫描生成(技术债 E4,2026-09-25,替代手工清单)。
// 库约束实证(typescript-estree validateDefaultProjectForFilesGlob):glob 含 `**`
// 或等于裸 `*` 即 throw(性能护栏),递归通配不可用——故按「实际存在的目录 × 该目录
// 中出现的扩展名(.js/.mjs/.cjs)」生成逐目录 glob,新增子目录自动覆盖,无需登记。
// 失败模式保持显式不静默:文件不在 tsconfig program 又无 glob 匹配 → lint 时
// ts-eslint 报「not found by the project service」;匹配文件数超上限(100)→ 同样报错。
const NON_PROGRAM_EXTS = new Set([".js", ".mjs", ".cjs"]);
function defaultProjectGlobs(roots) {
  const globs = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(join(dir, entry.name));
      } else if (NON_PROGRAM_EXTS.has(extname(entry.name))) {
        globs.add(`${dir.replaceAll("\\", "/")}/*${extname(entry.name)}`);
      }
    }
  };
  roots.forEach(walk);
  return [...globs].sort();
}

export default tseslint.config(
  {
    ignores: ["dist/**", "output/**", "release/**", "coverage/**", "node_modules/**"],
  },
  tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // 批次 15 第 5 项:lint 范围扩到 test/scripts。tsconfig.json 无 allowJs,
        // .js/.mjs 不进 TS program(projectService 报「not found by the project service」),
        // 经 allowDefaultProject 放行(typescript-eslint 官方方案,不改 tsconfig 结构)。
        // 清单来源:defaultProjectGlobs 运行时扫描(文件头注释),新目录零登记。
        projectService: {
          allowDefaultProject: defaultProjectGlobs(["src", "test", "scripts"]),
          // 阶段 0 新增几何/产物/指纹脚本与测试后默认项目文件数超过 100；
          // 提高上限是为保持零登记 lint 覆盖，不是放宽类型门禁。
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 200,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 类型感知 correctness(tsc strict 不覆盖:未处理 Promise 等)
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // 基础 correctness
      "eqeqeq": ["error", "smart"],
      "no-constant-condition": "error",
      "no-empty": "error",
    },
  },
  {
    // Electron 预加载脚本为 CJS,必须 require("electron"),放行 require 导入(与 lang-bootstrap.js 同属非 tsc 编入的 renderer 脚本)
    files: ["src/renderer/about-preload.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);