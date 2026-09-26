#!/usr/bin/env node
/**
 * 门禁故意失败探针(阴性自检):逐道门禁验证「被破坏时确实会红」,而不是空过。
 *
 * 要补的缺口:本仓的 coverage 阈值 / fixtures 漂移 / dist 清单 / 构建新鲜度 / smoke
 * 冒烟这些门禁,此前只有**偶然的反向证据**(某次回归恰好被某道门禁拦下),从未系统验证
 * 「门禁在被破坏时确实会红」。若某道门禁因脚本失效、正则写错、配置项丢失而变成永远
 * 通过,现有链路**不会**发现 —— 因为所有门禁的正常路径都是绿的,没人去看它们会不会红。
 * 本脚本就是补这一格:门禁的阴性自检。
 *
 * 每道门禁两类断言(缺一不可):
 * - 正向锚点(anchor):未破坏 → exit 0,防「脚本根本没跑起来也报绿」;
 * - 负向探针(fault):注入故障 → exit 非 0 **且** 诊断命中具体关键字。只看退出码会让
 *   「因错误原因失败」(如脚本自身崩了、参数写错)蒙混过关,故退出码与关键字双断言。
 * 锚点不绿 = 沙盒不可信,负向结论不成立 → 该门禁判 fail 并注明不可信原因;
 * **绝不**把探针改成「总是通过」来掩盖空过。
 *
 * 沙箱纪律(硬约束,勿放宽):
 * - 一切故障注入只发生在系统临时目录下的工程副本里。真实 test/fixtures、dist、
 *   output、package-lock.json 一律不注入故障、不被写入;
 * - 需要真实依赖时把 node_modules 以**目录联接(junction)**挂进沙盒,清理时先摘链接
 *   再删沙盒目录(非递归删除联接,绝不触碰真实 node_modules 的内容);
 * - 已知敏感面:工程副本是对工作树的一次拷贝,若拷贝期间工作树正被**并发写入**,副本
 *   可能是「撕裂」的(如某个测试段文件只拷到一半),于是门禁锚点会以「退出码非 0 且
 *   诊断关键字全部缺失」的形态变红 —— 失败方向是安全的一侧(不会误判成通过),且诊断
 *   一眼可辨(关键字全缺 = 因错误原因失败,不是「门禁抓到了故障」)。
 * - 探针前后对真实工作树做内容指纹(相对路径 + 字节数 + SHA-256)比对,不一致即整体
 *   判红;node_modules 另记「顶层条目数」哨兵(全量哈希不现实,只防误删这类灾难)。
 *   注意:若工作树正被**其它会话/进程并发修改**,本项会误报 —— 判红时会打印变化文件
 *   及其修改时间,落在本次运行窗口内即说明是外部改动,应在无并发改动的状态下重跑,
 *   而不是放宽本项。仅当确知工作树正被**其它会话并发写**(多 agent 共用工作区)时,
 *   可用 M2W_GATE_PROBES_ALLOW_CONCURRENT=1 把这一项降级为 advisory(变化文件仍照实
 *   列出,摘要里也照实显示「已变」);门禁本身的判定不受影响。
 *
 * 已知覆盖边界(如实登记,不掩盖):
 * - `test:coverage` 的 `npm run build` 前半段不在本脚本判定面内(只验证 c8 参数向量
 *   与阈值是否真的生效);构建面由 typecheck/build 门禁承担。
 * - `test:smoke` 的前置新鲜度检查单列为 build-fresh 门禁单独探测。
 * - 门禁配置中若存在 c8/nyc 的独立配置文件(.c8rc/.nycrc 等),探针会把它们复制进
 *   沙盒以保持配置面同构,并在报告里登记。
 *
 * 确定性:报告不含时间戳、耗时、绝对路径、随机目录名(只写关键字与布尔判定),
 * 同一棵工作树上重复运行应产出逐字节相同的 report.json。
 *
 * 布局(按职责拆岛,判定口径只有一处):
 *   scripts/gate-probes/contract.mjs        契约常量与类型单源
 *   scripts/gate-probes/proc.mjs            解释器/可执行文件解析、命令行分词
 *   scripts/gate-probes/sandbox.mjs         沙盒建/构建/清 + 真实工作树内容指纹
 *   scripts/gate-probes/judge.mjs           探针判定口径(退出码 + 关键字)
 *   scripts/gate-probes/gates/*.mjs         各门禁探针(跑什么、注入什么、期望什么)
 *   scripts/gate-probes/report.mjs          编排、报告组装、摘要、门禁选择
 *   本文件 = CLI 入口(参数解析 + 退出码)与对外再导出
 *
 * 用法:
 *   node scripts/check-gate-probes.mjs                 # 跑全部门禁探针
 *   node scripts/check-gate-probes.mjs --only=fixtures,smoke
 *   node scripts/check-gate-probes.mjs --skip=smoke     # 跳过重门禁(不启 GUI)
 *   node scripts/check-gate-probes.mjs --list           # 列出可选门禁 id
 *   node scripts/check-gate-probes.mjs --json           # 额外把报告正文打到 stdout
 * 环境变量(供测试段与编排器筛选):M2W_GATE_PROBES_ONLY / M2W_GATE_PROBES_SKIP /
 * M2W_GATE_PROBES_TIMEOUT_MS(单进程硬超时,默认 120s)/
 * M2W_GATE_PROBES_ALLOW_CONCURRENT(多会话并发写工作区时,仅把「工作树被外部改动」
 * 一项降级为 advisory,默认不设 = 严格判红)。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_IDS, GATE_META, REPORT_RELATIVE, REPORT_SCHEMA } from "./gate-probes/contract.mjs";
import { formatSummary, isReportPassing, resolveGateSelection, runGateProbes } from "./gate-probes/report.mjs";

/* ---------- 对外再导出(测试段与其它 script 的稳定入口,勿绕过本文件直接依赖 island) ---------- */

