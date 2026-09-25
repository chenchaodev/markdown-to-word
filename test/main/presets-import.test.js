/**
 * 预设 JSON 导入/导出纯函数直测(src/main/persist/settings.ts parsePresetsFile/mergePresets):
 * 纯 Node 段(经 dist/main/persist/settings.js 导入,不触对话框/文件 IO——那部分走 GUI 实测)。
 * 断言面(与实现逐条对应):
 * - parsePresetsFile:schemaVersion:1 包装解析 / 裸数组兼容 / 坏 JSON → 「文件不是有效的 JSON」/
 *   schemaVersion 非 1(2/缺失/字符串)→ 「不支持的模板文件版本」/ 非法条目丢弃(空名/坏 pageSetup/
 *   非对象)+ 边距钳制 + 同名去重保留先出现 / 空 presets([]/全非法/对象缺 presets)→
 *   「文件不含有效预设」/ 超 10 条截断
 * - mergePresets:同名覆盖(incoming 优先,值取 incoming)/ 无同名纯追加(incoming 在前)/
 *   上限截断 10(incoming 全保留)/ imported-overridden 计数 / 空侧边界 / 入参不被修改
 */
import {
  mergePresets,
  parsePresetsFile,
} from "../../dist/main/persist/settings.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`presets-import 断言失败:${msg}`);
}

const preset = (name, typography = {}, pageSetup = {}) => ({ name, typography, pageSetup });

