// 门禁探针:fixtures 漂移(check:fixtures = node test/tools/gen-fixtures.mjs --check)。
// 沙盒 = 工程副本;负向在副本里改/删一个真实 fixture,断言门禁判红且**点名该 fixture**。
import fs from "node:fs";
import path from "node:path";
import { runProcess } from "../../smoke-proc.mjs";
import { TREE_MIRROR_PATHS } from "../contract.mjs";
import { finalizeGate, judgeCase } from "../judge.mjs";
import { resolveNode } from "../proc.mjs";

/**
 * fixtures 漂移门禁(`check:fixtures`)探针。
 * 沙盒 = 工程副本;负向在副本里改/删一个真实 fixture,断言门禁判红且点名该 fixture。
 * @param {object} ctx 探针上下文
 * @param {string} ctx.sandbox 沙盒根
 * @param {number} ctx.timeoutMs 硬超时
 * @returns {Promise<GateProbeResult>} 门禁结果
 */
export async function probeFixtures(ctx) {
  const node = resolveNode();
  const script = path.join(ctx.sandbox, "test", "tools", "gen-fixtures.mjs");
  /**
   * 在沙盒里跑一次 check:fixtures。
   * @returns {Promise<import("./smoke-proc.mjs").ProcessRunResult>} 运行结果
   */
  const runCheck = () =>
    runProcess({ command: node.command, args: [script, "--check"], cwd: ctx.sandbox, env: node.env, timeoutMs: ctx.timeoutMs });

  const anchor = await runCheck();
  const acceptanceDir = path.join(ctx.sandbox, "test", "fixtures", "acceptance");
  const target = fs
    .readdirSync(acceptanceDir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort()[0];
  if (target === undefined) {
    // 前提缺失 = 门禁未被验证,必须判红(不能因为「没跑成故障」就算通过)
    return finalizeGate("fixtures", {
      sandboxed: true,
      sandboxInputs: [...TREE_MIRROR_PATHS, "node_modules(junction)"],
      cases: [
        {
          id: "target-pick",
          kind: "anchor",
          description: "挑选一个可破坏的 fixture 作为故障注入对象",
          expect: "zero",
          ok: false,
          exitCode: null,
          timedOut: false,
          diagnosticHits: [],
          missingKeywords: ["沙盒内存在可破坏的 fixture(.md)"],
          forbiddenHits: [],
          note: "沙盒内 test/fixtures/acceptance/ 下找不到可破坏的 .md,无法注入故障 —— 本门禁未被验证",
        },
      ],
      note: "前提缺失,门禁未被验证(不等于通过)",
    });
  }
  const targetPath = path.join(acceptanceDir, target);
  const original = fs.readFileSync(targetPath);
  /** @type {ProbeCase[]} */
  const cases = [
    judgeCase(
      {
        id: "anchor",
        kind: "anchor",
        description: "未破坏:acceptance/ 与段导出重新生成的内容一致",
        expect: "zero",
        expectKeywords: ["--check 通过"],
        forbiddenKeywords: ["[check] 失败", "--check 失败"],
      },
      anchor,
    ),
  ];

  try {
    fs.appendFileSync(targetPath, "\n<!-- gate-probe: 故意漂移 -->\n", "utf8");
    const drifted = await runCheck();
    cases.push(
      judgeCase(
        {
          id: "fault-content-drift",
          kind: "fault",
          description: "改一个 fixture 的内容(末行追加一行)",
          fault: `test/fixtures/acceptance/${target}:末行追加注释行`,
          expect: "nonzero",
          expectKeywords: [`[check] ${target}:`, "内容不一致", "首处差异第", "[gen-fixtures] --check 失败"],
        },
        drifted,
      ),
    );
  } finally {
    fs.writeFileSync(targetPath, original);
  }

  try {
    fs.rmSync(targetPath);
    const missing = await runCheck();
    cases.push(
      judgeCase(
        {
          id: "fault-missing",
          kind: "fault",
          description: "删一个 fixture",
          fault: `删除 test/fixtures/acceptance/${target}`,
          expect: "nonzero",
          expectKeywords: [`[check] ${target}:`, "缺失(应生成)", "[gen-fixtures] --check 失败"],
        },
        missing,
      ),
    );
  } finally {
    fs.writeFileSync(targetPath, original);
  }

  return finalizeGate("fixtures", {
    sandboxed: true,
    sandboxInputs: [...TREE_MIRROR_PATHS, "node_modules(junction)"],
    cases,
  });
}
