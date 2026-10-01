// 门禁探针:coverage 阈值(test:coverage 的 c8 半段)。
//
// 关键设计:参数向量**取自 package.json 的 test:coverage 原文**(只把被测程序换成沙盒里
// 的极小 harness),这样「阈值被人调低 / --check-coverage 被删」这类配置漂移会被负向探针
// 当场抓住,而不是被探针自己的参数掩盖。
//
// 这里**刻意不写死**四个阈值(也不从别处推导期望值):期望的是「部分覆盖必须 exit 非 0」
// 这一**性质**,不是某个数字。写死数字会让探针在阈值被人改动时仍绿(=恒真断言);
// 改成从 package.json 推导期望值同样恒真(门禁与自己一致,漂移看不见)。真正判红的是
// 拿**真实参数向量**去跑一个**人造的低覆盖**,故对任意阈值取值都成立。
// 实测(负探针):四项全调到 1 → 本门禁 fault 案 exit 0、判红;只把 statements 调到 89 →
// 本门禁**仍绿**(沙盒里那点覆盖率仍高于 89),此时由 coverage-gate.mjs 静态面的
// 「与基线 thresholds 不一致」判红。两层职责不同,缺一不可。
//
// ⚠ 本仓特有的坑(ADR-048「覆盖率产物并入 output 单源」):下面 parseCoverageScript 的 flag
// 收集是「**连续以 `--` 开头的 token,遇首个非 `--` 即停**」。故带值的选项**必须写成等号
// 形态**(`--reports-dir=output/coverage`)。写成空格分隔(`--reports-dir output/coverage`)
// 会让收集在第二个 token 处中断,其后的 `--check-coverage` 与四个阈值全部丢失,而
// coverage-gate.mjs 静态面的 ① requireFlags 与 ② 阈值比对会**同时**判红且都不提真正的
// 病因(少了一个 flag)—— 排查会被引向阈值。该 ADR 已点名这条,改参数向量时勿改回空格形态。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProcess } from "../../../smoke/smoke-proc.mjs";
import { walkChain } from "../../../repo/chain-expand.mjs";
import { ROOT, SANDBOX_PREFIX } from "../contract.mjs";
import { finalizeGate, judgeCase } from "../judge.mjs";
import { resolveNode, tokenizeCommand } from "../proc.mjs";
import { writeFileIn } from "../sandbox.mjs";

/**
 * 解析 package.json 的 `test:coverage`,取出 c8 参数向量与被测程序。
 * 探针用**真实参数向量**(只把被测程序换成沙盒里的极小 harness),这样「阈值被人调低/
 * `--check-coverage` 被删」这类配置漂移会被负向探针当场抓住,而不是被探针自己的
 * 参数掩盖。参见文件头注:本函数是阈值向量的**唯一读取点**,故本仓不存在第二份阈值来源。
 * @param {string} [root] 读 package.json 与探测 c8 配置文件用的根目录(缺省为真实仓库根)。
 *   **可注入是为了让静态面那条新判据能被负向夹具测到**:coverage-gate.mjs 的
 *   auditStatic(root) 要核「`--reports-dir` 取值 == SUMMARY_RELATIVE 的目录部分」,而取值
 *   只存在于 package.json 里 —— root 写死真仓库时,夹具根造出的「取值不符」根本读不到,
 *   这条判据会退化成恒绿断言(夹具测不出红)。configFiles 的探测同样走这个 root,否则夹具
 *   根会去读真仓库里不存在的 c8 配置文件。
 * @returns {{ flags: string[], program: string[], ok: boolean, reason?: string, configFiles: string[] }} 解析结果
 */
export function parseCoverageScript(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const scripts = /** @type {Record<string, string>} */ (pkg.scripts ?? {});
  // 切段与递归展开由 gates/repo/chain-expand.mjs 独家提供(全仓单源)。此前这里是裸
  // `split("&&")`:只认单层,一旦 `test:coverage` 把 c8 半段包进子脚本就找不到它,而
  // 找不到时本函数返回 ok:false —— 那一档的失败文案会指向「配置漂移」,把人引向错误的排查方向。
  // 改用叶子命令序列(深度优先 = 真实执行序)后,内层半段照样被取到。
  /** @type {string[]} */
  const leaves = [];
  walkChain(scripts, "test:coverage", { onLeaf: (leaf) => leaves.push(leaf.text) });
  const c8Part = leaves.find((part) => /^c8\b/.test(part));
  if (c8Part === undefined) {
    return { flags: [], program: [], ok: false, reason: "package.json 的 test:coverage 里找不到 c8 调用", configFiles: [] };
  }
  const tokens = tokenizeCommand(c8Part);
  /** @type {string[]} */
  const flags = [];
  let index = 1;
  while (index < tokens.length && (tokens[index] ?? "").startsWith("--")) {
    flags.push(tokens[index] ?? "");
    index += 1;
  }
  const program = tokens.slice(index);
  /** @type {string[]} */
  const configFiles = [".c8rc", ".c8rc.json", ".c8rc.yml", ".c8rc.yaml", ".nycrc", ".nycrc.json"].filter((name) =>
    fs.existsSync(path.join(root, name)),
  );
  if (typeof pkg.c8 === "object" || typeof pkg.nyc === "object") configFiles.push("package.json#c8");
  if (program.length === 0) {
    return { flags, program, ok: false, reason: "c8 调用里找不到被测程序(参数向量解析异常)", configFiles };
  }
  return { flags, program, ok: true, configFiles };
}

