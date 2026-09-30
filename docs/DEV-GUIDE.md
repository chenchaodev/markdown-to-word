# 开发者手册

> 本文件是**验证基线的唯一载体**:命令与文件清单是主职责,另附两类本项目特有的内容 —— 改代码时会撞上的**「勿随意偏离」约束**(架构分层与设计口径)与**代码地图**。架构决策的本体在 `docs/adr/`,此处只留会直接影响写码的那几条(未升格为 ADR 的口径也只留在这里,故不逐条转链);踩坑与长分析原文在 `docs/evidence/`。全文不写测试段数 / 覆盖率 / 产物体积 / 文件数 / 行数这类可运行数值 —— 要数字就跑命令(判据:改代码会不会让这个数字变)。

## 环境
- Node >= 22.13(ESM;typescript-eslint 经 side-by-side 用 TS 6 API,`tsc` 二进制仍为 TS 7——package.json 中 `typescript` 别名 `@typescript/typescript6`,`@typescript/native` 别名真实 TS 7;勿回退)
- npm 源:npmmirror(见根 `.npmrc`,仅含 registry,勿回退)
- Electron 二进制镜像(本地开发勿回退,装 electron/打包前设置):经 `scripts/setup-env.ps1` 一次性写入**用户级环境变量** `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR`(GitHub Actions 不需要);勿在 `.npmrc` 写这两个键——npm 不识别会警告,且 `electron_builder_binaries_mirror` 不会被转发成 `ELECTRON_BUILDER_BINARIES_MIRROR`,electron-builder 读不到
  - `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  - `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
- 依赖钉死与全部「勿回退」约束见项目 `AGENTS.md`「硬约束」节;钉死理由清单见 [`evidence/20260927-170600-事实-依赖与工具链.md`](evidence/20260927-170600-事实-依赖与工具链.md) 的「审计整改记录(依赖钉死策略清单)」条
- 本地跑 `npm install` 前先跑一次 `scripts/setup-env.ps1`(写 Electron 镜像环境变量);CI 走官方 registry,不需要该步骤

## 命令
日常主路径的命令(门禁类别与接入点见下一张「门禁接入点」表,`package.json` scripts 为唯一单源):

| 命令 | 用途 |
| ---- | ---- |
| `npm install` | 安装依赖。运行时与构建期依赖(含 `typescript` / `@types/node` / `electron` / `electron-builder`)全在 `dependencies` + `devDependencies`,一次装齐,无「先单独装某几个包」的前置步骤 |
| `npm run typecheck` | TS 类型检查(主树 `tsc --noEmit` + 测试树 `tsconfig.test.json` 按 `// @ts-check` 渐进,TS 7) |
| `npm run lint` | ESLint 10 flat 检查 `src/ test/ scripts/`(typescript-eslint 类型感知规则,side-by-side TS 6 API) |
| `npm run build` | 构建 core 到 `dist/`(`tsc` + copy-renderer) |
| `npm run dev` | 开发启动 = `build` 后**直接**起 Electron,**不带**构建新鲜度守卫 |
| `npm run start` | 启动 Electron,但**先跑 `scripts/check-build-fresh.mjs` 校验构建新鲜度** —— 只改了源码没重建时,守卫先拦下(`test:smoke` 用的是同一个守卫) |
| `npm run dist` | electron-builder 打包 NSIS 安装包(输出 `release/`;链内含产物核对,见「门禁接入点」) |
| `npm run test` | 验收全部测试段(`electron test/acceptance.mjs`,自动发现 `segments/`、`main/` 与 `renderer/` 下 `*.test.js`;需先 build;新增测试=新建段文件零注册) |
| `npm run test:smoke` | 冒烟自测(`electron . --smoke`,前置构建新鲜度守卫) |
| `npm run test:coverage` | c8 覆盖率报告(自动验证的 core/main 产物;GUI renderer 编排层按测试边界排除,renderer 断言仍由 acceptance 执行) |
| `npm run test:all` | 验收 + 冒烟 |
| `npm run gen:fixtures` | 验收样例生成器(需先 build) |
| `npm run check:fixtures` | fixtures 漂移校验(幂等,exit 0/1;CI 门禁步骤) |
| `npm run icons` | SVG 图标转 ICO(`scripts/svg-to-ico.mjs`) |
| `npm run check:docs` | 文档指针门禁(**载体在全局配置目录,CI 不装 ⇒ 不在 `verify:ci` 链里,提交前本地手动跑**;载体不可达时打印「跳过」后 exit 0,看到那行即表示本轮一个指针都没查) |

