/**
 * 主进程 IPC 纯逻辑层直测(src/main/ipc/logic.ts:自 index.ts IPC handler 抽出):
 * 零 Electron API 纯函数,经 dist/main/ipc/logic.js 直接断言(Node 段)。
 * 断言面(可验证事实,与抽取前行为逐一对应):
 * - errorMessage:Error → message;字符串 → 原样;null/对象 → String(err)
 * - buildRecentFileEntries:过滤非字符串/空串;name 取 basename;format/ts 透传
 * - baseNameFromMdPath:.md/.markdown 去扩展(大小写不敏感);其它扩展/无扩展原样
 * - importPresetsFromText:坏 JSON/版本非 1/空 presets → 原错误文案透传;
 *   合法 → 合并序(incoming 在前)/同名取 incoming 值/imported-overridden 计数
 * - buildPresetsExportPayload:schemaVersion:1 包装 + 2 空格缩进 + 末尾换行(序列化字符串精确断言)
 * - isString/isStringArray/isConvertFormat:IPC 入参类型守卫(元素逐一校验/格式白名单)
 * - runConvertTask(自 index.ts runWithCtx 抽出的纯核心,deps 注入):
 *   成功透传任务值 / 取消错误 → onCanceled() 形态 / 其他错误归一 { ok:false,error } /
 *   register-finally 注销序(含异常与取消路径)/ ctx 每次新建不复用
 */
import {
  baseNameFromMdPath,
  buildPresetsExportPayload,
  buildRecentFileEntries,
  errorMessage,
  importPresetsFromText,
  isConvertFormat,
  isString,
  isStringArray,
  runConvertTask,
} from "../../dist/main/ipc/logic.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`ipc-logic 断言失败:${msg}`);
}

const preset = (name, typography = {}, pageSetup = {}) => ({ name, typography, pageSetup });

