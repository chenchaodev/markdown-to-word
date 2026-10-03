# 开发者手册

> 本文件是**验证基线的唯一载体**:命令与文件清单是主职责,另附两类本项目特有的内容 —— 改代码时会撞上的**「勿随意偏离」约束**(架构分层与设计口径)与**代码地图**。架构决策的本体在 `docs/adr/`,此处只留会直接影响写码的那几条(未升格为 ADR 的口径也只留在这里,故不逐条转链);踩坑与长分析原文在 `docs/evidence/`。文档纪律不在本文件 —— 指针门禁的**判定本体在本仓** `gates/repo/check-pointers.mjs`(判据内容与判据文案只在那里维护;全局配置目录那份只判配置侧,**判据从此两份,规则演进要改两处**,决定见 `docs/adr/ADR-054-配置仓与项目仓门禁拆分本仓落地.md`),台账纪律正文见全局配置目录 `REQ-RULES.md`。

## 环境
- Node >= 22.13(ESM;typescript-eslint 经 side-by-side 用 TS 6 API,`tsc` 二进制仍为 TS 7——package.json 中 `typescript` 别名 `@typescript/typescript6`,`@typescript/native` 别名真实 TS 7;勿回退)
- npm 源:npmmirror(见根 `.npmrc`,仅含 registry,勿回退)
- Electron 二进制镜像(本地开发勿回退,装 electron/打包前设置):经 `tools/setup-env.ps1` 一次性写入**用户级环境变量** `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR`(GitHub Actions 不需要);勿在 `.npmrc` 写这两个键——npm 不识别会警告,且 `electron_builder_binaries_mirror` 不会被转发成 `ELECTRON_BUILDER_BINARIES_MIRROR`,electron-builder 读不到
  - `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  - `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
- 依赖钉死与全部「勿回退」约束见项目 `AGENTS.md`「硬约束」节;钉死理由清单见 [`evidence/20260927-170600-事实-依赖与工具链.md`](evidence/20260927-170600-事实-依赖与工具链.md) 的「审计整改记录(依赖钉死策略清单)」条
- 本地跑 `npm install` 前先跑一次 `tools/setup-env.ps1`(写 Electron 镜像环境变量);CI 走官方 registry,不需要该步骤

## 命令
日常主路径的命令(门禁类别与接入点见下一张「门禁接入点」表,`package.json` scripts 为唯一单源):

| 命令 | 用途 |
| ---- | ---- |
| `npm install` | 安装依赖。运行时与构建期依赖(含 `typescript` / `@types/node` / `electron` / `electron-builder`)全在 `dependencies` + `devDependencies`,一次装齐,无「先单独装某几个包」的前置步骤 |
| `npm run typecheck` | TS 类型检查(主树 `tsc --noEmit` + 测试树 `tsconfig.test.json` 按 `// @ts-check` 渐进,TS 7) |
| `npm run lint` | ESLint 10 flat 检查 `src/ test/ gates/ tools/`(typescript-eslint 类型感知规则,side-by-side TS 6 API) |
| `npm run build` | 构建 core 到 `dist/`(`tsc` + copy-renderer) |
| `npm run dev` | 开发启动 = `build` 后**直接**起 Electron,**不带**构建新鲜度守卫 |
| `npm run start` | 启动 Electron,但**先跑 `gates/smoke/check-build-fresh.mjs` 校验构建新鲜度** —— 只改了源码没重建时,守卫先拦下(`test:smoke` 用的是同一个守卫) |
| `npm run dist` | electron-builder 打包 NSIS 安装包(输出 `release/`;链内含产物核对,见「门禁接入点」) |
| `npm run test` | 验收全部测试段(`electron test/acceptance.mjs`,自动发现 `core/`、`main/`、`renderer/` 与 `gates/` 下 `*.test.js`;需先 build;新增测试=新建段文件零注册) |
| `npm run test:smoke` | 冒烟自测(`electron . --smoke`,前置构建新鲜度守卫) |
| `npm run test:coverage` | c8 覆盖率报告(自动验证的 core/main 产物;GUI renderer 编排层按测试边界排除,renderer 断言仍由 acceptance 执行) |
| `npm run test:all` | 验收 + 冒烟 |
| `npm run gen:fixtures` | 验收样例生成器(需先 build) |
| `npm run check:fixtures` | fixtures 漂移校验(幂等,exit 0/1;CI 门禁步骤) |
| `npm run icons` | SVG 图标转 ICO(`tools/svg-to-ico.mjs`) |
| `npm run check:docs` | 文档指针门禁(**判定本体在本仓 `gates/repo/check-pointers.mjs`,零配置 ⇒ 已在 `verify:ci` 链里**,排在 `check:docs:selftest` 之前)。**跨仓路径只分类不判定** ⇒ 结论行会自报「分类 N 处 · 判定 0 处」并把「覆盖」标为不全 —— **那行既不是通过也不是失败,是「没查」** |

> 冒烟只有 `npm run test:smoke` 一个入口。绕过 npm 直接 `npx electron . --smoke` 会跳过构建新鲜度守卫、拿旧产物跑,故本文件不列该写法。

### 交付面入口(不经 npm script,直接跑编译产物)

三个交付面共用 `src/convert/` 装配层,各自入口从 `dist/` 起跑,**都不经 npm script**,因为它们是给脚本 / AI 助手直接调用的,不是开发回路的一步:

| 入口 | 面向 | 形态与限制 |
| ---- | ---- | ---- |
| `node dist/cli/index.js <路径...>` | 脚本 / 批处理 | 纯 node。`--format docx` 同进程跑;`pdf` 经**子进程重入 Electron**(入口 `dist/main/cli-pdf-host.js`,任务与结果经临时文件传递,不走 stdout —— Windows 管道下 `app.exit()` 不等 stdout 落盘)。语法、选项、退出码表见 [命令行用法](CLI.md) |
| `node dist/mcp/index.js` | AI 助手(MCP) | 纯 node,手写最小 JSON-RPC 2.0 over stdio(不引官方 SDK)。只暴露 `convert_markdown`(docx-only);`degraded: ["mermaid"]` 必须出现在返回值里 —— 降级对 agent 不可见即等于造了一台「同样输入偶尔产出不同」的工具。接入示例见 [MCP 接入](MCP.md) |
| `electron .` | 图形界面 | 唯一的全功能形态(pdf + mermaid) |

三者**都不随安装包分发**(`build.files` 只收 `dist/**`,但 npm 包仍是 `private`、无 `bin`),故本节命令只在源码检出里成立;这是发布决策未定的现状,不是遗漏。

改任一交付面的行为前先读 ADR-060 的「入口能力矩阵」:新增入口 = 在那张表加一列,不是重新设计一层。

## 门禁接入点
> 接入点四取一:`verify:ci` 链 / `verify:release` 链 / 仅某个 CI workflow 的 job / 仅本地手动。链的成员单源于 `package.json` 的 `verify:ci` / `verify:release` / `dist`,workflow 事实单源于 `.github/workflows/ci.yml` 与 `.github/workflows/release.yml`;两者对链组成的断言由 `check:contract` 守护。

| 门禁类别 | 脚本 | 接入点 |
| ---- | ---- | ---- |
| 构建 / 类型 / 风格 | `build` `typecheck` `lint` | `verify:ci` 链 |
| 开发启动 | `dev` `start` | 仅本地手动 |
| 清理生成目录 | `clean:dist` `clean:release` | `verify:release` 链(`dist` 的首步,只删这两个生成目录) |
| 清理 c8 的 V8 dump 临时目录 | —(**无 npm script**) | `node gates/artifacts/clean-artifacts.mjs --coverage-temp`。这是**独立的无值布尔开关,不是第四个 `--target` 关键字** —— `--target` 的取值域只有 `dist`/`release`/`all` 三档且被门禁逐字节钉死,加关键字会判红。`--coverage-temp` 的落点钉在 `package.json` 的 `test:coverage` 的 `--temp-directory=` 上。**默认不清**:`clean:dist` 不动它,`--target all` 也不带它 —— 它是测试运行器中间态、不进包,清理理由只是磁盘占用,搭车「删除不可逆」的动作不划算(`.c8-tmp` 实测约 134M) |
| 验收测试 | `test` `test:all` | 仅本地手动 —— 链内跑的是带插桩的 `test:coverage`,不在这里再插一遍(裁决见 `docs/adr/adr-016-门禁链内全量验收只跑一遍.md`) |
| 验收样例 | `check:fixtures`(漂移校验) | `verify:ci` 链 |
| 验收样例(重生成) | `gen:fixtures` | 仅本地手动 |
| 覆盖率 | `test:coverage` `check:coverage-zero` | `verify:ci` 链 |
| renderer 覆盖率报告 | `report:coverage-renderer` | 仅本地手动 |
| 冒烟 | `test:smoke` | `verify:ci` 链 |
| 几何 | `check:geometry` | `verify:ci` 链。判据是**结构不变式**而非像素快照（后者会因平台/主题/字体差异假红）：主窗舞台的槽位/视口/响应式档位，**外加设置抽屉的 40 个控件**（存在且可见 · 组归属 · 组内视觉序 · 无水平裁切/越界 · 三种门控形态的收起与灰禁双向）。选择器与控件清单的单源在 `shared/geometry/geometry-spec.mjs` |
| 工程契约 / 层向 / 引用固定 / 段编号 / 阶段契约枚举点 | `check:contract` `check:contract:selftest` `check:boundary` `check:boundary:dist` `check:pinned-actions` `check:test-numbering` `check:transform-dispatch` | `verify:ci` 链;其中 `check:contract` 与 `check:pinned-actions` 在两个 workflow 里另有 `npm ci` 之前的 fail-fast 步骤(同一入口,非第二份清单)。`check:boundary` 判 **src 树**(纯文本、不依赖 dist,故排在 build 之前);`check:boundary:dist` 是同一门禁的**产物面**调用点(`--flavor dist`,判编译后的 dist 树:type-only import 已擦除、cjs require 形态只在产物面可见),因依赖 dist 而**必须排在 `build` 之后**,故不能并进 `check:boundary` 自身 —— 那会与「boundary 须在 build 之前」的链序契约冲突。`check:transform-dispatch` 守的**取反不变量**:渲染层与 main 转换层薄壳不得枚举渲染前变换类设置,且该类设置的枚举点恰 2 处且都在 `core/markdown/`(见 `docs/adr/adr-026` 与 `adr-027`) |
| 归档索引 | `check:archive-index` | `verify:ci` 链 |
| 归档索引(重生成) | `gen:archive-index` | 仅本地手动 |
| 文档指针 | `check:docs` `check:docs:selftest` | `verify:ci` 链(`check:docs` 排在 `check:docs:selftest` 之前)。载体在本仓,workflow 无需额外克隆或安装;但**跨仓路径这一族无判红执行体**(双侧皆无,别把它当成已查过;证据与删除理由见下方「门禁详解」那条与 ADR-056) |
| 变更日志口径 | `check:changelog` `check:changelog:selftest` | `verify:ci` 链(排在 `check:docs:selftest` 之后、`build` 之前)。判据只扫 `docs/CHANGELOG.md` 的**版本条目区**(`## [待发版]` 起至文末),**六类**:禁内部工程词 · 禁第二人称「你」· 禁内部编号(`REQ-0NN` 与 commit hash)· 禁文言虚词 · 禁装饰性副词(实义限定放行)· 禁载体维护指纹词。**头部不扫** —— 头部是写反例的地方;另带防空过判据(锚点缺失 / 条目区无版本条目 / 路径不可读均判红)。**枚举词不可凭直觉增补**:实测「盖」在「覆盖 / 遮盖 / 涵盖」里是高频正当用词、「概」唯一命中是「概览」,裸字判红即 100% 误报 ⇒ 两者都带**字级成词护栏**。「仅」当前在真实语料上 21/21 走实义限定放行分支,**行为等价于不判红**,提供的是对未来的保护而非已发生的保护(该说明写在门禁文件头,勿把它当成已验证有效)。**已知不覆盖**:比喻、调侃、句法层文言腔、术语一名 —— 无封闭词表可枚举,靠人写(裁决见 `docs/adr/ADR-047-CHANGELOG语体正式化与门禁.md`) |
| Release notes 抽取 | `check:release-notes` `check:release-notes:selftest` | `verify:ci` 链(紧接 `check:changelog` 之后)。**两层都要**:静态面答「发布时会不会用错抽取实现」(workflow 必须引 `gates/repo/release-notes.mjs` 的 `extractNotes(…, pkg.version)`,不得内联自造正则、空 notes 必须 `exit 1` 不得回退 `--generate-notes`),行为由自检在链内实跑 9 条断言覆盖(含 4 条负向),**变异脚本**再逐条改坏 workflow 证明 5 条判据各自会判红(**由 selftest 内部 `await import()` 调起,故不单列 npm script**) —— 该缺陷的失效形态是「静默取到错内容」,只在 GitHub Release 页面出现、发布前不可见(线上实况见 REQ-145) |
| 环境指纹 | `check:env` | 仅 `ci.yml` 主 job 与 `release.yml` 的指纹步骤(不进任何链) |
| 供应链 | `check:supply` | 仅 `ci.yml` 的 `supply-chain` job 与 `release.yml` 的供应链步骤 —— 需联网查 advisory 库,刻意不并入本地链(否则「代码有问题」与「网络抖动」共用一个退出码) |
| 供应链子步骤的独立入口 | `gen:sbom` `check:sbom` `gen:licenses` `check:sca` `collect:license-fulltext`(按需收集许可证全文副本) | 判定入口是 `check:supply`(它 import 同一批模块);这五条是同批模块的独立 CLI 入口,离线部分由 `test/gates/supply-chain.test.js` 在链内覆盖 |
| 包体 | `check:pack-size` | 仅本地手动(需真实安装包实测;判定逻辑由 `test/gates/observability.test.js` 在链内以沙盒覆盖) |
| 冒烟报告 | `check:smoke-report` | 仅本地手动(判定逻辑同上,由 `test/gates/observability.test.js` 在链内覆盖) |
| 阴性探针 | `check:gates` | 仅本地手动 —— 同一模块由 `test/gates/gate-probes.test.js` 在链内实跑 |
| GUI 视觉自查 | `ui:shots` | 仅本地手动(`tools/visual-check.mjs`)。**发版前需重跑** —— 它的产出 `output/artifacts/ui-v4/` 是 `docs/images/ui-*.jpg` 的来源,界面一改那批图就过期;README / 官网首页 / 用户指南都靠它们展示 |
| 安装烟测 | `check:install-smoke` | 仅本地手动,默认预演模式零系统副作用;真实装卸须显式 `--execute`(沙盒内的进程级行为由 `test/gates/install-smoke.test.js` 在链内覆盖) |
| 打包产物核对 | `gen:dist-manifest` `check:dist-manifest` `check:asar` `check:release` `check:signature` `check:unpacked-smoke` | `verify:release` 链(`dist` 内部) |
| 图标资源 | `icons` | 仅本地手动 |
| 聚合入口 | `verify:ci` `verify:release` `dist` | **`verify:ci` 仅主会话在推送前跑一次,子代理一律不跑**(谁跑哪一档见全局配置目录 `AGENTS.md` 第八节);`verify:release` / `dist` 主会话手动。CI 侧:`ci.yml` 主 job(`verify:ci`)/ `release.yml` 的 release job(`verify:release`);`dist` 是后二者内部的打包步 |

