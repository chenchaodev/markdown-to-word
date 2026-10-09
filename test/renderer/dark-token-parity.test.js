// @ts-check
/**
 * 深色令牌双块对等(dark token parity)。
 *
 * base.css 深色令牌因 CSS 语法限制必须双写——普通规则(作用域一:用户显式
 * html[data-theme="dark"])与 @media 内规则(作用域二:跟随系统兜底
 * html:not([data-theme="light"])无法合并为同一条规则,只能逐行镜像。
 * 双写即漂移风险:漏改一侧 → 显式深色/跟随系统两模式视觉分裂。
 *
 * 与 ipc-channels 段的 preload 镜像恒等同构:无法单源 → 侧内镜像 →
 * 本段将两块规则体逐行锁恒等,任何一侧增删改 token 即红,强制同步维护。
 *
 * 块二为过渡态(base.css 注释:主进程宿主解析落地后整块移除),
 * 届时本段随之删除,勿单独保留。
 *
 * 断言面:两块规则体归一化(剥注释/去空行/trim)后序列完全相等,
 * 且提取行数下限防标记失配导致的假通过。
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../harness/paths.js";
import { createCaseSuite } from "../harness/case.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**renderer**,判据静态看不见本段的主体 ——
 * 被测对象是 `src/renderer/style/base.css` 的文本,由 `fs.readFileSync(cssPath)` 的
 * **字符串路径**读入,既不是 import 语句也不是模块。
 *
 * 主体依据(头注):头注写「base.css 深色令牌因 CSS 语法限制必须双写 —— 普通规则与 @media
 * 内规则无法合并,只能逐行镜像」,并写明「本段将两块规则体逐行锁恒等」。被测主体就是那一个
 * CSS 文件本身,故元素是它(仓库相对 POSIX 路径,判据直接对磁盘核对)。
 *
 * 注:主体不是 `.ts` 模块不构成例外 —— covers 元素只要求「在磁盘上真实存在」,
 * 不限定在 src/(见门禁文件头理由 ③)。
 */
export const covers = ["src/renderer/style/base.css"];

const cssPath = path.join(ROOT, "src", "renderer", "style", "base.css");

/**
 * 提取「选择器 { … }」规则体并归一化为行数组。
 * marker 后做括号配对扫描(CSS token 值内无花括号,配对安全);
 * 剥掉所有 /* *\/ 注释、空行与首尾空白,得到可直接比较的 token 行序列。
 */
/**
 * @param {string} src
 * @param {string} marker
 * @returns {string[]}
 */
function extractRule(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) {
    throw new Error(
      `dark-token-parity 断言失败:base.css 未找到标记「${marker}」(结构变化,提取器需同步)`,
    );
  }
  const open = src.indexOf("{", at);
  if (open < 0) {
    throw new Error(`dark-token-parity 断言失败:标记「${marker}」后无「{」`);
  }
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error(`dark-token-parity 断言失败:标记「${marker}」规则括号不配对`);
  }
  return src
    .slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  const src = fs.readFileSync(cssPath, "utf8");

  // 作用域一:显式深色;作用域二:跟随系统兜底(两块须逐行一致)
  // 提取留在 case 之外:它自身抛错表示「标记找不到 / 括号不配对」,那是取数失败,
  // 归不进「双块漂移」或「行数不足」任何一条,硬包进去只会报出与真因无关的 case 名
  const explicit = extractRule(src, 'html[data-theme="dark"] {');
  const system = extractRule(src, 'html:not([data-theme="light"]) {');

  await suite.case("深色双块规则体逐行恒等(显式 dark 与系统兜底同步维护)", () => {
    if (JSON.stringify(explicit) !== JSON.stringify(system)) {
      const max = Math.max(explicit.length, system.length);
      let first = -1;
      for (let i = 0; i < max && first < 0; i++) {
        if (explicit[i] !== system[i]) first = i;
      }
      throw new Error(
        `dark-token-parity 断言失败:深色双块逐行漂移(首个差异第 ${first + 1} 行)\n` +
          `  作用域一(显式 dark):   ${explicit[first] ?? "(缺行)"}\n` +
          `  作用域二(系统兜底):    ${system[first] ?? "(缺行)"}\n` +
          `  两块必须逐行一致(块二注释:同步维护);改任一侧必须同步另一侧`,
      );
    }
  });

  // 行数下限:防 marker 误配到残缺结构导致「空块相等」的假通过
  await suite.case("提取行数达下限(防标记误配到残缺结构的假通过)", () => {
    if (explicit.length < 20) {
      throw new Error(
        `dark-token-parity 断言失败:提取行数异常(${explicit.length} 行,预期 ≥20),提取器或 base.css 结构需复核`,
      );
    }
  });

  console.log(
    `[ok] dark-token-parity:深色双块逐行恒等(${explicit.length} 行,显式/系统两作用域同步) 断言通过`,
  );
  return { cases: suite.results };
}
