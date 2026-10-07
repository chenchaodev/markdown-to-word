// @ts-check
/**
 * SCA 门禁段(位于 test/gates/supply/supply/ = 镜像 gates/supply/supply/sca-audit.mjs,
 * 纯 Node 逻辑,不经 dist 编译产物):npm audit(npmmirror 端点)两棵依赖树 + OSV 替代源。
 * - 真实漏洞判红、扫描源不可用判 unavailable(绝不冒充「无漏洞」)、production/dev 区分
 * - dev-only 包泄漏进生产树 pass 时不误判为发布风险,且口径分歧留痕
 * - 缺输入/错参数 → 非零退出且文案可操作;零扫描源也必须判红(不得当成通过)
 * - 严重度换算与 audit 计划编排(纯函数)
 *
 * 断言方式:临时目录里造沙盒 lockfile,注入假的 npm transport 与 OSV fetch(依赖注入
 * 换来的确定性),断言返回的退出码 **与具体诊断文案**(只看退出码会让「因错误原因失败」
 * 的检查蒙混过关)。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAsserter } from "../../../harness/assert.js";
import { createCaseSuite } from "../../../harness/case.js";
import { ROOT } from "../../../harness/paths.js";
import { removeTree } from "../../../harness/temp-resource.js";
import {
  STATUS_OK as SCA_OK,
  STATUS_UNAVAILABLE,
  buildAuditPlan,
  compareSemver,
  formatScaLog,
  parseAuditPayload,
  runScaScan,
} from "../../../../gates/supply/supply/sca-audit.mjs";
import {
  classifyLicense,
  cvss3BaseScore,
  severityFromScore,
} from "../../../../gates/supply/supply/supply-common.mjs";

const suite = createCaseSuite();

const { assert } = createAsserter("sca-audit");

/**
 * 临时目录 + 兜底清理(测试对象是夹具,finally 保证不留残留)。
 * 清理走 removeTree(带 EBUSY/EPERM 退避重试与删后复查);删不掉仍即抛 ——
 * 「删不掉就抛」是本段原有的失败语义,助手只负责吸收 Windows 上的瞬时占用。
 * @param {(dir: string) => unknown} fn 在临时目录上执行的夹具逻辑
 * @returns {Promise<unknown>} fn 的返回值(透传)
 */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-sca-"));
  try {
    return await fn(dir);
  } finally {
    const outcome = removeTree(dir);
    if (!outcome.ok) throw new Error(`临时目录清理失败:${dir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
  }
}

/**
 * 造一份沙盒 lockfile。刻意做成「有生产依赖、有仅 dev 依赖、有嵌套依赖、有缺许可证
 * 的包」,这样 production/dev 判定、copyleft 分类、未知许可证三条都能在同一份夹具上验证。
 * @param {string} dir 沙盒目录
 * @param {{ noLicense?: boolean }} [options] 夹具开关
 * @returns {string} lockfile 绝对路径
 */
function makeLockfile(dir, options = {}) {
  /** @type {Record<string, any>} */
  const packages = {
    "": {
      name: "sandbox-app",
      version: "1.0.0",
      license: "MIT",
      dependencies: { "prod-lib": "^1.0.0", "mixed-lib": "^1.0.0" },
      devDependencies: { "dev-tool": "^2.0.0" },
    },
    "node_modules/prod-lib": { version: "1.0.2", resolved: "https://registry.npmmirror.com/prod-lib/-/prod-lib-1.0.2.tgz", integrity: "sha512-aaa", license: "MIT" },
    "node_modules/mixed-lib": { version: "1.0.0", license: "MIT", dependencies: { "inner-lib": "^1.0.0" } },
    "node_modules/mixed-lib/node_modules/inner-lib": { version: "1.0.1", license: "LGPL-3.0-or-later" },
    "node_modules/dev-tool": { version: "2.0.0", dev: true, license: "GPL-3.0-or-later" },
    "node_modules/inner-lib": { version: "1.0.0", license: "Apache-2.0" },
  };
  if (options.noLicense !== false) {
    packages["node_modules/no-license"] = { version: "0.1.0" };
    packages[""].dependencies = { ...packages[""].dependencies, "no-license": "^0.1.0" };
  }
  const lockPath = path.join(dir, "package-lock.json");
  fs.writeFileSync(lockPath, `${JSON.stringify({ name: "sandbox-app", version: "1.0.0", lockfileVersion: 3, requires: true, packages }, null, 2)}\n`, "utf8");
  return lockPath;
}

/**
 * 假的 npm transport:按 args 里的 --omit=dev 区分两棵树,并回放预置的 audit JSON。
 * 同时把每次调用的命令与参数记进 calls,供「两棵树确实分别跑了」断言。
 * @param {Record<string, { stdout: string; stderr?: string; exitCode?: number; timedOut?: boolean }>} byTree 两棵树的回放内容
 * @returns {{ transport: (command: string, args: string[], options?: unknown) => Promise<any>; calls: { command: string; args: string[]; line: string }[] }} 注入件
 */
function fakeNpm(byTree) {
  /** @type {{ command: string; args: string[]; line: string }[]} */
  const calls = [];
  const transport = async (/** @type {string} */ command, /** @type {string[]} */ args) => {
    calls.push({ command, args, line: [command, ...args].join(" ") });
    const tree = args.join(" ").includes("--omit=dev") ? "production" : "all";
    const preset = byTree[tree] ?? { stdout: JSON.stringify({ metadata: { vulnerabilities: {} }, vulnerabilities: {} }), exitCode: 0 };
    return {
      ok: preset.exitCode === 0 && preset.timedOut !== true,
      exitCode: preset.exitCode ?? 0,
      signal: null,
      stdout: preset.stdout,
      stderr: preset.stderr ?? "",
      timedOut: preset.timedOut ?? false,
      timeoutMs: 0,
      spawnError: null,
    };
  };
  return { transport, calls };
}

/** 真实形状的 audit JSON:发现一个 high 漏洞(取自 npm audit 实际输出结构) */
function auditJsonWithVuln(/** @type {string} */ name, /** @type {string} */ severity) {
  return JSON.stringify({
    auditReportVersion: 2,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    vulnerabilities: {
      [name]: {
        name,
        severity,
        isDirect: true,
        via: [{ source: 1102341, name, dependency: name, title: "Prototype Pollution in " + name, url: "https://github.com/advisories/GHSA-test-0000-0000", severity }],
        effects: [],
        nodes: ["node_modules/" + name],
        fixAvailable: { name, version: "1.0.3" },
      },
    },
  });
}

/** npmmirror audit 端点不可用的真实响应(npm 打到 stdout 的那段 JSON) */
const MIRROR_AUDIT_UNAVAILABLE = {
  stdout: JSON.stringify({
    message: "404 Not Found - POST https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk - [NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet",
    method: "POST",
    uri: "https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk",
    statusCode: 404,
    body: { error: "[NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet" },
    error: { summary: "", detail: "" },
  }),
  stderr: "npm warn audit 404 Not Found - POST https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk - [NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet\nnpm error audit endpoint returned an error",
  exitCode: 1,
};

/**
 * 假的 OSV fetch:两阶段(querybatch → 只给 id;v1/vulns/:id → 详情)。
 * 形状与 check-supply-chain 段的桩保持一致(包名 → 公告数组),避免两处桩各说各话。
 * @param {Record<string, { id: string }[]>} hits 包名 → 命中的公告
 * @returns {typeof fetch} 注入件
 */
function fakeOsv(hits) {
  const impl = async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    const body = JSON.parse(String(init.body ?? "{}"));
    if (url.endsWith("/v1/querybatch")) {
      const results = body.queries.map((/** @type {{ package: { name: string } }} */ query) => {
        const hit = hits[query.package.name];
        return { vulns: (hit ?? []).map((vuln) => ({ id: vuln.id, modified: "2026-01-01T00:00:00Z" })) };
      });
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    const match = /\/v1\/vulns\/(.+)$/.exec(url);
    if (match !== null) {
      const id = decodeURIComponent(match[1] ?? "");
      for (const vulns of Object.values(hits)) {
        const found = vulns.find((vuln) => vuln.id === id);
        if (found !== undefined) return new Response(JSON.stringify(found), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  };
  return /** @type {typeof fetch} */ (/** @type {unknown} */ (impl));
}

/** 一条真实的 GHSA 公告形状(取自 OSV 详情接口) */
const GHSA_VULN = {
  id: "GHSA-test-0000-0000",
  summary: "Prototype Pollution in prod-lib",
  database_specific: { severity: "HIGH", cwe_ids: ["CWE-1321"] },
  severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
  affected: [{ package: { name: "prod-lib", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.0.3" }] }] }],
};

/**
 * 跑 CLI 子进程(Electron 宿主下用 ELECTRON_RUN_AS_NODE 走真实 Node 行为)。
 * @param {string[]} args 脚本参数
 * @returns {{ status: number | null; output: string }}
 */
function runCli(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  await withTempDir(async (tmp) => {
    // 每个 case 一份独立沙盒:会改写 lockfile 的 case 共用会让后续 case 读到脏输入
    /**
     * 新建一个 case 沙盒(独立目录 + 独立 lockfile)。
     * @param {string} label case 名(兼作目录名)
     * @param {{ noLicense?: boolean }} [options] 夹具开关
     * @returns {{ dir: string; lockPath: string }} 沙盒路径
     */
    const sandbox = (label, options = {}) => {
      const dir = path.join(tmp, label);
      fs.mkdirSync(dir, { recursive: true });
      return { dir, lockPath: makeLockfile(dir, options) };
    };

    await suite.case("SCA 生产树真实漏洞 → 判红并列出包名/严重度/修复版本", async () => {
      const { lockPath } = sandbox("sca-vuln");
      const npm = fakeNpm({ production: { stdout: auditJsonWithVuln("prod-lib", "high"), exitCode: 1 }, all: { stdout: auditJsonWithVuln("prod-lib", "high"), exitCode: 1 } });
      const report = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowOsv: false, transport: npm.transport });
      assert(report.status === SCA_OK, `有真实漏洞时扫描源应给出结论,实际 ${report.status}`);
      assert(report.blocking.length > 0, "生产树 high 漏洞必须判红");
      const blocked = report.blocking.join("\n");
      assert(/生产树漏洞:prod-lib\(HIGH\)/.test(blocked), `阻断项须含包名与严重度,实际:${blocked}`);
      assert(/升级到 prod-lib@1\.0\.3/.test(blocked), `阻断项须含修复版本,实际:${blocked}`);
      assert(/Prototype Pollution in prod-lib/.test(blocked), "阻断项须含公告标题");
      assert(report.scopes.production?.vulnerabilityCount === 1, `生产树命中数应为 1,实际 ${report.scopes.production?.vulnerabilityCount}`);
    });

    await suite.case("SCA 扫描源不可用 → unavailable 而非「无漏洞」", async () => {
      const { lockPath } = sandbox("sca-unavailable");
      const npm = fakeNpm({ production: MIRROR_AUDIT_UNAVAILABLE, all: MIRROR_AUDIT_UNAVAILABLE });
      const throwingFetch = async () => {
        throw new Error("getaddrinfo ENOTFOUND api.osv.dev");
      };
      const report = await runScaScan({
        lockPath,
        registry: "https://registry.npmmirror.com",
        transport: npm.transport,
        fetchImpl: /** @type {typeof fetch} */ (/** @type {unknown} */ (throwingFetch)),
      });
      assert(report.status === STATUS_UNAVAILABLE, `两源都不可用时整体须为 unavailable,实际 ${report.status}`);
      assert(report.blocking.some((item) => /不等于「无漏洞」/.test(item)), `阻断项须明确「不等于无漏洞」,实际:${report.blocking.join(";")}`);
      assert(report.blocking.some((item) => /未判定依赖漏洞状态/.test(item)), "阻断项须说明未能判定");
      const auditSource = report.sources.find((source) => source.id === "npm-audit");
      assert(auditSource?.status === STATUS_UNAVAILABLE, "npm audit 源须标 unavailable");
      assert(/NOT_IMPLEMENTED/.test(auditSource?.reason ?? ""), `不可用原因须含端点诊断,实际:${auditSource?.reason}`);
      assert(report.sources.every((source) => source.status === STATUS_UNAVAILABLE), "OSV 源也不可达时同样须 unavailable");
      const log = formatScaLog(report).join("\n");
      assert(!/未发现漏洞/.test(log), `不可用时不得输出「未发现漏洞」,实际日志:${log}`);
      assert(/不等于「无漏洞」/.test(log), "日志须保留「不等于无漏洞」的措辞");
      // 判别依据是响应形状而非退出码:404 与「发现漏洞」的退出码同为 1
      const parsed = parseAuditPayload({
        tree: "production",
        registry: "https://registry.npmmirror.com",
        result: { ok: false, exitCode: 1, signal: null, stdout: MIRROR_AUDIT_UNAVAILABLE.stdout, stderr: MIRROR_AUDIT_UNAVAILABLE.stderr, timedOut: false, timeoutMs: 0, spawnError: null },
      });
      assert(parsed.status === STATUS_UNAVAILABLE && parsed.payload === null, "带 statusCode 的错误 JSON 不得被当成 audit 结果");
    });

    await suite.case("SCA 生产树与含 dev 全树分别扫描且区分正确", async () => {
      const { lockPath } = sandbox("sca-trees");
      const npm = fakeNpm({
        production: { stdout: JSON.stringify({ metadata: { vulnerabilities: {} }, vulnerabilities: {} }), exitCode: 0 },
        all: { stdout: auditJsonWithVuln("dev-tool", "critical"), exitCode: 1 },
      });
      const report = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowOsv: false, transport: npm.transport });
      assert(npm.calls.length === 2, `应跑两次 audit(两棵树),实际 ${npm.calls.length} 次`);
      const prodCall = npm.calls.find((call) => call.line.includes("--omit=dev"));
      const allCall = npm.calls.find((call) => !call.line.includes("--omit=dev"));
      assert(prodCall !== undefined, `生产树那次必须带 --omit=dev,实际 ${JSON.stringify(npm.calls.map((c) => c.line))}`);
      assert(allCall !== undefined, "全树那次不得带 --omit=dev");
      for (const call of npm.calls) {
        assert(/--registry=https:\/\/registry\.npmmirror\.com/.test(call.line), `audit 必须走项目 .npmrc 镜像端点,实际 ${call.line}`);
        assert(call.line.includes("--json"), "audit 必须取 JSON 输出");
        assert(call.line.includes("audit"), "调用的是 npm audit");
      }
      assert(report.scopes.production?.vulnerabilityCount === 0, "仅 dev 依赖有洞时生产树应为 0");
      assert(report.scopes.all?.vulnerabilityCount === 1, `含 dev 全树应命中 1 条,实际 ${report.scopes.all?.vulnerabilityCount}`);
      assert(report.blocking.length === 0, `仅开发依赖的 critical 不应阻断发布(不进发布包),实际阻断:${report.blocking.join(";")}`);
      assert(report.notes.some((note) => /仅开发依赖命中/.test(note)), "仅开发依赖命中须留痕");
      // OSV 投影:dev 组件只进全树,生产组件两棵树都进
      const osv = fakeOsv({ "prod-lib": [GHSA_VULN], "dev-tool": [{ ...GHSA_VULN, id: "GHSA-dev-0000-0000" }] });
      const projected = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowNpmAudit: false, fetchImpl: osv });
      assert(projected.scopes.production?.vulnerabilityCount === 1, `OSV 投影:生产树应命中 prod-lib,实际 ${projected.scopes.production?.vulnerabilityCount}`);
      assert(projected.scopes.all?.vulnerabilityCount === 2, `OSV 投影:全树应命中 2 条,实际 ${projected.scopes.all?.vulnerabilityCount}`);
      assert(projected.blocking.some((item) => /生产树漏洞:prod-lib\(HIGH\) 升级到 1\.0\.3/.test(item)), `OSV 修复版本须从公告 ranges 解析,实际:${projected.blocking.join(";")}`);
    });

    // 回归:误判「纯构建期工具是发布风险」。实测本仓 CI 上 xmldom/fast-uri/js-yaml/
    // sharp 全是 dev-only,却因 supply-chain job 不装依赖、`npm audit --omit=dev`
    // 的 dev 剪枝失效,被泄漏进生产树 pass 判红。权威判据必须是 lockfile 的
    // dev 标记,不是「这条来自哪一次 pass」。
    await suite.case("SCA dev-only 包泄漏进生产树 pass → 不误判为发布风险,且口径分歧留痕", async () => {
      const { lockPath } = sandbox("sca-dev-leak");
      // 生产树那次也报出 dev-only 的 dev-tool(剪枝失效的真实形态)
      const npm = fakeNpm({
        production: { stdout: auditJsonWithVuln("dev-tool", "high"), exitCode: 1 },
        all: { stdout: auditJsonWithVuln("dev-tool", "high"), exitCode: 1 },
      });
      const report = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowOsv: false, transport: npm.transport });
      assert(
        report.blocking.length === 0,
        `dev-only 包即使出现在生产树 pass 也不得判红(不进发布包),实际阻断:${report.blocking.join(";")}`,
      );
      assert(
        report.notes.some((note) => /分树口径与 lockfile dev 标记不一致.*dev-tool.*由 production pass 命中/.test(note)),
        `pass 口径与 lockfile 不一致必须留痕(不得静默按任一边放行),实际 notes:${report.notes.join(";")}`,
      );
      // 反向:真生产依赖仍在生产树 pass 命中时必须照旧判红
      const strict = fakeNpm({
        production: { stdout: auditJsonWithVuln("prod-lib", "high"), exitCode: 1 },
        all: { stdout: auditJsonWithVuln("prod-lib", "high"), exitCode: 1 },
      });
      const strictReport = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowOsv: false, transport: strict.transport });
      assert(
        strictReport.blocking.some((item) => /生产树漏洞:prod-lib\(HIGH\)/.test(item)),
        `真生产依赖命中仍须判红,实际:${strictReport.blocking.join(";")}`,
      );
      assert(
        !strictReport.notes.some((note) => /分树口径与 lockfile dev 标记不一致/.test(note)),
        "真生产依赖口径一致时不应误报分歧",
      );
    });

    await suite.case("许可证分类与严重度换算(纯函数)", () => {
      assert(classifyLicense("MIT").group === "permissive" && classifyLicense("MIT").needsReview === false, "MIT 应为宽松许可且无需复核");
      assert(classifyLicense("GPL-3.0-or-later").group === "strongCopyleft", "GPL 应为强 copyleft");
      assert(classifyLicense("LGPL-3.0").group === "weakCopyleft", "LGPL 应为弱 copyleft(不能被 LGPL 里的 GPL 误判成强 copyleft)");
      assert(classifyLicense("(MIT OR GPL-3.0-or-later)").group === "dualChoice", "多选一表达式应单列 dualChoice");
      assert(classifyLicense("Apache-2.0 AND LGPL-3.0-or-later").group === "weakCopyleft", "复合表达式取最严格的一支");
      assert(classifyLicense("(MPL-2.0 OR Apache-2.0)").group === "dualChoice", "MPL 多选一应单列");
      assert(classifyLicense("").group === "unknown" && classifyLicense("").needsReview === true, "空许可证应为 unknown 且需复核");
      assert(classifyLicense("BlueOak-1.0.0").group === "permissive", "非 copyleft 的自定义许可不应误判");
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H") === 9.8, "CVSS v3.1 基础分应为 9.8");
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H") === 7.5, "仅机密性受损应为 7.5");
      assert(cvss3BaseScore("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:H/VA:N") === null, "不支持的向量版本应返回 null 而非乱算");
      assert(severityFromScore(9.8) === "critical" && severityFromScore(7.5) === "high" && severityFromScore(4.0) === "moderate", "基础分到严重度的分档应正确");
      assert(compareSemver("1.0.10", "1.0.9") > 0, "semver 比较须按数值而非字典序");
      const plan = buildAuditPlan("https://registry.npmmirror.com");
      assert(plan.length === 2, `应有两棵树的 audit 命令,实际 ${plan.length}`);
      assert(plan[0]?.args.includes("--omit=dev") === true, "生产树那次须带 --omit=dev");
      assert(plan[1]?.args.includes("--omit=dev") === false, "全树那次不得带 --omit=dev");
    });

    await suite.case("缺输入/错参数 → 非零退出且文案可操作", async () => {
      const { dir, lockPath } = sandbox("missing-input");
      const missingLock = path.join(dir, "no-such-lock.json");
      let message = "";
      try {
        await runScaScan({ lockPath: missingLock, registry: "https://registry.npmmirror.com", allowOsv: false, transport: fakeNpm({}).transport });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(/lockfile 不存在/.test(message) && /npm install/.test(message), `缺 lockfile 的提示须可操作,实际:${message}`);
      const cli = runCli(["gates/supply/supply/check-supply-chain.mjs", "--lock", missingLock, "--output-dir", path.join(dir, "out"), "--no-osv", "--no-npm-audit"]);
      assert(cli.status === 1, `缺 lockfile 时 CLI 须非零退出,实际 ${cli.status}`);
      assert(/lockfile 不存在/.test(cli.output), `CLI 输出须说明缺 lockfile,实际:${cli.output}`);
      const badOption = runCli(["gates/supply/supply/gen-sbom.mjs", "--lockk", lockPath]);
      assert(badOption.status === 1 && /无法识别的选项/.test(badOption.output), `参数写错须失败并给出用法,实际 ${badOption.status}:${badOption.output}`);
      // 没有任何扫描源可用(等于「没扫」)也必须判红,不得当成通过
      const noSource = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowOsv: false, allowNpmAudit: false });
      assert(noSource.status === STATUS_UNAVAILABLE, "零扫描源时须为 unavailable");
      assert(noSource.blocking.length > 0, "零扫描源时须阻断");
    });
  });

  return { cases: suite.results };
}