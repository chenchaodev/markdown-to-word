#!/usr/bin/env node
// @ts-check
/**
 * 图片夹具**字节基线**门禁(纯 Node、无产物、幂等,exit 0/1)+ 「空声明是合法终态」判据的所在地。
 *
 * ---- 它守什么(第一件事:字节基线)----
 * `samples/` 下**全部**图片夹具的字节:`相对 samples 的 POSIX 路径` → `sha256`。
 * 三类问题各自点名文件:
 *   - 漂移:实测 sha256 ≠ 基线(附两侧摘要前缀,便于人眼定位是哪张图);
 *   - 未登记:磁盘上有、基线里没有(新增夹具漏登记 ⇒ 静默放行,正是本条要治的病);
 *   - 残留:基线里有、磁盘上没有(夹具删了/改名后基线没清 ⇒ 恒绿,同样判红)。
 *
 * ⚠ **为什么它必须独立成一道门禁,而不是继续寄居在 `gen-fixtures.mjs --check` 里**:
 * 基线表里那些**没有被任何样例引用**的图(`input/g4-preview.png` 与 `manual/images/` 下两张)
 * 没有第二个判据在看它们 —— 生成器只复制**被生成样例引用到**的图片,而源与副本**同时**被改
 * (批量截断 / 重新导出)时那条判据恒绿。曾发生的真实误判正是后者:图片夹具各少一字节时
 * `--check` 判绿,而 image-size / basic-render 两段判红,排查一度指向代码回归。
 * 即:生成器的产物面一旦裁撤或删除,这批图就**无人看守** ⇒ 基线的存续不能系于生成器的去留。
 * 两条判据本身仍然互补、都必须过(生成产物新鲜度 ↔ 夹具字节未漂移),本门禁只接管后者。
 *
 * ---- 它还守什么(第二件事:空声明合法终态)----
 * 「`export const fixtures = null` 是合法终态」这条判据 —— 它是全仓段里那些空声明的
 * **唯一**合法性来源(声明处数随段增删漂移,取数:`git grep -l "export const fixtures = null"
 * -- test | wc -l`)。它原先只存在于生成器的契约校验函数里,
 * 删生成器会连带删掉它 ⇒ 于是「哪些段没样例」这件事从一个**规则**退化成 100 多处裸字面量。
 * 本模块持有该判定层(`classifyFixturesDeclaration`),生成器**调用**它而不自己实现:
 * 判据与它的 123 处消费面因此解绑,且各自可测。
 *
 * 为什么两件事同处一个文件而不是拆两个:两者同在 `gates/fixtures/`、同一次搬出、共用同一条
 * 生命周期约束(都与生成器去留解耦)。拆开只多一次文件跳转,并不多一道边界 —— 而把无关的
 * 第二件事塞进一个**别的**模块(机制层下沉时最常见的耦合搬运)会让后来者以为它在守字节。
 * 故本文件名按**门禁面**命名,第二件事在本文件头与 selftest 里都显式点名。
 *
 * ---- 已知不覆盖(登记,不隐藏)----
 *   ① **排除判据是「根下目录名相等」,不是「这一棵是生成物」的可证事实**:
 *      {@link listImageFixtures} 比的是 `rel`(递归前缀),而根下条目的 `rel` 就是条目名
 *      ⇒ 排除只发生在**夹具根的第一层**:根下任何叫 `docs` 的目录被整棵跳过,
 *      **包括手写内容**(既不入基线、也不被生成器的 imageCopies 比对)。
 *      ⚠ 反向一条同样要写清,免得后来者照着「basename 语义」去推断出不存在的洞:
 *      **深层**的 `docs`(如 `samples/x/docs/y.png`)不满足 `rel === "docs"` ⇒ 它**照常入盘点**。
 *      这一点由 selftest 的对应档实测定死(抽取时逐字保留了原判据,未改判定面)。
 *   ② **非图片文件不在覆盖面内**:md 等文本夹具由生成器的产物面(逐字节比对 `samples/docs/`)
 *      管,本门禁只管图片字节;新增一种图片格式在 {@link IMAGE_EXTENSIONS} 登记一行即自动纳入。
 *   ③ **覆盖面判据是「磁盘派生」**:表是派生结果而非手写意图,新增/删除/改动夹具后跑
 *      `--print-image-baseline` 重新打印并整段替换本表(键按路径排序,便于 diff)。
 *      ⚠ 登记时**不得手改** —— 手改等于把派生结果写成手写意图,正是派生面门禁要治的形态。
 *
 * ---- `--print-image-baseline` 的性质:不 import 任何测试段 ----
 * 它的用途正是「**夹具出问题时仍要能取到当前字节重新登记**」⇒ 必须不受段契约问题、
 * electron mock、dist 是否已构建这三者中的任何一个阻塞。本模块因此**零段 import**
 * (不引 `shared/test-common-surface.js` 的段目录表,也不动态 import 段文件),比原先寄居在
 * 生成器里时更强:原先那条保证是「CLI 分支早于段 import」的时序,这里是结构上不可能性。
 *
 * 用法:
 *   node gates/fixtures/check-image-digests.mjs                      # 判定(exit 0/1)
 *   node gates/fixtures/check-image-digests.mjs --print-image-baseline  # 打印当前字节基线(登记用)
 *   node gates/fixtures/check-image-digests.mjs --help
 */

