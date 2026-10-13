#!/usr/bin/env node
// @ts-check
/**
 * renderer HTML 的 data-i18n 属性通道校验门禁(纯文本判定,无产物、幂等,exit 0/1):
 * `src/renderer/*.html` 里每个 `data-i18n*="值"` 的**值必须是字典键**(`src/core/i18n/zh.ts`
 * 的 `dict`,即 `Dict = keyof typeof dict`),否则逐条点名 `文件:行号: 属性名=值`。
 *
 * ---- 它守什么 ----
 * `data-i18n*` 是**运行期 string key 通道**:消费方 `src/core/i18n/dom.ts` 的
 * `applyStaticTexts` 把属性值喂给 `tByKey(value)`,而 `tByKey` 的回退链是
 * 「当前语言 → en → key」,**两级都缺时返回 key 本身、不抛错**。于是 HTML 里写一个字典
 * 没有的 key,症状不是报错而是**界面静默显示裸 key**(如 `foo.bar` 原文)——
 * 这种失效没有红灯、没有日志,只有用户看见一句没翻译的英文点号串。
 * 事实底账见 `docs/evidence/20261006-173000-data-i18n属性通道无校验的事实底账.md`。
 *
 * ---- 为什么是门禁而不是 TS 类型 ----
 * 属性值写在 HTML 静态标注里,不在任何 tsconfig 的编译面内 ⇒ `Dict` 类型约束不到它
 * (`t(key: Dict)` 只保护 TS 侧的字面量调用)。这与已修掉的警告通道(`KeyedWarning.key`
 * 收窄为 `WarningKey`)同源但不同解法:那条是类型问题,这条是「扫 HTML 文本」问题。
 *
 * ---- 判据 A(主判据)----
 * 每个 `data-i18n*="值"` 的值:
 *   ① 必须命中**值域正则** `^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$`(即 `segment.leaf` 形态,
 *      至少一个点、每段 ASCII 标识符字符)。空格 / 首尾空白 / 前导或尾随点 / 单段无点 /
 *      **空值**都判红 —— 空值尤其隐蔽:`tByKey("")` 返回 `""`,会把文案静默清空。
 *   ② 必须是字典键集合的一员。
 * 判 A 之前**先剥 HTML 注释**(`<!-- … -->`):`index.html` 有若干注释文本提到
 * 「不带 data-i18n」,它们的说明性质不构成属性;更重要的是防御未来的
 * `<!-- 例:data-i18n="x.y" -->` 这类文档示例——注释不是渲染属性。
 *
 * ---- 判据 B(防空门禁:扫描面塌缩)----
 * 纯文本门禁最坏的失效形态是**恒绿**——walker 写坏 / HTML 全被搬走 / 正则失配都会让
 * 本门禁在零扫描面下「全绿」。故:
 *   ① 扫到的 HTML 份数为 0 ⇒ 判红(整棵树没了);
 *   ② 每个 HTML 文件**至少一处** `data-i18n*` 属性 ⇒ 某文件零命中即判红并点名(新加的
 *      HTML 忘了接入 i18n,或该文件的扫描静默失效)。
 * 两条都从**文件清单派生**,不含任何写死的数字下限 —— 文件集合本身就是唯一事实源。
 *
 * ---- 为什么不用 `shared/copy-closure.js` 的 lexSource ----
 * `lexSource` 抹的是 JS 行注释 / 块注释(`//` / `/* * /`),**不认 HTML 的 `<!-- -->`**;
 * 且它把属性值当字符串字面量标进 `inString` 掩码,那对「抽 JS import specifier」是对的,
 * 对「读 HTML 属性值」反而要把目标遮住。HTML 注释用本文件内的 `blankHtmlComments` 抹
 * (保留换行 ⇒ 行号不错位),属性值用普通 `"…"`/`'…'` 包围即可(HTML 属性值无 JS 式转义)。
 *
 * ---- 反向不判(登记,不隐藏)----
 * **不判「Dict 里没被 HTML 用的键 = 死键」**。静态 key 大量由 `settings-panel.ts` /
 * `dialogs.ts` / `book-wizard.ts` 等经 `t()` 用,死键判据面横跨 TS 与 HTML,属另一条工作线。
 *
 * 用法:
 *   node gates/repo/check-i18n-keys.mjs        # 判定(exit 0/1)
 *   node gates/repo/check-i18n-keys.mjs --help
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isMainModule } from "../../shared/cli.mjs";
import { ROOT } from "../../shared/paths.js";

const USAGE = "用法: node gates/repo/check-i18n-keys.mjs [--help]";

/** renderer HTML 所在的仓相对目录(扫描根)。 */
export const SCAN_ROOT = "src/renderer";