> 冒烟只有 `npm run test:smoke` 一个入口。绕过 npm 直接 `npx electron . --smoke` 会跳过构建新鲜度守卫、拿旧产物跑,故本文件不列该写法。

## 门禁接入点
> 接入点四取一:`verify:ci` 链 / `verify:release` 链 / 仅某个 CI workflow 的 job / 仅本地手动。链的成员单源于 `package.json` 的 `verify:ci` / `verify:release` / `dist`,workflow 事实单源于 `.github/workflows/ci.yml` 与 `.github/workflows/release.yml`;两者对链组成的断言由 `check:contract` 守护。

| 门禁类别 | 脚本 | 接入点 |
| ---- | ---- | ---- |
| 构建 / 类型 / 风格 | `build` `typecheck` `lint` | `verify:ci` 链 |
| 开发启动 | `dev` `start` | 仅本地手动 |
| 清理生成目录 | `clean:dist` `clean:release` | `verify:release` 链(`dist` 的首步,只删这两个生成目录) |
| 验收测试 | `test` `test:all` | 仅本地手动 —— 链内跑的是带插桩的 `test:coverage`,不在这里再插一遍(裁决见 `docs/adr/adr-016-门禁链内全量验收只跑一遍.md`) |
| 验收样例 | `check:fixtures`(漂移校验) | `verify:ci` 链 |
| 验收样例(重生成) | `gen:fixtures` | 仅本地手动 |
| 覆盖率 | `test:coverage` `check:coverage-zero` | `verify:ci` 链 |
| renderer 覆盖率报告 | `report:coverage-renderer` | 仅本地手动 |
| 冒烟 | `test:smoke` | `verify:ci` 链 |
| 几何 | `check:geometry` | `verify:ci` 链。判据是**结构不变式**而非像素快照（后者会因平台/主题/字体差异假红）：主窗舞台的槽位/视口/响应式档位，**外加设置抽屉的 40 个控件**（存在且可见 · 组归属 · 组内视觉序 · 无水平裁切/越界 · 三种门控形态的收起与灰禁双向）。选择器与控件清单的单源在 `test/tools/geometry/geometry-spec.mjs` |
| 工程契约 / 层向 / 引用固定 / 段编号 / 阶段契约枚举点 | `check:contract` `check:contract:selftest` `check:boundary` `check:pinned-actions` `check:test-numbering` `check:transform-dispatch` | `verify:ci` 链;其中 `check:contract` 与 `check:pinned-actions` 在两个 workflow 里另有 `npm ci` 之前的 fail-fast 步骤(同一入口,非第二份清单)。`check:transform-dispatch` 守的**取反不变量**:渲染层与 main 转换层薄壳不得枚举渲染前变换类设置,且该类设置的枚举点恰 2 处且都在 `core/markdown/`(见 `docs/adr/adr-026` 与 `adr-027`) |
| 归档索引 | `check:archive-index` | `verify:ci` 链 |
| 归档索引(重生成) | `gen:archive-index` | 仅本地手动 |
| 文档指针 | `check:docs` | 仅本地手动 —— 门禁载体在全局配置目录,workflow 不装也不克隆,留在链上等于「以为被查过」 |
| 环境指纹 | `check:env` | 仅 `ci.yml` 主 job 与 `release.yml` 的指纹步骤(不进任何链) |
| 供应链 | `check:supply` | 仅 `ci.yml` 的 `supply-chain` job 与 `release.yml` 的供应链步骤 —— 需联网查 advisory 库,刻意不并入本地链(否则「代码有问题」与「网络抖动」共用一个退出码) |
| 供应链子步骤的独立入口 | `gen:sbom` `check:sbom` `gen:licenses` `check:sca` `collect:license-fulltext`(按需收集许可证全文副本) | 判定入口是 `check:supply`(它 import 同一批模块);这五条是同批模块的独立 CLI 入口,离线部分由 `test/segments/supply-chain.test.js` 在链内覆盖 |
| 包体 | `check:pack-size` | 仅本地手动(需真实安装包实测;判定逻辑由 `test/segments/observability.test.js` 在链内以沙盒覆盖) |
| 冒烟报告 | `check:smoke-report` | 仅本地手动(判定逻辑同上,由 `test/segments/observability.test.js` 在链内覆盖) |
| 阴性探针 | `check:gates` | 仅本地手动 —— 同一模块由 `test/segments/gate-probes.test.js` 在链内实跑 |
| GUI 视觉自查 | `ui:shots` | 仅本地手动(`test/tools/visual-check.mjs`)。**发版前需重跑** —— 它的产出 `output/artifacts/ui-v4/` 是 `docs/images/ui-*.jpg` 的来源,界面一改那批图就过期;README / 官网首页 / 用户指南都靠它们展示 |
| 安装烟测 | `check:install-smoke` | 仅本地手动,默认预演模式零系统副作用;真实装卸须显式 `--execute`(沙盒内的进程级行为由 `test/segments/install-smoke.test.js` 在链内覆盖) |
| 打包产物核对 | `gen:dist-manifest` `check:dist-manifest` `check:asar` `check:release` `check:signature` `check:unpacked-smoke` | `verify:release` 链(`dist` 内部) |
| 图标资源 | `icons` | 仅本地手动 |
| 聚合入口 | `verify:ci` `verify:release` `dist` | 本地手动 + `ci.yml` 主 job(`verify:ci`)/ `release.yml` 的 release job(`verify:release`);`dist` 是后二者内部的打包步 |

