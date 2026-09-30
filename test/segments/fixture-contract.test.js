// @ts-check
/**
 * 验收样例生成器契约守护段(位于 test/segments/ = 跨域守护段;被测为
 * test/tools/gen-fixtures.mjs 的显式契约与扫描范围,纯 Node,不依赖 dist):
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
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../common/paths.js";
import { discoverSegments } from "../common/runner.js";
import {
  FIXTURE_SEGMENT_DIRS,
  SEGMENT_EXEMPTIONS,
  buildReadme,
  findOutputNameCollisions,
  listCandidateSegments,
  planFixtureOutputs,
  validateSegmentContract,
} from "../tools/gen-fixtures.mjs";
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

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
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
    for (const relDir of FIXTURE_SEGMENT_DIRS) {
      const dir = path.join(ROOT, "test", relDir);
      assert(fs.existsSync(dir), `扫描目录不存在:${relDir}`);
      const onDisk = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".test.js"))
        .sort();
      assert(onDisk.length > 0, `扫描目录内无 *.test.js:${relDir}`);
      const found = discovered.filter((s) => s.relDir === relDir).map((s) => path.basename(s.file));
      assert(
        found.join(",") === onDisk.join(","),
        `${relDir} 目录内的段文件与生成器发现结果不一致:磁盘=${onDisk.join(",")} 生成器=${found.join(",")}`,
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
      const found = await discoverSegments(FIXTURE_SEGMENT_DIRS.map((d) => path.join(ROOT, "test", d)));
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
      { relDir: "segments", baseName: "dup", outputs: [{ name: "dup.md", key: "main" }] },
      { relDir: "main", baseName: "dup", outputs: [{ name: "dup.md", key: "main" }] },
    ];
    assert(
      findOutputNameCollisions(collide).length === 1,
      "跨目录同名段的同名产物必须判红(否则互相覆盖、静默丢样例)",
    );
    const noCollide = [
      { relDir: "segments", baseName: "dup", outputs: [{ name: "dup-main.md", key: "main" }] },
      { relDir: "main", baseName: "dup", outputs: [{ name: "dup-x.md", key: "x" }] },
    ];
    assert(findOutputNameCollisions(noCollide).length === 0, "不同名产物不应误报撞车");

    const readme = buildReadme([
      { relDir: "segments", baseName: "solo", description: "单场景描述", outputs: [{ name: "solo.md", key: "main" }] },
      {
        relDir: "segments",
        baseName: "multi",
        description: "多场景描述|带竖线",
        outputs: [
          { name: "multi-a.md", key: "a" },
          { name: "multi-b.md", key: "b" },
        ],
      },
    ]);
    assert(readme.includes("| solo.md | 单场景描述 | test/segments/solo.test.js |"), `单场景行未按显式描述生成:\n${readme}`);
    assert(readme.includes("(场景:a)") && readme.includes("(场景:b)"), "多场景行应追加场景键名消歧");
    assert(readme.includes("多场景描述\\|带竖线"), "描述中的竖线须转义,否则撑坏 Markdown 表格");
    assert(readme.trimEnd().endsWith("| multi-b.md | 多场景描述\\|带竖线(场景:b) | test/segments/multi.test.js |"), `README 行序应随 entries 顺序:\n${readme}`);
    console.log("[ok] fixture-contract:产物命名 / 撞车判定 / README 索引生成均符合契约");
  }
}
