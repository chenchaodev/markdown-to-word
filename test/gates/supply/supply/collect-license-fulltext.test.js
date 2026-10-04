// @ts-check
/**
 * 许可证全文门禁段(位于 test/gates/supply/supply/ =
 * 镜像 gates/supply/supply/collect-license-fulltext.mjs,纯 Node 逻辑,不经 dist 编译产物):
 * 按需收集生产依赖的许可证全文副本。
 * - 逐字落盘(BOM / CRLF 原样保留,经过字符串往返的副本不能用来履行附全文义务)
 * - 清单记录来源包、来源文件名、副本相对路径与内容指纹、识别结果
 * - 取不到许可证文件必须显式记 missing 并报出,不得静默跳过;名字像许可证但扩展名
 *   不在候选内的文件也须报出(否则会被误读成「上游没随包发许可」)
 * - 同一 lockfile + 同一安装树两次产物逐字节相同(不写时间戳)
 * - 进程级 CLI:默认 exit 0 但必须报出缺项;--strict 下判红
 *
 * 断言方式:临时目录里造沙盒 lockfile 与包目录,断言落盘副本**与源文件逐字节相同**
 * 以及缺项的原因码 —— 只看「收集完成」会让「复制时被字符串往返改写」蒙混过关。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCaseSuite } from "../../../harness/case.js";
import { ROOT } from "../../../harness/paths.js";
import { removeTree } from "../../../harness/temp-resource.js";
import { spawnSync } from "node:child_process";
import {
  PACKAGE_FULLTEXT_STATUS,
  collectLicenseFulltext,
  formatFulltextLog,
} from "../../../../gates/supply/supply/collect-license-fulltext.mjs";
import {
  LICENSE_FILE_EXTENSIONS,
  classifyLicense,
  createDecisionIndex,
  detectPackageLicense,
  hashBuffer,
  listLicenseFiles,
  serializeJson,
} from "../../../../gates/supply/supply/supply-common.mjs";

const suite = createCaseSuite();

/**
 * 断言辅助(局部版:case 级用 test/harness/case.js 的 assert,这里用于非 case 上下文)。
 * 声明为断言函数,让 `assert(x !== undefined)` 之后 TS 真正收窄类型。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`collect-license-fulltext 断言失败:${msg}`);
}

/**
 * 临时目录 + 兜底清理(测试对象是夹具,finally 保证不留残留)。
 * 清理走 removeTree(带 EBUSY/EPERM 退避重试与删后复查);删不掉仍即抛 ——
 * 「删不掉就抛」是本段原有的失败语义,助手只负责吸收 Windows 上的瞬时占用。
 * @param {(dir: string) => unknown} fn 在临时目录上执行的夹具逻辑
 * @returns {Promise<unknown>} fn 的返回值(透传)
 */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-fulltext-"));
  try {
    return await fn(dir);
  } finally {
    const outcome = removeTree(dir);
    if (!outcome.ok) throw new Error(`临时目录清理失败:${dir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
  }
}

/**
 * 造一份沙盒 lockfile:逐个条目决定是否带 license 字段。
 * @param {string} dir 沙盒目录
 * @param {Array<{ name: string; version: string; license?: string }>} entries 组件条目(省略 license 即无字段)
 * @returns {string} lockfile 绝对路径
 */
function makeFallbackLockfile(dir, entries) {
  /** @type {Record<string, any>} */
  const packages = { "": { name: "sandbox-app", version: "1.0.0", license: "MIT", dependencies: {} } };
  for (const entry of entries) {
    packages[""].dependencies[entry.name] = `^${entry.version}`;
    packages[`node_modules/${entry.name}`] = entry.license === undefined ? { version: entry.version } : { version: entry.version, license: entry.license };
  }
  const lockPath = path.join(dir, "package-lock.json");
  fs.writeFileSync(lockPath, `${JSON.stringify({ name: "sandbox-app", version: "1.0.0", lockfileVersion: 3, requires: true, packages }, null, 2)}\n`, "utf8");
  return lockPath;
}

/**
 * 在沙盒里造一个「已安装包目录」:合成 node_modules/<name>/ 及其中的许可证文件。
 * 断言只读沙盒内容,不依赖本机真实 node_modules。
 * @param {string} dir 沙盒根目录
 * @param {string} name 包名
 * @param {Record<string, string>} [files] 文件名 → 正文(省略即只建空目录)
 * @returns {string} 包目录绝对路径
 */
function makePackageDir(dir, name, files = {}) {
  const packageDir = path.join(dir, "node_modules", ...name.split("/"));
  fs.mkdirSync(packageDir, { recursive: true });
  for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(packageDir, file), body, "utf8");
  return packageDir;
}

/**
 * 造一份沙盒决策清单(内存索引,不读仓库里真实的决策文件 —— 断言不得依赖本机依赖树)。
 * @param {Array<Record<string, string>>} entries 决策记录
 * @returns {ReturnType<typeof createDecisionIndex>} 决策索引
 */
function makeDecisions(entries) {
  return createDecisionIndex(entries, { source: "(sandbox/license-decisions.json)", sha256: "sandbox-digest" });
}

/**
 * 跑 CLI 子进程(Electron 宿主下用 ELECTRON_RUN_AS_NODE 走真实 Node 行为)。
 * @param {string[]} args 脚本参数
 * @returns {{ status: number | null; output: string }}
 */
function runCli(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/* ---------- 许可证文件夹具(取各许可证真实文首特征,只保留可判别的那几行) ---------- */

/** MIT 文首(与 khroma 随包分发的 license 文件同形:小写文件名 + "The MIT License (MIT)") */
const LICENSE_TEXT_MIT = `The MIT License (MIT)

Copyright (c) 2019-present Someone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software.
`;

// MIT 正文 + BOM + CRLF:用来钉住「全文副本逐字节相同」,一旦经过字符串往返就会被改写
const LICENSE_TEXT_MIT_BOM_CRLF = `\uFEFF${LICENSE_TEXT_MIT.replace(/\n/g, "\r\n")}`;

/** BSD-2/3-Clause 共有的首段(用于扩展名候选集的负向夹具) */
const LICENSE_TEXT_BSD_SHARED = `Copyright (c) 2026, Someone

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
`;
const LICENSE_TEXT_BSD2 = LICENSE_TEXT_BSD_SHARED;

/**
 * 许可证全文收集的沙盒依赖:一个带许可证文件(带 BOM + CRLF,用于证明逐字复制)、一个
 * 多选一包(带小写 licence 文件名)、一个完全没有许可证文件的包。
 * @param {string} dir 沙盒目录
 * @returns {string} lockfile 绝对路径
 */
function makeFulltextLockfile(dir) {
  return makeFallbackLockfile(dir, [
    { name: "text-lib", version: "1.0.0", license: "MIT" },
    { name: "dual-lib", version: "2.0.0", license: "(MIT OR GPL-3.0-or-later)" },
    { name: "silent-lib", version: "3.0.0", license: "MIT" },
  ]);
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  await withTempDir(async (tmp) => {
    await suite.case("许可证全文按需收集:逐字落盘 + 记录来源/识别结果;取不到必须记 missing", async () => {
      const dir = path.join(tmp, "license-fulltext");
      fs.mkdirSync(dir, { recursive: true });
      const lockPath = makeFulltextLockfile(dir);
      makePackageDir(dir, "text-lib", { LICENSE: LICENSE_TEXT_MIT_BOM_CRLF });
      makePackageDir(dir, "dual-lib", { licence: LICENSE_TEXT_MIT });
      makePackageDir(dir, "silent-lib", { readme: "no license here" });
      const outputDir = path.join(dir, "out");
      const decisions = makeDecisions([
        {
          name: "dual-lib",
          versionRange: "*",
          upstreamExpression: "(MIT OR GPL-3.0-or-later)",
          selectedBranch: "MIT",
          rationale: "取非 GPL 分支",
          decidedOn: "2026-09-26",
          decidedBy: "用户 2026-09-26",
        },
      ]);
      const report = collectLicenseFulltext({ lockPath, lockLabel: "package-lock.json", outputDir, decisions });

      // 逐字落盘:BOM 与 CRLF 都必须原样保留(经过字符串往返的副本不能用来履行附全文义务)
      const copied = path.join(outputDir, "licenses-fulltext", "text-lib@1.0.0", "LICENSE");
      assert(fs.readFileSync(copied, "utf8") === LICENSE_TEXT_MIT_BOM_CRLF, "许可证全文须逐字复制(BOM/换行不得被改写)");
      assert(fs.readFileSync(copied).equals(fs.readFileSync(path.join(dir, "node_modules", "text-lib", "LICENSE"))), "副本须与源文件逐字节相同");

      // 清单记录:来自哪个包、哪个文件名、识别结果
      assert(report.counts.production === 3 && report.counts.files === 2, `计数应可核对,实际 ${JSON.stringify(report.counts)}`);
      const text = report.packages.find((item) => item.name === "text-lib");
      const record = text?.files[0];
      assert(record?.sourceFile === "LICENSE", `须记录来源文件名,实际 ${JSON.stringify(record)}`);
      assert(record?.storedPath === "licenses-fulltext/text-lib@1.0.0/LICENSE", `须记录副本相对路径,实际 ${record?.storedPath}`);
      assert(record?.sha256 === hashBuffer(Buffer.from(LICENSE_TEXT_MIT_BOM_CRLF, "utf8")), "须记录副本内容指纹");
      assert(record?.detectedLicense === "MIT" && record?.match === "text" && record?.recognized === true, `须记录该文件的许可证识别结果,实际 ${JSON.stringify(record)}`);
      const dual = report.packages.find((item) => item.name === "dual-lib");
      assert(dual?.files[0]?.sourceFile === "licence" && dual?.effectiveLicense === "MIT" && dual?.obligations !== null, "多选一包须带上选定分支与义务摘要");

      // 取不到许可证文件:显式记 missing 并报出,不得静默跳过
      const silent = report.packages.find((item) => item.name === "silent-lib");
      assert(silent?.status === PACKAGE_FULLTEXT_STATUS.missing && silent?.reasonCode === "no-license-file", `无许可证文件须记 missing/no-license-file,实际 ${JSON.stringify(silent)}`);
      assert(silent?.files.length === 0 && report.missing.join() === "silent-lib@3.0.0", `缺项须进 missing 清单,实际 ${report.missing.join()}`);
      // 名字像许可证但扩展名不在候选内(如 LICENSE.BSD):须报出,否则会被误读成
      // 「上游没随包发许可」;但候选名规则不得顺手放宽(那会改变许可证识别层的判定口径)
      makePackageDir(dir, "silent-lib", { "LICENSE.BSD": LICENSE_TEXT_MIT });
      const withNearMiss = collectLicenseFulltext({ lockPath, lockLabel: "package-lock.json", outputDir, decisions });
      const nearMiss = withNearMiss.packages.find((item) => item.name === "silent-lib");
      assert(nearMiss?.status === PACKAGE_FULLTEXT_STATUS.missing, "候选名不认的文件不得被当成已收集");
      assert(nearMiss?.unrecognizedNameFiles?.join() === "LICENSE.BSD", `须报出名字像许可证的文件,实际 ${JSON.stringify(nearMiss?.unrecognizedNameFiles)}`);
      assert(/名字像许可证但扩展名不在候选内的文件:LICENSE\.BSD/.test(formatFulltextLog(withNearMiss).join("\n")), "日志须点名该文件,便于人工去取原文");
      assert(report.status === "incomplete", "有缺项时整体状态应为 incomplete");
      const log = formatFulltextLog(report).join("\n");
      assert(/\[fulltext:missing\] silent-lib@3\.0\.0 — no-license-file/.test(log), `缺项须逐条报出,实际:${log}`);
      assert(/全文收集不完整\(缺 1/.test(log), "须汇总报出不完整");

      // 确定性:同一 lockfile + 同一安装树,两次产物逐字节相同(比对须在树稳定之后,
      // 否则上面刻意加过文件的动作会让两次输入本就不同,断言会假失败)
      const again = collectLicenseFulltext({ lockPath, lockLabel: "package-lock.json", outputDir, decisions });
      assert(serializeJson(again) === serializeJson(withNearMiss), "两次收集的清单必须逐字节相同(不写时间戳)");

      // 进程级 CLI:默认 exit 0 但必须报出缺项;--strict 下判红
      const outCli = path.join(dir, "out-cli");
      const cli = runCli(["gates/supply/supply/collect-license-fulltext.mjs", "--lock", lockPath, "--output-dir", outCli, "--decisions", "gates/supply/supply/license-decisions.json"]);
      assert(cli.status === 0, `收集完成时应 exit 0(缺项已报出),实际 ${cli.status}:${cli.output}`);
      assert(/\[fulltext:missing\] silent-lib@3\.0\.0/.test(cli.output), `CLI 须报出缺项,实际:${cli.output}`);
      assert(fs.existsSync(path.join(outCli, "licenses-fulltext.json")), "CLI 应产出清单文件");
      const strict = runCli(["gates/supply/supply/collect-license-fulltext.mjs", "--lock", lockPath, "--output-dir", outCli, "--strict"]);
      assert(strict.status === 1 && /--strict/.test(strict.output), `--strict 下缺项应判红,实际 ${strict.status}:${strict.output}`);
    });

    await suite.case("候选名含 .markdown:jszip 类包能收齐全文,且不因扩展名就把非许可证文件当许可证", async () => {
      const dir = path.join(tmp, "license-markdown-ext");
      fs.mkdirSync(dir, { recursive: true });
      const lockPath = makeFallbackLockfile(dir, [
        { name: "dual-md", version: "1.0.0", license: "(MIT OR GPL-3.0-or-later)" },
        { name: "business-md", version: "2.0.0", license: "MIT" },
        { name: "near-miss-bsd", version: "3.0.0", license: "MIT" },
      ]);
      // ① 正向:.markdown 扩展名的许可证文件必须被收进候选集并逐字复制
      makePackageDir(dir, "dual-md", { "LICENSE.markdown": LICENSE_TEXT_MIT });
      // ③ 负向:同名同扩展名但内容是普通业务文档 —— 扩展名匹配不得成为放行依据
      makePackageDir(dir, "business-md", { "LICENSE.markdown": "Copyright 2026 Someone. All rights reserved.\n" });
      // 诊断项:名字像许可证但扩展名仍不在候选内(.BSD 未收录),须报出而不静默跳过
      makePackageDir(dir, "near-miss-bsd", { "LICENSE.BSD": LICENSE_TEXT_BSD2 });

      const report = collectLicenseFulltext({ lockPath, lockLabel: "package-lock.json", outputDir: path.join(dir, "out"), decisions: null });

      // ① jszip 形态的包:.markdown 被收齐,逐字落盘并记录来源文件名与哈希
      const dual = report.packages.find((item) => item.name === "dual-md");
      assert(dual?.status === PACKAGE_FULLTEXT_STATUS.collected, `.markdown 许可证文件应收齐,实际 ${JSON.stringify(dual)}`);
      const dualFile = dual?.files[0];
      assert(dualFile?.sourceFile === "LICENSE.markdown", `须记录来源文件名,实际 ${JSON.stringify(dualFile)}`);
      assert(dualFile?.storedPath === "licenses-fulltext/dual-md@1.0.0/LICENSE.markdown", `须记录副本路径,实际 ${dualFile?.storedPath}`);
      assert(dualFile?.sha256 === hashBuffer(Buffer.from(LICENSE_TEXT_MIT, "utf8")), "须记录副本内容指纹");
      assert(fs.readFileSync(path.join(dir, "out", "licenses-fulltext", "dual-md@1.0.0", "LICENSE.markdown"), "utf8") === LICENSE_TEXT_MIT, "全文须逐字落盘");

      // ③ 负向不回归:扩展名匹配只决定「看不看这个文件」,不决定「认不认它是许可证」。
      // 内容认不出必须仍记 unrecognized/unknown + needsReview,绝不放行 —— 这是
      // 「.markdown 是通用扩展名」这项改动的全部风险点,必须钉死。
      const business = report.packages.find((item) => item.name === "business-md");
      assert(business?.files.length === 1, "该文件仍应被复制(供人工看),只是认不出内容");
      assert(business?.files[0]?.recognized === false && business?.files[0]?.detectedLicense === null, `扩展名匹配不得成为放行依据,实际 ${JSON.stringify(business?.files[0])}`);
      assert(business?.status === PACKAGE_FULLTEXT_STATUS.copiedUnrecognized, `认不出须记 copied-unrecognized,实际 ${business?.status}`);
      assert(report.unrecognized.join() === "business-md@2.0.0", `未识别项须进清单报出,实际 ${report.unrecognized.join()}`);
      // 判定层同样不放行:二级回落对认不出的文件返回 unknown → 判红
      const businessDir = path.join(dir, "node_modules", "business-md");
      assert(detectPackageLicense(businessDir).status === "unrecognized", "识别层须记 unrecognized");
      assert(detectPackageLicense(businessDir).license === null, "认不出时不得给出任何许可证标识");
      assert(classifyLicense(detectPackageLicense(businessDir).license).needsReview === true, "认不出必须保持需人工复核,不得因扩展名放行");

      // 诊断项仍报出,且不被当成已收集
      const bsd = report.packages.find((item) => item.name === "near-miss-bsd");
      assert(bsd?.status === PACKAGE_FULLTEXT_STATUS.missing && bsd?.unrecognizedNameFiles?.join() === "LICENSE.BSD", `未收录扩展名须报出,实际 ${JSON.stringify(bsd)}`);

      // 扩展名清单是单源:新增 .markdown 后仍由同一张表派生,排序稳定
      assert(LICENSE_FILE_EXTENSIONS.join() === ",.txt,.md,.rst,.markdown", `扩展名单源内容应固定,实际 ${LICENSE_FILE_EXTENSIONS.join()}`);
      assert(listLicenseFiles(path.join(dir, "node_modules", "dual-md")).join() === "LICENSE.markdown", "候选名识别应含 .markdown");
    });
  });

  return { cases: suite.results };
}