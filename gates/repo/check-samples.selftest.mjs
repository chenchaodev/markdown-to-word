// samples/ 准入门禁自身的回归守护(负向夹具 + 变异实验)。
//
// 本门禁是纯文本门禁,失效形态全是**恒绿**:扫描面读不出来它就「零代码文件」并 exit 0,
// 而代码已经躺在 samples/ 里。本载体逐条制造这些漂移,断言判据确实以非零码拒绝,
// 并断言未漂移时通过。
//
// ---- 不修改被测门禁本体,也不复制它 ----
// 夹具 = **注入面**(系统临时目录里的合成 `samples/` 树),门禁**原位**从仓内跑。
// **夹具绝不造在 samples/ 里** —— 判据的对象就是 samples/,在对象里造夹具是判错了对象
// (那会让「仓上零判红」这一条完全失去意义)。
//
// ⚠⚠ **为什么每条夹具都在子进程里求值(这是本载体最容易做错、且做错后结论全假的一处)**:
// 本载体**静态 import 判定本体**会让变异实验彻底失效 —— ESM 模块一旦求值,后续改磁盘上的
// 源文件对本进程**无效**(模块缓存),于是「把判据改成恒真」这一步什么也没变,所有负向夹具
// 仍绿,而那份「变异后夹具失败」的结论是**假的**。今天仓内已栽过两次同款坑:
//   ① `if (false) return` 那种**不改变行为**的空操作变异;
//   ② harness 自身坏掉(harness 缺一个 import)却被判成「有牙齿」。
// 故本载体:① **不在顶层 import 判定本体**,每条夹具由**子进程**从磁盘重新 import 它;
//   ② **先**在未变异的基线上跑一遍并要求全绿(否则拒绝谈「有牙齿」);
//   ③ 每族判据各做一次**真变异**(真改源文件内容,且断言 `from !== to`),
//   ④ 逐条记录「变异后哪几条夹具失败 / 哪几条仍绿」—— **互不串扰**是可归因性的证据。
//
// ⚠ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删。

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../../shared/paths.js";

const projectRoot = ROOT;
/** 判定本体的仓相对路径(单一来源:子进程按它 import,「指针」那一格按它读) */
const checkerRel = "gates/repo/check-samples.mjs";
const checkerPath = join(projectRoot, "gates", "repo", "check-samples.mjs");

/**
 * 合规底板:一个**通篇是围栏代码块**的 md 样例 + 一张图 + 一份手写 md。
 * 底板恒含代码块这一点是刻意的:它证明本门禁**不解析 md 正文** ——
 * `samples/docs/code-highlight.md` 与 `mermaid-js.md`(实测各 2 处 ```)正是这个形态,
 * 而代码块是这两个样例存在的全部理由。
 */
const BASE_FILES = Object.freeze({
  "docs/code-highlight.md": "# 标题\n\n```js\nconst a = 1;\nexport default a;\n```\n",
  "docs/input/img.png": "PNG-BYTES",
  "input/g1-tiny.png": "PNG-BYTES",
  "manual/01-简介.md": "# 简介\n\n正文。\n",
  "manual/images/logo.png": "PNG-BYTES",
});

/** 底板的子目录(真实仓 samples/ 下实测的六个,复现「不是一层」这个事实) */
const BASE_DIRS = Object.freeze(["docs", "docs/input", "input", "manual", "manual/chapters", "manual/images"]);

/**
 * 造一棵合成 `samples/`(返回夹具根绝对路径)。
 * @param {Readonly<Record<string, string>>} [extra] 相对 samples/ 的路径 → 正文(覆盖底板同名项)
 * @param {readonly string[]} [extraDirs] 额外要造出来的空目录
 * @returns {string} 夹具根绝对路径
 */
function createFixture(extra = {}, extraDirs = []) {
  const dir = mkdtempSync(join(tmpdir(), "m2w-samples-selftest-"));
  for (const rel of [...BASE_DIRS, ...extraDirs]) {
    mkdirSync(join(dir, "samples", ...rel.split("/")), { recursive: true });
  }
  for (const [rel, body] of Object.entries({ ...BASE_FILES, ...extra })) {
    writeUnder(dir, `samples/${rel}`, body);
  }
  return dir;
}

/**
 * @param {string} root 夹具根
 * @param {string} rel 仓库相对 POSIX 路径
 * @param {string} body 正文
 * @returns {void}
 */
function writeUnder(root, rel, body) {
  const target = join(root, ...rel.split("/"));
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, body, "utf8");
}