## 本地打包注意事项

`npm run dist`(electron-builder NSIS)在本机实测踩到三类坑,根因与完整解法见 [`evidence/20260927-170600-事实-供应链与发布.md`](evidence/20260927-170600-事实-供应链与发布.md) 的「Windows 本地打包踩坑(长路径)」与「G5 打包坑」条:

- **Defender 重命名 EPERM**:electron 解压到 `win-unpacked.tmp` 后被 Windows Defender 实时扫描锁文件句柄,`rename .tmp → win-unpacked` 失败。绕过:用 `--config.electronDist=<node_modules/electron/dist>` 直接喂 npm install 已解压的 electron 发行目录,electron-builder 改为 copy(非解压后 rename)。
- **长路径 / OneDrive 锁**:项目在 `Documents\opencode\...`(OneDrive 同步)时,即便建 junction 也仍解析真实路径写入,重命名同样失败且路径过长。绕过:用 `--config.directories.output=<非 OneDrive 短路径>` 重定向输出(如 `C:\m2w-out`,路径依环境而定)。
- **镜像 env**:`.npmrc` 不写 electron 镜像键(npm 不识别会警告,且 `electron_builder_binaries_mirror` 不会被转发成 `ELECTRON_BUILDER_BINARIES_MIRROR`)。本地开发先跑一次 `scripts/setup-env.ps1` 写入用户级环境变量;或构建前显式 `$env:ELECTRON_BUILDER_BINARIES_MIRROR`(及 `ELECTRON_MIRROR`),否则 electron-builder 回退 GitHub 下载超时。

完整命令示例:

```bash
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run dist -- --config.directories.output=C:\m2w-out --config.electronDist=node_modules\electron\dist
```

**单段筛选**:设 `M2W_ONLY` 环境变量只跑命中的段(逗号分隔子串、大小写不敏感,如 `M2W_ONLY='slug,image-type'`),改一个 handler 不必全量重跑。

