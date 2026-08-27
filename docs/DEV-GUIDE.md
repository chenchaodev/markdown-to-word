# 开发者手册

## 环境
- Node >= 20.19(ESM;typescript-eslint 经 side-by-side 用 TS 6 API,`tsc` 二进制仍为 TS 7——package.json 中 `typescript` 别名 `@typescript/typescript6`,`@typescript/native` 别名真实 TS 7;勿回退)
- npm 源:npmmirror(见根 `.npmrc`,勿回退)
- Electron 二进制镜像(勿回退,装 electron/打包前设置):
  - `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  - `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
- 依赖钉死与全部「勿回退」约束见项目 `AGENTS.md`「硬约束」节;钉死理由清单见 `docs/RESEARCH.md`「依赖钉死策略」

## 命令
| 命令 | 用途 |
| ---- | ---- |
| `npm install` | 安装依赖(首次先 `npm install -D typescript @types/node`,Electron 单独装并设镜像) |
| `npm run typecheck` | TS 类型检查(`tsc --noEmit`,TS 7) |
| `npm run lint` | ESLint 10 flat 检查 `src/ test/ scripts/`(typescript-eslint 类型感知规则,side-by-side TS 6 API) |
| `npm run build` | 构建 core 到 `dist/`(`tsc` + copy-renderer) |
| `npm run dev` | 启动 Electron 开发(自带构建新鲜度守卫) |
| `npx electron . --smoke` | 冒烟自测(启动 + convert 链路,自清理产物) |
| `npm run dist` | electron-builder 打包 NSIS 安装包(输出 `release/`) |
| `npm run test` | 验收全部测试段(`electron test/acceptance.mjs`,自动发现 `segments/` 与 `main/` 下 `*.test.js`;需先 build;新增测试=新建段文件零注册) |
| `npm run test:smoke` | 冒烟自测(`electron . --smoke`,前置构建新鲜度守卫) |
| `npm run test:coverage` | c8 覆盖率报告(主进程 V8 coverage + sourceMap 映射) |
| `npm run test:all` | 验收 + 冒烟 |
| `npm run gen:fixtures` | 验收样例生成器(需先 build) |
| `npm run check:fixtures` | fixtures 漂移校验(幂等,exit 0/1;CI 门禁步骤) |
| `npm run icons` | SVG 图标转 ICO(`scripts/svg-to-ico.mjs`) |

## 本地打包注意事项

`npm run dist`(electron-builder NSIS)在本机实测踩到三类坑,根因与完整解法见 `docs/RESEARCH.md`「Windows 本地打包踩坑」:

- **Defender 重命名 EPERM**:electron 解压到 `win-unpacked.tmp` 后被 Windows Defender 实时扫描锁文件句柄,`rename .tmp → win-unpacked` 失败。绕过:用 `--config.electronDist=<node_modules/electron/dist>` 直接喂 npm install 已解压的 electron 发行目录,electron-builder 改为 copy(非解压后 rename)。
- **长路径 / OneDrive 锁**:项目在 `Documents\opencode\...`(OneDrive 同步)时,即便建 junction 也仍解析真实路径写入,重命名同样失败且路径过长。绕过:用 `--config.directories.output=<非 OneDrive 短路径>` 重定向输出(如 `C:\m2w-out`,路径依环境而定)。
- **镜像 env 未转发**:`.npmrc` 的 `electron_builder_binaries_mirror` 仅是 npm 配置键,electron-builder 读不到,须显式 `ELECTRON_BUILDER_BINARIES_MIRROR`(及 `ELECTRON_MIRROR`)环境变量再构建,否则回退 GitHub 下载超时。

完整命令示例:

```bash
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run dist -- --config.directories.output=C:\m2w-out --config.electronDist=node_modules\electron\dist
```

**单段筛选**:设 `M2W_ONLY` 环境变量只跑命中的段(逗号分隔子串、大小写不敏感,如 `M2W_ONLY='slug,image-type'`),改一个 handler 不必全量重跑。

