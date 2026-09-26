# 全库优化开发计划执行 Checklist

> **用途**：这是 `docs/OPTIMIZATION-PLAN.md` 的执行台账，不是历史归档。每个阶段开始前必须读取本文件；每个阶段结束前逐项更新状态、证据和退出条件。
>
> **状态规则**：
>
> - `[x]` 已完成：实现、自动断言/人工验收、回退点和文档均满足；
> - `[~]` 部分完成：只能记录已落地子项，不能当作阶段完成；
> - `[ ]` 未开始；
> - `[!]` 被决策/依赖阻塞；
> - `[-]` 明确排除或后置，必须有裁决依据。
>
> **硬规则**：没有证据不得改为 `[x]`；测试草稿不等于实现；阶段门禁未通过不得启动下一阶段。

## 0. 当前总览

| 阶段 | 当前状态 | 门禁结论 |
|---|---|---|
| 阶段 0 工程口径/门禁 | `[x]` 本地完成 | Node/live 文档、环境指纹、几何/产物/clean 门禁与决策台账已落地；远端 lane 实跑证据后置 |
| 阶段 1 single-flight/持久化 | `[~]` 实现完成，GUI 待用户 | main/renderer/persistence/batch 实现与自动断言全绿；真实窗口 GUI 验收保留 |
| 阶段 2 内容/几何/输出 | `[x]` 完成 | 准备链、几何迁移、D-03 路径/类型/大小边界、原子输出提交已落地（D-03 媒体限制由阶段 3 预算承接） |
| 阶段 3 资源/生命周期 | `[x]` 完成 | 取消/期限、资源预算、目录/图片限制、KaTeX 上限、clipboard/preview/Mermaid 生命周期已落地；90 段门禁全绿 |
| 阶段 4 renderer UX | `[~]` 自动断言完成，GUI 待用户 | 交互、初始化、预设/取消态、ARIA/视觉/geometry 已落地；真实窗口与读屏目视验收待用户 |
| 阶段 5 边界/双管线/测试 | `[x]` 完成 | 边界契约门禁、21 行双管线差异矩阵、逐段子进程隔离、fixture 显式注册、测试树全量 `@ts-check` 均已落地；101 段门禁全绿 |
| 阶段 6 发布/视觉/安装 | `[~]` 可执行部分完成 | 供应链门禁(SCA/SBOM/许可证)、action SHA 固定、签名状态记录、解包冒烟与安装 smoke 脚本已落地；仅余 GitHub lane 实跑与真实装卸两项需授权 |
| 阶段 7 P2/P3 | `[ ]` 后置 | 不阻塞主线，但全部 actionable 项保留 |

## 1. 阶段 0：决策、基线与门禁

### OPT-0.1 Node 与工程口径 — `[x]`

- [x] `package.json`/lockfile 宿主 Node 下限为 22.13+。
- [x] CI 主 job/Release 固定 22.13.0，稳定 Node 22 lane 保留。
- [x] 契约脚本与负向夹具通过（18 条夹具）。
- [x] 环境指纹可采集并入 CI/Release：`scripts/print-env-fingerprint.mjs` 覆盖 Node/npm/Electron/Chromium/字体/DPI，两条 workflow 在 `npm ci` 之后落文件并随 `always` artifact 留存；探针缺值记 diagnostics 不阻断。
- [x] `docs/index.html`、其他 live 文档中的 Node 口径同步。
- [-] 后续支持 Node lane 的远端实际运行记录后置到远端发布证据（需推送授权），不影响阶段 0 本地完成。

**证据**：`d97e14f`；`scripts/check-ci-contract.mjs`、`scripts/print-env-fingerprint.mjs`；本机实跑指纹 `diagnostics.count=0`（Node 24.18.0 / npm 11.16.0 / Electron 43.2.0 / Chromium 150）。
**退出条件**：本地文档/配置无旧 Node 口径；Node 地板与稳定 lane 契约可追溯；远端 lane 实跑作为后置证据项。

### OPT-0.2 统一验证入口 — `[x]`

