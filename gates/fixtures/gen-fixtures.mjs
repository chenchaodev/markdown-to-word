#!/usr/bin/env node
// @ts-check
/**
 * 验收 md 样例**产物面**(纯 Node,无 Electron 依赖):把测试段显式声明的样例落盘成
 * `samples/docs/<段基名>[-<场景>].md`,复制 md 中引用的本地图片
 * (引用路径不改写,GUI 按 md 所在目录解析),最后生成 README.md 索引。
 * 幂等:同一输入重复生成结果逐字节一致。
 *
 * ---- 它只管产物面,判定面已搬成独立门禁 ----
 * **契约面**(段有没有显式声明、声明合不合法、import 失败归因、豁免白名单)搬到了
 * `gates/fixtures/check-segment-contracts.mjs`(`collectSegmentContracts`),本文件是**消费方**:
 * 段 import 与 electron mock 注册在那里(那是契约与产物共同的**前置**,两处各写一遍等于
 * 重复付出 import 全部段的成本,而判定漂移的后果是「契约判红却照样落了盘」)。
 * **字节面**(图片夹具 sha256 基线 + 「`fixtures = null` 是合法终态」的判定层)搬到了
 * `gates/fixtures/check-image-digests.mjs`,本文件同样只 import 判定体。
 * ⇒ 搬移的理由都是同一条:**那两张判据的存续不能系于本生成器的去留**。
 * ⇒ 搬移的后果是三条判据现在**分别可归因**:契约不齐跑本脚本红,图片字节漂移红在两道
 * 门禁各自的面上而不是混在一句「--check 失败」里。
 *
 * 「复制」与「基线」两面互补、都必须过(与字节基线的关系照旧):
 * - 「复制」只覆盖**被生成样例引用到**的图片(源 ↔ docs/ 副本),回答的是「生成产物是否新鲜」;
 * - 「基线」覆盖 samples 下**全部**图片夹具(磁盘派生),回答的是「夹具本身有没有漂移」。
 *   前者看不见未被任何样例引用的夹具(manual/images/、input/ 下的图),而**源与副本同时被改**
 *   (如批量截断、重新导出)时基线那一面才是红的 —— 曾发生的真实误判正是基线那一面缺位:
 *   全部图片夹具各少一字节时 `--check` 判绿,而 image-size / basic-render 两段判红,
 *   排查一度指向代码回归。⚠ `samples/docs/input/*.png` 那两张**副本**不在基线内
 *   (`docs/` 被基线整棵排除)⇒ 它们的字节守仍在这里的 imageCopies 比对上,不可裁。
 *
 * 判定面留在本文件的只有两件:产物文件名撞车(跨目录同名段 + 同键互相覆盖 ⇒ 静默丢样例)
 * 与落盘前的绝对路径守卫。两者都判「落盘会发生什么」,故留在产物面而不是契约面。
 *
 * 用法:
 *   node gates/fixtures/gen-fixtures.mjs                      # 生成(需先 npm run build)
 *   node gates/fixtures/gen-fixtures.mjs --check              # 内存重生成比对,有差异 exit 1
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, FIXTURES_DIR } from "../../shared/paths.js";
// 基线那一面(字节表 / 盘点 / 审计 / 空声明合法终态判定层)的所在地已独立成门禁;
// 本文件是**消费方**:判定体在此 import,不在此实现(理由见文件头与该模块文件头)。
import {
  IMAGE_DIGEST_BASELINE,
  auditImageDigests,
  listImageFixtures,
} from "./check-image-digests.mjs";
// 契约面(段发现 / 逐段 import / 显式契约判定 / 豁免白名单)同样已独立成门禁;
// 本文件是**消费方**:拿它回吐的「契约齐备的段」去规划产物(理由见文件头)。
import { FIXTURE_KEY_RE, collectSegmentContracts } from "./check-segment-contracts.mjs";

const GENERATED_DOCS_DIR = path.join(FIXTURES_DIR, "docs");
const CHECK = process.argv.includes("--check");

/* ---------- md 图片引用解析(「复制」那一面:产物新鲜度) ---------- */

/** md 中图片引用:![...](path) 与 src="path" */
const IMG_MD_RE = /!\[[^\]]*\]\(([^)]+)\)/g;
const IMG_SRC_RE = /src="([^"]+)"/g;

const README_HEADER = [
  "# 验收样例",
  "",
  "由 `gates/fixtures/gen-fixtures.mjs` 从测试段命名导出自动生成(勿手改),",
  "供 GUI 人工实测直接拖入。重新生成:`npm run gen:fixtures`;校验:`npm run check:fixtures`。",
  "",
  "| 文件 | 功能/场景 | 对应测试段 |",
  "| --- | --- | --- |",
];

