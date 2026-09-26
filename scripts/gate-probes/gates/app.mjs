// 门禁探针:构建新鲜度(check-build-fresh)+ 打包前冒烟(electron . --smoke)。
// 两者共用同一份「沙盒内自建 dist」的工程副本 —— 新鲜度检查本就是冒烟的前置,拆两个沙盒
// 会让两者的 dist 形态不一致(一个刚 build、一个是拷贝来的旧产物),负向结论就不可比了。
import fs from "node:fs";
import path from "node:path";
import { SMOKE_MARKERS, createUserData, disposeUserData, runProcess, userDataEnv, userDataSwitch } from "../../smoke-proc.mjs";
import { TREE_MIRROR_PATHS } from "../contract.mjs";
import { finalizeGate, judgeCase } from "../judge.mjs";
import { resolveElectron, resolveNode } from "../proc.mjs";

/**
 * 构建新鲜度门禁(`test:smoke` 的前置 `check-build-fresh`)探针。
 * @param {object} ctx 探针上下文
 * @returns {Promise<GateProbeResult>} 门禁结果
 */
export async function probeBuildFresh(ctx) {
  const node = resolveNode();
  const script = path.join(ctx.sandbox, "scripts", "check-build-fresh.mjs");
  /**
   * 在沙盒里跑一次新鲜度检查。
   * @returns {Promise<import("./smoke-proc.mjs").ProcessRunResult>} 运行结果
   */
  const runCheck = () =>
    runProcess({ command: node.command, args: [script], cwd: ctx.sandbox, env: node.env, timeoutMs: ctx.timeoutMs });

  const cases = [
    judgeCase(
      {
        id: "anchor",
        kind: "anchor",
        description: "刚在沙盒内 build 完:产物比源码新",
        expect: "zero",
        forbiddenKeywords: ["[build-fresh:fail]"],
      },
      await runCheck(),
    ),
  ];
  const target = path.join(ctx.sandbox, "src", "main", "index.ts");
  if (fs.existsSync(target)) {
    const before = fs.statSync(target);
    try {
      const ahead = new Date(Date.now() + 60_000);
      fs.utimesSync(target, ahead, ahead);
      cases.push(
        judgeCase(
          {
            id: "fault-src-newer",
            kind: "fault",
            description: "把一个源码文件的 mtime 推到产物之后(改了源码没重建)",
            fault: "src/main/index.ts 的 mtime 前移 60s",
            expect: "nonzero",
            expectKeywords: ["[build-fresh:fail]", "存在晚于 dist 的 src 改动", "请先运行 npm run build"],
          },
          await runCheck(),
        ),
      );
    } finally {
      fs.utimesSync(target, before.atime, before.mtime);
    }
  } else {
    cases.push(
      judgeCase(
        { id: "fault-src-newer", kind: "fault", description: "把一个源码文件的 mtime 推到产物之后", expect: "nonzero" },
        { code: 0, signal: null, timedOut: false, output: "" },
        "沙盒内缺少 src/main/index.ts,无法注入 mtime 故障",
      ),
    );
  }
  return finalizeGate("build-fresh", {
    sandboxed: true,
    sandboxInputs: [...TREE_MIRROR_PATHS, "node_modules(junction)"],
    cases,
  });
}

/**
 * smoke 冒烟门禁(`test:smoke` 的 `electron . --smoke`)探针。
 * 沙盒 = 沙盒内自建 dist 的工程副本;一次性 userData 与 APPDATA/LOCALAPPDATA 全部重定向
 * 进沙盒(语义单源在 scripts/smoke-proc.mjs),故真实用户数据零触碰。
 * 负向用「append 覆写」桩掉 dist 里的转换核心:模块形状不变、抛错发生在调用时,
 * 因此红的原因是「转换失败」而不是「应用起不来」。
 * @param {object} ctx 探针上下文
 * @returns {Promise<GateProbeResult>} 门禁结果
 */