/** 参与扫描的文件扩展名(闭合枚举:判据面之外的格式不改动本门禁结论)。 */
export const HTML_EXT = ".html";

/** 字典单源:`Dict = keyof typeof dict` 的定义所在(zh 是键集唯一事实源,en/ja satisfies 锁全量)。 */
export const DICT_REL = "src/core/i18n/zh.ts";

/**
 * 属性值域正则:`segment.leaf` 形态 —— 一段以上 ASCII 标识符段,段间以 `.` 分隔,至少一个点。
 * 含空格 / 首尾空白 / 前导或尾随点 / 单段无点 / 空串都命中不了它。
 * @type {RegExp}
 */
export const VALUE_REGION_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/;

/**
 * 四种属性形态共用的捕获式:`data-i18n` / `data-i18n-title` / `data-i18n-aria-label` /
 * `data-i18n-placeholder`。组 1 = 后缀(`-title` 等,base 形态为空串),组 2 = 引号,组 3 = 值。
 * 值用 `[^"']*` 而非 `.*?`:HTML 属性值不含 JS 式转义,遇任一种引号即止;含另一种引号的坏值
 * (如 `it's`)会被截断后在值域/字典两关自然判红,不会漏报。
 * @type {RegExp}
 */
export const I18N_ATTR_RE = /data-i18n([a-z-]*)=(["'])([^"']*)\2/g;

/**
 * @typedef {object} HtmlFile 一份待判 HTML
 * @property {string} rel 仓库相对 POSIX 路径(诊断定位用)
 * @property {string} text 原文
 */

/** 下标 → 行号(1 起)。入参须与「用来定位的文本」一致(本门禁用抹注释后的文本,见 blankHtmlComments)。 */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

/**
 * 抹掉 HTML 注释 `<!-- … -->`,但**保留换行与等长占位**(非换行字符换成空格),使后续在抹注释
 * 文本上算出的下标/行号与原文逐字对齐 —— 行号错位会让「点名第 N 行」指向错误的源头行。
 * 非贪心 `*?` 到第一个 `-->` 即止;属性值内部的 `-->`(无 `<!--` 前缀)不会被误伤。
 * @param {string} text HTML 原文
 * @returns {string} 等长、注释被抹成空白的文本
 */
export function blankHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (chunk) => chunk.replace(/[^\n]/g, " "));
}

/**
 * 从 zh.ts 源文本切片枚举字典键:`const dict = {` … `} as const;` 之间,按行首
 * `^\s*"<键>":` 收键。刻意**不 import** dict(import 需先 build,会给门禁加一道构建前置),
 * 也刻意**不 lexSource**:dict 是平的 `"key": "value"` 表,键的正则按行首锚即可命中,
 * 段间的 `/* *​/` 分隔注释不以引号开头,天然不命中键正则。
 * 切片定位失败(找不到 `const dict = {` 或 `} as const;`)时返回空数组 —— 上游用空字典判定面
 * 会把所有属性误判红,那由 CLI 层的字典键数下限兜住(见 main)。
 * @param {string} zhSource zh.ts 源文本
 * @returns {string[]} 字典键(可能重复;调用方自行入 Set)
 */
