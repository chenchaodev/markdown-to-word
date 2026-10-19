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
/**
 * 扫描出 allowDefaultProject 的逐目录 glob,并统计会被这些 glob 匹配的文件数。
 * 计数与 glob 出自同一趟 walk,二者不可能对不上。
 * @param {string[]} roots
 * @returns {{ globs: string[], fileCount: number }}
 */
function scanDefaultProject(roots) {
  const globs = new Set();
  let fileCount = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(join(dir, entry.name));
      } else if (NON_PROGRAM_EXTS.has(extname(entry.name))) {
        globs.add(`${dir.replaceAll("\\", "/")}/*${extname(entry.name)}`);
        fileCount += 1;
      }
    }
  };
  roots.forEach(walk);
  return { globs: [...globs].sort(), fileCount };
}

const defaultProject = scanDefaultProject(["src", "test", "gates", "tools", "shared"]);

export default tseslint.config(
  {
    ignores: ["dist/**", "output/**", "release/**", "node_modules/**"],
  },
  tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // 批次 15 第 5 项:lint 范围扩到 test/门禁树。tsconfig.json 无 allowJs,
        // .js/.mjs 不进 TS program(projectService 报「not found by the project service」),
        // 经 allowDefaultProject 放行(typescript-eslint 官方方案,不改 tsconfig 结构)。
        // 清单来源:scanDefaultProject 运行时扫描(文件头注释),新目录零登记。
        projectService: {
          allowDefaultProject: defaultProject.globs,
          // 上限 = 实际匹配文件数 + 50 余量,由同一趟扫描得出。
          // 历史上这里是硬编码的 100 → 200 → 300:每加几个测试文件就整体报
          // "Too many files",而测试树增长是常态 ⇒ 每逢新增段就要改这一格。
          // 数字与扫描面同源后,增长不再触发;护栏仍在原处 —— 库对 `**` 通配直接
          // throw,且本清单按「真实目录 × 实际扩展名」生成,不存在失控匹配形态。
          // 此值只影响 lint 的性能护栏,**不放宽任何类型或规则门禁**。
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING:
            defaultProject.fileCount + 50,
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
    // CJS 预加载脚本必须 require(...),放行 require 导入。两类都在此集中登记,勿在文件里就地 eslint-disable:
    // ① src/renderer/about-preload.cjs —— Electron 预加载,与 lang-bootstrap.js 同属非 tsc 编入的 renderer 脚本
    // ② tools/visual-about-preload.cjs —— 截图工具的 about 窗桩,contextIsolation+sandbox 口径与真实 about 窗一致故同样为 CJS
    files: ["src/renderer/about-preload.cjs", "tools/visual-about-preload.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // 非 tsc program 的三棵树(gates / shared / tools)开 no-undef(REQ-170)。
    //
    // ⚠ 这块对 `shared/` 生效的前提是 lint 扫描串含 `shared/` —— REQ-237(2026-10-13)补上该串,
    // 此前配置在此空转(package.json 的 lint 串从不传 `shared/` ⇒ 脚本压根不扫它)。自此三棵树
    // 才真被扫到,本块的 no-undef 才对 `shared/**` 名副其实。
    //
    // 为什么需要它:`no-undef` 默认不在 tseslint.configs.recommended 里
    // (typescript-eslint 刻意关掉它,因为 TS 自己查未定义标识符)。而这三棵树不在任何
    // tsconfig 的 include 内(tsconfig.json 只含 src,tsconfig.test.json 只含 test),
    // TS 查不到它们 ⇒ 标识符拼错、用了不存在的名字,两道静态检查都不报,只有
    // `npm run acceptance` 真跑到那一行才炸 —— 门禁脚本的错误发现被推迟到最贵的时刻。
    //
    // 为什么不用 tsc checkJs 替代(曾评估并否决):实测给 gates/ 开 checkJs 产生 1028 条
    // 错误,其中 544 条是参数/绑定/索引隐式 any(纯缺 JSDoc 标注,.mjs 无标注时永远
    // 满足不了 strict)、106 条是继承的 noUncheckedIndexedAccess(对无标注 JS 无意义)、
    // 18 条 TS2304 全是跨模块 JSDoc typedef 引用未导入(GateProbeResult 等声明在
    // contract.mjs 却跨文件直接引用,JSDoc 类型是模块作用域的),**真拼错 0 条**。
    // 清零那 1028 条等于给 3 万行 JS 逐个补类型注解,与本条诉求(抓一个字符的错)不成比例。
    // 本块实测存量 1 条(仅 setImmediate 未声明为 global),代价与收益相差三个数量级。
    //
    // globals 在此集中声明,勿在文件里就地 eslint-disable:三棵树不在 TS program 内,
    // ESLint 无从得知 node 内置全局,缺声明即报未定义。
    files: ["gates/**/*.mjs", "shared/**/*.mjs", "shared/**/*.js", "tools/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        structuredClone: "readonly",
        fetch: "readonly",
        performance: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        queueMicrotask: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
);