## 本地打包注意事项

`npm run dist`(electron-builder NSIS)在本机实测踩到三类坑,根因与完整解法见 [`evidence/20260927-170600-事实-供应链与发布.md`](evidence/20260927-170600-事实-供应链与发布.md) 的「Windows 本地打包踩坑(长路径)」与「G5 打包坑」条:

- **Defender 重命名 EPERM**:electron 解压到 `win-unpacked.tmp` 后被 Windows Defender 实时扫描锁文件句柄,`rename .tmp → win-unpacked` 失败。绕过:用 `--config.electronDist=<node_modules/electron/dist>` 直接喂 npm install 已解压的 electron 发行目录,electron-builder 改为 copy(非解压后 rename)。
- **长路径 / OneDrive 锁**:项目在 `Documents\opencode\...`(OneDrive 同步)时,即便建 junction 也仍解析真实路径写入,重命名同样失败且路径过长。绕过:用 `--config.directories.output=<非 OneDrive 短路径>` 重定向输出(如 `C:\m2w-out`,路径依环境而定)。
- **镜像 env**:`.npmrc` 不写 electron 镜像键(npm 不识别会警告,且 `electron_builder_binaries_mirror` 不会被转发成 `ELECTRON_BUILDER_BINARIES_MIRROR`)。本地开发先跑一次 `tools/setup-env.ps1` 写入用户级环境变量;或构建前显式 `$env:ELECTRON_BUILDER_BINARIES_MIRROR`(及 `ELECTRON_MIRROR`),否则 electron-builder 回退 GitHub 下载超时。

完整命令示例:

```bash
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run dist -- --config.directories.output=C:\m2w-out --config.electronDist=node_modules\electron\dist
```

**单段筛选**:设 `M2W_ONLY` 环境变量只跑命中的段(逗号分隔子串、大小写不敏感,如 `M2W_ONLY='slug,image-type'`),改一个 handler 不必全量重跑。

> ⚠️ **测试对象是 dist 非 src**:验收/smoke 跑的是 `dist/` 编译产物。绕过 npm 直接 `electron test/acceptance.mjs` 会静默测旧产物无任何提示——改动后务必经 `npm run build` 或 `npm run test`(自带 build),或经带新鲜度守卫的 `npm run test:smoke` / `npm run start`。
>
> 只跑一个段:`M2W_ONLY=<段名> npm test`(`npm test` 自带 `npm run build`,故测的仍是当轮新产物;段名取自上面「测试体系」各段目录下的段文件)。

## 架构(设计决策,勿随意偏离)
- 分层:转换核心 `src/core/` 纯逻辑、常态零 IO 可测试(fs 访问仅 `src/core/pipeline/precheck.ts` 的 exists 与 `src/core/pdf/katex-css.ts` 的 read 两处,均依赖注入、默认 `node:fs`,可整体替换);GUI 主进程 `src/main/`;UI `src/renderer/`(vanilla TS + 原生 DOM,不引前端框架);依赖方向单向 core←main←renderer 不反向
- **转换在主进程执行**(docx 库为 Node 原生;printToPDF 走系统字体,中文零配置);renderer 经 IPC 触发
- IPC:channel 名单源 `src/main/ipc/channels.ts`;`contextIsolation` + preload 白名单 + 进度 `webContents.send` 推送;拖放取路径用 `webUtils.getPathForFile`(File.path 已移除)
- 未来扩展格式只需在 `src/core/convert.ts` 注册表登记 renderer
- 中文/字体策略:docx 走 `src/core/docx/theme.ts` 集中配置 `font: { ascii: 'Calibri', eastAsia: '微软雅黑', hAnsi: 'Calibri' }`(Normal 样式,程序内可覆盖,宋体作备选配置项);pdf 走 Windows 系统字体零配置(Linux 部署需 CSS @font-face 内嵌 noto-cjk,后置)
- 标题编号计数单源:`src/core/markdown/heading-numbering.ts` 共享纯函数(docx prescan 与 pdf xref 共用;无 h1 文档章节引用统一 Word 口径「1」,CSS counter 同口径)
- 双管线的语义色与高亮色板各有一处单源(`src/core/style/colors.ts` 与 `src/core/style/hljs-palette.ts`),两侧渲染模块只从那里取值
- 决策本体与其背景/备选方案在 `docs/adr/`(一决策一文件,`ls docs/adr/` 取下一个序号);上面几条是**写码时会撞上**的那几条,不是决策记录

## 代码地图
> 骨架以实际目录树为准;括注是**职责一句**,不是「本目录只有这些文件」的保证 —— 新增文件时顺手补一行。

- `src/core/` 纯转换逻辑,常态零 IO(仅预检 exists / `loadKatexCss` read 两处 fs 访问经依赖注入),可测试
  - 根:`src/core/convert.ts`(格式注册表 + `convert(md, format, options)` 统一入口;pdf 分支不构建 remark AST;页面设置/ConvertFormat 契约单源在 settings-defaults,不在此转手)/`src/core/ipc-contract.ts`(跨进程契约类型单源:ConvertProgressPayload/ConvertMode、BatchItem/BatchProgressInfo/BatchResult、UiState/RecentFile 等纯数据形状;main 实现侧与 renderer 共同 import,type-only 编译期擦除)/`src/core/cancel.ts`(取消错误码与 CancellationGuard 契约单源,降级通道不得吞取消)/`src/core/resource-limits.ts`(公式与图片资源预算单源,docx/pdf 共用)/`src/core/preload-api.ts`(preload 暴露面类型单源,归 core 以消除 renderer→main 反向依赖)
  - `pipeline/`:parse.ts(remark→mdast)/frontmatter.ts(YAML 手写解析)/merge.ts(多文件合并)/precheck.ts(转换前预检)
  - `markdown/`:slug.ts/cross-ref.ts(交叉引用契约正则族单源)/heading-numbering.ts(标题编号计数共享纯函数)/html-whitelist.ts(行内 HTML 白名单 docx/pdf 单源)/comment.ts(批注语法 remark 插件)/mermaid.ts/ai-cleanup.ts(AI 输出清理)/obsidian.ts(Obsidian 双链兼容)/image-size.ts(图片尺寸属性解析)/image-path-policy.ts(本地图片可信路径边界策略单源)/table-width.ts(表格列宽信号解析)
  - `image/`:image-resolver.ts(类型+optional exists)/image-type.ts(魔数嗅探)/image-warning.ts(警告工厂)
  - `settings/`:settings-defaults.ts(默认值+页面几何 PAPER_SIZES_MM/mmToTwips+ConvertFormat 单源)/presets.ts(内置预设目录:排版+页面+完整交付链的快照)/typography.ts
  - `style/`:colors.ts(双管线语义色单源)/hljs-palette.ts(GitHub Light 高亮色板单源)
  - `util/`:encoding.ts(编码预检)/mdast-utils.ts/error-message.ts(Error→message 归一单源)/text-escape.ts(escapeHtml/decodeEntities/escapeRegExp 集中)
  - `src/core/i18n.ts` + `i18n/`:逻辑层(t() 插值/applyStaticTexts/KeyedWarning)+ 注册表(`src/core/i18n/index.ts` 导出面,`src/core/i18n/zh.ts` 键集唯一事实源 / `src/core/i18n/en.ts` 全量 satisfies / `src/core/i18n/ja.ts` 等其余语言 Partial 回退链 当前语言→en→key;Language 类型从注册表派生)
  - `docx/`:render.ts(编排器)/theme.ts(字体集中配置,eastAsia 勿散落硬编码)/ctx.ts(渲染上下文,选项构造时解析默认)/headers.ts(section 页眉装配)/chrome.ts(封面/目录/页眉页脚)/prescan.ts/numbering.ts(编号配置)/template-import.ts(模板浅导入,零 IO)/handlers/(节点处理器:heading/table/captions/equations/code-block/code-highlight/image-run/link-xref/inline-html/fallback/content/math/bookmark)
  - `pdf/`:render.ts(编排器)/template.ts(HTML 组装+页眉页脚 chrome+CSP/sanitize 防护)/template-css.ts(文档模板 CSS 生成)/katex-css.ts(KaTeX CSS 加载,唯一 fs 注入点)/postprocess.ts/metadata.ts/bookmarks.ts(pdf-lib 书签注入)/mermaid.ts/rules/(markdown-it 规则覆盖:caption/equation/xref/html/image/table/heading-id/shared)
