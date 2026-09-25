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
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(here, "..", "..", "src", "renderer", "style", "base.css");

/**
 * 提取「选择器 { … }」规则体并归一化为行数组。
 * marker 后做括号配对扫描(CSS token 值内无花括号,配对安全);
 * 剥掉所有 /* *\/ 注释、空行与首尾空白,得到可直接比较的 token 行序列。
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

export async function run() {
  const src = fs.readFileSync(cssPath, "utf8");

  // 作用域一:显式深色;作用域二:跟随系统兜底(两块须逐行一致)
  const explicit = extractRule(src, 'html[data-theme="dark"] {');
  const system = extractRule(src, 'html:not([data-theme="light"]) {');

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

  // 行数下限:防 marker 误配到残缺结构导致「空块相等」的假通过
  if (explicit.length < 20) {
    throw new Error(
      `dark-token-parity 断言失败:提取行数异常(${explicit.length} 行,预期 ≥20),提取器或 base.css 结构需复核`,
    );
  }

  console.log(
    `[ok] dark-token-parity:深色双块逐行恒等(${explicit.length} 行,显式/系统两作用域同步) 断言通过`,
  );
}
