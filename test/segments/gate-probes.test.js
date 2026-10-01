// @ts-check
/**
 * 门禁故意失败探针段(位于 test/segments/ = 跨域守护段;被测为 gates/probe/check-gate-probes.mjs
 * 所探测的各道门禁本身,而非任何业务能力):
 *
 * 为什么要有这一段:仓库的 coverage 阈值、fixtures 漂移、构建新鲜度、dist 清单、smoke
 * 冒烟都是「正常路径绿、坏路径红」的门禁。此前没有任何东西验证过它们**坏的时候真的会红**
 * —— 若某道门禁因脚本失效、正则写错、配置项丢失而空过,测试链不会发现(所有门禁的正常
 * 路径本来就都是绿的,没人去看它们会不会红)。本段把每道门禁的「正向锚点 + 负向故障」结果
 * 登记为具名 case:门禁空过、诊断指不到具体内容、或沙箱纪律被破坏,都会在本段判红。
 *
 * 判定纪律(勿放宽):
 * - 每道门禁必须有 exit 0 的正向锚点(防「脚本没跑起来也报绿」),以及 exit 非 0 且命中
 *   具体诊断关键字的负向探针(只看退出码会让「因错误原因失败」蒙混过关);
 * - 锚点不绿 = 沙盒不可信,负向结论不成立 → 判红并写明不可信原因;
 * - 真实工作树零注入:探针只在系统临时目录的工程副本里注入故障,并断言真实
 *   src/test/dist/gates/build/dev/output/package*.json 指纹未变、node_modules 哨兵完好。
 *
 * 本段刻意不实现第二套判定逻辑(避免两套口径漂移):判定、报告与摘要全部由
 * gates/probe/check-gate-probes.mjs 单源产出,本段只做 case 化呈现与门禁级断言。
 *
 * 筛选(与探针脚本同一条口径,便于开发迭代提速):M2W_GATE_PROBES_ONLY=fixtures,dist-manifest
 * 只跑指定门禁;M2W_GATE_PROBES_SKIP=smoke 跳过冒烟(它会在沙盒里真启一次 Electron)。
 * 全量耗时以几十秒计(一次工程副本复制 + 一次沙盒内构建 + 两次冒烟启动 + 双管线矩阵段
 * 三遍 Electron 启动 + 若干 c8 运行),在段默认硬超时内,无需额外调参。
 * 多 agent 并发写同一工作区时,工作树指纹项会因外部改动误判红;此时可显式设
 * M2W_GATE_PROBES_ALLOW_CONCURRENT=1 把该项降级为 advisory(变化文件照实登记,
 * 门禁判定不受影响)。默认不设 = 严格判红。
 */
import fs from "node:fs";
import path from "node:path";
import { REPORT_RELATIVE, formatSummary, isReportPassing, resolveGateSelection, runGateProbes } from "../../gates/probe/check-gate-probes.mjs";
import { createCaseSuite } from "../common/case.js";
import { ROOT } from "../common/paths.js";

/* ---- 「报告不含绝对路径」判据(纯函数,判据面与呈现面分开)---- */

/**
 * URL 片段(`scheme://…`):含 `/`,但它不是本机路径,判红即误伤。
 *
 * 为什么必须先摘掉再判 —— 实测:摘掉与否,`https://registry.npmjs.org/npm` 的判定结果不同,
 * 且**两条形态都中招**:`scheme:` 的末字母 + `:` 正好构成盘符形态(`s:/`),而 `//` 之后
 * 紧跟的 host 首段又落在 POSIX 形态的 token 起点上。不摘就是三条必红的假阳性。
 * `file:///tmp/…`(三斜杠)、`--registry=https://a.b/c`(前缀夹带)同理,均有负向夹具钉住。
 */
const URL_FRAGMENT_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`)\]},;]*/g;

/** Windows 盘符形态(`C:\…` / `c:/…`)—— 原有判据,只匹配盘符这一个切面 */
const WINDOWS_ABSOLUTE_RE = /[A-Za-z]:[\\/]/;

/**
 * POSIX 绝对路径形态:`/` 落在 token 起点(串首,或空白 / 引号 / 括号 / 逗号 / 分号 / `:` / `=`
 * 之后),且紧随一个非空白字符。
 *
 * 三个细节都是实测出来的,收窄或放宽任一条都会让判据重新漏人或重新误伤:
 *   - `token 起点`限定:否则 `dist/renderer/index.html`、`evidence/INDEX.md` 这类仓库相对
 *     路径(报告里到处都是)全部判红,判据当场失去可用性;
 *   - `(?!\/)`:否则 `//` 判红;
 *   - `\S`:否则中文句子里当分隔号用的「自检脚本 / 验收段」判红。
 *
 * **日期形态(`2026/10/01`)是被这一条排除的,不另设掩码**:日期的每个 `/` 前面都是数字段,
 * 而数字不在上面的起点字符集里 ⇒ 三个日期形态实测均不命中(裸形态、带时间、夹在中文句中)。
 * 曾试过加一条日期掩码,实测它对判定结果**无任何影响**(掩码摘掉的文本本来就不命中),
 * 留着只会让下一个人误以为日期是靠那条掩码挡住的、进而放松起点限定 —— 故按「恒真断言等于
 * 没有断言」删掉。日期的排除力由下面三条负向夹具钉住(把起点限定放宽成「含 `/` 即判红」时
 * 它们立刻变红)。
 */