- [x] `verify:ci`、`verify:release` 和 CI/Release 共用基础链。
- [x] build-before-typecheck、fixture、coverage、smoke 命令契约可检查。
- [x] geometry gate 进入链尾（`check:geometry` 在 `verify:ci` 末尾，契约断言 build 在前；CI 与 Release 复用同一链）。
- [x] dist 链前置清理：`clean:dist` + `clean:release` 在 `build` 之前（`scripts/clean-artifacts.mjs`，只删 dist/release 两个生成目录，带路径/存在/链接/白名单守卫）。
- [x] dist 清单生成/校验、`app.asar` 核对、发布目标核对 + SHA-256 报告进入 `dist` 链（清单基线在 electron-builder 之前，产物核对在其之后）。
- [x] 契约守护上述形态：负向夹具覆盖几何门禁移出链/提前到 build 前、前置清理缺席/乱序、清理目标越界/未显式指定、产物核对缺席、核对排到打包前、发布自建缩水清单（18 条）。
- [x] geometry、dist/ASAR/release、clean 真实负向探针已落地；coverage/fixture/smoke 的故意失败探针转入阶段 7，不阻塞阶段 0。

**证据**：`d97e14f`；`package.json`；两个 workflow；`scripts/clean-artifacts.mjs`；`scripts/check-ci-contract.selftest.mjs`（本机 18/18 通过）；`npm run check:geometry` 本机通过（12 场景 / 7 恒定组 / 容差 1px）；本机 `clean:dist` → `build` → 清单生成/校验全绿（262 文件）。
**退出条件**：故意制造每类失败均阻止发布；release 产物可追溯。

> 后置项：CI/Release 改动尚未在 GitHub 上实跑（无 run 记录），该远端证据不改变阶段 0 本地完成结论；发布前须补跑并归档。

### OPT-0.3 决策与问题台账 — `[x]`

- [x] 本 checklist 作为维护中的 issue/decision/source/test 台账。
- [x] D-02/D-03/D-04/D-08 与 BACKLOG/设计/runner 旧口径统一；历史记录保留并加 supersede 指针。

**证据**：`docs/OPTIMIZATION-PLAN.md`、archive 整合文档；`docs/ACCEPTANCE.md` supersede 表；`docs/BACKLOG.md` 取代记录；`docs/USER-GUIDE.md`/`docs/design/*`/`test/common/runner.js` 当前口径。
**退出条件**：每个 actionable 项有唯一 ID、状态、证据、测试层、回退点；冲突有 supersede 记录。

### 阶段 0 门禁

- [x] 本地 OPT-0.1～0.3 实现与契约已通过；远端 Node lane/部分故意失败探针作为外部或后续证据项保留。
- [x] 当前工作树无未使用导入/未声明红测试（阶段 3 草稿已隔离）。
- [x] `check:contract`、selftest、typecheck、lint、build、acceptance、geometry 通过（77 段）。

### 阶段 0 明确后置项（不计入本地完成）

- [-] GitHub Actions 主 job、稳定 Node lane、Release 的远端实跑与 artifact 归档（需推送授权）。
- [-] coverage/fixture/smoke 故意失败探针（转阶段 7）。
- [-] 内置预设 core hint 三语化与不可达提示分支（转 OPT-4.3）。

## 2. 阶段 1：single-flight、取消与持久化

### OPT-1.1 main operation registry — `[x]`

- [x] webContents 维度 registry。
- [x] single/batch/merge/precheck 共用注册。
- [x] compare-and-delete、busy 结果、当前 cancel。
- [x] 真实异步 IPC 并发最大活动数测试。
- [x] close/超时/旧 token 交错测试。
- [x] precheck 异常/忙碌结果可观察性收口。

**证据**：`a8aa428`；`test/main/operation-single-flight.test.js`、`test/main/window-close-abort.test.js`、`test/main/ipc-logic.test.js`、`ipc-register.test.js`。
**退出条件**：真实 handler 并发、取消、关闭时序测试全绿。

### OPT-1.2 renderer command/precheck lock — `[~]`

- [x] active Promise/token、按钮/快捷键守卫、预检 Promise 单实例。
- [x] dropZone 祖先 role/button 与事件冒泡修复。
- [x] 所有真实按钮/遮罩/Esc/窗口关闭路径结算测试。
- [ ] GUI 验收覆盖向导/模态/背景入口。

**证据**：`a8aa428`；`test/renderer/command-entry-guard.test.js`、`wizard-command-guard.test.js`、`convert-command-lock.test.js`。
**退出条件**：键盘/鼠标/弹窗全路径无双触发/悬挂 Promise；GUI 项由用户实测关闭。

### OPT-1.3 settings/ui-state mutation queue — `[x]`

