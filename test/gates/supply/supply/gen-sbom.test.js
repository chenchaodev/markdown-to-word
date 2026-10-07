// @ts-check
/**
 * SBOM 门禁段(位于 test/gates/supply/supply/ = 镜像 gates/supply/supply/gen-sbom.mjs,
 * 纯 Node 逻辑,不经 dist 编译产物):CycloneDX 1.6 SBOM 的离线确定性与 --check 漂移检测。
 * - 同输入两次逐字节一致且键序稳定、无时间戳(否则 --check 变成随机噪声)
 * - serialNumber 由 lockfile 派生且稳定(否则漂移检测形同虚设)
 * - --check 检出新增组件 / 移除误报 / 许可证被改写
 * - 依赖边按 node_modules 上溯解析:嵌套依赖落到正确条目,同名版本带消歧 qualifier
 *
 * 断言方式:临时目录里造沙盒 lockfile,断言 SBOM 文档的**具体结构**(键序、purl、
 * 消歧 qualifier、scope),只看「生成成功」会让确定性判据形同虚设。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAsserter } from "../../../harness/assert.js";
import { createCaseSuite } from "../../../harness/case.js";
import { removeTree } from "../../../harness/temp-resource.js";
import { diffSbom, generateSbom, toCycloneDxLicenses } from "../../../../gates/supply/supply/gen-sbom.mjs";
import { resolveDepPath } from "../../../../gates/supply/supply/supply-common.mjs";

const suite = createCaseSuite();

const { assert: harnessAssert } = createAsserter("gen-sbom");

/**
 * 窄化壳:非 case 上下文用;harness 的 assert 刻意不声明 `asserts cond`(TS2775 禁从解构
 * 模式调断言函数),而本段下游代码依赖收窄 ⇒ 保留一层带窄化签名的壳,体内只委派。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  harnessAssert(cond, msg);
}

/**
 * 临时目录 + 兜底清理(测试对象是夹具,finally 保证不留残留)。
 * 清理走 removeTree(带 EBUSY/EPERM 退避重试与删后复查);删不掉仍即抛 ——
 * 「删不掉就抛」是本段原有的失败语义,助手只负责吸收 Windows 上的瞬时占用。
 * @param {(dir: string) => unknown} fn 在临时目录上执行的夹具逻辑
 * @returns {Promise<unknown>} fn 的返回值(透传)
 */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-sbom-"));
  try {
    return await fn(dir);
  } finally {
    const outcome = removeTree(dir);
    if (!outcome.ok) throw new Error(`临时目录清理失败:${dir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
  }
}

/**
 * 造一份沙盒 lockfile。刻意做成「有生产依赖、有仅 dev 依赖、有嵌套依赖、有缺许可证
 * 的包」,这样确定性 / 依赖边 / NOASSERTION 三条都能在同一份夹具上验证。
 * @param {string} dir 沙盒目录
 * @returns {string} lockfile 绝对路径
 */
function makeLockfile(dir) {
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
    "node_modules/no-license": { version: "0.1.0" },
  };
  packages[""].dependencies = { ...packages[""].dependencies, "no-license": "^0.1.0" };
  const lockPath = path.join(dir, "package-lock.json");
  fs.writeFileSync(lockPath, `${JSON.stringify({ name: "sandbox-app", version: "1.0.0", lockfileVersion: 3, requires: true, packages }, null, 2)}\n`, "utf8");
  return lockPath;
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  await withTempDir(async (tmp) => {
    // 每个 case 一份独立沙盒:漂移类 case 会改写 lockfile,共用会让后续 case 读到脏输入
    /**
     * 新建一个 case 沙盒(独立目录 + 独立 lockfile)。
     * @param {string} label case 名(兼作目录名)
     * @returns {{ dir: string; lockPath: string }} 沙盒路径
     */
    const sandbox = (label) => {
      const dir = path.join(tmp, label);
      fs.mkdirSync(dir, { recursive: true });
      return { dir, lockPath: makeLockfile(dir) };
    };

    await suite.case("SBOM 离线确定性:同输入两次逐字节一致且键序稳定", async () => {
      const { lockPath } = sandbox("sbom-determinism");
      const first = generateSbom(lockPath, "package-lock.json");
      const second = generateSbom(lockPath, "package-lock.json");
      assert(JSON.stringify(first.document) === JSON.stringify(second.document), "同一 lockfile 两次生成必须完全一致");
      const text = JSON.stringify(first.document, null, 2);
      // 键序:顶层 bomFormat → specVersion → serialNumber → version → metadata → components → dependencies
      const order = ["\"bomFormat\"", "\"specVersion\"", "\"serialNumber\"", "\"version\"", "\"metadata\"", "\"components\"", "\"dependencies\""].map((key) => text.indexOf(key));
      assert(order.every((index) => index > 0), "顶层各键都应存在");
      assert(order.every((index, i) => i === 0 || index > (order[i - 1] ?? -1)), `顶层键序应固定,实际位置 ${order.join(",")}`);
      const component = first.document.components[0];
      const compText = JSON.stringify(component);
      const compOrder = ["\"bom-ref\"", "\"type\"", "\"name\"", "\"version\"", "\"scope\"", "\"licenses\"", "\"purl\"", "\"properties\""].map((key) => compText.indexOf(key));
      assert(compOrder.every((index, i) => i === 0 || index > (compOrder[i - 1] ?? -1)), `组件键序应固定,实际 ${compOrder.join(",")}`);
      // 无时间戳:SBOM 里任何时间字段都会让 --check 变成随机噪声
      assert(!/"(timestamp|created|modified|datePublished)"/.test(text), "SBOM 不应含时间戳字段");
      assert(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text), "SBOM 不应含 ISO 时间字符串");
      assert(first.document.serialNumber.startsWith("urn:uuid:"), "serialNumber 应为 urn:uuid 形式");
      assert(first.document.serialNumber === second.document.serialNumber, "serialNumber 必须由 lockfile 派生且稳定");
      // 换 lockfile 内容 → serialNumber 必变(否则漂移检测形同虚设)
      const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-supply-alt-"));
      try {
        const otherLock = makeLockfile(otherDir);
        const altered = JSON.parse(fs.readFileSync(otherLock, "utf8"));
        altered.packages["node_modules/prod-lib"].version = "1.0.9";
        fs.writeFileSync(otherLock, JSON.stringify(altered, null, 2), "utf8");
        const other = generateSbom(otherLock, "package-lock.json");
        assert(other.document.serialNumber !== first.document.serialNumber, "lockfile 变更后 serialNumber 必须变化");
      } finally {
        const outcome = removeTree(otherDir);
        if (!outcome.ok) throw new Error(`临时目录清理失败:${otherDir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
      }
      // 缺声明许可证的包在 SBOM 里必须显式 NOASSERTION,不得静默省略 licenses
      const noLicense = first.document.components.find((item) => item.name === "no-license");
      assert(noLicense !== undefined, "SBOM 应含 no-license 组件");
      assert(JSON.stringify(noLicense.licenses) === JSON.stringify([{ license: { name: "NOASSERTION" } }]), `缺许可证应记 NOASSERTION,实际 ${JSON.stringify(noLicense.licenses)}`);
      assert(toCycloneDxLicenses("MIT").licenses[0]?.license.id === "MIT", "裸标识符应走 license.id");
      assert(toCycloneDxLicenses("(MIT OR Zlib)").licenses[0]?.license.expression === "(MIT OR Zlib)", "复合表达式应走 license.expression");
      assert(first.document.metadata.properties.some((property) => property.name === "m2w:sbom:determinism"), "SBOM 应记录确定性口径");
    });

    await suite.case("SBOM --check 检出漂移(新增组件/许可证变化)", async () => {
      const { lockPath } = sandbox("sbom-drift");
      const baseline = generateSbom(lockPath, "package-lock.json");
      assert(diffSbom(JSON.parse(JSON.stringify(baseline.document)), baseline.document).length === 0, "同文档比对应无漂移");
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      lock.packages["node_modules/new-dep"] = { version: "3.0.0", license: "MIT" };
      lock.packages[""].dependencies["new-dep"] = "^3.0.0";
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");
      const after = generateSbom(lockPath, "package-lock.json");
      const drift = diffSbom(baseline.document, after.document);
      assert(drift.some((item) => /新增组件未记入 SBOM:pkg:npm\/new-dep@3\.0\.0/.test(item)), `应报出新增组件,实际:${drift.join(";")}`);
      assert(drift.some((item) => /serialNumber 不一致/.test(item)), "lockfile 变更后应报 serialNumber 不一致");
      assert(drift.some((item) => /新增组件已不在|SBOM 中的组件已不在 lockfile/.test(item) === false), "只增不删时不应误报移除");
      // 反向:把 SBOM 里的许可证改掉,须被检出
      const tampered = JSON.parse(JSON.stringify(baseline.document));
      const target = tampered.components.find((/** @type {any} */ item) => item.name === "prod-lib");
      assert(target !== undefined, "夹具应含 prod-lib 组件");
      target.licenses = [{ license: { id: "WTFPL" } }];
      assert(diffSbom(tampered, baseline.document).some((item) => /组件许可证变化未同步 SBOM:pkg:npm\/prod-lib/.test(item)), "许可证被改写须被检出");
    });

    await suite.case("依赖边按 node_modules 上溯解析(嵌套依赖落到正确条目)", () => {
      const { lockPath } = sandbox("sbom-edges");
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      assert(resolveDepPath(lock, "node_modules/mixed-lib", "inner-lib") === "node_modules/mixed-lib/node_modules/inner-lib", "同名嵌套依赖应就近解析");
      assert(resolveDepPath(lock, "node_modules/mixed-lib/node_modules/inner-lib", "x") === null, "未声明的依赖应返回 null 而非猜测");
      assert(resolveDepPath(lock, "", "prod-lib") === "node_modules/prod-lib", "根包直接依赖应解析到顶层");
      const sbom = generateSbom(lockPath, "package-lock.json");
      // 嵌套的 inner-lib@1.0.1 与顶层的 inner-lib@1.0.0 版本不同,purl 本身唯一,无需消歧
      const mixedRef = sbom.document.dependencies.find((entry) => entry.ref === "pkg:npm/mixed-lib@1.0.0");
      assert(mixedRef?.dependsOn.join() === "pkg:npm/inner-lib@1.0.1", `嵌套依赖边应指向嵌套版本,实际 ${JSON.stringify(mixedRef)}`);
      // 同一 name@version 出现在两处时必须消歧,否则依赖边会指向错误组件
      lock.packages["node_modules/other"] = { version: "1.0.0", license: "MIT", dependencies: { "inner-lib": "1.0.1" } };
      lock.packages["node_modules/other/node_modules/inner-lib"] = { version: "1.0.1", license: "LGPL-3.0-or-later" };
      lock.packages[""].dependencies = { ...lock.packages[""].dependencies, other: "^1.0.0" };
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");
      const dup = generateSbom(lockPath, "package-lock.json");
      const dupRef = dup.document.dependencies.find((entry) => entry.ref === "pkg:npm/other@1.0.0");
      assert(
        dupRef?.dependsOn.join() === "pkg:npm/inner-lib@1.0.1?m2w_path=node_modules%2Fother%2Fnode_modules%2Finner-lib",
        `重名版本应带消歧 qualifier,实际 ${JSON.stringify(dupRef)}`,
      );
      const refs = dup.document.components.map((component) => component["bom-ref"]);
      assert(new Set(refs).size === refs.length, "bom-ref 必须唯一");
      const devTool = dup.document.components.find((item) => item.name === "dev-tool");
      assert(devTool?.scope === "optional", "仅 dev 组件的 CycloneDX scope 应为 optional");
      const prodLib = dup.document.components.find((item) => item.name === "prod-lib");
      assert(prodLib?.scope === "required", "生产组件的 CycloneDX scope 应为 required");
    });
  });

  return { cases: suite.results };
}