const POSIX_ABSOLUTE_RE = /(?:^|[\s"'`([{,;:=])\/(?!\/)\S/;

/**
 * 一段文本里是否含绝对路径(Windows 盘符形态或 POSIX 形态)。
 *
 * URL 先摘除、POSIX 判据认起点,两头收住两类「含 `/` 却不是路径」的形态 —— 这是本判据
 * 精确性的关键:上一版只认盘符,于是 POSIX 绝对路径(`/home/runner/…`,Linux CI 上最常见的
 * 形态)整条漏掉,该判据只在 Windows 上有效;而直接补一条「含 `/` 即判红」又会把 URL 与日期
 * 一起误伤。两类误报形态各有负向夹具(见 run() 内的判据面夹具组),删掉任一处收紧即变红。
 * @param {string} text 已解码的单个字符串(键或值)
 * @returns {boolean} true = 含绝对路径
 */
export function containsAbsolutePath(text) {
  const masked = text.replace(URL_FRAGMENT_RE, " ");
  return WINDOWS_ABSOLUTE_RE.test(masked) || POSIX_ABSOLUTE_RE.test(masked);
}

/**
 * 在已解码的字符串集合里找第一条含绝对路径的。
 * @param {string[]} decoded 已解码的字符串(键与值都收)
 * @returns {string | undefined} 命中的字符串(undefined = 干净)
 */
export function findAbsolutePath(decoded) {
  return decoded.find((s) => containsAbsolutePath(s));
}

/**
 * 门禁 id → case 名前缀(报告与 case 名对齐,失败时一眼定位)。
 * @type {Record<string, string>}
 */
const GATE_LABELS = {
  fixtures: "fixtures 漂移",
  coverage: "coverage 阈值",
  "dist-manifest": "dist 清单",
  "dual-matrix": "双管线矩阵键覆盖",
  "build-fresh": "构建新鲜度",
  smoke: "smoke 冒烟",
};

/**
 * 探针类别 → case 名里的中文标签。
 * @type {Record<string, string>}
 */
const KIND_LABELS = { anchor: "锚点", fault: "负向", blindspot: "盲区观测" };

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头):本段断言的是门禁
// 自身的行为,产物是机器可读报告,不是可供 GUI 拖入实测的 md 样例。
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  const gates = resolveGateSelection();
  const report = await runGateProbes({
    gates,
    writeReport: true,
    log: (line) => console.log(line),
  });

  console.log(formatSummary(report));

  await suite.describe("门禁探针", async () => {
    for (const gate of report.gates) {
      const label = GATE_LABELS[gate.id] ?? gate.id;
      await suite.case(`${label}:全程沙盒内完成(真实工作树零注入)`, () => {
        if (!gate.sandboxed) throw new Error(`${gate.id} 未在沙盒内完成,门禁探针不得在真实工作树上注入故障`);
      });
      for (const probeCase of gate.cases) {
        const kindLabel = KIND_LABELS[probeCase.kind] ?? probeCase.kind;
        await suite.case(`${label}:${kindLabel} ${probeCase.id}`, () => {
          if (probeCase.informational === true) {
            // 盲区观测不参与门禁判定,但观测结论必须留痕(不得静默吞掉)
            if (probeCase.note === undefined || probeCase.note === "") {
              throw new Error(`${gate.id}/${probeCase.id} 是盲区观测,必须留下观测结论(不能只跑不留痕)`);
            }
            console.log(`  [blindspot] ${gate.id}/${probeCase.id}: ${probeCase.note}`);
            return;
          }
          /** @type {string[]} */
          const problems = [];
          if (!probeCase.ok) {
            const expected = probeCase.expect === "zero" ? "exit 0" : "exit 非 0";
            problems.push(`退出码 ${String(probeCase.exitCode)}(期望 ${expected}${probeCase.timedOut ? ";由硬超时触发" : ""})`);
          }
          if (probeCase.missingKeywords.length > 0) {
            problems.push(`诊断未命中关键字:${probeCase.missingKeywords.join(" / ")}`);
          }
          if (probeCase.forbiddenHits.length > 0) {
            problems.push(`诊断出现了不该出现的关键字:${probeCase.forbiddenHits.join(" / ")}`);
          }
          if (problems.length > 0) {
            throw new Error(
              `${gate.id}/${probeCase.id}(${probeCase.description})未达预期:${problems.join(";")}` +
                `${probeCase.note === undefined || probeCase.note === "" ? "" : ` | ${probeCase.note}`}`,
            );
          }
        });
      }
      await suite.case(`${label}:门禁判定为 pass`, () => {
        if (gate.verdict === "pass") return;
        const failed = gate.cases.filter((c) => c.informational !== true && !c.ok).map((c) => c.id);
        throw new Error(
          `${gate.id}(${gate.npmScript})探针未通过:${failed.join(",")}` +
            " —— 门禁在被破坏时没变红,或正向锚点不绿导致负向结论不成立(不得改探针掩盖空过)",
        );
      });
    }

    await suite.case("真实工作树指纹未变(沙箱纪律)", () => {
      // node_modules 哨兵任何模式下都必须完好:那是探针自身最危险的动作(摘联接)的后果面
      if (!report.protectedTree.nodeModulesIntact) {
        throw new Error("node_modules 哨兵变化(疑似误删真实依赖)");
      }
      if (report.protectedTree.unchanged) return;
      if (report.protectedTree.tolerance !== "concurrent") {
        throw new Error(`探针期间真实工作树被改动:${report.protectedTree.changedPaths.join(",")}`);
      }
      // 并发容忍模式:不要求未变,但变化必须在报告里留痕(不得静默放过)
      const noted = report.findings.some((finding) => finding.id === "protected-tree-changed-concurrent");
      if (!noted) throw new Error("并发容忍模式下工作树有变化,报告里却没有对应登记项");
      console.log(
        `  [concurrent] 工作树被外部改动(已在报告登记 ${report.protectedTree.changedFiles.length} 个文件):` +
          `${report.protectedTree.changedFiles.slice(0, 5).join(",")}`,
      );
    });

    await suite.case("无 blocking 级登记项", () => {
      const blocking = report.findings.filter((finding) => finding.severity === "blocking");
      if (blocking.length > 0) {
        throw new Error(blocking.map((finding) => `${finding.id}:${finding.summary}`).join(";"));
      }
    });

    await suite.case("报告已落盘且可跨机比对(无时间戳/绝对路径)", () => {
      const reportPath = path.join(ROOT, REPORT_RELATIVE);
      if (!fs.existsSync(reportPath)) throw new Error(`报告未落盘:${REPORT_RELATIVE}`);
      const text = fs.readFileSync(reportPath, "utf8");
      const parsed = JSON.parse(text);
      if (parsed.schema !== "m2w/gate-probes@1") throw new Error(`报告 schema 不符:${String(parsed.schema)}`);
      if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) throw new Error("报告含时间戳,不可复现");
      // 绝对路径只认**解码后**的字符串(键与值都扫)。裸文本匹配会把 JSON 转义误当盘符:
      // `load:"static"` 序列化成 `load:\"static\"` 后含 `d:\`,与 `C:\` 同形却不是路径。
      const decoded = [];
      (function collect(v) {
        if (typeof v === "string") decoded.push(v);
        else if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === "object") for (const k of Object.keys(v)) { decoded.push(k); collect(v[k]); }
      })(parsed);
      const absolute = findAbsolutePath(decoded);
      if (absolute !== undefined) throw new Error(`报告含绝对路径,不可跨机比对:${absolute.slice(0, 80)}`);
      if (!Array.isArray(parsed.gates) || parsed.gates.length !== report.gates.length) {
        throw new Error("报告里的门禁条目数与本次运行不一致");
      }
    });
  });

  // 判据面自身的夹具组:本段对报告的「无绝对路径」判据是本仓唯一实现,若它退化成恒绿
  // (比如有人把 POSIX 形态整条删掉、或把起点限定放宽成「含 / 即判红」),**报告本身干净时
  // 不会有任何症状** —— 上面的 case 只会继续绿。故判据必须在自己的组里被正负夹具钉住。
  await suite.describe("报告绝对路径判据(判据面自身的正负夹具)", async () => {
    /** @type {{ why: string, text: string, hit: boolean }[]} */
    const FIXTURES = [
      // 正向:两种绝对路径形态都判红(盘符是原有切面,POSIX 是本轮补的那一面)
      { why: "Windows 盘符形态", text: "C:\\Users\\chenc\\docs\\notes.md", hit: true },
      { why: "Windows 盘符形态(正斜杠)", text: "载体:C:/Users/chenc/.config/opencode/tools/check-pointers.mjs", hit: true },
      { why: "POSIX 绝对路径(Linux CI 的检出目录)", text: "/home/runner/work/markdown-to-word/gates", hit: true },
      { why: "POSIX 绝对路径夹在句中", text: "报告路径 /var/folders/zz/T/report.json 已落盘", hit: true },
      { why: "POSIX 绝对路径紧跟冒号", text: "沙盒:/tmp/m2w-probe/report.json", hit: true },
      { why: "路径里恰好有一段日期(日期摘除不得吃掉前导斜杠)", text: "/var/log/2026/10/01/run.log", hit: true },
      // 负向:URL —— 含 `/` 但不是本机路径
      { why: "URL(https)", text: "https://registry.npmjs.org/npm", hit: false },
      { why: "URL(带 = 前缀)", text: "--registry=https://registry.npmjs.org/npm", hit: false },
      { why: "URL(file:// 三斜杠)", text: "file:///tmp/gate-probes/report.json", hit: false },
      { why: "URL(夹在句中,后面还有真相对路径)", text: "见 https://example.com/x 与 dist/renderer/index.html", hit: false },
      // 负向:日期形态
      { why: "日期形态(裸)", text: "2026/10/01", hit: false },
      { why: "日期形态(夹在句中)", text: "基线更新于 2026/10/01 的实测值", hit: false },
      { why: "日期形态(带时间)", text: "2026/10/01T09:30 那一版", hit: false },
      { why: "日期形态(多个日期并列)", text: "见 2026/10/01 与 2026/11/02 两条记录", hit: false },
      // 负向:仓库相对路径与「当分隔号用的斜杠」—— 上一版按盘符匹配时天然不碰,
      // 补 POSIX 形态后它们是最大的误伤面,必须逐条钉住
      { why: "仓库相对路径", text: "dist/renderer/index.html", hit: false },
      { why: "仓库相对路径(gates 树)", text: "gates/probe/gate-probes/registry.mjs", hit: false },
      { why: "中文句里的分隔斜杠", text: "把探针指向一个不存在的自检脚本 / 验收段", hit: false },
      { why: "覆盖率分数(斜杠两侧是数字)", text: "statements 0/186, functions 0/1", hit: false },
      { why: "段数比", text: "1/1 段失败", hit: false },
      { why: "c8 参数向量", text: "--include=dist/**", hit: false },
      { why: "冒号后接相对路径(不是绝对路径)", text: "未破坏:acceptance/ 与段导出重新生成的内容一致", hit: false },
    ];
    for (const { why, text, hit } of FIXTURES) {
      await suite.case(`${hit ? "正向" : "负向"}:${why}`, () => {
        const got = containsAbsolutePath(text);
        if (got === hit) return;
        throw new Error(
          `判据与预期不符:期望 ${hit ? "判红" : "不误伤"},实际 ${got ? "判红" : "放过"}。样本:${text}`,
        );
      });
    }
    // 夹具组自身的完整性:三类形态(Windows / POSIX / URL / 日期)各须至少有一条,否则
    // 有人整类删掉夹具时本组仍绿(夹具数量是唯一线索,判红必须靠内容而不是靠数量)。
    await suite.case("夹具覆盖两类绝对路径与两类误报形态", () => {
      const positives = FIXTURES.filter((f) => f.hit);
      const negatives = FIXTURES.filter((f) => !f.hit);
      const missing = [];
      if (!positives.some((f) => /[A-Za-z]:[\\/]/.test(f.text))) missing.push("Windows 盘符形态缺正向夹具");
      if (!positives.some((f) => f.text.includes("/") && !/[A-Za-z]:[\\/]/.test(f.text))) missing.push("POSIX 形态缺正向夹具");
      if (!negatives.some((f) => f.text.includes("://"))) missing.push("URL 形态缺负向夹具");
      if (!negatives.some((f) => /\d{4}\/\d{2}\/\d{2}/.test(f.text))) missing.push("日期形态缺负向夹具");
      if (missing.length > 0) throw new Error(missing.join(";"));
    });
  });

  // advisory 级登记项(盲区/边界)不参与判定,但必须显式留痕,不得静默吞掉
  for (const finding of report.findings) {
    if (finding.severity === "blocking") continue;
    console.log(`  [warn] ${finding.id}: ${finding.summary} —— ${finding.evidence}`);
  }

  if (!isReportPassing(report)) {
    throw new Error(`门禁探针报告整体判定未通过(详见摘要与报告:${REPORT_RELATIVE})`);
  }
  console.log(
    `[ok] gate-probes:${report.summary.gates} 道门禁 / ${report.summary.cases} 项探针全部符合预期` +
      `(advisory 登记 ${report.findings.length} 项;报告:${REPORT_RELATIVE})`,
  );
  return { cases: suite.results };
}