/**
 * 段 + fixtures → 产物清单(键名排序保证幂等;键 main 落 <段基名>.md,其余加后缀)。
 * 非法键在此剔除(契约面已就该情况判红,这里只是不再产出坏文件名)。
 * @param {{baseName: string}} seg
 * @param {Record<string, string>} fixtures
 * @returns {{name: string, content: string, key: string}[]}
 */
export function planFixtureOutputs(seg, fixtures) {
  return Object.keys(fixtures)
    .filter((key) => typeof fixtures[key] === "string" && FIXTURE_KEY_RE.test(key))
    .sort()
    .map((key) => ({
      name: key === "main" ? `${seg.baseName}.md` : `${seg.baseName}-${key}.md`,
      // 上方 filter 已断言值为字符串(非字符串键不进产物)
      content: /** @type {string} */ (fixtures[key]),
      key,
    }));
}

/**
 * 产物文件名全局查重:跨目录同名段 + 同键会互相覆盖(静默丢样例,最难察觉)。
 * @param {{relDir: string, baseName: string, outputs: {name: string, key: string}[]}[]} entries
 * @returns {string[]}
 */
export function findOutputNameCollisions(entries) {
  const owner = new Map();
  const problems = [];
  for (const e of entries) {
    for (const o of e.outputs) {
      const first = owner.get(o.name);
      if (first === undefined) {
        owner.set(o.name, e);
        continue;
      }
      problems.push(
        `${o.name}:${first.relDir}/${first.baseName}.test.js 与 ${e.relDir}/${e.baseName}.test.js 的场景产物重名(会互相覆盖)`,
      );
    }
  }
  return problems;
}

/**
 * README 索引正文(描述取自 meta.description 显式字段)。
 * 多场景段共用一条描述,追加 fixtures 键名(即文件名后缀)消歧;单场景段保持原描述。
 * @param {{relDir: string, baseName: string, description: string, outputs: {name: string, key: string}[]}[]} entries
 * @returns {string}
 */