/** 主进程 IPC 纯逻辑直测(纯 Node 段,零 Electron API) */
export async function run() {
  // ---------- errorMessage ----------
  assert(errorMessage(new Error("boom")) === "boom", "Error → message");
  assert(errorMessage("直接字符串") === "直接字符串", "字符串 → 原样");
  assert(errorMessage(null) === "null", "null → String(null)");
  assert(errorMessage({ a: 1 }) === "[object Object]", "对象 → String(err)");
  console.log("[ok] errorMessage:Error/字符串/null/对象 归一断言通过");

  // ---------- buildRecentFileEntries ----------
  const entries = buildRecentFileEntries(
    ["C:/docs/a.md", "", "C:/docs/b.pdf", 42, "C:/docs/c.MD"],
    "docx",
    123456,
  );
  assert(entries.length === 3, "非字符串/空串应被过滤");
  assert(
    entries[0].path === "C:/docs/a.md" && entries[0].name === "a.md",
    "name 应取 basename",
  );
  assert(entries[1].name === "b.pdf", "非 md 扩展也应取 basename");
  assert(entries[2].name === "c.MD", "basename 大小写保留");
  assert(
    entries.every((e) => e.format === "docx" && e.ts === 123456),
    "format/ts 应透传",
  );
  assert(buildRecentFileEntries([], "pdf", 1).length === 0, "空列表 → 空结果");
  console.log("[ok] buildRecentFileEntries:过滤/name=basename/format-ts 透传/空列表 断言通过");

  // ---------- baseNameFromMdPath ----------
  assert(baseNameFromMdPath("C:/docs/报告.md") === "报告", ".md 应去除");
  assert(baseNameFromMdPath("C:/docs/notes.MARKDOWN") === "notes", ".MARKDOWN 大小写不敏感");
  assert(baseNameFromMdPath("C:/docs/archive.tar.md") === "archive.tar", "仅去末尾 .md");
  assert(baseNameFromMdPath("C:/docs/readme.txt") === "readme.txt", "其它扩展原样");
  assert(baseNameFromMdPath("C:/docs/noext") === "noext", "无扩展原样");
  console.log("[ok] baseNameFromMdPath:.md/.MARKDOWN 去除/仅末尾/其它扩展/无扩展 断言通过");

  // ---------- importPresetsFromText ----------
  // 1. 坏 JSON → 原错误文案透传
  const r1 = importPresetsFromText("{not json!!", []);
  assert(!r1.ok && r1.error === "文件不是有效的 JSON", "坏 JSON → 「文件不是有效的 JSON」");
  // 2. schemaVersion 非 1 → 原错误文案透传
  const r2 = importPresetsFromText(JSON.stringify({ schemaVersion: 2, presets: [preset("x")] }), []);
  assert(!r2.ok && r2.error === "不支持的模板文件版本", "schemaVersion 非 1 → 「不支持的模板文件版本」");
  // 3. 空 presets → 「文件不含有效预设」
  const r3 = importPresetsFromText("[]", []);
  assert(!r3.ok && r3.error === "文件不含有效预设", "空 presets → 「文件不含有效预设」");
  // 4. 合法:同名覆盖 + 追加,imported/overridden 计数
  const r4 = importPresetsFromText(
    JSON.stringify({
      schemaVersion: 1,
      presets: [preset("A", { bodySizePt: 14 }), preset("B")],
    }),
    [preset("A", { bodySizePt: 10 })],
  );
  assert(r4.ok, "合法导入应成功");
  if (r4.ok) {
    assert(r4.presets.map((p) => p.name).join(",") === "A,B", "合并序:incoming 在前");
    assert(r4.presets[0].typography.bodySizePt === 14, "同名项取 incoming 值");
    assert(r4.imported === 2 && r4.overridden === 1, "imported=2 / overridden=1");
  }
  console.log("[ok] importPresetsFromText:错误文案透传(坏 JSON/版本/空)/合并序/同名覆盖/计数 断言通过");

  // ---------- buildPresetsExportPayload ----------
  const payload = buildPresetsExportPayload([preset("我的模板")]);
  const expected = `{
  "schemaVersion": 1,
  "presets": [
    {
      "name": "我的模板",
      "typography": {},
      "pageSetup": {}
    }
  ]
}
`;
  assert(payload === expected, "导出载荷应精确匹配(schemaVersion:1 + 2 空格缩进 + 末尾换行)");
  assert(
    buildPresetsExportPayload([]) === `{\n  "schemaVersion": 1,\n  "presets": []\n}\n`,
    "空预设导出载荷应精确匹配",
  );
  console.log("[ok] buildPresetsExportPayload:序列化字符串精确断言(单条/空列表)通过");

  // ---------- IPC 入参类型守卫 ----------
  assert(isString("x") === true && isString(42) === false, "isString:string/非字符串");
  assert(isStringArray(["a", "b"]) === true, "isStringArray:纯字符串数组通过");
  assert(isStringArray([]) === true, "isStringArray:空数组通过");
  assert(isStringArray(["a", 42]) === false, "isStringArray:混入非字符串元素拒绝");
  assert(isStringArray("a,b") === false, "isStringArray:非数组拒绝");
  assert(isStringArray(null) === false, "isStringArray:null 拒绝");
  assert(isConvertFormat("docx") && isConvertFormat("pdf"), "isConvertFormat:docx/pdf 白名单");
  assert(!isConvertFormat("DOCX") && !isConvertFormat("html"), "isConvertFormat:大小写敏感/未知格式拒绝");
  console.log("[ok] IPC 入参守卫:isString/isStringArray/isConvertFormat 断言通过");

  // ---------- runConvertTask(自 index.ts runWithCtx 抽出,deps 注入直测) ----------
  /** 构造带事件记录的 mock deps(镜像 index.ts 真实注入:ctx 新建/注册/注销 + 取消判定) */
  function makeDeps({ canceledErrors = [] } = {}) {
    const log = [];
    let seq = 0;
    return {
      log,
      deps: {
        createContext: () => ({ id: ++seq }),
        registerCtx: (ctx) => log.push(["register", ctx.id]),
        unregisterCtx: () => log.push(["unregister"]),
        isCanceledError: (err) => canceledErrors.includes(err),
      },
    };
  }

  // 1. 成功路径:任务值透传;register → task → finally unregister
  {
    const { deps, log } = makeDeps();
    const result = await runConvertTask(deps, async (ctx) => `ok:${ctx.id}`, () => "canceled");
    assert(result === "ok:1", `成功路径应透传任务值,实际 ${JSON.stringify(result)}`);
    assert(
      JSON.stringify(log) === JSON.stringify([["register", 1], ["unregister"]]),
      `成功路径生命周期应为 register→unregister,实际 ${JSON.stringify(log)}`,
    );
  }
  // 2. 取消路径:取消错误 → onCanceled() 形态原样返回(含 canceled:true 扩展字段);finally 注销
  {
    const cancelErr = new Error("canceled");
    const { deps, log } = makeDeps({ canceledErrors: [cancelErr] });
    const onCanceledResult = { ok: false, canceled: true, error: "已取消" };
    const result = await runConvertTask(
      deps,
      async () => {
        throw cancelErr;
      },
      () => onCanceledResult,
    );
    assert(result === onCanceledResult, "取消路径应原样返回 onCanceled() 结果");
    assert(log[log.length - 1][0] === "unregister", "取消路径 finally 也应注销引用(避免悬挂)");
  }
  // 3. 非取消错误归一:{ ok:false, error } 且 error 经 errorMessage(Error→message/非 Error→String)
  {
    const { deps } = makeDeps();
    const r1 = await runConvertTask(deps, async () => {
      throw new Error("磁盘错误");
    }, () => "canceled");
    assert(r1.ok === false && r1.error === "磁盘错误", `Error 应归一为 { ok:false, error:message },实际 ${JSON.stringify(r1)}`);
    const r2 = await runConvertTask(deps, async () => {
      throw "裸字符串错误";
    }, () => "canceled");
    assert(r2.ok === false && r2.error === "裸字符串错误", "非 Error 抛出值应 String 归一");
  }
  // 4. ctx 每次调用新建不复用(「取消后复位」语义)+ 失败不残留注册
  {
    const { deps, log } = makeDeps();
    await runConvertTask(deps, async (ctx) => ctx.id, () => "canceled"); // 第一次
    await runConvertTask(deps, async (ctx) => ctx.id, () => "canceled"); // 第二次
    const ctxIds = log.filter((e) => e[0] === "register").map((e) => e[1]);
    assert(ctxIds.length === 2 && ctxIds[0] !== ctxIds[1], `每次调用应新建 ctx,实际 ${JSON.stringify(ctxIds)}`);
    assert(log.filter((e) => e[0] === "unregister").length === 2, "每次调用结束都应注销");
  }
  // 5. 任务抛错时后续仍可正常执行(finally 先于返回值落地,无悬挂注册)
  {
    const { deps, log } = makeDeps();
    await runConvertTask(deps, async () => {
      throw new Error("x");
    }, () => "canceled").catch(() => undefined);
    const ok = await runConvertTask(deps, async (ctx) => ctx.id, () => "canceled");
    assert(ok === 2, `失败后再次调用应拿到新 ctx(id=2)正常完成,实际 ${JSON.stringify(ok)}`);
    assert(log.filter((e) => e[0] === "unregister").length === 2, "失败+成功两次调用各注销一次");
  }
  console.log("[ok] runConvertTask:成功透传/取消形态/错误归一/ctx 新建不复用/finally 注序 断言通过");
}