- [x] 读改写/写盘/cache commit 同队列。
- [x] 写失败不更新缓存且队列可恢复。
- [x] session/ui-state 写失败的统一 GUI 可见反馈。
- [x] 重启后并发字段保留验证。

**证据**：`a8aa428`；`test/main/atomic-json.test.js`、`settings.test.js`、`ui-state.test.js`、`test/renderer/session-persist-feedback.test.js`。
**退出条件**：设置、最近文件、窗口状态均不丢，失败可操作。

### OPT-1.4 批量副作用 — `[x]`

- [x] 批次 immutable settings snapshot。
- [x] batch after-convert 一次、取消跳过。
- [x] merge 最终取消检查。
- [x] single/batch/merge cancel/close 精确 after-action 次数测试。

**证据**：`a8aa428`；`test/main/converter-after-convert.test.js`、`test/main/converter.test.js`。
**退出条件**：任何取消/失败/关闭后不打开产物。

### 阶段 1 门禁

- [x] OPT-1.1、OPT-1.3、OPT-1.4 实现与自动断言完成。
- [x] main 并发/取消/关闭与 renderer 命令/模态/向导自动断言完成。
- [ ] 用户 GUI 实测（双击/快捷键/模态/向导/关闭/保存失败）待用户验收。
- [x] 独立提交 `a8aa428`，阶段验证记录完整（`verify:ci` 83 段全绿）。

## 3. 阶段 2：内容完整性、页面几何、输出原子性

### OPT-2.1 Markdown 预处理安全 — `[x]`

- [x] core frontmatter LF/CRLF/CR。
- [x] core fenced/inline/HTML code/escaped 保护。
- [x] core thematic break 与开关关闭保真。
- [x] single/batch/merge/preview/precheck 同一 preparation chain（含 readFrontmatter）。
- [x] GBK/UTF-16 预览/预检/转换一致，warning 顺序稳定。
- [x] D-03 本地图片绝对/UNC/file URL/越界/链接规范化拒绝及测试。
- [x] D-03 本地扩展名/魔数/单文件大小限制（阶段 3 落地：`preprocess.ts` `MAX_SOURCE_FILE_BYTES` 32MB stat 预检 + 读后复核；`core/image/image-type.ts` 魔数白名单 png/jpg/gif/webp，未知返回 null 由消费方降级告警）。

**证据**：`1180218`；本 2A 提交；core/main segments。
**退出条件**：所有入口使用同一准备语义，内容保真和图片边界全绿。

### OPT-2.2 页面几何 validator — `[x]`

- [x] core 唯一 `validatePageSetup()` 与 `correctPageSetup()`。
- [x] docx/pdf render 边界接入，PDF 在尺寸计算前校验。
- [x] 纸张/方向/边距/最小内容区与最小溢出修正测试。
- [x] main sanitize/load 迁移、结构化 warning、队列固化与 cache 状态。
- [x] renderer normalize/merge 接入同一契约，保存失败完整回滚运行时副作用。
- [x] 旧 settings 保留其它字段并给可见反馈。

**证据**：`1180218`；本 2A 提交；page-setup/main settings/renderer tests。
**退出条件**：main/renderer/core 三层对非法几何策略一致且可解释。

### OPT-2.3 输出选名与原子提交 — `[x]`

- [x] 独占 reservation/重选序号。
- [x] 同目录临时文件 + 原子提交。
- [x] docx/pdf/batch/merge 共用提交器。
- [x] 失败清理临时文件。
- [x] 并发同名/中断失败/ZIP/PDF magic 测试。

**证据**：本 2B 提交；`src/main/converter/artifact-writer.ts`、`test/main/artifact-commit.test.js`、`converter.test.js`、`paths.test.js`。
**已知边界**：无同目录硬链接能力的文件系统安全失败并提示改输出目录，不退化为非原子直写；错误文案 i18n 化列入后续 UI/i18n 维护项。

### 阶段 2 门禁

- [x] OPT-2.1～2.3 全部 `[x]`（D-03 媒体限制经阶段 3 预算补齐）。
- [x] 阶段 2 红测试全部对应生产实现并通过。
- [x] `verify:ci` 全量全绿（105 段、coverage、fixtures、smoke、geometry 12 场景/10 恒定组）。

## 4. 阶段 3：资源预算、取消传播与生命周期

### OPT-3.1 core 取消与预算契约 — `[x]`

