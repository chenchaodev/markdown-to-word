// ESLint 10 flat config(ESM)。typescript-eslint 经 side-by-side 使用 TS 6 API
// (package.json: typescript 别名 @typescript/typescript6,tsc 二进制仍为 TS 7)。
// 规则集:仅 correctness(方向 B 决策,2026-08-14,见 archive/20260814-185113)。
import tseslint from "typescript-eslint";

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
        // 注:allowDefaultProject 禁止 ** 通配(性能护栏),故按目录显式枚举;
        // 默认 8 文件上限不足(test/scripts 共 47 个 .js/.mjs),按官方逃生口上调。
        projectService: {
          // 注意(审计 ENG-10):此清单为手工枚举,新增 test 子目录(或 scripts 子目录)
          // 时必须同步在此追加对应 glob,否则该目录 .js/.mjs 会因不在 TS program 而 lint 报错。
          allowDefaultProject: [
            "src/renderer/lang-bootstrap.js",
            "test/*.mjs",
            "test/common/*.js",
            "test/main/*.js",
            "test/segments/*.js",
            "test/tools/*.mjs",
            "test/tools/smoke/*.mjs",
            "scripts/*.mjs",
          ],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 100,
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
);