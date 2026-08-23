/**
 * 原子 JSON 写入器直测(位于 test/main/ = 主进程层;src/main/atomic-json.ts,
 * 测试经 dist/main/atomic-json.js,electron 环境):
 * settings.ts / ui-state.ts 共享的原子写工具(B15 自双份实现抽出),断言面:
 * - 原子写落盘读回:内容 = JSON.stringify(value,null,2)+"\n",tmp 文件写后不残留
 * - 写队列串行顺序:同实例并发多次写,完成序 = 调用序(onCommitted 回调序),
 *   链尾即最终态(文件内容 = 最后一次写入)
 * - 并发调用不交叉:不同实例独立队列互不阻塞;同实例并发各写各的目标文件
 * - 失败路径:单次写失败(tmp 目录不存在 → ENOENT)不破坏旧文件、不截断队列
 *   (后续写照常成功)、错误由调用方 promise 捕获
 * 样例全部放 os.tmpdir() 独立目录,finally 整体删除。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJsonWriter } from "../../dist/main/atomic-json.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`atomic-json 断言失败:${msg}`);
}

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-atomic-json-${process.pid}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    // ---- 1. 原子写落盘读回:序列化格式(2 空格缩进 + 末尾换行)+ tmp 不残留 ----
    const writer = createJsonWriter();
    const file1 = path.join(dir, "state.json");
    await writer(file1, { a: 1, list: ["x", "y"] });
    const raw1 = await fs.readFile(file1, "utf8");
    assert(raw1 === `${JSON.stringify({ a: 1, list: ["x", "y"] }, null, 2)}\n`, "落盘内容应为 2 空格缩进 JSON + 末尾换行");
    assert(JSON.parse(raw1).a === 1, "落盘内容应可解析回原值");
    await fs.access(`${file1}.tmp`).then(
      () => assert(false, "tmp 文件写后不应残留"),
      () => undefined, // ENOENT = 已 rename,符合预期
    );
    console.log("[ok] atomic-json:原子写落盘读回(2 空格缩进+末尾换行,tmp 不残留)");

    // ---- 2. 写队列串行顺序:并发发起,完成序 = 调用序,链尾即最终态 ----
    const file2 = path.join(dir, "queue.json");
    const committedOrder = [];
    const writes = [];
    for (let i = 1; i <= 20; i++) {
      writes.push(writer(file2, { seq: i }, () => committedOrder.push(i)));
    }
    await Promise.all(writes);
    assert(
      JSON.stringify(committedOrder) === JSON.stringify(Array.from({ length: 20 }, (_, k) => k + 1)),
      `onCommitted 完成序应等于调用序,实际 ${JSON.stringify(committedOrder)}`,
    );
    const finalState = JSON.parse(await fs.readFile(file2, "utf8"));
    assert(finalState.seq === 20, `链尾即最终态:文件应为最后一次写入(seq=20),实际 ${finalState.seq}`);
    console.log("[ok] atomic-json:写队列串行(20 并发写完成序=调用序,链尾=最终态)");

    // ---- 3. 并发调用不交叉:不同实例独立队列;同实例多目标文件各自完整 ----
    const slowGate = { resolve: null };
    const gate = new Promise((resolve) => (slowGate.resolve = resolve));
    const writerA = createJsonWriter();
    const writerB = createJsonWriter();
    const fileA1 = path.join(dir, "a1.json");
    const fileA2 = path.join(dir, "a2.json");
    const fileB1 = path.join(dir, "b1.json");
    // A 实例首写被门闩挂住:A 队列后续任务必须等待;B 实例不受影响
    const aFirst = writerA(fileA1, { who: "a-first" }).then(() => gate);
    const bWrite = writerB(fileB1, { who: "b" }).then(() => fs.readFile(fileB1, "utf8"));
    const aSecond = writerA(fileA2, { who: "a-second" });
    const bRaw = await bWrite;
    assert(JSON.parse(bRaw).who === "b", "B 实例不应被 A 实例队列阻塞(实例间独立)");
    slowGate.resolve();
    await Promise.all([aFirst, aSecond]);
    assert(JSON.parse(await fs.readFile(fileA1, "utf8")).who === "a-first", "A 实例首写内容不符");
    assert(JSON.parse(await fs.readFile(fileA2, "utf8")).who === "a-second", "A 实例串行后续写内容不符");
    console.log("[ok] atomic-json:并发不交叉(实例间独立队列,实例内串行)");

    // ---- 4. 失败路径:目标目录不存在 → writeFile(tmp) 失败;旧文件不破坏、队列不截断 ----
    const writerF = createJsonWriter();
    const goodFile = path.join(dir, "good.json");
    await writerF(goodFile, { v: 1 });
    const badFile = path.join(dir, "no-such-dir", "bad.json"); // tmp 写入必失败(ENOENT)
    let failed = false;
    try {
      await writerF(badFile, { v: 2 });
    } catch {
      failed = true;
    }
    assert(failed, "失败写应向调用方抛错(错误由调用方处理)");
    assert(JSON.parse(await fs.readFile(goodFile, "utf8")).v === 1, "失败写不应破坏旧文件");
    // 失败后队列仍可用:同一实例后续写成功(单次失败不截断队列)
    await writerF(goodFile, { v: 3 });
    assert(JSON.parse(await fs.readFile(goodFile, "utf8")).v === 3, "失败后同实例后续写应成功(队列不截断)");
    console.log("[ok] atomic-json:失败路径(调用方收到错误/旧文件完好/队列不截断)");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
