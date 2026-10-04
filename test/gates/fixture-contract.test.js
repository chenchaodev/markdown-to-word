// @ts-check
/**
 * 验收样例生成器契约守护段(位于 test/core/ = 跨域守护段;被测为
 * gates/fixtures/gen-fixtures.mjs 的显式契约与扫描范围,纯 Node,不依赖 dist):
 *
 * 生成器从测试段导出 fixtures 落盘验收样例。旧实现用正则预筛源码里有
 * `export const fixtures` 才 import,副作用型/改名的导出会被静默漏掉,漏掉的段
 * 又恰好走「无 fixtures → 告警跳过」分支,产物不完整也没人知道。现契约改为:
 * 目录范围内每个段都被 import,并显式声明契约——有样例写 `fixtures` + `meta.description`,
 * 无样例写 `fixtures = null`,都不写即判红。
 *
 * 四层断言:
 * 1. 段目录集合单源:生成器与 test/acceptance.mjs 读的是**同一个数组对象**(单一来源在
 *    test/common/test-common-surface.js),恒等不再靠「两处各写一份 + 抽文本比对」;
 *    守的是「acceptance 确实拿这份数组喂 runner,且没有第二份硬编码目录清单」;三者
 *    与文件系统一致;
 * 2. 发现一致:生成器列出的段名集合 == runner 的 discoverSegments 同目录结果
 *    (临时摘掉 M2W_ONLY,免得单段筛选把断言本身筛没);
 * 3. 豁免白名单自检:每条须写理由,且不得指向已不存在的段;
 * 4. 契约判定函数的逐条失败模式 + 正向锚点(合成模块对象,不写临时文件进 test/:
 *    临时段文件会被生成器与 lint/typecheck 扫到,残留即是事故)。
 * 5. 图片夹具字节基线:覆盖面到**全部**图片夹具(磁盘派生)+ 漂移/未登记/残留三类判红
 *    逐条点名文件 + 全部一致的正向锚点。守的是「夹具漂移必须在 --check 里可见」——
 *    旧实现只逐字节比对被样例引用到的图片,未被引用的夹具与「源副本同时被改」都在
 *    判据之外,曾因此把夹具漂移误判成代码回归(见 gates/fixtures/gen-fixtures.mjs 文件头)。
 * 6. 段发现的递归性与去重(临时合成树,mkdtemp 在系统临时区,不落 test/ 树):
 *    二级/三级段被发现且段名是相对 rootDir 的完整相对路径、rootDir 缺省回落到段目录
 *    basename、祖先/后代段目录对不重复登记(且按段名归并报出,不是静默去重)、
 *    两个不同文件算出同一个段名须报「段名撞名」、only 筛选对含多斜杠的完整段名仍生效。
 *    守的是「段放进二级目录后仍会被发现」—— 旧实现是单层 readdir,二级段永远不被发现
 *    也不被判红(生成器与 runner 同时漏,两边的对读恒等成立)。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, FIXTURES_DIR } from "../harness/paths.js";
import { discoverSegments, discoverSegmentsDetailed } from "../harness/runner.js";
import { removeTree } from "../harness/temp-resource.js";
import {
  FIXTURE_SEGMENT_DIRS,
  IMAGE_DIGEST_BASELINE,
  SEGMENT_EXEMPTIONS,
  auditImageDigests,
  buildReadme,
  findOutputNameCollisions,
  listCandidateSegments,
  listImageFixtures,
  planFixtureOutputs,
  validateSegmentContract,
} from "../../gates/fixtures/gen-fixtures.mjs";
import { SEGMENT_DIRS } from "../../shared/test-common-surface.js";

/** 段目录硬编码残留:acceptance.mjs 若再写 `path.join(testRoot, "…")` 字面量,就是第二份清单 */
const HARDCODED_DIR_RE = /path\.join\(testRoot,\s*"([^"]+)"\)/g;
/** acceptance.mjs 里「由 SEGMENT_DIRS 派生出段目录数组」的那一行 */
const DERIVED_DIRS_RE = /const\s+([A-Za-z_$][\w$]*)\s*=\s*SEGMENT_DIRS\.map\(/;

/**
 * 断言辅助。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`fixture-contract 断言失败:${msg}`);
}

/**
 * 段对象(planFixtureOutputs 只用 baseName)。
 * @param {string} baseName 段文件名(不含 .test.js)
 * @returns {{ baseName: string }} 最小段对象
 */
const seg = (baseName) => ({ baseName });

/**
 * 递归列出目录下的段文件(相对该目录的 posix 路径;同层按文件名码位序,同层文件先于其子目录)。
 * 与 gen-fixtures / runner 各有一份实现:这里要的是**独立第三份** —— 对读断言只有在两侧
 * 实现互不复用时才有检测力,复用任何一方都会退化成自证。
 * @param {string} dir 目录绝对路径
 * @param {string} relPrefix 递归内部用的相对前缀
 * @returns {string[]} 相对 dir 的 posix 路径(发现顺序)
 */
function listTestFilesRecursive(dir, relPrefix = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const files = [];
  const subdirs = [];
  for (const entry of entries) {
    const rel = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) subdirs.push({ name: entry.name, rel });
    else if (entry.name.endsWith(".test.js")) files.push(rel);
  }
  for (const sub of subdirs) files.push(...listTestFilesRecursive(path.join(dir, sub.name), sub.rel));
  return files;
}

