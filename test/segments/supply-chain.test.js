// @ts-check
/**
 * 供应链门禁段(位于 test/segments/ = 跨域守护段;被测为 scripts/supply/ 下的
 * SCA / SBOM / 许可证脚本,纯 Node 逻辑,不经 dist 编译产物):
 * - sca-audit.mjs:npm audit(npmmirror 端点)两棵依赖树 + OSV 替代源;
 *   真实漏洞判红、扫描源不可用判 unavailable(绝不冒充「无漏洞」)、production/dev 区分
 * - gen-sbom.mjs:CycloneDX 1.6 SBOM 的离线确定性与 --check 漂移检测
 * - gen-licenses.mjs:licenses.json / NOTICE.md,未知许可证判红、copyleft 单列;
 *   多选一分支选定(决策只作用于生产依赖,前提不符即不生效)
 * - collect-license-fulltext.mjs:按需收集生产依赖的许可证全文副本(逐字复制 + 缺项报出)
 * - check-supply-chain.mjs:三段编排与进程级 CLI 退出码
 *
 * 断言方式:临时目录里造沙盒 lockfile,注入假的 npm transport 与 OSV fetch(依赖注入
 * 换来的确定性),断言返回的退出码 **与具体诊断文案**(只看退出码会让「因错误原因失败」
 * 的检查蒙混过关),最后用本地桩 registry 跑一遍端到端的进程级 CLI 正/负实跑。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createCaseSuite } from "../common/case.js";
import { ROOT } from "../common/paths.js";
import { formatSupplyLog, runSupplyChecks } from "../../scripts/supply/check-supply-chain.mjs";
import { diffSbom, generateSbom, toCycloneDxLicenses } from "../../scripts/supply/gen-sbom.mjs";
import { generateLicenses } from "../../scripts/supply/gen-licenses.mjs";
import { PACKAGE_FULLTEXT_STATUS, collectLicenseFulltext, formatFulltextLog } from "../../scripts/supply/collect-license-fulltext.mjs";
import {
  STATUS_OK as SCA_OK,
  STATUS_UNAVAILABLE,
  buildAuditPlan,
  compareSemver,
  formatScaLog,
  parseAuditPayload,
  runScaScan,
} from "../../scripts/supply/sca-audit.mjs";
import {
  DECISION_STATUS,
  LICENSE_FILE_EXTENSIONS,
  LICENSE_SHAPE,
  LICENSE_TEXT_MARKERS,
  classifyLicense,
  detectLicensesInText,
  createDecisionIndex,
  cvss3BaseScore,
  loadLicenseDecisions,
  detectLicenseFromText,
  detectPackageLicense,
  expressionIncludesBranch,
  hashBuffer,
  listLicenseFiles,
  parseVersionRange,
  resolveDepPath,
  resolveObligationSummary,
  severityFromScore,
  serializeJson,
  versionSatisfies,
} from "../../scripts/supply/supply-common.mjs";

const suite = createCaseSuite();

/**
 * 断言辅助(局部版:case 级用 test/common/case.js 的 assert,这里用于非 case 上下文)。
 * 声明为断言函数,让 `assert(x !== undefined)` 之后 TS 真正收窄类型。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`supply-chain 断言失败:${msg}`);
}

/**
 * 取分组列表(Record 索引在 noUncheckedIndexedAccess 下是可选的,统一在此收口)。
 * @param {Record<string, string[]>} groups 分组映射
 * @param {string} key 分组名
 * @returns {string[]} 该分组的条目(缺失时为空数组)
 */
function group(groups, key) {
  return groups[key] ?? [];
}

/**
 * 临时目录 + 兜底清理(测试对象是夹具,finally 保证不留残留)。
 * @param {(dir: string) => unknown} fn 在临时目录上执行的夹具逻辑
 * @returns {Promise<unknown>} fn 的返回值(透传)
 */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-supply-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 造一份沙盒 lockfile。刻意做成「有生产依赖、有仅 dev 依赖、有嵌套依赖、有缺许可证
 * 的包」,这样 production/dev 判定、copyleft 分类、未知许可证三条都能在同一份夹具上验证。
 * @param {string} dir 沙盒目录
 * @param {{ noLicense?: boolean }} [options] 夹具开关
 * @returns {string} lockfile 绝对路径
 */
function makeLockfile(dir, options = {}) {
  /** @type {Record<string, any>} */
  const packages = {
    "": {
      name: "sandbox-app",
      version: "1.0.0",
      license: "MIT",
      dependencies: { "prod-lib": "^1.0.0", "mixed-lib": "^1.0.0" },
      devDependencies: { "dev-tool": "^2.0.0" },
    },
    "node_modules/prod-lib": { version: "1.0.2", resolved: "https://registry.npmmirror.com/prod-lib/-/prod-lib-1.0.2.tgz", integrity: "sha512-aaa", license: "MIT" },
    "node_modules/mixed-lib": { version: "1.0.0", license: "MIT", dependencies: { "inner-lib": "^1.0.0" } },
    "node_modules/mixed-lib/node_modules/inner-lib": { version: "1.0.1", license: "LGPL-3.0-or-later" },
    "node_modules/dev-tool": { version: "2.0.0", dev: true, license: "GPL-3.0-or-later" },
    "node_modules/inner-lib": { version: "1.0.0", license: "Apache-2.0" },
  };
  if (options.noLicense !== false) {
    packages["node_modules/no-license"] = { version: "0.1.0" };
    packages[""].dependencies = { ...packages[""].dependencies, "no-license": "^0.1.0" };
  }
  const lockPath = path.join(dir, "package-lock.json");
  fs.writeFileSync(lockPath, `${JSON.stringify({ name: "sandbox-app", version: "1.0.0", lockfileVersion: 3, requires: true, packages }, null, 2)}\n`, "utf8");
  return lockPath;
}

/**
 * 造一份「许可证回落」专用的沙盒 lockfile:逐个条目决定是否带 license 字段。
 * 刻意与 makeLockfile 分开 —— 回落口径的断言要精确到「哪个包有字段、哪个包只有文件」。
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
 * 造一份「多选一许可」专用的沙盒 lockfile:两个**生产**多选一包 + 一个 dev-only 多选一包
 * (与生产包同名、靠嵌套落在 dev 树里),用于验证「决策只作用于生产依赖」——
 * 同名不同树是这里唯一能把「范围/表达式不符」与「范围不对」区分开的夹具。
 * @param {string} dir 沙盒目录
 * @returns {string} lockfile 绝对路径
 */
function makeDecisionLockfile(dir) {
  /** @type {Record<string, any>} */
  const packages = {
    "": {
      name: "sandbox-app",
      version: "1.0.0",
      license: "MIT",
      dependencies: { "dom-pick": "^1.0.0", "zip-pick": "^2.0.0" },
      devDependencies: { "dev-tool": "^3.0.0" },
    },
    "node_modules/dom-pick": { version: "1.4.2", license: "(MPL-2.0 OR Apache-2.0)" },
    "node_modules/zip-pick": { version: "2.0.0", license: "(MIT OR GPL-3.0-or-later)" },
    "node_modules/dev-tool": { version: "3.0.0", dev: true, license: "MIT", dependencies: { "dom-pick": "^9.0.0" } },
    "node_modules/dev-tool/node_modules/dom-pick": { version: "9.9.9", dev: true, license: "(MPL-2.0 OR Apache-2.0)" },
  };
  const lockPath = path.join(dir, "package-lock.json");
  fs.writeFileSync(lockPath, `${JSON.stringify({ name: "sandbox-app", version: "1.0.0", lockfileVersion: 3, requires: true, packages }, null, 2)}\n`, "utf8");
  return lockPath;
}

/**
 * 造一份沙盒决策清单(内存索引,不读仓库里真实的决策文件 —— 断言不得依赖本机依赖树)。
 * @param {Array<Record<string, string>>} entries 决策记录
 * @returns {ReturnType<typeof createDecisionIndex>} 决策索引
 */
function makeDecisions(entries) {
  return createDecisionIndex(entries, { source: "(sandbox/license-decisions.json)", sha256: "sandbox-digest" });
}

/** 沙盒里两条生效决策(字段形状与仓库真实的 license-decisions.json 一致) */
const SANDBOX_DECISIONS = [
  {
    name: "dom-pick",
    versionRange: "*",
    upstreamExpression: "(MPL-2.0 OR Apache-2.0)",
    selectedBranch: "Apache-2.0",
    rationale: "多选一取非 copyleft 分支",
    decidedOn: "2026-09-26",
    decidedBy: "用户 2026-09-26",
  },
  {
    name: "zip-pick",
    versionRange: "*",
    upstreamExpression: "(MIT OR GPL-3.0-or-later)",
    selectedBranch: "MIT",
    rationale: "多选一取非 GPL 分支",
    decidedOn: "2026-09-26",
    decidedBy: "用户 2026-09-26",
  },
];

/**
 * 取报告里某个组件的许可证条目。
 * @param {{ packages: Array<{ name: string }> }} report 许可证报告
 * @param {string} name 包名
 * @returns {any} 该组件条目(不存在时抛错)
 */
function licenseEntryOf(report, name) {
  const entry = report.packages.find((item) => item.name === name);
  if (entry === undefined) throw new Error(`报告里没有 ${name} 的条目`);
  return entry;
}

/**
 * 假的 npm transport:按 args 里的 --omit=dev 区分两棵树,并回放预置的 audit JSON。
 * 同时把每次调用的命令与参数记进 calls,供「两棵树确实分别跑了」断言。
 * @param {Record<string, { stdout: string; stderr?: string; exitCode?: number; timedOut?: boolean }>} byTree 两棵树的回放内容
 * @returns {{ transport: (command: string, args: string[], options?: unknown) => Promise<any>; calls: { command: string; args: string[]; line: string }[] }} 注入件
 */
function fakeNpm(byTree) {
  /** @type {{ command: string; args: string[]; line: string }[]} */
  const calls = [];
  const transport = async (/** @type {string} */ command, /** @type {string[]} */ args) => {
    calls.push({ command, args, line: [command, ...args].join(" ") });
    const tree = args.join(" ").includes("--omit=dev") ? "production" : "all";
    const preset = byTree[tree] ?? { stdout: JSON.stringify({ metadata: { vulnerabilities: {} }, vulnerabilities: {} }), exitCode: 0 };
    return {
      ok: preset.exitCode === 0 && preset.timedOut !== true,
      exitCode: preset.exitCode ?? 0,
      signal: null,
      stdout: preset.stdout,
      stderr: preset.stderr ?? "",
      timedOut: preset.timedOut ?? false,
      timeoutMs: 0,
      spawnError: null,
    };
  };
  return { transport, calls };
}