/** 预设导入/导出纯函数直测(纯 Node 段,零 Electron API) */
export async function run() {
  // ---------- parsePresetsFile ----------
  // 1. 合法 schemaVersion:1 包装:字段原样保留
  const r1 = parsePresetsFile(
    JSON.stringify({
      schemaVersion: 1,
      presets: [
        preset("我的模板", { bodySizePt: 13, fontEastAsia: "宋体" }, { marginTop: 20, paper: "A4" }),
      ],
    }),
  );
  assert(r1.ok && r1.presets.length === 1, "schemaVersion:1 包装应解析成功");
  if (r1.ok) {
    assert(
      r1.presets[0].name === "我的模板" &&
        r1.presets[0].typography.bodySizePt === 13 &&
        r1.presets[0].typography.fontEastAsia === "宋体" &&
        r1.presets[0].pageSetup.marginTop === 20 &&
        r1.presets[0].pageSetup.paper === "A4",
      "合法条目 name/typography/pageSetup 应原样保留",
    );
  }

  // 2. 裸数组兼容(归一化)
  const r2 = parsePresetsFile(JSON.stringify([preset("裸数组模板")]));
  assert(r2.ok && r2.presets.length === 1 && r2.presets[0].name === "裸数组模板", "裸数组应兼容(归一化)");

  // 3. 坏 JSON → 「文件不是有效的 JSON」
  const r3 = parsePresetsFile("{not json!!");
  assert(!r3.ok && r3.error === "文件不是有效的 JSON", "坏 JSON → 「文件不是有效的 JSON」");

  // 4. schemaVersion 非 1(2 / 缺失 / 字符串)→ 「不支持的模板文件版本」
  for (const bad of [
    JSON.stringify({ schemaVersion: 2, presets: [preset("x")] }),
    JSON.stringify({ presets: [preset("x")] }),
    JSON.stringify({ schemaVersion: "1", presets: [preset("x")] }),
    JSON.stringify("hello"),
    JSON.stringify(123),
  ]) {
    const r = parsePresetsFile(bad);
    assert(!r.ok && r.error === "不支持的模板文件版本", `schemaVersion 非 1(${bad})→ 「不支持的模板文件版本」`);
  }

  // 5. 非法条目丢弃(空名/坏 pageSetup/非对象)+ 边距钳制 + 同名去重保留先出现
  const r5 = parsePresetsFile(
    JSON.stringify([
      preset("合法", { bodySizePt: 13 }, { marginTop: -5, marginBottom: 20, marginLeft: 30, marginRight: 40 }),
      preset(""), // 空名 → 丢弃
      preset("坏数据", {}, "nope"), // pageSetup 非法 → 整条丢弃
      "not-an-object", // 非对象 → 丢弃
      preset("合法", { bodySizePt: 99 }), // 同名 → 丢弃(保留先出现)
    ]),
  );
  assert(r5.ok && r5.presets.length === 1, "非法条目(空名/坏 pageSetup/非对象)与同名应丢弃");
  if (r5.ok) {
    assert(r5.presets[0].typography.bodySizePt === 13, "同名去重应保留先出现条目");
    assert(r5.presets[0].pageSetup.marginTop === 0, "边距应钳制(-5 → 0)");
  }

  // 6. 空 presets([] / 全非法 / 对象缺 presets 字段)→ 「文件不含有效预设」
  for (const r of [
    parsePresetsFile("[]"),
    parsePresetsFile(JSON.stringify({ schemaVersion: 1, presets: [] })),
    parsePresetsFile(JSON.stringify({ schemaVersion: 1, presets: [{ name: "", pageSetup: {} }] })),
    parsePresetsFile(JSON.stringify({ schemaVersion: 1 })), // 缺 presets 字段
  ]) {
    assert(!r.ok && r.error === "文件不含有效预设", "空/全非法/缺 presets → 「文件不含有效预设」");
  }

  // 7. 超 10 条截断(保留先出现)
  const many = [];
  for (let i = 0; i < 12; i++) many.push(preset(`p${i}`));
  const r7 = parsePresetsFile(JSON.stringify({ schemaVersion: 1, presets: many }));
  assert(r7.ok && r7.presets.length === 10 && r7.presets[0].name === "p0", "超 10 条应截断(保留先出现)");
  console.log("[ok] presets-import:parsePresetsFile(schemaVersion:1/裸数组/坏 JSON/版本非 1/非法丢弃+钳制/空 presets/截断 10)断言通过");

  // ---------- mergePresets ----------
  // 1. 同名覆盖:incoming 优先(值取 incoming),其余 existing 追加在后
  const m1 = mergePresets(
    [preset("A", { bodySizePt: 10 }, { marginTop: 10 }), preset("B")],
    [preset("A", { bodySizePt: 14 }, { marginTop: 20 })],
  );
  assert(m1.presets.length === 2, "同名覆盖后数量不变");
  assert(
    m1.presets[0].name === "A" &&
      m1.presets[0].typography.bodySizePt === 14 &&
      m1.presets[0].pageSetup.marginTop === 20,
    "同名项应取 incoming 值(覆盖)",
  );
  assert(m1.presets[1].name === "B", "其余 existing 项追加在后");
  assert(m1.imported === 1 && m1.overridden === 1, "imported=1 / overridden=1");

  // 2. 无同名纯追加:incoming 在前
  const m2 = mergePresets([preset("A")], [preset("C"), preset("D")]);
  assert(m2.presets.map((p) => p.name).join(",") === "C,D,A", "无同名 → incoming 在前追加");
  assert(m2.imported === 2 && m2.overridden === 0, "imported=2 / overridden=0");

  // 3. 上限截断:existing 8 + incoming 3 → 10(incoming 全保留,existing 尾部截断)
  const e3 = [];
  for (let i = 0; i < 8; i++) e3.push(preset(`e${i}`));
  const m3 = mergePresets(e3, [preset("i0"), preset("i1"), preset("i2")]);
  assert(m3.presets.length === 10, "超上限应截断到 10");
  assert(m3.presets[0].name === "i0" && m3.presets[9].name === "e6", "incoming 全保留在前,existing 截断在后");
  assert(m3.imported === 3 && m3.overridden === 0, "imported=3 / overridden=0");

  // 4. 混合:existing [A,B] + incoming [B',C,D] → [B',C,D,A]
  const m4 = mergePresets(
    [preset("A"), preset("B")],
    [preset("B", { bodySizePt: 15 }), preset("C"), preset("D")],
  );
  assert(m4.presets.map((p) => p.name).join(",") === "B,C,D,A", "同名覆盖 + 追加合并顺序正确");
  assert(m4.presets[0].typography.bodySizePt === 15, "覆盖项应取 incoming 值");
  assert(m4.imported === 3 && m4.overridden === 1, "imported=3 / overridden=1");

  // 5. 截断 + 同名:existing 9 条(A1..A9)+ incoming [A1',B,C] → 10 条(A1' 覆盖)
  const e5 = [];
  for (let i = 1; i <= 9; i++) e5.push(preset(`A${i}`));
  const m5 = mergePresets(e5, [preset("A1", { bodySizePt: 16 }), preset("B"), preset("C")]);
  assert(m5.presets.length === 10, "截断到 10");
  assert(m5.presets[0].name === "A1" && m5.presets[0].typography.bodySizePt === 16, "覆盖项应取 incoming 值");
  assert(m5.presets[9].name === "A8", "existing 尾部截断");
  assert(m5.imported === 3 && m5.overridden === 1, "imported=3 / overridden=1");

  // 6. 边界:existing 空 → 全 incoming;incoming 空 → existing 原样
  const m6 = mergePresets([], [preset("X")]);
  assert(
    m6.presets.length === 1 && m6.presets[0].name === "X" && m6.imported === 1 && m6.overridden === 0,
    "existing 空 → 全 incoming",
  );
  const m7 = mergePresets([preset("A")], []);
  assert(
    m7.presets.length === 1 && m7.presets[0].name === "A" && m7.imported === 0 && m7.overridden === 0,
    "incoming 空 → existing 原样",
  );

  // 7. 入参不被修改(结果为新对象数组)
  const e8 = [preset("A")];
  const i8 = [preset("A", { bodySizePt: 17 })];
  mergePresets(e8, i8);
  assert(e8[0].typography.bodySizePt === undefined, "existing 入参不应被修改");
  assert(i8[0].typography.bodySizePt === 17, "incoming 入参不应被修改");
  console.log("[ok] presets-import:mergePresets(同名覆盖/纯追加/截断/计数/边界/入参不改)断言通过");
}