/**
 * 子进程里的求值脚本(源码字符串)。
 *
 * ⚠ **它 import 的是磁盘上当前的判定本体** —— 这正是变异实验能生效的唯一原因:
 * 每次夹具都起一个新进程、重新 import 一遍,故父进程改源文件对它是真改变。
 * ⚠ `cwd` 由调用方设成夹具根(⇒ `shared/paths.js` 的 `ROOT` 就是它),但求值一律**显式注入
 * listDir**,不依赖默认实现 —— 默认实现那一档由进程级 CLI 夹具覆盖。
 * ⚠ 入参走**环境变量**而不是 `process.argv`:`node -e` 下 argv 的位置与是否带脚本文件
 * 有关(`process.argv[1]` 未必是第一个用户实参),踩过一次「argv[2] 读到 undefined」。
 * @param {string} checkerUrl 判定本体的 file:// URL
 * @returns {string} ESM 源码
 */
function evaluatorSource(checkerUrl) {
  return `
import { readdirSync } from "node:fs";
import path from "node:path";
const mod = await import(${JSON.stringify(checkerUrl)});
const spec = JSON.parse(process.env.M2W_SAMPLES_SPEC ?? "{}");
const readDir = (relative) => readdirSync(path.join(spec.root, ...relative.split("/")), { withFileTypes: true })
  .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
const thrown = new Set(spec.thrown ?? []);
const result = mod.checkSamples(mod.makeSamplesCtx({
  root: spec.root,
  listDir: (relative) => {
    if (thrown.has(relative)) {
      throw Object.assign(new Error("ENOENT: no such file or directory, scandir '" + relative + "'"), { code: "ENOENT" });
    }
    return readDir(relative);
  },
}));
process.stdout.write(JSON.stringify(result));
`;
}

/**
 * 在**新进程**里从磁盘 import 判定本体并求值(纯函数档)。
 *
 * @param {string} root 夹具根(cwd)
 * @param {readonly string[]} [thrown] 这些仓库相对路径在 listDir 时抛错(判据二的夹具用)
 * @returns {{ ok: true, problems: string[], stats: Record<string, unknown> } | { ok: false, error: string }}
 */
