// @ts-check
/**
 * action 引用固定门禁守护段(位于 test/segments/ = 跨域守护段;被测为
 * scripts/check-pinned-actions.mjs 的判定逻辑 + 真实仓库的 workflow 事实,
 * 纯 Node 逻辑,不启 Electron):
 *
 * 为什么要有这道门禁(SHA 固定的补偿面):
 *   Dependabot 的版本更新 PR 对「固定到 40 位 commit SHA」有效,但**漏洞告警对
 *   SHA 固定无效** —— 固定后 Dependabot 不再解析 action 依赖图,被引用版本出已知
 *   漏洞时仓库收不到告警。本段守护的补偿面是「引用卫生 + 版本基线」:前者保证引用
 *   确为 40 位 SHA 且带版本注释,后者保证 SHA/版本与 scripts/pinned-actions.baseline.json
 *   一致(换 action 版本必须同 PR 改基线,升级因此在 diff 里可见、可 review)。
 *   本段**不**守护漏洞本身:那由 CI 里非阻断的 zizmor 审计承担(见 workflows),
 *   本地门禁离线可跑,不查任何漏洞库。
 *
 * 三层断言:
 * 1. 事实层(读文本,不调被测实现):真实 workflow 里每处 uses: 均为 40 位小写十六进制
 *    SHA + 「# vX.Y.Z」注释;基线登记的三个 action 与注释版本逐一对齐;门禁入口已入
 *    verify:ci 且早于 build(判定不消费 dist)。
 * 2. 判定逻辑:沙盒负向夹具逐条制造漂移(浮动 tag / 缺版本注释 / 注释与基线不符 /
 *    SHA 长度或字符集非法 / 同 action 跨文件不一致 / 一个 SHA 跨 action 复用 /
 *    未登记 action / 陈旧基线条目 / 本地 action 路径不存在 / 基线自身不合规 /
 *    扫不到任何 uses:),断言非零退出 **且** 命中对应诊断(只断言退出码会让
 *    「因错误原因失败」蒙混过关)。
 * 3. 正向锚点:同形状的合法沙盒必须零退出,证明上面的红不是「脚本跑不起来」;
 *    再叠一条「只判红不修」的反向证明(同一沙盒去掉违规行即通过)。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../common/paths.js";
import {
  BASELINE_SCHEMA,
  DEFAULT_BASELINE,
  DEFAULT_WORKFLOWS,
  SHA_RE,
  analyze,
  classifyUse,
  collectUsages,
  commentVersion,
  main as pinnedMain,
  parseBaseline,
  parseUses,
} from "../../scripts/check-pinned-actions.mjs";

const WORKFLOWS_DIR = path.join(ROOT, ...DEFAULT_WORKFLOWS.split("/"));
const BASELINE_PATH = path.join(ROOT, ...DEFAULT_BASELINE.split("/"));
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/** 沙盒基线用的两个 action(内容合法,供负向用例在其上打漂移) */
const SANDBOX_ACTIONS = {
  "actions/checkout": {
    sha: "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
    version: "v5.1.0",
  },
  "actions/setup-node": {
    sha: "a0853c24544627f65ddf259abe73b1d18a591444",
    version: "v5.0.0",
  },
};

const PINNED_LINE =
  "      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0";

/**
 * 断言辅助。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`pinned-actions 断言失败:${msg}`);
}

/**
 * 取数组第 i 项并断言存在(noUncheckedIndexedAccess 下不引入非空断言)。
 * @template T
 * @param {T[]} items 数组
 * @param {number} i 下标
 * @param {string} label 失败消息前缀
 * @returns {T} 该项
 */
function at(items, i, label) {
  const item = items[i];
  if (item === undefined) throw new Error(`pinned-actions 断言失败:${label}:第 ${i} 项缺失(实际长度 ${items.length})`);
  return item;
}