- [x] AbortSignal/deadline/稳定取消错误码。
- [x] docx/pdf/resolver 取消传播。
- [x] 单 URL/单图/文档图片数量、字节、并发预算。
- [x] KaTeX maxExpand/maxSize/trust 资源边界。
- [x] 正向 deadline 与各阶段取消测试。

**证据**：`3c429c8`；`src/core/cancel.ts`、`resource-limits.ts`；`test/segments/core-resources.test.js`、`test/main/convert-cancel.test.js`、`merge-cancel.test.js`。
**已知边界**：`MAX_SCAN_ENTRIES` 的 2 万条目截断未物理造满，深度/同类停止告警通路已实跑。

### OPT-3.2 输入与目录预算 — `[x]`

- [x] realpath/junction/symlink 循环保护。
- [x] 深度/条目/单文件/批量/merge 总量上限。
- [x] 本地/外链图片有界并发与 warning 顺序。
- [x] DNS/连接/超时/取消/缓存预算。

**证据**：`3c429c8`；`test/main/input-budget.test.js`、`image-request-budget.test.js`、`merge-cancel.test.js`、`test/segments/pdf-postprocess.test.js`。
**退出条件**：压力输入在预算内结束且不留半成品。

### OPT-3.3 临时文件、预览与 Mermaid — `[x]`

- [x] clipboard Markdown 一次性 cleanup handle。
- [x] preview generation/串行刷新。
- [x] Mermaid epoch/dispose。
- [x] 取消后 after-convert/临时资源清理。

**证据**：`3c429c8`；`test/main/temp-markdown.test.js`、`preview.test.js`、`mermaid-service.test.js`。
**退出条件**：成功/失败/取消/退出均无敏感临时文件和孤儿窗口。

### 阶段 3 门禁

- [x] OPT-3.1～3.3 全部 `[x]`。
- [x] 取消/超时/压力/生命周期测试全绿。
- [x] 阶段 2/3 红测试已迁入 `test/segments/` 并全绿；`test/pending/` 保留历史副本，不参与 acceptance。

## 5. 阶段 4：renderer UX、向导、动态 i18n、主题

### OPT-4.1 舞台与模态交互 — `[~]`

- [x] dropZone region/事件隔离。
- [x] 内部控件统一冒泡阻断。
- [x] 模态/向导/命令锁自动断言。
- [ ] 真实窗口 GUI/键盘全链路验收。

### OPT-4.2 初始化、向导和语言 — `[~]`

- [x] settings/language/theme 初始化 barrier。
- [x] 动态状态不由静态 i18n 覆盖。
- [x] 向导重开同步最新设置。
- [x] main 语言/菜单/标题栏同步。
- [ ] 冷启动/语言切换/主题切换 GUI 实测。

### OPT-4.3 预设与取消状态 — `[~]`

- [x] D-02 作用域文档/设计/renderer 当前文案统一（历史口径保留 supersede 指针）。
- [x] 内置 `TEMPLATE_PRESETS` 提示三语化。
- [x] `resolvePresetHint` 自定义/微调分支可达性与提示复位。
- [x] canceled 中性视觉与批量标题组合。
- [x] 复制状态复位与 i18n。
- [ ] 真实窗口预设/取消/复制反馈 GUI 实测。

### OPT-4.4 键盘、ARIA、视觉契约 — `[~]`

- [x] 历史/队列/设置 Tab/向导 label 与错误关联自动断言。
- [x] 进度阶段播报。
- [x] 消息固定槽、深色对比度、网格/token/pulse 修复。
- [x] 几何 gate 失败可定位（12 场景/10 恒定组）。
- [ ] 纯键盘/读屏与深浅主题目视验收。

**阶段 4 门禁**：实现与自动断言已通过（95 段、geometry 12 场景/10 恒定组）；真实窗口 GUI/键盘/读屏/深浅主题验收待用户完成。

## 6. 阶段 5：边界、双管线契约、测试工程

### OPT-5.1 边界契约 — `[x]`

- [x] 部分 IPC contract 归位。
- [x] main logic 纯化/IO 边界明确（抽出零 electron 纯模块 `main/persist/preset-file.ts`，`logic.ts` 运行时依赖图零 electron，BFS 守护）。
- [x] renderer/preload type-only 依赖清理（`ConvertResult` 等 6 个契约上提 `core/ipc-contract.ts`；preload 类型依赖仅来自 core）。
- [x] import boundary 自动检查（`check:boundary` 入 verify:ci；依赖声明求差 + 4 条层向断言 + core node 内建白名单，src/dist 双形态，负向夹具 18→21）。
- [x] 传递依赖声明修正（jszip 移入 dependencies；9 个 core 运行时传递依赖按 lockfile 实际版本钉死；ASAR 必备条目补 jszip）。