function judgeInChild(root, thrown = []) {
  const script = evaluatorSource(pathToFileURL(checkerPath).href);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, M2W_SAMPLES_SPEC: JSON.stringify({ root, thrown }) },
  });
  if (result.status !== 0 || typeof result.stdout !== "string" || result.stdout.trim() === "") {
    return { ok: false, error: `子进程 exit=${String(result.status)}:${result.stderr || "(无 stderr)"}` };
  }
  try {
    return { ok: true, ...JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, error: `子进程输出不是合法 JSON:${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * 读判定本体的某个导出值(子进程档,理由同 judgeInChild)。
 * @param {string} exportName 导出名
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
function readExportInChild(exportName) {
  const script = `const m = await import(${JSON.stringify(pathToFileURL(checkerPath).href)});
const v = m[${JSON.stringify(exportName)}];
// 函数不是 JSON 值(序列化它是 undefined)⇒ 用真typeof 编码成对象,否则「导出存在」
// 这一格会把「导出是个函数」误判成「导出缺失」。
const encoded = typeof v === "function" ? { __typeof: "function" } : (v === undefined ? null : v);
process.stdout.write(JSON.stringify(encoded));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return { ok: false, error: `子进程 exit=${String(result.status)}:${result.stderr || ""}` };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, error: `输出不是合法 JSON:${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * 以指定 cwd 跑仓内门禁本体(进程级档)。**cwd 即求值根**(`ROOT = process.cwd()`),
 * 故这一句同时是「换根」与「不换脚本」。
 * @param {string} cwd 工作目录
 * @param {string[]} [args] 传给门禁的参数
 * @returns {{ code: number | null, output: string }}
 */
function runAt(cwd, args = []) {
  const result = spawnSync(process.execPath, [checkerPath, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * 在合成树上跑门禁 CLI(进程级档)。
 * @param {Readonly<Record<string, string>>} [extra] 相对 samples/ 的路径 → 正文
 * @param {string[]} [args] 传给门禁的参数
 * @returns {{ code: number | null, output: string }}
 */
function runChecker(extra = {}, args = []) {
  const dir = createFixture(extra);
  try {
    return runAt(dir, args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 在**只有空目录、根本没有 samples/** 的目录上跑门禁(判据二的恒绿防护专用)。
 * @param {string[]} [args] 传给门禁的参数
 * @returns {{ code: number | null, output: string }}
 */
function runOnBareRoot(args = []) {
  const dir = mkdtempSync(join(tmpdir(), "m2w-samples-bare-"));
  try {
    return runAt(dir, args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 夹具形状。`kind`:
 *   - `judge` —— 合成树 + 子进程 import 求值(判据一 / 判据二夹具)
 *   - `cli` / `cliBare` / `realRepo` —— 跑门禁 CLI
 *   - `export` —— 子进程读判定本体的某个导出并断言其取值
 *   - `file` —— 父进程只读仓内某文件(不 import 判定本体)
 * 每条都比对**诊断文案**(而不只看条数)—— 否则「判定函数恒返回空数组」这一种退化实现
 * 能让全部负向夹具通过,那是最坏的失效形态。
 */
const CASES = [
  /* ---------- 正向锚点 ---------- */
  {
    kind: "judge",
    name: "夹具基线(md 含围栏代码块 + png,零代码文件)→ 零判红",
    expect: null,
  },
  {
    // **本门禁存在的理由的一半**:md 里的代码块是**样例内容**,不是「代码落错地方」。
    // 判据若去解析 md 正文(扫 ``` 围栏),这一格与真实样例
    // `samples/docs/code-highlight.md` / `mermaid-js.md` 都会被判红。
    kind: "judge",
    name: "判据一:md 正文里的围栏代码块(js 与 ts)⇒ 不判红(只看扩展名,不解析正文)",
    extra: {
      "docs/mermaid-js.md":
        "# Mermaid\n\n```js\nimport { run } from './x.mjs';\nrun();\n```\n\n```ts\nconst a: number = 1;\n```\n",
    },
    expect: null,
  },
  {
    // 空目录是**合法状态**(列得出来、零条目),与「列不出来」严格分开。判据二若写成
    // 「目录为空即红」,本夹具会红 —— 而临时清空 samples/ 是正常操作。
    kind: "judge",
    name: "判据二:空子目录 ⇒ 不判红(空 ≠ 没查)",
    extraDirs: ["input", "manual/chapters"],
    expect: null,
  },
  {
    kind: "judge",
    name: "判据二:整棵 samples/ 为空(零文件)⇒ 不判红(合法状态;临时清空不该变红)",
    bare: true,
    expect: null,
  },

  /* ---------- 判据一:samples-no-code-files ---------- */
  {
    kind: "judge",
    name: "判据一:.mjs 落进 samples/ ⇒ 判红并点名完整路径",
    extra: { "docs/build-fixtures.mjs": "export const build = () => undefined;\n" },
    expect: /samples\/docs\/build-fixtures\.mjs → samples-no-code-files:.*\(扩展名 \.mjs\)/,
  },
  {
    kind: "judge",
    name: "判据一:深层子目录里的 .js(深度 3)⇒ 判红(递归深度不限,没有洞)",
    extra: { "manual/chapters/deep/a/b/helper.js": "module.exports = 1;\n" },
    expect: /samples\/manual\/chapters\/deep\/a\/b\/helper\.js → samples-no-code-files:.*\(扩展名 \.js\)/,
  },
  {
    // 闭集不是只收 .mjs/.js。逐条列全六个别扩展名:只做「.mjs 判红」那一格不足以
    // 证明白名单是宽的 —— 一个只收两项的实现同样全绿。
    kind: "judge",
    name: "判据一:.ts / .tsx / .mts / .cts / .cjs / .jsx 逐个判红(闭集恰是八个)",
    extra: {
      "a.ts": "export const a = 1;\n",
      "b.tsx": "export const b = 1;\n",
      "c.mts": "export const c = 1;\n",
      "d.cts": "export const d = 1;\n",
      "e.cjs": "module.exports = 1;\n",
      "f.jsx": "export const f = 1;\n",
    },
    expectAll: [
      /samples\/a\.ts → samples-no-code-files:.*\.ts/,
      /samples\/b\.tsx → samples-no-code-files:.*\.tsx/,
      /samples\/c\.mts → samples-no-code-files:.*\.mts/,
      /samples\/d\.cts → samples-no-code-files:.*\.cts/,
      /samples\/e\.cjs → samples-no-code-files:.*\.cjs/,
      /samples\/f\.jsx → samples-no-code-files:.*\.jsx/,
    ],
  },
  {
    // 大写扩展名:仓内扩展名一律小写这条约定由本门禁**兜住** —— 判据自己按小写比较,
    // 否则 `Gen.MJS` 成为一条绕过判据的路径(且它在 Windows 上大小写不敏感地可加载)。
    kind: "judge",
    name: "判据一:大写扩展名(.MJS / .TS)⇒ 判红(大小写不可绕过)",
    extra: { "docs/Gen.MJS": "export const g = 1;\n", "docs/H.TS": "export const h = 1;\n" },
    expectAll: [
      /samples\/docs\/Gen\.MJS → samples-no-code-files:.*\.mjs/,
      /samples\/docs\/H\.TS → samples-no-code-files:.*\.ts/,
    ],
  },
  {
    // `.d.ts` 无需单列(它以 `.ts` 结尾),这一格钉住「闭集真的覆盖它」而不是靠读者推。
    kind: "judge",
    name: "判据一:.d.ts ⇒ 判红(以 .ts 结尾,已被闭集命中)",
    extra: { "types.d.ts": "export declare const x: number;\n" },
    expect: /samples\/types\.d\.ts → samples-no-code-files:.*\.ts/,
  },
  {
    // **反向锚点:闭集是窄的**。只做「代码文件判红」那一格不足以证明白名单是窄的 ——
    // 「凡非 md/png 即红」的实现(把 .json / .docx 一并判红)在那一格同样全绿。
    kind: "judge",
    name: "判据一反向锚点:.json / .docx / .txt / 无扩展名 ⇒ 不判红(闭集只收代码扩展名)",
    extra: {
      "input/settings.json": "{}\n",
      "manual/out.docx": "DOCX",
      "notes.txt": "随手记。\n",
      "manual/LICENSE": "MIT",
    },
    expect: null,
  },
  {
    // 判据二那一族仍然生效时,判据一必须**逐条点名**而不是只报一条汇总 ——
    // 这一格同时钉住「两族互不吞掉对方」。
    kind: "judge",
    name: "判据一:同名 md 与代码文件并存时**只**判红代码文件那个(不牵连 md)",
    extra: { "docs/a.md": "# a\n", "docs/a.mjs": "export const a = 1;\n" },
    expect: /samples\/docs\/a\.mjs → samples-no-code-files/,
  },
  {
    kind: "judge",
    name: "判据一:一个 .js 判红**恰好一条**(诊断不重复、不inflate)",
    extra: { "docs/only.js": "module.exports = 1;\n" },
    expectCount: 1,
    expect: /samples\/docs\/only\.js → samples-no-code-files/,
  },

  /* ---------- 判据二:samples-unreadable-subtree ---------- */
  {
    kind: "judge",
    name: "判据二:根目录列不出来 ⇒ 判红(不是「零代码文件」的恒绿)",
    thrown: ["samples"],
    expect: /samples → samples-unreadable-subtree:列不出这个目录/,
  },
  {
    // **子目录**那一格:根能列、某一棵子树列不出来。判据若只在根上 try/catch,
    // 子树的异常会一路冒到 walk 之外、把整棵树变成一次崩溃而不是一条点名诊断。
    kind: "judge",
    name: "判据二:根能列但某棵子树列不出来 ⇒ 判红并点名那一棵",
    extra: { "docs/ok.md": "# ok\n", "bad/x.md": "# x\n" },
    thrown: ["samples/bad"],
    expect: /samples\/bad → samples-unreadable-subtree/,
  },
  {
    // **不中断其余遍历**:两棵子树列不出来 + 一处代码文件 = 三条,且代码文件那条**必须**在。
    // 判据若写成「任一子树不可读就整体放弃」,这一格少一条 ⇒ 恒绿防护失效。
    kind: "judge",
    name: "判据二:子树列不出来时**其余子树照常判定**(不可把整棵树变成一次崩溃)",
    extra: { "bad/x.md": "# x\n", "docs/also-bad/x.md": "# x\n", "docs/gen.mjs": "export const a = 1;\n" },
    thrown: ["samples/bad", "samples/docs/also-bad"],
    expectCount: 3,
    expectAll: [
      /samples\/bad → samples-unreadable-subtree/,
      /samples\/docs\/also-bad → samples-unreadable-subtree/,
      /samples\/docs\/gen\.mjs → samples-no-code-files/,
    ],
  },

  /* ---------- 进程级档(CLI) ---------- */
  {
    kind: "realRepo",
    name: "CLI:真实仓 exit 0 且结论行报出文件数 / 子目录数 / 扩展名分布(只读真实仓库)",
    expectCode: 0,
    expect: /\[ok\] samples\/ 准入判据通过\(无代码文件、无列不出的子树\):扫描 \d+ 个文件 \/ \d+ 个子目录\(.+×\d+.*\);代码文件 0 个/,
  },
  {
    kind: "cli",
    name: "CLI:合成树上有 .mjs ⇒ exit 1 并点名",
    extra: { "docs/gen.mjs": "export const a = 1;\n" },
    expectCode: 1,
    expect: /samples\/docs\/gen\.mjs → samples-no-code-files/,
  },
  {
    // **恒绿防护(进程级)**:合成根里根本没有 samples/ —— 若判据二不存在,这一格会
    // 「零代码文件」并 exit 0,与「查过了、确实没有」不可区分。
    kind: "cliBare",
    name: "CLI:合成根里没有 samples/ ⇒ exit 1(列不出来即判红,不许静默按空树放过)",
    expectCode: 1,
    expect: /samples → samples-unreadable-subtree/,
  },
  {
    // 反向锚点(进程级):默认注入面那一档(不注入 listDir)在合成树上零判红 ——
    // 否则上面两条可能只是在验注入面、而默认实现本身是坏的。
    kind: "cli",
    name: "CLI 反向锚点:合规合成树 ⇒ exit 0(默认注入面那一档通)",
    extra: {},
    expectCode: 0,
    expect: /\[ok\] samples\/ 准入判据通过/,
  },
  {
    kind: "cli",
    name: "CLI:未知参数 ⇒ exit 1(不得静默按默认跑一遍报绿)",
    extra: {},
    args: ["--oops"],
    expectCode: 1,
    expect: /无法识别的选项:--oops/,
  },
  {
    kind: "cli",
    name: "CLI:--help ⇒ exit 0 且点明两族判据",
    extra: {},
    args: ["--help"],
    expectCode: 0,
    expect: /判据一 samples-no-code-files[\s\S]*判据二 samples-unreadable-subtree/,
  },

  /* ---------- 导出面(判据的可注入前提本身也要有守卫) ---------- */
  {
    // 夹具能造在合成树上靠的就是这些导出;删掉任一个,全部 judge 夹具会当场崩。
    // 这一格把「注入面存在」写成显式断言而不是隐含依赖。
    kind: "export",
    name: "导出面:checkSamples / makeSamplesCtx / CODE_EXTS / SAMPLES_REL / extOf / isCodeFile / main 真在导出",
    exportNames: ["checkSamples", "makeSamplesCtx", "CODE_EXTS", "SAMPLES_REL", "extOf", "isCodeFile", "main"],
    expect: null,
  },
  {
    // 闭集自身的边界钉住:多收一个 / 少收一个,读者都该从这一格看得出取舍。
    kind: "export",
    name: "闭集:CODE_EXTS 恰是文件头写明的那八个(收窄或放宽都要先改这一格)",
    exportNames: ["CODE_EXTS"],
    expectExact: [".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"],
  },
  {
    kind: "export",
    name: "单一来源:SAMPLES_REL 是 samples(判定面只此一处登记)",
    exportNames: ["SAMPLES_REL"],
    expectExact: "samples",
  },
  {
    // **本载体自身的存在性守卫**:判定本体被改名 / 搬走时崩在 import 上,
    // 把指针显式写出来,崩在哪一步就看得见。
    kind: "file",
    name: "指针:checkerRel 指向的文件真的存在(判定本体没被改名或搬走)",
    rel: checkerRel,
  },
];

