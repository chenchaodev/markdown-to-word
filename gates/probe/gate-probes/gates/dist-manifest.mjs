// 门禁探针:dist 清单(check:dist-manifest = node gates/artifacts/check-dist-manifest.mjs --check)。
// 沙盒 = 合成最小工程:逐字节复制生产脚本(保证跑的是同一份实现,副本哈希写进报告)+
// 合成 dist + 沙盒内生成的清单,故 npm 脚本的默认参数(dist/ 与 output/artifacts/…)
// 在沙盒里原样生效,测的就是 npm 跑的那条命令。
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
 * 沙盒 = 合成最小工程:逐字节复制生产脚本(保证跑的是同一份实现)+ 合成 dist + 生成的清单,
 * 故 npm 脚本的默认参数(dist/ 与 output/artifacts/dist-manifest.json)原样生效。
 * @param {object} ctx 探针上下文
 * @param {number} ctx.timeoutMs 硬超时
 * @returns {Promise<GateProbeResult>} 门禁结果
 */
export async function probeDistManifest(ctx) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `${SANDBOX_PREFIX}manifest-`));
  const node = resolveNode();
  const scriptName = "check-dist-manifest.mjs";
  fs.mkdirSync(path.join(sandbox, "gates", "artifacts"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "gates", "artifacts", scriptName), path.join(sandbox, "gates", "artifacts", scriptName));
  // 被复制的门禁脚本从 shared/paths.js 取项目根(ADR-040),沙盒内必须带一份,
  // 否则探针会以「脚本起不来」失败 —— 那是夹具缺陷,不是门禁结论。
  fs.mkdirSync(path.join(sandbox, "shared"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "shared", "paths.js"), path.join(sandbox, "shared", "paths.js"));
  // CLI 解析与文件哈希已下沉到 shared/(ADR-049),被测脚本直接依赖这两个模块,同样要带一份。
  for (const mechanism of ["cli.mjs", "fsx.mjs"]) {
    fs.copyFileSync(path.join(ROOT, "shared", mechanism), path.join(sandbox, "shared", mechanism));
  }
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
  // 刻意写成单行且脚本名用字面量(而非上方的 scriptName 变量):副本闭包门禁的沙盒入口
  // 登记抽查(test/common/copy-closure-audit.js 的 findEntryExecutionLines)要求「复制行之外
  // 有一行**同时**出现该文件名与执行类调用词」—— 走变量或拆行都认不出,该副本会被判成死副本。
  const runScript = (args) => runProcess({ command: node.command, args: [path.join(sandbox, "gates", "artifacts", "check-dist-manifest.mjs"), ...args], cwd: sandbox, env: node.env, timeoutMs: ctx.timeoutMs });

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

  const sha = createHash("sha256").update(fs.readFileSync(path.join(ROOT, "gates", "artifacts", scriptName))).digest("hex");
  return finalizeGate("dist-manifest", {
    sandboxed: true,
    sandboxInputs: [`gates/artifacts/${scriptName}(逐字节副本 sha256:${sha.slice(0, 12)}…)`, "dist/**(合成)", "output/artifacts/dist-manifest.json(沙盒内生成)"],
    cases,
  });
}
