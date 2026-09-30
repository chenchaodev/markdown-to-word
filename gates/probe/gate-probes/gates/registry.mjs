// 门禁探针:门禁注册表自检(registry 门禁)。
//
// 判据面 = 判定本体 `checkGateRegistry(ctx)` 本身(可注入纯函数),三种驱动器消费同一份:
//   CLI     —— node gates/probe/gate-probes/registry.mjs(以及 check:gates 的第一步)
//   探针    —— 本文件
//   验收段  —— test/segments/gate-registry-gate.test.js
//
// **为什么这个探针不跑真实注册表**:真实注册表当前是好的,跑它只会得到「零问题」—— 那是恒真断言,
// 证明不了本门禁在被破坏时会红。所以本探针对**合成的**注册表逐条注入故障:
// 把某道门禁的探针抽掉 / 让新出现的调用点无人登记 / 让判定本体指针指向不存在的导出 /
// 让探针指向不存在的载体 / 把接入点声明改错,每一格都必须让判定本体给出对应 code 的问题。
// 锚点则是「未注入任何故障的合成注册表」必须零问题 —— 少了它,「注入什么都判红」也可能只是
// 「这个函数无论输入什么都判红」。
//
// 合成而不改真实工作树:故障注入只发生在内存里的对象上,真实 registry.mjs 一个字节都不碰。
import {
  AGGREGATOR_SCRIPTS,
  CHAIN_ROOTS,
  GATE_REGISTRY,
  PROBE_CARRIER_SCRIPTS,
  TOOLCHAIN_FILES,
  TOOLCHAIN_SCRIPTS,
  checkGateRegistry,
  discoverInvocations,
} from "../registry.mjs";
import { finalizeGate, judgeCase } from "../judge.mjs";
import { makeCtx } from "../protocol.mjs";

/**
 * 把一份登记项浅拷贝成可改的合成副本(其余字段原样带走,免得合成注册表缺字段而误报)。
 * @param {Record<string, any>} entry 原登记项
 * @returns {Record<string, any>} 可改副本
 */
function cloneEntry(entry) {
  return { ...entry, probes: (entry.probes ?? []).map((/** @type {any} */ p) => ({ ...p })), npmScripts: [...entry.npmScripts] };
}

/**
 * 判定结果 → 探针器认识的结果形状(退出码语义:0 = 通过,1 = 判红)。
 * 探针**不 spawn 子进程**:判定本体是可注入纯函数,直接调用即可,这也正是「三种驱动器消费
 * 同一份判定」的含义 —— 若这里改成跑 CLI,验的就会是「CLI 会不会红」而不是「判定本体会不会红」。
 * @param {Readonly<Record<string, any>>} registry 合成注册表
 * @param {Map<string, any> | null} invocations 合成发现结果(null = 用真实发现)
 * @returns {{ code: number, output: string, codes: string[] }} 结果
 */
function runRegistry(registry, invocations = null) {
  const problems = checkGateRegistry(invocations === null ? { deps: { registry } } : { deps: { registry, invocations } });
  return {
    code: problems.length === 0 ? 0 : 1,
    output: problems.map((p) => `${p.code}: ${p.message}`).join("\n"),
    codes: problems.map((p) => p.code),
  };
}

/**
 * 从真实注册表造一份合成副本(改坏了就是故障夹具)。
 * @param {Readonly<Record<string, any>>} real 真实注册表
 * @returns {Record<string, any>} 合成副本
 */
function synth(real) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [id, entry] of Object.entries(real)) out[id] = cloneEntry(entry);
  return out;
}

/**
 * 门禁注册表自检探针。
 * @param {object} ctx 探针上下文(本探针不读沙盒,故只占位以与其它门禁同形)
 * @returns {Promise<import("../contract.mjs").GateProbeResult>} 门禁结果
 */