/** 真实形状的 audit JSON:发现一个 high 漏洞(取自 npm audit 实际输出结构) */
function auditJsonWithVuln(/** @type {string} */ name, /** @type {string} */ severity) {
  return JSON.stringify({
    auditReportVersion: 2,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    vulnerabilities: {
      [name]: {
        name,
        severity,
        isDirect: true,
        via: [{ source: 1102341, name, dependency: name, title: "Prototype Pollution in " + name, url: "https://github.com/advisories/GHSA-test-0000-0000", severity }],
        effects: [],
        nodes: ["node_modules/" + name],
        fixAvailable: { name, version: "1.0.3" },
      },
    },
  });
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

/** Apache-2.0 文首(标题行 + 版本行/官方 URL 成对出现) */
const LICENSE_TEXT_APACHE = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.
`;

/** GPL-3.0 文首 */
const LICENSE_TEXT_GPL3 = `                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.
`;

/** LGPL-3.0 文首(内含"version 3 of the GNU General Public License"一句,不得被 GPL 标记抢走) */
const LICENSE_TEXT_LGPL3 = `                   GNU LESSER GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 This version of the GNU Lesser General Public License incorporates
 the terms and conditions of version 3 of the GNU General Public License,
 supplemented by the additional permissions listed below.
`;

/** AGPL-3.0 文首 */
const LICENSE_TEXT_AGPL3 = `                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
`;

/** MPL-2.0 文首 */
const LICENSE_TEXT_MPL2 = `Mozilla Public License Version 2.0

1. Definitions.
`;

/** Unlicense 文首 */
const LICENSE_TEXT_UNLICENSE = `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute
this software, either in source code form or as a compiled binary.

For more information, please refer to <https://unlicense.org/>
`;

/** ISC 文首(标题行是唯一可判别处:正文与 0BSD 几乎逐字相同) */
const LICENSE_TEXT_ISC = `ISC License

Copyright (c) 2026, Someone

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.
`;

/** 0BSD 文首 */
const LICENSE_TEXT_0BSD = `Zero-Clause BSD (0BSD)

Copyright (C) 2026 Person

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.
`;

/** BSD-2/3-Clause 共有的首段;BSD-3 额外有"Neither the name of"条款 */
const LICENSE_TEXT_BSD_SHARED = `Copyright (c) 2026, Someone

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
`;
const LICENSE_TEXT_BSD3 = `${LICENSE_TEXT_BSD_SHARED}
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.
`;
const LICENSE_TEXT_BSD2 = LICENSE_TEXT_BSD_SHARED;

// MIT 正文 + BOM + CRLF:用来钉住「全文副本逐字节相同」,一旦经过字符串往返就会被改写
const LICENSE_TEXT_MIT_BOM_CRLF = `\uFEFF${LICENSE_TEXT_MIT.replace(/\n/g, "\r\n")}`;

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

/**
 * 判定一个 GNU 系标记是否要求版本行(AGPL 收紧的根因就是它曾不要求)。
 *
 * 判据刻意收窄到「GNU 系 + 必须带版本行」这一族:0BSD/ISC/MIT/Unlicense 属
 * 标题行/特征句族,它们与「版本行」无关(0BSD 与 ISC 正文几乎逐字相同、只有标题行
 * 不同,本来就只能认标题行)。把这几族也塞进同一条断言会逼出一堆与本次根因无关的
 * 改动,反而扩大风险面。
 * @param {RegExp} re 标记正则
 * @returns {boolean} 该标记是否属于「必须要求版本行」的 GNU 系
 */
function isGnuFamilyRequiringVersion(re) {
  return /GNU (?:AFFERO |LESSER |LIBRARY )?GENERAL PUBLIC LICENSE/i.test(re.source);
}

/**
 * d3-geo 型拼接文件:上游 ISC 正文 + 内嵌 GeographicLib 的 MIT 正文。
 * 取自 node_modules/d3-geo/LICENSE 的真实结构(两段各有独立的 Copyright 行与授权段)。
 */
const LICENSE_TEXT_D3GEO_STYLE = `Copyright 2010-2024 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.

This license applies to GeographicLib, versions 1.12 and later.

Copyright 2008-2012 Charles Karney

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal
in the Software without restriction.
`;

/**
 * d3-scale-chromatic 型拼接文件:上游 ISC 正文 + ColorBrewer 的 Apache-2.0 声明段。
 * 取自 node_modules/d3-scale-chromatic/LICENSE 的真实结构。
 */
const LICENSE_TEXT_D3SCALE_STYLE = `Copyright 2010-2024 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS".

Apache-Style Software License for ColorBrewer software and ColorBrewer Color Schemes

Copyright 2002 Cynthia Brewer, Mark Harrower, and The Pennsylvania State University

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

http://www.apache.org/licenses/LICENSE-2.0
`;

/**
 * marked 型拼接文件:MIT 正文 + 一段 BSD-3 派生的 CLA(含免责声明条款)。
 * 取自 node_modules/marked/LICENSE.md 的真实结构。
 */
const LICENSE_TEXT_MARKED_STYLE = `# License information

## Contribution License Agreement

If you contribute code to this project, you are implicitly allowing your code
to be distributed under the MIT license.

## Marked

Copyright (c) 2018+, MarkedJS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

* Neither the name “Markdown” nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
`;

/**
 * GPL-3.0 全文节选:正文含 AGPL/LGPL 交叉引用(第 13 节),但这是**单个**许可证文件。
 * 用于钉住红线 —— 交叉引用不得被当成「多许可证拼接」。
 */
const LICENSE_TEXT_GPL3_FULL = `                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

  Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
  Everyone is permitted to copy and distribute verbatim copies
  of this license document, but changing it is not allowed.

  13. Use with the GNU Affero General Public License.

  Notwithstanding any other provision of this License, you have
permission to link or combine your covered work with a work licensed
under version 3 of the GNU Affero General Public License into a single
combined work, and to convey the resulting work.

  This License does not grant permission to use the trade names,
trademarks, service marks, or product names of the licensor.
`;

/**
 * Apache-2.0 全文节选:含文末「APPENDIX: How to apply」许可模板。
 * 模板里的 "Licensed under the Apache License" 是**同一许可证**的适用声明,
 * 不是第二套许可证 —— 用于钉住红线,不得判成多许可。
 */
const LICENSE_TEXT_APACHE_FULL = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
and distribution as defined by Sections 1 through 9 of this document.

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
boilerplate notice, with the fields enclosed by brackets "[]"
replaced with your own identifying information.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0
`;

/**
 * jszip 的 LICENSE.markdown 真实文首(节选):「MIT + GPLv3 双许可合订本」,开篇即声明
 * 二选一,后附 MIT 全文与 GPLv3 全文。
 *
 * 复现的坑:GPLv3 正文第 13 节有一句交叉引用「Use with the GNU Affero General Public
 * License」,而 AGPL 标记若不要求版本行,就会把这份文件判成 AGPL-3.0 —— 比它真实的
 * 许可(MIT OR GPL-3.0-or-later)更强,错标会误导人工复核。
 */
const LICENSE_TEXT_DUAL_MIT_GPL = `JSZip is dual licensed. At your choice you may use it under the MIT license *or* the GPLv3
license.

The MIT License
===============

Copyright (c) 2009-2016 Stuart Knightley

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.

GPL version 3
=============

                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

  13. Use with the GNU Affero General Public License.

  Notwithstanding any other provision of this License, you have
permission to link or combine your covered work with a work licensed
under version 3 of the GNU Affero General Public License into a single
combined work.
`;

/**
 * GPLv3 正文第 13 节的交叉引用片段(单独一段,不含任何 AGPL 标题行)。
 * 用于钉住「GPLv3 提到 AGPL ≠ 这份文件是 AGPL」。
 */
const LICENSE_TEXT_GPL3_SECTION13 = `                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

  13. Use with the GNU Affero General Public License.
`;

/**
 * BSD-3-Clause 变体:免责声明条款写成「The name <持有者> may not be used to endorse」,
 * 而不是模板里的「Neither the name of ...」(rw@1.3.3 的真实写法)。
 * 用于钉住「有免责声明条款但不是模板措辞时,不得被当成二条款」。
 */
const LICENSE_TEXT_BSD3_NAMED = `Copyright (c) 2014-2016, Michael Bostock
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* The name Michael Bostock may not be used to endorse or promote products
  derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED.
`;

/** npmmirror audit 端点不可用的真实响应(npm 打到 stdout 的那段 JSON) */
const MIRROR_AUDIT_UNAVAILABLE = {
  stdout: JSON.stringify({
    message: "404 Not Found - POST https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk - [NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet",
    method: "POST",
    uri: "https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk",
    statusCode: 404,
    body: { error: "[NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet" },
    error: { summary: "", detail: "" },
  }),
  stderr: "npm warn audit 404 Not Found - POST https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk - [NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet\nnpm error audit endpoint returned an error",
  exitCode: 1,
};

/**
 * 假的 OSV fetch:两阶段(querybatch → 只给 id;v1/vulns/:id → 详情)。
 * 形状与 startStubOsv 保持一致(包名 → 公告数组),避免两处桩各说各话。
 * @param {Record<string, { id: string }[]>} hits 包名 → 命中的公告
 * @returns {typeof fetch} 注入件
 */
function fakeOsv(hits) {
  const impl = async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    const body = JSON.parse(String(init.body ?? "{}"));
    if (url.endsWith("/v1/querybatch")) {
      const results = body.queries.map((/** @type {{ package: { name: string } }} */ query) => {
        const hit = hits[query.package.name];
        return { vulns: (hit ?? []).map((vuln) => ({ id: vuln.id, modified: "2026-01-01T00:00:00Z" })) };
      });
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    const match = /\/v1\/vulns\/(.+)$/.exec(url);
    if (match !== null) {
      const id = decodeURIComponent(match[1] ?? "");
      for (const vulns of Object.values(hits)) {
        const found = vulns.find((vuln) => vuln.id === id);
        if (found !== undefined) return new Response(JSON.stringify(found), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  };
  return /** @type {typeof fetch} */ (/** @type {unknown} */ (impl));
}

/** 一条真实的 GHSA 公告形状(取自 OSV 详情接口) */
const GHSA_VULN = {
  id: "GHSA-test-0000-0000",
  summary: "Prototype Pollution in prod-lib",
  database_specific: { severity: "HIGH", cwe_ids: ["CWE-1321"] },
  severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
  affected: [{ package: { name: "prod-lib", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.0.3" }] }] }],
};

/**
 * 起一个本地桩 OSV 服务(空结果 → 「扫描通过」),供进程级 CLI 端到端实跑,
 * 不依赖外网也让正例可复现。
 * @param {Record<string, { id: string }[]>} hits 包名 → 公告
 * @returns {Promise<{ endpoint: string; close: () => Promise<void>; requests: string[] }>}
 */
async function startStubOsv(hits) {
  /** @type {string[]} */
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? "");
    if (req.url === "/v1/querybatch") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const results = body.queries.map((/** @type {{ package: { name: string } }} */ query) => {
          const hit = hits[query.package.name];
          return { vulns: (hit ?? []).map((vuln) => ({ id: vuln.id, modified: "2026-01-01T00:00:00Z" })) };
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ results }));
      });
      return;
    }
    const match = /^\/v1\/vulns\/(.+)$/.exec(req.url ?? "");
    if (match !== null) {
      const id = decodeURIComponent(match[1] ?? "");
      for (const vulns of Object.values(hits)) {
        const found = vulns.find((vuln) => vuln.id === id);
        if (found !== undefined) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(found));
          return;
        }
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

/**
 * 跑 CLI 子进程(Electron 宿主下用 ELECTRON_RUN_AS_NODE 走真实 Node 行为)。
 * 同步版适用于不需要本进程继续服务事件的场景(桩服务在同进程时必须用异步版)。
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

/**
 * 异步跑 CLI 子进程:子进程要访问本进程内的桩 OSV 服务时必须用它 ——
 * spawnSync 会堵死本进程事件循环,桩服务收不到请求,子进程只会等到超时。
 * @param {string[]} args 脚本参数
 * @returns {Promise<{ status: number | null; output: string }>}
 */
function runCliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ status: code, output }));
  });
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  await withTempDir(async (tmp) => {
    // 每个 case 一份独立沙盒:SBOM/漂移类 case 会改写 lockfile,共用会让后续 case 读到脏输入
    /**
     * 新建一个 case 沙盒(独立目录 + 独立 lockfile)。
     * @param {string} label case 名(兼作目录名)
     * @param {{ noLicense?: boolean }} [options] 夹具开关
     * @returns {{ dir: string; lockPath: string }} 沙盒路径
     */
    const sandbox = (label, options = {}) => {
      const dir = path.join(tmp, label);
      fs.mkdirSync(dir, { recursive: true });
      return { dir, lockPath: makeLockfile(dir, options) };
    };

    await suite.case("SCA 生产树真实漏洞 → 判红并列出包名/严重度/修复版本", async () => {
      const { lockPath } = sandbox("sca-vuln");
      const npm = fakeNpm({ production: { stdout: auditJsonWithVuln("prod-lib", "high"), exitCode: 1 }, all: { stdout: auditJsonWithVuln("prod-lib", "high"), exitCode: 1 } });
      const report = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowOsv: false, transport: npm.transport });
      assert(report.status === SCA_OK, `有真实漏洞时扫描源应给出结论,实际 ${report.status}`);
      assert(report.blocking.length > 0, "生产树 high 漏洞必须判红");
      const blocked = report.blocking.join("\n");
      assert(/生产树漏洞:prod-lib\(HIGH\)/.test(blocked), `阻断项须含包名与严重度,实际:${blocked}`);
      assert(/升级到 prod-lib@1\.0\.3/.test(blocked), `阻断项须含修复版本,实际:${blocked}`);
      assert(/Prototype Pollution in prod-lib/.test(blocked), "阻断项须含公告标题");
      assert(report.scopes.production?.vulnerabilityCount === 1, `生产树命中数应为 1,实际 ${report.scopes.production?.vulnerabilityCount}`);
    });

    await suite.case("SCA 扫描源不可用 → unavailable 而非「无漏洞」", async () => {
      const { lockPath } = sandbox("sca-unavailable");
      const npm = fakeNpm({ production: MIRROR_AUDIT_UNAVAILABLE, all: MIRROR_AUDIT_UNAVAILABLE });
      const throwingFetch = async () => {
        throw new Error("getaddrinfo ENOTFOUND api.osv.dev");
      };
      const report = await runScaScan({
        lockPath,
        registry: "https://registry.npmmirror.com",
        transport: npm.transport,
        fetchImpl: /** @type {typeof fetch} */ (/** @type {unknown} */ (throwingFetch)),
      });
      assert(report.status === STATUS_UNAVAILABLE, `两源都不可用时整体须为 unavailable,实际 ${report.status}`);
      assert(report.blocking.some((item) => /不等于「无漏洞」/.test(item)), `阻断项须明确「不等于无漏洞」,实际:${report.blocking.join(";")}`);
      assert(report.blocking.some((item) => /未判定依赖漏洞状态/.test(item)), "阻断项须说明未能判定");
      const auditSource = report.sources.find((source) => source.id === "npm-audit");
      assert(auditSource?.status === STATUS_UNAVAILABLE, "npm audit 源须标 unavailable");
      assert(/NOT_IMPLEMENTED/.test(auditSource?.reason ?? ""), `不可用原因须含端点诊断,实际:${auditSource?.reason}`);
      assert(report.sources.every((source) => source.status === STATUS_UNAVAILABLE), "OSV 源也不可达时同样须 unavailable");
      const log = formatScaLog(report).join("\n");
      assert(!/未发现漏洞/.test(log), `不可用时不得输出「未发现漏洞」,实际日志:${log}`);
      assert(/不等于「无漏洞」/.test(log), "日志须保留「不等于无漏洞」的措辞");
      // 判别依据是响应形状而非退出码:404 与「发现漏洞」的退出码同为 1
      const parsed = parseAuditPayload({
        tree: "production",
        registry: "https://registry.npmmirror.com",
        result: { ok: false, exitCode: 1, signal: null, stdout: MIRROR_AUDIT_UNAVAILABLE.stdout, stderr: MIRROR_AUDIT_UNAVAILABLE.stderr, timedOut: false, timeoutMs: 0, spawnError: null },
      });
      assert(parsed.status === STATUS_UNAVAILABLE && parsed.payload === null, "带 statusCode 的错误 JSON 不得被当成 audit 结果");
    });

    await suite.case("SCA 生产树与含 dev 全树分别扫描且区分正确", async () => {
      const { lockPath } = sandbox("sca-trees");
      const npm = fakeNpm({
        production: { stdout: JSON.stringify({ metadata: { vulnerabilities: {} }, vulnerabilities: {} }), exitCode: 0 },
        all: { stdout: auditJsonWithVuln("dev-tool", "critical"), exitCode: 1 },
      });
      const report = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowOsv: false, transport: npm.transport });
      assert(npm.calls.length === 2, `应跑两次 audit(两棵树),实际 ${npm.calls.length} 次`);
      const prodCall = npm.calls.find((call) => call.line.includes("--omit=dev"));
      const allCall = npm.calls.find((call) => !call.line.includes("--omit=dev"));
      assert(prodCall !== undefined, `生产树那次必须带 --omit=dev,实际 ${JSON.stringify(npm.calls.map((c) => c.line))}`);
      assert(allCall !== undefined, "全树那次不得带 --omit=dev");
      for (const call of npm.calls) {
        assert(/--registry=https:\/\/registry\.npmmirror\.com/.test(call.line), `audit 必须走项目 .npmrc 镜像端点,实际 ${call.line}`);
        assert(call.line.includes("--json"), "audit 必须取 JSON 输出");
        assert(call.line.includes("audit"), "调用的是 npm audit");
      }
      assert(report.scopes.production?.vulnerabilityCount === 0, "仅 dev 依赖有洞时生产树应为 0");
      assert(report.scopes.all?.vulnerabilityCount === 1, `含 dev 全树应命中 1 条,实际 ${report.scopes.all?.vulnerabilityCount}`);
      assert(report.blocking.length === 0, `仅开发依赖的 critical 不应阻断发布(不进发布包),实际阻断:${report.blocking.join(";")}`);
      assert(report.notes.some((note) => /仅开发依赖命中/.test(note)), "仅开发依赖命中须留痕");
      // OSV 投影:dev 组件只进全树,生产组件两棵树都进
      const osv = fakeOsv({ "prod-lib": [GHSA_VULN], "dev-tool": [{ ...GHSA_VULN, id: "GHSA-dev-0000-0000" }] });
      const projected = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowNpmAudit: false, fetchImpl: osv });
      assert(projected.scopes.production?.vulnerabilityCount === 1, `OSV 投影:生产树应命中 prod-lib,实际 ${projected.scopes.production?.vulnerabilityCount}`);
      assert(projected.scopes.all?.vulnerabilityCount === 2, `OSV 投影:全树应命中 2 条,实际 ${projected.scopes.all?.vulnerabilityCount}`);
      assert(projected.blocking.some((item) => /生产树漏洞:prod-lib\(HIGH\) 升级到 1\.0\.3/.test(item)), `OSV 修复版本须从公告 ranges 解析,实际:${projected.blocking.join(";")}`);
    });

    // 回归:误判「纯构建期工具是发布风险」。实测本仓 CI 上 xmldom/fast-uri/js-yaml/
    // sharp 全是 dev-only,却因 supply-chain job 不装依赖、`npm audit --omit=dev`
    // 的 dev 剪枝失效,被泄漏进生产树 pass 判红。权威判据必须是 lockfile 的
    // dev 标记,不是「这条来自哪一次 pass」。
    await suite.case("SCA dev-only 包泄漏进生产树 pass → 不误判为发布风险,且口径分歧留痕", async () => {
      const { lockPath } = sandbox("sca-dev-leak");
      // 生产树那次也报出 dev-only 的 dev-tool(剪枝失效的真实形态)
      const npm = fakeNpm({
        production: { stdout: auditJsonWithVuln("dev-tool", "high"), exitCode: 1 },
        all: { stdout: auditJsonWithVuln("dev-tool", "high"), exitCode: 1 },
      });
      const report = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowOsv: false, transport: npm.transport });
      assert(
        report.blocking.length === 0,
        `dev-only 包即使出现在生产树 pass 也不得判红(不进发布包),实际阻断:${report.blocking.join(";")}`,
      );
      assert(
        report.notes.some((note) => /分树口径与 lockfile dev 标记不一致.*dev-tool.*由 production pass 命中/.test(note)),
        `pass 口径与 lockfile 不一致必须留痕(不得静默按任一边放行),实际 notes:${report.notes.join(";")}`,
      );
      // 反向:真生产依赖仍在生产树 pass 命中时必须照旧判红
      const strict = fakeNpm({
        production: { stdout: auditJsonWithVuln("prod-lib", "high"), exitCode: 1 },
        all: { stdout: auditJsonWithVuln("prod-lib", "high"), exitCode: 1 },
      });
      const strictReport = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowOsv: false, transport: strict.transport });
      assert(
        strictReport.blocking.some((item) => /生产树漏洞:prod-lib\(HIGH\)/.test(item)),
        `真生产依赖命中仍须判红,实际:${strictReport.blocking.join(";")}`,
      );
      assert(
        !strictReport.notes.some((note) => /分树口径与 lockfile dev 标记不一致/.test(note)),
        "真生产依赖口径一致时不应误报分歧",
      );
    });

    await suite.case("SBOM 离线确定性:同输入两次逐字节一致且键序稳定", async () => {
      const { lockPath } = sandbox("sbom-determinism");
      const first = generateSbom(lockPath, "package-lock.json");
      const second = generateSbom(lockPath, "package-lock.json");
      assert(JSON.stringify(first.document) === JSON.stringify(second.document), "同一 lockfile 两次生成必须完全一致");
      const text = JSON.stringify(first.document, null, 2);
      // 键序:顶层 bomFormat → specVersion → serialNumber → version → metadata → components → dependencies
      const order = ["\"bomFormat\"", "\"specVersion\"", "\"serialNumber\"", "\"version\"", "\"metadata\"", "\"components\"", "\"dependencies\""].map((key) => text.indexOf(key));
      assert(order.every((index) => index > 0), "顶层各键都应存在");
      assert(order.every((index, i) => i === 0 || index > (order[i - 1] ?? -1)), `顶层键序应固定,实际位置 ${order.join(",")}`);
      const component = first.document.components[0];
      const compText = JSON.stringify(component);
      const compOrder = ["\"bom-ref\"", "\"type\"", "\"name\"", "\"version\"", "\"scope\"", "\"licenses\"", "\"purl\"", "\"properties\""].map((key) => compText.indexOf(key));
      assert(compOrder.every((index, i) => i === 0 || index > (compOrder[i - 1] ?? -1)), `组件键序应固定,实际 ${compOrder.join(",")}`);
      // 无时间戳:SBOM 里任何时间字段都会让 --check 变成随机噪声
      assert(!/"(timestamp|created|modified|datePublished)"/.test(text), "SBOM 不应含时间戳字段");
      assert(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text), "SBOM 不应含 ISO 时间字符串");
      assert(first.document.serialNumber.startsWith("urn:uuid:"), "serialNumber 应为 urn:uuid 形式");
      assert(first.document.serialNumber === second.document.serialNumber, "serialNumber 必须由 lockfile 派生且稳定");
      // 换 lockfile 内容 → serialNumber 必变(否则漂移检测形同虚设)
      const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-supply-alt-"));
      try {
        const otherLock = makeLockfile(otherDir);
        const altered = JSON.parse(fs.readFileSync(otherLock, "utf8"));
        altered.packages["node_modules/prod-lib"].version = "1.0.9";
        fs.writeFileSync(otherLock, JSON.stringify(altered, null, 2), "utf8");
        const other = generateSbom(otherLock, "package-lock.json");
        assert(other.document.serialNumber !== first.document.serialNumber, "lockfile 变更后 serialNumber 必须变化");
      } finally {
        fs.rmSync(otherDir, { recursive: true, force: true });
      }
      // 缺声明许可证的包在 SBOM 里必须显式 NOASSERTION,不得静默省略 licenses
      const noLicense = first.document.components.find((item) => item.name === "no-license");
      assert(noLicense !== undefined, "SBOM 应含 no-license 组件");
      assert(JSON.stringify(noLicense.licenses) === JSON.stringify([{ license: { name: "NOASSERTION" } }]), `缺许可证应记 NOASSERTION,实际 ${JSON.stringify(noLicense.licenses)}`);
      assert(toCycloneDxLicenses("MIT").licenses[0]?.license.id === "MIT", "裸标识符应走 license.id");
      assert(toCycloneDxLicenses("(MIT OR Zlib)").licenses[0]?.license.expression === "(MIT OR Zlib)", "复合表达式应走 license.expression");
      assert(first.document.metadata.properties.some((property) => property.name === "m2w:sbom:determinism"), "SBOM 应记录确定性口径");
    });

    await suite.case("SBOM --check 检出漂移(新增组件/许可证变化)", async () => {
      const { lockPath } = sandbox("sbom-drift");
      const baseline = generateSbom(lockPath, "package-lock.json");
      assert(diffSbom(JSON.parse(JSON.stringify(baseline.document)), baseline.document).length === 0, "同文档比对应无漂移");
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      lock.packages["node_modules/new-dep"] = { version: "3.0.0", license: "MIT" };
      lock.packages[""].dependencies["new-dep"] = "^3.0.0";
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");
      const after = generateSbom(lockPath, "package-lock.json");
      const drift = diffSbom(baseline.document, after.document);
      assert(drift.some((item) => /新增组件未记入 SBOM:pkg:npm\/new-dep@3\.0\.0/.test(item)), `应报出新增组件,实际:${drift.join(";")}`);
      assert(drift.some((item) => /serialNumber 不一致/.test(item)), "lockfile 变更后应报 serialNumber 不一致");
      assert(drift.some((item) => /新增组件已不在|SBOM 中的组件已不在 lockfile/.test(item) === false), "只增不删时不应误报移除");
      // 反向:把 SBOM 里的许可证改掉,须被检出
      const tampered = JSON.parse(JSON.stringify(baseline.document));
      const target = tampered.components.find((/** @type {any} */ item) => item.name === "prod-lib");
      assert(target !== undefined, "夹具应含 prod-lib 组件");
      target.licenses = [{ license: { id: "WTFPL" } }];
      assert(diffSbom(tampered, baseline.document).some((item) => /组件许可证变化未同步 SBOM:pkg:npm\/prod-lib/.test(item)), "许可证被改写须被检出");
    });

    await suite.case("许可证:未知/缺失判红,copyleft 与多分支单列待复核", async () => {
      const { lockPath } = sandbox("licenses");
      const { report, notice } = generateLicenses(lockPath, "package-lock.json");
      assert(report.status === "policy-violation", `存在未知许可证时状态应为 policy-violation,实际 ${report.status}`);
      assert(report.unknownLicense.length === 1 && report.unknownLicense[0]?.name === "no-license", `未知许可证应单列,实际 ${JSON.stringify(report.unknownLicense)}`);
      assert(report.unknownLicense[0]?.isProductionDependency === true, "沙盒里 no-license 是生产依赖,应如此标注");
      assert(report.counts.total === 6, `组件总数应为 6,实际 ${report.counts.total}`);
      assert(report.counts.production === 5, `生产依赖应为 5,实际 ${report.counts.production}`);
      assert(group(report.groups, "strongCopyleft").includes("dev-tool@2.0.0"), `GPL 应归 strongCopyleft,实际 ${JSON.stringify(report.groups)}`);
      assert(group(report.groups, "weakCopyleft").includes("inner-lib@1.0.1"), `嵌套的 LGPL 应归 weakCopyleft,实际 ${JSON.stringify(report.groups)}`);
      assert(group(report.groups, "permissive").includes("prod-lib@1.0.2"), "MIT 应归 permissive");
      assert(report.needsReview.some((item) => /dev-tool@2\.0\.0 \(GPL-3\.0-or-later/.test(item)), "GPL 应进人工复核清单");
      assert(report.needsReview.some((item) => /inner-lib@1\.0\.1 \(LGPL-3\.0-or-later/.test(item)), "LGPL 应进人工复核清单");
      const prodEntry = report.packages.find((item) => item.name === "no-license");
      assert(prodEntry !== undefined && prodEntry.license === null && prodEntry.isProductionDependency === true, "licenses.json 须逐条给出 name/version/license/是否生产依赖");
      // NOTICE.md:按许可证类型分组 + copyleft 单列 + 未知单列
      assert(/## 需人工复核的许可证\(2\)/.test(notice), `NOTICE 应单列人工复核节,实际节标题:${notice.split("\n").filter((line) => line.startsWith("## ")).join(" / ")}`);
      assert(/## 未知\/缺失许可证\(阻断项\)\(1\)/.test(notice), "NOTICE 应有未知许可证分段");
      assert(/\*\*no-license@0\.1\.0\*\* — 许可证:未声明\(NOASSERTION\);生产依赖/.test(notice), "NOTICE 应逐条列出组件与范围");
      assert(/\*\*dev-tool@2\.0\.0\*\* — 许可证:GPL-3\.0-or-later;仅开发依赖/.test(notice), "NOTICE 应标注 copyleft 组件的范围");
      assert(/请勿手工编辑/.test(notice), "NOTICE 应声明是生成物");
    });

    await suite.case("许可证两级回落:字段优先,缺失时取随包许可证文件并记证据;认不出仍判红", async () => {
      const dir = path.join(tmp, "license-fallback");
      fs.mkdirSync(dir, { recursive: true });
      const lockPath = makeFallbackLockfile(dir, [
        { name: "field-lib", version: "1.0.0", license: "MIT" },
        { name: "quiet-lib", version: "2.0.0" },
        { name: "apache-lib", version: "3.0.0" },
        { name: "copyleft-lib", version: "4.0.0" },
        { name: "silent-lib", version: "5.0.0" },
        { name: "mystery-lib", version: "6.0.0" },
        { name: "absent-lib", version: "7.0.0" },
      ]);
      // 有字段的包也给一个内容冲突的 license 文件:字段优先,回落不得越权改写元数据
      makePackageDir(dir, "field-lib", { license: LICENSE_TEXT_APACHE });
      makePackageDir(dir, "quiet-lib", { license: LICENSE_TEXT_MIT });
      makePackageDir(dir, "apache-lib", { "LICENSE.txt": LICENSE_TEXT_APACHE });
      makePackageDir(dir, "copyleft-lib", { licence: LICENSE_TEXT_GPL3, "notes.md": "not a license" });
      makePackageDir(dir, "silent-lib", { readme: "no license here" });
      makePackageDir(dir, "mystery-lib", { LICENSE: "Copyright 2026 Someone. All rights reserved.\n" });

      const { report, notice } = generateLicenses(lockPath, "package-lock.json");
      const unknownNames = report.unknownLicense.map((item) => item.name).sort();

      // ① 有字段 → 用字段,来源 lockfile(即便包目录里有内容冲突的许可证文件)
      const fieldEntry = licenseEntryOf(report, "field-lib");
      assert(fieldEntry.license === "MIT" && fieldEntry.licenseSource === "lockfile", `有字段时应取字段,实际 ${JSON.stringify(fieldEntry)}`);
      assert(fieldEntry.licenseEvidence === undefined, "lockfile 来源不应带证据文件名");

      // ② 无字段 + 小写 license 文件含 MIT 正文 → MIT / package-file / 证据名 license
      const quiet = licenseEntryOf(report, "quiet-lib");
      assert(quiet.license === "MIT", `小写 license 文件应识别为 MIT,实际 ${JSON.stringify(quiet)}`);
      assert(quiet.licenseSource === "package-file", `来源应为 package-file,实际 ${quiet.licenseSource}`);
      assert(quiet.licenseEvidence === "license", `证据文件名应为 license(小写),实际 ${quiet.licenseEvidence}`);
      assert(quiet.licenseGroup === "permissive" && quiet.needsReview === false, "回落到 MIT 后分类语义应与字段来源一致");
      assert(/\*\*quiet-lib@2\.0\.0\*\* — 许可证:MIT;生产依赖,直接依赖,许可证取自包内文件 license/.test(notice), `NOTICE 须标注证据文件名,实际:${notice.split("\n").filter((line) => line.includes("quiet-lib")).join(" / ")}`);

      // ③ 无字段 + LICENSE.txt 含 Apache-2.0 正文
      const apache = licenseEntryOf(report, "apache-lib");
      assert(apache.license === "Apache-2.0" && apache.licenseSource === "package-file" && apache.licenseEvidence === "LICENSE.txt", `LICENSE.txt 应识别为 Apache-2.0,实际 ${JSON.stringify(apache)}`);

      // ⑥ 无字段 + licence 文件含 GPL-3.0 正文 → copyleft 分类与 needsReview 语义不变
      const copyleft = licenseEntryOf(report, "copyleft-lib");
      assert(copyleft.license === "GPL-3.0" && copyleft.licenseSource === "package-file", `GPL 正文应识别为 GPL-3.0,实际 ${JSON.stringify(copyleft)}`);
      assert(copyleft.licenseGroup === "strongCopyleft" && copyleft.needsReview === true, "回落到 GPL 后仍须 strongCopyleft 且需人工复核");
      assert(group(report.groups, "strongCopyleft").includes("copyleft-lib@4.0.0"), "回落的 GPL 组件须进 strongCopyleft 分组");
      assert(report.needsReview.some((item) => /copyleft-lib@4\.0\.0 \(GPL-3\.0,/.test(item)), "回落的 GPL 组件须进人工复核清单");

      // ④ 无字段无文件 / ⑤ 有文件但认不出 / 未安装 → 判红,三种原因码必须分得开
      assert(report.status === "policy-violation", `认不出的组件仍须判红,实际 ${report.status}`);
      assert(unknownNames.join() === "absent-lib,mystery-lib,silent-lib", `未知项应恰为无文件/认不出/未安装三个,实际 ${unknownNames.join()}`);
      const reasonOf = (/** @type {string} */ name) => report.unknownLicense.find((item) => item.name === name);
      assert(reasonOf("silent-lib")?.reasonCode === "no-license-file", `无文件的原因码应为 no-license-file,实际 ${reasonOf("silent-lib")?.reasonCode}`);
      assert(/没有许可证文件/.test(reasonOf("silent-lib")?.reason ?? ""), "无文件诊断须说明目录内没有许可证文件");
      assert(reasonOf("mystery-lib")?.reasonCode === "unrecognized", `认不出的原因码应为 unrecognized,实际 ${reasonOf("mystery-lib")?.reasonCode}`);
      assert(/无法匹配任何已知许可证标记/.test(reasonOf("mystery-lib")?.reason ?? ""), "认不出诊断须写明无法匹配标记");
      assert(reasonOf("mystery-lib")?.licenseFiles.join() === "LICENSE", "认不出诊断须带上找到的文件名,便于人工去翻");
      assert(reasonOf("absent-lib")?.reasonCode === "no-package-dir", `未安装的原因码应为 no-package-dir,实际 ${reasonOf("absent-lib")?.reasonCode}`);
      assert(/包目录不存在/.test(reasonOf("absent-lib")?.reason ?? ""), "未安装诊断须说明包目录不存在");
      // 「有文件但认不出」绝不因存在许可证文件而被放行,也不得被猜成某个许可证
      const mystery = licenseEntryOf(report, "mystery-lib");
      assert(mystery.license === null && mystery.licenseSource === "none", `认不出必须是 unknown/none,实际 ${JSON.stringify(mystery)}`);
      assert(/\*\*mystery-lib@6\.0\.0\*\* — 许可证:未声明\(NOASSERTION\);生产依赖,直接依赖/.test(notice), "认不出的组件在 NOTICE 里仍应记未声明");
      assert(report.counts.fromPackageFile === 3, `取自包内文件的组件应为 3 个,实际 ${report.counts.fromPackageFile}`);

      // 进程级 CLI:同一沙盒下 unknown 段判红,文案点名包名与原因
      const cli = runCli(["scripts/supply/gen-licenses.mjs", "--lock", lockPath, "--output-dir", path.join(dir, "out")]);
      assert(cli.status === 1, `认不出的组件存在时 CLI 须 exit 1,实际 ${cli.status}`);
      assert(/许可证缺失:mystery-lib@6\.0\.0\(生产依赖\)/.test(cli.output), `CLI 须点名认不出的包,实际:${cli.output}`);
      assert(/不做猜测/.test(cli.output) && /无法匹配任何已知许可证标记/.test(cli.output), "CLI 须保留「不猜测」口径的诊断");
    });

    await suite.case("仓库决策清单:结构与可校验性(实跑读取,非沙盒)", async () => {
      const repoDecisions = loadLicenseDecisions(path.join(ROOT, "scripts", "supply", "license-decisions.json"));
      assert(repoDecisions.entries.length > 0, "仓库内必须有已拍板的多选一决策");
      for (const decision of repoDecisions.entries) {
        // createDecisionIndex 已校验字段完整性与「选定分支在上游声明里」;这里再钉住
        // 「决策必须带理由/日期/决策人」的可审计底线:缺一项就查不出是谁、为何这么定
        const auditFields = [decision.rationale, decision.decidedOn, decision.decidedBy];
        for (const value of auditFields) {
          assert(value.trim().length > 0, `决策 ${decision.name} 的理由/日期/决策人不得为空(决策必须可审计)`);
        }
        assert(/^\d{4}-\d{2}-\d{2}$/.test(decision.decidedOn), `决策 ${decision.name} 的日期格式应为 YYYY-MM-DD,实际 ${decision.decidedOn}`);
        assert(resolveObligationSummary(decision.selectedBranch) !== null, `决策 ${decision.name} 选定的 ${decision.selectedBranch} 必须在义务摘要表里登记`);
      }
    });

    await suite.case("多选一分支选定:有决策 → 输出选定分支且 needsReview 下降;无决策 → 仍并列待复核", async () => {
      const dir = path.join(tmp, "license-decision");
      fs.mkdirSync(dir, { recursive: true });
      const lockPath = makeDecisionLockfile(dir);

      // ① 生产多选一包有决策 → 记选定分支,上游原始声明不被改写,needsReview 下降
      const decided = generateLicenses(lockPath, "package-lock.json", { decisions: makeDecisions(SANDBOX_DECISIONS) });
      const dom = licenseEntryOf(decided.report, "dom-pick");
      assert(dom.version === "1.4.2" && dom.isProductionDependency === true, "夹具里 dom-pick@1.4.2 应是生产依赖");
      assert(dom.effectiveLicense === "Apache-2.0", `有决策时应输出选定分支,实际 ${JSON.stringify(dom)}`);
      assert(dom.license === "(MPL-2.0 OR Apache-2.0)", "上游原始声明必须原样保留,不得被决策改写");
      assert(dom.licenseGroup === "permissive" && dom.needsReview === false, "选定宽松分支后不再需要人工复核");
      assert(dom.licenseDecision?.status === DECISION_STATUS.applied && dom.licenseDecision.decidedOn === "2026-09-26", "条目上须留决策痕迹(状态/日期)");
      const zip = licenseEntryOf(decided.report, "zip-pick");
      assert(zip.effectiveLicense === "MIT" && zip.needsReview === false, `zip-pick 应选定 MIT,实际 ${JSON.stringify(zip)}`);
      assert(group(decided.report.groups, "permissive").join().includes("dom-pick@1.4.2"), "已决策的包应归入宽松许可分组");
      assert(!group(decided.report.groups, "dualChoice").includes("dom-pick@1.4.2"), "已决策的包不得留在多选一分组里并列两个分支");
      assert(decided.report.counts.decided === 2, `生效决策应为 2 条,实际 ${decided.report.counts.decided}`);
      assert(decided.report.counts.needsReviewProduction === 0, `生产依赖待复核应降到 0,实际 ${decided.report.counts.needsReviewProduction}`);
      assert(decided.report.counts.needsReview === 1 && decided.report.needsReview[0]?.startsWith("dom-pick@9.9.9") === true, `仅 dev 树的同名包应留在待复核清单,实际 ${JSON.stringify(decided.report.needsReview)}`);
      assert(decided.report.licenseDecisions.source === "(sandbox/license-decisions.json)", "报告须记录决策清单来源,便于反查");

      // ② 清单里没有该包 → 回到未决策态:并列双分支 + needsReview,绝不默认选一个
      const undecided = generateLicenses(lockPath, "package-lock.json", { decisions: makeDecisions([]) });
      const undecidedDom = licenseEntryOf(undecided.report, "dom-pick");
      assert(undecidedDom.effectiveLicense === undefined, "无决策时不得凭空出现选定分支");
      assert(undecidedDom.licenseGroup === "dualChoice" && undecidedDom.needsReview === true, "无决策时应保持 dualChoice 并需人工复核");
      assert(undecidedDom.licenseDecision === undefined, "清单里没有该包时不应挂决策记录");
      assert(undecided.report.counts.decided === 0 && undecided.report.needsReview.length === 3, `无决策时三项多选一都该待复核,实际 ${undecided.report.needsReview.length}`);
      assert(group(undecided.report.groups, "dualChoice").length === 3, "三个多选一包应都在 dualChoice 分组里");
      assert(undecided.report.licenseDecisions.applied.length === 0 && undecided.report.licenseDecisions.sha256 === "sandbox-digest", "决策汇总须如实留痕(零生效)");
      assert(/\*\*dom-pick@1\.4\.2\*\* — 许可证:\(MPL-2\.0 OR Apache-2\.0\);生产依赖/.test(undecided.notice), "未决策时 NOTICE 应原样并列上游两个分支");
    });

    await suite.case("多选一分支选定:只作用于生产依赖,dev-only 同名包不受影响", async () => {
      const dir = path.join(tmp, "license-decision-scope");
      fs.mkdirSync(dir, { recursive: true });
      const lockPath = makeDecisionLockfile(dir);
      const { report } = generateLicenses(lockPath, "package-lock.json", { decisions: makeDecisions(SANDBOX_DECISIONS) });

      const devEntry = report.packages.find((item) => item.name === "dom-pick" && item.version === "9.9.9");
      assert(devEntry !== undefined && devEntry.isProductionDependency === false, "夹具里 dom-pick@9.9.9 应只在开发树");
      assert(devEntry.effectiveLicense === undefined, "决策不得作用于仅开发依赖");
      assert(devEntry.license === "(MPL-2.0 OR Apache-2.0)" && devEntry.licenseGroup === "dualChoice", "dev-only 的多选一包应保持并列双分支");
      assert(devEntry.needsReview === true, "dev-only 未拍板仍应标记待复核(不随包分发,但不得被决策悄悄洗白)");
      assert(devEntry.licenseDecision?.status === DECISION_STATUS.scopeExcluded, `dev-only 的决策状态应为 scope-excluded,实际 ${devEntry.licenseDecision?.status}`);
      const notApplied = report.licenseDecisions.notApplied.find((item) => item.version === "9.9.9");
      assert(notApplied?.status === DECISION_STATUS.scopeExcluded && notApplied.isProductionDependency === false, "未生效的决策须在报告里逐条留痕");
      assert(report.counts.decided === 2 && report.counts.needsReviewProduction === 0 && report.counts.needsReviewDevelopment === 1, `计数须可解释,实际 ${JSON.stringify(report.counts)}`);
    });

    await suite.case("多选一分支选定:与上游现状不符(超范围/声明变了/包已下线)一律不生效", async () => {
      const dir = path.join(tmp, "license-decision-stale");
      fs.mkdirSync(dir, { recursive: true });
      const lockPath = makeDecisionLockfile(dir);
      const stale = makeDecisions([
        { ...SANDBOX_DECISIONS[0], versionRange: "=1.0.0" },
        // 上游声明已变(决策记录的是旧表达式):不得拿旧决定套新声明
        { ...SANDBOX_DECISIONS[1], upstreamExpression: "(MIT OR ISC)" },
        { name: "gone-pick", versionRange: "*", upstreamExpression: "(MIT OR GPL-3.0-or-later)", selectedBranch: "MIT", rationale: "陈旧记录", decidedOn: "2026-09-26", decidedBy: "用户 2026-09-26" },
      ]);
      const { report } = generateLicenses(lockPath, "package-lock.json", { decisions: stale });

      assert(report.licenseDecisions.applied.length === 0, "前提对不上的决策一条都不该生效");
      const statusOf = (/** @type {string} */ name, /** @type {string | null} */ version) =>
        report.licenseDecisions.notApplied.find((item) => item.name === name && item.version === version)?.status;
      assert(statusOf("dom-pick", "1.4.2") === DECISION_STATUS.outOfRange, `超范围应记 out-of-range,实际 ${statusOf("dom-pick", "1.4.2")}`);
      assert(statusOf("zip-pick", "2.0.0") === DECISION_STATUS.expressionMismatch, `上游声明变了应记 expression-mismatch,实际 ${statusOf("zip-pick", "2.0.0")}`);
      assert(statusOf("gone-pick", null) === DECISION_STATUS.notInTree, `包已下线应记 not-in-tree,实际 ${statusOf("gone-pick", null)}`);
      for (const entry of report.packages) {
        if (entry.licenseGroup !== "dualChoice") continue;
        assert(entry.effectiveLicense === undefined, `${entry.name}@${entry.version} 决策未生效时不得出现选定分支`);
        assert(entry.needsReview === true, `${entry.name}@${entry.version} 决策未生效时须保持待复核`);
      }
      assert(report.counts.needsReview === 3, `决策全不生效时待复核项应回到 3,实际 ${report.counts.needsReview}`);
    });

    await suite.case("NOTICE:同时保留「上游原始 A OR B」与「本项目选用 A」两行", async () => {
      const dir = path.join(tmp, "license-decision-notice");
      fs.mkdirSync(dir, { recursive: true });
      const lockPath = makeDecisionLockfile(dir);
      const { report, notice } = generateLicenses(lockPath, "package-lock.json", { decisions: makeDecisions(SANDBOX_DECISIONS) });

      // 分组条目:显示选定分支 + 该分支义务摘要,且同一条里保留上游原始声明
      const entryLine = notice.split("\n").find((line) => line.includes("**zip-pick@2.0.0**") && line.includes("许可证:"));
      assert(entryLine !== undefined, "NOTICE 应列出已决策组件");
      assert(/许可证:本项目选用 MIT/.test(entryLine), `分组条目应显示选定分支,实际:${entryLine}`);
      assert(/义务:保留版权与许可声明并随分发附上许可全文/.test(entryLine), `分组条目应给出该分支的义务摘要,实际:${entryLine}`);
      assert(/上游原始声明为 \(MIT OR GPL-3\.0-or-later\),本项目按决策选用 MIT/.test(entryLine), `分组条目须保留上游原始声明,实际:${entryLine}`);
      assert(!/许可证:\(MIT OR GPL-3\.0-or-later\)/.test(entryLine), "已决策项不得再并列两个分支当许可证");

      // 决策小节:逐条给出上游声明、选定分支、义务、日期与决策人
      assert(/## 多选一许可的分支选定\(2\)/.test(notice), `NOTICE 应单列分支选定节,实际节标题:${notice.split("\n").filter((line) => line.startsWith("## ")).join(" / ")}`);
      // 只在该节内取行:分组条目也含「上游原始声明为 …」,不加范围会拿错行(假通过)
      const section = notice.split("## 多选一许可的分支选定")[1]?.split("\n## ")[0] ?? "";
      const decisionLine = section.split("\n").find((line) => line.includes("**dom-pick@1.4.2**"));
      assert(decisionLine !== undefined, `决策小节应逐条列出组件,实际小节:${section}`);
      assert(/上游原始声明为 \(MPL-2\.0 OR Apache-2\.0\),本项目选用 Apache-2\.0/.test(decisionLine), `决策小节须同时给出上游声明与选定分支,实际:${decisionLine}`);
      assert(/决策 2026-09-26\(用户 2026-09-26\)/.test(decisionLine), "决策小节须留决策日期与决策人");
      assert(/理由:多选一取非 copyleft 分支/.test(decisionLine), "决策小节须留选定理由");
      assert(notice.includes(`\`${report.licenseDecisions.source}\``), "NOTICE 头注须指明决策清单位置");
    });

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
      const cli = runCli(["scripts/supply/collect-license-fulltext.mjs", "--lock", lockPath, "--output-dir", outCli, "--decisions", "scripts/supply/license-decisions.json"]);
      assert(cli.status === 0, `收集完成时应 exit 0(缺项已报出),实际 ${cli.status}:${cli.output}`);
      assert(/\[fulltext:missing\] silent-lib@3\.0\.0/.test(cli.output), `CLI 须报出缺项,实际:${cli.output}`);
      assert(fs.existsSync(path.join(outCli, "licenses-fulltext.json")), "CLI 应产出清单文件");
      const strict = runCli(["scripts/supply/collect-license-fulltext.mjs", "--lock", lockPath, "--output-dir", outCli, "--strict"]);
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

    await suite.case("标记表收紧:GPLv3 提及 AGPL 不得判成 AGPL-3.0;BSD 免责声明不得漏算", async () => {
      // ① AGPL 收紧的核心回归:jszip 式「MIT + GPLv3 合订本」绝不能被标成 AGPL-3.0。
      // 断言命中**具体标识**而非只判「不是 AGPL」—— 因为该文件同时含 MIT 与 GPLv3,
      // 正确结果应是 GPL-3.0(GPLv3 全文在文中有版本行标题),而不是任意一个别的值。
      const dual = detectLicenseFromText(LICENSE_TEXT_DUAL_MIT_GPL);
      // 先断言「不是 AGPL」再断言具体标识:TS 会在前一条断言后把类型收窄成字面量,
      // 顺序反过来会让后一条断言失去类型意义
      assert(dual.license !== "AGPL-3.0", `GPLv3 第 13 节提及 AGPL 不得把文件判成 AGPL-3.0,实际 ${JSON.stringify(dual)}`);
      assert(dual.license === "GPL-3.0", `双许可合订本应判 GPL-3.0(GPLv3 全文有版本行),实际 ${JSON.stringify(dual)}`);

      // ② 单段 GPLv3 第 13 节:含 AGPL 字样但不是 AGPL 文件,更不能判 AGPL
      const section13 = detectLicenseFromText(LICENSE_TEXT_GPL3_SECTION13);
      assert(section13.license === "GPL-3.0", `GPLv3 正文应判 GPL-3.0,实际 ${JSON.stringify(section13)}`);

      // ③ 真 AGPL-3.0 全文仍须认得出(收紧不得把真阳性也打死)
      assert(detectLicenseFromText(LICENSE_TEXT_AGPL3).license === "AGPL-3.0", "真 AGPL-3.0 全文必须仍能识别");

      // ④ 全表自查:GNU 系标记(AGPL/LGPL/GPL)必须逐条要求版本行。
      // 这是结构性守护 —— AGPL 曾只认标题字样,被 GPLv3 第 13 节的一句交叉引用误命中,
      // 断言把「不得再有松散的 GNU 系标记」固化成可执行契约,防其复发。
      const looseGnu = LICENSE_TEXT_MARKERS.filter((marker) => isGnuFamilyRequiringVersion(marker.re) && !/\\s\+Version\s/.test(marker.re.source));
      assert(looseGnu.length === 0, `GNU 系标记必须要求版本行,实际松散:${looseGnu.map((m) => m.spdx).join(",")}`);
      // 且 GNU 系五类都必须在表内(防有人删掉某个标记来「绕过」上面的断言)
      const gnuSpdx = LICENSE_TEXT_MARKERS.map((m) => m.spdx).filter((spdx) => /^(?:A?GPL|LGPL)/.test(spdx)).sort();
      assert(gnuSpdx.join() === "AGPL-3.0,GPL-2.0,GPL-3.0,LGPL-2.1,LGPL-3.0", `GNU 系标记应齐备,实际:${gnuSpdx.join()}`);

      // ⑤ BSD:带免责声明条款的三条款不得被当成二条款(把 3-Clause 认成 2-Clause 会
      // 少算一个免责声明义务,属义务低报,比认不出更危险)
      const namedBsd = detectLicenseFromText(LICENSE_TEXT_BSD3_NAMED);
      assert(namedBsd.license !== "BSD-2-Clause", `有免责声明条款的文件不得判成 BSD-2-Clause,实际 ${JSON.stringify(namedBsd)}`);
      // 模板措辞的三条款仍须精确认出
      assert(detectLicenseFromText(LICENSE_TEXT_BSD3).license === "BSD-3-Clause", "模板措辞的 BSD-3 仍须识别为 BSD-3-Clause");
      // 真正的二条款仍须是二条款(收紧不得误伤)
      assert(detectLicenseFromText(LICENSE_TEXT_BSD2).license === "BSD-2-Clause", "BSD-2 仍须识别为 BSD-2-Clause");
    });

    await suite.case("多许可证文件形态识别:拼接 → multi-license 并列全部;交叉引用/模板不得误判", async () => {
      // ① d3-geo 型:ISC 段 + 内嵌 GeographicLib 的 MIT 段(上游合法拼接两套正文)。
      // 这是「假警报」的根源:只报首个命中项会产出「识别 MIT / 声明 ISC」,让复核者
      // 误判为许可不一致,而实际是两段都在。
      const d3geo = detectLicensesInText(LICENSE_TEXT_D3GEO_STYLE);
      assert(d3geo.status === LICENSE_SHAPE.multi, `拼接文件应记 multi-license,实际 ${JSON.stringify(d3geo)}`);
      assert(d3geo.licenses.includes("ISC") && d3geo.licenses.includes("MIT"), `应列出两套标识,实际 ${JSON.stringify(d3geo.licenses)}`);
      assert(d3geo.licenses.length === 2, `恰好两套,实际 ${JSON.stringify(d3geo.licenses)}`);
      assert(d3geo.declared === null, "未提供声明时不得凭空造出 declared");

      // ② d3-scale-chromatic 型:ISC 段 + ColorBrewer 的 Apache-2.0 段
      const chromatic = detectLicensesInText(LICENSE_TEXT_D3SCALE_STYLE);
      assert(chromatic.status === LICENSE_SHAPE.multi, `应记 multi-license,实际 ${JSON.stringify(chromatic)}`);
      assert(chromatic.licenses.includes("ISC") && chromatic.licenses.includes("Apache-2.0"), `应列出 ISC 与 Apache-2.0,实际 ${JSON.stringify(chromatic.licenses)}`);

      // ③ marked 型:MIT 段 + 一段 BSD-3 派生的 CLA(带免责声明条款)
      const markedStyle = detectLicensesInText(LICENSE_TEXT_MARKED_STYLE);
      assert(markedStyle.status === LICENSE_SHAPE.multi, `应记 multi-license,实际 ${JSON.stringify(markedStyle)}`);
      assert(markedStyle.licenses.includes("MIT") && markedStyle.licenses.includes("BSD-3-Clause"), `应列出 MIT 与 BSD-3-Clause,实际 ${JSON.stringify(markedStyle.licenses)}`);

      // ④ 红线:单个真实许可证文件绝不可被误判为 multi-license。
      // GPL-3.0 全文正文提及 AGPL/LGPL(交叉引用)不是多许可证;Apache-2.0 附录里的
      // 许可模板也不是。这两条若被误判,报告会把正常的单许可文件全标成待人工判断。
      /** @type {Array<[string, string]>} */
      const singleLicenseSamples = [
        ["GPL-3.0 全文", LICENSE_TEXT_GPL3_FULL],
        ["LGPL-3.0 全文", LICENSE_TEXT_LGPL3],
        ["Apache-2.0 全文(含附录模板)", LICENSE_TEXT_APACHE_FULL],
        ["MIT", LICENSE_TEXT_MIT],
        ["ISC 标题式", LICENSE_TEXT_ISC],
        ["BSD-3-Clause", LICENSE_TEXT_BSD3],
        ["MPL-2.0", LICENSE_TEXT_MPL2],
        ["AGPL-3.0", LICENSE_TEXT_AGPL3],
        ["Unlicense", LICENSE_TEXT_UNLICENSE],
      ];
      for (const [label, sample] of singleLicenseSamples) {
        const single = detectLicensesInText(sample);
        assert(single.status !== LICENSE_SHAPE.multi, `${label} 是单许可证文件,不得判成 multi-license,实际 ${JSON.stringify(single)}`);
      }
      // GPL-3.0 全文里确实同时出现 AGPL/LGPL 字样,却仍须是单许可(GPL-3.0)
      assert(/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(LICENSE_TEXT_GPL3_FULL), "夹具前提:GPL-3.0 全文确实提及 AGPL");
      assert(detectLicensesInText(LICENSE_TEXT_GPL3_FULL).licenses.join() === "GPL-3.0", "提及 AGPL/LGPL 不构成多许可证");
      // Apache-2.0 附录模板也不构成
      assert(detectLicensesInText(LICENSE_TEXT_APACHE_FULL).licenses.join() === "Apache-2.0", "Apache 附录模板不构成多许可证");

      // 单许可文件仍按原口径给出唯一标识(不得因为新增形态识别而退化)
      assert(detectLicensesInText(LICENSE_TEXT_MIT).licenses.join() === "MIT", "单许可文件应给出唯一标识");
      assert(detectLicensesInText(LICENSE_TEXT_MIT).status === "single", "单许可文件状态应为 single");
      // 与 multi-license 严格区分:三态必须互不相同(混用会把「多套待判断」与
      // 「一套认不出」混为一谈,复核者就无法分辨该做什么)
      const shapes = [LICENSE_SHAPE.single, LICENSE_SHAPE.multi, LICENSE_SHAPE.unrecognized];
      assert(new Set(shapes).size === 3, `三态必须互不相同,实际:${shapes.join(",")}`);

      // ⑤ 声明不在检测集内时必须能被看出来,不得静默放过
      const noMatch = detectLicensesInText(LICENSE_TEXT_D3GEO_STYLE, { declared: "GPL-3.0-or-later" });
      assert(noMatch.declared === "GPL-3.0-or-later", "应如实带回声明值");
      assert(noMatch.declaredInDetected === false, "声明不在检测集内时该标志必须为 false");
      const match = detectLicensesInText(LICENSE_TEXT_D3GEO_STYLE, { declared: "ISC" });
      assert(match.declaredInDetected === true, "声明在检测集内时该标志必须为 true");
      // 多分支声明:任一分支在检测集内即视为已覆盖(ISC OR MIT 都出现了)
      const either = detectLicensesInText(LICENSE_TEXT_D3GEO_STYLE, { declared: "ISC OR MIT" });
      assert(either.declaredInDetected === true, "多分支声明任一命中即算覆盖");
      const neither = detectLicensesInText(LICENSE_TEXT_D3GEO_STYLE, { declared: "GPL-3.0-or-later" });
      assert(neither.declaredInDetected === false, "全部分支都不命中才算未覆盖");

      // ⑥ 认不出仍是 unrecognized,不得与 multi-license 混为一谈
      const unknown = detectLicensesInText("Copyright 2026 Someone. All rights reserved.\n");
      assert(unknown.status === LICENSE_SHAPE.unrecognized, `认不出应是 unrecognized,实际 ${unknown.status}`);
      assert(unknown.licenses.length === 0, "认不出时不得给出任何标识");
    });

    await suite.case("多选一分支选定的判定口径(纯函数):范围/表达式/义务摘要/清单校验", async () => {
      assert(versionSatisfies("3.4.13", ">=3.0.0 <4.0.0") === true, "3.4.13 应落在 >=3.0.0 <4.0.0 内");
      assert(versionSatisfies("4.0.0", ">=3.0.0 <4.0.0") === false, "4.0.0 应超出该范围");
      assert(versionSatisfies("3.4.13", "") === true && versionSatisfies("3.4.13", "*") === true, "空范围/* 表示任意版本");
      assert(versionSatisfies("", ">=3.0.0") === false, "版本号缺失时不得判为满足范围");
      let rangeError = "";
      try {
        parseVersionRange("^3.0.0");
      } catch (error) {
        rangeError = error instanceof Error ? error.message : String(error);
      }
      assert(/版本范围语法不认得/.test(rangeError), `范围语法错误须有可操作文案,实际:${rangeError}`);

      assert(expressionIncludesBranch("(MIT OR GPL-3.0-or-later)", "MIT") === true, "应认得 MIT 分支");
      assert(expressionIncludesBranch("MIT", "MIT-0.9") === false, "整词比对:MIT 不得命中 MIT-0.9");
      assert(expressionIncludesBranch("(MPL-2.0 OR Apache-2.0)", "GPL-3.0") === false, "表达式外的分支不得被认作存在");

      assert((resolveObligationSummary("Apache-2.0") ?? "").includes("NOTICE"), "Apache-2.0 义务摘要须含 NOTICE 要求");
      assert((resolveObligationSummary("MIT") ?? "").length > 0, "MIT 应有义务摘要");
      assert((resolveObligationSummary("GPL-3.0-or-later") ?? "").includes("对应源码"), "-or-later 变体应回落到基名的义务摘要");
      assert(resolveObligationSummary("Nonexistent-1.0") === null, "未登记的许可证应返回 null,由调用方显式标注而不是编造义务");

      const base = { name: "p", versionRange: "*", upstreamExpression: "(MIT OR GPL-3.0-or-later)", selectedBranch: "MIT", rationale: "r", decidedOn: "2026-09-26", decidedBy: "用户" };
      assert(createDecisionIndex([base]).byName.size === 1, "合法决策应可索引");
      /** @type {Array<{ label: string; broken: Record<string, string>; expected: RegExp }>} */
      const brokenCases = [
        { label: "缺字段", broken: { ...base, decidedBy: "" }, expected: /decidedBy 缺失或为空/ },
        { label: "选定分支不在上游声明里", broken: { ...base, selectedBranch: "Apache-2.0" }, expected: /不在 upstreamExpression/ },
        { label: "上游声明不是多选一", broken: { ...base, upstreamExpression: "MIT" }, expected: /不含 OR 分支/ },
      ];
      for (const item of brokenCases) {
        let message = "";
        try {
          createDecisionIndex([item.broken]);
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        assert(item.expected.test(message), `${item.label} 的决策数据必须显式失败,实际:${message}`);
      }
    });

    await suite.case("许可证文件识别:候选名大小写不敏感、标记覆盖、SPDX 标签与不猜测", async () => {
      const dir = path.join(tmp, "license-detect");
      fs.mkdirSync(dir, { recursive: true });
      // 候选名:小写/大写/带扩展名/COPYING 都要认,非候选名(readme/notes)不得算
      const packageDir = makePackageDir(dir, "shape-lib", {
        license: LICENSE_TEXT_MIT,
        "LICENSE.md": LICENSE_TEXT_APACHE,
        COPYING: LICENSE_TEXT_BSD3,
        NOTICE: "third-party notices",
        readme: "hello",
        "notes.txt": "Copyright 2026 Someone",
      });
      assert(listLicenseFiles(packageDir).join() === "license,LICENSE.md,COPYING,NOTICE", `候选名识别/排序应固定,实际 ${listLicenseFiles(packageDir).join()}`);
      assert(listLicenseFiles(path.join(dir, "absent-dir")).length === 0, "目录不存在时应返回空列表而非抛错");

      // 标记集合:逐个许可证都要认得,且归类语义与字段来源一致
      /** @type {Array<{ text: string; spdx: string }>} */
      const expected = [
        { text: LICENSE_TEXT_MIT, spdx: "MIT" },
        { text: LICENSE_TEXT_APACHE, spdx: "Apache-2.0" },
        { text: LICENSE_TEXT_BSD2, spdx: "BSD-2-Clause" },
        { text: LICENSE_TEXT_BSD3, spdx: "BSD-3-Clause" },
        { text: LICENSE_TEXT_ISC, spdx: "ISC" },
        { text: LICENSE_TEXT_0BSD, spdx: "0BSD" },
        { text: LICENSE_TEXT_MPL2, spdx: "MPL-2.0" },
        { text: LICENSE_TEXT_GPL3, spdx: "GPL-3.0" },
        { text: LICENSE_TEXT_LGPL3, spdx: "LGPL-3.0" },
        { text: LICENSE_TEXT_AGPL3, spdx: "AGPL-3.0" },
        { text: LICENSE_TEXT_UNLICENSE, spdx: "Unlicense" },
      ];
      for (const item of expected) {
        const detected = detectLicenseFromText(item.text);
        assert(detected.license === item.spdx, `正文应识别为 ${item.spdx},实际 ${detected.license}(${item.text.split("\n")[0]})`);
      }
      assert(classifyLicense(detectLicenseFromText(LICENSE_TEXT_GPL3).license ?? "").group === "strongCopyleft", "GPL 正文应归强 copyleft");
      assert(classifyLicense(detectLicenseFromText(LICENSE_TEXT_LGPL3).license ?? "").group === "weakCopyleft", "LGPL 正文应归弱 copyleft");
      assert(classifyLicense(detectLicenseFromText(LICENSE_TEXT_AGPL3).license ?? "").group === "strongCopyleft", "AGPL 正文应归强 copyleft");
      assert(classifyLicense(detectLicenseFromText(LICENSE_TEXT_MPL2).license ?? "").group === "weakCopyleft", "MPL 正文应归弱 copyleft");
      assert(classifyLicense(detectLicenseFromText(LICENSE_TEXT_MIT).license ?? "").needsReview === false, "MIT 正文无需人工复核");

      // SPDX 标签行:已知标识符采信;自定义标识符不采信(不得当成宽松许可放行)
      const tagged = detectLicenseFromText("// SPDX-License-Identifier: MIT\n//\n// no text\n");
      assert(tagged.license === "MIT" && tagged.match === "SPDX-License-Identifier", `SPDX 标签应被采信,实际 ${JSON.stringify(tagged)}`);
      assert(detectLicenseFromText("SPDX-License-Identifier: GPL-3.0-or-later\n").license === "GPL-3.0-or-later", "SPDX 标签的 -or-later 变体应原样保留");
      assert(detectLicenseFromText("SPDX-License-Identifier: LicenseRef-Proprietary\n").license === null, "自定义 SPDX 标识符不得采信");
      // 绝不猜测:没有可验证标记就返回 null,由调用方判 unknown
      assert(detectLicenseFromText("Copyright 2026 Someone. All rights reserved.\n").license === null, "无法识别的正文必须返回 null");
      assert(detectLicenseFromText("Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.\n").license === null, "缺标题行的 ISC/0BSD 共有正文不得猜(两者仅标题不同)");
      assert(detectLicenseFromText("").license === null, "空文件不得识别为某个许可证");
      assert(detectPackageLicense(path.join(dir, "absent-dir")).status === "no-package-dir", "目录不存在时状态应为 no-package-dir");
    });

    await suite.case("许可证分类与严重度换算(纯函数)", () => {
      assert(classifyLicense("MIT").group === "permissive" && classifyLicense("MIT").needsReview === false, "MIT 应为宽松许可且无需复核");
      assert(classifyLicense("GPL-3.0-or-later").group === "strongCopyleft", "GPL 应为强 copyleft");
      assert(classifyLicense("LGPL-3.0").group === "weakCopyleft", "LGPL 应为弱 copyleft(不能被 LGPL 里的 GPL 误判成强 copyleft)");
      assert(classifyLicense("(MIT OR GPL-3.0-or-later)").group === "dualChoice", "多选一表达式应单列 dualChoice");
      assert(classifyLicense("Apache-2.0 AND LGPL-3.0-or-later").group === "weakCopyleft", "复合表达式取最严格的一支");
      assert(classifyLicense("(MPL-2.0 OR Apache-2.0)").group === "dualChoice", "MPL 多选一应单列");
      assert(classifyLicense("").group === "unknown" && classifyLicense("").needsReview === true, "空许可证应为 unknown 且需复核");
      assert(classifyLicense("BlueOak-1.0.0").group === "permissive", "非 copyleft 的自定义许可不应误判");
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H") === 9.8, "CVSS v3.1 基础分应为 9.8");
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H") === 7.5, "仅机密性受损应为 7.5");
      assert(cvss3BaseScore("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:H/VA:N") === null, "不支持的向量版本应返回 null 而非乱算");
      assert(severityFromScore(9.8) === "critical" && severityFromScore(7.5) === "high" && severityFromScore(4.0) === "moderate", "基础分到严重度的分档应正确");
      assert(compareSemver("1.0.10", "1.0.9") > 0, "semver 比较须按数值而非字典序");
      const plan = buildAuditPlan("https://registry.npmmirror.com");
      assert(plan.length === 2, `应有两棵树的 audit 命令,实际 ${plan.length}`);
      assert(plan[0]?.args.includes("--omit=dev") === true, "生产树那次须带 --omit=dev");
      assert(plan[1]?.args.includes("--omit=dev") === false, "全树那次不得带 --omit=dev");
    });

    await suite.case("依赖边按 node_modules 上溯解析(嵌套依赖落到正确条目)", () => {
      const { lockPath } = sandbox("sbom-edges");
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      assert(resolveDepPath(lock, "node_modules/mixed-lib", "inner-lib") === "node_modules/mixed-lib/node_modules/inner-lib", "同名嵌套依赖应就近解析");
      assert(resolveDepPath(lock, "node_modules/mixed-lib/node_modules/inner-lib", "x") === null, "未声明的依赖应返回 null 而非猜测");
      assert(resolveDepPath(lock, "", "prod-lib") === "node_modules/prod-lib", "根包直接依赖应解析到顶层");
      const sbom = generateSbom(lockPath, "package-lock.json");
      // 嵌套的 inner-lib@1.0.1 与顶层的 inner-lib@1.0.0 版本不同,purl 本身唯一,无需消歧
      const mixedRef = sbom.document.dependencies.find((entry) => entry.ref === "pkg:npm/mixed-lib@1.0.0");
      assert(mixedRef?.dependsOn.join() === "pkg:npm/inner-lib@1.0.1", `嵌套依赖边应指向嵌套版本,实际 ${JSON.stringify(mixedRef)}`);
      // 同一 name@version 出现在两处时必须消歧,否则依赖边会指向错误组件
      lock.packages["node_modules/other"] = { version: "1.0.0", license: "MIT", dependencies: { "inner-lib": "1.0.1" } };
      lock.packages["node_modules/other/node_modules/inner-lib"] = { version: "1.0.1", license: "LGPL-3.0-or-later" };
      lock.packages[""].dependencies = { ...lock.packages[""].dependencies, other: "^1.0.0" };
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), "utf8");
      const dup = generateSbom(lockPath, "package-lock.json");
      const dupRef = dup.document.dependencies.find((entry) => entry.ref === "pkg:npm/other@1.0.0");
      assert(
        dupRef?.dependsOn.join() === "pkg:npm/inner-lib@1.0.1?m2w_path=node_modules%2Fother%2Fnode_modules%2Finner-lib",
        `重名版本应带消歧 qualifier,实际 ${JSON.stringify(dupRef)}`,
      );
      const refs = dup.document.components.map((component) => component["bom-ref"]);
      assert(new Set(refs).size === refs.length, "bom-ref 必须唯一");
      const devTool = dup.document.components.find((item) => item.name === "dev-tool");
      assert(devTool?.scope === "optional", "仅 dev 组件的 CycloneDX scope 应为 optional");
      const prodLib = dup.document.components.find((item) => item.name === "prod-lib");
      assert(prodLib?.scope === "required", "生产组件的 CycloneDX scope 应为 required");
    });

    await suite.case("缺输入/错参数 → 非零退出且文案可操作", async () => {
      const { dir, lockPath } = sandbox("missing-input");
      const missingLock = path.join(dir, "no-such-lock.json");
      let message = "";
      try {
        await runScaScan({ lockPath: missingLock, registry: "https://registry.npmmirror.com", allowOsv: false, transport: fakeNpm({}).transport });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(/lockfile 不存在/.test(message) && /npm install/.test(message), `缺 lockfile 的提示须可操作,实际:${message}`);
      const cli = runCli(["scripts/supply/check-supply-chain.mjs", "--lock", missingLock, "--output-dir", path.join(dir, "out"), "--no-osv", "--no-npm-audit"]);
      assert(cli.status === 1, `缺 lockfile 时 CLI 须非零退出,实际 ${cli.status}`);
      assert(/lockfile 不存在/.test(cli.output), `CLI 输出须说明缺 lockfile,实际:${cli.output}`);
      const badOption = runCli(["scripts/supply/gen-sbom.mjs", "--lockk", lockPath]);
      assert(badOption.status === 1 && /无法识别的选项/.test(badOption.output), `参数写错须失败并给出用法,实际 ${badOption.status}:${badOption.output}`);
      // 没有任何扫描源可用(等于「没扫」)也必须判红,不得当成通过
      const noSource = await runScaScan({ lockPath, registry: "https://registry.npmmirror.com", allowOsv: false, allowNpmAudit: false });
      assert(noSource.status === STATUS_UNAVAILABLE, "零扫描源时须为 unavailable");
      assert(noSource.blocking.length > 0, "零扫描源时须阻断");
    });

    await suite.case("端到端(check-supply-chain):正例绿、漏洞/未知许可证负例红", async () => {
      const clean = sandbox("e2e-clean", { noLicense: false });
      const cleanLock = clean.lockPath;
      const cleanOut = path.join(clean.dir, "out");
      const stub = await startStubOsv({});
      try {
        const ok = await runSupplyChecks({
          projectRoot: clean.dir,
          lockPath: cleanLock,
          outputDir: cleanOut,
          registry: "https://registry.npmmirror.com",
          allowNpmAudit: false,
          osvEndpoint: stub.endpoint,
        });
        assert(ok.status === "ok", `三段全通过时整体应为 ok,实际 ${ok.status}:${JSON.stringify(ok.report.sections.sca.blocking)}`);
        assert(stub.requests.some((url) => url === "/v1/querybatch"), "SCA 段应真的向 OSV 发过批量查询");
        for (const file of ["sbom.cdx.json", "licenses.json", "NOTICE.md", "sca-report.json", "supply-report.json"]) {
          assert(fs.existsSync(path.join(cleanOut, file)), `产物缺失:${file}`);
        }
        const licensesReport = JSON.parse(fs.readFileSync(path.join(cleanOut, "licenses.json"), "utf8"));
        assert(licensesReport.status === "ok" && licensesReport.unknownLicense.length === 0, "全声明许可证时不应判红");
        // 门禁日志须把决策口径说清:待复核按生产/开发拆分,决策逐条留痕
        const gateLog = formatSupplyLog(ok.report).join("\n");
        assert(/需人工复核 \d+\(生产 \d+ \/ 开发 \d+\)/.test(gateLog), `门禁日志应拆分待复核范围,实际:${gateLog}`);
        assert(/多选一许可已选定:/.test(gateLog) || /分支选定决策未生效:/.test(gateLog), `门禁日志须留痕决策结论,实际:${gateLog}`);
        assert(ok.report.sections.licenses.licenseDecisions !== undefined, "总报告须带上决策汇总");

        // --sbom-check:先过,再改 lockfile 即漂移
        const checked = await runSupplyChecks({
          projectRoot: clean.dir,
          lockPath: cleanLock,
          outputDir: cleanOut,
          registry: "https://registry.npmmirror.com",
          allowNpmAudit: false,
          sbomCheck: true,
          osvEndpoint: stub.endpoint,
        });
        assert(checked.report.sections.sbom.status === "ok", "产物与 lockfile 一致时 --sbom-check 应通过");
        const drifted = JSON.parse(fs.readFileSync(cleanLock, "utf8"));
        drifted.packages["node_modules/late-dep"] = { version: "1.0.0", license: "MIT" };
        fs.writeFileSync(cleanLock, JSON.stringify(drifted, null, 2), "utf8");
        const afterDrift = await runSupplyChecks({
          projectRoot: clean.dir,
          lockPath: cleanLock,
          outputDir: cleanOut,
          registry: "https://registry.npmmirror.com",
          allowNpmAudit: false,
          sbomCheck: true,
          osvEndpoint: stub.endpoint,
        });
        assert(afterDrift.report.sections.sbom.status === "fail", "lockfile 变更后 --sbom-check 应判红");
        assert(/新增组件未记入 SBOM:pkg:npm\/late-dep@1\.0\.0/.test(afterDrift.report.sections.sbom.problem ?? ""), `漂移须点名新组件,实际:${afterDrift.report.sections.sbom.problem}`);
      } finally {
        await stub.close();
      }

      // 负例:生产依赖命中漏洞 + 未知许可证,两段各自报红
      const dirty = sandbox("e2e-dirty");
      const dirtyStub = await startStubOsv({ "prod-lib": [GHSA_VULN] });
      try {
        const bad = await runSupplyChecks({
          projectRoot: dirty.dir,
          lockPath: dirty.lockPath,
          outputDir: path.join(dirty.dir, "out"),
          registry: "https://registry.npmmirror.com",
          allowNpmAudit: false,
          osvEndpoint: dirtyStub.endpoint,
        });
        assert(bad.status === "fail", "有生产漏洞与未知许可证时整体须判红");
        assert(bad.report.sections.sca.status === "fail", "SCA 段须判红");
        assert(bad.report.sections.sca.blocking?.some((item) => /生产树漏洞:prod-lib\(HIGH\)/.test(item)) === true, `SCA 段须点名 prod-lib,实际:${(bad.report.sections.sca.blocking ?? []).join(";")}`);
        assert(bad.report.sections.licenses.status === "fail", "许可证段须判红");
        assert(bad.report.sections.licenses.unknownLicense?.some((item) => item.name === "no-license") === true, "许可证段须单列未知包");
        assert(bad.report.sections.sbom.status === "ok", "SBOM 段本身不应被上述问题带红");
      } finally {
        await dirtyStub.close();
      }
    });

    await suite.case("进程级 CLI:正例 exit 0,负例 exit 非零", async () => {
      const cli = sandbox("cli", { noLicense: false });
      const cliDir = cli.dir;
      const cliLock = cli.lockPath;
      const outDir = path.join(cliDir, "out");
      const stub = await startStubOsv({});
      try {
        const okRun = await runCliAsync([
          "scripts/supply/check-supply-chain.mjs",
          "--lock", cliLock,
          "--output-dir", outDir,
          "--no-npm-audit",
          "--osv-endpoint", stub.endpoint,
        ]);
        assert(okRun.status === 0, `全通过时 CLI 须 exit 0,实际 ${okRun.status}:${okRun.output}`);
        assert(/\[supply:ok\] 供应链检查通过/.test(okRun.output), `CLI 应给出通过结论,实际:${okRun.output}`);
      } finally {
        await stub.close();
      }
      // 未知许可证 → exit 1 且文案点名(另建沙盒,勿覆盖上面那份齐备的 lockfile)
      const dirty = sandbox("cli-dirty");
      const dirtyRun = runCli([
        "scripts/supply/check-supply-chain.mjs",
        "--lock", dirty.lockPath,
        "--output-dir", path.join(dirty.dir, "out"),
        "--no-osv",
        "--no-npm-audit",
      ]);
      assert(dirtyRun.status === 1, `有未知许可证时 CLI 须 exit 1,实际 ${dirtyRun.status}`);
      assert(/许可证缺失:no-license@0\.1\.0\(生产依赖\)/.test(dirtyRun.output), `CLI 须点名未知许可证的包,实际:${dirtyRun.output}`);
      assert(/这不等于「无漏洞」/.test(dirtyRun.output), "零扫描源时 CLI 须明确「不等于无漏洞」");
      // 沙盒缺 SBOM 产物 + --sbom-check → 非零且可操作
      const missingSbom = runCli([
        "scripts/supply/check-supply-chain.mjs",
        "--lock", cliLock,
        "--output-dir", path.join(cliDir, "empty-out"),
        "--no-osv",
        "--no-npm-audit",
        "--sbom-check",
      ]);
      assert(missingSbom.status === 1 && /缺少已生成的/.test(missingSbom.output), `--sbom-check 缺产物须失败,实际 ${missingSbom.status}:${missingSbom.output}`);
      // gen-sbom CLI:生成 → --check 通过
      const sbomOut = path.join(cliDir, "sbom.json");
      const gen = runCli(["scripts/supply/gen-sbom.mjs", "--lock", cliLock, "--output", sbomOut]);
      assert(gen.status === 0, `gen-sbom 应 exit 0,实际 ${gen.status}:${gen.output}`);
      const check = runCli(["scripts/supply/gen-sbom.mjs", "--lock", cliLock, "--output", sbomOut, "--check"]);
      assert(check.status === 0, `gen-sbom --check 应 exit 0,实际 ${check.status}:${check.output}`);
      const licensesRun = runCli(["scripts/supply/gen-licenses.mjs", "--lock", cliLock, "--output-dir", path.join(cliDir, "lic")]);
      assert(licensesRun.status === 0, `许可证齐备时 gen-licenses 应 exit 0,实际 ${licensesRun.status}:${licensesRun.output}`);
      // 直接跑 SBOM 缺 lockfile 的路径
      const noLock = runCli(["scripts/supply/gen-sbom.mjs", "--lock", path.join(cliDir, "absent.json"), "--output", path.join(cliDir, "x.json")]);
      assert(noLock.status === 1 && /lockfile 不存在/.test(noLock.output), `缺 lockfile 时 gen-sbom 须非零退出,实际 ${noLock.status}:${noLock.output}`);
    });
  });

  return { cases: suite.results };
}
