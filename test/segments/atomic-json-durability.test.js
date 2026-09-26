// @ts-check
/**
 * 原子写耐久性段(位于 test/segments/ = 本批健壮性加固的跨域守护段;被测为
 * src/main/persist/atomic-json.ts,经 dist/main/persist/atomic-json.js,electron 环境):
 *
 * 为什么要有本段:断电/掉电场景下,只 writeFile 不 fsync 会留下 0 字节 settings.json,
 * 而 loadSettings 对整文件解析失败一律回退默认 → 用户全部偏好静默归零且现场无线索。
 * 「加了 fsync」不能靠读代码确认,必须钉住可观测事实:
 * 1. 调用序:open(tmp) → writeFile → **sync** → close → rename → syncDir(父目录),
 *    且 sync 严格早于 rename(内容先落盘,再换名);
 * 2. sync 时刻的磁盘实况:tmp 已是完整新内容,目标文件仍是旧值(rename 尚未发生)
 *    ——证明 fsync 作用在「已写满的句柄」上,不是空转;
 * 3. 断电模拟的可观测差异:注入「writeFile 只落前缀、sync 才提交剩余」的句柄,
 *    写后未 fsync 的那份产物是**半个 JSON**(解析即失败),fsync 生效的那份完整可解析。
 *    这是 fsync 唯一有意义的效果,方向反了(先 rename 后 fsync)本段即红;
 * 4. 失败路径:fsync 抛错必须让整次写失败(不得静默跳过持久化)、旧值保持不变、
 *    半成品 tmp 被清理;close 必执行(句柄不泄漏);
 * 5. rename 之后的父目录 fsync 失败不推翻已成功的写(内容已就位,不能报失败
 *    让调用方以为旧值还在),仅留痕。
 * 夹具全部落 os.tmpdir() 独立目录,finally 整体删除。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJsonWriter, defaultJsonWriterDeps } from "../../dist/main/persist/atomic-json.js";

/** @typedef {import("../../src/main/persist/atomic-json.js").JsonWriterDeps} JsonWriterDeps */
/** @typedef {import("../../src/main/persist/atomic-json.js").DurableFileHandle} DurableFileHandle */
/** @typedef {import("../../src/main/persist/atomic-json.js").JsonWriter} JsonWriter */

// dist 无 .d.ts,createJsonWriter 的形参被推断成 FileHandle 等具体实现签名;
// 本段按 src 契约注入替身句柄,故统一经此 cast 收口(只放宽入参,不放宽被测行为)。
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
  if (!cond) throw new Error(`atomic-json-durability 断言失败:${msg}`);
}

/**
 * 断电模拟句柄:writeFile 只把内容前 3 字节交给「页缓存」(真实落盘到目标路径),
 * 其余留在内存;只有 sync 才把剩余部分提交。
 * @param {string} target 文件路径
 * @param {{commitOnSync?: boolean, failOnSync?: boolean, failOnWrite?: boolean}} [opts] 行为开关
 * @returns {DurableFileHandle} 句柄
 */
function createPowerLossHandle(target, opts = {}) {
  /** @type {string | null} */
  let pending = null;
  return {
    async writeFile(data) {
      if (opts.failOnWrite === true) throw new Error("模拟写失败");
      pending = data.slice(3);
      await fs.writeFile(target, data.slice(0, 3), "utf8");
    },
    async sync() {
      if (opts.failOnSync === true) throw new Error("模拟 fsync 失败");
      if (pending !== null && opts.commitOnSync !== false) {
        await fs.appendFile(target, pending, "utf8");
      }
    },
    async close() {},
  };
}