/**
 * 递归写入一棵合成段树(只造空壳段文件:发现面只读目录项,不 import 内容)。
 * @param {string} root 树根绝对路径
 * @param {string[]} relFiles 相对 root 的 posix 段文件路径
 * @returns {void}
 */
function makeSyntheticTree(root, relFiles) {
  for (const rel of relFiles) {
    const target = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "export async function run() {}\n", "utf8");
  }
}

/**
 * 建临时树根:系统临时区里的 mkdtemp(天然唯一;两套验收同时跑也不会互删 —— 段内沙盒的
 * 唯一化理由同 setupSandbox 的注释)。
 * @returns {string} 树根绝对路径
 */
function makeTreeRoot() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "m2w-fixture-contract-"));
}

/**
 * 删掉合成树:合成段文件绝不能留在 test/ 树外被 lint/typecheck 扫到,更不能留在 test/ 树内
 * 被生成器与 runner 当成真段发现(那正是 fixture-contract 自己要防的事)。
 * @param {string} dir 树根绝对路径
 * @returns {void}
 */
function dropSyntheticTree(dir) {
  // 清理失败刻意吞掉:finally 里的清理不得盖过段内真正的断言失败(助手只负责吸收失败并返回结果)
  removeTree(dir);
}

/**
 * 段名清单(断言消息用)。
 * @param {{name: string}[]} segments 段描述
 * @returns {string} 逗号分隔的段名
 */
const namesOf = (segments) => segments.map((s) => s.name).join(",");

/**
 * 取清单里唯一的一项(项数 ≠ 1 即抛,免去调用点逐处 `arr[0]` 的下标收窄,也免得
 * 「断言长度」与「断言首项」写两遍时其中一遍被漏改)。
 * @template T
 * @param {T[]} items 清单
 * @param {string} label 失败标签
 * @returns {T} 唯一一项
 */
