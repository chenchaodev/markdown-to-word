# 开发者手册

## 环境
- Node >= 20.19(ESM;typescript-eslint 经 side-by-side 用 TS 6 API,`tsc` 二进制仍为 TS 7——package.json 中 `typescript` 别名 `@typescript/typescript6`,`@typescript/native` 别名真实 TS 7;勿回退)
- npm 源:npmmirror(见根 `.npmrc`,勿回退)
- Electron 二进制镜像(勿回退,装 electron/打包前设置):
  - `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  - `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
- 依赖钉死与全部「勿回退」约束见项目 `AGENTS.md`「硬约束」节

## 命令
| 命令 | 用途 |
| ---- | ---- |
| `npm install` | 安装依赖(首次先 `npm install -D typescript @types/node`,Electron 单独装并设镜像) |
| `npm run typecheck` | TS 类型检查(`tsc --noEmit`,TS 7) |
| `npm run lint` | ESLint 10 flat 检查 `src/`(typescript-eslint 类型感知规则,side-by-side TS 6 API) |
| `npm run build` | 构建 core 到 `dist/`(`tsc` + copy-renderer) |
| `npm run dev` | 启动 Electron 开发 |
| `npx electron . --smoke` | 冒烟自测(启动 + convert 链路,自清理产物) |
| `npm run dist` | electron-builder 打包 NSIS 安装包(G5) |
| `npm run test` | 验收全部测试段(`electron test/acceptance.mjs`,自动发现 `segments/` 与 `main/` 下 `*.test.js`;需先 build;新增测试=新建段文件零注册) |
| `npm run test:smoke` | 冒烟自测(`electron . --smoke`) |
| `npm run test:coverage` | c8 覆盖率报告(主进程 V8 coverage + sourceMap 映射;全量测试后输出,2026-08-14 实测 main 97% / core/docx 93% / core/pdf 95% / renderer 100%) |
| `npm run test:all` | 验收 + 冒烟 |

## 架构(设计决策,勿随意偏离)
- 分层:转换核心 `src/core/` 纯逻辑无 IO 可测试;GUI 主进程 `src/main/`;UI `src/renderer/`(vanilla TS + 原生 DOM,不引前端框架)
- **转换在主进程执行**(docx 库为 Node 原生;printToPDF 走系统字体,中文零配置);renderer 经 IPC 触发
- IPC:`contextIsolation` + preload 白名单 `invoke('convert', ...)` + 进度 `webContents.send` 推送;拖放取路径用 `webUtils.getPathForFile`(File.path 已移除)
- 未来扩展格式只需在 convert.ts 注册表登记 renderer
- 中文/字体策略:docx 走 `docx/theme.ts` 集中配置 `font: { ascii: 'Calibri', eastAsia: '微软雅黑', hAnsi: 'Calibri' }`(Normal 样式,程序内可覆盖,宋体作备选配置项);pdf 走 Windows 系统字体零配置(Linux 部署需 CSS @font-face 内嵌 noto-cjk,后置)

## 代码地图
- `src/core/` 纯转换逻辑,无 IO,可测试
  - `parse.ts`:remark + remark-gfm → mdast AST(标题 id 注入)
  - `convert.ts`:格式注册表 + `convert(md, format, options)` 统一入口(读→解析→渲染→落盘流程编排)
  - `frontmatter.ts`:YAML frontmatter 手写解析(零依赖)
  - `encoding.ts`:编码预检(UTF-8 fatal 判定 + BOM 嗅探 + gb18030 兜底)
  - `slug.ts`:标题 slug/id 生成;`typography.ts`:排版参数;`merge.ts`:多文件合并
  - `docx/theme.ts`:字体/样式集中配置(eastAsia 中文,勿散落硬编码)
  - `docx/render.ts`:AST → docx(标题/段落/列表/表格/代码块/引用/图片/行内样式/编号/TOC/脚注/公式)
  - `docx/math.ts`:MathML → docx Math 组件树(walker)
  - `pdf/render.ts`:markdown-it → HTML 模板 → printToPDF;`pdf/metadata.ts`:元数据注入;`pdf/bookmarks.ts`:书签大纲注入(pdf-lib)
- `src/main/`:Electron 主进程
  - `index.ts`:窗口创建、dialog 选择文件、`convert` IPC(convertImpl 纯函数 + 进度推送 + 取消检查点)、`--smoke` 冒烟自测
  - `settings.ts`:userData JSON 持久化(原子写);`image-downloader.ts`:外链图片下载(fetch + 超时 + 去重);`preload.cts`:contextBridge 白名单暴露 `window.api`(编译为 CJS)
- `src/renderer/`:GUI UI(vanilla TS + 原生 DOM)
  - `index.html` / `style.css`:Win11 浅色风格界面,含 CSP meta
  - `renderer.ts`:文件选择/拖放/格式单选/转换执行(进度文案 + 结果/错误反馈 + 设置面板)
- `test/`:验收测试体系(acceptance.mjs 入口 + common/ 工具 + segments/(core 渲染)+ main/(主进程层)按内容主题的测试段 + fixtures/ 静态样例数据 + tools/gen-fixtures.mjs(fixtures 生成器,属测试体系故在 test/tools/ 而非 scripts/));`scripts/copy-renderer.mjs`(静态资源拷贝)、`scripts/svg-to-ico.mjs`(图标)

## 测试体系(按内容主题零注册,新增=新建段文件)
- 目录分层:`test/segments/`(core 渲染)+ `test/main/`(主进程层),按内容主题命名,零注册自动发现(`test/acceptance.mjs`)
- 静态样例入 `test/fixtures/`(acceptance/ 生成 + manual/ 手工);产物 `output/artifacts` + `output/smoke`(可清理重建,smoke 自清理)
- 断言写可验证事实(解包 OOXML/产物字符串/读回),不写无断言日志
- 验收样例生成器:`npm run gen:fixtures`(需先 build)/`npm run check:fixtures` 漂移校验(幂等,exit 0/1)
- 新增能力须补对应测试段;缺口清单见 ROADMAP「测试遗留」

## 验证方式
- 类型检查与构建通过后再提交;打包/构建类改动必须实际构建验证(全局铁律 3)
- 验证基线(命令、断言、打包验证链)见 `docs/STATUS.md`「验证基线」;验收测试段明细见 `test/segments/` 与 `test/main/`
- docx/PDF 验收样例固定含中英混排,生成后人工打开检查中文渲染
