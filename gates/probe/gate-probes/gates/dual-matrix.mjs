// 门禁探针:双管线矩阵键覆盖登记(M2W_ONLY=dual-pipeline-matrix electron test/acceptance.mjs)。
//
// 判据面是**矩阵段自己的 assertMatrixShape**(含与台账 DUAL_PIPELINE_KEYS 的双向交叉核对),
// 不是「矩阵跑没跑过」—— 后者只证明断言没漂,证明不了「忘写」会被抓住。
//
// 为什么必须真跑 Electron 段:该断言与 26 行 verify 同在段内 run() 里,且段内 import
// dist/ 编译产物(test 是被测对象为 dist 而非 src)。没有一条更窄的入口能只跑形状守护
// 而不把 Electron 拉起来 —— 为此另开一个只做形状校验的脚本等于把判定逻辑复制一份,
// 那是比多花 2.7s 更坏的选择(判定口径必须单源)。
//
// 沙盒 = 工程副本(与 fixtures 门禁同一份,见 report.mjs 的 needsTreeSandbox):故障注入
// 只改副本里的 test/core/dual-pipeline-matrix.test.js,真实工作树零触碰。
import fs from "node:fs";
import path from "node:path";
import { createUserData, disposeUserData, runProcess, userDataEnv, userDataSwitch } from "../../../smoke/smoke-proc.mjs";
import { TREE_MIRROR_PATHS } from "../contract.mjs";
import { finalizeGate, judgeCase } from "../judge.mjs";
import { resolveElectron } from "../proc.mjs";

/** 被注入故障的段文件(仓库相对;沙盒内改它,真实工作树不碰) */
const SEGMENT_RELATIVE = "test/core/dual-pipeline-matrix.test.js";

/**
 * 双管线矩阵键覆盖登记门禁探针。
 *
 * 锚点 = 段在未破坏时跑完(26 行 verify + 键覆盖交叉核对)并 exit 0;
 * 两类负向各自对应「将来忘写」的一个方向:
 * - 删掉一行的 covers 标记 ⇒ 那个键零覆盖(新键没补行 / 标记被误删);
 * - 给某行的 covers 塞一个未登记的键 ⇒ 登记漂移(行声称覆盖一个台账里没有的键)。
 * @param {object} ctx 探针上下文
 * @param {string} ctx.sandbox 沙盒根
 * @param {number} ctx.timeoutMs 硬超时
 * @param {number} ctx.smokeTimeoutMs 硬超时(段内跑 Electron,沿用 smoke 的宽值)
 * @returns {Promise<GateProbeResult>} 门禁结果
 */
