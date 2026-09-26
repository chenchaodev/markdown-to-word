// @ts-check
/**
 * 原子 JSON 写入器直测(位于 test/main/ = 主进程层;src/main/persist/atomic-json.ts,
 * 测试经 dist/main/persist/atomic-json.js,electron 环境):
 * settings.ts / ui-state.ts 共享的原子写工具,断言面:
 * - 原子写落盘读回:内容 = JSON.stringify(value,null,2)+"\n",tmp 文件写后不残留
 * - 写队列串行顺序:同实例并发多次写,完成序 = 调用序(onCommitted 回调序),
 *   链尾即最终态(文件内容 = 最后一次写入)
 * - 并发调用不交叉:不同实例独立队列互不阻塞;同实例并发各写各的目标文件
 * - 失败路径:单次写失败(tmp 目录不存在 → ENOENT)不破坏旧文件、不截断队列
 *   (后续写照常成功)、不残留半成品 tmp、错误由调用方 promise 捕获
 * - 失败后重试可恢复:同一内容在失败后再次写成功(队列不截断 + 缓存只在成功后提交)
 * 样例全部放 os.tmpdir() 独立目录,finally 整体删除。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJsonWriter, defaultJsonWriterDeps } from "../../dist/main/persist/atomic-json.js";

/* 类型取自 src(真接口所在):dist 不产 .d.ts,interface 在 JS 里被擦除,
   从 dist 推断只会拿到 defaultJsonWriterDeps 的字面量形状(缺可选依赖面字段),
   注入 deps 就会被判成多余属性。与 atomic-json-durability.test.js 同一约定。 */
/** @typedef {import("../../src/main/persist/atomic-json.js").JsonWriterDeps} JsonWriterDeps */
/** @typedef {import("../../src/main/persist/atomic-json.js").JsonWriter} JsonWriter */

