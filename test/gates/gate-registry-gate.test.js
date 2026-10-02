// @ts-check
/**
 * 门禁注册表段(位于 test/core/ = 跨域守护段;被测为
 * gates/probe/gate-probes/registry.mjs 的判定本体 `checkGateRegistry(ctx)` 与
 * gates/probe/gate-probes/protocol.mjs 的驱动器协议):
 *
 * **三种驱动器消费同一份判定**——本段就是第三种(验收段)驱动器:
 *   ① 进程级 CLI:node gates/probe/gate-probes/registry.mjs(以及 `npm run check:gates` 的第一步)
 *   ② 沙盒探针  :gates/probe/gate-probes/gates/registry.mjs
 *   ③ 验收段    :本文件
 * 三者调的是同一个 `checkGateRegistry`,不各自实现一套判定。本段因此**不**重复实现判据:
 * 判据全在 registry.mjs,本段只做「每条判据的正负夹具 + 判定本体指针真的能 import 出来」。
 *
 * 覆盖:
 *   1. 真实注册表零问题(锚点);
 *   2. 每道门禁都登记了判定本体,且每个**指针**都能被 `import()` 解析成函数 ——
 *      这是「三种驱动器消费同一份判定」的硬证明:指针只在静态文本里核对是不够的,
 *      导名对但运行时不在(被 tree-shake / 被改名 / 是 re-export 的转发)只有真 import 才看得见;
 *   3. 每道门禁都带 ≥1 道探针,且每道探针写清了理由、载体真实存在;
 *   4. **两条调用路径都被覆盖**:链上与 workflow 上出现的每个调用点都有归属 ——
 *      含 workflow 的裸调 fail-fast 步骤(只登记 npm script 会整条漏掉的那条路径);
 *   5. 负向夹具:逐条注入故障,断言判定本体给出对应 code(与沙盒探针同形,但走驱动器 ③ 的调用路径)。
 */
import {
  AGGREGATOR_SCRIPTS,
  CHAIN_ROOTS,
  GATE_REGISTRY,
  PROBE_CARRIER_SCRIPTS,
  TOOLCHAIN_FILES,
  TOOLCHAIN_SCRIPTS,
  checkGateRegistry,
  discoverInvocations,
} from "../../gates/probe/gate-probes/registry.mjs";
import { GATE_IDS } from "../../gates/probe/gate-probes/contract.mjs";
import { auditJudgmentRef, makeCtx, resolveJudgment } from "../../gates/probe/gate-probes/protocol.mjs";
import { createCaseSuite } from "../common/case.js";
import { ROOT } from "../common/paths.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头):本段断言的是门禁
// 注册表自身的行为,产物是一组判定结论,不是可供 GUI 拖入实测的 md 样例。
export const fixtures = null;

/**
 * 合成一份「改坏了」的注册表(浅拷贝 + 按 mutate 打故障);真实注册表一个字节都不碰。
 * @param {(registry: Record<string, any>) => void} mutate 故障注入
 * @returns {Record<string, any>} 合成注册表
 */
function synth(mutate) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [id, entry] of Object.entries(GATE_REGISTRY)) {
    out[id] = { ...entry, probes: (entry.probes ?? []).map((/** @type {any} */ p) => ({ ...p })), npmScripts: [...entry.npmScripts] };
  }
  mutate(out);
  return out;
}

/**
 * `judgment-load-mismatch` 负向夹具的**被测主体**:一段合成的模块源码。
 *
 * 为什么必须合成、而不是指着一个真实模块(2026-10-01,REQ-118 之后):REQ-118 给三道门禁加了
 * 入口守卫、顶层不再自执行,全仓**已无任何自执行模块** ⇒ 「去掉 load」那种注入拿不到被测
 * 主体,判定返回零问题 —— 那正是恒绿(2026-10-01 实测:本 case 就是这样变红的)。反方向
 * (新增一个永久自执行的夹具模块文件)同样不可取:等于把 REQ-118 刚消灭的东西请回来,并让门禁
 * 从此挂着一个「已知坏」的常驻模块。故夹具经 `readText` / `exists` 注入面喂合成文本,仓内
 * **不存在**这两个文件,结论与任何真实文件的状态解耦。
 *
 * `process.exitCode = main();` 必须顶格 —— `topLevelSelfExecutions` 只认行首无缩进的语句,
 * 这正是它与函数体内的同名调用之间的全部差别。
 */