/** 最近一条 judge 档夹具的计数(仅供 [ok] 行可读性输出;不进任何失败判定) */
let lastJudgeStats = "";

/**
 * 比对一条 judge 档夹具的结论。
 * @param {object} testCase 夹具
 * @param {string[]} problems 判定结论
 * @param {Record<string, unknown>} stats 计数
 * @returns {string[]} problems(空数组 = 通过)
 */
function judgeOne(testCase, problems, stats) {
  // 只用于 [ok] 行的可读性输出(不进失败判定,理由见基线循环那处注释)。
  lastJudgeStats = JSON.stringify(stats);
  const joined = problems.join("\n");
  if (testCase.expect === null) {
    return problems.length === 0 ? [] : [`期望零判红,实际 ${problems.length} 条\n${joined}`];
  }
  /** @type {string[]} */
  const bad = [];
  if (testCase.expectAll !== undefined) {
    const missed = testCase.expectAll.filter((re) => !re.test(joined));
    if (missed.length > 0) bad.push(`以下诊断未出现:${missed.map(String).join(" | ")}\n实得:\n${joined || "(零判红)"}`);
  }
  if (testCase.expect !== undefined && !testCase.expect.test(joined)) {
    bad.push(`期望判红项匹配 ${String(testCase.expect)},实际\n${joined || "(零判红)"}`);
  }
  if (testCase.expectCount !== undefined && problems.length !== testCase.expectCount) {
    bad.push(`期望恰好 ${testCase.expectCount} 条,实际 ${problems.length} 条\n${joined}`);
  }
  return bad;
}