/**
 * coverage 阈值门禁(`test:coverage` 的 c8 半段)探针。
 *
 * 沙盒 = 合成极小工程(dist/ 下两个模块 + 一个 harness),跑**仓库真实参数向量**:
 * - 锚点:被加载的模块全覆盖 → exit 0;
 * - 负向:被加载的模块只覆盖一部分 → 低于阈值 → exit 非 0 且报「不满足阈值」;
 * - 负向:dist/renderer/ 下被加载但零覆盖的模块**不应**进报告 → 证明 --exclude 仍生效;
 * - 盲区(只观测):从未被 import 的模块不进报告(参数向量未开 --all)→ 如实登记。
 * @param {object} ctx 探针上下文
 * @param {number} ctx.timeoutMs 硬超时
 * @returns {Promise<GateProbeResult>} 门禁结果
 */
export async function probeCoverage(ctx) {
  const c8Bin = path.join(ROOT, "node_modules", "c8", "bin", "c8.js");
  const parsed = parseCoverageScript();
  const inputs = ["dist/probe-target.mjs", "dist/renderer/probe-renderer.mjs", "harness.mjs", ...parsed.configFiles.map((name) => `(${name})`)];
  if (!fs.existsSync(c8Bin)) {
    return finalizeGate("coverage", {
      sandboxed: true,
      sandboxInputs: inputs,
      cases: [
        judgeCase(
          { id: "c8-present", kind: "anchor", description: "c8 可执行入口存在", expect: "zero" },
          { code: 1, signal: null, timedOut: false, output: "" },
          `沙盒化前提缺失:未找到 ${path.posix.join("node_modules", "c8", "bin", "c8.js")}`,
        ),
      ],
    });
  }
  if (!parsed.ok) {
    return finalizeGate("coverage", {
      sandboxed: true,
      sandboxInputs: inputs,
      cases: [
        judgeCase(
          { id: "script-parse", kind: "anchor", description: "解析 package.json 的 test:coverage 参数向量", expect: "zero" },
          { code: 1, signal: null, timedOut: false, output: "" },
          `沙盒化前提缺失:${parsed.reason ?? "参数向量解析失败"}`,
        ),
      ],
    });
  }

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `${SANDBOX_PREFIX}c8-`));
  const node = resolveNode();
  writeFileIn(sandbox, "package.json", `${JSON.stringify({ name: "gate-probe-c8", version: "0.0.0", type: "module" }, null, 2)}\n`);
  for (const name of parsed.configFiles) {
    if (name.includes("#")) continue;
    fs.copyFileSync(path.join(ROOT, name), path.join(sandbox, name));
  }
  // 目标模块:被 harness 调用的一小段 + 永不调用的若干段(制造「加载了但没覆盖」)
  const targetSource = (covered) =>
    [
      "export function covered(a) {",
      "  const doubled = a * 2;",
      ...(covered ? [] : ["  if (a > 1000) { return -1; }", "  for (let i = 0; i < 0; i += 1) { doubled += i; }"]),
      "  return doubled;",
      "}",
      ...(covered
        ? []
        : [
            "export function cold1(a) { return a + 1; }",
            "export function cold2(a) { return a + 2; }",
            "export function cold3(a) { return a + 3; }",
            "export function cold4(a) { return a + 4; }",
            "export function cold5(a) { return a + 5; }",
          ]),
      "",
    ].join("\n");
  const rendererSource = ['export function neverCalled() {', '  return "renderer";', '}', ""].join("\n");
  writeFileIn(sandbox, "dist/probe-target.mjs", targetSource(true));
  writeFileIn(sandbox, "dist/renderer/probe-renderer.mjs", rendererSource);
  writeFileIn(
    sandbox,
    "harness.mjs",
    [
      'import { covered } from "./dist/probe-target.mjs";',
      'import { neverCalled } from "./dist/renderer/probe-renderer.mjs";',
      "void neverCalled;",
      'process.stdout.write(`harness:${String(covered(2))}\\n`);',
      "",
    ].join("\n"),
  );
  /**
   * 用真实参数向量跑一次 c8。
   * @returns {Promise<import("../../../smoke/smoke-proc.mjs").ProcessRunResult>} 运行结果
   */
  const runC8 = () =>
    runProcess({
      command: node.command,
      args: [c8Bin, ...parsed.flags, node.command, "harness.mjs"],
      cwd: sandbox,
      // 子 c8 必须写进**自己的** NODE_V8_COVERAGE 目录。node.env 不覆盖该变量时,
      // 子进程会继承外层 test:coverage 的同一个临时目录,并在自身 report 阶段把它清空 ——
      // 结果是外层所有「文件名排序在 gate-probes.test.js 之前」的段,其 V8 覆盖数据整段丢失。
      // 2026-09 实测:只跑 formula 段时 math.ts 为 86.15%/80%,同一运行加上 gate-probes 段
      // 即掉到 0%/0%,而探针自身全绿。**这是让覆盖率门禁静默少算的坑,必须按目录隔离**,
      // 不能靠给测试段改名去排序绕过。
      env: { ...node.env, NODE_V8_COVERAGE: path.join(sandbox, ".v8cov") },
      timeoutMs: ctx.timeoutMs,
    });

  /** @type {ProbeCase[]} */
  const cases = [];
  try {
    // 锚点同时兼两件事:阈值满足即 exit 0;dist/renderer/ 下那个「被加载但零覆盖」的
    // 模块不得进报告 —— 若 --exclude 失效,这一次运行就会红(该 flag 是有载荷的,
    // 不是装饰),故无需再单独跑一次等价配置。
    cases.push(
      judgeCase(
        {
          id: "anchor",
          kind: "anchor",
          description: "未破坏:被加载的模块全覆盖,阈值满足,且 dist/renderer/ 的零覆盖模块不进报告(--exclude 仍生效)",
          expect: "zero",
          expectKeywords: ["harness:4"],
          forbiddenKeywords: ["probe-renderer.mjs", "does not meet global threshold"],
        },
        await runC8(),
      ),
    );

    writeFileIn(sandbox, "dist/probe-target.mjs", targetSource(false));
    const partial = await runC8();
    const thresholdLine = (partial.output.match(/ERROR: Coverage for [^\n]+/)?.[0] ?? "").trim();
    cases.push(
      judgeCase(
        {
          id: "fault-below-threshold",
          kind: "fault",
          description: "让被加载的模块只覆盖一部分(阈值不达标)",
          fault: "dist/probe-target.mjs 追加永不执行的分支与 5 个未被调用的函数",
          expect: "nonzero",
          expectKeywords: ["does not meet global threshold", "probe-target.mjs"],
        },
        partial,
        thresholdLine === "" ? "未取到 c8 的阈值诊断行(判定已按关键字失败记账)" : thresholdLine,
      ),
    );

    // 盲区观测:从未被 import 的模块不进报告(参数向量未开 --all)→ 只登记不判定
    writeFileIn(sandbox, "dist/probe-target.mjs", targetSource(true));
    writeFileIn(sandbox, "dist/probe-unloaded.mjs", 'export function neverImported() { return "unloaded"; }\n');
    const unloaded = await runC8();
    cases.push(
      judgeCase(
        {
          id: "blindspot-unloaded-file",
          kind: "blindspot",
          description: "盲区观测:放入一个从未被 import 的模块,看门禁是否仍放行",
          fault: "新增 dist/probe-unloaded.mjs 且不被任何模块 import",
          expect: "zero",
          informational: true,
        },
        unloaded,
        unloaded.code === 0
          ? "观测结果:exit 0 —— 该模块未进入覆盖率报告,门禁对它无感知"
          : `观测结果:exit ${String(unloaded.code)} —— 门禁能看见未加载模块(与预期相反,须复核参数向量)`,
      ),
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 });
  }

  const blindSpot = cases.find((c) => c.id === "blindspot-unloaded-file");
  /** @type {ProbeFinding[]} */
  const findings = [];
  if (blindSpot?.note?.startsWith("观测结果:exit 0")) {
    findings.push({
      id: "coverage-unloaded-file-blind",
      severity: "advisory",
      summary:
        "coverage 门禁只统计被加载过的文件(参数向量未开 --all):新增但从未被 import 的模块不计入覆盖率,门禁对它等于空过",
      evidence: `以 package.json 的真实参数向量(${parsed.flags.join(" ")})放入 dist/probe-unloaded.mjs 后 c8 仍 exit 0,报告里无该文件`,
    });
  }
  return finalizeGate("coverage", {
    sandboxed: true,
    sandboxInputs: inputs,
    cases,
    findings,
    note: `c8 参数向量取自 package.json 的 test:coverage(${parsed.program.join(" ")} 段被替换为沙盒 harness);--exclude 的生效性由锚点一并断言(零覆盖的 dist/renderer 模块不进报告);npm run build 前半段不在本探针判定面`,
  });
}