export function extractDictKeys(zhSource) {
  const start = zhSource.indexOf("const dict = {");
  if (start < 0) return [];
  const end = zhSource.indexOf("} as const;", start);
  if (end < 0) return [];
  const slice = zhSource.slice(start, end);
  /** @type {string[]} */
  const keys = [];
  const re = /^\s*"([A-Za-z0-9_.]+)":/gm;
  let m = re.exec(slice);
  while (m !== null) {
    keys.push(m[1] ?? "");
    m = re.exec(slice);
  }
  return keys;
}

/**
 * 判定本体(纯函数:只吃一组 HTML + 字典键集合,零 IO)。返回问题清单,每条形如
 * `文件:行号: 属性名=值 → <原因>`。
 *
 * 判据 A(逐个属性:值域 + 字典成员)与判据 B 的「每个文件至少一处属性」都在此;
 * 「扫到的 HTML 份数为 0」那一档在 CLI 层(它要的是份数,不是逐条问题,与
 * check-segment-contracts 的塌缩下限同款分层)。
 * @param {readonly HtmlFile[]} files HTML 文件集合
 * @param {Iterable<string>} dictKeys 字典键集合(判定成员用)
 * @returns {string[]} 问题清单(空数组 = 通过)
 */
export function judgeHtmlKeys(files, dictKeys) {
  const dict = dictKeys instanceof Set ? dictKeys : new Set(dictKeys);
  /** @type {string[]} */
  const problems = [];
  for (const file of files) {
    const code = blankHtmlComments(file.text);
    I18N_ATTR_RE.lastIndex = 0;
    let occurrences = 0;
    let m = I18N_ATTR_RE.exec(code);
    while (m !== null) {
      occurrences += 1;
      const suffix = m[1] ?? "";
      const value = m[3] ?? "";
      const attr = `data-i18n${suffix}`;
      const where = `${file.rel}:${String(lineOf(code, m.index ?? 0))}`;
      // 判据 A①:值域。空值(值域天然不匹配)与含空格/畸形值同归此档,不再另立空值分支 ——
      // 空值的语义危害(静默清空文案)写进诊断文案,分类上仍是「值非法」。
      if (!VALUE_REGION_RE.test(value)) {
        problems.push(
          `${where}: ${attr}=${value} → 值域不合法(须为 segment.leaf 形态的字典键,至少一段 ASCII`
            + " 标识符段加一个点;空值会经 tByKey(\"\") 静默清空文案)",
        );
      } else if (!dict.has(value)) {
        // 判据 A②:字典成员。值域已过而字典没有 ⇒ 运行期显示裸 key。
        problems.push(`${where}: ${attr}=${value} → 字典外 key(Dict 无此键,界面会静默显示裸 key)`);
      }
      m = I18N_ATTR_RE.exec(code);
    }
    // 判据 B②:每个 HTML 至少一处 data-i18n*(从文件清单派生,零命中即点名该文件)。
    if (occurrences === 0) {
      problems.push(`${file.rel} → 零 data-i18n* 属性:该 HTML 文件一处 i18n 属性都没有(新 HTML 忘了接入,或扫描静默失效)`);
    }
  }
  return problems;
}

/** 递归列出扫描根下的 HTML 文件(仓库相对 POSIX,已排序)。整棵跳过生成物目录。 */
export function listHtmlFiles(root) {
  const scanAbs = path.join(root, ...SCAN_ROOT.split("/"));
  /** @type {string[]} */
  const files = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (["node_modules", "dist", "output", "release", ".git"].includes(entry.name)) continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.name.endsWith(HTML_EXT)) files.push(childRel);
    }
  };
  if (statSync(scanAbs, { throwIfNoEntry: false })?.isDirectory()) walk(scanAbs, SCAN_ROOT);
  return files.sort();
}

/**
 * 全树判定(读盘:字典 + HTML)。`base.root` 只为自测夹具存在(在临时合成根上求值)。
 * @param {{ root?: string }} [base]
 * @returns {{ problems: string[], files: number, occurrences: number, dictKeys: number }}
 */