export async function probeDualMatrix(ctx) {
  const electron = resolveElectron();
  const inputs = [...TREE_MIRROR_PATHS, "node_modules(junction)"];
  if (electron === null) {
    // 前提缺失 = 门禁未被验证,必须判红(不因为「没跑成故障」就算通过)
    return finalizeGate("dual-matrix", {
      sandboxed: true,
      sandboxInputs: inputs,
      cases: [
        judgeCase(
          { id: "electron-present", kind: "anchor", description: "electron 可执行文件可解析", expect: "zero" },
          { code: 1, signal: null, timedOut: false, output: "" },
          "沙盒化前提缺失:未找到 node_modules/electron/dist 下的可执行文件",
        ),
      ],
      note: "前提缺失,门禁未被验证(不等于通过)",
    });
  }

  const segmentPath = path.join(ctx.sandbox, ...SEGMENT_RELATIVE.split("/"));
  if (!fs.existsSync(segmentPath)) {
    return finalizeGate("dual-matrix", {
      sandboxed: true,
      sandboxInputs: inputs,
      cases: [
        judgeCase(
          { id: "segment-present", kind: "anchor", description: "沙盒内存在被探测的矩阵段文件", expect: "zero" },
          { code: 1, signal: null, timedOut: false, output: "" },
          `沙盒化前提缺失:未找到 ${SEGMENT_RELATIVE}`,
        ),
      ],
      note: "前提缺失,门禁未被验证(不等于通过)",
    });
  }
  const original = fs.readFileSync(segmentPath, "utf8");

  /**
   * 跑一次被探测的门禁命令(M2W_ONLY 筛段 + 一次性 userData)。
   * @returns {Promise<import("../../../smoke/smoke-proc.mjs").ProcessRunResult>} 运行结果
   */
  const runGate = async () => {
    const userDataDir = createUserData(path.join(ctx.sandbox, "output", "gate-probes"));
    try {
      return await runProcess({
        command: electron,
        args: [path.join(ctx.sandbox, "test", "acceptance.mjs"), userDataSwitch(userDataDir)],
        cwd: ctx.sandbox,
        env: { ...userDataEnv(userDataDir), M2W_ONLY: "dual-pipeline-matrix" },
        timeoutMs: ctx.smokeTimeoutMs,
      });
    } finally {
      disposeUserData(userDataDir);
    }
  };

  /** @type {ProbeCase[]} */
  const cases = [];
  try {
    cases.push(
      judgeCase(
        {
          id: "anchor",
          kind: "anchor",
          description: "未破坏:26 行实跑通过,且 8 个双管线键逐键覆盖数已打印(交叉核对通过)",
          expect: "zero",
          // 关键字取自**结构事实**而非行数:「键覆盖交叉核对通过」由本段自己打印的
          // 逐键覆盖回显证明(它在 assertMatrixShape 之后、逐行 verify 之前打印不出来
          // —— 顺序即证据:打印不到说明形状守护已抛错)。
          expectKeywords: ["dual-pipeline-matrix:26 行全部实跑通过", "个双管线键逐键覆盖行数"],
          forbiddenKeywords: ["[dual-ledger]", "双管线键无任何矩阵行覆盖", "声明覆盖未登记的键"],
        },
        await runGate(),
      ),
    );

    // 负向一:删掉一行的 covers 标记 ⇒ 该键零覆盖
    const dropNeedle = '    covers: ["watermark"],';
    if (!original.includes(dropNeedle)) {
      cases.push(
        judgeCase(
          { id: "fault-drop-covers", kind: "fault", description: "删掉一行的 covers 标记", expect: "nonzero" },
          { code: 0, signal: null, timedOut: false, output: "" },
          `前提缺失:段文件里找不到待删的 covers 标记(${dropNeedle.trim()})—— 该行结构已变,须同步更新本探针`,
        ),
      );
    } else {
      try {
        fs.writeFileSync(segmentPath, original.replace(dropNeedle, "    covers: [],"), "utf8");
        cases.push(
          judgeCase(
            {
              id: "fault-drop-covers",
              kind: "fault",
              description: "删掉一行的 covers 标记(该键应变成零覆盖)",
              fault: `${SEGMENT_RELATIVE}:watermark 行的 covers 由 ["watermark"] 改为 []`,
              expect: "nonzero",
              expectKeywords: ["[dual-ledger]", "双管线键无任何矩阵行覆盖:watermark", "1/1 段失败"],
            },
            await runGate(),
          ),
        );
      } finally {
        fs.writeFileSync(segmentPath, original, "utf8");
      }
    }

    // 负向二:给某行的 covers 塞一个台账里没有的键 ⇒ 登记漂移
    const injectNeedle = '    covers: ["pageSetup"],';
    if (!original.includes(injectNeedle)) {
      cases.push(
        judgeCase(
          { id: "fault-unregistered-key", kind: "fault", description: "给某行塞一个未登记的键", expect: "nonzero" },
          { code: 0, signal: null, timedOut: false, output: "" },
          `前提缺失:段文件里找不到待注入的 covers 标记(${injectNeedle.trim()})—— 该行结构已变,须同步更新本探针`,
        ),
      );
    } else {
      try {
        fs.writeFileSync(
          segmentPath,
          original.replace(injectNeedle, '    covers: ["pageSetup", "gateProbeUnregisteredKey"],'),
          "utf8",
        );
        cases.push(
          judgeCase(
            {
              id: "fault-unregistered-key",
              kind: "fault",
              description: "给某行的 covers 塞一个台账未登记的键(登记漂移方向)",
              fault: `${SEGMENT_RELATIVE}:page-geometry 行的 covers 增加 "gateProbeUnregisteredKey"`,
              expect: "nonzero",
              expectKeywords: [
                "[dual-ledger]",
                "矩阵行 page-geometry 声明覆盖未登记的键:gateProbeUnregisteredKey",
                "1/1 段失败",
              ],
            },
            await runGate(),
          ),
        );
      } finally {
        fs.writeFileSync(segmentPath, original, "utf8");
      }
    }
  } finally {
    fs.writeFileSync(segmentPath, original, "utf8");
  }

  return finalizeGate("dual-matrix", {
    sandboxed: true,
    sandboxInputs: inputs,
    cases,
    note:
      "判据面是矩阵段内的键覆盖交叉核对(台账 DUAL_PIPELINE_KEYS × 逐行 covers),"
      + "不是「26 行跑过」;形状与覆盖的判定口径单源于段内 assertMatrixShape,本探针不复制判定逻辑。"
      + "抓不到:键集合本身的完备性(手工登记,新增 core 字段未登记则全绿)、覆盖的深度、断言恒真。"
      + "代价:每次探针跑 3 遍 Electron 段(锚点 + 两负向),锚点那遍含 26 行双侧实跑。",
  });
}