const SELF_EXECUTING_MODULE_REL = "gates/probe/gate-probes/synthetic-self-executing-probe.mjs";
const SELF_EXECUTING_MODULE_TEXT = ["export function main() {", "  return 0;", "}", "process.exitCode = main();", ""].join("\n");

/** 可安全 import 的合成模块:顶层**没有**自执行痕迹(反向方向用它,证明判据双向成立) */
const IMPORTABLE_MODULE_REL = "gates/probe/gate-probes/synthetic-importable-probe.mjs";
const IMPORTABLE_MODULE_TEXT = ["export function main() {", "  return 0;", "}", ""].join("\n");

/**
 * 造一份判定注入面:给定的**仓内并不存在**的模块相对路径读到合成源码、判定为存在;
 * 其余相对路径一律走真实根(调用点发现面要读真实的 package.json 与 workflow)。
 * @param {Record<string, string>} modules 仓库相对路径 → 合成源码
 * @returns {import("../../gates/probe/gate-probes/protocol.mjs").GateCtx} 判定注入面
 */
function ctxWithSyntheticModules(modules) {
  const real = makeCtx({ root: ROOT });
  // makeCtx 的两个 IO 原语在 GateCtx 里声明为可选,这里取回时收窄成必调用的形态
  const realRead = /** @type {(relative: string) => string} */ (real.readText);
  const realExists = /** @type {(relative: string) => boolean} */ (real.exists);
  return {
    root: ROOT,
    readText: (/** @type {string} */ relative) => (modules[relative] === undefined ? realRead(relative) : modules[relative]),
    exists: (/** @type {string} */ relative) => modules[relative] !== undefined || realExists(relative),
  };
}

/**
 * 在合成注册表上求值,返回命中的 code 列表。
 * @param {(registry: Record<string, any>) => void} mutate 故障注入
 * @returns {string[]} 命中的 code
 */
function codesOf(mutate) {
  return checkGateRegistry({ deps: { registry: synth(mutate) } }).map((item) => item.code);
}

/**
 * 断言一次故障注入命中了期望的 code(命中即可 —— 顺带命中别的 code 不算失败,
 * 因为多条判据本就可能同时成立)。
 * @param {string[]} codes 命中的 code
 * @param {string} expected 期望的 code
 * @returns {void}
 */
function expectCode(codes, expected) {
  if (!codes.includes(expected)) {
    throw new Error(`期望判红并命中 ${expected},实际:${codes.length === 0 ? "零问题(恒绿!)" : codes.join(",")}`);
  }
}

/**
 * 「声明可达但实际没人调」这条负向夹具的**注入载体 id**。
 *
 * 为什么是 `install-smoke`:这条注入的判红**完全依赖载体此刻不在链上**(谎报 chain 而事实是
 * local)。载体必须选一条「结构上永远不会被挂上链」的门禁 —— install-smoke 跑的是真实装卸流程
 * (系统副作用、慢、依赖真实包源),进 verify:ci 属于要裁决的架构改动,不会顺手发生;它也只有
 * 一条 npm script,接入点代表脚本无歧义。**不要换回 `docs`**:ADR-054 决定六已把 `check:docs`
 * 真挂进 verify:ci,换载体之前以它为载体的注入就是空操作 ⇒ 夹具恒绿。
 */
const ACCESS_MISMATCH_CARRIER = "install-smoke";