function sole(items, label) {
  if (items.length !== 1 || items[0] === undefined) {
    throw new Error(`fixture-contract 断言失败:${label}:清单须恰含 1 项,实际 ${items.length} 项`);
  }
  return items[0];
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // ================= 1. 段目录集合单源(同一数组对象)+ 与文件系统一致 =================
  const discovered = listCandidateSegments();
  {
    const acceptanceSrc = fs.readFileSync(path.join(ROOT, "test", "acceptance.mjs"), "utf8");
    // 恒等的第一半:生成器与验收入口读同一个数组对象(ESM live binding,同一模块必然同一引用)。
    assert(
      FIXTURE_SEGMENT_DIRS === SEGMENT_DIRS,
      `生成器与验收入口的段目录必须是同一个数组对象(单一来源 test/common/test-common-surface.js):`
        + `gen-fixtures=${JSON.stringify(FIXTURE_SEGMENT_DIRS)} single-source=${JSON.stringify(SEGMENT_DIRS)}`,
    );
    // 恒等的第二半:acceptance 确实拿这份数组喂 runner,且没有第二份硬编码目录清单。
    // (只看「同一对象」不够 —— acceptance 可以 import 之后不传给 runAll,那恒等形同虚设。)
    const hardcoded = [...acceptanceSrc.matchAll(HARDCODED_DIR_RE)].map((m) => m[1]);
    assert(
      hardcoded.length === 0,
      `acceptance.mjs 不得硬编码段目录(那是第二份清单):${hardcoded.join(", ")}——段目录集合的单一来源是 test/common/test-common-surface.js 的 SEGMENT_DIRS`,
    );
    const derivedName = DERIVED_DIRS_RE.exec(acceptanceSrc)?.[1] ?? "";
    assert(derivedName !== "", "acceptance.mjs 须由 SEGMENT_DIRS.map(…) 派生出交给 runAll 的段目录数组");
    assert(
      new RegExp(`runAll\\(\\s*${derivedName}\\b`).test(acceptanceSrc),
      `acceptance.mjs 的 runAll 实参须是派生的 ${derivedName}(当前未找到;等于「import 了却没喂 runner」)`,
    );
    // 递归口径(与 gen-fixtures 的 listSegmentFilesRecursive / runner 的 listSegmentFiles 同形):
    // 段路径镜像被测主体路径 ⇒ 段会落在二级目录(如 test/gates/repo/),单层扫描会漏掉它们。
    for (const relDir of FIXTURE_SEGMENT_DIRS) {
      const dir = path.join(ROOT, "test", relDir);
      assert(fs.existsSync(dir), `扫描目录不存在:${relDir}`);
      const onDisk = listTestFilesRecursive(dir);
      assert(onDisk.length > 0, `扫描目录内(递归)无 *.test.js:${relDir}`);
      const found = discovered.filter((s) => s.relDir === relDir).map((s) => path.basename(s.file));
      // 本组的判据是「生成器在一级+二级都发现得到」:二级段在本仓尚不存在(0 个二级目录),
      // 故这条断言今天恒等于一级口径 —— 真正的二级覆盖在下面第 7 组的合成树上。
      assert(
        found.join(",") === onDisk.filter((f) => !f.includes("/")).join(","),
        `${relDir} 目录内的一级段文件与生成器发现结果不一致:磁盘=${onDisk.join(",")} 生成器=${found.join(",")}`,
      );
    }
    console.log(`[ok] fixture-contract:段目录单源(同一数组对象)+ acceptance 喂 runner + 与文件系统一致(${FIXTURE_SEGMENT_DIRS.join(",")})`);
  }

  // ================= 2. 与 runner 的段发现一致 =================
  {
    // M2W_ONLY 会把 discoverSegments 变成「单段筛选」,先摘掉再比对,末尾复原
    const saved = process.env.M2W_ONLY;
    delete process.env.M2W_ONLY;
    let runnerNames;
    try {
      // rootDir = test/ 根(与 test/acceptance.mjs 传给 runAll 的是同一个):段名必须两侧同源,
      // 否则段放进二级目录后生成器给 gates/repo/y.test.js 而 runner 给 repo/y.test.js
      const found = await discoverSegments(FIXTURE_SEGMENT_DIRS.map((d) => path.join(ROOT, "test", d)), {
        rootDir: path.join(ROOT, "test"),
      });
      runnerNames = found.map((s) => s.name).sort();
    } finally {
      if (saved === undefined) delete process.env.M2W_ONLY;
      else process.env.M2W_ONLY = saved;
    }
    const mine = discovered.map((s) => s.name).sort();
    assert(runnerNames.length > 0, "runner 未发现任何段(发现逻辑失效?)");
    assert(
      mine.join(",") === runnerNames.join(","),
      `生成器与 runner 的段发现结果必须一致(漏一个目录 = 漏一批验收样例):\n  生成器(${mine.length})=${mine.join(",")}\n  runner(${runnerNames.length})=${runnerNames.join(",")}`,
    );
    console.log(`[ok] fixture-contract:与 runner 发现一致(${mine.length} 段)`);
  }

  // ================= 3. 豁免白名单自检 =================
  {
    const known = new Set(discovered.map((s) => s.name));
    for (const e of SEGMENT_EXEMPTIONS) {
      assert(
        typeof e.reason === "string" && e.reason.trim() !== "",
        `豁免登记「${e.segment}」未注明理由(理由为空的白名单条目等于永久盲区)`,
      );
      assert(known.has(e.segment), `豁免登记「${e.segment}」已不是现存测试段(段改名/删除后残留,请删除该条目)`);
    }
    console.log(`[ok] fixture-contract:豁免白名单自检通过(共 ${SEGMENT_EXEMPTIONS.length} 条)`);
  }

  // ================= 4. 契约判定:逐条失败模式 =================
  {
    /**
     * 断言某个合成模块被判红,且诊断同时含段名与关键线索。
     * @param {Record<string, unknown>} mod 合成模块对象
     * @param {string} needle 诊断必含线索
     * @param {string} label 失败标签
     * @returns {void}
     */
    const expectProblem = (mod, needle, label) => {
      const problems = validateSegmentContract("segments/probe.test.js", mod);
      assert(problems.length > 0, `${label}:应判红,实际零问题`);
      assert(
        problems.every((p) => p.startsWith("segments/probe.test.js:")),
        `${label}:诊断须指明段名,实际 ${problems.join(" | ")}`,
      );
      assert(
        problems.some((p) => p.includes(needle)),
        `${label}:诊断须含「${needle}」,实际 ${problems.join(" | ")}`,
      );
    };
    /**
     * 断言某个合成模块不判红(正向锚点)。
     * @param {Record<string, unknown>} mod 合成模块对象
     * @param {string} label 失败标签
     * @returns {void}
     */
    const ok = (mod, label) => {
      const problems = validateSegmentContract("segments/probe.test.js", mod);
      assert(problems.length === 0, `${label}:不应判红,实际 ${problems.join(" | ")}`);
    };

    expectProblem({ run() {} }, "未显式声明 fixture 契约", "整段未声明契约");
    expectProblem({ fixtures: {} }, "为空对象", "空对象(应写 null)");
    expectProblem({ fixtures: [] }, "必须是场景映射对象", "数组形态");
    expectProblem({ fixtures: "x" }, "必须是场景映射对象", "字符串形态");
    expectProblem({ fixtures: { main: 1 } }, "必须是 md 字符串", "场景值非字符串");
    expectProblem({ fixtures: { "a b": "x" }, meta: { description: "d" } }, "键名只允许", "键名含非法字符");
    expectProblem({ fixtures: { main: "x" } }, "缺 meta.description", "缺描述字段");
    expectProblem({ fixtures: { main: "x" }, meta: {} }, "缺 meta.description", "meta 无 description");
    expectProblem({ fixtures: { main: "x" }, meta: { description: "  " } }, "缺 meta.description", "描述为空白");
    ok({ fixtures: null }, "显式声明无样例");
    ok({ fixtures: { main: "x" }, meta: { description: "d" } }, "完整契约");
    ok({ fixtures: { main: "x" }, meta: { description: "d" }, run() {} }, "完整契约带 run");
    console.log("[ok] fixture-contract:契约判定 9 类失败模式命中 + 3 类正向锚点通过");
  }

  // ================= 5. 产物命名 / 撞车 / README 索引 =================
  {
    const outputs = planFixtureOutputs(seg("demo"), { zeta: "z", main: "m", alpha: "a", "bad key": "b" });
    assert(
      outputs.map((o) => o.name).join(",") === "demo-alpha.md,demo.md,demo-zeta.md",
      `产物命名规则(main 键不加后缀、其余加后缀、按键排序、非法键剔除)不符:实际 ${outputs.map((o) => o.name).join(",")}`,
    );
    const mainOutput = outputs.find((o) => o.key === "main");
    // 上方已断言命名结果含 demo.md(即 main 键产物),此处显式校验缺失以免静默跳过
    if (!mainOutput) throw new Error("产物命名断言失败:缺少 main 键产物");
    assert(mainOutput.content === "m", "产物内容应与 fixtures 键一一对应");

    const collide = [
      { relDir: "core", baseName: "dup", outputs: [{ name: "dup.md", key: "main" }] },
      { relDir: "main", baseName: "dup", outputs: [{ name: "dup.md", key: "main" }] },
    ];
    assert(
      findOutputNameCollisions(collide).length === 1,
      "跨目录同名段的同名产物必须判红(否则互相覆盖、静默丢样例)",
    );
    const noCollide = [
      { relDir: "core", baseName: "dup", outputs: [{ name: "dup-main.md", key: "main" }] },
      { relDir: "main", baseName: "dup", outputs: [{ name: "dup-x.md", key: "x" }] },
    ];
    assert(findOutputNameCollisions(noCollide).length === 0, "不同名产物不应误报撞车");

    const readme = buildReadme([
      { relDir: "core", baseName: "solo", description: "单场景描述", outputs: [{ name: "solo.md", key: "main" }] },
      {
        relDir: "core",
        baseName: "multi",
        description: "多场景描述|带竖线",
        outputs: [
          { name: "multi-a.md", key: "a" },
          { name: "multi-b.md", key: "b" },
        ],
      },
    ]);
    assert(readme.includes("| solo.md | 单场景描述 | test/core/solo.test.js |"), `单场景行未按显式描述生成:\n${readme}`);
    assert(readme.includes("(场景:a)") && readme.includes("(场景:b)"), "多场景行应追加场景键名消歧");
    assert(readme.includes("多场景描述\\|带竖线"), "描述中的竖线须转义,否则撑坏 Markdown 表格");
    assert(readme.trimEnd().endsWith("| multi-b.md | 多场景描述\\|带竖线(场景:b) | test/core/multi.test.js |"), `README 行序应随 entries 顺序:\n${readme}`);
    console.log("[ok] fixture-contract:产物命名 / 撞车判定 / README 索引生成均符合契约");
  }

  // ================= 6. 图片夹具字节基线(覆盖面 + 三类判红 + 正向锚点) =================
  {
    const found = listImageFixtures();
    assert(found.length > 0, "磁盘上未发现任何图片夹具(夹具树被搬走或派生逻辑失效?)");
    // 覆盖面判据是磁盘派生:基线与实测必须**完全同集**,两侧多一张都判红。
    // 这条同时挡住「新增夹具忘记登记」(实测多)与「夹具删了基线没清」(基线多)——
    // 后者是恒绿失效形态,故与漂移同级判红而非放行。
    const baselineKeys = Object.keys(IMAGE_DIGEST_BASELINE).sort();
    const foundKeys = found.map((f) => f.rel);
    assert(
      baselineKeys.join(",") === foundKeys.join(","),
      `图片夹具基线与磁盘实测不同集(新增夹具须跑 --print-image-baseline 登记;删除/改名须清基线):\n`
        + `  基线(${baselineKeys.length})=${baselineKeys.join(",")}\n`
        + `  实测(${foundKeys.length})=${foundKeys.join(",")}`,
    );
    // 覆盖面必须大于「生成器会复制的那些图片」——否则就退回旧失效形态。
    // 判据从磁盘派生:生成器只把**被生成样例引用到**的图复制进 docs/,
    // 故「在夹具树上、但在 docs/ 里没有对应副本」的即旧判据看不见的那批。
    const docsDir = path.join(FIXTURES_DIR, "docs");
    const copied = new Set(
      fs
        .readdirSync(docsDir, { withFileTypes: true, recursive: true })
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".png"))
        // parentPath 是 Node 22 起 Dirent 上的规范字段;此处只取目录部分拼回绝对路径
        .map((e) => path.relative(docsDir, path.join(e.parentPath, e.name)).split(path.sep).join("/")),
    );
    const uncoveredByCopy = foundKeys.filter((rel) => !copied.has(rel));
    assert(
      uncoveredByCopy.length > 0,
      `图片夹具覆盖面看起来仍只含生成器会复制的那些图片(${foundKeys.join(",")})——`
        + "基线必须覆盖全部夹具(含未被任何样例引用的),否则夹具漂移仍不可见",
    );
    // 正向锚点(反向锚点 = 全部一致时判绿):真实仓库当前必须零问题
    const clean = auditImageDigests(found, IMAGE_DIGEST_BASELINE);
    assert(
      clean.length === 0,
      `真实仓库的图片夹具与基线不一致(请确认是有意改动并重新登记,或回滚夹具):\n  ${clean.join("\n  ")}`,
    );

    // 负向一:漂移必须判红且点名该文件。逐个夹具都试一遍——
    // 只试一张就可能恰好挑中「本来就被比对」的那张,盖不住覆盖面判据的漏洞。
    for (const f of found) {
      const drifted = auditImageDigests(
        [{ rel: f.rel, sha256: "0".repeat(64) }],
        { [f.rel]: f.sha256 },
      );
      assert(drifted.length === 1, `${f.rel}: 字节漂移应恰判红一条,实际 ${drifted.length} 条:${drifted.join(" | ")}`);
      // 上方已断言 length === 1,取首项落到具名变量(免去逐处索引收窄)
      const only = /** @type {string} */ (drifted[0]);
      assert(
        only.startsWith(`${f.rel}:`) && only.includes("字节漂移"),
        `${f.rel}: 漂移诊断须点名该文件并说明是字节漂移,实际 ${only}`,
      );
      // 诊断要能定位到具体哪张图:摘要前缀进文案,便于人眼比对
      assert(
        only.includes(f.sha256.slice(0, 12)),
        `${f.rel}: 漂移诊断应含实测摘要前缀便于定位,实际 ${only}`,
      );
    }

    // 负向二:磁盘上有、基线里没有(新增夹具漏登记)→ 判红并点名
    const unregistered = auditImageDigests([{ rel: "new-fixture.png", sha256: "a".repeat(64) }], {});
    assert(unregistered.length === 1, `新增图片夹具未登记基线应恰判红一条,实际 ${unregistered.join(" | ")}`);
    const unregisteredOnly = /** @type {string} */ (unregistered[0]);
    assert(
      unregisteredOnly.startsWith("new-fixture.png:") && unregisteredOnly.includes("未登记"),
      `新增图片夹具未登记基线应判红并点名,实际 ${unregisteredOnly}`,
    );

    // 负向三:基线里有、磁盘上没有(夹具删除/改名后残留)→ 判红(恒绿失效形态)
    const stale = auditImageDigests([], { "gone.png": "b".repeat(64) });
    assert(stale.length === 1, `基线残留应恰判红一条,实际 ${stale.join(" | ")}`);
    const staleOnly = /** @type {string} */ (stale[0]);
    assert(
      staleOnly.startsWith("gone.png:") && staleOnly.includes("已不存在"),
      `基线残留的图片夹具应判红(否则删夹具后基线恒绿),实际 ${staleOnly}`,
    );

    console.log(
      `[ok] fixture-contract:图片夹具字节基线 ${foundKeys.length} 张全覆盖 + 漂移/未登记/残留三类判红点名 + 全部一致判绿`,
    );
  }

  // ================= 7. 段发现的递归性 / 去重 / rootDir 两分支 =================
  // 全部在系统临时区(mkdtemp,不落 test/ 树)的合成树上跑:合成段文件一旦留在 test/ 树内
  // 就会被生成器与 lint/typecheck 当成真段,残留即是事故(同第 4 组的纪律)。
  {
    /** @type {string[]} */
    const roots = [];
    try {
      /* ---- 7.1 递归发现 + 段名形态(显式 rootDir:相对 rootDir 的完整相对路径) ---- */
      const tree = makeTreeRoot();
      roots.push(tree);
      // 段目录刻意放在 pkg/ 之下:两级路径才能让「显式 rootDir」与「缺省回落」两条分支
      // 给出**不同**的前缀(basename ≠ 相对路径),只把段目录放在树根下的话两条分支
      // 逐字相同,回落分支等于没被断言到。
      makeSyntheticTree(tree, [
        "pkg/core/top.test.js",
        "pkg/core/alpha.test.js",
        "pkg/gates/w.test.js",
        "pkg/gates/repo/y.test.js",
        "pkg/gates/repo/deep/z.test.js",
        // 非段文件不得被发现(只看 *.test.js)
        "pkg/gates/notes.md",
        // 叫 .test.js 的**目录**不得被当成段登记(旧的 readdir 分不清文件与目录)
        "pkg/gates/decoy.test.js/readme.md",
      ]);
      const coreDir = path.join(tree, "pkg", "core");
      const gatesDir = path.join(tree, "pkg", "gates");
      const explicit = await discoverSegments([coreDir, gatesDir], { only: null, rootDir: tree });
      const explicitNames = explicit.map((s) => s.name);
      assert(
        explicitNames.join(",")
          === "pkg/core/alpha.test.js,pkg/core/top.test.js,pkg/gates/w.test.js,pkg/gates/repo/y.test.js,pkg/gates/repo/deep/z.test.js",
        `递归发现应含二级与三级段且段名为相对 rootDir 的完整相对路径,实际 ${namesOf(explicit)}`,
      );
      // ③/④ 形态:嵌套段名(段名是失败产物目录名与 M2W_ONLY 的匹配面,形态必须稳定)。
      // 判据取「相对其所在段目录还多一层」:段目录在 pkg/ 下,故阈值是 > 3 段
      const multiSlash = explicitNames.filter((n) => n.split("/").length > 3);
      assert(
        multiSlash.join(",") === "pkg/gates/repo/y.test.js,pkg/gates/repo/deep/z.test.js",
        `嵌套段名应恰为两段(pkg/gates/repo/… 与 pkg/gates/repo/deep/…),实际 ${multiSlash.join(",") || "无"}`,
      );
      // 非段文件与「叫 .test.js 的目录」都不得登记为段
      assert(
        explicitNames.every((n) => n.endsWith(".test.js") && !n.includes("decoy") && !n.includes("notes")),
        `只该登记段文件(*.test.js),不该含 notes.md 或叫 .test.js 的目录,实际 ${namesOf(explicit)}`,
      );
      // 段描述自洽:dir 必须是段文件**所在**目录(嵌套段为更深子目录),file 不含子目录
      for (const s of explicit) {
        const abs = path.resolve(s.dir, s.file);
        assert(
          fs.existsSync(abs) && abs.endsWith(s.file),
          `段描述应指向真实存在的段文件且 file 不含子目录:${s.name} → ${abs}`,
        );
        const shown = path.relative(tree, abs).split(path.sep).join("/");
        assert(shown === s.name, `段名须等于段文件相对 rootDir 的路径:${s.name} vs ${shown}`);
      }

      /* ---- 7.2 rootDir 缺省 → 回落段目录 basename(树在 test/ 树外,正是段内沙盒的形态) ---- */
      // 树在系统临时区、不在 test/ 之下:若强制按 testRoot 求相对,段名会变成 ../../…,
      // 而段名同时是失败产物目录名与筛选匹配面,含 .. 就会顶到 output/artifacts 之外
      const fallback = await discoverSegments([coreDir, gatesDir], { only: null });
      const fallbackNames = fallback.map((s) => s.name);
      assert(
        fallbackNames.join(",") === "core/alpha.test.js,core/top.test.js,gates/w.test.js,gates/repo/y.test.js,gates/repo/deep/z.test.js",
        `缺省 rootDir 应回落到段目录 basename 作为前缀(而非相对路径),实际 ${namesOf(fallback)}`,
      );
      assert(
        fallbackNames.every((n) => !n.includes("..") && !path.isAbsolute(n)),
        `回落分支的段名不得含 .. 或绝对路径(段名会当产物目录名用),实际 ${namesOf(fallback)}`,
      );
      // 回落 vs 显式:段文件集合相同,只有前缀不同 ⇒ 两分支都不丢段
      const fallbackFiles = fallback.map((s) => path.resolve(s.dir, s.file)).sort();
      const explicitFiles = explicit.map((s) => path.resolve(s.dir, s.file)).sort();
      assert(
        fallbackFiles.join(",") === explicitFiles.join(","),
        "rootDir 两分支发现的段文件集合应相同(前缀不同而已)",
      );
      // 边界:传了 rootDir 但段目录在它之外 → 同样回落 basename,绝不产出 ../ 前缀
      // (真实对应形态:段内沙盒在 output/tmp/ 下,而 rootDir 是 test/ 根)
      const outside = await discoverSegments([gatesDir], { only: null, rootDir: ROOT });
      assert(
        namesOf(outside) === "gates/w.test.js,gates/repo/y.test.js,gates/repo/deep/z.test.js",
        `段目录不在 rootDir 之内时应回落 basename 而不是产出 ../ 前缀,实际 ${namesOf(outside)}`,
      );
      // 同一边界的另一侧:rootDir 是段目录的祖先(tmp 根)时给完整相对路径,两种传法都自洽
      const inside = await discoverSegments([gatesDir], { only: null, rootDir: os.tmpdir() });
      assert(
        namesOf(inside).startsWith(`${path.basename(tree)}/pkg/gates/`),
        `rootDir 为祖先目录时应给完整相对路径(含临时树自身那层),实际 ${namesOf(inside)}`,
      );

      /* ---- 7.3 去重:祖先/后代段目录对不得重复登记 ---- */
      // gates 递归已含 gates/repo 下的两段;段目录表里再加 gates/repo 时同一文件会被发现两次
      const detailed = await discoverSegmentsDetailed([gatesDir, path.join(gatesDir, "repo")], {
        only: null,
        rootDir: tree,
      });
      const dupNames = detailed.segments.map((s) => s.name);
      const dupSet = new Set(dupNames);
      assert(
        dupNames.length === 3 && dupSet.size === 3,
        `祖先/后代段目录对(gates 与 gates/repo)不得重复登记:实际 ${dupNames.length} 条,去重后 ${dupSet.size} 条,清单 ${namesOf(detailed.segments)}`,
      );
      assert(
        dupNames.join(",") === "pkg/gates/w.test.js,pkg/gates/repo/y.test.js,pkg/gates/repo/deep/z.test.js",
        `去重后应保留每段一次(段名取首次登记的完整相对路径),实际 ${namesOf(detailed.segments)}`,
      );
      // 去重**必须不静默**:按段名归并后逐条报出(两段被重复发现 ⇒ 恰两条),各含两个来源
      const dupIssues = detailed.issues.filter((i) => i.kind === "重复发现");
      assert(
        dupIssues.map((i) => i.name).join(",") === "pkg/gates/repo/y.test.js,pkg/gates/repo/deep/z.test.js",
        `「重复发现」诊断须按段名逐条报出(两个被重复发现的段各一条),实际 ${JSON.stringify(detailed.issues)}`,
      );
      for (const issue of dupIssues) {
        assert(
          issue.sources.length === 2
            && (issue.sources[0] ?? "").includes("pkg")
            && (issue.sources[1] ?? "").includes("pkg"),
          `重复诊断须列出两个来源(哪两个段目录各发现了它),实际 ${JSON.stringify(issue.sources)}`,
        );
      }

      /* ---- 7.4 段名撞名:两个不同文件算出同一个段名须报出,且不吞掉任何一段 ---- */
      const otherRoot = makeTreeRoot();
      roots.push(otherRoot);
      makeSyntheticTree(otherRoot, ["pkg/gates/w.test.js"]);
      const collide = await discoverSegmentsDetailed([gatesDir, path.join(otherRoot, "pkg", "gates")], {
        only: null,
      });
      const collideIssue = collide.issues.find((i) => i.kind === "段名撞名");
      assert(
        collideIssue !== undefined && collideIssue.name === "gates/w.test.js",
        `两个不同文件算出同一个段名应报「段名撞名」并点名,实际 ${JSON.stringify(collide.issues)}`,
      );
      assert(
        collide.segments.length === 4,
        `撞名不得吞掉任何一段(runAll 末尾按段名建索引会后者覆盖前者),实际 ${collide.segments.length} 段:${namesOf(collide.segments)}`,
      );

      /* ---- 7.5 筛选面:only 仍按完整段名做包含匹配(递归后段名变长,含多斜杠) ---- */
      const filtered = await discoverSegments([gatesDir], { only: "repo/y", rootDir: tree });
      assert(
        sole(filtered, "only=repo/y 应只命中 pkg/gates/repo/y.test.js").name === "pkg/gates/repo/y.test.js",
        `only 筛选须对含多斜杠的完整段名生效,实际 ${namesOf(filtered)}`,
      );
      const topFiltered = await discoverSegments([gatesDir], { only: "w", rootDir: tree });
      assert(
        sole(topFiltered, "only=w 应只命中 pkg/gates/w.test.js").name === "pkg/gates/w.test.js",
        `only 筛选对一级段名仍生效,实际 ${namesOf(topFiltered)}`,
      );

      console.log(
        "[ok] fixture-contract:段发现递归性(二级/三级段 + 完整相对段名 + 非段文件与 .test.js 目录不入册)+ "
          + "rootDir 两条分支(显式相对路径 / 缺省与越界回落 basename,段名无 ..)+ "
          + "祖先/后代目录对去重并按段名归并报出 + 段名撞名报出且不吞段 + only 筛选对多斜杠段名生效",
      );
    } finally {
      for (const dir of roots) dropSyntheticTree(dir);
    }
  }
}