**证据**：`02cfd59`、`004b4ab`；`scripts/check-import-boundary.mjs`、`test/segments/import-boundary.test.js`。

### OPT-5.2 双管线差异矩阵 — `[x]`

- [x] 必须一致/允许不同矩阵（21 行可执行断言：必须一致 12 / 允许不同 9；每行含双侧提取器与源码行号锚点，行结构受守护）。
- [x] differential fixtures（5 个 `dual-pipeline-matrix*` 样例，全部被断言实际消费）。
- [x] heading/caption/equation/HTML/TOC 显式契约（`ConvertContext` 增 `headingNumbering`/`captionNumbering` 并透传双管线；toc-caption 补 docx×pdf 四组合覆盖断言）。
- [x] PDF 目录结构化数据渐进替换（`renderPdfDocument` 与 html 同管线产出 headings；`extractHeadings` 降级为兼容层；`injectTocPageNumbers` 按 id 集合定位）。
- [x] DOCX Ctx 按范围拆分（20 个扁平字段 → `config` 只读配置 + `xref`/`footnote`/`comment`/`image`/`warning` 五个可变状态子对象，单源构造点保持唯一）。

**证据**：`5c8572d`、`2cdd08a`；`test/segments/dual-pipeline-matrix.test.js`（21 行矩阵）、`src/main/converter/artifact-writer.ts` 同批。

### OPT-5.3 测试工程 — `[x]`

- [x] coverage/fixture/基础门禁（101 段；c8 阈值 90/85/90/90，core/main 范围）。
- [x] core/main coverage 范围明确。
- [x] 全部测试 `checkJs`（108 个测试源文件全量标注 `@ts-check`，清零 2053 条；**逐文件 pragma 模型**，`checkJs` 必须保持 false —— 测试消费 dist 编译产物，全局开启会把它拉进检查范围；由 `tscheck-coverage` 段守护）。
- [x] 逐段子进程隔离与失败 artifact（父进程按段派生独立 Electron 子进程；硬超时 `taskkill /T /F` 杀进程树；userData 隔离下沉到每段；失败落盘 `output/artifacts/failures/<段名>/`；`M2W_ACCEPTANCE_INPROC=1` 保留同进程回退）。
- [x] fixture 显式注册、mock 边界、case 级报告（去掉正则预筛，改为三目录统一 import 后读显式契约，不声明即判红；扫描范围补齐 renderer；`electron-mock-coverage` 段静态守护 mock 覆盖面并堵出 `nativeTheme`/`webUtils` 真实漂移；case 级契约 + 跨进程增量回传）。

**证据**：`629b3b2`、`529810e`、`583f345`。

**已知边界与教训**：
- 隔离模型耗时 2.21x（100 段：隔离 90.2s vs 同进程 40.9s），未为速度牺牲隔离性；降本备选（K 槽并发编排）未实施。
- TS7 native（`tsc`）在程序内存在**任一语法错误**时会跳过全程序语义诊断 → 「tsc 输出为空」可能是假绿。验收须双编译器交叉（TS7 CLI + TS6 API 探针）。
- `.js` 中非空断言 `!` 触发 TS8013 语法错误，同上会引发假绿；测试树禁用 `!`，改用断言函数（`@returns {asserts cond}`）与显式读取 helper。
- 差异矩阵段已拆分：1507 → 809 行，提取器/样例/沙箱装配三岛下沉 `test/common/`（112/243/450 行），矩阵段只留 21 行定义 + 判定 + 形状守护 + 逐行实跑；`must()` 断言数 158 → 158 零削弱，21 行实跑结果与拆分前逐行相同。**已接受的例外**：段内 809 行中 663 行是 MATRIX 行定义表，超出 ~500 参考。理由：按 mode 拆表会让「行数统计 / 形状守护 / 逐行实跑」三处逻辑分家，代价高于行数收益。题注 label 原按「单一命名空间」锁定为一致性事实，2026-09-26 经用户拍板改为**按 kind 分命名空间**（属用户可见语义变更，矩阵行已同步）。

