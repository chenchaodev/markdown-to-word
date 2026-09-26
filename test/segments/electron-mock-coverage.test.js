// @ts-check
/**
 * electron mock 边界静态守护段(位于 test/segments/ = 跨域守护段;被测为
 * test/tools/electron-mock.mjs 的命名导出集合与 src 的 electron 具名 import 事实,
 * 纯 Node/纯 Electron 皆可跑,不依赖 dist):
 *
 * 为什么要有本段:electron 包是 CJS,命名导入会抛 SyntaxError,故 gen-fixtures 用
 * mock loader 把 "electron" 解析到 electron-mock.mjs。mock 少一个命名导出时,只有
 * 「某段模块 import 失败」才暴露——而缺项段若被旧式文本预筛跳过,就一路静默到
 * 产物不完整。这里把「mock ⊇ src 用到的一切 electron 绑定」变成静态断言:
 * 1. 抽取器形态自测(合成源码逐条覆盖 import/import type/内联 type/默认/命名空间
 *    五种形态,证明判定链本身有效,否则下面的红可能只是「抽取器坏了」);
 * 2. src/main、src/core 对 electron 的运行时具名 import 集合 == 钉死常量,且每一项
 *    都在 mock 的导出里(缺项即红,并指名应补的导出);
 * 3. test/ 侧(生成器会 import 的 common/segments/main/renderer)同样全覆盖;
 * 4. core 侧零 electron import(层向 core-no-host 的旁证,见 import-boundary 段)。
 *
 * 钉死常量的用意:集合漂移(新增/删除 electron 用法)必须显式改本段与 mock,
 * 不能靠「碰巧还覆盖着」蒙混过去;type-only 说明符已被编译期擦除,不需要 mock。
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../common/paths.js";

/** src 侧被 mock 覆盖的 electron 运行时绑定(新增/删除用法须同步改本常量与 electron-mock.mjs) */
const SRC_REQUIRED = [
  "BrowserWindow",
  "Menu",
  "app",
  "clipboard",
  "contextBridge",
  "dialog",
  "ipcMain",
  "ipcRenderer",
  "nativeTheme",
  "screen",
  "session",
  "shell",
  "webUtils",
];

/** test/ 侧(生成器 import 链)被 mock 覆盖的 electron 运行时绑定 */
const TEST_REQUIRED = ["BrowserWindow", "Menu", "app", "dialog", "ipcMain", "nativeTheme", "shell"];

/**
 * 行首锚定的 import 语句。两个约束缺一不可:
 * - 行首锚定:合成夹具里的字符串不算真 import(那些行不以 import 起头);
 * - 子句不得跨语句:禁 `;` 且禁第二个 `import` 关键字,否则「文件里第一条 import 不是
 *   electron」时会把中间几条 import 一起吞进子句(抽出 pdf-lib/node:fs 的绑定)。
 */
const ELECTRON_IMPORT_RE =
  /^[ \t]*import\s+(type\s+)?((?:(?!\bimport\b)[^;])*?)\s*from\s*(['"])electron\3[ \t]*;?[ \t]*$/gm;

/**
 * 断言辅助。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`electron-mock-coverage 断言失败:${msg}`);
}

/**
 * 抽出一份源码里对 electron 的**运行时**绑定名(type-only 说明符编译期已擦除,
 * 不需要 mock);默认导入记为 "default"(mock 必须导出 default),命名空间导入无法
 * 静态定界,单独回报由调用方决定。
 * @param {string} source
 * @returns {{required: Set<string>, namespace: boolean}}
 */
export function collectElectronBindings(source) {
  const required = new Set();
  let namespace = false;
  for (const m of source.matchAll(ELECTRON_IMPORT_RE)) {
    // 捕获组 2 在正则里必参与匹配(整个子句),`?.` 仅作类型收窄,运行期不改变取值
    const clause = m[2]?.trim() ?? "";
    const braceAt = clause.indexOf("{");
    const head = (braceAt === -1 ? clause : clause.slice(0, braceAt)).replace(/,\s*$/, "").trim();
    if (head.startsWith("*")) {
      namespace = true;
    } else if (head !== "") {
      required.add("default"); // 默认绑定(def / def, { ... })
    }
    if (braceAt === -1) continue;
    const inner = clause.slice(braceAt + 1, clause.lastIndexOf("}"));
    for (const raw of inner.split(",")) {
      const spec = raw.trim();
      if (spec === "" || m[1] !== undefined || spec.startsWith("type ")) continue;
      required.add(spec);
    }
  }
  return { required, namespace };
}

/**
 * 递归列出扩展名命中的文件(按路径排序,保证报告稳定)。
 * @param {string} root 绝对目录
 * @param {string[]} extensions 命中的扩展名(含点)
 * @returns {string[]} 命中的文件绝对路径
 */
function listFiles(root, extensions) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir 当前目录 */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (extensions.includes(path.extname(entry.name))) out.push(abs);
    }
  };
  walk(root);
  return out;
}

/**
 * 扫一棵源码树,汇总 electron 运行时绑定与「文件 → 绑定」明细。
 * @param {string} root 绝对目录
 * @param {string[]} extensions
 */