/**
 * 跑一条夹具并给出它的 problems(空数组 = 通过)。
 * @param {object} testCase 夹具
 * @returns {string[]} problems
 */
function runCase(testCase) {
  switch (testCase.kind) {
    case "file": {
      try {
        readFileSync(join(projectRoot, ...String(testCase.rel).split("/")), "utf8");
        return [];
      } catch (error) {
        return [`读不到 ${String(testCase.rel)}:${error instanceof Error ? error.message : String(error)}`];
      }
    }
    case "export": {
      /** @type {string[]} */
      const bad = [];
      for (const exportName of testCase.exportNames ?? []) {
        const got = readExportInChild(exportName);
        if (!got.ok) {
          bad.push(`读导出 ${exportName} 失败:${got.error}`);
          continue;
        }
        if (testCase.expectExact !== undefined) {
          const want = Array.isArray(testCase.expectExact) ? [...testCase.expectExact].sort() : testCase.expectExact;
          const have = Array.isArray(got.value) ? [...got.value].sort() : got.value;
          if (JSON.stringify(have) !== JSON.stringify(want)) {
            bad.push(`${exportName} = ${JSON.stringify(got.value)},期望 ${JSON.stringify(want)}`);
          }
          continue;
        }
        // 「存在」的判据:非 null(子进程把 undefined 编码成 null),或是个函数(编码成
        // `{ __typeof: "function" }`)。判据本体的六个注入面里有四个是函数 ——
        // 用 `=== null` 之外的真判据之前,这一格会把它们全判成「缺失」。
        const present = got.value !== null && got.value !== undefined;
        if (testCase.expect === null && !present) {
          bad.push(`导出 ${exportName} 不存在(undefined)—— 判定面/注入面缺这一项`);
        }
      }
      return bad;
    }
    case "realRepo": {
      const run = runAt(projectRoot, testCase.args ?? []);
      if (run.code !== testCase.expectCode || !(testCase.expect?.test(run.output) ?? false)) {
        return [`期望 exit=${String(testCase.expectCode)} 且输出匹配 ${String(testCase.expect)},实际 exit=${String(run.code)}\n${run.output}`];
      }
      return [];
    }
    case "cliBare": {
      const run = runOnBareRoot(testCase.args ?? []);
      if (run.code !== testCase.expectCode || !(testCase.expect?.test(run.output) ?? false)) {
        return [`期望 exit=${String(testCase.expectCode)} 且输出匹配 ${String(testCase.expect)},实际 exit=${String(run.code)}\n${run.output}`];
      }
      return [];
    }
    case "cli": {
      const run = runChecker(testCase.extra ?? {}, testCase.args ?? []);
      if (run.code !== testCase.expectCode || !(testCase.expect?.test(run.output) ?? false)) {
        return [`期望 exit=${String(testCase.expectCode)} 且输出匹配 ${String(testCase.expect)},实际 exit=${String(run.code)}\n${run.output}`];
      }
      return [];
    }
    default: {
      // judge 档:合成树 + 子进程 import 求值
      const dir = testCase.bare === true
        ? (() => {
          const d = mkdtempSync(join(tmpdir(), "m2w-samples-empty-"));
          mkdirSync(join(d, "samples"), { recursive: true });
          return d;
        })()
        : createFixture(testCase.extra ?? {}, testCase.extraDirs ?? []);
      try {
        const got = judgeInChild(dir, testCase.thrown ?? []);
        if (!got.ok) return [`子进程求值失败:${got.error}`];
        return judgeOne(testCase, got.problems, got.stats);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
}

/* ---------- 第一步:未变异的基线必须全绿(harness 本身先证明能跑通) ---------- */

console.log(`[samples-selftest] 基线:${CASES.length} 条夹具,判定本体 ${checkerRel}(未变异)`);
const baselineFailures = [];
for (const testCase of CASES) {
  try {
    const problems = runCase(testCase);
    if (problems.length === 0) {
      // 计数打进 [ok] 行而不是失败列表 —— 它是可读性信息,一旦混进失败判定,
      // 每一��� judge 夹具都会「失败」,而症状离根因隔着一整个 harness。
      // 计数打进 [ok] 行而不是失败列表 —— 它是可读性信息,一旦混进失败判定,
      // 每一条 judge 夹具都会「失败」,而症状离根因隔着一整个 harness。
      const detail = testCase.kind === "judge" ? ` / stats=${lastJudgeStats}` : "";
      console.log(`[ok] samples-selftest:${testCase.name}${detail}`);
    } else baselineFailures.push(`${testCase.name}:${problems.join(" / ")}`);
  } catch (error) {
    baselineFailures.push(`${testCase.name}:抛异常:${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
}
if (baselineFailures.length > 0) {
  for (const failure of baselineFailures) console.error(`[samples-selftest:fail] 基线 ${failure}`);
  console.error(
    `[samples-selftest:fail] 基线 ${baselineFailures.length}/${CASES.length} 条不通过 —— `
    + "变异实验全部作废:结论会挂在 harness 自身的故障上(本载体显式拒绝在这种状态下谈「有牙齿」)",
  );
  process.exit(1);
}
console.log(`[ok] samples-selftest:基线全绿(${CASES.length}/${CASES.length}),harness 本身能跑通`);

/* ---------- 第二步:变异实验(真改源文件 + 子进程重新 import) ---------- */

/**
 * 把折行统一成 LF;再按目标文件**自身**的折行放回去。
 *
 * ⚠ 锚点为什么必须行尾无关:`from`/`to` 是 LF 写死的字面量,而判定本体的**检出形态由各端
 * autocrlf 决定**(`* text=auto` + Windows runner 的 `core.autocrlf=true` ⇒ 检出即 CRLF)。
 * 拿 LF 锚点直接去 `includes` 一份 CRLF 源码,恒不命中 —— 而失败形态是「找不到锚点」,
 * 看着像锚点写错了,实则是行尾,于是本地(LF)绿、CI(CRLF)恒红。
 * 故:定位与替换都在**归一后的副本**上进行,落盘前再按原文件的折行放回去 ——
 * 变异窗口内不改动判定本体的行尾,`finally` 仍按 `original` 逐字节还原。
 * @param {string} lfText 折行已归一为 LF 的文本
 * @param {string} eol 原文件实际使用的折行
 * @returns {string} 按 `eol` 折行的文本
 */
function withFileEol(lfText, eol) {
  return eol === "\n" ? lfText : lfText.replace(/\n/g, eol);
}

/**
 * 真变异:把判定本体源文件里的 `from` 改成 `to`,跑一遍全部夹具,再逐字还原。
 *
 * ⚠ **必须是真改变行为**:断言 `from !== to` 只是最弱的一道闸,真正保证「变异有效」的是
 * 随后「该失败的夹具确实失败了」这一格 —— 若改的那段不在判定路径上,夹具会全绿,
 * `mustFail` 立刻报「应失败却仍绿」,本轮判红。
 * @param {string} from 原字面量(按 LF 书写)
 * @param {string} to 替换字面量(按 LF 书写)
 * @returns {{ failures: string[], passed: string[] }} 变异后失败 / 通过的夹具名
 */
function mutateAndRun(from, to) {
  const original = readFileSync(checkerPath, "utf8");
  // 归一到 LF 再定位:锚点与检出行尾解耦(见 withFileEol 的注)。
  // `from`/`to` 也各自归一,这样即便日后有人从 CRLF 文件里把锚点原样粘进来,仍能命中。
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const probe = original.replace(/\r\n/g, "\n");
  const anchor = from.replace(/\r\n/g, "\n");
  const replacement = to.replace(/\r\n/g, "\n");
  if (!probe.includes(anchor)) throw new Error(`变异定位失败:判定本体里找不到 ${JSON.stringify(anchor)}`);
  if (from === to) throw new Error(`变异是空操作(${JSON.stringify(from)} → ${JSON.stringify(to)}):结论会是假的`);
  const mutated = withFileEol(probe.replace(anchor, replacement), eol);
  if (mutated === original) throw new Error("变异未改变文件内容:结论会是假的");
  writeFileSync(checkerPath, mutated, "utf8");
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const passed = [];
  try {
    for (const testCase of CASES) {
      /** @type {string[]} */
      let problems;
      try {
        problems = runCase(testCase);
      } catch (error) {
        problems = [`抛异常:${error instanceof Error ? error.message : String(error)}`];
      }
      if (problems.length === 0) passed.push(testCase.name);
      else failures.push(testCase.name);
    }
  } finally {
    writeFileSync(checkerPath, original, "utf8");
  }
  return { failures, passed };
}

/**
 * 变异实验一组。每组声明:变异说明 · 改动 · **必须失败的夹具名片段** ·
 * **必须仍然通过的夹具名片段**(证明变异没有把整个 harness 一起打红 —— 那一格缺失时
 * 「变异只打红对应判据」这句话会是假的:一份把所有夹具都打红的变异同样「让夹具失败了」)。
 */
const MUTATIONS = [
  {
    id: "变异① 判据一改成恒真(闭集收窄成一个永不出现的扩展名)",
    from: 'export const CODE_EXTS = Object.freeze([".mjs", ".js", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);',
    to: 'export const CODE_EXTS = Object.freeze([".this-ext-never-occurs"]);',
    mustFail: [
      ".mjs 落进 samples/",
      "深层子目录里的 .js",
      ".ts / .tsx / .mts / .cts / .cjs / .jsx",
      "大写扩展名",
      ".d.ts",
      "同名 md 与代码文件并存",
      "恰好一条",
      "闭集:CODE_EXTS",
      "CLI:合成树上有 .mjs",
      // 这一条**跨两族**:它同时断言「两处不可读子树各报一条」与「其余子树的代码文件
      // 照常报出来」。判据一被改成恒真 ⇒ 第三条(代码文件那条)消失 ⇒ 它必失败。
      // 列在这里是刻意的:把它记成 mustPass 会让「互不串扰」这句话本身变成假的
      // —— 跨族夹具在任一族失效时都该失败。
      "其余子树照常判定",
    ],
    mustPass: [
      "夹具基线",
      "md 正文里的围栏代码块",
      "空子目录",
      "整棵 samples/ 为空",
      "反向锚点:.json / .docx",
      "根目录列不出来",
      "某棵子树列不出来",
      "没有 samples/",
      "CLI 反向锚点",
      "未知参数",
      "--help",
      "真实仓",
    ],
    note: "判据一(扩展名)失效 ⇒ 只有判据一的夹具失败(加闭集自身那一格与跨两族那一格);判据二的其余夹具与所有锚点仍绿",
  },
  {
    id: "变异② 判据二改成恒真(列不出来时静默当作空目录)",
    // ⚠ 变异本体是**无条件** `return`(静默当作空目录)。刻意不写成
    // `if (someGlobalNeverSet) return;` 那种形态:那个全局永远是真 ⇒ 该分支永不进入 ⇒
    // **行为与变异前完全相同**,而本载体正是要消灭这种「改了但什么也没变」的假变异
    // (今天仓内栽过:`if (false) return` 让「能变红」的结论整个变假)。
    from: "      problems.push(\n        `${relDir} → samples-unreadable-subtree:",
    to: "      return; // 变异:列不出来 ⇒ 静默当作空目录(判据二被改成恒真)\n      problems.push(\n        `${relDir} → samples-unreadable-subtree:",
    mustFail: ["根目录列不出来", "某棵子树列不出来", "其余子树照常判定", "CLI:合成根里没有 samples/"],
    mustPass: [
      "夹具基线",
      "md 正文里的围栏代码块",
      "空子目录",
      "整棵 samples/ 为空",
      ".mjs 落进 samples/",
      "深层子目录里的 .js",
      ".ts / .tsx / .mts / .cts / .cjs / .jsx",
      "大写扩展名",
      ".d.ts",
      "反向锚点:.json / .docx",
      "同名 md 与代码文件并存",
      "恰好一条",
      "闭集:CODE_EXTS",
      "CLI:合成树上有 .mjs",
      "CLI 反向锚点",
      "未知参数",
      "--help",
      "真实仓",
    ],
    note: "判据二(子树可读)失效 ⇒ 只有判据二的夹具失败;判据一与所有锚点仍绿",
  },
];

const mutationFailures = [];
for (const mutation of MUTATIONS) {
  /** @type {{ failures: string[], passed: string[] }} */
  let result;
  try {
    result = mutateAndRun(mutation.from, mutation.to);
  } catch (error) {
    mutationFailures.push(`${mutation.id}:变异本身失败:${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  const missedFail = mutation.mustFail.filter((frag) => !result.failures.some((name) => name.includes(frag)));
  const missedPass = mutation.mustPass.filter((frag) => !result.passed.some((name) => name.includes(frag)));
  const line = `${mutation.id}:失败 ${result.failures.length} 条 / 通过 ${result.passed.length} 条`
    + `(应失败的未失败 ${missedFail.length} · 应通过的未通过 ${missedPass.length})`;
  if (missedFail.length === 0 && missedPass.length === 0) {
    console.log(`[ok] samples-selftest:变异实验 · ${line}`);
    console.log(`     ⇒ ${mutation.note}`);
    console.log(`     失败的夹具:${result.failures.join(" ; ")}`);
    continue;
  }
  mutationFailures.push(
    `${line}\n  应失败却仍绿的夹具片段:${missedFail.join(" | ")}\n`
    + `  应通过却变红的夹具片段:${missedPass.join(" | ")}\n  实际失败清单:${result.failures.join(" ; ")}`,
  );
}

if (mutationFailures.length > 0) {
  for (const failure of mutationFailures) console.error(`[samples-selftest:fail] ${failure}`);
  console.error(
    `[samples-selftest:fail] 变异实验失败,共 ${mutationFailures.length}/${MUTATIONS.length} 组 —— `
    + "「负向夹具有牙齿」这个结论不成立(要么判据改不坏,要么该组夹具根本没在验它)",
  );
  process.exit(1);
}

console.log(
  `[ok] samples-selftest:${CASES.length} 条夹具全部符合预期;`
  + `${MUTATIONS.length} 组变异实验各自只打红对应判据的夹具(互不串扰),还原后基线复绿`,
);