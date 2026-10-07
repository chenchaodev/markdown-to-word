// @ts-check
/**
 * 「怎么把pdf 宿主拉起来」的判定验收(位于 test/cli/,镜像 src/cli/host-launch.ts)。
 *
 * 被测主体 = dist/cli/host-launch.js。纯函数部分(`decideHostInvocation`)之所以
 * 单独可测,是因为它把上下文做成入参而不是读全局 —— 验收段本身跑在 Electron 里
 * (`process.versions.electron` 有值),若判定直接读全局,「纯 node 上下文」那条分支
 * 在本进程里永远测不到,只能靠真跑一次转换间接观察。本段对两种上下文各断言一次。
 *
 * 覆盖:
 * - 已装形态:exe = 应用自身、参数以 flag 开头(flag 常量取自跨面单源,不写字面量)
 * - 源码检出形态:exe = 传入的开发态 electron、参数首项是脚本路径
 * - **dev 形态的参数里不得出现 flag** —— 那是负向锚点:flag 只属已装形态,
 *   加进dev 形态会让 dev 的入口守卫读错位置(它按 argv[2]/[3] 取任务与结果路径)
 * - 两种上下文下 job/result 路径的位置都必须正确(flag 后紧跟两个值)
 * - pdfHostEntry() 指向 dist/main/cli-pdf-host.js(编译产物深度假设的回归护栏)
 * - 本进程(验收段)判为 Electron 提供 —— 这条同时证明该判据在真Electron 里成立
 */

/** 本段无验收样例(不跑转换,只测判定逻辑;契约见 gates/fixtures/gen-fixtures.mjs 文件头) */
export const fixtures = null;

import path from "node:path";
import {
  decideHostInvocation,
  hostInvocation,
  isElectronProvidedNode,
  pdfHostEntry,
} from "../../dist/cli/host-launch.js";
import { PDF_HOST_FLAG } from "../../dist/convert/cli-pdf-job.js";
import { createAsserter } from "../harness/assert.js";

// 真值断言取公共单源(收敛重复面,口径见 assert.js 文件头)
const { assert } = createAsserter("cli/host-launch");

/** 判定用的固定夹具值(两种上下文共用同一组 job/result,便于逐项对比) */
const JOB = "C:\\tmp\\job.json";
const RESULT = "C:\\tmp\\result.json";

export async function run() {
  // ---------- 一、已安装形态(Electron 提供的 node) ----------
  {
    const got = decideHostInvocation({
      electronProvided: true,
      execPath: "C:\\Users\\u\\AppData\\Local\\Programs\\MarkdownToWord\\MarkdownToWord.exe",
      devElectron: "",
      devEntry: "C:\\src\\dist\\main\\cli-pdf-host.js",
      jobPath: JOB,
      resultPath: RESULT,
    });
    assert(
      got.exe === "C:\\Users\\u\\AppData\\Local\\Programs\\MarkdownToWord\\MarkdownToWord.exe",
      `已装形态的 exe 应为应用自身,实际 ${got.exe}`,
    );
    assert(got.args[0] === PDF_HOST_FLAG, `已装形态参数首项应为 flag,实际 ${got.args[0]}`);
    assert(got.args.length === 3, `flag + job + result 应共 3 项,实际 ${got.args.length}`);
    assert(got.args[1] === JOB && got.args[2] === RESULT, "flag 之后应紧跟 job 与 result 路径");
  }

  // ---------- 二、源码检出形态(纯node) ----------
  {
    const got = decideHostInvocation({
      electronProvided: false,
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      devElectron: "C:\\src\\node_modules\\electron\\dist\\electron.exe",
      devEntry: "C:\\src\\dist\\main\\cli-pdf-host.js",
      jobPath: JOB,
      resultPath: RESULT,
    });
    assert(
      got.exe === "C:\\src\\node_modules\\electron\\dist\\electron.exe",
      `dev 形态的 exe 应取传入的开发态 electron,实际 ${got.exe}`,
    );
    assert(
      got.args[0] === "C:\\src\\dist\\main\\cli-pdf-host.js",
      `dev 形态参数首项应为脚本路径(它充当 Electron 的应用路径),实际 ${got.args[0]}`,
    );
    assert(got.args[1] === JOB && got.args[2] === RESULT, "脚本路径之后应紧跟 job 与 result");
  }

  // ---------- 三、负向锚点:dev 形态不得混入 flag ----------
  {
    const dev = decideHostInvocation({
      electronProvided: false,
      execPath: "C:\\nodejs\\node.exe",
      devElectron: "C:\\electron.exe",
      devEntry: "C:\\dist\\main\\cli-pdf-host.js",
      jobPath: JOB,
      resultPath: RESULT,
    });
    assert(
      !dev.args.includes(PDF_HOST_FLAG),
      `dev 形态参数里不得出现 ${PDF_HOST_FLAG}:独立脚本形态的入口守卫按 argv[2]/[3] 取路径,混入 flag 会读错位置`,
    );
    const installed = decideHostInvocation({
      electronProvided: true,
      execPath: "C:\\app.exe",
      devElectron: "",
      devEntry: "C:\\dist\\main\\cli-pdf-host.js",
      jobPath: JOB,
      resultPath: RESULT,
    });
    assert(
      !installed.args.includes("C:\\dist\\main\\cli-pdf-host.js"),
      "已装形态参数里不得出现脚本路径:那时它落在 app.asar 内,Electron 不能把 asar 内的文件当应用路径启动",
    );
  }

  // ---------- 四、判别式在本进程成立 ----------
  {
    assert(
      isElectronProvidedNode() === true,
      "验收段跑在 Electron 里,该判据应为 true(否则本段的三/四组断言测的不是生产路径)",
    );
    const live = hostInvocation(JOB, RESULT);
    assert(live.exe === process.execPath, `已装形态下应取 process.execPath,实际 ${live.exe}`);
    assert(live.args[0] === PDF_HOST_FLAG, "已装形态参数首项应为 flag");
  }

  // ---------- 五、脚本入口的深度假设(回归护栏) ----------
  {
    const entry = pdfHostEntry();
    assert(
      entry.endsWith(path.join("dist", "main", "cli-pdf-host.js")),
      `脚本入口应落在 dist/main/cli-pdf-host.js,实际 ${entry}`,
    );
    assert(path.isAbsolute(entry), "脚本入口应是绝对路径");
  }

  console.log(
    "[ok] cli/host-launch:宿主调用判定通过(已装形态 flag / dev 形态脚本路径 / 两种上下文参数位置 / flag 不混入 dev 形态 / 判别式在真 Electron 成立 / 脚本入口深度假设)",
  );
}