/**
 * 收窄为远程 action 引用(union 的 kind 判定集中在此,段内其余处不必重复判空)。
 * @param {ReturnType<typeof collectUsages>[number]} usage uses 事实
 * @returns {{kind: 'remote', repo: string, ref: string, file: string, line: number, value: string, comment: string}} 远程引用
 */
function asRemote(usage) {
  if (usage.kind !== "remote") {
    throw new Error(`pinned-actions 断言失败:${usage.file}:${usage.line} 应为远程 action 引用,实际 kind=${usage.kind}`);
  }
  return usage;
}
/**
 * 跑被测脚本的 CLI main():吞掉 console 输出,返回 { code, output }。
 * @param {string[]} args CLI 参数
 * @returns {Promise<{ code: unknown; output: string }>} 退出码与合并后的输出
 */
async function runCli(args) {
  /** @type {string[]} */
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...a) => lines.push(a.join(" "));
  console.error = (...a) => lines.push(a.join(" "));
  try {
    const code = await pinnedMain(args);
    return { code, output: lines.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

/**
 * 在目录下写入相对路径文件(自动建父目录)。
 * @param {string} dir 基准目录
 * @param {string} relative POSIX 风格相对路径
 * @param {string} content 文件内容
 * @returns {string} 落盘绝对路径
 */
function writeFileIn(dir, relative, content) {
  const target = path.join(dir, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

/**
 * 沙盒:一棵 workflow 目录 + 一份基线文件。
 * @param {Record<string, string>} workflows 文件名 → 内容
 * @param {unknown} baseline 基线 JSON 内容(写 null 表示不落基线文件)
 * @returns {{ dir: string; workflowsDir: string; baselineRel: string }} 沙盒路径三元组
 */
function createSandbox(workflows, baseline) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-pinned-"));
  const workflowsDir = path.join(dir, "workflows");
  for (const [name, content] of Object.entries(workflows)) {
    writeFileIn(workflowsDir, name, content);
  }
  if (baseline !== null) {
    writeFileIn(dir, "baseline.json", `${JSON.stringify(baseline, null, 2)}\n`);
  }
  return { dir, workflowsDir, baselineRel: path.join(dir, "baseline.json") };
}

/**
 * 失败路径的固定断言面:退出码 1 + 命中诊断 + 不回吐调用栈。
 * @param {{ code: unknown; output: string }} result 子进程结果
 * @param {RegExp} pattern 期望命中的诊断
 * @param {string} label 用例标签
 * @returns {void}
 */
function assertFailure(result, pattern, label) {
  assert(result.code === 1, `${label} 应以退出码 1 结束,实际 ${result.code};输出:${result.output}`);
  assert(pattern.test(result.output), `${label} 诊断未命中 ${pattern};输出:${result.output}`);
  assert(!/\n\s+at\s/.test(result.output), `${label} 诊断应已归一化,不得回吐调用栈:${result.output}`);
}

/** 合法基线文档(负向用例在其上打漂移) */
/**
 * @param {Record<string, {sha: string, version: string}>} actions action → 期望 SHA/版本
 * @returns {{baselineSchema: number, actions: Record<string, {sha: string, version: string}>}} 基线文档
 */
function goodBaseline(actions) {
  return { baselineSchema: BASELINE_SCHEMA, actions };
}

/**
 * 只登记点名 action 的基线:负向夹具各自只制造一处漂移,基线多带一个未被引用的
 * action 会额外触发「基线条目已无引用」诊断,让用例不再只命中目标漂移。
 * @param {...string} repos 要登记的 action 名
 * @returns {{baselineSchema: number, actions: Record<string, {sha: string, version: string}>}} 基线文档
 */
function baselineFor(...repos) {
  const known = /** @type {Record<string, {sha: string, version: string}>} */ (SANDBOX_ACTIONS);
  /** @type {Record<string, {sha: string, version: string}>} */
  const actions = {};
  for (const repo of repos) actions[repo] = known[repo] ?? { sha: "0".repeat(40), version: "v0.0.0" };
  return goodBaseline(actions);
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  /** @type {string[]} */
  const sandboxes = [];
  const track = (/** @type {string} */ dir) => {
    sandboxes.push(dir);
    return dir;
  };

  try {
    // ================= 1. 事实层:真实 workflow 与基线 =================
    {
      const usages = collectUsages(WORKFLOWS_DIR);
      assert(usages.length === 13, `本仓应有 13 处 uses: 引用,实际 ${usages.length} 处(新增 action 时同步更新本断言与基线)`);

      /** @type {Map<string, Set<string>>} action → 实际固定到的 SHA 集合 */
      const shasByRepo = new Map();
      for (const raw of usages) {
        const usage = asRemote(raw);
        const where = `${usage.file}:${usage.line}`;
        assert(SHA_RE.test(usage.ref), `${where} 未固定到 40 位小写十六进制 SHA,实际 ref=${usage.ref}`);
        const version = commentVersion(usage.comment);
        assert(version !== null, `${where} 缺少「# vX.Y.Z」版本注释(当前「${usage.comment}」)`);
        if (!shasByRepo.has(usage.repo)) shasByRepo.set(usage.repo, new Set());
        /** @type {Set<string>} */ (shasByRepo.get(usage.repo)).add(usage.ref);
      }
      for (const [repo, shas] of shasByRepo) {
        assert(shas.size === 1, `${repo} 被固定到 ${shas.size} 个不同 SHA(${[...shas].join(" / ")}),同一 action 必须同版本`);
      }
      assert(
        [...shasByRepo.keys()].sort().join(",") === "actions/checkout,actions/setup-node,actions/upload-artifact",
        `本仓应只用三个官方 action,实际 ${[...shasByRepo.keys()].sort().join(",")}`,
      );

      // 基线:三个 action 的 SHA 与版本注释必须逐一对齐
      const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
      const parsed = parseBaseline(baseline);
      assert(parsed.problems.length === 0, `版本基线自身应合规:${parsed.problems.join(" | ")}`);
      assert(
        Object.keys(parsed.actions).sort().join(",") === [...shasByRepo.keys()].sort().join(","),
        `基线条目应与 workflow 实际引用的 action 一一对应,基线=${Object.keys(parsed.actions).sort().join(",")}`,
      );
      for (const [repo, expected] of Object.entries(parsed.actions)) {
        const shas = shasByRepo.get(repo) ?? new Set();
        assert(shas.size > 0, `基线条目 ${repo} 在 workflow 中无引用`);
        assert(shas.has(expected.sha), `基线 ${repo}.sha=${expected.sha} 与 workflow 实际固定的 SHA 不符(${[...shas].join("/")})`);
        // 注释版本 = 基线版本:逐处核对(同一 action 在多处引用时都要一致)
        for (const raw of usages) {
          const usage = asRemote(raw);
          if (usage.repo !== repo) continue;
          assert(
            commentVersion(usage.comment) === expected.version,
            `${usage.file}:${usage.line} ${repo} 的版本注释 ${String(commentVersion(usage.comment))} 与基线 ${expected.version} 不符`,
          );
        }
      }

      // 门禁接入:脚本存在、指向正确、已入 verify:ci 且早于 build
      assert(fs.existsSync(path.join(ROOT, "scripts", "check-pinned-actions.mjs")), "缺少 scripts/check-pinned-actions.mjs");
      assert(
        PKG.scripts["check:pinned-actions"] === "node scripts/check-pinned-actions.mjs",
        `check:pinned-actions 应指向 scripts/check-pinned-actions.mjs,实际 ${String(PKG.scripts["check:pinned-actions"])}`,
      );
      const chain = PKG.scripts["verify:ci"].split("&&").map((/** @type {string} */ s) => s.trim());
      const pinnedAt = chain.indexOf("npm run check:pinned-actions");
      const buildAt = chain.indexOf("npm run build");
      assert(pinnedAt !== -1, `verify:ci 应含 check:pinned-actions,实际 ${chain.join(" -> ")}`);
      assert(pinnedAt < buildAt, `check:pinned-actions 应早于 build(判定 workflow 文本,不消费 dist),实际 ${chain.join(" -> ")}`);
      console.log("[ok] pinned-actions:事实层(13 处引用全为 40 位 SHA + 版本注释 / 基线三方对齐 / 门禁早于 build 入链)");
    }

    // ================= 2. 判定原语 =================
    {
      // uses 行抽取:带引号、不带引号、行尾注释、注释掉的示例行、列表前缀
      const parsedLines = parseUses(
        [
          "      - uses: actions/checkout@abc123 # v5.1.0",
          "      uses: 'actions/setup-node@def456'  # v5.0.0",
          '        - uses: "actions/upload-artifact@ghi789" # v5.0.0',
          "      # - uses: actions/checkout@commented # v9.9.9",
          "      run: echo not-a-uses",
        ].join("\n"),
      );
      assert(parsedLines.length === 3, `应抽到 3 处 uses:,实际 ${parsedLines.length} 处(注释行/非 uses 行不得被抽)`);
      const first = at(parsedLines, 0, "uses 抽取");
      const second = at(parsedLines, 1, "uses 抽取");
      const third = at(parsedLines, 2, "uses 抽取");
      assert(first.value === "actions/checkout@abc123" && first.comment === "v5.1.0", "不带引号 + 行尾注释解析错误");
      assert(second.value === "actions/setup-node@def456" && second.comment === "v5.0.0", "单引号取值解析错误");
      assert(third.value === "actions/upload-artifact@ghi789" && third.comment === "v5.0.0", "双引号取值解析错误");
      assert(first.line === 1 && third.line === 3, "行号定位错误");

      // 取值归类
      assert(classifyUse("./.github/workflows/ci.yml").kind === "local", "./ 开头的本地 action 应归类为 local");
      assert(classifyUse("docker://alpine:3.20").kind === "docker", "docker:// 应归类为 docker");
      assert(classifyUse("actions/checkout@v5").kind === "remote", "owner/repo@ref 应归类为 remote");
      assert(classifyUse("actions/checkout").kind === "malformed", "缺 @ 的引用应归类为 malformed");
      assert(classifyUse("@v5").kind === "malformed", "@ 前为空的引用应归类为 malformed");
      assert(classifyUse("").kind === "empty", "空取值应归类为 empty");

      // 版本注释:只认首 token 的 vX.Y.Z,其余判 null(不猜)
      assert(commentVersion("v5.1.0") === "v5.1.0", "纯版本注释应抽出版本");
      assert(commentVersion("v5.1.0 已审核") === "v5.1.0", "版本后带说明文字时取首 token");
      assert(commentVersion("5.1.0") === null, "缺 v 前缀的注释不得被猜成版本");
      assert(commentVersion("pinned") === null, "非版本注释应返回 null");
      assert(commentVersion("") === null, "空注释应返回 null");

      // analyze 纯函数:走 collectUsages 取事实(不手工拼对象,免得守护段与被测实现
      // 各写一份 uses 组装逻辑),合法沙盒零 problem
      const cleanSb = createSandbox({ "ci.yml": `${PINNED_LINE}\n` }, baselineFor("actions/checkout"));
      track(cleanSb.dir);
      const clean = analyze(collectUsages(cleanSb.workflowsDir), { actions: baselineFor("actions/checkout").actions }, { root: ROOT });
      assert(clean.problems.length === 0, `合法引用不应报 problem:${clean.problems.join(" | ")}`);
      assert(clean.stats.remote === 1 && clean.stats.local === 0, `统计口径应正确:${JSON.stringify(clean.stats)}`);
      console.log("[ok] pinned-actions:判定原语(uses 抽取 / 取值归类 / 版本注释解析 / analyze 零违规)");
    }

    // ================= 3. 沙盒负向夹具:逐条制造漂移,断言精确诊断 =================
    {
      const good = goodBaseline(SANDBOX_ACTIONS);
      /** @type {{ label: string; workflows: Record<string, string>; baseline: unknown; args?: string[]; pattern: RegExp; keepBaseline?: boolean }[]} */
      const cases = [
        {
          label: "浮动 tag 引用(@v5)",
          workflows: { "ci.yml": `${PINNED_LINE}\n      - uses: actions/checkout@v5\n` },
          baseline: good,
          pattern: /ci\.yml:2 uses: actions\/checkout@v5 —— 未固定到 40 位 commit SHA/,
        },
        {
          label: "浮动 branch 引用(@main)",
          workflows: { "ci.yml": "      - uses: actions/setup-node@main\n" },
          baseline: good,
          pattern: /未固定到 40 位 commit SHA\(当前 ref=main\)/,
        },
        {
          label: "SHA 长度不足(短 SHA)",
          workflows: { "ci.yml": "      - uses: actions/checkout@fbc6f39 # v5.1.0\n" },
          baseline: good,
          pattern: /未固定到 40 位 commit SHA\(当前 ref=fbc6f39\)/,
        },
        {
          label: "SHA 含非十六进制字符",
          workflows: { "ci.yml": `      - uses: actions/checkout@${"z".repeat(40)} # v5.1.0\n` },
          baseline: good,
          pattern: /未固定到 40 位 commit SHA/,
        },
        {
          label: "SHA 用大写十六进制(GitHub 不认的 ref 写法)",
          workflows: { "ci.yml": `      - uses: actions/checkout@${SANDBOX_ACTIONS["actions/checkout"].sha.toUpperCase()} # v5.1.0\n` },
          baseline: good,
          pattern: /未固定到 40 位 commit SHA/,
        },
        {
          label: "缺版本注释",
          workflows: { "ci.yml": `      - uses: actions/checkout@${SANDBOX_ACTIONS["actions/checkout"].sha}\n` },
          baseline: good,
          pattern: /缺少「# vX\.Y\.Z」版本注释/,
        },
        {
          label: "版本注释非版本号(注释在但不说明版本)",
          workflows: { "ci.yml": `      - uses: actions/checkout@${SANDBOX_ACTIONS["actions/checkout"].sha} # pinned\n` },
          baseline: good,
          pattern: /缺少「# vX\.Y\.Z」版本注释/,
        },
        {
          label: "注释版本与基线不符(SHA 对、版本错)",
          workflows: { "ci.yml": `      - uses: actions/checkout@${SANDBOX_ACTIONS["actions/checkout"].sha} # v9.9.9\n` },
          baseline: good,
          pattern: /actions\/checkout 的版本注释与基线不符\(当前 v9\.9\.9,基线 v5\.1\.0\)/,
        },
        {
          label: "SHA 与基线不符(偷偷换 action 版本)",
          workflows: {
            "ci.yml": `      - uses: actions/checkout@${"1".repeat(40)} # v5.1.0\n`,
          },
          baseline: good,
          pattern: /actions\/checkout 的 SHA 与基线不符/,
        },
        {
          label: "引用了未登记在基线的 action",
          workflows: { "ci.yml": "      - uses: actions/cache@0123456789abcdef0123456789abcdef01234567 # v4.2.0\n" },
          baseline: good,
          pattern: /actions\/cache 未登记在版本基线内/,
        },
        {
          label: "同一 action 在不同 workflow 固定到不同 SHA",
          workflows: {
            "ci.yml": PINNED_LINE + "\n",
            "release.yml": `      - uses: actions/checkout@${"2".repeat(40)} # v5.1.0\n`,
          },
          baseline: good,
          pattern: /action actions\/checkout 被固定到多个不同 SHA/,
        },
        {
          label: "同一个 SHA 被两个不同 action 复用(复制粘贴错)",
          workflows: {
            "ci.yml": PINNED_LINE + "\n",
            "release.yml": `      - uses: actions/setup-node@${SANDBOX_ACTIONS["actions/checkout"].sha} # v5.0.0\n`,
          },
          baseline: good,
          pattern: /SHA fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 被 actions\/checkout、actions\/setup-node 共同使用/,
        },
        {
          label: "陈旧基线条目(action 已删、基线没删)",
          workflows: { "ci.yml": `${PINNED_LINE}\n` },
          baseline: goodBaseline({ ...SANDBOX_ACTIONS, "actions/upload-artifact": { sha: "3".repeat(40), version: "v5.0.0" } }),
          keepBaseline: true,
          pattern: /基线条目 actions\/setup-node 已无任何 workflow 引用/,
        },
        {
          label: "本地 action 路径不存在",
          workflows: { "ci.yml": "      - uses: ./.github/workflows/ghost.yml\n" },
          baseline: goodBaseline({}),
          pattern: /本地 action 路径不存在/,
        },
        {
          label: "引用形态非法(缺 @)",
          workflows: { "ci.yml": "      - uses: actions/checkout\n" },
          baseline: goodBaseline({}),
          pattern: /引用形态非法\(应为 owner\/repo@ref\)/,
        },
        {
          label: "基线 schema 版本不对",
          workflows: { "ci.yml": `${PINNED_LINE}\n` },
          baseline: { baselineSchema: 99, actions: SANDBOX_ACTIONS },
          pattern: /baselineSchema 必须是 1/,
        },
        {
          label: "基线条目 SHA 格式非法",
          workflows: { "ci.yml": `${PINNED_LINE}\n` },
          baseline: goodBaseline({ "actions/checkout": { sha: "abc", version: "v5.1.0" } }),
          pattern: /基线条目 actions\/checkout 的 sha 必须是 40 位小写十六进制/,
        },
        {
          label: "基线文件不可解析",
          workflows: { "ci.yml": `${PINNED_LINE}\n` },
          baseline: null,
          args: ["--baseline", "missing-baseline.json"],
          pattern: /版本基线文件不存在/,
        },
        {
          label: "workflow 目录不存在(门禁无事可判会报绿假象)",
          workflows: { "ci.yml": `${PINNED_LINE}\n` },
          baseline: good,
          args: ["--workflows", "no-such-dir"],
          pattern: /workflow 目录不存在/,
        },
        {
          label: "目录里扫不到任何 uses:(正则/目录失效防空过)",
          workflows: { "ci.yml": "name: CI\non: push\njobs: {}\n" },
          baseline: good,
          pattern: /未扫到任何 uses: 引用/,
        },
        {
          label: "未知选项(不留隐式默认扫描范围)",
          workflows: { "ci.yml": `${PINNED_LINE}\n` },
          baseline: good,
          args: ["--scan", "src"],
          pattern: /无法识别的选项:--scan/,
        },
      ];

      for (const item of cases) {
        // 基线默认裁剪到「夹具里真实出现的 action」:多带一个未被引用的 action 会
        // 额外触发「基线条目已无引用」,让用例不再只命中目标漂移(陈旧条目用例
        // 用 keepBaseline 关掉裁剪 —— 它的目标漂移正是未被引用的基线条目)
        const referenced = new Set();
        for (const content of Object.values(item.workflows)) {
          for (const entry of parseUses(content)) {
            const kind = classifyUse(entry.value);
            if (kind.kind === "remote") referenced.add(kind.repo);
          }
        }
        const doc = /** @type {{actions: Record<string, unknown>}|null} */ (item.baseline);
        const actions = doc === null
          ? null
          : item.keepBaseline === true
            ? doc.actions
            : Object.fromEntries(Object.entries(doc.actions).filter(([repo]) => referenced.has(repo)));
        const sb = createSandbox(item.workflows, doc === null ? null : { ...doc, actions });
        track(sb.dir);
        const args = ["--workflows", sb.workflowsDir];
        if (item.args === undefined) {
          args.push("--baseline", sb.baselineRel);
        } else {
          args.push(...item.args);
        }
        const result = await runCli(args);
        assertFailure(result, item.pattern, item.label);
      }
      console.log(`[ok] pinned-actions:${cases.length} 类漂移夹具全部非零退出且命中各自诊断`);
    }

    // ================= 4. 正向锚点:夹具通路有效(否则上面的红可能只是「跑不起来」) =================
    {
      // 4a. 同形状的合法沙盒(含两 workflow 复用同一 action、本地 action 真实存在、容器引用)→ 零退出
      // 本地 action 的存在性按仓库根解析(main 的 root 固定为仓库根),故引用真实存在的
      // .github/workflows/ci.yml 而非沙盒内的同名文件
      const sb = createSandbox(
        {
          "ci.yml": [
            "name: CI",
            "      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0",
            "      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0",
            "      - uses: docker://alpine:3.20",
            "      - uses: ./.github/workflows/ci.yml",
            "      # - uses: actions/checkout@commented # v9.9.9",
          ].join("\n"),
          "release.yml": "      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0\n",
        },
        goodBaseline(SANDBOX_ACTIONS),
      );
      track(sb.dir);
      const ok = await runCli(["--workflows", sb.workflowsDir, "--baseline", sb.baselineRel]);
      assert(ok.code === 0, `合法沙盒应零退出,实际 ${ok.code}:${ok.output}`);
      assert(!ok.output.includes("[pinned-actions:fail]"), `合法沙盒不得有 fail 行:${ok.output}`);
      assert(ok.output.includes("action 引用固定自检通过"), `合法沙盒应给出通过结论:${ok.output}`);

      // 4b. 同一沙盒只删掉版本注释 → 立刻判红(证明通过不是因为规则没生效)
      const broken = createSandbox(
        {
          "ci.yml": [
            "      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
            "      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0",
            "      - uses: docker://alpine:3.20",
            "      - uses: ./.github/workflows/ci.yml",
          ].join("\n"),
        },
        goodBaseline(SANDBOX_ACTIONS),
      );
      track(broken.dir);
      const red = await runCli(["--workflows", broken.workflowsDir, "--baseline", broken.baselineRel]);
      assertFailure(red, /缺少「# vX\.Y\.Z」版本注释/, "合法沙盒去掉版本注释");

      // 4c. --no-baseline:只做引用卫生,基线不符不再判红(但非法 SHA 仍判红)
      const noBaseline = createSandbox(
        {
          "ci.yml": [
            "      - uses: actions/checkout@1111111111111111111111111111111111111111 # v5.1.0",
            "      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0",
          ].join("\n"),
        },
        goodBaseline(SANDBOX_ACTIONS),
      );
      track(noBaseline.dir);
      const relaxed = await runCli(["--workflows", noBaseline.workflowsDir, "--no-baseline"]);
      assert(relaxed.code === 0, `--no-baseline 下基线漂移不应判红,实际 ${relaxed.code}:${relaxed.output}`);
      assert(relaxed.output.includes("基线比对已关闭"), `--no-baseline 应显式提示基线已关闭:${relaxed.output}`);

      // 4d. --help 零退出且不判红
      const help = await runCli(["--help"]);
      assert(help.code === 0, `--help 应零退出,实际 ${help.code}:${help.output}`);
      assert(help.output.includes("--baseline"), `--help 应列出 --baseline:${help.output}`);
      console.log("[ok] pinned-actions:正向锚点(合法沙盒零退出 / 去注释即判红 / --no-baseline 只收窄到引用卫生 / --help)");
    }

    // ================= 5. 真实仓库上的 CLI 复跑(门禁自身可运行) =================
    {
      const real = await runCli([]);
      assert(real.code === 0, `真实仓库应通过自建门禁,实际 ${real.code}:${real.output}`);
      assert(real.output.includes("13 处 uses"), `真实仓库应报出 13 处引用:${real.output}`);
      const relaxedReal = await runCli(["--no-baseline"]);
      assert(relaxedReal.code === 0, `真实仓库 --no-baseline 应通过,实际 ${relaxedReal.code}:${relaxedReal.output}`);
      console.log("[ok] pinned-actions:真实仓库 CLI 复跑通过(13 处引用 / 基线一致)");
    }
  } finally {
    for (const dir of sandboxes) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}