export async function probeSmoke(ctx) {
  const electron = resolveElectron();
  const sandbox = ctx.sandbox;
  const markerTokens = SMOKE_MARKERS.map((marker) => marker.token);
  if (electron === null) {
    return finalizeGate("smoke", {
      sandboxed: true,
      sandboxInputs: [...TREE_MIRROR_PATHS, "node_modules(junction)"],
      cases: [
        judgeCase(
          { id: "electron-present", kind: "anchor", description: "electron 可执行文件可解析", expect: "zero" },
          { code: 1, signal: null, timedOut: false, output: "" },
          "沙盒化前提缺失:未找到 node_modules/electron/dist 下的可执行文件",
        ),
      ],
    });
  }
  /**
   * 以 --smoke 启动沙盒应用。
   * @returns {Promise<{ result: import("./smoke-proc.mjs").ProcessRunResult, userDataDir: string }>} 运行结果与一次性 userData
   */
  const runSmoke = async () => {
    const userDataDir = createUserData(path.join(sandbox, "output", "gate-probes"));
    const result = await runProcess({
      command: electron,
      args: [sandbox, "--smoke", userDataSwitch(userDataDir)],
      cwd: sandbox,
      env: userDataEnv(userDataDir),
      timeoutMs: ctx.smokeTimeoutMs,
    });
    return { result, userDataDir };
  };

  /** @type {ProbeCase[]} */
  const cases = [];
  /** @type {string[]} */
  const userDataDirs = [];
  try {
    const anchorRun = await runSmoke();
    userDataDirs.push(anchorRun.userDataDir);
    const absentMarkers = SMOKE_MARKERS.filter((marker) => !anchorRun.result.output.includes(marker.token)).map(
      (marker) => marker.label,
    );
    cases.push(
      judgeCase(
        {
          id: "anchor",
          kind: "anchor",
          description: "未破坏:冒烟自行退出 0 且五条诊断标记齐备",
          expect: "zero",
          expectKeywords: markerTokens,
          forbiddenKeywords: ["[smoke] convert FAILED"],
        },
        anchorRun.result,
        absentMarkers.length === 0 ? "" : `缺失标记:${absentMarkers.join("、")}`,
      ),
    );

    const convertPath = path.join(sandbox, "dist", "core", "convert.js");
    if (!fs.existsSync(convertPath)) {
      cases.push(
        judgeCase(
          { id: "fault-convert-core", kind: "fault", description: "桩掉转换核心后冒烟必须判红", expect: "nonzero" },
          { code: 0, signal: null, timedOut: false, output: "" },
          "沙盒内缺少 dist/core/convert.js,无法桩掉转换核心",
        ),
      );
    } else {
      const original = fs.readFileSync(convertPath);
      try {
        fs.appendFileSync(
          convertPath,
          [
            "",
            "// gate-probe: 覆写转换核心为必失败实现(append 覆写保留原有导出形状)",
            "convert = async () => {",
            '  throw new Error("gate-probe: 注入的转换失败");',
            "};",
            "",
          ].join("\n"),
          "utf8",
        );
        const brokenRun = await runSmoke();
        userDataDirs.push(brokenRun.userDataDir);
        cases.push(
          judgeCase(
            {
              id: "fault-convert-core",
              kind: "fault",
              description: "桩掉转换核心(convert 抛错)后冒烟必须非 0 退出且缺 convert ok 标记",
              fault: "向 dist/core/convert.js 追加一个必失败的 convert 覆写",
              expect: "nonzero",
              expectKeywords: ["[smoke] convert FAILED:", "gate-probe: 注入的转换失败"],
              forbiddenKeywords: [SMOKE_MARKERS[0].token],
            },
            brokenRun.result,
          ),
        );
      } finally {
        fs.writeFileSync(convertPath, original);
      }
    }
  } finally {
    for (const dir of userDataDirs) disposeUserData(dir);
  }

  return finalizeGate("smoke", {
    sandboxed: true,
    sandboxInputs: [...TREE_MIRROR_PATHS, "node_modules(junction)", "沙盒内自建 dist"],
    cases,
  });
}