export const meta = { description: "原子写耐久性:fsync 时点与顺序、断电可观测差异、失败路径清理" };
// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-atomic-durability-${process.pid}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    // ---- 1. 调用序:open(tmp) → writeFile → sync → close → rename → syncDir(父目录) ----
    const calls = /** @type {string[]} */ ([]);
    // sync 时刻的磁盘实况快照(用非空初值 + 独立 flag,免去 null 收窄的噪音)
    let atSync = { tmp: "", target: "" };
    let syncCalled = false;
    const real = defaultJsonWriterDeps;
    /** @type {JsonWriterDeps} */
    const observed = {
      openFile: async (p) => {
        calls.push(`open:${path.basename(p)}`);
        const h = await real.openFile(p);
        return {
          writeFile: async (data, encoding) => {
            calls.push("writeFile");
            await h.writeFile(data, encoding);
          },
          sync: async () => {
            calls.push("sync");
            // sync 时刻的磁盘实况:tmp 已写满、目标仍是旧值(rename 未发生)
            syncCalled = true;
            atSync = {
              tmp: await fs.readFile(p, "utf8"),
              target: await fs.readFile(path.join(dir, "order.json"), "utf8").catch(() => "<不存在>"),
            };
            await h.sync(); // 真实 fsync 确实被调用且成功
          },
          close: async () => {
            calls.push("close");
            await h.close();
          },
        };
      },
      rename: async (from, to) => {
        calls.push("rename");
        await real.rename(from, to);
      },
      remove: async (p) => {
        calls.push("remove");
        await real.remove(p);
      },
      syncDir: async (d) => {
        calls.push(`syncDir:${path.basename(d)}`);
        await real.syncDir(d);
      },
    };
    const orderFile = path.join(dir, "order.json");
    await fs.writeFile(orderFile, '{"old":true}\n', "utf8");
    const writer = createWriter(observed);
    await writer(orderFile, { fresh: 1 });
    assert(
      JSON.stringify(calls) ===
        JSON.stringify(["open:order.json.tmp", "writeFile", "sync", "close", "rename", `syncDir:${path.basename(dir)}`]),
      `写盘调用序不符,实际 ${JSON.stringify(calls)}`,
    );
    assert(
      calls.indexOf("sync") < calls.indexOf("rename"),
      `fsync 必须早于 rename(内容先落盘再换名),实际序 ${JSON.stringify(calls)}`,
    );
    // 经 const 取快照再核验(赋值发生在上面的闭包里,直接读 let 收窄不到)
    const snapshot = atSync;
    assert(syncCalled, "sync 未被调用,无法核验其时点的磁盘实况");
    assert(
      snapshot.tmp === `${JSON.stringify({ fresh: 1 }, null, 2)}\n`,
      `sync 时刻 tmp 应已是完整新内容,实际 ${JSON.stringify(snapshot.tmp)}`,
    );
    assert(
      snapshot.target === '{"old":true}\n',
      `sync 时刻目标应仍是旧值(rename 未发生),实际 ${JSON.stringify(snapshot.target)}`,
    );
    assert(
      JSON.parse(await fs.readFile(orderFile, "utf8")).fresh === 1,
      "写后目标文件应持有新值",
    );
    await fs
      .access(`${orderFile}.tmp`)
      .then(
        () => assert(false, "tmp 写后不应残留"),
        () => undefined,
      );
    console.log("[ok] atomic-json-durability:调用序 open→write→sync→close→rename→syncDir(父目录),sync 早于 rename");

    // ---- 2. 断电模拟:写后未 fsync vs 已 fsync 的可观测差异 ----
    const powerFile = path.join(dir, "power.json");
    const durable = createWriter({
      ...real,
      openFile: async (p) => createPowerLossHandle(p, { commitOnSync: true }),
    });
    await durable(powerFile, { a: 1 });
    const durableRaw = await fs.readFile(powerFile, "utf8");
    assert(
      JSON.parse(durableRaw).a === 1,
      `fsync 生效时产物应完整可解析,实际 ${JSON.stringify(durableRaw)}`,
    );

    const lossyFile = path.join(dir, "lossy.json");
    const lossy = createWriter({
      ...real,
      openFile: async (p) => createPowerLossHandle(p, { commitOnSync: false }), // 写后未 fsync
    });
    await lossy(lossyFile, { a: 1 });
    const lossyRaw = await fs.readFile(lossyFile, "utf8");
    let lossyParseFailed = false;
    try {
      JSON.parse(lossyRaw);
    } catch {
      lossyParseFailed = true;
    }
    assert(
      lossyParseFailed,
      `未 fsync 的产物应是残缺内容(可观测差异),实际解析成功:${JSON.stringify(lossyRaw)}`,
    );
    console.log(
      `[ok] atomic-json-durability:断电模拟差异成立(fsync 后 ${durableRaw.length} 字节可解析 / 未 fsync ${lossyRaw.length} 字节残缺)`,
    );

    // ---- 3. fsync 失败必须让整次写失败(不得静默跳过持久化),旧值保持、tmp 清理 ----
    const syncFailFile = path.join(dir, "sync-fail.json");
    await fs.writeFile(syncFailFile, '{"kept":true}\n', "utf8");
    let closed = false;
    const syncFailWriter = createWriter({
      ...real,
      openFile: async (p) => {
        const h = createPowerLossHandle(p, { failOnSync: true });
        return { ...h, close: async () => { closed = true; } };
      },
    });
    let syncFailed = false;
    try {
      await syncFailWriter(syncFailFile, { replaced: true });
    } catch {
      syncFailed = true;
    }
    assert(syncFailed, "fsync 失败必须向调用方抛错(静默跳过就等于没加 fsync)");
    assert(closed, "失败路径也必须 close 句柄(否则句柄泄漏)");
    assert(
      JSON.parse(await fs.readFile(syncFailFile, "utf8")).kept === true,
      "fsync 失败时旧值必须保持不变",
    );
    await fs
      .access(`${syncFailFile}.tmp`)
      .then(
        () => assert(false, "fsync 失败不应残留半成品 tmp"),
        () => undefined,
      );
    console.log("[ok] atomic-json-durability:fsync 失败 → 写失败/旧值完好/句柄已关/tmp 已清理");

    // ---- 4. 写失败路径:close 仍执行,tmp 清理失败不掩盖原始错误 ----
    const writeFailFile = path.join(dir, "write-fail.json");
    let writeFailClosed = false;
    const writeFailWriter = createWriter({
      ...real,
      openFile: async (p) => {
        const h = createPowerLossHandle(p, { failOnWrite: true });
        return { ...h, close: async () => { writeFailClosed = true; } };
      },
      // 清理本身也失败:不能反过来把原始写错误换掉
      remove: async () => {
        throw new Error("模拟清理失败");
      },
    });
    let writeFailMessage = "";
    try {
      await writeFailWriter(writeFailFile, { v: 1 });
    } catch (err) {
      writeFailMessage = err instanceof Error ? err.message : String(err);
    }
    assert(writeFailMessage === "模拟写失败", `应上抛原始写错误,实际 ${writeFailMessage}`);
    assert(writeFailClosed, "写失败路径也必须 close 句柄");
    console.log("[ok] atomic-json-durability:写失败 → 上抛原始错误(清理失败不掩盖)/句柄已关");

    // ---- 5. rename 之后的父目录 fsync 失败:不推翻已成功的写,仅留痕 ----
    const dirFailFile = path.join(dir, "dir-fail.json");
    const warnLogs = /** @type {string[]} */ ([]);
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnLogs.push(args.join(" "));
    };
    let committed = false;
    try {
      const dirFailWriter = createWriter({
        ...real,
        syncDir: async () => {
          throw new Error("模拟父目录 fsync 失败");
        },
      });
      await dirFailWriter(dirFailFile, { v: 2 }, () => {
        committed = true;
      });
    } finally {
      console.warn = originalWarn;
    }
    assert(committed, "父目录 fsync 失败仍应提交缓存(内容已就位)");
    assert(
      JSON.parse(await fs.readFile(dirFailFile, "utf8")).v === 2,
      "父目录 fsync 失败时目标文件应已是新值(rename 已完成)",
    );
    assert(
      warnLogs.some((l) => l.includes("父目录 fsync 失败")),
      `父目录 fsync 失败应留痕,实际 ${JSON.stringify(warnLogs)}`,
    );
    console.log("[ok] atomic-json-durability:父目录 fsync 失败不推翻已成功的写(仅留痕)");

    // ---- 6. 默认 syncDir 在本平台可运行(win32 为空操作,posix 为真实目录 fsync) ----
    await defaultJsonWriterDeps.syncDir(dir);
    await defaultJsonWriterDeps.syncDir(path.join(dir, "no-such-dir"));
    console.log(
      `[ok] atomic-json-durability:默认 syncDir 可运行(平台 ${process.platform},不支持目录 fsync 时降级为空操作)`,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