- `src/convert/`:headless 装配层(ADR-060;门禁 `convert-no-gui` 禁其反向依赖 main/renderer,`SRC_TOP_LAYERS` 未登记即判红)
  - `run.ts`(装配层主体 `emitConvertedArtifact`:渲染→落盘→两道取消闸门→导出后行为;pdf 打印/mermaid/导出后行为三能力靠入参注入,`skipAfterConvert` 不入本层)/`context.ts`(buildConvertContext)/`preprocess.ts`(解码→frontmatter 隔离→Obsidian/AI 预处理→原样拼回,所有入口共用的准备编排)/`paths.ts`(扩展名判定单源 + `pinOutputPath` 逐字路径形态)/`artifact-writer.ts`(产物提交:同目录唯一临时文件 + 硬链接独占提交,单文件/批量/合并/CLI 共用;`renameOnConflict:false` 即禁避让形态)/`cli-pdf-job.ts`(CLI ↔ pdf 宿主的任务/结果契约与退出码表单源,第二消费方接入时改名 `pdf-host-job.ts`)/`image-downloader.ts`(外链下载:私网拦截+20MB 上限,`allowPrivateAddresses` 可放宽)
- `src/mcp/`:本地 MCP 交付面(ADR-060,与 cli 同层的第二个 adapter;进程跑纯 node,不引入 electron)
  - `jsonrpc.ts`(最小 JSON-RPC 2.0 over stdio 传输:机制层,不含领域概念;不引官方 SDK 是因为只需 `initialize`/`tools/list`/`tools/call` 三方法,SDK 的类型与生命周期开销大于手写)/`tools.ts`(tool 目录与转换调用:docx-only,不注入 `mermaidResolver`,降级在返回值对 agent 可见)/`index.ts`(入口接线:stdio ↔ 分派)
- `src/cli/`:CLI 交付面(`node dist/cli/index.js`,ADR-060;门禁 `faces-no-renderer`/`faces-no-host`/`faces-no-outside-src` 三条(与 mcp 共用同一 scope 形态):禁引 renderer、禁 import electron、禁逃出 src/)
  - `index.ts`(编排:收集输入 → 逐格式跑 → 分流出参 → 取最严重退出码;pdf 经子进程重入 Electron)/`options.ts`(纯函数:argv → 设置契约,退出码语义与 `--template` 映射;`--template` 走 core 的 `presetSettingsPatch`,与 renderer 的 `applyTemplatePreset` 共用同一函数)
- `src/main/`:Electron 主进程
  - `src/main/index.ts`:组合根;`src/main/menu.ts`:应用菜单;`src/main/smoke.ts`:**冒烟唯一实现**(编译进 `dist/main/smoke.js` 随包分发,故解包产物也能跑 `--smoke`;主进程 `--smoke` 分支直连该编译产物,仓内不留第二份实现或 dev 侧转调入口);`src/main/cli-pdf-host.ts`:CLI 的 pdf 宿主(Electron 入口,被 `dist/cli/index.js` 以子进程拉起;注入 `renderPdf` 调装配层,结果写文件而非 stdout —— 见该文件头两条 Windows 坑的注释)
  - `windows/`:main-window.ts/preview.ts(预览窗+尺寸记忆)/title-bar-overlay.ts(Windows 标题栏 overlay 配色与高度常量单源)/web-contents-registry.ts(ctxByWebContents 注册表,窗口层不反向依赖 IPC 层)
  - `ipc/`:channels.ts(channel 名单源+恒等测试守护)/register.ts(handler 注册,导入类 handler 走 importFileViaDialog 模板)/logic.ts(纯逻辑)/output-allowlist.ts(shell 打开产物的会话级白名单,renderer 触达宿主文件系统的唯一入口)/types.ts(只做 re-export,剪贴板契约声明在 `src/core/ipc-contract.ts`)
  - `converter/`:index.ts(编排)/single.ts(薄适配器:校验+读取 md 后交装配层,并注入 pdf 打印/mermaid/导出后行为三能力;转出 `renderPdf`/`runAfterConvert` 以保批量与测试的导入面)/electron-side.ts(Electron 侧:隐藏窗 printToPDF 两遍法 + 书签 + 元数据注入、资源管理器打开产物)/batch.ts/merge.ts
  - `persist/`:settings.ts/ui-state.ts/atomic-json.ts(原子写)/preset-file.ts(设置与预设文件的纯形状校验 + 预设解析/合并)
  - `services/`:mermaid-service.ts/temp-html.ts(randomUUID+'wx')/resource-dirs.ts/web-hardening.ts(窗口导航加固)/session-permissions.ts(session 权限默认拒绝收口)
  - `preload.cts`:contextBridge 白名单暴露 `window.api`(编译为 CJS;暴露面类型取 `src/core/preload-api.ts`)