const createWriter = /** @type {(deps?: JsonWriterDeps) => JsonWriter} */ (
  /** @type {unknown} */ (createJsonWriter)
);

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`atomic-json 断言失败:${msg}`);
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

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
    const committedOrder = /** @type {number[]} */ ([]);
    const writes = /** @type {Promise<void>[]} */ ([]);
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
    // 门闩句柄:resolve 由下面构造 Promise 时写入,await 后即可调用
    /** @type {{ resolve: (() => void) | null }} */
    const slowGate = { resolve: null };
    /** @type {Promise<void>} */
    const gate = new Promise((resolve) => {
      slowGate.resolve = () => resolve(undefined);
    });
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
    assert(slowGate.resolve !== null, "门闩 Promise 构造后应已交出 resolve");
    slowGate.resolve();
    await Promise.all([aFirst, aSecond]);
    assert(JSON.parse(await fs.readFile(fileA1, "utf8")).who === "a-first", "A 实例首写内容不符");
    assert(JSON.parse(await fs.readFile(fileA2, "utf8")).who === "a-second", "A 实例串行后续写内容不符");
    console.log("[ok] atomic-json:并发不交叉(实例间独立队列,实例内串行)");

    // ---- 3b. mutation queue:读当前值与合并在同一队列内,不同字段并发不丢 ----
    // enqueue 的回调提供“队列内写”能力:调用方把读当前值/合并也放入队列,
    // 但不能再调用公开 writer(否则会等待自己)。两个任务交错发起时,第二个
    // 任务必须在第一个提交缓存后读取当前值。
    const mutationFile = path.join(dir, "mutation.json");
    // dist 产物不带类型标注:enqueue 是 writer 上的附加成员,按实现声明的契约取
    const mutationWriter = /** @type {import("../../src/main/persist/atomic-json.js").JsonWriter} */ (
      createJsonWriter()
    );
    const current = { left: false, right: false };
    /**
     * 排一个「读当前值 → 合并 → 写盘」事务。
     * @param {{ left?: boolean, right?: boolean }} patch 本次补丁
     * @returns {Promise<{ left: boolean, right: boolean }>} 合并后的值
     */
    const mutate = (patch) =>
      mutationWriter.enqueue(async (write) => {
        const next = { ...current, ...patch };
        await write(mutationFile, next, () => Object.assign(current, next));
        return next;
      });
    const [leftResult, rightResult] = await Promise.all([
      mutate({ left: true }),
      mutate({ right: true }),
    ]);
    assert(leftResult.left && !leftResult.right, "mutation 第一个结果应只含自身补丁");
    assert(rightResult.left && rightResult.right, "mutation 第二个结果应读到第一个已提交字段");
    assert(current.left && current.right, "mutation 并发不同字段不得丢更新");
    const mutationDisk = JSON.parse(await fs.readFile(mutationFile, "utf8"));
    assert(mutationDisk.left && mutationDisk.right, "mutation 最终落盘应包含全部字段");
    console.log("[ok] atomic-json:mutation queue(读改写整体串行,不同字段并发不丢)");

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
    // 失败清理:半成品 tmp 不残留(否则易被误当作已提交结果)
    await fs
      .access(`${badFile}.tmp`)
      .then(
        () => assert(false, "失败写不应残留 .tmp 临时文件"),
        () => undefined, // ENOENT = 已清理,符合预期
      );
    // 失败后队列仍可用:同一实例后续写成功(单次失败不截断队列)
    await writerF(goodFile, { v: 3 });
    assert(JSON.parse(await fs.readFile(goodFile, "utf8")).v === 3, "失败后同实例后续写应成功(队列不截断)");
    console.log("[ok] atomic-json:失败路径(调用方收到错误/旧文件完好/tmp 已清理/队列不截断)");

    /** 记录每次 rename 收到的错误码,按脚本决定第几次放行;放行那轮走真实 rename,
     *  否则只抛错不落盘,断言「内容真正落盘」就成了一句空话。
     *  提升到函数作用域:第 5 组(重试)与第 6 组(drain 穿过重试)共用同一实现,不复制。
     * @param {Array<string | null>} codes 依次抛出的错误码(null 表示放行并真实 rename)
     * @returns {{ seen: string[]; transport: (from: string, to: string) => Promise<void> }} */
    const makeFlakyRename = (codes) => {
      const seen = /** @type {string[]} */ ([]);
      let call = 0;
      return {
        seen,
        transport: async (/** @type {string} */ from, /** @type {string} */ to) => {
          const code = codes[Math.min(call, codes.length - 1)] ?? null;
          call += 1;
          if (code !== null) {
            seen.push(code);
            throw Object.assign(new Error(`rename 失败: ${code}`), { code });
          }
          await defaultJsonWriterDeps.rename(from, to);
        },
      };
    };

    // ---- 5. 瞬时占用重试:rename 命中「被读句柄占用」类错误码须有界退避后成功 ----
    // 背景(实测):Windows 上 rename 覆盖正被读句柄占用的目标必然 EPERM(确定性),
    // 与并发读竞争 40 次约 23 次失败。杀软/索引器/云同步随手一握即触发,属瞬时占用,
    // 不重试就会丢掉整次写(本仓 settings 迁移曾因此在 CI runner 上整段失败)。
    {
      const delays = /** @type {number[]} */ ([]);
      const sleep = async (/** @type {number} */ ms) => {
        delays.push(ms);
      };
      const budget = { attempts: 6, baseDelayMs: 4, maxDelayMs: 40 };

      // 5a. 前两次瞬时占用,第三次成功 → 写盘落地,退避序列有界且递增
      const flaky = makeFlakyRename(["EPERM", "EBUSY", null]);
      const writerR = createWriter({ ...defaultJsonWriterDeps, rename: flaky.transport, sleep, renameRetry: budget });
      const retryFile = path.join(dir, "retry.json");
      await writerR(retryFile, { v: 9 });
      assert(JSON.parse(await fs.readFile(retryFile, "utf8")).v === 9, "瞬时占用重试后内容应真正落盘");
      assert(flaky.seen.length === 2, `应恰好重试 2 次后成功,实际 ${JSON.stringify(flaky.seen)}`);
      assert(
        delays.length === 2 && delays[0] === 4 && delays[1] === 8,
        `退避应从 baseDelayMs 起指数增长,实际 ${JSON.stringify(delays)}`,
      );
      assert(delays.every((ms) => ms <= budget.maxDelayMs), `单次退避不得超过封顶,实际 ${JSON.stringify(delays)}`);

      // 5b. 真实故障码不得重试(重试掩盖问题)→ 立即抛错、tmp 已清理
      const hard = makeFlakyRename(["ENOSPC"]);
      const writerH = createWriter({ ...defaultJsonWriterDeps, rename: hard.transport, sleep, renameRetry: budget });
      const hardFile = path.join(dir, "hard.json");
      let hardFailed = false;
      try {
        await writerH(hardFile, { v: 1 });
      } catch (err) {
        hardFailed = /** @type {{ code?: string }} */ (err).code === "ENOSPC";
      }
      assert(hardFailed, "ENOSPC 等真实故障须原样上抛");
      assert(hard.seen.length === 1, `真实故障不得重试,实际尝试 ${hard.seen.length} 次`);
      assert(delays.length === 2, "真实故障路径不得产生退避等待");

      // 5c. 瞬时占用持续到预算耗尽 → 仍须抛错且清理 tmp(不得静默当成功)
      const alwaysBusy = makeFlakyRename(["EBUSY"]);
      const writerA = createWriter({ ...defaultJsonWriterDeps, rename: alwaysBusy.transport, sleep, renameRetry: budget });
      const busyFile = path.join(dir, "busy.json");
      let busyFailed = false;
      try {
        await writerA(busyFile, { v: 1 });
      } catch {
        busyFailed = true;
      }
      assert(busyFailed, "重试预算耗尽须向调用方抛错");
      assert(
        alwaysBusy.seen.length === budget.attempts,
        `应恰好尝试 budget.attempts=${budget.attempts} 次,实际 ${alwaysBusy.seen.length}`,
      );
      await fs
        .access(`${busyFile}.tmp`)
        .then(
          () => assert(false, "重试耗尽后不应残留 .tmp"),
          () => undefined, // ENOENT = 已清理
        );
      console.log("[ok] atomic-json:瞬时占用重试(有界退避落地/真实故障不重试/耗尽即抛错并清理)");
    }

    // ---- 6. drain:等待队列结算(含重试),而非立即 resolve ----
    // drain 是「确定性地等写落盘」的替代品,用来取代「等固定时长再放弃」——后者不保证
    // 写已落盘,迟到落盘会覆盖调用方在等待期里做的新写入。故必须证明它真的等。
    {
      const delays = /** @type {number[]} */ ([]);
      const sleep = async (/** @type {number} */ ms) => {
        delays.push(ms);
      };
      const budget = { attempts: 6, baseDelayMs: 4, maxDelayMs: 40 };

      // 6a. 队列里有待写时,drain 必须等它落盘后才 resolve
      const drainFile = path.join(dir, "drain.json");
      const pending = createWriter({ ...defaultJsonWriterDeps, sleep, renameRetry: budget });
      const settled = [];
      for (let i = 0; i < 3; i++) settled.push(await pending(drainFile, { seq: i }));
      const drained = pending.drain();
      let drainDone = false;
      void drained.then(() => {
        drainDone = true;
      });
      // 队列空时 drain 立即完成是合法的,故此处只断言「drain resolve 时三次写都已在盘上」
      await drained;
      const onDisk = JSON.parse(await fs.readFile(drainFile, "utf8"));
      assert(onDisk.seq === 2, `drain resolve 时队列应已排空(盘面为最后一次写),实际 ${JSON.stringify(onDisk)}`);

      // 6b. 关键性质:drain 必须穿过瞬时占用重试 —— 重试未结束时它不能 resolve
      const flaky = makeFlakyRename(["EPERM", "EPERM", null]);
      const retryWriter = createWriter({ ...defaultJsonWriterDeps, rename: flaky.transport, sleep, renameRetry: budget });
      const retryFile = path.join(dir, "drain-retry.json");
      void retryWriter(retryFile, { v: 1 }).catch(() => undefined);
      await retryWriter.drain();
      assert(
        flaky.seen.length === 2,
        `drain 应等到重试成功为止,实际重试 ${flaky.seen.length} 次(见重试码 ${JSON.stringify(flaky.seen)})`,
      );
      assert(
        JSON.parse(await fs.readFile(retryFile, "utf8")).v === 1,
        "drain resolve 时经重试的那次写必须已在盘面",
      );
      assert(drainDone, "drain 的 promise 应当已 resolve");

      // 6c. 队列里有失败写时 drain 仍须 resolve(队列不截断,不得把 drain 变成死等)
      const failing = createWriter({
        ...defaultJsonWriterDeps,
        rename: async () => {
          throw Object.assign(new Error("rename 失败: ENOSPC"), { code: "ENOSPC" });
        },
        sleep,
        renameRetry: budget,
      });
      const failFile = path.join(dir, "drain-fail.json");
      await failing(failFile, { v: 1 }).catch(() => undefined);
      await failing.drain();
      console.log("[ok] atomic-json:drain(等队列落盘/穿过重试/失败写不致死等)");
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