import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { isMainModule } from "../../shared/cli.mjs";
import { FIXTURES_DIR } from "../../shared/paths.js";

const USAGE = "用法: node gates/fixtures/check-image-digests.mjs [--print-image-baseline] [--help]";

/**
 * 图片扩展名(闭集;判据即「文件是什么」,不看具体文件名)。
 * 新增一种图片格式只需在此登记一行,现有夹具自动纳入比对。
 *
 * ⚠ **本清单是 `.gitattributes` 的图片族闭集的源**:那边逐类钉 `binary` 依赖「本处登记即生效」
 * 这条约定(漏钉一种,图片就被 `* text=auto` 当文本做 CRLF 归一,裸 Buffer 比对逐字节误红)。
 * 故增删扩展名时两处必须同批改。
 * @type {Set<string>}
 */
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg"]);

/**
 * 被排除的生成物目录名。
 *
 * 保持派生式(`basename` 取自夹具根下那一层)而不是写死字面量:本判据答的是「docs/ 是本仓
 * 生成器的产物目录,不是夹具源」,绑在目录名上;写成字面量则「改名产物目录」会静默退化成
 * 「整棵 docs/ 进基线」,而基线键集合随之变化、必须重新登记 —— 那是一次有意的动作,不该被
 * 一次无关的目录改名悄悄触发。
 * @type {string}
 */
const GENERATED_DOCS_DIR_NAME = path.basename(path.join(FIXTURES_DIR, "docs"));

/**
 * 图片夹具字节基线:`相对 samples 的 POSIX 路径` → `sha256`。
 *
 * 表是**派生结果**:新增/删除/改动夹具后跑 `--print-image-baseline` 重新打印并整段替换本表
 * (键按路径排序,便于 diff)。新增夹具而未登记 → 判红,而不是静默放行(那正是本条要治的病)。
 * @type {Record<string, string>}
 */
export const IMAGE_DIGEST_BASELINE = {
  "input/g1-tiny.png": "c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77",
  "input/g4-preview.png": "497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581",
  "input/img-800x400.png": "50892cbdeb429f404ab9712c53025b0f1955c38ea60d1e1b9b769ea46e150aef",
  "manual/images/chart.png": "05e41780382ce8e3dea2b3095a3c44164580a151d8a2bedb9367812af6566824",
  "manual/images/logo.png": "56bf36d0e8da47eee5a7c63405a2c5e7ecc1dface59a94824cf521d223a0b4ce",
};

/**
 * 扫描面文件数下限(防空门禁,判据 1)。
 *
 * 夹具根被搬走 / 根目录拼错 / 扩展名枚举写坏,都会让本门禁在**零扫描面**下「全绿」——
 * 而恒绿是这类门禁最坏的失效形态(没人会去看一个总是 exit 0 的脚本)。
 * 取值远低于棵内实测张数:它只负责挡「塌缩到几乎没扫到东西」,不随日常增删抖动。
 * @type {number}
 */
export const MIN_IMAGE_FIXTURES = 3;

/**
 * 基线条数下限(防空门禁,判据 2)。
 *
 * 与 {@link MIN_IMAGE_FIXTURES} 分立:扫到了足够多的图**不等于**基线登记了它们 —— 基线被清空
 * 或被误删大半时,「实测多于基线」那几档会判红,方向恰好是安全的;而真正的假绿是
 * 「基线只剩一条,磁盘上的图也被删到只剩那一条」,此时扫描面下限仍过、审计仍零问题。
 * @type {number}
 */
export const MIN_BASELINE_ENTRIES = 3;

