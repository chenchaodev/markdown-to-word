// 探针判定口径(全仓单源):退出码期望 + 期望诊断关键字 + 禁止出现关键字,三者合成 ok。
//
// 为什么把判定单独收口:各门禁探针只负责「跑什么、注入什么故障、期望什么关键字」,
// 「怎么算通过」必须只有一处实现,否则门禁之间会各写一套判定并悄悄漂移。
// 只看退出码不够:脚本因自身错误/参数写错而失败同样是「非 0」,必须靠关键字把
// 「因错误原因失败」与「门禁抓到了故障」区分开。
import { GATE_META } from "./contract.mjs";

/**
 * 判定并登记一条探针结果:退出码期望 + 期望关键字 + 禁止关键字,三者合成 ok。
 * @param {object} spec 探针声明
 * @param {string} spec.id 探针 id
 * @param {ProbeKind} spec.kind 类别
 * @param {string} spec.description 做了什么
 * @param {string} [spec.fault] 注入的故障
 * @param {ExitExpectation} spec.expect 退出码期望
 * @param {string[]} [spec.expectKeywords] 期望命中的诊断关键字
 * @param {string[]} [spec.forbiddenKeywords] 不该出现的关键字(命中即失败)
 * @param {boolean} [spec.informational] 只观测不判定
 * @param {import("./smoke-proc.mjs").ProcessRunResult} result 子进程结果
 * @param {string} [spec.note] 补充说明
 * @returns {ProbeCase} 探针结果
 */
export function judgeCase(spec, result, note) {
  const expectKeywords = spec.expectKeywords ?? [];
  const forbiddenKeywords = spec.forbiddenKeywords ?? [];
  const output = result.output;
  const diagnosticHits = expectKeywords.filter((keyword) => output.includes(keyword));
  const forbiddenHits = forbiddenKeywords.filter((keyword) => output.includes(keyword));
  const exitAsExpected = spec.expect === "zero" ? result.code === 0 : result.code !== 0 && !result.timedOut;
  const ok = exitAsExpected && diagnosticHits.length === expectKeywords.length && forbiddenHits.length === 0;
  return {
    id: spec.id,
    kind: spec.kind,
    description: spec.description,
    ...(spec.fault === undefined ? {} : { fault: spec.fault }),
    expect: spec.expect,
    ok,
    ...(spec.informational === true ? { informational: true } : {}),
    exitCode: result.code,
    timedOut: result.timedOut,
    diagnosticHits,
    missingKeywords: expectKeywords.filter((keyword) => !output.includes(keyword)),
    forbiddenHits,
    ...(note === undefined || note === "" ? {} : { note }),
  };
}

/**
 * 组装单道门禁结果(verdict = 非观测类探针全绿)。
 * @param {string} id 门禁 id
 * @param {object} payload 门禁载荷
 * @param {boolean} payload.sandboxed 是否全程沙盒内
 * @param {string[]} payload.sandboxInputs 沙盒内容
 * @param {ProbeCase[]} payload.cases 探针结果
 * @param {ProbeFinding[]} [payload.findings] 登记项
 * @param {string} [payload.note] 备注
 * @returns {GateProbeResult} 门禁结果
 */
export function finalizeGate(id, payload) {
  const decisive = payload.cases.filter((c) => c.informational !== true);
  const meta = GATE_META[id];
  return {
    id,
    title: meta.title,
    npmScript: meta.npmScript,
    command: meta.command,
    sandboxed: payload.sandboxed,
    sandboxInputs: payload.sandboxInputs,
    verdict: decisive.every((c) => c.ok) && decisive.length > 0 ? "pass" : "fail",
    cases: payload.cases,
    findings: payload.findings ?? [],
    ...(payload.note === undefined ? {} : { note: payload.note }),
  };
}
