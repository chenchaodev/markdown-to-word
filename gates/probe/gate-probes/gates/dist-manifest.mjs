// 门禁探针:dist 清单(check:dist-manifest = node gates/artifacts/check-dist-manifest.mjs --check)。
// 沙盒 = 合成最小工程:**真脚本**(从仓内原位跑,只靠 cwd 指沙盒)+ 合成 dist + 沙盒内生成的清单,
// 故 npm 脚本的默认参数(dist/ 与 output/artifacts/…)在沙盒里原样生效,测的就是 npm 跑的那条命令。
// 「真脚本 + cwd」取代了原先的逐字节副本:项目根单一来源是 shared/paths.js 的 process.cwd(),
// 而 ESM 静态 import 按**文件位置**解析、与 cwd 无关 ⇒ 副本永远带不齐仓内依赖,而真脚本自带。
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProcess } from "../../../smoke/smoke-proc.mjs";
import { ROOT, SANDBOX_PREFIX } from "../contract.mjs";
import { finalizeGate, judgeCase } from "../judge.mjs";
import { resolveNode } from "../proc.mjs";
import { writeFileIn } from "../sandbox.mjs";

/**
 * dist 清单门禁(`check:dist-manifest`)探针。
 * 沙盒 = 合成最小工程:真脚本(报告里的 sha256 取的是仓内那份)+ 合成 dist + 生成的清单,
 * 故 npm 脚本的默认参数(dist/ 与 output/artifacts/dist-manifest.json)原样生效。
 * @param {object} ctx 探针上下文
 * @param {number} ctx.timeoutMs 硬超时
 * @returns {Promise<GateProbeResult>} 门禁结果
 */
export async function probeDistManifest(ctx) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `${SANDBOX_PREFIX}manifest-`));
  const node = resolveNode();
  const scriptName = "check-dist-manifest.mjs";
  const scriptPath = path.join(ROOT, "gates", "artifacts", scriptName);
  const manifestInput = {
    "main/index.js": "export const main = 1;\n",
    "core/convert.js": "export const convert = 1;\n",
    "renderer/index.html": "<!doctype html>\n",
  };
  for (const [relative, content] of Object.entries(manifestInput)) {
    writeFileIn(sandbox, `dist/${relative}`, content);
  }
  /**
   * 在沙盒里跑一次清单脚本。
   * @param {string[]} args CLI 参数
   * @returns {Promise<import("../../../smoke/smoke-proc.mjs").ProcessRunResult>} 运行结果
   */
  // 脚本取仓内绝对路径、cwd 指沙盒:被测脚本的 ROOT(= cwd)因此是沙盒,而它的仓内 import
  // 由 Node 按真实文件位置解析,不需要在沙盒里再造一份。
  const runScript = (args) => runProcess({ command: node.command, args: [scriptPath, ...args], cwd: sandbox, env: node.env, timeoutMs: ctx.timeoutMs });

  /** @type {ProbeCase[]} */
  const cases = [];
  try {
    const generated = await runScript([]);
    cases.push(
      judgeCase(
        {
          id: "gen-anchor",
          kind: "anchor",
          description: "正向:先以生成模式产出清单(正向锚点的前置)",
          expect: "zero",
          expectKeywords: ["[ok] dist 清单已生成"],
        },
        generated,
      ),
    );
    cases.push(
      judgeCase(
        {
          id: "anchor",
          kind: "anchor",
          description: "未破坏:dist 与清单逐项一致",
          expect: "zero",
          expectKeywords: ["[ok] dist 与清单一致"],
        },
        await runScript(["--check"]),
      ),
    );
    const extra = "core/probe-extra.js";
    writeFileIn(sandbox, `dist/${extra}`, "export const probeExtra = 1;\n");
    cases.push(
      judgeCase(
        {
          id: "fault-stale-extra-file",
          kind: "fault",
          description: "往 dist 注入多余文件(clean build 后的残留)",
          fault: `新增 dist/${extra}`,
          expect: "nonzero",
          expectKeywords: [`产物陈旧(stale):${extra}`, "dist 校验失败"],
        },
        await runScript(["--check"]),
      ),
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 });
  }

  const sha = createHash("sha256").update(fs.readFileSync(scriptPath)).digest("hex");
  return finalizeGate("dist-manifest", {
    sandboxed: true,
    sandboxInputs: [`gates/artifacts/${scriptName}(仓内真脚本 sha256:${sha.slice(0, 12)}…)`, "dist/**(合成)", "output/artifacts/dist-manifest.json(沙盒内生成)"],
    cases,
  });
}