- `src/renderer/`:GUI UI(vanilla TS + 原生 DOM)
  - `index.html` + `style/`(base/drop/settings/dialogs 四文件)/`src/renderer/lang-bootstrap.js`(FOUC 缓解)
  - 关于窗:`about.html`/`src/renderer/about.ts`/`src/renderer/about-preload.cjs`
  - `src/renderer/renderer.ts`:组合根;`src/renderer/dom/refs.ts`:DOM 引用
  - `state/`:pure.ts(纯函数含 errorMessage()/STAGE_TEXT)/state.ts(批量契约类型自 main 单源导入 + renderer 唯一 store)
  - `settings/`:settings-controls-table.ts(**设置声明表**:键→控件→读/写→复位处置→依赖登记,零 DOM 纯数据,回显类型由它从 `AppSettings` 派生)/settings-panel.ts(加载/回填/持久化写回+分组 persist 单源;`controlDom` 是声明表↔DOM 的唯一接缝)/settings-save.ts(写路径单源 + 跨模块共享的失败重试台账)/settings-preset-actions.ts(预设弹窗/保存/删除/导入导出)/settings-logic.ts(纯函数直测)/settings-drawer.ts + `src/renderer/settings/settings-bindings.ts` 与 `settings-bindings-{preset,typography,headerwatermark,numbering,convert,app}.ts`(按 `index.html` 的 `data-group` 同口径接线,控件 id/name 零触碰)
  - `convert/`:convert-flow.ts + `events/`(convert-actions/dialogs-events/drop/selection/index 组合)+ `src/renderer/convert/file-list.ts`
  - `ui/`(dialogs.ts/dom-ops.ts(DOM 操作原语 + translate 注入适配)/recent-files.ts(bindRecentFilesEvents 范式)/toast.ts/first-run-guide.ts(首启引导))
  - `wizard/`:book-wizard.ts(向导外壳/导航/打开关闭+付印提交)/wizard-steps.ts(步骤渲染·版式步:模板/封面/页眉页脚/水印)/wizard-steps-delivery.ts(步骤渲染·交付步:合并源/目录/付印+当前步渲染)/wizard-fields.ts(字段校验绑定+共用 DOM/radio 零件)/wizard-runtime.ts(草稿/容器/步序单例,防环)/wizard-state.ts(向导状态管理纯 reducer)
- `test/`:验收测试体系(acceptance.mjs 入口 + common/ harness + **四个段目录按被测主体归属**:`core/`(src/core 渲染主题)+ `main/`(主进程层)+ `renderer/`(UI 层)+ `gates/`(门禁树 `gates/**` 与机制层 `shared/**` 的守护段)+ fixtures/ 静态样例数据;样例生成器 `gates/fixtures/gen-fixtures.mjs`、视觉自查 `tools/visual-check.mjs`、electron 桩 `test/common/electron-mock*.mjs`、几何判定层 `shared/geometry/` 均已按归属迁出 test/);`gates/smoke/check-build-fresh.mjs`(构建新鲜度守卫,`start` 与 `test:smoke` 前置)
  - **沙箱副本闭包**(守护见 `test/gates/contract-single-source.test.js` (e) 节,判定原语 `auditCopySet` 在 `test/common/copy-closure-audit.js`):部分段会把生产脚本**逐字节复制**进系统临时区的沙盒再执行(如 `install-smoke` 复制 gates/artifacts 与 gates/smoke 的 5 份脚本、shared/paths.js 与 shared/userdata.js)。因沙盒内无 `node_modules` 且只复制被点名的文件,副本必须满足三条:① 只允许 `node:` 内建依赖(裸包名必失败);② 相对 import 的目标必须**同在副本集合内**;③ 不得有死副本(无同集合入边且未登记为沙盒入口者判红)。副本集合由**代码里的复制调用扫出**(`copyFileSync`/`copyFile`/`cpSync`),不硬编码文件名 —— 新增复制点会被自动纳入。
  - **入口登记需人工同步**:`SANDBOX_ENTRY_EVIDENCE`(同在 `test/common/copy-closure-audit.js`)登记那些「被复制但沙盒内由测试直接执行、因而没有上游 import」的副本。漏登记**判红**而非静默放过(刻意取舍),故新增/删除沙箱复制点时必须同步该表。登记需附「提及它 + 带执行类调用」的行作为证据,否则视为无证据。
  - **已知覆盖边界**:运行时拼装的复制列表、多层别名链、跨目录整树复制**解析不出**,只登记不判红。若将来用「运行时拼装列表」复制 JS 模块,本守护不会自动纳入,需人工扩 `resolveCopySource` 或新增复制机制 scope。
- `tools/`:工具树(七个文件平铺,无子目录;`build/` 与 `dev/` 于 ADR-050 合并而成;`tools-stay-in-tools` 边界规则判它零跨树出边,只许引 `shared/` 与自身):`tools/copy-renderer.mjs`(静态资源拷贝,`build` 步骤)/`tools/svg-to-ico.mjs`(SVG → ICO,`icons` 步骤,读同目录 `icon.svg` 写 `icon.ico`)/`tools/visual-check.mjs`(视觉自查,`ui:shots`)/`tools/visual-preload.cjs` 与 `tools/visual-about-preload.cjs`(上面那个工具的两个窗桩;项目根经 `--m2w-root=` 注入,桩不自算)/`tools/renderer-coverage-report.mjs`(被 c8 排除层的只读覆盖率报告)/`setup-env.ps1`(一次性写 Electron 镜像环境变量)。目录名**不表达**「是否在 CI/release 链内」——该信号在 `package.json` scripts 与上一张「门禁接入点」表两处。