export function buildReadme(entries) {
  const lines = [...README_HEADER];
  for (const e of entries) {
    for (const o of e.outputs) {
      const multi = e.outputs.length > 1;
      const desc = ((multi ? `${e.description}(场景:${o.key})` : e.description) || "-").replace(/\|/g, "\\|");
      lines.push(`| ${o.name} | ${desc} | test/${e.relDir}/${e.baseName}.test.js |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** 收集 md 中的本地图片引用(排除外链/锚点/data URI,剥离 title 与尖括号)
 * @param {string} md md 文本
 * @returns {string[]} 引用路径(去重)
 */
function collectImageRefs(md) {
  const refs = new Set();
  for (const re of [IMG_MD_RE, IMG_SRC_RE]) {
    for (const m of md.matchAll(re)) {
      // 两个模式的捕获组均为必选,?? "" 只是满足定长元组索引的取值域
      let p = (m[1] ?? "").trim().replace(/^<|>$/g, "").split(/\s+/)[0] ?? "";
      if (!p || /^https?:\/\//i.test(p) || /^#/.test(p) || /^data:/i.test(p)) continue;
      refs.add(p);
    }
  }
  return [...refs];
}

/** 首处差异行号(1 起;一致返回 -1)
 * @param {string} a 现有文本
 * @param {string} b 应生成文本
 * @returns {number}
 */
function firstDiffLine(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) return i + 1;
  }
  return -1;
}

// --check 比对前做 EOL 归一化(CRLF→LF):生成器落盘 LF,但 Windows autocrlf 下
// checkout 会把工作区文本产物转成 CRLF。.gitattributes 已固定
// fixtures 的 eol=lf,此处归一化是双保险——即使属性未生效/旧 checkout 也不误报。
const normalizeEol = (/** @type {string} */ s) => s.replace(/\r\n/g, "\n");

/**
 * 收齐产物面要落的全部条目。
 *
 * **契约那一面不在这里判**:`collectSegmentContracts` 已经在**同一批段**上跑完显式契约判定,
 * 并只把「契约齐备」的段回吐在 `loaded` 里。本函数只做剩下的产物面动作:剔除声明「本段无样例」
 * 的段、规划产物、判产物重名、定序。
 * ⚠ 那层耦合是**前后置**的(契约判红 ⇒ 该段不产出任何产物),两处各判一次必然漂移,
 * 而漂移的后果是「契约判红却照样落了盘」—— 那种失败静默。
 * @returns {Promise<{
 *   segments: {name: string, file: string, relDir: string, baseName: string}[],
 *   entries: {relDir: string, baseName: string, description: string, outputs: {name: string, content: string, key: string}[]}[],
 *   problems: string[],
 *   exemptSkipped: number,
 * }>}
 */
async function collectOutputs() {
  const { segments, loaded, problems, exemptSkipped } = await collectSegmentContracts();

  /** @type {{relDir: string, baseName: string, description: string, outputs: {name: string, content: string, key: string}[]}[]} */
  const entries = [];
  for (const { seg, mod } of loaded) {
    if (mod.fixtures === null) continue;
    entries.push({
      relDir: seg.relDir,
      baseName: seg.baseName,
      // 契约面已判定 description 为非空字符串
      description: /** @type {{ description: string }} */ (mod.meta).description,
      outputs: planFixtureOutputs(seg, /** @type {Record<string, string>} */ (mod.fixtures)),
    });
  }

  problems.push(...findOutputNameCollisions(entries));
  // 排序保证幂等(README 行序与写盘顺序一致);同名段以目录名定序,避免跨目录抖动
  entries.sort((a, b) => a.baseName.localeCompare(b.baseName) || a.relDir.localeCompare(b.relDir));
  return { segments, entries, problems, exemptSkipped };
}

export async function main() {
  const { segments, entries, problems, exemptSkipped } = await collectOutputs();

  if (problems.length > 0) {
    // 措辞覆盖两族:契约面的判红(由 check-segment-contracts.mjs 判出,逐条点名段)与产物面的
    // 判红(产物重名,逐条点名文件名)。两者都「不静默跳过」——跳过的后果是产物缺失而无人知晓。
    console.error(`[gen-fixtures] 契约/产物判定失败(${problems.length} 项;不静默跳过,请逐条修):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  // 图片复制清单(去重;源不存在 → 跳过,该样例本就是演示缺失警告)
  /** @type {{ src: string, dest: string }[]} */
  const imageCopies = [];
  for (const e of entries) {
    for (const o of e.outputs) {
      for (const ref of collectImageRefs(o.content)) {
        const src = path.resolve(FIXTURES_DIR, ref);
        if (!src.startsWith(FIXTURES_DIR + path.sep)) continue; // 防跳出 fixtures
        if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
        const dest = path.join(GENERATED_DOCS_DIR, ref);
        if (!imageCopies.some((c) => c.dest === dest)) imageCopies.push({ src, dest });
      }
    }
  }

  const readme = buildReadme(entries);
  const outputCount = entries.reduce((n, e) => n + e.outputs.length, 0);

  // ---- --check:内存重生成比对,不落盘 ----
  if (CHECK) {
    let ok = true;
    /**
     * 记一条差异(逐条列全,退出码统一在末尾给)
     * @param {string} name 产物文件名
     * @param {string} detail 差异描述
     */
    const report = (name, detail) => {
      ok = false;
      console.error(`[check] ${name}:${detail}`);
    };
    for (const e of entries) {
      for (const o of e.outputs) {
        const file = path.join(GENERATED_DOCS_DIR, o.name);
        if (!fs.existsSync(file)) {
          report(o.name, " 缺失(应生成)");
          continue;
        }
        const existing = normalizeEol(fs.readFileSync(file, "utf8"));
        if (existing !== o.content) {
          const line = firstDiffLine(existing, o.content);
          const ex = existing.split("\n")[line - 1] ?? "<无此行>";
          const want = o.content.split("\n")[line - 1] ?? "<无此行>";
          report(o.name, ` 内容不一致(首处差异第 ${line} 行)\n    现有: ${ex}\n    应生成: ${want}`);
        }
      }
    }
    const readmeFile = path.join(GENERATED_DOCS_DIR, "README.md");
    if (!fs.existsSync(readmeFile)) {
      report("README.md", " 缺失(应生成)");
    } else {
      const existing = normalizeEol(fs.readFileSync(readmeFile, "utf8"));
      if (existing !== readme) {
        report("README.md", ` 内容不一致(首处差异第 ${readme === "" ? "-" : firstDiffLine(existing, readme)} 行)`);
      }
    }
    for (const c of imageCopies) {
      if (!fs.existsSync(c.dest)) {
        report(path.relative(GENERATED_DOCS_DIR, c.dest), " 图片缺失(应复制)");
        continue;
      }
      if (!fs.readFileSync(c.src).equals(fs.readFileSync(c.dest))) {
        report(path.relative(GENERATED_DOCS_DIR, c.dest), " 图片与源文件字节不一致");
      }
    }
    // 全部图片夹具的字节基线(覆盖面大于上面的复制清单,两者互补;判红逐条点名文件)
    const imageProblems = auditImageDigests(listImageFixtures(), IMAGE_DIGEST_BASELINE);
    for (const p of imageProblems) report("图片夹具", ` ${p}`);
    if (!ok) {
      console.error("[gen-fixtures] --check 失败:docs/ 与生成内容存在差异,或图片夹具字节漂移");
      process.exit(1);
    }
    const exemptNote = exemptSkipped > 0 ? ` + ${exemptSkipped} 段按白名单豁免` : "";
    console.log(
      `[gen-fixtures] --check 通过:${entries.length} 段 ${outputCount} 个 md + README.md + ${imageCopies.length} 个图片复制 + 全部 ${listImageFixtures().length} 个图片夹具字节与基线一致(扫描 ${segments.length} 段${exemptNote})`,
    );
    process.exit(0);
  }

  // ---- 落盘 ----
  fs.mkdirSync(GENERATED_DOCS_DIR, { recursive: true });
  for (const e of entries) {
    for (const o of e.outputs) {
      // 守卫(2026-08-24 CI 踩坑):fixture 含本机绝对路径 → 其他检出路径重新生成必漂移
      //(merge.md 曾把 C:/Users/... 写入入库内容,CI 上 --check 全量误报)。宁可本地
      // 生成期响亮失败,也不让机器相关路径进库;测试段应导出相对引用或脱敏内容。
      if (o.content.includes(ROOT)) {
        console.error(`[gen-fixtures] 拒绝落盘:${o.name} 含仓库绝对路径(${ROOT})——请在测试段导出前还原为相对引用`);
        process.exit(1);
      }
      fs.writeFileSync(path.join(GENERATED_DOCS_DIR, o.name), o.content, "utf8");
    }
  }
  for (const c of imageCopies) {
    fs.mkdirSync(path.dirname(c.dest), { recursive: true });
    fs.copyFileSync(c.src, c.dest);
  }
  fs.writeFileSync(path.join(GENERATED_DOCS_DIR, "README.md"), readme, "utf8");

  const exemptNote = exemptSkipped > 0 ? `,${exemptSkipped} 段按白名单豁免` : "";
  console.log(`[gen-fixtures] 扫描 ${segments.length} 个测试段(契约齐备),${entries.length} 段含 fixtures 导出${exemptNote}`);
  for (const e of entries) {
    for (const o of e.outputs) {
      console.log(`  + ${o.name} (${o.content.length} 字符,${e.description || "-"})`);
    }
  }
  for (const c of imageCopies) {
    console.log(`  + 图片 ${path.relative(GENERATED_DOCS_DIR, c.dest)} (${fs.statSync(c.src).size} 字节)`);
  }
  console.log(`  + README.md (${entries.length} 行索引)`);
  console.log(`[gen-fixtures] 完成:${path.relative(ROOT, GENERATED_DOCS_DIR)}/`);
}

// 仅 CLI 直跑时执行;被测试段 import 复用纯函数时不得触发任何副作用。
// ⚠ electron mock loader 的注册现在住在契约面(`collectSegmentContracts` 内部),而它
// **只在 CLI 直跑这一条路上才可能到达** —— 段 import 本文件拿纯函数时不会注册任何解析器。
// 那条约束因此由「import 本文件」的调用方在段侧间接承担;本文件自己不再注册。
const isCli =
  process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isCli) {
  // 旧旗标 `--print-image-baseline` 已随字节基线搬到 check-image-digests.mjs。这里**显式拒绝**
  // 而不是静默忽略:静默忽略会让「照旧文档跑登记」的人**重新生成一批样例**却以为登记了基线,
  // 而生成是幂等的、不报任何错 ⇒ 那是一次无人察觉的空操作。
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    console.error(
      `[gen-fixtures] 无法识别的参数:${unknown.join(" ")}(本脚本只接受 --check;`
        + "图片字节基线的登记命令是 node gates/fixtures/check-image-digests.mjs --print-image-baseline)",
    );
    process.exit(1);
  }
  // ⚠ 基线审计本身仍在本脚本的 `--check` 里跑一遍(判定体自 check-image-digests.mjs import):
  // 两道门禁对同一批字节给出两个可分别归因的结论,而不是二选一。
  main().catch((err) => {
    console.error(`[gen-fixtures] 失败:${err?.stack ?? err}`);
    process.exit(1);
  });
}