> ⚠️ **测试对象是 dist 非 src**:验收/smoke 跑的是 `dist/` 编译产物。绕过 npm 直接 `electron test/acceptance.mjs` 会静默测旧产物无任何提示——改动后务必经 `npm run build` 或 `npm run test`(自带 build)。

## 架构(设计决策,勿随意偏离)
- 分层:转换核心 `src/core/` 纯逻辑无 IO 可测试;GUI 主进程 `src/main/`;UI `src/renderer/`(vanilla TS + 原生 DOM,不引前端框架);依赖方向单向 core←main←renderer 不反向
- **转换在主进程执行**(docx 库为 Node 原生;printToPDF 走系统字体,中文零配置);renderer 经 IPC 触发
- IPC:channel 名单源 `main/ipc/channels.ts`;`contextIsolation` + preload 白名单 + 进度 `webContents.send` 推送;拖放取路径用 `webUtils.getPathForFile`(File.path 已移除)
- 未来扩展格式只需在 convert.ts 注册表登记 renderer
- 中文/字体策略:docx 走 `docx/theme.ts` 集中配置 `font: { ascii: 'Calibri', eastAsia: '微软雅黑', hAnsi: 'Calibri' }`(Normal 样式,程序内可覆盖,宋体作备选配置项);pdf 走 Windows 系统字体零配置(Linux 部署需 CSS @font-face 内嵌 noto-cjk,后置)
- 标题编号计数单源:`core/markdown/heading-numbering.ts` 共享纯函数(docx prescan 与 pdf xref 共用;无 h1 文档章节引用统一 Word 口径「1」,CSS counter 同口径)

## 代码地图
- `src/core/` 纯转换逻辑,无 IO,可测试
  - `convert.ts`:格式注册表 + `convert(md, format, options)` 统一入口(pdf 分支不构建 remark AST)
  - `pipeline/`:`parse.ts`(remark→mdast)/`frontmatter.ts`(YAML 手写解析)/`merge.ts`(多文件合并)
  - `markdown/`:`slug.ts`/`cross-ref.ts`(交叉引用契约正则族单源)/`heading-numbering.ts`(标题编号计数共享纯函数)/`html-whitelist.ts`(行内 HTML 白名单 docx/pdf 单源)/`comment.ts`(批注语法 remark 插件)/`mermaid.ts`
  - `image/`:`image-resolver.ts`(类型+optional exists)/`image-type.ts`(魔数嗅探)/`image-warning.ts`(警告工厂)
  - `settings/`:`settings-defaults.ts`(默认值+页面几何 PAPER_SIZES_MM/mmToTwips+ConvertFormat 单源)/`typography.ts`
  - `util/`:`encoding.ts`(编码预检)/`mdast-utils.ts`/`utils.ts`
  - `i18n.ts` + `i18n/`:逻辑层(t() 插值/applyStaticTexts/KeyedWarning)+ 字典注册表(`zh.ts` 键集唯一事实源 / `en.ts` 全量 satisfies / 其余语言 Partial 回退链 当前语言→en→key;Language 类型从注册表派生)
  - `docx/`:`render.ts`(编排器 ~256 行)/`theme.ts`(字体集中配置,eastAsia 勿散落硬编码)/`ctx.ts`(渲染上下文,选项构造时解析默认)/`prescan.ts`/`chrome.ts`(封面/目录/页眉页脚)/`numbering.ts`(编号配置)/`handlers/`(13 个节点处理器:heading/table/captions/equations/code-block/code-highlight/image-run/link-xref/inline-html/fallback/content/math/bookmark)
  - `pdf/`:`render.ts`(编排器)/`template.ts`(HTML 模板)/`postprocess.ts`/`metadata.ts`/`bookmarks.ts`(pdf-lib 书签注入)/`mermaid.ts`/`rules/`(markdown-it 规则覆盖:caption/equation/xref/html/image/heading-id/shared)
