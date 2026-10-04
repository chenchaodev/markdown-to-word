// @ts-check
/**
 * 许可证门禁段(位于 test/gates/supply/supply/ = 镜像 gates/supply/supply/gen-licenses.mjs,
 * 纯 Node 逻辑,不经 dist 编译产物):licenses.json / NOTICE.md。
 * - 未知/缺失判红、copyleft 与多分支单列待复核
 * - 两级回落:字段优先,缺失时取随包许可证文件并记证据;认不出仍判红(三种原因码分得开)
 * - 多选一分支选定:只作用于生产依赖、只作用于与上游现状相符的决策;NOTICE 同时保留
 *   「上游原始 A OR B」与「本项目选用 A」两行
 * - 许可证文件识别:候选名大小写不敏感、标记覆盖、SPDX 标签与不猜测;标记表收紧
 *   (GPLv3 提及 AGPL 不得判成 AGPL-3.0;BSD 免责声明不得漏算);多许可证拼接形态识别
 *
 * 本段同时覆盖同层共享库 `supply-common.mjs` 的许可证识别与多选一判定口径(纯函数):
 * 那些判据无独立门禁载体,只在此处被门禁行为穿过时才走到,故一并在此钉住。
 *
 * 断言方式:临时目录里造沙盒 lockfile 与包目录,断言**具体诊断文案与证据字段**
 * (来源 lockfile 还是 package-file、证据文件名、原因码),只看「判红」会让
 * 「因错误原因失败」蒙混过关。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCaseSuite } from "../../../harness/case.js";
import { ROOT } from "../../../harness/paths.js";
import { removeTree } from "../../../harness/temp-resource.js";
import { spawnSync } from "node:child_process";
import { generateLicenses } from "../../../../gates/supply/supply/gen-licenses.mjs";
import {
  DECISION_STATUS,
  LICENSE_SHAPE,
  LICENSE_TEXT_MARKERS,
  classifyLicense,
  createDecisionIndex,
  detectLicensesInText,
  detectLicenseFromText,
  detectPackageLicense,
  expressionIncludesBranch,
  listLicenseFiles,
  loadLicenseDecisions,
  parseVersionRange,
  resolveObligationSummary,
  versionSatisfies,
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
  if (!cond) throw new Error(`gen-licenses 断言失败:${msg}`);
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
 * 清理走 removeTree(带 EBUSY/EPERM 退避重试与删后复查);删不掉仍即抛 ——
 * 「删不掉就抛」是本段原有的失败语义,助手只负责吸收 Windows 上的瞬时占用。
 * @param {(dir: string) => unknown} fn 在临时目录上执行的夹具逻辑
 * @returns {Promise<unknown>} fn 的返回值(透传)
 */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-licenses-"));
  try {
    return await fn(dir);
  } finally {
    const outcome = removeTree(dir);
    if (!outcome.ok) throw new Error(`临时目录清理失败:${dir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
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

   "License" shall mean the terms and conditions for use, copy, modify, and
distribution as defined by Sections 1 through 9 of this document.

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
============

                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

  13. Use with the GNU Affero General Public License.

  Notwithstanding any other provision of this License, you have
permission to link or combine your covered work with a work licensed
under version 3 of the GNU Affero General Public License into a single
combined work, and to convey the resulting work.
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

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  await withTempDir(async (tmp) => {
    // 每个 case 一份独立沙盒:会改写 lockfile / 包目录的 case 共用会让后续 case 读到脏输入
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
      const cli = runCli(["gates/supply/supply/gen-licenses.mjs", "--lock", lockPath, "--output-dir", path.join(dir, "out")]);
      assert(cli.status === 1, `认不出的组件存在时 CLI 须 exit 1,实际 ${cli.status}`);
      assert(/许可证缺失:mystery-lib@6\.0\.0\(生产依赖\)/.test(cli.output), `CLI 须点名认不出的包,实际:${cli.output}`);
      assert(/不做猜测/.test(cli.output) && /无法匹配任何已知许可证标记/.test(cli.output), "CLI 须保留「不猜测」口径的诊断");
    });

    await suite.case("仓库决策清单:结构与可校验性(实跑读取,非沙盒)", async () => {
      const repoDecisions = loadLicenseDecisions(path.join(ROOT, "gates", "supply", "supply", "license-decisions.json"));
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
  });

  return { cases: suite.results };
}