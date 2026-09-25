// @ts-check
/**
 * 关于页更新检查:版本比较纯函数单测。
 * 断言对象 = dist/main/ipc/logic.js 的 compareVersions 真实实现(自 register.ts
 * 下沉的单源;此前本段内联同逻辑副本,属双源,已改直测实现)。
 */
import { compareVersions } from "../../dist/main/ipc/logic.js";

export async function run() {
  // equal versions
  if (compareVersions("3.10.1", "3.10.1") !== 0) throw new Error("equal versions failed");
  if (compareVersions("1.0.0", "1.0.0") !== 0) throw new Error("equal versions 1.0.0 failed");

  // major difference
  if (compareVersions("2.0.0", "3.0.0") !== -1) throw new Error("major diff 2<3 failed");
  if (compareVersions("3.0.0", "2.0.0") !== 1) throw new Error("major diff 3>2 failed");

  // minor difference
  if (compareVersions("3.9.0", "3.10.0") !== -1) throw new Error("minor diff 3.9<3.10 failed");
  if (compareVersions("3.10.0", "3.9.0") !== 1) throw new Error("minor diff 3.10>3.9 failed");

  // patch difference
  if (compareVersions("3.10.1", "3.10.2") !== -1) throw new Error("patch diff 3.10.1<3.10.2 failed");
  if (compareVersions("3.10.2", "3.10.1") !== 1) throw new Error("patch diff 3.10.2<3.10.1 failed");

  // missing segments treated as 0
  if (compareVersions("1", "1.0.0") !== 0) throw new Error("missing segments 1 vs 1.0.0 failed");
  if (compareVersions("1.2", "1.2.0") !== 0) throw new Error("missing segments 1.2 vs 1.2.0 failed");
  if (compareVersions("1.2.3", "1.2") !== 1) throw new Error("missing segments 1.2.3 vs 1.2 failed");

  // leading zeros handled
  if (compareVersions("3.09.01", "3.9.1") !== 0) throw new Error("leading zeros failed");

  // non-numeric segments treated as 0
  if (compareVersions("3.10.x", "3.10.0") !== 0) throw new Error("non-numeric 3.10.x vs 3.10.0 failed");
  if (compareVersions("3.10.0", "3.10.x") !== 0) throw new Error("non-numeric 3.10.0 vs 3.10.x failed");

  console.log("[ok] about-update:compareVersions 版本比较纯函数断言通过(直测 ipc/logic 单源)");
}