**阶段 5 门禁**：全部 `[x]`；`verify:ci` 通过（101 段、coverage、fixtures、smoke、geometry 12 场景/10 恒定组），TS7 CLI 与 TS6 探针双侧零类型错误。

## 7. 阶段 6：发布可重复性、供应链、视觉/安装

### OPT-6.1 clean build/ASAR — `[x]`

- [x] clean dist：`clean:dist`/`clean:release` 在 dist 链的 build 之前（`scripts/clean-artifacts.mjs`；只删 dist/release 两个生成目录，路径/存在/链接/白名单守卫齐备）。
- [x] dist/ASAR manifest/hash/入口可达性核对进入 `dist` 链：清单在 electron-builder 之前生成，包内 `dist/**` 与清单逐项 SHA-256 交叉核对（证明「打进包的就是本次 dist」，并挡住顶层误打包）。
- [x] 陈旧/改名残留探针已实跑：向 dist 注入模拟残留后 `check:dist-manifest --check` 判红（`产物陈旧(stale):core/__stale_probe.js`），移除后复验转绿。
- [x] 本机整条 `npm run dist` 实跑通过：clean → build → 清单(272 文件)→ electron-builder → `check:dist-manifest` ✓ → `check:asar` ✓(10643 个文件)→ `check:release` ✓(3.12.0 三件套、SHA-256 报告)→ `check:signature` ✓(3 个产物均 unsigned)→ `check:unpacked-smoke` ✓(解包产物 `--smoke` 退出码 0、五条标记齐备)。
- [x] 删除/重命名**源**文件探针已实跑（2026-09-26）：新增临时源 → 产物与清单同步出现 → 重命名 → **旧名产物残留** → 删除 → `clean:dist` 重建后归零。

**探针结论（真实边界，非推测）**：`npm run dist` 因首步 `clean:dist` 整目录清空，**发布链不可能带出陈旧产物**；但裸跑 `npm run build`（tsc 增量）**不会回收已删除/重命名源的输出**，且 `gen:dist-manifest` 只是对 dist 的快照、自身无法发现陈旧。故开发期若只跑 `build`，`check:dist-manifest --check` 会判绿而 dist 实含残留——**判断产物新鲜度必须走 dist 链或先 clean**。

### OPT-6.2 供应链 — `[x]`

- [x] Node/lockfile/版本一致性基础。
- [x] OSV/SCA、SBOM、许可证/NOTICE（`scripts/supply/`，独立入口 `check:supply`，接入 CI/Release 而非本地 verify:ci）。
- [x] 环境指纹脚本与 CI/Release 接入。
- [x] GitHub action SHA 固定（13 处浮动 tag 全部固定到 40 位 commit SHA + `# vX.Y.Z` 注释）。
- [x] 本地安装包 hash、ASAR 与当前版本产物核对。
- [x] 未签名提示、签名状态记录与发布说明固化（`docs/SIGNATURE-STATUS.md` + `check:signature` + `signature-status` 段）。

**SCA 实测结论**：生产树 **0 条漏洞**；含 dev 全树 16 条（14 high + 2 moderate）**全部为 dev-only**，按既定口径只记录不阻断。npmmirror 的 audit 端点实测 404 不可用，如实记为 `unavailable` 并由 OSV.dev 两阶段兜底；**全部源不可用时判红**，绝不把「扫不到」谎报成「无漏洞」。

**许可证**：660 组件（生产 233 / 开发 427），unknown 归零。`khroma@2.1.0` 曾因 npm 元数据缺 `license` 字段被判红，经外部核验确认其**实际为 MIT**（仓库小写 `license` 文件、README 声明、GitHub `spdx_id: MIT`、MIT 全文随 tarball 分发），故修的是门禁自身——取值改为**字段优先、缺失时回落随包许可证物证**并记录来源与证据文件名；内容无法识别仍判红（**不猜测**）。

**已知口径差**：`sbom.cdx.json` 按设计只读 lockfile，故仍把 khroma 记为 `NOASSERTION`，与 `licenses.json`/`NOTICE.md` 的 MIT 取值不一致。SBOM 保持「以 lockfile 为准」是有意的（离线可复现），差异待后续统一排期。

### OPT-6.3 视觉/安装验证 — `[~]`

