/**
 * 用户设置备份/恢复公共 helper:
 * - backupSettings:缓存级快照(R8 批 3 L7,原内联逻辑在 test/main/converter.test.js);
 * - backupSettingsFile / freshSettingsModule / settingsJsonPath:原始文件级备份 +
 *   全新模块实例(TEST-9 自 i18n.test.js / settings.test.js 手写样板迁移,行为等价)。
 * 注意:smoke.ts 属应用代码(src/main),不得 import test/,保持自身实现。
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { loadSettings, updateSettings } from "../../dist/main/persist/settings.js";

/** settings.json 磁盘路径(settings.ts 无注入点,测试直改磁盘时共用)。 */
export function settingsJsonPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

/**
 * 原始文件级备份(i18n/settings 等直接改写磁盘文件的段共用):
 * 读 settings.json 文本(无文件 → null),restore() 写回原文本或删除文件,
 * 不污染用户设置。与 backupSettings(缓存级快照)互补:测试需要绕过模块缓存
 * 直改磁盘、再经全新模块实例读回时用本助手。
 */
export async function backupSettingsFile() {
  const settingsFile = settingsJsonPath();
  let orig = null;
  try {
    orig = await fs.readFile(settingsFile, "utf8");
  } catch {
    /* 无既有文件 */
  }
  return {
    orig,
    restore: async function restore() {
      if (orig === null) await fs.rm(settingsFile, { force: true });
      else await fs.writeFile(settingsFile, orig, "utf8");
    },
  };
}

let freshSeq = 0;
/**
 * 全新 persist/settings 模块实例(绕过模块级 settingsCache 惰性缓存)。
 * 实证:Node ESM 同文件不同 query = 独立实例(URL 含 query 即视为不同模块)。
 * tag 用于区分调用段(query 可读性,排障用),不影响唯一性(内部序号保证)。
 */
export function freshSettingsModule(tag = "seg") {
  return import(`../../dist/main/persist/settings.js?${tag}=${freshSeq++}`);
}

/**
 * 备份用户设置,返回 { orig, restore }:
 * - orig:种子缓存快照(供断言构造「基于原值修改」的场景,如 landscape);
 * - restore():updateSettings(orig) 双写回原值;原本无文件则恢复后删除,不污染用户设置。
 * 崩溃残留风险与既有实现一致(updateSettings 双写原子性见 settings.ts)。
 */
export async function backupSettings() {
  const settingsFile = settingsJsonPath();
  const orig = loadSettings(); // 种子缓存 + 恢复基准(文件 + 缓存)
  let hadFile = false;
  await fs.access(settingsFile).then(() => (hadFile = true), () => undefined);
  return {
    orig,
    restore: async function restore() {
      await updateSettings(orig);
      if (!hadFile) await fs.rm(settingsFile, { force: true });
    },
  };
}