export { GATE_IDS, REPORT_RELATIVE, REPORT_SCHEMA, formatSummary, isReportPassing, resolveGateSelection, runGateProbes };
export { ROOT } from "./gate-probes/contract.mjs";

/* ---------- CLI ---------- */

/**
 * 解析 CLI 参数(极简:只认 --only/--skip/--json/--list/--help,不认未知项 ——
 * 探针脚本参数写错时必须显式失败,不能被静默忽略后按默认值跑出「假通过」)。
 * @param {string[]} argv 参数数组
 * @returns {{ gates?: string[], json: boolean, list: boolean, help: boolean }} 解析结果
 */
function parseCli(argv) {
  /** @type {{ gates?: string[], json: boolean, list: boolean, help: boolean }} */
  const options = { json: false, list: false, help: false };
  for (const token of argv) {
    if (token === "--json") options.json = true;
    else if (token === "--list") options.list = true;
    else if (token === "--help") options.help = true;
    else if (token.startsWith("--only=") || token.startsWith("--skip=")) {
      const [name, value] = token.split("=", 2);
      const ids = value.split(",").map((item) => item.trim()).filter(Boolean);
      for (const id of ids) {
        if (!GATE_IDS.includes(id)) throw new Error(`未知门禁 id「${id}」;可选:${GATE_IDS.join(",")}`);
      }
      if (name === "--only") options.gates = ids;
      else {
        const keep = (options.gates ?? [...GATE_IDS]).filter((id) => !ids.includes(id));
        options.gates = keep;
      }
    } else {
      throw new Error(`无法识别的参数:${token}(可用 --only=<id,...> --skip=<id,...> --json --list --help)`);
    }
  }
  return options;
}

/**
 * CLI 主体:跑探针 → 打印摘要 → 按判定给退出码。
 * @param {string[]} [argv] 参数数组
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = []) {
  let options;
  try {
    options = parseCli(argv);
  } catch (error) {
    console.error(`[gate-probes:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help) {
    console.log(
      [
        "用法: node scripts/check-gate-probes.mjs [选项]",
        "  --only=<id,...>  只跑选定门禁",
        "  --skip=<id,...>  跳过选定门禁",
        "  --json           额外把报告正文打到 stdout",
        "  --list           列出可选门禁 id",
        `  可选门禁: ${GATE_IDS.join(", ")}`,
        "  环境变量: M2W_GATE_PROBES_ONLY / M2W_GATE_PROBES_SKIP / M2W_GATE_PROBES_TIMEOUT_MS",
        "            M2W_GATE_PROBES_ALLOW_CONCURRENT(仅把「工作树被外部改动」降为 advisory)",
      ].join("\n"),
    );
    return 0;
  }
  if (options.list) {
    for (const id of GATE_IDS) console.log(`${id}\t${GATE_META[id].npmScript}\t${GATE_META[id].title}`);
    return 0;
  }
  /** @type {string[]} */
  let gates;
  try {
    gates = resolveGateSelection(options);
  } catch (error) {
    console.error(`[gate-probes:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const report = await runGateProbes({
    gates,
    ...(process.env.M2W_GATE_PROBES_TIMEOUT_MS === undefined
      ? {}
      : { timeoutMs: Number(process.env.M2W_GATE_PROBES_TIMEOUT_MS) }),
    writeReport: true,
  });
  console.log(formatSummary(report));
  if (options.json) console.log(JSON.stringify(report, null, 2));
  if (isReportPassing(report)) {
    console.log("[gate-probes] 全部门禁探针通过:各门禁在被破坏时确实会红");
    return 0;
  }
  console.error("[gate-probes:fail] 存在未通过的门禁探针(详见上方明细与报告)");
  return 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