> ⚠️ **测试对象是 dist 非 src**:验收/smoke 跑的是 `dist/` 编译产物。绕过 npm 直接 `electron test/acceptance.mjs` 会静默测旧产物无任何提示——改动后务必经 `npm run build` 或 `npm run test`(自带 build),或经带新鲜度守卫的 `npm run test:smoke` / `npm run start`。

## 架构(设计决策,勿随意偏离)
- 分层:转换核心 `src/core/` 纯逻辑、常态零 IO 可测试(fs 访问仅 `pipeline/precheck.ts` 的 exists 与 `pdf/katex-css.ts` 的 read 两处,均依赖注入、默认 `node:fs`,可整体替换);GUI 主进程 `src/main/`;UI `src/renderer/`(vanilla TS + 原生 DOM,不引前端框架);依赖方向单向 core←main←renderer 不反向
- **转换在主进程执行**(docx 库为 Node 原生;printToPDF 走系统字体,中文零配置);renderer 经 IPC 触发
- IPC:channel 名单源 `main/ipc/channels.ts`;`contextIsolation` + preload 白名单 + 进度 `webContents.send` 推送;拖放取路径用 `webUtils.getPathForFile`(File.path 已移除)
- 未来扩展格式只需在 `core/convert.ts` 注册表登记 renderer
- 中文/字体策略:docx 走 `docx/theme.ts` 集中配置 `font: { ascii: 'Calibri', eastAsia: '微软雅黑', hAnsi: 'Calibri' }`(Normal 样式,程序内可覆盖,宋体作备选配置项);pdf 走 Windows 系统字体零配置(Linux 部署需 CSS @font-face 内嵌 noto-cjk,后置)
- 标题编号计数单源:`core/markdown/heading-numbering.ts` 共享纯函数(docx prescan 与 pdf xref 共用;无 h1 文档章节引用统一 Word 口径「1」,CSS counter 同口径)
- 双管线的语义色与高亮色板各有一处单源(`core/style/colors.ts` 与 `core/style/hljs-palette.ts`),两侧渲染模块只从那里取值
- 决策本体与其背景/备选方案在 `docs/adr/`(一决策一文件,`ls docs/adr/` 取下一个序号);上面几条是**写码时会撞上**的那几条,不是决策记录

## 代码地图
> 骨架以实际目录树为准;括注是**职责一句**,不是「本目录只有这些文件」的保证 —— 新增文件时顺手补一行。