- [x] geometry gate 进入 CI/Release 的本地契约与 workflow 配置。
- [x] 截图 artifact/失败定位脚本与失败输出已就位。
- [x] unpacked 启动 smoke（**已实跑转绿**：解包产物以 `--smoke` 启动退出码 0、五条诊断标记齐备、一次性 userData 已清、`release/` 零改动）。
- [x] ASAR 清单核对（`check:asar` 逐步核对必备条目，冒烟入口已升级为硬门禁）。
- [x] 安装/启动/卸载 smoke **脚本**已实现：默认预演零副作用，`--execute` 才真实执行并先打印 9 行系统改动警告。
- [-] GitHub lane 实跑证据（远端报告/截图 artifact）——需推送授权，后置。
- [x] **真实**安装/卸载执行已实跑通过（2026-09-26，用户授权后执行）：静默安装 → 安装目录下 `--smoke` 退出码 0 且标记齐备 → 静默卸载 → **零残留**（安装目录/开始菜单/卸载注册表 HKCU+HKLM/残留进程/临时 userData 逐项独立核验均为 0）。
  **过程中发现并修掉的真实缺陷**（非环境限制）：`defaultInstallDir` 原硬写 `%ProgramFiles%`，而本仓 NSIS 实为按用户模式（实测 `UninstallString` 带 `/currentuser`），非交互环境必然被拦；且安装器在失败前已写入卸载注册表项与开始菜单 `.lnk`，两者都指向不存在的 exe，**卸载器未生成 ⇒ Windows「应用」里出现无法卸载的幽灵条目**。现安装目录按构建口径推导（按用户免提权），失败时按前后快照差集只清理本次新增残留并点名具体键/路径。
  另修掉一处**既有测试危险默认值**：替身执行器未注入删除器时会回落到真实 `reg delete`/`rmSync`（实测可删真实开始菜单路径），已全部改为记账替身。

**已知边界**：
- action 固定 SHA 的代价：**Dependabot 的漏洞告警对 SHA 固定的 action 失效**（仅版本更新 PR 仍有效），已记录待后续用其它手段补偿。
- 打包冒烟实现已下沉到 `dist/main/smoke.js` 随包分发；因此每个安装包都含这段仅在 `--smoke` 时执行的代码（约 33KB），属有意取舍（换取发布链能自动验证解包产物）。

**阶段 6 门禁**：可本地执行部分全部通过（`verify:ci` 105 段、`npm run dist` 整链、解包冒烟、供应链门禁）；仅余两项需用户授权的外部证据。

## 8. 阶段 7：P2/P3 维护与可选提升

- [x] coverage/fixture/smoke 故意失败探针与报告（阶段 0 后置项）：`scripts/check-gate-probes.mjs` 拆为 10 个岛（最大 462 行），5 道门禁各做「正向锚点 + 负向故障」双向验证，全部在系统临时区沙盒副本内进行、真实工作树零注入（前后内容指纹 + node_modules 哨兵双断言）。**元验证**：在假仓库副本里把 `check-build-fresh` 改成永远 exit 0 / 永远 exit 1，证明探针非空过且邻近健康门禁不受影响。
- [x] assertion helper/机器可读 smoke：`test/common/assert.js`（8 条断言，失败消息必含实际值/期望值/差异位置）+ `scripts/smoke-report.mjs`（拆 5 模块）把「5 条文本标记 + 退出码」归一成 `output/artifacts/smoke-report.json`，dev 与解包产物两种来源同形状，判定口径零改动。
- [x] 临时资源 helper、ASAR/EXE 体积实测：`test/common/temp-resource.js`（EBUSY 退避、删不掉必抛并点名）+ `scripts/pack-size.mjs`（拆 10 模块，10 个条目实测）。**判重按「包名+版本+谁要求哪个范围」**，本仓 katex 3 份 2 版本系 `^0.18.1`（项目）与 `^0.16.45`/`^0.16.0`（mermaid / micromark）范围互斥强制并存，**排除嵌套副本会让 micromark 解析到不满足 `^0.16.0` 的 0.18.1** —— 故合法并存不判红，判红看「可避免」。
- [~] 允许版本线内 patch/minor：由全局 AGENTS.md「依赖升级分级」+ 本项目「勿回退」钉版承担；**未新增自动门禁**，因为可自动判定的部分（地板与 exact 钉版）已由 `check:contract` 覆盖，而「是否允许升到某 minor」本质是人工裁决，自动化只能给出地板不能给出许可。
- [x] prerelease、allowed path、fsync、权限 handler、Mermaid warning：自写 20 余行 prerelease 比较器（**刻意不引 semver 包** —— 该脚本在两条 workflow 的 `npm install` 之前各跑一次，`import 'semver'` 恰好在最需要它时 `ERR_MODULE_NOT_FOUND`，门禁自我否定）；显式落盘（写内容 → 文件句柄 fsync → rename → 父目录 fsync，缺文件 fsync 时断电可得 0 字节 `settings.json` 而 `loadSettings` 整文件回退默认 → **用户全部偏好静默归零**）；权限三通道补齐并保持默认拒绝；产物白名单三收口（绑定真实产物/规范化后比对/有界增长）；Mermaid 失败原因经 core **既有** warning 通道上屏（零新 i18n key）。
- [x] 完成态动画、复制状态、about 标题、初始焦点、队列/脉冲等 UI polish。**修真缺陷两处**：脉冲原直接动画按钮自身 `box-shadow`，与静置投影及 hover 抬升抢同一条声明 → 动画期间整条投影被顶掉、**hover 抬升永久失效**（改由 `::after` 承载光环）；复制反馈原为 `display:none→flex` 显隐互换且文本不变，`role="status"` 收不到内容变更 → **读屏基本不播报**（改常驻 sr-only live 区 + 先清空再写）。另修既有 bug：`row.title` 调 `t()` 未传参，按 `i18n.ts` 返回**原始模板**，悬停提示一直字面显示 `${path}`。
- [ ] 跨 DPI 像素基线（后置）—— 计划标注「只在环境稳定后建立」，该前提已随 UI 打磨落地而满足，进行中。

