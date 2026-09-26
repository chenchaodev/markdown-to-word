// @ts-check
/**
 * 测试树 `@ts-check` 覆盖率守护段(位于 test/segments/ = 跨域守护段;纯 Node 逻辑,
 * 不启 Electron):
 *
 * 守护的契约(见 tsconfig.test.json 头注):
 * 1) `test/` 下每个 js/mjs/cjs 源文件都必须带 `// @ts-check` 注释 —— 这是本项目
 *    唯一的「测试代码受 typecheck 门禁」机制(checkJs 必须保持 false,否则被 import
 *    的 dist 编译产物会被拉进检查范围产生上千条无意义报错)。
 * 2) `test/pending/` 是阶段 3 历史副本,不参与测试发现,故意豁免;豁免必须显式存在,
 *    一旦该目录被清空或改名,本段判红提醒同步更新豁免清单。
 * 3) `tsconfig.test.json` 必须仍是 `checkJs: false` 且写明原因 —— 防止后续有人
 *    「顺手修正」把 dist 编译产物拖进类型检查。
 *
 * 防假通过:判定逻辑为测试内纯函数 `classifyHead()`,先用合成样本做正/负锚点
 * (缺标注 / 有标注 / shebang 在前 / 标注压在 shebang 之前 / 空文件),再对真实
 * 文件树求值;并对受检文件总数设下限断言,walker 失效时不会静默「零文件全过」。
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../common/paths.js";

/** 不参与类型门禁的显式豁免目录(相对 test/)。 */
const EXEMPT_DIRS = ["pending"];

const TEST_DIR = path.join(ROOT, "test");

/** 参与门禁的源文件扩展名。 */
const SOURCE_EXT_RE = /\.(js|mjs|cjs)$/;

/** 头注判定结果。 */
/** @typedef {"annotated"|"missing"|"empty"} HeadState */

/**
 * 判定单文件头部的 `@ts-check` 标注状态(纯函数,便于合成样本锚点)。
 * 规则:shebang 只能位于首行(位于后续行说明文件损坏 → 判缺失);首行是 shebang 时
 * 第二行必须是 `// @ts-check`;否则首行必须是 `// @ts-check`。
 * @param {string[]} lines 文件按行切分
 * @returns {HeadState} 标注状态
 */
export function classifyHead(lines) {
  const head = lines.filter((l) => l.trim() !== "");
  const first = head[0];
  if (first === undefined) return "empty";
  if (head.findIndex((l) => l.trimStart().startsWith("#!")) > 0) return "missing";
  if (first.trimStart().startsWith("#!")) {
    return head[1]?.trim() === "// @ts-check" ? "annotated" : "missing";
  }
  return first.trim() === "// @ts-check" ? "annotated" : "missing";
}

/**
 * 递归列出目录下的源文件。
 * @param {string} dir 起始目录
 * @returns {string[]} 源文件绝对路径
 */
function listSourceFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (SOURCE_EXT_RE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 断言辅助。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`tscheck-coverage 断言失败:${msg}`);
}

export async function run() {
  // ---- 0. 判定逻辑正向/负向锚点:先证明 checker 会抓缺失,再用于真实文件树 ----
  assert(classifyHead(["// @ts-check", "export const a = 1;"]) === "annotated", "首行标注应判为已标注");
  assert(classifyHead(["", "  // @ts-check  ", "x"]) === "annotated", "空行与缩进应被容忍");
  assert(
    classifyHead(["#!/usr/bin/env node", "// @ts-check", "x"]) === "annotated",
    "shebang 在前 + 次行标注应判为已标注",
  );
  assert(
    classifyHead(["// @ts-check", "#!/usr/bin/env node"]) === "missing",
    "标注压在 shebang 之前必须判红(shebang 只能位于首行)",
  );
  assert(classifyHead(["import fs from 'node:fs';"]) === "missing", "无标注应判为缺失");
  assert(classifyHead(["   "]) === "empty", "空文件应单列");
  console.log("[ok] tscheck-coverage:判定逻辑正/负锚点(标注/shebang 顺序/缺失/空文件)");

  // ---- 1. 真实文件树:非豁免目录每个源文件都必须带标注 ----
  /** @type {string[]} */
  const missing = [];
  let guarded = 0;
  let exempt = 0;
  for (const abs of listSourceFiles(TEST_DIR)) {
    const rel = path.relative(TEST_DIR, abs).split(path.sep).join("/");
    if (EXEMPT_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) {
      exempt += 1;
      continue;
    }
    const state = classifyHead(fs.readFileSync(abs, "utf8").split(/\r?\n/));
    if (state === "missing") missing.push(rel);
    else if (state === "empty") missing.push(`${rel}(空文件)`);
    else guarded += 1;
  }
  // 下限断言:walker 失效(include 写错/目录改名)时不得静默零文件通过
  assert(guarded >= 100, `受门禁文件数应 ≥100,实际 ${guarded}(walker 可能失效)`);
  assert(missing.length === 0, `以下源文件缺少 // @ts-check:${missing.join(", ")}`);
  console.log(`[ok] tscheck-coverage:${guarded} 个测试源文件全部带 @ts-check 标注`);

  // ---- 2. 豁免目录必须真实存在(显式豁免不得变成掩盖漂移的免罪符)----
  for (const d of EXEMPT_DIRS) {
    const abs = path.join(TEST_DIR, d);
    assert(fs.existsSync(abs), `豁免目录 test/${d} 已不存在,请同步更新 EXEMPT_DIRS 与 tsconfig.test.json 头注`);
  }
  assert(exempt > 0, "豁免目录应至少含 1 个历史副本文件");
  console.log(`[ok] tscheck-coverage:豁免目录真实存在(${EXEMPT_DIRS.join(", ")},${exempt} 个文件)`);

  // ---- 3. checkJs 必须保持 false,且头注写明 dist 原因(防被顺手"修正")----
  const tsconfigTest = fs.readFileSync(path.join(ROOT, "tsconfig.test.json"), "utf8");
  assert(/"checkJs"\s*:\s*false/.test(tsconfigTest), "tsconfig.test.json 的 checkJs 必须保持 false");
  assert(
    /checkJs 必须保持 false[\s\S]*dist/.test(tsconfigTest),
    "tsconfig.test.json 头注必须写明 checkJs 保持 false 的原因(测试跑 dist 编译产物)",
  );
  console.log("[ok] tscheck-coverage:checkJs 保持 false 且头注记录 dist 原因");

  console.log(`[ok] tscheck-coverage:门禁通过(受检 ${guarded} / 豁免 ${exempt})`);
}

export const fixtures = null;
