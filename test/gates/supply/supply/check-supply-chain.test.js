// @ts-check
/**
 * 供应链编排门禁段(位于 test/gates/supply/supply/ =
 * 镜像 gates/supply/supply/check-supply-chain.mjs,纯 Node 逻辑,不经 dist 编译产物):
 * 三段(SCA / SBOM / 许可证)编排与进程级 CLI 退出码。
 * - 端到端正例绿、负例(漏洞 + 未知许可证)两段各自报红而 SBOM 段不被带红
 * - --sbom-check:产物与 lockfile 一致时通过,lockfile 变更后判红并点名新组件
 * - 进程级 CLI:正例 exit 0,负例 exit 非零且文案点名;--sbom-check 缺产物须可操作地失败
 *
 * 本段是 supply 家族的**聚合段**:末两条 case(端到端 / 进程级 CLI)按断言目标属于本门禁
 * —— 它们校验的是三段编排的整体结论与进程退出码,不 import 任何单个子段的判据符号
 * (子进程走的是 CLI 字符串路径),故归此处而非任一子段。
 *
 * 断言方式:起一个本地桩 OSV 服务(空结果 → 「扫描通过」)让正例不依赖外网也可复现,
 * 断言返回的退出码 **与具体诊断文案**(只看退出码会让「因错误原因失败」的检查蒙混过关)。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createAsserter } from "../../../harness/assert.js";
import { createCaseSuite } from "../../../harness/case.js";
import { ROOT } from "../../../harness/paths.js";
import { removeTree } from "../../../harness/temp-resource.js";
import { closeTestServer, listenFetchablePort } from "../../../harness/http-server.js";
import { formatSupplyLog, runSupplyChecks } from "../../../../gates/supply/supply/check-supply-chain.mjs";

const suite = createCaseSuite();

const { assert } = createAsserter("check-supply-chain");

/**
 * 临时目录 + 兜底清理(测试对象是夹具,finally 保证不留残留)。
 * 清理走 removeTree(带 EBUSY/EPERM 退避重试与删后复查);删不掉仍即抛 ——
 * 「删不掉就抛」是本段原有的失败语义,助手只负责吸收 Windows 上的瞬时占用。
 * @param {(dir: string) => unknown} fn 在临时目录上执行的夹具逻辑
 * @returns {Promise<unknown>} fn 的返回值(透传)
 */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-supply-"));
  try {
    return await fn(dir);
  } finally {
    const outcome = removeTree(dir);
    if (!outcome.ok) throw new Error(`临时目录清理失败:${dir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
  }
}

/**
 * 造一份沙盒 lockfile。刻意做成「有生产依赖、有仅 dev 依赖、有嵌套依赖、有缺许可证
 * 的包」,这样三段各自的生产/开发判定、copyleft 分类、未知许可证都能在同一份夹具上验证。
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

/** 一条真实的 GHSA 公告形状(取自 OSV 详情接口) */
const GHSA_VULN = {
  id: "GHSA-test-0000-0000",
  summary: "Prototype Pollution in prod-lib",
  database_specific: { severity: "HIGH", cwe_ids: ["CWE-1321"] },
  severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
  affected: [{ package: { name: "prod-lib", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.0.3" }] }] }],
};

/**
 * 起一个本地桩 OSV 服务(空结果 → 「扫描通过」),供进程级 CLI 端到端实跑,
 * 不依赖外网也让正例可复现。
 * @param {Record<string, { id: string }[]>} hits 包名 → 公告
 * @returns {Promise<{ endpoint: string; close: () => Promise<void>; requests: string[] }>}
 */
async function startStubOsv(hits) {
  /** @type {string[]} */
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? "");
    if (req.url === "/v1/querybatch") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const results = body.queries.map((/** @type {{ package: { name: string } }} */ query) => {
          const hit = hits[query.package.name];
          return { vulns: (hit ?? []).map((vuln) => ({ id: vuln.id, modified: "2026-01-01T00:00:00Z" })) };
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ results }));
      });
      return;
    }
    const match = /^\/v1\/vulns\/(.+)$/.exec(req.url ?? "");
    if (match !== null) {
      const id = decodeURIComponent(match[1] ?? "");
      for (const vulns of Object.values(hits)) {
        const found = vulns.find((vuln) => vuln.id === id);
        if (found !== undefined) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(found));
          return;
        }
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(404).end();
  });
  // 端口须避开 fetch 建连前就拒绝的 bad port 名单:下方「SCA 段应真的向 OSV 发过批量查询」
  // 这条断言读的是本 server 的 requests 计数,而 fetchImpl(默认全局 fetch)命中名单时
  // 连一个包都不发,计数恒空 → 偶发红(共用助手,见 test/harness/http-server.js)
  const port = await listenFetchablePort(server, "supply-chain 桩 OSV");
  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    close: () => closeTestServer(server),
  };
}

/**
 * 跑 CLI 子进程(Electron 宿主下用 ELECTRON_RUN_AS_NODE 走真实 Node 行为)。
 * 同步版适用于不需要本进程继续服务事件的场景(桩服务在同进程时必须用异步版)。
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

/**
 * 异步跑 CLI 子进程:子进程要访问本进程内的桩 OSV 服务时必须用它 ——
 * spawnSync 会堵死本进程事件循环,桩服务收不到请求,子进程只会等到超时。
 * @param {string[]} args 脚本参数
 * @returns {Promise<{ status: number | null; output: string }>}
 */
function runCliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ status: code, output }));
  });
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

    await suite.case("端到端(check-supply-chain):正例绿、漏洞/未知许可证负例红", async () => {
      const clean = sandbox("e2e-clean", { noLicense: false });
      const cleanLock = clean.lockPath;
      const cleanOut = path.join(clean.dir, "out");
      const stub = await startStubOsv({});
      try {
        const ok = await runSupplyChecks({
          projectRoot: clean.dir,
          lockPath: cleanLock,
          outputDir: cleanOut,
          registry: "https://registry.npmmirror.com",
          allowNpmAudit: false,
          osvEndpoint: stub.endpoint,
        });
        assert(ok.status === "ok", `三段全通过时整体应为 ok,实际 ${ok.status}:${JSON.stringify(ok.report.sections.sca.blocking)}`);
        assert(stub.requests.some((url) => url === "/v1/querybatch"), "SCA 段应真的向 OSV 发过批量查询");
        for (const file of ["sbom.cdx.json", "licenses.json", "NOTICE.md", "sca-report.json", "supply-report.json"]) {
          assert(fs.existsSync(path.join(cleanOut, file)), `产物缺失:${file}`);
        }
        const licensesReport = JSON.parse(fs.readFileSync(path.join(cleanOut, "licenses.json"), "utf8"));
        assert(licensesReport.status === "ok" && licensesReport.unknownLicense.length === 0, "全声明许可证时不应判红");
        // 门禁日志须把决策口径说清:待复核按生产/开发拆分,决策逐条留痕
        const gateLog = formatSupplyLog(ok.report).join("\n");
        assert(/需人工复核 \d+\(生产 \d+ \/ 开发 \d+\)/.test(gateLog), `门禁日志应拆分待复核范围,实际:${gateLog}`);
        assert(/多选一许可已选定:/.test(gateLog) || /分支选定决策未生效:/.test(gateLog), `门禁日志须留痕决策结论,实际:${gateLog}`);
        assert(ok.report.sections.licenses.licenseDecisions !== undefined, "总报告须带上决策汇总");

        // --sbom-check:先过,再改 lockfile 即漂移
        const checked = await runSupplyChecks({
          projectRoot: clean.dir,
          lockPath: cleanLock,
          outputDir: cleanOut,
          registry: "https://registry.npmmirror.com",
          allowNpmAudit: false,
          sbomCheck: true,
          osvEndpoint: stub.endpoint,
        });
        assert(checked.report.sections.sbom.status === "ok", "产物与 lockfile 一致时 --sbom-check 应通过");
        const drifted = JSON.parse(fs.readFileSync(cleanLock, "utf8"));
        drifted.packages["node_modules/late-dep"] = { version: "1.0.0", license: "MIT" };
        fs.writeFileSync(cleanLock, JSON.stringify(drifted, null, 2), "utf8");
        const afterDrift = await runSupplyChecks({
          projectRoot: clean.dir,
          lockPath: cleanLock,
          outputDir: cleanOut,
          registry: "https://registry.npmmirror.com",
          allowNpmAudit: false,
          sbomCheck: true,
          osvEndpoint: stub.endpoint,
        });
        assert(afterDrift.report.sections.sbom.status === "fail", "lockfile 变更后 --sbom-check 应判红");
        assert(/新增组件未记入 SBOM:pkg:npm\/late-dep@1\.0\.0/.test(afterDrift.report.sections.sbom.problem ?? ""), `漂移须点名新组件,实际:${afterDrift.report.sections.sbom.problem}`);
      } finally {
        await stub.close();
      }

      // 负例:生产依赖命中漏洞 + 未知许可证,两段各自报红
      const dirty = sandbox("e2e-dirty");
      const dirtyStub = await startStubOsv({ "prod-lib": [GHSA_VULN] });
      try {
        const bad = await runSupplyChecks({
          projectRoot: dirty.dir,
          lockPath: dirty.lockPath,
          outputDir: path.join(dirty.dir, "out"),
          registry: "https://registry.npmmirror.com",
          allowNpmAudit: false,
          osvEndpoint: dirtyStub.endpoint,
        });
        assert(bad.status === "fail", "有生产漏洞与未知许可证时整体须判红");
        assert(bad.report.sections.sca.status === "fail", "SCA 段须判红");
        assert(bad.report.sections.sca.blocking?.some((item) => /生产树漏洞:prod-lib\(HIGH\)/.test(item)) === true, `SCA 段须点名 prod-lib,实际:${(bad.report.sections.sca.blocking ?? []).join(";")}`);
        assert(bad.report.sections.licenses.status === "fail", "许可证段须判红");
        assert(bad.report.sections.licenses.unknownLicense?.some((item) => item.name === "no-license") === true, "许可证段须单列未知包");
        assert(bad.report.sections.sbom.status === "ok", "SBOM 段本身不应被上述问题带红");
      } finally {
        await dirtyStub.close();
      }
    });

    await suite.case("进程级 CLI:正例 exit 0,负例 exit 非零", async () => {
      const cli = sandbox("cli", { noLicense: false });
      const cliDir = cli.dir;
      const cliLock = cli.lockPath;
      const outDir = path.join(cliDir, "out");
      const stub = await startStubOsv({});
      try {
        const okRun = await runCliAsync([
          "gates/supply/supply/check-supply-chain.mjs",
          "--lock", cliLock,
          "--output-dir", outDir,
          "--no-npm-audit",
          "--osv-endpoint", stub.endpoint,
        ]);
        assert(okRun.status === 0, `全通过时 CLI 须 exit 0,实际 ${okRun.status}:${okRun.output}`);
        assert(/\[supply:ok\] 供应链检查通过/.test(okRun.output), `CLI 应给出通过结论,实际:${okRun.output}`);
      } finally {
        await stub.close();
      }
      // 未知许可证 → exit 1 且文案点名(另建沙盒,勿覆盖上面那份齐备的 lockfile)
      const dirty = sandbox("cli-dirty");
      const dirtyRun = runCli([
        "gates/supply/supply/check-supply-chain.mjs",
        "--lock", dirty.lockPath,
        "--output-dir", path.join(dirty.dir, "out"),
        "--no-osv",
        "--no-npm-audit",
      ]);
      assert(dirtyRun.status === 1, `有未知许可证时 CLI 须 exit 1,实际 ${dirtyRun.status}`);
      assert(/许可证缺失:no-license@0\.1\.0\(生产依赖\)/.test(dirtyRun.output), `CLI 须点名未知许可证的包,实际:${dirtyRun.output}`);
      assert(/这不等于「无漏洞」/.test(dirtyRun.output), "零扫描源时 CLI 须明确「不等于无漏洞」");
      // 沙盒缺 SBOM 产物 + --sbom-check → 非零且可操作
      const missingSbom = runCli([
        "gates/supply/supply/check-supply-chain.mjs",
        "--lock", cliLock,
        "--output-dir", path.join(cliDir, "empty-out"),
        "--no-osv",
        "--no-npm-audit",
        "--sbom-check",
      ]);
      assert(missingSbom.status === 1 && /缺少已生成的/.test(missingSbom.output), `--sbom-check 缺产物须失败,实际 ${missingSbom.status}:${missingSbom.output}`);
      // gen-sbom CLI:生成 → --check 通过
      const sbomOut = path.join(cliDir, "sbom.json");
      const gen = runCli(["gates/supply/supply/gen-sbom.mjs", "--lock", cliLock, "--output", sbomOut]);
      assert(gen.status === 0, `gen-sbom 应 exit 0,实际 ${gen.status}:${gen.output}`);
      const check = runCli(["gates/supply/supply/gen-sbom.mjs", "--lock", cliLock, "--output", sbomOut, "--check"]);
      assert(check.status === 0, `gen-sbom --check 应 exit 0,实际 ${check.status}:${check.output}`);
      const licensesRun = runCli(["gates/supply/supply/gen-licenses.mjs", "--lock", cliLock, "--output-dir", path.join(cliDir, "lic")]);
      assert(licensesRun.status === 0, `许可证齐备时 gen-licenses 应 exit 0,实际 ${licensesRun.status}:${licensesRun.output}`);
      // 直接跑 SBOM 缺 lockfile 的路径
      const noLock = runCli(["gates/supply/supply/gen-sbom.mjs", "--lock", path.join(cliDir, "absent.json"), "--output", path.join(cliDir, "x.json")]);
      assert(noLock.status === 1 && /lockfile 不存在/.test(noLock.output), `缺 lockfile 时 gen-sbom 须非零退出,实际 ${noLock.status}:${noLock.output}`);
    });
  });

  return { cases: suite.results };
}