- `src/core/` 纯转换逻辑,常态零 IO(仅预检 exists / `loadKatexCss` read 两处 fs 访问经依赖注入),可测试
  - 根:`convert.ts`(格式注册表 + `convert(md, format, options)` 统一入口;pdf 分支不构建 remark AST;页面设置/ConvertFormat 契约单源在 settings-defaults,不在此转手)/`ipc-contract.ts`(跨进程契约类型单源:ConvertProgressPayload/ConvertMode、BatchItem/BatchProgressInfo/BatchResult、UiState/RecentFile 等纯数据形状;main 实现侧与 renderer 共同 import,type-only 编译期擦除)/`cancel.ts`(取消错误码与 CancellationGuard 契约单源,降级通道不得吞取消)/`resource-limits.ts`(公式与图片资源预算单源,docx/pdf 共用)/`preload-api.ts`(preload 暴露面类型单源,归 core 以消除 renderer→main 反向依赖)
  - `pipeline/`:parse.ts(remark→mdast)/frontmatter.ts(YAML 手写解析)/merge.ts(多文件合并)/precheck.ts(转换前预检)
  - `markdown/`:slug.ts/cross-ref.ts(交叉引用契约正则族单源)/heading-numbering.ts(标题编号计数共享纯函数)/html-whitelist.ts(行内 HTML 白名单 docx/pdf 单源)/comment.ts(批注语法 remark 插件)/mermaid.ts/ai-cleanup.ts(AI 输出清理)/obsidian.ts(Obsidian 双链兼容)/image-size.ts(图片尺寸属性解析)/image-path-policy.ts(本地图片可信路径边界策略单源)/table-width.ts(表格列宽信号解析)
  - `image/`:image-resolver.ts(类型+optional exists)/image-type.ts(魔数嗅探)/image-warning.ts(警告工厂)
  - `settings/`:settings-defaults.ts(默认值+页面几何 PAPER_SIZES_MM/mmToTwips+ConvertFormat 单源)/presets.ts(内置预设目录:排版+页面+完整交付链的快照)/typography.ts
  - `style/`:colors.ts(双管线语义色单源)/hljs-palette.ts(GitHub Light 高亮色板单源)
  - `util/`:encoding.ts(编码预检)/mdast-utils.ts/error-message.ts(Error→message 归一单源)/text-escape.ts(escapeHtml/decodeEntities/escapeRegExp 集中)
  - `i18n.ts` + `i18n/`:逻辑层(t() 插值/applyStaticTexts/KeyedWarning)+ 注册表(`i18n/index.ts` 导出面,`zh.ts` 键集唯一事实源 / `en.ts` 全量 satisfies / `ja.ts` 等其余语言 Partial 回退链 当前语言→en→key;Language 类型从注册表派生)
  - `docx/`:render.ts(编排器)/theme.ts(字体集中配置,eastAsia 勿散落硬编码)/ctx.ts(渲染上下文,选项构造时解析默认)/headers.ts(section 页眉装配)/chrome.ts(封面/目录/页眉页脚)/prescan.ts/numbering.ts(编号配置)/template-import.ts(模板浅导入,零 IO)/handlers/(节点处理器:heading/table/captions/equations/code-block/code-highlight/image-run/link-xref/inline-html/fallback/content/math/bookmark)
  - `pdf/`:render.ts(编排器)/template.ts(HTML 组装+页眉页脚 chrome+CSP/sanitize 防护)/template-css.ts(文档模板 CSS 生成)/katex-css.ts(KaTeX CSS 加载,唯一 fs 注入点)/postprocess.ts/metadata.ts/bookmarks.ts(pdf-lib 书签注入)/mermaid.ts/rules/(markdown-it 规则覆盖:caption/equation/xref/html/image/table/heading-id/shared)
- `src/main/`:Electron 主进程
  - `index.ts`:组合根;`menu.ts`:应用菜单;`smoke.ts`:**冒烟唯一实现**(编译进 `dist/main/smoke.js` 随包分发,故解包产物也能跑 `--smoke`;`test/tools/smoke/smoke.mjs` 仅为 dev 侧薄转调,勿在两处各写一份)
  - `windows/`:main-window.ts/preview.ts(预览窗+尺寸记忆)/title-bar-overlay.ts(Windows 标题栏 overlay 配色与高度常量单源)/web-contents-registry.ts(ctxByWebContents 注册表,窗口层不反向依赖 IPC 层)
  - `ipc/`:channels.ts(channel 名单源+恒等测试守护)/register.ts(handler 注册,导入类 handler 走 importFileViaDialog 模板)/logic.ts(纯逻辑)/output-allowlist.ts(shell 打开产物的会话级白名单,renderer 触达宿主文件系统的唯一入口)/types.ts(只做 re-export,剪贴板契约声明在 `core/ipc-contract.ts`)
  - `converter/`:index.ts(编排)/single.ts(参数校验+读取 md,渲染之后交给骨架)/output-skeleton.ts(单文件与合并共用的输出骨架 `emitConvertedArtifact`,含 `renderPdf`/`runAfterConvert`;同模块是为避免 single↔skeleton 成环)/batch.ts/merge.ts/paths.ts(扩展名判定单源)/context.ts(buildConvertContext)/preprocess.ts(解码→frontmatter 隔离→Obsidian/AI 预处理→原样拼回,所有入口共用的准备编排)/artifact-writer.ts(产物提交:同目录唯一临时文件 + 硬链接独占提交,单文件/批量/合并共用)
  - `persist/`:settings.ts/ui-state.ts/atomic-json.ts(原子写)/preset-file.ts(设置与预设文件的纯形状校验 + 预设解析/合并)
  - `services/`:image-downloader.ts(外链下载:私网拦截+20MB 上限,`allowPrivateAddresses` 可放宽)/mermaid-service.ts/temp-html.ts(randomUUID+'wx')/resource-dirs.ts/web-hardening.ts(窗口导航加固)/session-permissions.ts(session 权限默认拒绝收口)
  - `preload.cts`:contextBridge 白名单暴露 `window.api`(编译为 CJS;暴露面类型取 `core/preload-api.ts`)