**本阶段拦下的两处真实基础设施缺陷（都是「门禁自己会失效」那一类）**：
1. **覆盖率静默少算**：`gate-probes` 的 coverage 探针在沙盒里再跑一次真 c8，而 `node.env` 未覆盖 `NODE_V8_COVERAGE`，子进程继承外层 `test:coverage` 的同一临时目录并在其 report 阶段清空它 → **所有文件名排在 `gate-probes.test.js` 之前的段**，其 V8 覆盖数据整段丢失，而探针自身全绿。实测：同一运行下只跑 `formula` 段时 `math.ts` 为 86.15%/80%，加上 `gate-probes` 段即掉到 0%/0%。修法是给子 c8 指定沙盒内的 `NODE_V8_COVERAGE`；**不能用「给测试段改名去排序」绕过** —— 段名与执行顺序一旦成为覆盖是否被计入的前提，门禁就依赖字母序而非真实覆盖。修复后实测组数字由 91.63 升到 92.81，即找回的正是此前丢失的部分。
2. **eslint 文件数零余量**：`maximumDefaultProjectFileMatchCount` 达 200（等于旧上限），再加任一 `.js/.mjs` 即整体报 `Too many files (>200)` 把 lint 打成一片红。已提到 300；该值只影响性能护栏，不放宽任何类型或规则门禁。

**覆盖率门禁的实测与棘轮**：干净树实测 92.81 / 89.03 / 93.10 / 92.81，越过 90/85/90/90。阈值**未下调** —— 干净树实测低于 90 时正确动作是补测试（`handlers/math.ts`、`handlers/fallback.ts` 两个 0% 覆盖的 docx handler 补测 581 行，函数缺口归零），而非降阈值。`floor`(85/80/85/85) + `headroomPp`(5) 棘轮在真实仓库上验证有牙：降阈值、谎报 `measured`、只改基线不改命令，三种都判红。

**阶段 7 门禁**：`verify:ci` 全绿（含 117 段）、覆盖率四项达标、供应链门禁 exit 0、几何门禁 12 场景/10 恒定组全绿。

## 9. 当前工作树残留处理

- [x] 阶段 2 集成红测试已转绿并纳入 2A 提交。
- [x] 阶段 3 红测试已迁入 `test/segments/core-resources.test.js` 与 `test/segments/pdf-postprocess.test.js`；`test/pending/` 仅保留历史副本，不参与 acceptance。
- [x] `.opencode/` 为工具运行产物，不纳入项目提交。

## 10. 每次阶段执行记录模板

```text
阶段：N
读取 checklist：时间/提交
本次拉出的 OPT 项：...
完成项：...
证据：commit / test / acceptance / GUI
未完成项及阻塞：...
回退点：...
阶段门禁：通过 / 未通过
下一步：...
```