/**
 * 负向夹具的**注入载体前置断言**:载体此刻必须仍是「仅本地手动」且其接入点脚本确实不在链上。
 *
 * 为什么这条比「换一个载体」本身更重要:载体一旦被挂上链,注入就退化成空操作,判定返回零问题 ——
 * 那是恒绿(恒真断言那一族),门禁全绿里看不出与「真的判红了」的区别。故载体一旦不再满足前提,
 * 必须立刻判红并给出可分辨的诊断,而不是让夹具带着失效的载体继续报绿。
 * @param {import("../../gates/probe/gate-probes/protocol.mjs").GateCtx} ctx 判定注入面
 * @returns {string | null} 载体仍可用返回 null;已不可用返回可分辨的诊断文案
 */
function accessMismatchCarrierProblem(ctx) {
  const entry = GATE_REGISTRY[ACCESS_MISMATCH_CARRIER];
  // 载体不存在本身就是要报的问题,不是可以压掉的类型细节:换载体时若改了名而这里
  // 没跟上,夹具会退化成「找不到 entry 就什么也不做」⇒ 静默恒绿。
  if (entry === undefined) {
    return `注入载体门禁 ${ACCESS_MISMATCH_CARRIER} 在注册表里不存在 —— 换载体时若改了名而这里没跟上,夹具会静默恒绿`;
  }
  const accessScript = entry.npmScripts[0];
  const hit = discoverInvocations(ctx).get(`npm:${accessScript}`);
  if (entry.access !== "local") {
    return `门禁 ${ACCESS_MISMATCH_CARRIER} 的 access 已是「${String(entry.access)}」而非 local —— 注入载体必须是「仅本地手动」的门禁,否则「谎报成 chain」与事实相符,注入退化为空操作`;
  }
  if (hit !== undefined && hit.onChain) {
    return `门禁 ${ACCESS_MISMATCH_CARRIER} 的接入点 npm run ${accessScript} 已上链(onChain=true,来源 ${[...hit.sources].join(",")})—— 把它谎报成 chain 与事实相符,注入退化为空操作`;
  }
  return null;
}