/**
 * 列出 samples 下**全部**图片夹具(递归,排除生成物目录),键为 POSIX 相对路径。
 *
 * 覆盖面判据是「磁盘上有什么」而非手写清单:新增图片夹具自动进入比对范围,
 * 漏改一处不会退化成「扫不到」(那与本条要治的病同型)。IO 全部经入参注入根目录,
 * 故守护档可在临时目录上求值。
 *
 * ⚠ 排除判据是 `rel === <产物目录名>`,而 `rel` 带递归前缀 ⇒ 它只在夹具根的**第一层**成立
 * (根下的 `docs/` 跳过、深层的 `x/docs/` 照常入盘点)。见文件头「已知不覆盖 ①」的登记;
 * 改它属另一次裁决。
 * @param {string} [root] 夹具根目录(默认真实夹具根)
 * @returns {{ rel: string, abs: string, bytes: number, sha256: string }[]} 按 rel 排序
 */
export function listImageFixtures(root = FIXTURES_DIR) {
  /** @type {{ rel: string, abs: string, bytes: number, sha256: string }[]} */
  const found = [];
  /** @param {string} dir @param {string} prefix */
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      // docs/ 是生成器的产物目录,不是夹具源(它自己的图片由生成器的 imageCopies 比对)
      if (rel === GENERATED_DOCS_DIR_NAME) continue;
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const bytes = fs.readFileSync(abs);
      found.push({
        rel,
        abs,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  };
  walk(root, "");
  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * 图片夹具字节漂移判定(纯函数:只吃已算好的实测记录与基线表,便于守护档合成用例逐条覆盖)。
 * 三类问题各自点名文件:
 *   - 漂移:实测 sha256 ≠ 基线(附两侧摘要前缀,便于人眼定位是哪张图);
 *   - 未登记:磁盘上有、基线里没有(新增夹具漏登记 → 静默放行正是本条要治的病);
 *   - 残留:基线里有、磁盘上没有(夹具删除/改名后基线没清 → 恒绿,同样判红)。
 * @param {{ rel: string, sha256: string }[]} found 实测记录
 * @param {Record<string, string>} baseline 基线表
 * @returns {string[]} 问题清单(空数组 = 全部一致)
 */
export function auditImageDigests(found, baseline) {
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  for (const f of found) {
    seen.add(f.rel);
    const want = baseline[f.rel];
    if (want === undefined) {
      problems.push(
        `${f.rel}: 图片夹具未登记字节基线(新增夹具漏登记)——请跑 \`node gates/fixtures/check-image-digests.mjs --print-image-baseline\` 并整段替换 IMAGE_DIGEST_BASELINE`,
      );
      continue;
    }
    if (f.sha256 !== want) {
      problems.push(
        `${f.rel}: 图片夹具字节漂移(基线 ${want.slice(0, 12)}…,实测 ${f.sha256.slice(0, 12)}…)——` +
          `若为有意改动,请重新打印基线;若非有意,先查清是谁动了夹具(夹具漂移会让依赖它的段判红,极易误判为代码回归)`,
      );
    }
  }
  for (const rel of Object.keys(baseline).sort()) {
    if (!seen.has(rel)) {
      problems.push(
        `${rel}: 基线登记的图片夹具在磁盘上已不存在(删除/改名后残留)——请重新打印基线`,
      );
    }
  }
  return problems;
}

/**
 * 段的 fixtures 声明属于哪一档(判定层,纯函数)。
 *
 * - `absent`:段没导出 `fixtures` —— **判红**(契约缺失不许静默跳过);
 * - `null-terminal`:段显式写 `fixtures = null` —— **合法终态**(本段无验收样例),
 *   消费方据此跳过,不判红、也不产出样例;
 * - `declared`:段导出了场景映射 —— 交给契约校验的其余规则(键名合法 / 值为 md 字符串 /
 *   缺 meta.description)。
 *
 * 单独成函数而不是留在契约校验函数体内:这一档是那 100 多处 `= null` 字面量的**唯一**合法性
 * 来源,而它原先寄居在被裁撤议程上的生成器里。判定与消费面解绑后,任一侧消失都不会带走它。
 * @param {Record<string, unknown>} mod 段模块命名空间
 * @returns {"absent" | "null-terminal" | "declared"}
 */
export function classifyFixturesDeclaration(mod) {
  if (!("fixtures" in mod)) return "absent";
  return mod.fixtures === null ? "null-terminal" : "declared";
}

/**
 * 打印可直接粘贴的基线表(键按路径排序,便于 diff)。
 *
 * ⚠ 本函数是「夹具坏了也能重登记」那条性质的执行者:它**只**读夹具字节,不 import 任何测试段。
 * @param {string} [root] 夹具根目录(默认真实夹具根)
 * @returns {void}
 */
export function printImageBaseline(root = FIXTURES_DIR) {
  const found = listImageFixtures(root);
  console.log("export const IMAGE_DIGEST_BASELINE = {");
  for (const f of found) console.log(`  "${f.rel}": "${f.sha256}",`);
  console.log("};");
}

/**
 * 门禁判定体(纯函数:夹具根 → 问题清单),供 CLI 与守护档走同一条路径。
 * @param {string} [root] 夹具根目录(默认真实夹具根)
 * @returns {{ found: { rel: string, sha256: string }[], problems: string[] }}
 */
export function auditImageTree(root = FIXTURES_DIR) {
  const found = listImageFixtures(root);
  return { found, problems: auditImageDigests(found, IMAGE_DIGEST_BASELINE) };
}

/**
 * 门禁入口。
 * @param {string[]} [argv]
 * @returns {number} 退出码
 */
export function main(argv = []) {
  if (argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  // 登记分支在**任何扫描之前**分流:它的用途就是「夹具出问题时仍能取到当前字节」,
  // 被夹具问题本身拦住等于没有这条出路。
  if (argv.includes("--print-image-baseline")) {
    const unknown = argv.filter((arg) => arg !== "--print-image-baseline");
    if (unknown.length > 0) {
      console.error(`[image-digests:fail] 无法识别的参数:${unknown.join(" ")}(${USAGE})`);
      return 1;
    }
    printImageBaseline();
    return 0;
  }
  // 判定分支**不接受任何参数**:`--help` 已在上方返回,余下每一个 token 都是多余的。
  // 刻意严格而不是「放行以 `--` 开头的」:拼错的旗标(少一个字母、被编辑器折行截断)
  // 静默忽略等于把「登记命令写错了」变成「跑了一次判定」—— 那是一次看着成功的空操作。
  if (argv.length > 0) {
    console.error(`[image-digests:fail] 无法识别的参数:${argv.join(" ")}(${USAGE})`);
    return 1;
  }

  /** @type {{ found: { rel: string, sha256: string }[], problems: string[] }} */
  let result;
  try {
    result = auditImageTree();
  } catch (error) {
    console.error(
      `[image-digests:fail] 扫描失败:${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const scanned = result.found.length;
  const registered = Object.keys(IMAGE_DIGEST_BASELINE).length;
  if (scanned < MIN_IMAGE_FIXTURES) {
    console.error(
      `[image-digests:fail] 扫描面塌缩:只扫到 ${scanned} 个图片夹具,低于下限 ${MIN_IMAGE_FIXTURES}`
        + "(夹具根被搬走或 IMAGE_EXTENSIONS 写坏时会出现;此时本门禁恒绿,等于不存在)",
    );
    return 1;
  }
  if (registered < MIN_BASELINE_ENTRIES) {
    console.error(
      `[image-digests:fail] 基线塌缩:基线只剩 ${registered} 条,低于下限 ${MIN_BASELINE_ENTRIES}`
        + "(基线被清空/误删时会出现;此时审计在近乎零判定面上「全绿」)",
    );
    return 1;
  }

  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(`[image-digests:fail] ${problem}`);
    console.error(
      `[image-digests:fail] 图片夹具字节基线判定失败,共 ${result.problems.length} 项`
        + `(扫描 ${scanned} 个图片夹具 / 基线 ${registered} 条)`
        + "。重新登记基线:`node gates/fixtures/check-image-digests.mjs --print-image-baseline`,"
        + "整段替换 IMAGE_DIGEST_BASELINE(键按路径排序)。⚠ 若非有意改动,先查清是谁动了夹具 ——"
        + "夹具漂移会让依赖它的段判红,极易误判成代码回归。",
    );
    return 1;
  }
  console.log(
    `[ok] 图片夹具字节基线判定通过:扫描 ${scanned} 个图片夹具,字节与基线逐条一致(基线 ${registered} 条)`,
  );
  return 0;
}

// 仅 CLI 直跑时执行;被生成器与守护段 import 复用判定层时不得触发任何副作用。
// ⚠ 入口守卫是**位置事实**自比(见 shared/paths.js 头注「调用方一律用 fileURLToPath 自比」),
// 不用 ROOT 反推自身路径。
if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}