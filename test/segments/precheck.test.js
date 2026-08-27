/**
 * F6 转换预检核心逻辑断言:缺失本地图片 / 悬空交叉引用 / 未标注语言代码块;
 * 注入 exists 模拟文件系统,不依赖真实磁盘与 Electron。
 * 单源:dist/core/markdown/precheck.js(precheckMarkdown)。
 */
import { precheckMarkdown } from "../../dist/core/markdown/precheck.js";

const existsAll = () => true;
const existsNone = () => false;

export async function run() {
  // 1) 干净输入返回空数组
  const clean = precheckMarkdown(
    "# 标题\n\n正文,见图 ![x](./ok.png)。\n\n```js\ncode\n```\n\n章节 {#sec:a}\n\n见 [章节](#sec:a)。",
    "/tmp",
    { exists: existsAll },
  );
  if (clean.length !== 0) {
    throw new Error(`precheck 干净输入应返回 [],实际:${JSON.stringify(clean)}`);
  }
  console.log("[ok] precheck:干净输入返回空数组");

  // 2) 缺失本地图片 → imageNotFoundWarning
  const img = precheckMarkdown("![图](./missing.png)", "/tmp", { exists: existsNone });
  if (!img.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("应检测缺失本地图片");
  }
  console.log("[ok] precheck:缺失本地图片被检出");

  // 3) 远程图片不报缺失
  const remote = precheckMarkdown("![图](https://example.com/a.png)", "/tmp", {
    exists: existsNone,
  });
  if (remote.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("远程图片不应报缺失");
  }
  console.log("[ok] precheck:远程图片跳过检查");

  // 4) 悬空交叉引用(链接节点)#sec / #eq → crossRefNotFoundWarning
  const dangling = precheckMarkdown("见 [章节](#sec:ghost) 与 [公式](#eq:x)。", "/tmp", {
    exists: existsAll,
  });
  if (!dangling.some((w) => w.key === "warn.crossRefNotFound")) {
    throw new Error("应检测悬空交叉引用");
  }
  console.log("[ok] precheck:悬空交叉引用被检出");

  // 5) 已定义标签不报悬空
  const defined = precheckMarkdown("章节 {#sec:a}\n\n见 [章节](#sec:a)。", "/tmp", {
    exists: existsAll,
  });
  if (defined.some((w) => w.key === "warn.crossRefNotFound")) {
    throw new Error("已定义标签不应报悬空");
  }
  console.log("[ok] precheck:已定义标签不报悬空");

  // 6) 未标注语言代码块 → unlabeledCodeBlockWarning
  const code = precheckMarkdown("```\nplain\n```", "/tmp", { exists: existsAll });
  if (!code.some((w) => w.key === "warn.unlabeledCodeBlock")) {
    throw new Error("应检测未标注语言代码块");
  }
  console.log("[ok] precheck:未标注语言代码块被检出");

  // 7) 标注语言代码块不报
  const coded = precheckMarkdown("```js\nx\n```", "/tmp", { exists: existsAll });
  if (coded.some((w) => w.key === "warn.unlabeledCodeBlock")) {
    throw new Error("已标注语言不应报");
  }
  console.log("[ok] precheck:已标注语言代码块不报");
}