export async function probeRegistry(ctx) {
  void ctx;
  const real = /** @type {Readonly<Record<string, any>>} */ (/** @type {unknown} */ (GATE_REGISTRY));
  const realInvocations = discoverInvocations(makeCtx({}));
  /** @type {import("../contract.mjs").ProbeCase[]} */
  const cases = [];

  // ---- 锚点:未注入任何故障的合成注册表必须零问题(否则「注入什么都判红」也可能是恒红) ----
  const anchor = runRegistry(synth(real), realInvocations);
  cases.push(
    judgeCase(
      {
        id: "anchor",
        kind: "anchor",
        description: "未破坏:真实注册表原样(浅拷贝)求值,零问题",
        expect: "zero",
        expectKeywords: [],
        forbiddenKeywords: [":fail]", "probe-missing", "judgment-missing", "invocation-unregistered", "access-mismatch"],
      },
      anchor,
      anchor.code === 0 ? "" : `锚点不绿,下面所有负向结论都不成立:${anchor.output}`,
    ),
  );

  /**
   * 断言一组故障注入各自命中对应 code。
   * @param {string} id 探针 id
   * @param {string} description 做了什么
   * @param {string} fault 注入的故障
   * @param {() => { registry: Record<string, any>, invocations?: Map<string, any> | null }} build 故障夹具工厂
   * @param {string} expectedCode 期望命中的 code
   */
  const faultCase = (id, description, fault, build, expectedCode) => {
    const built = build();
    const result = runRegistry(built.registry, built.invocations ?? null);
    cases.push(
      judgeCase(
        {
          id,
          kind: "fault",
          description,
          fault,
          expect: "nonzero",
          expectKeywords: [expectedCode],
        },
        { code: result.code, signal: null, timedOut: false, output: result.output },
        result.codes.includes(expectedCode) ? undefined : `实际命中:${result.codes.join(",") || "零"}`,
      ),
    );
  };

  // ---- 负向 1:抽掉一道门禁的探针 → probe-missing(这就是「探针必填化」的判红本体) ----
  faultCase(
    "fault-probe-missing",
    "把一道门禁的探针整组抽掉",
    "contract 门禁的 probes 置空",
    () => {
      const registry = synth(real);
      registry.contract.probes = [];
      return { registry };
    },
    "probe-missing",
  );

  // ---- 负向 2:探针指向不存在的载体 → probe-missing(探针被删/改名从此会被发现) ----
  faultCase(
    "fault-probe-carrier-missing",
    "把探针指向一个不存在的自检脚本 / 验收段",
    "boundary 门禁的段探针 ref 指向 test/segments/does-not-exist.test.js",
    () => {
      const registry = synth(real);
      registry.boundary.probes = [{ kind: "segment", ref: "test/segments/does-not-exist.test.js", why: "指向不存在的段" }];
      return { registry };
    },
    "probe-missing",
  );

  // ---- 负向 3:沙盒探针 id 不在 GATE_IDS → probe-missing(登记了但不会被执行) ----
  faultCase(
    "fault-probe-not-runnable",
    "登记一个不在 GATE_IDS 里的沙盒探针 id",
    "coverage 门禁的沙盒探针改成不存在的 id",
    () => {
      const registry = synth(real);
      registry.coverage.probes = [{ kind: "sandbox", ref: "no-such-probe", why: "不存在的沙盒探针 id" }];
      return { registry };
    },
    "probe-missing",
  );

  // ---- 负向 4:新出现的调用点无人登记 → invocation-unregistered(新增门禁忘了登记探针) ----
  faultCase(
    "fault-invocation-unregistered",
    "让链上出现一道没人登记的新门禁",
    "在合成发现结果里加一个未登记的 npm script 调用点",
    () => {
      const invocations = new Map(realInvocations);
      invocations.set("npm:check:brand-new", {
        kind: "npm",
        name: "check:brand-new",
        sources: new Set(["chain:verify:ci"]),
        onChain: true,
        onWorkflow: false,
      });
      return { registry: synth(real), invocations };
    },
    "invocation-unregistered",
  );

  // ---- 负向 5:workflow 裸调路径无人登记 → invocation-unregistered(只登记 npm script 会漏的那条) ----
  faultCase(
    "fault-workflow-bare-invocation",
    "让 workflow 的裸调 fail-fast 步骤指向一个未登记的文件",
    "在合成发现结果里加一个只出现在 workflow 的裸调文件",
    () => {
      const invocations = new Map(realInvocations);
      invocations.set("file:gates/repo/check-not-registered.mjs", {
        kind: "file",
        name: "gates/repo/check-not-registered.mjs",
        sources: new Set(["workflow:ci.yml"]),
        onChain: false,
        onWorkflow: true,
      });
      return { registry: synth(real), invocations };
    },
    "invocation-unregistered",
  );

  // ---- 负向 6a:判定本体指针指向不存在的导出 → judgment-ref-broken(判定体被改名/删除) ----
  // 用 pinned-actions(可安全 import 的那批):它没有 load 字段,改动不引入 load 不匹配,故障单一
  faultCase(
    "fault-judgment-ref-broken",
    "让判定本体指针指向一个模块没导出的名字",
    "pinned-actions 门禁的判定导出名改成 analyzeTypo",
    () => {
      const registry = synth(real);
      registry["pinned-actions"].judgment = { module: "gates/repo/check-pinned-actions.mjs", export: "analyzeTypo", shaped: "{ problems }" };
      return { registry };
    },
    "judgment-ref-broken",
  );

  // ---- 负向 6b:static 指针的导出名错 → judgment-ref-broken(加严档也追不到) ----
  faultCase(
    "fault-judgment-ref-broken-static",
    "让声明为 static 的判定本体指向一个模块没导出的名字",
    "docs 门禁的判定导出名改成 mainTypo(仍保留 load:static)",
    () => {
      const registry = synth(real);
      registry.docs.judgment = { module: "gates/repo/check-docs.mjs", export: "mainTypo", shaped: "退出码", load: "static" };
      return { registry };
    },
    "judgment-ref-broken",
  );

  // ---- 负向 6c:load 声明与顶层自执行事实不符 → judgment-load-mismatch ----
  faultCase(
    "fault-judgment-load-mismatch",
    "让一个顶层自执行的模块谎报成可安全 import(段内 import 它会挂死)",
    "docs 门禁去掉 load:\"static\"(而该模块顶层会 execFileSync 起 Electron GUI 进程)",
    () => {
      const registry = synth(real);
      registry.docs.judgment = { module: "gates/repo/check-docs.mjs", export: "main", shaped: "退出码" };
      return { registry };
    },
    "judgment-load-mismatch",
  );

  // ---- 负向 7:判定本体指针指向不存在的模块 → judgment-module-missing ----
  faultCase(
    "fault-judgment-module-missing",
    "让判定本体指针指向一个不存在的模块",
    "signature 门禁的判定模块改成 gates/artifacts/gone.mjs",
    () => {
      const registry = synth(real);
      registry.signature.judgment = { module: "gates/artifacts/gone.mjs", export: "classifyAuthenticode", shaped: "x" };
      return { registry };
    },
    "judgment-module-missing",
  );

  // ---- 负向 8:实现文件不存在 → module-missing(目录迁移后忘了跟判定体) ----
  faultCase(
    "fault-module-missing",
    "让登记项的实现文件不存在",
    "asar 门禁的 modulePath 指向 gates/artifacts/check-asar-manifest-typo.mjs",
    () => {
      const registry = synth(real);
      registry.asar.modulePath = "gates/artifacts/check-asar-manifest-typo.mjs";
      return { registry };
    },
    "module-missing",
  );

  // ---- 负向 9a:声明可达但实际没人调 → access-mismatch ----
  faultCase(
    "fault-access-declared-unreachable",
    "把「仅本地手动」的门禁谎报成在链上,而它的 script 根本不在链上",
    "docs 门禁的 access 改成 chain(而 check:docs 不在任何链上)",
    () => {
      const registry = synth(real);
      registry.docs.access = "chain";
      return { registry };
    },
    "access-mismatch",
  );

  // ---- 负向 9b:声明本地但实际被链调 → access-mismatch(本地检查被悄悄挪进链) ----
  faultCase(
    "fault-access-mismatch",
    "把一道门禁谎报成「仅本地手动」,而它的 script 其实在链上",
    "dual-matrix 门禁认领 check:geometry(链上调用)却仍声明 access=local",
    () => {
      const registry = synth(real);
      registry["dual-matrix"].npmScripts = ["check:geometry"];
      return { registry };
    },
    "access-mismatch",
  );

  // ---- 负向 10:自检载体没人认领 → probe-carrier-orphan ----
  faultCase(
    "fault-carrier-orphan",
    "让一道自检载体不被任何门禁认领为探针",
    "temp-cleanup 的 probes 里换掉指向自检脚本的那一项",
    () => {
      const registry = synth(real);
      registry["temp-cleanup"].probes = registry["temp-cleanup"].probes.filter((/** @type {any} */ p) => p.kind !== "selftest");
      return { registry };
    },
    "probe-carrier-orphan",
  );

  // ---- 负向 11:探针没有写理由 → probe-reason-missing(无理由的探针登记等于没登记) ----
  faultCase(
    "fault-probe-reason-missing",
    "让一道探针不写「为什么它能证明会被判红」",
    "pinned-actions 的段探针清空 why",
    () => {
      const registry = synth(real);
      registry["pinned-actions"].probes = [{ kind: "segment", ref: "test/segments/pinned-actions.test.js", why: "" }];
      return { registry };
    },
    "probe-reason-missing",
  );

  return finalizeGate("registry", {
    sandboxed: true,
    sandboxInputs: ["(内存合成注册表:真实工作树零注入)"],
    cases,
    note:
      "本探针不 spawn 子进程:判定本体是可注入纯函数,直接调用。故障注入只发生在内存里的合成注册表上,"
      + `真实 registry.mjs 与工作树零触碰。分类面 = 链根 ${CHAIN_ROOTS.join("/")}、聚合入口 ${AGGREGATOR_SCRIPTS.join("/")}、`
      + `自检载体 ${Object.keys(PROBE_CARRIER_SCRIPTS).length} 条、工具链步骤 ${[...Object.keys(TOOLCHAIN_SCRIPTS), ...Object.keys(TOOLCHAIN_FILES)].join("/")}`,
  });
}