- `src/main/`:Electron 主进程
  - `index.ts`:组合根(~74 行);`menu.ts`:应用菜单
  - `windows/`:`main-window.ts`/`preview.ts`(预览窗+尺寸记忆)/`web-contents-registry.ts`(ctxByWebContents 注册表,窗口层不反向依赖 IPC 层)
  - `ipc/`:`channels.ts`(channel 名单源+恒等测试守护)/`register.ts`(handler 注册,导入类 handler 走 importFileViaDialog 模板)/`logic.ts`(纯逻辑)
  - `converter/`:`index.ts`(编排)/`single.ts`/`batch.ts`/`merge.ts`/`paths.ts`(扩展名判定单源)/`context.ts`(buildConvertContext)
  - `persist/`:`settings.ts`/`ui-state.ts`/`atomic-json.ts`(原子写)
  - `services/`:`image-downloader.ts`(外链下载:私网拦截+20MB 上限,`allowPrivateAddresses` 可放宽)/`mermaid-service.ts`/`temp-html.ts`(randomUUID+'wx')/`resource-dirs.ts`/`web-hardening.ts`(窗口导航加固)
  - `preload.cts`:contextBridge 白名单暴露 `window.api`(编译为 CJS;`PreloadApi` 类型导出供 renderer 推导)
- `src/renderer/`:GUI UI(vanilla TS + 原生 DOM,六功能域)
  - `index.html` / `style/`(base/drop/settings/dialogs 四文件)/`lang-bootstrap.js`(FOUC 缓解)
  - `renderer.ts`:组合根;`dom/refs.ts`:DOM 引用
  - `state/`:`pure.ts`(纯函数含 errorMessage()/STAGE_TEXT)/`state.ts`(批量契约类型自 main 单源导入)/`utils.ts`(translate 适配器衔接 I18nKey)
  - `settings/`:`settings-panel.ts`/`settings-bindings.ts`/`settings-logic.ts`(纯函数直测)
  - `convert/`:`convert-flow.ts` + `events/`(convert-actions/dialogs-events/drop/selection/index 组合)
  - `file-list.ts`/`ui/`(`dialogs.ts`/`recent-files.ts`,bindRecentFilesEvents 范式)
- `test/`:验收测试体系(acceptance.mjs 入口 + common/ 工具 + segments/(core 渲染与纯逻辑)+ main/(主进程层)按内容主题的测试段 + fixtures/ 静态样例数据 + tools/gen-fixtures.mjs 与 smoke/);`scripts/copy-renderer.mjs`(静态资源拷贝)、`scripts/svg-to-ico.mjs`(图标)、`scripts/check-build-fresh.mjs`(构建新鲜度守卫)

## 测试体系(按内容主题零注册,新增=新建段文件)
- 目录组织标准(三种并存,均为合法):`test/segments/` 按内容主题(core 渲染与跨域纯逻辑)/`test/main/` 按主进程层;「零 Electron API 纯逻辑」段也可住 segments/
- 静态样例入 `test/fixtures/`(acceptance/ 生成 + manual/ 手工);产物 `output/artifacts` + `output/smoke`(可清理重建,smoke 自清理)
- 断言写可验证事实(解包 OOXML/产物字符串/读回),不写无断言日志;恒等守护段 `identity-guards.test.js` 锁已知双源(zh 文案/MAX_RECENT_FILES/设置合并双侧/白名单扫描);`i18n-registry.test.js` 锁语言注册表(en=zh 全量/Partial 键集 ⊆ zh/回退链/htmlLang/settings 往返)。**注意:`i18n/ru.ts` 刻意缺失 `warn.katexCssLoadFailed` 一键作为回退链测试夹具,补译须同步改测试**
- 验收样例生成器:`npm run gen:fixtures`(需先 build)/`npm run check:fixtures` 漂移校验(EOL 归一化,`.gitattributes` 双保险;CI 门禁步骤)

## 验证方式
- 类型检查与构建通过后再提交;打包/构建类改动必须实际构建验证(全局铁律 3)
- 验证基线(命令、断言、打包验证链)见 `docs/STATUS.md`「验证基线」;验收测试段明细见 `test/segments/` 与 `test/main/`
- docx/PDF 验收样例固定含中英混排,生成后人工打开检查中文渲染
