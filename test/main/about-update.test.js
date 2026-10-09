// @ts-check
/**
 * 关于页更新检查:版本比较纯函数单测。
 * 断言对象 = dist/main/ipc/logic.js 的 compareVersions 真实实现(自 register.ts
 * 下沉的单源;此前本段内联同逻辑副本,属双源,已改直测实现)。
 */
import { compareVersions } from "../../dist/main/ipc/logic.js";
import { createCaseSuite } from "../harness/case.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  // 一条判定一个 case:compareVersions 是纯函数、各条互不依赖,
  // 合成一个 case 时首条判红会让后面的比较根本不跑
  await suite.case("相等版本 3.10.1 判为 0", () => {
    if (compareVersions("3.10.1", "3.10.1") !== 0) throw new Error("equal versions failed");
  });
  await suite.case("相等版本 1.0.0 判为 0", () => {
    if (compareVersions("1.0.0", "1.0.0") !== 0) throw new Error("equal versions 1.0.0 failed");
  });

  // major difference
  await suite.case("major 差异 2.0.0 < 3.0.0 判为 -1", () => {
    if (compareVersions("2.0.0", "3.0.0") !== -1) throw new Error("major diff 2<3 failed");
  });
  await suite.case("major 差异 3.0.0 > 2.0.0 判为 1", () => {
    if (compareVersions("3.0.0", "2.0.0") !== 1) throw new Error("major diff 3>2 failed");
  });

  // minor difference
  await suite.case("minor 差异 3.9.0 < 3.10.0 判为 -1（按数值而非字典序）", () => {
    if (compareVersions("3.9.0", "3.10.0") !== -1) throw new Error("minor diff 3.9<3.10 failed");
  });
  await suite.case("minor 差异 3.10.0 > 3.9.0 判为 1", () => {
    if (compareVersions("3.10.0", "3.9.0") !== 1) throw new Error("minor diff 3.10>3.9 failed");
  });

  // patch difference
  await suite.case("patch 差异 3.10.1 < 3.10.2 判为 -1", () => {
    if (compareVersions("3.10.1", "3.10.2") !== -1) throw new Error("patch diff 3.10.1<3.10.2 failed");
  });
  await suite.case("patch 差异 3.10.2 > 3.10.1 判为 1", () => {
    if (compareVersions("3.10.2", "3.10.1") !== 1) throw new Error("patch diff 3.10.2<3.10.1 failed");
  });

  // missing segments treated as 0
  await suite.case("缺段 1 与 1.0.0 视为相等（缺段按 0 补齐）", () => {
    if (compareVersions("1", "1.0.0") !== 0) throw new Error("missing segments 1 vs 1.0.0 failed");
  });
  await suite.case("缺段 1.2 与 1.2.0 视为相等", () => {
    if (compareVersions("1.2", "1.2.0") !== 0) throw new Error("missing segments 1.2 vs 1.2.0 failed");
  });
  await suite.case("缺段 1.2.3 > 1.2 判为 1", () => {
    if (compareVersions("1.2.3", "1.2") !== 1) throw new Error("missing segments 1.2.3 vs 1.2 failed");
  });

  // leading zeros handled
  await suite.case("前导零 3.09.01 与 3.9.1 视为相等", () => {
    if (compareVersions("3.09.01", "3.9.1") !== 0) throw new Error("leading zeros failed");
  });

  // non-numeric segments treated as 0
  await suite.case("非数字段 3.10.x 与 3.10.0 视为相等（非数字段按 0）", () => {
    if (compareVersions("3.10.x", "3.10.0") !== 0) throw new Error("non-numeric 3.10.x vs 3.10.0 failed");
  });
  await suite.case("非数字段 3.10.0 与 3.10.x 视为相等（对称）", () => {
    if (compareVersions("3.10.0", "3.10.x") !== 0) throw new Error("non-numeric 3.10.0 vs 3.10.x failed");
  });

  console.log("[ok] about-update:compareVersions 版本比较纯函数断言通过(直测 ipc/logic 单源)");
  return { cases: suite.results };
}