## 测试体系(按内容主题零注册,新增=新建段文件)
- 目录组织标准(段目录**镜像一棵被断言的树**,按被测主体归属;目录内按内容主题命名):`test/core/` = `src/core` 渲染主题段 /`test/main/` = `src/main` 主进程层主题段 /`test/renderer/` = `src/renderer` UI 层主题段(纯函数/状态机/CSS 令牌恒等)/ `test/gates/` = `gates/**` 门禁树与 `shared/**` 机制层的契约/恒等守护段(跨域守护段)
  - **归属判例(跨层段)**:归属看**被测主体**,断言穿过别层不改变归属 —— 被测主体在 `src/main`、core 仅作被断言的接收方时,段归 `test/main/`(例:`test/main/mermaid-warning-channel.test.js` 测 main 侧渲染服务与 converter 接线,core 的 warning 通道是被断言对象)。
  - **同模块多段口径**:同一被测模块可按内容主题拆多段,文件名带主题后缀,不要求一段覆盖模块全部行为(例:`test/main/atomic-json.test.js` 断言落盘/队列/失败清理,`test/main/atomic-json-durability.test.js` 断言 fsync 时点与耐久性)。
  - **段目录须镜像一棵被断言的树**(判据:段目录名必须是顶层某棵树的目录名 —— `core`/`main`/`renderer` 对应 `src/` 的三个子目录,`gates` 对应顶层 `gates/`;`common` `fixtures` `acceptance` 三个 harness/数据区名被显式排除)。这条替代了早先的「三目录恒等」表述:新增被断言的树配同名段目录即可,不必改判据文字;新增杂物抽屉(如 `test/pending/`,历史上真存在过的暂存区,其存废断言由 `test/core/core-resources.test.js` 覆盖)因顶层找不到同名树而判红。判据实现与判红文案在 `shared/test-common-surface.js` 的 `checkSegmentMirrors`,由 `gates/repo/check-test-numbering.mjs` 与 `gates/repo/check-temp-cleanup.mjs` 各自 fail closed;漏登记的测试子目录由同一单源的「扫描面等式」另管,两条各管一件事。
- 静态样例入 `test/fixtures/`,三个子目录**一律按内容命名**:`docs/`(生成器落盘的渲染输入样例文档)+ `input/`(最小输入桩:最小 md 与图像桩)+ `manual/`(人工目检长文档)。**不按「谁生成」或「被谁读」命名** —— 「生成 vs 手工」这个区分由生成器落盘的 README 首行「勿手改」+ `check:fixtures` 漂移门禁表达,不再占一条命名轴;改名见 [ADR-052](adr/ADR-052-夹具区按内容命名并归位输入桩.md)。产物 `output/artifacts` + `output/smoke`(可清理重建,smoke 自清理)
- 断言写可验证事实(解包 OOXML/产物字符串/读回),不写无断言日志;恒等守护段 `test/core/identity-guards.test.js` 锁已知双源(zh 文案/MAX_RECENT_FILES/设置合并双侧/白名单扫描);`test/core/i18n-registry.test.js` 锁语言注册表(en=zh 全量/Partial 键集 ⊆ zh/回退链/htmlLang/settings 往返)。**注意:`ru` 是已裁撤语言,`test/core/i18n-registry.test.js` 拿它当「裁撤回归守卫」的样例(`isLanguage("ru") === false`),回加该语言会撞红这条断言**
- 验收样例生成器:`npm run gen:fixtures`(需先 build)/`npm run check:fixtures` 漂移校验(EOL 归一化,`.gitattributes` 双保险;CI 门禁步骤)

## 验证基线
> **本节是验证基线的单一出处**;`docs/PLAN.md` 的「验证基线」指针只回指本节,不在那里复述命令。（旧的 `docs/large/` 载体已取消,见 [adr-034](adr/ADR-034-文档载体结构定稿.md) 决定 6 —— 不再是本节的回指对象。）

- **验证分两档**(命令与门禁类别见本文件「命令」「门禁接入点」两节,此处只定节奏):
  - **开发回路**(每次改完):`typecheck` + `lint` · 改动面所属的验收段(`M2W_ONLY` 按**段名**筛)· 本轮改动到的纯文本门禁(`check:docs` 等)
  - **提交前**(每个提交跑一次):上面那套 **+ `npm run test` 全量**
