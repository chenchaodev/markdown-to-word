// ESLint 10 flat config(ESM)。typescript-eslint 经 side-by-side 使用 TS 6 API
// (package.json: typescript 别名 @typescript/typescript6,tsc 二进制仍为 TS 7)。
// 规则集:仅 correctness(方向 B 决策,2026-08-14,见 archive/20260814-185113)。
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "output/**", "release/**", "node_modules/**"],
  },
  tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
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