export async function run() {
  const suite = createCaseSuite();
  const ctx = makeCtx({ root: ROOT });
  const entries = Object.values(GATE_REGISTRY);

  await suite.describe("门禁注册表:锚点", async () => {
    await suite.case("真实注册表零问题", () => {
      const problems = checkGateRegistry({});
      if (problems.length === 0) return;
      throw new Error(`真实注册表被判红(共 ${problems.length} 项):\n${problems.map((p) => `  ${p.code}: ${p.message}`).join("\n")}`);
    });

    await suite.case("调用面非空(发现器没退化成空扫描 = 恒绿)", () => {
      const found = discoverInvocations(ctx);
      const chainCalls = [...found.values()].filter((hit) => hit.onChain).length;
      const workflowCalls = [...found.values()].filter((hit) => hit.onWorkflow).length;
      if (found.size === 0) throw new Error("调用路径发现结果为空:所有调用点都会「无主」,注册表判据形同虚设");
      if (chainCalls === 0) throw new Error("没有发现任何 npm script 链上的调用点(链根解析失效?)");
      if (workflowCalls === 0) throw new Error("没有发现任何 workflow 上的调用点(workflow 扫描失效 —— 那正是裸调 fail-fast 路径)");
      console.log(`  [registry] 调用点 ${found.size} 个(链上 ${chainCalls} · workflow ${workflowCalls});链根 ${CHAIN_ROOTS.join("/")}`);
    });
  });

  await suite.describe("门禁注册表:每道门禁必带探针", async () => {
    await suite.case(`登记项非空且探针齐备(${entries.length} 道门禁)`, () => {
      /** @type {string[]} */
      const missing = [];
      for (const entry of entries) {
        if (!Array.isArray(entry.probes) || entry.probes.length === 0) {
          missing.push(`${entry.id}(零探针)`);
          continue;
        }
        for (const probe of entry.probes) {
          if (typeof probe.why !== "string" || probe.why.trim().length < 10) missing.push(`${entry.id}/${probe.ref}(缺理由)`);
          if (probe.kind === "sandbox" && !GATE_IDS.includes(probe.ref)) missing.push(`${entry.id}/${probe.ref}(沙盒探针不在 GATE_IDS)`);
          const fileExists = (/** @type {string} */ rel) => ctx.exists?.(rel) === true;
          if ((probe.kind === "selftest" || probe.kind === "segment") && !fileExists(probe.ref)) {
            missing.push(`${entry.id}/${probe.ref}(载体不存在)`);
          }
        }
      }
      if (missing.length === 0) return;
      throw new Error(`以下门禁的探针登记不成立:\n  ${missing.join("\n  ")}`);
    });

    await suite.case("自检载体都被某道门禁认领(没有无主的负向自检代码)", () => {
      /** @type {Set<string>} */
      const claimed = new Set();
      for (const entry of entries) {
        for (const probe of entry.probes) {
          if (probe.kind === "selftest") claimed.add(probe.ref);
        }
      }
      /** @type {string[]} */
      const orphans = [];
      for (const [script, carrier] of Object.entries(PROBE_CARRIER_SCRIPTS)) {
        if (!claimed.has(carrier)) orphans.push(`${script} → ${carrier}`);
      }
      if (orphans.length === 0) return;
      throw new Error(`以下自检载体没有被任何门禁认领为探针:\n  ${orphans.join("\n  ")}`);
    });

    await suite.case("聚合入口 / 工具链步骤 / 自检载体三类豁免都带理由", () => {
      /** @type {string[]} */
      const noReason = [];
      for (const [name, why] of Object.entries(TOOLCHAIN_SCRIPTS)) {
        if (why.trim().length < 10) noReason.push(`TOOLCHAIN_SCRIPTS.${name}`);
      }
      for (const [file, why] of Object.entries(TOOLCHAIN_FILES)) {
        if (why.trim().length < 10) noReason.push(`TOOLCHAIN_FILES.${file}`);
      }
      // 聚合入口本身是链不是门禁,豁免理由由 CHAIN_ROOTS 的定义给出,故只核对集合一致
      const missingAggregator = AGGREGATOR_SCRIPTS.filter((name) => !CHAIN_ROOTS.includes(name));
      if (missingAggregator.length > 0) noReason.push(`聚合入口未在链根里:${missingAggregator.join(",")}`);
      if (noReason.length === 0) return;
      throw noReason.map((item) => `${item} 缺理由(理由缺失等于把一道真门禁悄悄挪进豁免)`).join("\n");
    });
  });

  await suite.describe("门禁注册表:判定本体三种驱动器共用", async () => {
    // ⚠ 这一格**不**无脑 import 每个指针:有三道门禁的模块顶层会自执行(见 topLevelSelfExecutions
    // 的字段注),import 它们等于把门禁真跑一遍 —— 其中 docs 会经 `execFileSync(process.execPath)`
    // 在 Electron 里起一个永不退出的 GUI 进程,段被框架硬终止(2026-10-01 实测)。
    // 故:声明 load:"static" 的走 auditJudgmentRef 的加严档(逐跳追 export {X} from 转发链,要求
    // 终点自己声明 X),其余**逐个真 import** 并要求解析出的是函数。
    // 分流的依据不是白名单,而是每条指针都必须与「顶层是否自执行」的事实一致 —— 那条一致性
    // 由 checkGateRegistry 的 judgment-load-mismatch 判据独立守着(改错了这里会连带判红)。
    await suite.case(
      "每个判定本体指针都能解析成可消费的判定(顶层自执行的走加严静态链,其余逐个真 import)",
      async () => {
        /** @type {string[]} */
        const broken = [];
        /** @type {string[]} */
        const imported = [];
        /** @type {string[]} */
        const staticChecked = [];
        for (const entry of entries) {
          const ref = entry.judgment;
          if (typeof ref === "function") {
            // 内联判定本体:直接验它是函数(不必 import)
            if (typeof ref !== "function") broken.push(`${entry.id}:内联判定本体不是函数`);
            continue;
          }
          if (ref.load === "static") {
            const audit = auditJudgmentRef(ctx, ref, { strict: true });
            if (audit !== null) broken.push(`${entry.id}:${audit}`);
            else staticChecked.push(entry.id);
            continue;
          }
          try {
            const judgment = await resolveJudgment(ctx, entry);
            if (typeof judgment !== "function") {
              broken.push(`${entry.id}:${ref.module} 的 ${ref.export} 解析为 ${typeof judgment}(不是可消费的判定)`);
              continue;
            }
            imported.push(entry.id);
          } catch (error) {
            broken.push(`${entry.id}:${error instanceof Error ? error.message : String(error)}`);
          }
        }
        console.log(
          `  [registry] 判定本体:真 import ${imported.length} 道 · 加严静态链 ${staticChecked.length} 道` +
            ` · 内联 ${entries.filter((e) => typeof e.judgment === "function").length} 道`,
        );
        if (broken.length === 0) return;
        throw new Error(`以下门禁的判定本体无法解析出可消费的判定:\n  ${broken.join("\n  ")}`);
      },
    );

    await suite.case("契约门禁的判定本体在注入根上求值(链序约束不误伤机制)", () => {
      // 正向:真实根上零问题,证明注入面可用
      const real = checkGateRegistry({});
      if (real.length > 0) throw new Error(`真实根上就判红,夹具对照无意义:${real.map((p) => p.code).join(",")}`);
      // 反向:发现面被换成「有一道无人登记的新门禁」时必须立刻判红 ——
      // 证明判定本体确实经注入面求值,而不是硬编码真实仓库路径。
      const found = discoverInvocations(ctx);
      found.set("npm:check:brand-new", {
        kind: "npm",
        name: "check:brand-new",
        sources: new Set(["chain:verify:ci"]),
        onChain: true,
        onWorkflow: false,
      });
      expectCode(
        checkGateRegistry({ deps: { invocations: found } }).map((p) => p.code),
        "invocation-unregistered",
      );
    });
  });

  await suite.describe("门禁注册表:负向夹具(证明判据不是恒绿)", async () => {
    await suite.case("抽掉一道门禁的探针 → probe-missing", () => {
      expectCode(codesOf((r) => { r.contract.probes = []; }), "probe-missing");
    });

    await suite.case("探针指向不存在的载体 → probe-missing", () => {
      expectCode(
        codesOf((r) => {
          r.boundary.probes = [{ kind: "segment", ref: "test/core/does-not-exist.test.js", why: "指向不存在的段,应当判红" }];
        }),
        "probe-missing",
      );
    });

    await suite.case("沙盒探针 id 不在 GATE_IDS → probe-missing(登记了但不会被执行)", () => {
      expectCode(
        codesOf((r) => {
          r.coverage.probes = [{ kind: "sandbox", ref: "no-such-probe", why: "不存在的沙盒探针 id,应当判红" }];
        }),
        "probe-missing",
      );
    });

    await suite.case("链上新出现的门禁无人登记 → invocation-unregistered", () => {
      const found = discoverInvocations(ctx);
      found.set("npm:check:brand-new", {
        kind: "npm",
        name: "check:brand-new",
        sources: new Set(["chain:verify:ci"]),
        onChain: true,
        onWorkflow: false,
      });
      const codes = checkGateRegistry({ deps: { invocations: found } }).map((p) => p.code);
      expectCode(codes, "invocation-unregistered");
    });

    await suite.case("workflow 裸调路径无人登记 → invocation-unregistered(只登记 npm script 会漏的那条)", () => {
      const found = discoverInvocations(ctx);
      found.set("file:gates/repo/check-not-registered.mjs", {
        kind: "file",
        name: "gates/repo/check-not-registered.mjs",
        sources: new Set(["workflow:ci.yml"]),
        onChain: false,
        onWorkflow: true,
      });
      const codes = checkGateRegistry({ deps: { invocations: found } }).map((p) => p.code);
      expectCode(codes, "invocation-unregistered");
    });

    await suite.case("判定本体指针指向不存在的导出 → judgment-ref-broken(可安全 import 的那批)", () => {
      expectCode(
        codesOf((r) => {
          r["pinned-actions"].judgment = { module: "gates/repo/check-pinned-actions.mjs", export: "analyzeTypo", shaped: "{ problems }" };
        }),
        "judgment-ref-broken",
      );
    });

    await suite.case("判定本体指针指向不存在的导出 → judgment-ref-broken(声明 static 的那批,加严静态链同样抓得到)", () => {
      expectCode(
        codesOf((r) => {
          r.docs.judgment = { module: "gates/repo/check-docs.mjs", export: "mainTypo", shaped: "退出码", load: "static" };
        }),
        "judgment-ref-broken",
      );
    });

    await suite.case("判定转发目标悬空 → judgment-ref-broken(只有加严档追转发链才看得见)", () => {
      // 真实转发形状:pack-size.mjs 里有一行 `export { evaluate, parseBaseline } from './pack-size/baseline.mjs'`,
      // 而 evaluate 在本模块**没有本地声明**。判据必须沿这条链追到 baseline.mjs 才算证明。
      // 把导出名换成链上不存在的名字:普通档(只搜「本模块文本里出现过这个名字」)会放过它,
      // 加严档追到底端发现终点也没声明 ⇒ 判红。这正是 static 档存在的理由。
      expectCode(
        codesOf((r) => {
          r["pack-size"].judgment = {
            module: "gates/artifacts/pack-size.mjs",
            export: "evaluateViaDanglingReexport",
            shaped: "体积判定",
            load: "static",
          };
        }),
        "judgment-ref-broken",
      );
      // 反向锚点:同一条链上**真实存在**的转发名必须判绿(证明加严档不是「一律判红」)
      const okCodes = codesOf((r) => {
        r["pack-size"].judgment = {
          module: "gates/artifacts/pack-size.mjs",
          export: "evaluate",
          shaped: "体积判定",
          load: "static",
        };
      });
      if (okCodes.includes("judgment-ref-broken")) {
        throw new Error("真实转发名 evaluate 被加严档误判为悬空(追链逻辑有误):" + okCodes.join(","));
      }
    });

    await suite.case("load 声明与顶层自执行事实不符 → judgment-load-mismatch(自执行模块谎报可 import)", () => {
      // 正向:顶层会自执行的模块谎报成可安全 import —— import 它可能经 process.execPath 起 GUI
      // 进程(2026-10-01 段硬超时的根因),必须在门禁层就拦住。
      // 被测主体是**合成模块文本**(仓内不存在该文件),不是某个恰好在自执行的真实模块:
      // REQ-118 之后全仓已无自执行模块,指真实文件会让本夹具退化成恒绿(见夹具头注)。
      const codes = checkGateRegistry({
        ...ctxWithSyntheticModules({ [SELF_EXECUTING_MODULE_REL]: SELF_EXECUTING_MODULE_TEXT }),
        deps: { registry: synth((r) => {
          r.docs.judgment = { module: SELF_EXECUTING_MODULE_REL, export: "main", shaped: "退出码" };
        }) },
      }).map((item) => item.code);
      expectCode(codes, "judgment-load-mismatch");
      // 合成主体本身是判红的**唯一**来源:同一个指针配同一段文本、声明成 static(即与事实相符)
      // 就必须不报 load 不匹配 —— 否则这条判据在退化成「凡是 static 指针就红」时也会照样绿。
      const agreeCodes = checkGateRegistry({
        ...ctxWithSyntheticModules({ [SELF_EXECUTING_MODULE_REL]: SELF_EXECUTING_MODULE_TEXT }),
        deps: { registry: synth((r) => {
          r.docs.judgment = { module: SELF_EXECUTING_MODULE_REL, export: "main", shaped: "退出码", load: "static" };
        }) },
      }).map((item) => item.code);
      if (agreeCodes.includes("judgment-load-mismatch")) {
        throw new Error(`声明与事实相符(顶层确实自执行 + 已声明 static)却仍报 load 不匹配:${agreeCodes.join(",")}`);
      }
    });

    await suite.case("load 声明与顶层自执行事实不符 → judgment-load-mismatch(可 import 模块谎报 static)", () => {
      // 反向:可安全 import 的模块谎报 static ⇒ 白丢一次真 import 证据,同样判红。
      // 单向成立的判据等于半个判据,故两个方向都必须有夹具。被测主体同样是合成文本(顶层干净)。
      const codes = checkGateRegistry({
        ...ctxWithSyntheticModules({ [IMPORTABLE_MODULE_REL]: IMPORTABLE_MODULE_TEXT }),
        deps: { registry: synth((r) => {
          r.docs.judgment = { module: IMPORTABLE_MODULE_REL, export: "main", shaped: "退出码", load: "static" };
        }) },
      }).map((item) => item.code);
      expectCode(codes, "judgment-load-mismatch");
      // 反向锚点:同一段「顶层干净」文本不声明 static(即与事实相符)就不该报 —— 证明这条
      // 判据比对的是「声明 vs 事实」,不是「凡是 load 字段就红」。
      const agreeCodes = checkGateRegistry({
        ...ctxWithSyntheticModules({ [IMPORTABLE_MODULE_REL]: IMPORTABLE_MODULE_TEXT }),
        deps: { registry: synth((r) => {
          r.docs.judgment = { module: IMPORTABLE_MODULE_REL, export: "main", shaped: "退出码" };
        }) },
      }).map((item) => item.code);
      if (agreeCodes.includes("judgment-load-mismatch")) {
        throw new Error(`声明与事实相符(顶层不自执行 + 未声明 static)却仍报 load 不匹配:${agreeCodes.join(",")}`);
      }
    });

    await suite.case("判定本体指针指向不存在的模块 → judgment-module-missing", () => {
      expectCode(
        codesOf((r) => {
          r.signature.judgment = { module: "gates/artifacts/gone.mjs", export: "classifyAuthenticode", shaped: "x" };
        }),
        "judgment-module-missing",
      );
    });

    await suite.case("实现文件不存在 → module-missing(目录迁移后忘了跟判定体)", () => {
      expectCode(
        codesOf((r) => {
          r.asar.modulePath = "gates/artifacts/check-asar-manifest-typo.mjs";
        }),
        "module-missing",
      );
    });

    await suite.case("声明可达但实际没人调 → access-mismatch", () => {
      // 前置断言:载体此刻必须仍是 local 且不在链上。载体失效时注入就是空操作(恒绿),
      // 而门禁全绿里看不出「这条夹具已经证明不了任何事」—— 故先判红并给出可分辨诊断。
      const carrierProblem = accessMismatchCarrierProblem(ctx);
      if (carrierProblem !== null) {
        throw new Error(`注入载体前置断言不通过,夹具会恒绿:${carrierProblem}`);
      }
      expectCode(
        codesOf((r) => {
          r[ACCESS_MISMATCH_CARRIER].access = "chain";
        }),
        "access-mismatch",
      );
    });

    await suite.case("声明本地但实际被链调 → access-mismatch(本地检查被悄悄挪进链)", () => {
      expectCode(
        codesOf((r) => {
          r["dual-matrix"].npmScripts = ["check:geometry"];
        }),
        "access-mismatch",
      );
    });

    await suite.case("自检载体没人认领 → probe-carrier-orphan", () => {
      expectCode(
        codesOf((r) => {
          r["temp-cleanup"].probes = r["temp-cleanup"].probes.filter((/** @type {any} */ p) => p.kind !== "selftest");
        }),
        "probe-carrier-orphan",
      );
    });

    await suite.case("载体 script 不在链上 → probe-carrier-offchain(把链上那道负向夹具摘掉,无人判红)", () => {
      // 真实事故形态:从 verify:ci 上摘掉一条 `*:selftest`。判据必须只靠「发现面」判红 ——
      // 登记项一个字节都不动(载体仍被认领、npmScripts 里也从不含 selftest)。
      // 只改内存里的注入对象,真实 package.json 一个字节都不碰。
      const found = discoverInvocations(ctx);
      const script = "check:temp-cleanup:selftest";
      const hit = found.get(`npm:${script}`);
      if (hit === undefined) throw new Error(`发现面里没有 ${script},夹具前提不成立(链解析面变了?)`);
      // 只把「在链上」这个事实翻掉,来源标注照旧(模拟它从链上消失、但登记项仍写着它)
      found.set(`npm:${script}`, { ...hit, onChain: false, sources: new Set(["已不在链上"]) });

      const codes = checkGateRegistry({ deps: { invocations: found } }).map((p) => p.code);
      expectCode(codes, "probe-carrier-offchain");
      // 判红必须**只**来自 R5c:反向锚点证明判据没有顺带把别的口径搅浑
      const noise = codes.filter((code) => code !== "probe-carrier-offchain");
      if (noise.length > 0) throw new Error(`R5c 之外还冒出了别的 code(夹具注入面不干净):${noise.join(",")}`);

      // 三步验法的第三步:撤回注入后必须复绿 —— 否则这条判据是恒红的
      const restored = checkGateRegistry({ deps: { invocations: discoverInvocations(ctx) } }).map((p) => p.code);
      if (restored.includes("probe-carrier-offchain")) {
        throw new Error(`撤回注入后仍报 probe-carrier-offchain(恒红判据):${restored.join(",")}`);
      }
      // 更强的锚点:把链上**所有**载体都摘掉也必须逐条判红 —— 证明判据逐个 script 求值,
      // 而不是只看第一个就收工
      const allOff = discoverInvocations(ctx);
      for (const key of Object.keys(PROBE_CARRIER_SCRIPTS)) {
        const carrier = allOff.get(`npm:${key}`);
        if (carrier === undefined) throw new Error(`发现面里没有 ${key},全体脱链夹具前提不成立`);
        allOff.set(`npm:${key}`, { ...carrier, onChain: false });
      }
      const allCodes = checkGateRegistry({ deps: { invocations: allOff } }).map((p) => p.code);
      const offCount = allCodes.filter((code) => code === "probe-carrier-offchain").length;
      if (offCount !== Object.keys(PROBE_CARRIER_SCRIPTS).length) {
        throw new Error(
          `把 ${Object.keys(PROBE_CARRIER_SCRIPTS).length} 条载体全部摘下链,只判红 ${offCount} 条(判据提前收工?):${[...new Set(allCodes)].join(",")}`,
        );
      }
    });

    await suite.case("探针没写理由 → probe-reason-missing", () => {
      expectCode(
        codesOf((r) => {
          r["pinned-actions"].probes = [{ kind: "segment", ref: "test/gates/pinned-actions.test.js", why: "" }];
        }),
        "probe-reason-missing",
      );
    });
  });

  console.log(
    `[ok] gate-registry:注册表 ${entries.length} 道门禁 / 调用点发现覆盖链与 workflow 两条路径 / ` +
      `${entries.reduce((sum, entry) => sum + entry.probes.length, 0)} 道探针登记齐备;负向夹具全部判红`,
  );
  return { cases: suite.results };
}