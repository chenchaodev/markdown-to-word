// @ts-check
/**
 * 转换预检核心逻辑断言:本地图片可信边界/缺失 / 悬空交叉引用 / 未标注语言代码块;
 * 注入 exists 与 realpathSync 模拟文件系统及链接越界,不依赖真实磁盘与 Electron。
 * 单源:dist/core/markdown/precheck.js(precheckMarkdown)。
 */
import path from "node:path";
import { precheckMarkdown } from "../../dist/core/markdown/precheck.js";

const existsAll = () => true;
const existsNone = () => false;
const realpathIdentity = (/** @type {string} */ candidate) => candidate;

export async function run() {
  // 1) 干净输入返回空数组
  const clean = precheckMarkdown(
    "# 标题\n\n正文,见图 ![x](./ok.png)。\n\n```js\ncode\n```\n\n章节 {#sec:a}\n\n见 [章节](#sec:a)。",
    "/tmp",
    { exists: existsAll, realpathSync: realpathIdentity },
  );
  if (clean.length !== 0) {
    throw new Error(`precheck 干净输入应返回 [],实际:${JSON.stringify(clean)}`);
  }
  console.log("[ok] precheck:干净输入返回空数组");

  // 2) 缺失本地图片 → imageNotFoundWarning
  const img = precheckMarkdown("![图](./missing.png)", "/tmp", {
    exists: existsNone,
    realpathSync: realpathIdentity,
  });
  if (!img.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("应检测缺失本地图片");
  }
  console.log("[ok] precheck:缺失本地图片被检出");

  // 3) 远程图片不报缺失
  const remote = precheckMarkdown("![图](https://example.com/a.png)", "/tmp", {
    exists: existsNone,
    realpathSync: realpathIdentity,
  });
  if (remote.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("远程图片不应报缺失");
  }
  console.log("[ok] precheck:远程图片跳过检查");

  // 3b) 原始 src 边界先于文件存在性检查:绝对路径与 UNC 不得因 exists=true 放行
  const boundaryRoot = path.resolve(path.sep, "docs", "source");
  const absoluteOutside = path.resolve(path.sep, "outside", "secret.png").replaceAll("\\", "/");
  let boundaryExistsCalls = 0;
  const boundaryDeps = {
    exists: () => {
      boundaryExistsCalls += 1;
      return true;
    },
    realpathSync: realpathIdentity,
  };
  const absoluteWarning = precheckMarkdown(`![图](${absoluteOutside})`, boundaryRoot, boundaryDeps);
  const uncWarning = precheckMarkdown("![图](//server/share/image.png)", boundaryRoot, boundaryDeps);
  if (!absoluteWarning.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("绝对本地图片路径应被拒绝");
  }
  if (!uncWarning.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("UNC 本地图片路径应被拒绝");
  }
  if (boundaryExistsCalls !== 0) {
    throw new Error(`原始 src 越界时不应执行文件存在性检查,实际 ${boundaryExistsCalls} 次`);
  }

  // 3c) .. 仅在解析后仍位于显式可信根内时允许
  const trustedRoot = path.resolve(path.sep, "docs", "trusted-assets");
  const untrustedTraversal = precheckMarkdown("![图](../trusted-assets/pic.png)", boundaryRoot, {
    exists: existsAll,
    realpathSync: realpathIdentity,
  });
  if (!untrustedTraversal.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("未显式授予可信根时,父目录越界路径应拒绝");
  }
  const trustedTraversal = precheckMarkdown("![图](../trusted-assets/pic.png)", boundaryRoot, {
    exists: existsAll,
    trustedRoots: [trustedRoot],
    realpathSync: realpathIdentity,
  });
  if (trustedTraversal.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("显式可信根内的父目录相对路径应允许");
  }

  // 3d) 词法路径在根内,但 realpath 模拟 symlink/junction 指向根外 → 拒绝
  const linkedCandidate = path.join(boundaryRoot, "assets", "pic.png");
  const canonicalOutside = path.resolve(path.sep, "outside", "linked.png");
  let linkedExistsCalled = false;
  const linkedWarning = precheckMarkdown("![图](./assets/pic.png)", boundaryRoot, {
    exists: () => {
      linkedExistsCalled = true;
      return true;
    },
    realpathSync: (/** @type {string} */ candidate) => (candidate === linkedCandidate ? canonicalOutside : candidate),
  });
  if (!linkedWarning.some((w) => w.key === "warn.imageNotFound") || linkedExistsCalled) {
    throw new Error("realpath 后的 symlink/junction 越界路径应在 exists 前拒绝");
  }
  console.log("[ok] precheck:本地图片绝对/UNC/越界/可信根/链接规范路径边界断言通过");

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