- **改动判据 / 门禁本体(含本文件这些指针)当轮就跑全量** —— 该判据见全局配置目录 `WORKFLOW.md` 四(测试);本仓另加一条:**影响面判不出来**(改动落在「命令」节任何一条都覆盖不到的位置)时同样当轮跑,不留到提交前
- **筛段不会静默假通过**:筛选词命中 0 个段即判红(`test/common/runner.js` 的段筛选三态契约),故「只跑受影响段」不存在「筛选词拼错 → 打印全部 0 段通过 → 退出 0」的失效形态
- 全量验收在链内的唯一一次是 `verify:ci` 的 `test:coverage`(见 [adr-016](adr/adr-016-门禁链内全量验收只跑一遍.md)),本条不与它重复;发版前的全套走 `verify:release`,不由本条覆盖
- **谁跑哪一档门禁(子代理跑定向、`verify:ci` 链级由主会话兜底)见全局配置目录 `AGENTS.md` 第八节(并行任务)**;本仓的档位定义在上面「验证分两档」,链的组成见「门禁接入点」表
- 门禁红了怎么办(不得为「看是不是还红」重跑整链、三级定位法)见全局配置目录 `WORKFLOW.md` 四(测试)
- 类型检查与构建通过后再提交;打包/构建类改动必须实际构建验证(提交前置 → 全局配置目录 `WORKFLOW.md`「六、收尾」;发布/打包产物属对外动作 → 全局配置目录 `AGENTS.md` 安全底线 3)
- 类型/构建/门禁命令清单见本文件「命令」节;每条 `npm run *` 的门禁类别与接入点(`verify:ci` 链 / `verify:release` 链 / 仅某个 CI workflow job / 仅本地手动)见本文件「门禁接入点」表
- 验收测试段明细见 `test/core/`、`test/main/`、`test/renderer/` 与 `test/gates/`;恒等守护与边界守护段清单见本文件「测试体系」节
- **跨仓路径这一族没有机器兜底**(撤销旧缓解的理由见 [ADR-056](adr/ADR-056-撤销跨仓死指针的无效缓解.md)):判红基准在仓外,配置仓那份本身不含该判据且不知道下游根在哪,本仓那份则按 ADR-054 决定四**只分类、不判红** ⇒ **双侧的死指针没有判红执行体**。原本这里有一条「手动到全局配置目录跑一遍」的命令,**已删** —— 它跑出来始终是配置仓自己那 26 份,与本仓的跨仓引用无关,跑多少次都是 `exit 0`,它给的是一次假的完成感。平时**看结论行**:输出里那句「跨仓路径未判(分类 N 处 · 判定 0 处)」就是真相 —— 这个绿是**诚实的绿**,不是「查过了」。改跨仓引用后需人工核对那一族指向的是否真实存在。
- `check:docs` —— 指针门禁(`gates/repo/check-docs.mjs` **只是薄包装**,只转出 `main` + 入口守卫;**判定本体是 `gates/repo/check-pointers.mjs`** —— 检查项、R1–R7 台账内不变量、台账表形状与载体形态判据 C1–C6 全部只在该本体维护(拆自全局配置目录那份;**判据从此两份,规则演进要改两处**,对账用的上游基线 commit 记在该文件头));**项目模式探针是 `docs/REQ.md`**,命中后扫描根 md + 整个 `docs/`(`docs/evidence/` 整棵除外);**跨仓路径只分类不判定** —— 判红基准在仓外,本仓够不着,故只分类,并把「分类 N 处 · 判定 0 处 · 未判,非『查过没问题』」推进结论行的「覆盖:不全」;**无环境变量、无模式开关、无 `--root` 参数**(自检靠 `cwd` 指向系统临时目录里现造的合成仓);**在 `verify:ci` 链里**)
- **载体形态判据 C1–C6**:六条判据的内容在本仓 `gates/repo/check-pointers.mjs` 的 `CARRIER_RULES` 维护(拆自全局配置目录那份;**判定归属见 ADR-054 决定二** —— 按「对象在哪」判,本仓对象上的实例归本仓);转判红的决定见全局配置目录 `docs/adr/ADR-005-载体形态判据转判红.md`。**六条已全部转判红**,违反进 `errors`、退出码非零;仍**只出声**的判据 =「是违规吗」而不是「是问题吗」:**零覆盖**(是「没查」不是「查了没问题」)· 列数守卫 C0(错位行不参与判定属解析失败)· 解析盲区自报。⚠️ **「载体不可达」在本仓已不存在** —— 模式判定拆掉后没有第二个仓可不可达,拆前那套「不可达则打印跳过」也不再存在,别再照它排障。输出里带「零覆盖」或「未判」字样的那行是提醒,不是通过
- **台账表格结构判据**(`checkTableShape()`,判据本体在本仓 `gates/repo/check-pointers.mjs`;**只对表头含「号」且含「状态」的表块生效**,故不误伤其它表格与模板骨架):台账表块必须严格是「表头 → 分隔行 → 数据行」三段紧邻 —— ① 表头下一行不是分隔行 ⇒ 判红并点名「数据行被插到了表头与分隔行之间」② 分隔行与首行数据行**原始行号不连号** ⇒ 判红(表内夹了空行,Markdown 在空行处断表,后面的行不再属于本表)③ **空节(只有表头+分隔)判 0 错**,0 行是合法态。**排在 C1/C2 之前跑** —— 表坏时 C1/C2 读到的行列数都是解析器的误读,报出来只会误导;它也**不改 `tableBlocks()` 对空行的宽容**(那条是为免误报,拆掉会让 R4 报「号段缺行」假红),两者刻意解耦。**已知缺口:空行夹在表头与分隔行之间仍判绿**(判据只比「分隔行→首行数据行」,不回看「表头→分隔行」),边界与补法记在那份 ADR-006 的「实测的覆盖边界」表里。形状规则的人读载体是**全局配置目录 `REQ-RULES.md` 的「表形状是硬约束」那条**(单一载体:台账纪律只在全局那一份维护,模板与项目台账都不再存第二份,故按规则名指、不按序号指)(模板只对以后新初始化的项目生效,存量项目靠上面这条判据兜底),决定见全局配置目录 `docs/adr/ADR-006-台账表形状不变量.md`(这两条配置仓路径**不被任何档判存在性** —— 跨仓引用按 ADR-054 决定四**只分类不判定**,分类数会进结论行的「覆盖:不全」,所以门禁不会替你兜,改路径时自己核)
- **负探针清单**(证明载体形态判据真会红而不是恒绿)见全局配置目录 `tools/AGENTS.md` 的「判据的负探针」节 —— **按规则名指、不按序号指**:探针序号范围随增删变动(该节现为 V1–V12),本仓复制某个区间必然漂。本仓自有的载体形态负向夹具在 `gates/repo/check-docs.selftest.mjs`
- `check:archive-index` —— 归档索引与目录实际内容一致性(`docs/evidence/INDEX.md` 须由脚本生成,本门禁逐字节比对,漂移 exit 1)
- `gen:archive-index` —— 新增归档原文后重新生成 `docs/evidence/INDEX.md`(不手工登记行)
- docx/PDF 验收样例固定含中英混排,生成后人工打开检查中文渲染