- `src/renderer/`:GUI UI(vanilla TS + 原生 DOM)
  - `index.html` + `style/`(base/drop/settings/dialogs 四文件)/`lang-bootstrap.js`(FOUC 缓解)
  - 关于窗:`about.html`/`about.ts`/`about-preload.cjs`
  - `renderer.ts`:组合根;`dom/refs.ts`:DOM 引用
  - `state/`:pure.ts(纯函数含 errorMessage()/STAGE_TEXT)/state.ts(批量契约类型自 main 单源导入 + renderer 唯一 store)
  - `settings/`:settings-controls-table.ts(**设置声明表**:键→控件→读/写→复位处置→依赖登记,零 DOM 纯数据,回显类型由它从 `AppSettings` 派生)/settings-panel.ts(加载/回填/持久化写回+分组 persist 单源;`controlDom` 是声明表↔DOM 的唯一接缝)/settings-save.ts(写路径单源 + 跨模块共享的失败重试台账)/settings-preset-actions.ts(预设弹窗/保存/删除/导入导出)/settings-logic.ts(纯函数直测)/settings-drawer.ts + `settings-bindings.ts` 与 `settings-bindings-{preset,typography,headerwatermark,numbering,convert,app}.ts`(按 `index.html` 的 `data-group` 同口径接线,控件 id/name 零触碰)
  - `convert/`:convert-flow.ts + `events/`(convert-actions/dialogs-events/drop/selection/index 组合)+ `file-list.ts`
  - `ui/`(dialogs.ts/dom-ops.ts(DOM 操作原语 + translate 注入适配)/recent-files.ts(bindRecentFilesEvents 范式)/toast.ts/first-run-guide.ts(首启引导))
  - `wizard/`:book-wizard.ts(向导外壳/导航/打开关闭+付印提交)/wizard-steps.ts(步骤渲染·版式步:模板/封面/页眉页脚/水印)/wizard-steps-delivery.ts(步骤渲染·交付步:合并源/目录/付印+当前步渲染)/wizard-fields.ts(字段校验绑定+共用 DOM/radio 零件)/wizard-runtime.ts(草稿/容器/步序单例,防环)/wizard-state.ts(向导状态管理纯 reducer)