function scanTree(root, extensions) {
  const required = new Set();
  const byFile = new Map();
  const namespaceFiles = [];
  for (const abs of listFiles(root, extensions)) {
    const { required: names, namespace } = collectElectronBindings(fs.readFileSync(abs, "utf8"));
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    if (names.size > 0) byFile.set(rel, [...names].sort());
    for (const n of names) required.add(n);
    if (namespace) namespaceFiles.push(rel);
  }
  return { required, byFile, namespaceFiles };
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ---- 1. 抽取器形态自测(合成源码:证明判定链有效) ----
  {
    const src = [
      'import { app } from "electron";',
      'import type { BrowserWindow } from "electron";',
      'import { shell, type Menu } from "electron";',
      'import {',
      "  ipcMain,",
      "  clipboard,",
      '} from "electron";',
      'import dialog from "electron";',
      'import def, { session } from "electron";',
      'import * as electron from "electron";',
      'const unrelated = "import { fake } from \\"electron\\";";',
    ].join("\n");
    const { required, namespace } = collectElectronBindings(src);
    assert(namespace, "命名空间导入 import * as ns 未被识别");
    assert(
      [...required].sort().join(",") === "app,clipboard,default,ipcMain,session,shell",
      `运行时绑定集合应剔除 type-only 说明符并把默认绑定记为 default,实际 ${[...required].sort().join(",")}`,
    );
    assert(
      !required.has("BrowserWindow"),
      "import type { BrowserWindow } 是 type-only,编译期擦除后不需要 mock 导出",
    );
    assert(!required.has("Menu"), "内联 type 说明符(import { shell, type Menu })同样编译期擦除,不应要求 mock 导出");
    assert(!required.has("dialog"), "默认绑定应记为 default 而非按本地名记录(本地名对 mock 无意义)");
    assert(!required.has("fake"), "字符串字面量里的伪 import 语句不得被抽取(行首锚定失效?)");
    console.log("[ok] electron-mock-coverage:抽取器形态自测通过(值/type/内联 type/默认/命名空间/字符串伪语句)");
  }

  // ---- 2. src 侧:具名 import 集合钉死 + mock 全覆盖 ----
  const mock = await import("../tools/electron-mock.mjs");
  const mockExports = new Set(Object.keys(mock));
  assert(mockExports.size > 0, "electron-mock 未导出任何命名成员(mock 失效?)");

  const srcScan = scanTree(path.join(ROOT, "src"), [".ts", ".cts"]);
  assert(srcScan.required.size > 0, "src 侧未抽到任何 electron 绑定(抽取失效?)");
  const srcNames = [...srcScan.required].sort();
  assert(
    srcNames.join(",") === [...SRC_REQUIRED].sort().join(","),
    `src 对 electron 的运行时绑定集合已漂移:请同步 electron-mock.mjs 与本段 SRC_REQUIRED。实际 ${srcNames.join(",")}`,
  );
  {
    const missing = srcNames.filter((n) => !mockExports.has(n));
    assert(
      missing.length === 0,
      `electron-mock 缺少 src 用到的命名导出:${missing.join(",")}(补进 test/tools/electron-mock.mjs;否则依赖它的段在纯 Node 下 import 失败)`,
    );
    console.log(`[ok] electron-mock-coverage:src 侧 ${srcNames.length} 个 electron 绑定全部被 mock 覆盖`);
  }

  // ---- 3. test/ 侧:生成器会 import 的段与共享 helper 同样全覆盖 ----
  {
    const roots = ["common", "segments", "main", "renderer"].map((d) => path.join(ROOT, "test", d));
    /** @type {{ required: Set<string>, namespaceFiles: string[] }} */
    const merged = { required: new Set(), namespaceFiles: [] };
    for (const dir of roots) {
      const scan = scanTree(dir, [".js", ".mjs", ".cjs"]);
      for (const n of scan.required) merged.required.add(n);
      merged.namespaceFiles.push(...scan.namespaceFiles);
    }
    const names = [...merged.required].sort();
    assert(
      names.join(",") === [...TEST_REQUIRED].sort().join(","),
      `test/ 侧 electron 运行时绑定集合已漂移:请同步 electron-mock.mjs 与本段 TEST_REQUIRED。实际 ${names.join(",")}`,
    );
    const missing = names.filter((n) => !mockExports.has(n));
    assert(
      missing.length === 0,
      `electron-mock 缺少 test/ 侧用到的命名导出:${missing.join(",")}(gen-fixtures 纯 Node 下会 import 失败)`,
    );
    console.log(`[ok] electron-mock-coverage:test/ 侧 ${names.length} 个 electron 绑定全部被 mock 覆盖`);
  }

  // ---- 4. core 零 electron import(层向 core-no-host 旁证)+ 命名空间导入不静默 ----
  {
    const coreElectron = [...srcScan.byFile.entries()].filter(([file]) => file.startsWith("src/core/"));
    assert(
      coreElectron.length === 0,
      `core 层不得 import electron(正式规则见 import-boundary 段):${coreElectron.map(([f]) => f).join(",")}`,
    );
    assert(
      srcScan.namespaceFiles.length === 0,
      `src 出现 electron 命名空间导入,覆盖判定无法静态定界(请改具名 import):${srcScan.namespaceFiles.join(",")}`,
    );
    console.log("[ok] electron-mock-coverage:core 层零 electron 依赖,src 无命名空间导入");
  }
}