export function analyze(base = {}) {
  const root = base.root ?? ROOT;
  const dictKeys = extractDictKeys(readFileSync(path.join(root, ...DICT_REL.split("/")), "utf8"));
  const dictSet = new Set(dictKeys);
  const rels = listHtmlFiles(root);
  const files = rels.map((rel) => ({
    rel,
    text: readFileSync(path.join(root, ...rel.split("/")), "utf8"),
  }));
  const problems = judgeHtmlKeys(files, dictSet);
  let occurrences = 0;
  for (const file of files) {
    const code = blankHtmlComments(file.text);
    I18N_ATTR_RE.lastIndex = 0;
    let m = I18N_ATTR_RE.exec(code);
    while (m !== null) {
      occurrences += 1;
      m = I18N_ATTR_RE.exec(code);
    }
  }
  return { problems, files: files.length, occurrences, dictKeys: dictSet.size };
}

/**
 * 门禁入口。
 * @param {string[]} [argv]
 * @param {{ root?: string }} [base]
 * @returns {number} 退出码
 */
export function main(argv = [], base = {}) {
  if (argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length > 0) {
    console.error(`[check-i18n-keys:fail] 无法识别的参数:${argv.join(" ")}(${USAGE})`);
    return 1;
  }

  let result;
  try {
    result = analyze(base);
  } catch (error) {
    console.error(
      `[check-i18n-keys:fail] 扫描失败:${error instanceof Error ? error.message : String(error)}`
        + "(读不到字典源或 renderer HTML 子树时会出现 —— 判红不放行:「没扫到」与「扫过且合规」不可区分)",
    );
    return 1;
  }

  // 判据 B①:扫描面塌缩。HTML 份数为 0 或字典键数为 0 都不许静默通过 —— 前者是树被搬空,
  // 后者是 extractDictKeys 切片定位失败(切片失败 ⇒ 空字典 ⇒ 所有属性都会被 A② 判红,
  // 但那种红与「真有字典外 key」混在一起;在此先一步按塌缩单独拦,归因更干净)。
  if (result.files === 0) {
    console.error(
      `[check-i18n-keys:fail] 扫描面塌缩:在 ${SCAN_ROOT}/ 下扫到 0 个 ${HTML_EXT} 文件`
        + "(renderer HTML 被搬走 / SCAN_ROOT 写坏时会出现;此时本门禁恒绿,等于不存在)",
    );
    return 1;
  }
  if (result.dictKeys === 0) {
    console.error(
      `[check-i18n-keys:fail] 字典键数为 0:从 ${DICT_REL} 切不出任何键`
        + "(extractDictKeys 的切片锚 `const dict = {` / `} as const;` 失配时会出现;"
        + "空字典会让判据 A② 把所有属性误判红,须与「真有字典外 key」区分归因)",
    );
    return 1;
  }

  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(`[check-i18n-keys:fail] ${problem}`);
    console.error(
      `[check-i18n-keys:fail] renderer HTML data-i18n 通道校验失败,共 ${result.problems.length} 项`
        + `(扫描 ${result.files} 个 HTML / ${String(result.occurrences)} 处属性出现 / 字典 ${String(result.dictKeys)} 键)。`
        + "两种正当出路:① 把该属性值改成字典内已有的键;② 确需新文案则在 `src/core/i18n/zh.ts` 的 dict"
        + " 里补键(en/ja 由 satisfies 锁全量,补 zh 会连带要求补 en/ja)。",
    );
    return 1;
  }

  console.log(
    `[ok] renderer HTML data-i18n 通道校验通过:扫描 ${result.files} 个 HTML / `
      + `${String(result.occurrences)} 处属性出现 / 字典 ${String(result.dictKeys)} 键,`
      + "每个 data-i18n* 的值都命中值域且在字典内",
  );
  return 0;
}

// 入口守卫:仅 CLI 直跑时执行;被 selftest / gate-index 指针解析 import 时零副作用
// (gate-index.selftest 会真 import() 全部 judgment.module,顶层自执行会改宿主退出码)。
if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