- `test/`:验收测试体系(acceptance.mjs 入口 + common/ 工具 + segments/(core 渲染与跨域守护)+ main/(主进程层)+ renderer/(UI 层)按内容主题的测试段 + fixtures/ 静态样例数据 + tools/(gen-fixtures.mjs 样例生成 / visual-check.mjs 视觉自查 / electron-mock*.mjs 桩 / geometry/ / smoke/ 薄转调,冒烟实现见 `src/main/smoke.ts`));`scripts/copy-renderer.mjs`(静态资源拷贝)、`scripts/svg-to-ico.mjs`(图标)、`scripts/check-build-fresh.mjs`(构建新鲜度守卫,`start` 与 `test:smoke` 前置)
  - **沙箱副本闭包**(守护见 `test/segments/contract-single-source.test.js` (e) 节,判定原语 `auditCopySet` 在 `test/common/copy-closure-audit.js`):部分段会把生产脚本**逐字节复制**进系统临时区的沙盒再执行(如 `install-smoke` 复制 scripts/** 与 `test/common/userdata.js`)。因沙盒内无 `node_modules` 且只复制被点名的文件,副本必须满足三条:① 只允许 `node:` 内建依赖(裸包名必失败);② 相对 import 的目标必须**同在副本集合内**;③ 不得有死副本(无同集合入边且未登记为沙盒入口者判红)。副本集合由**代码里的复制调用扫出**(`copyFileSync`/`copyFile`/`cpSync`),不硬编码文件名 —— 新增复制点会被自动纳入。
  - **入口登记需人工同步**:`SANDBOX_ENTRY_EVIDENCE`(同在 `test/common/copy-closure-audit.js`)登记那些「被复制但沙盒内由测试直接执行、因而没有上游 import」的副本。漏登记**判红**而非静默放过(刻意取舍),故新增/删除沙箱复制点时必须同步该表。登记需附「提及它 + 带执行类调用」的行作为证据,否则视为无证据。
  - **已知覆盖边界**:运行时拼装的复制列表、多层别名链、跨目录整树复制**解析不出**,只登记不判红。若将来用「运行时拼装列表」复制 JS 模块,本守护不会自动纳入,需人工扩 `resolveCopySource` 或新增复制机制 scope。

## 测试体系(按内容主题零注册,新增=新建段文件)
- 目录组织标准(test 树镜像 src 三层,按被测主体归属;目录内按内容主题命名):`test/segments/` = core 渲染主题与跨层契约/恒等守护段 /`test/main/` = 主进程层主题段 /`test/renderer/` = UI 层主题段(纯函数/状态机/CSS 令牌恒等)
  - **归属判例(跨层段)**:归属看**被测主体**,断言穿过别层不改变归属 —— 被测主体在 `src/main`、core 仅作被断言的接收方时,段归 `test/main/`(例:`test/main/mermaid-warning-channel.test.js` 测 main 侧渲染服务与 converter 接线,core 的 warning 通道是被断言对象)。
  - **同模块多段口径**:同一被测模块可按内容主题拆多段,文件名带主题后缀,不要求一段覆盖模块全部行为(例:`test/main/atomic-json.test.js` 断言落盘/队列/失败清理,`test/main/atomic-json-durability.test.js` 断言 fsync 时点与耐久性)。
  - **段目录以三目录为全集**,`test/` 下无第四个段目录(原 `test/pending/` 暂存区已删除,其断言由 `test/segments/core-resources.test.js` 覆盖;三目录恒等这条口径的判据与该目录的存废记在 `scripts/check-test-numbering.mjs` 头注)。新增段一律进三目录之一,勿另开暂存区 —— 另开就会出现「三目录恒等」与实际并存的误读。
- 静态样例入 `test/fixtures/`(acceptance/ 生成 + manual/ 手工);产物 `output/artifacts` + `output/smoke`(可清理重建,smoke 自清理)
- 断言写可验证事实(解包 OOXML/产物字符串/读回),不写无断言日志;恒等守护段 `identity-guards.test.js` 锁已知双源(zh 文案/MAX_RECENT_FILES/设置合并双侧/白名单扫描);`i18n-registry.test.js` 锁语言注册表(en=zh 全量/Partial 键集 ⊆ zh/回退链/htmlLang/settings 往返)。**注意:`ru` 是已裁撤语言,`i18n-registry.test.js` 拿它当「裁撤回归守卫」的样例(`isLanguage("ru") === false`),回加该语言会撞红这条断言**
- 验收样例生成器:`npm run gen:fixtures`(需先 build)/`npm run check:fixtures` 漂移校验(EOL 归一化,`.gitattributes` 双保险;CI 门禁步骤)

## 验证基线
> **本节是验证基线的单一出处**;`docs/PLAN.md` 与 `docs/large/NN-短标题.md` 的「验证基线」指针只回指本节,不在那里复述命令。

- **验证分两档**(命令与门禁类别见本文件「命令」「门禁接入点」两节,此处只定节奏):
  - **开发回路**(每次改完):`typecheck` + `lint` · 改动面所属的验收段(`M2W_ONLY` 按**段名**筛)· 本轮改动到的纯文本门禁(`check:docs` 等)
  - **提交前**(每个提交跑一次):上面那套 **+ `npm run test` 全量**
- **开发回路不得省全量的两种情形**:① 动了共享测试设施(`test/common/**` · `test/tools/**` · `scripts/**` · 门禁脚本 · `package.json`)—— 跨段污染只有全量暴露 ② 影响面判不出来(改动落在「命令」节任何一条都覆盖不到的位置)—— 此时当轮就跑,不留到提交前
- **筛段不会静默假通过**:筛选词命中 0 个段即判红(`test/common/runner.js` 的段筛选三态契约),故「只跑受影响段」不存在「筛选词拼错 → 打印全部 0 段通过 → 退出 0」的失效形态
- 全量验收在链内的唯一一次是 `verify:ci` 的 `test:coverage`(见 [adr-016](adr/adr-016-门禁链内全量验收只跑一遍.md)),本条不与它重复;发版前的全套走 `verify:release`,不由本条覆盖
- 类型检查与构建通过后再提交;打包/构建类改动必须实际构建验证(提交前置 → 全局配置目录 `WORKFLOW.md`「六、收尾」;发布/打包产物属对外动作 → 全局配置目录 `AGENTS.md` 安全底线 3)
- 类型/构建/门禁命令清单见本文件「命令」节;每条 `npm run *` 的门禁类别与接入点(`verify:ci` 链 / `verify:release` 链 / 仅某个 CI workflow job / 仅本地手动)见本文件「门禁接入点」表
- 验收测试段明细见 `test/segments/`、`test/main/` 与 `test/renderer/`;恒等守护与边界守护段清单见本文件「测试体系」节
- `check:docs` —— 指针门禁(`scripts/check-docs.mjs` 薄包装,调全局配置目录的 `tools/check-pointers.mjs`,项目侧不持有第二份逻辑;**项目模式探针是 `docs/REQ.md`**,命中后扫描根 md + 整个 `docs/`(`docs/evidence/` 整棵除外);检查项 = 存在性 / 小节名 / 无引号小节 / 遗留文档名 + **载体形态判据 C1–C6**;门禁路径取 `M2W_GLOBAL_CONFIG`(配置仓根目录)或默认 `~/.config/opencode`;载体不可达时打印一行提示后 exit 0,**故 CI 上的跳过是预期行为** —— workflow 不装也不克隆配置仓;**不在 `verify:ci` 链里**,提交前本地手动跑)
- **载体形态判据 C1–C6**(判据本体在配置仓 `tools/check-pointers.mjs`,本仓只承接不复制;C# 与迁移计划 §1.5 的 R8/L1/G3/G4/G5/G7 一一对应):C1 `REQ.md` 标题列 ≤20 字 · C2 判断依据列 ≤200 字(`已完成` 行 ≤100)· C3 `LESSONS.md` 单条 ≤100 字且总条数 ≤30、空主题节不留 · C4 `adr/` 背景行非空 · C5 `evidence/` 头部「结论去向」四选一(`升 adr/ADR-0NN` 可带真实序号 / `落 REQ.md 行` / `落 LESSONS.md` / `未升`)· C6 上述去向与真实载体的**双向对账**。**当前全部落「只出声不判红」区**,各带写在常量里的转判红条件(条件形如「台账内全部可判定数据行的标题列清零超限后转判红」)—— 存量清零前它们**不提供保护**,输出里那行「只出声不判红」是提醒不是通过
- **V1–V7 负探针**(判据转判红前必跑,证明它们真会红而不是恒绿):V1 造 21 字标题判红 / 20 字判绿 · V2 造 201 字判断依据判红 · V3 `LESSONS.md` 第 31 条、单条 101 字、空主题节各判红一次 · V4 删一份 ADR 的背景行判红 · V5 删一份 `evidence/` 头部判红 · V6 存量清空后本门禁仍全绿 · V7 **删掉 `REQ.md` 一条非终态行的「为什么停在这」判红**(证明不是只有长度门禁)
- `check:archive-index` —— 归档索引与目录实际内容一致性(`docs/evidence/INDEX.md` 须由脚本生成,本门禁逐字节比对,漂移 exit 1)
- `gen:archive-index` —— 新增归档原文后重新生成 `docs/evidence/INDEX.md`(不手工登记行)
- docx/PDF 验收样例固定含中英混排,生成后人工打开检查中文渲染
