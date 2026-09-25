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
| 阶段 0 工程口径/门禁 | `[x]` 完成（外部证据后置） | Node/live 文档、环境指纹、几何/产物/clean 门禁与决策台账已落地；远端 lane 实跑证据后置，不阻塞本地阶段 |
| 阶段 1 single-flight/持久化 | `[~]` 部分完成 | 主要实现已有；真实并发/取消/关闭/after-convert 竞态与 GUI 验收未闭环 |
| 阶段 2 内容/几何/输出 | `[~]` 2A 已完成，2B 待办 | 准备链、几何迁移、D-03 路径边界已落地；媒体类型/大小预算与输出原子提交未完成 |
| 阶段 3 资源/生命周期 | `[ ]` 未开始 | 仅有未提交红测试草稿，不能计为实现 |
| 阶段 4 renderer UX | `[ ]` 未开始 | 依赖阶段 1/2 状态契约稳定 |
| 阶段 5 边界/双管线/测试 | `[~]` 基础存在 | checkJs 全量、runner 隔离、fixture 契约、差异矩阵未完成 |
| 阶段 6 发布/视觉/安装 | `[ ]` 未开始 | geometry/ASAR/SCA/SBOM/安装验证未完成 |
| 阶段 7 P2/P3 | `[ ]` 后置 | 不阻塞主线，但全部 actionable 项保留 |

## 1. 阶段 0：决策、基线与门禁

### OPT-0.1 Node 与工程口径 — `[x]`

- [x] `package.json`/lockfile 宿主 Node 下限为 22.13+。
- [x] CI 主 job/Release 固定 22.13.0，稳定 Node 22 lane 保留。
- [x] 契约脚本与负向夹具通过（18 条夹具）。
- [x] 环境指纹可采集并入 CI/Release：`scripts/print-env-fingerprint.mjs` 覆盖 Node/npm/Electron/Chromium/字体/DPI，两条 workflow 在 `npm ci` 之后落文件并随 `always` artifact 留存；探针缺值记 diagnostics 不阻断。
- [x] `docs/index.html`、其他 live 文档中的 Node 口径同步。
- [!] 后续支持 Node lane 的远端实际运行记录待有推送授权后补齐；本地契约与脚本验证已完成。

**证据**：`d97e14f`；`scripts/check-ci-contract.mjs`、`scripts/print-env-fingerprint.mjs`；本机实跑指纹 `diagnostics.count=0`（Node 24.18.0 / npm 11.16.0 / Electron 43.2.0 / Chromium 150）。
**退出条件**：现行文档/配置无旧 Node 口径；最低与稳定版本均有可追溯验证。

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

> 远端事实：本条所列 CI/Release 改动**尚未在 GitHub 上实跑**（无 run 记录），只完成本地门禁与脚本层验证。

### OPT-0.3 决策与问题台账 — `[x]`

- [x] 本 checklist 作为维护中的 issue/decision/source/test 台账。
- [x] D-02/D-03/D-04/D-08 与 BACKLOG/设计/runner 旧口径统一；历史记录保留并加 supersede 指针。

**证据**：`docs/OPTIMIZATION-PLAN.md`、archive 整合文档；`docs/ACCEPTANCE.md` supersede 表；`docs/BACKLOG.md` 取代记录；`docs/USER-GUIDE.md`/`docs/design/*`/`test/common/runner.js` 当前口径。
**退出条件**：每个 actionable 项有唯一 ID、状态、证据、测试层、回退点；冲突有 supersede 记录。

### 阶段 0 门禁

- [x] 本地 OPT-0.1～0.3 实现与契约已通过；远端 Node lane/部分故意失败探针作为外部或后续证据项保留。
- [x] 当前工作树无未使用导入/未声明红测试（阶段 3 草稿已隔离）。
- [x] `check:contract`、selftest、typecheck、lint、build、acceptance、geometry 通过（77 段）。

## 2. 阶段 1：single-flight、取消与持久化

### OPT-1.1 main operation registry — `[~]`

- [x] webContents 维度 registry。
- [x] single/batch/merge/precheck 共用注册。
- [x] compare-and-delete、busy 结果、当前 cancel。
- [ ] 真实异步 IPC 并发最大活动数测试。
- [ ] close/超时/旧 token 交错测试。
- [ ] precheck 异常/忙碌结果可观察性收口。

**证据**：`fbbf5b7`；`test/main/ipc-logic.test.js`、`ipc-register.test.js`。
**退出条件**：真实 handler 并发、取消、关闭时序测试全绿。

### OPT-1.2 renderer command/precheck lock — `[~]`

- [x] active Promise/token、按钮/快捷键守卫、预检 Promise 单实例。
- [ ] dropZone 祖先 role/button 与事件冒泡修复。
- [ ] 所有真实按钮/遮罩/Esc/窗口关闭路径结算测试。
- [ ] GUI 验收覆盖向导/模态/背景入口。

**证据**：`fbbf5b7`；`test/renderer/convert-command-lock.test.js`。
**退出条件**：键盘/鼠标/弹窗全路径无双触发/悬挂 Promise。

### OPT-1.3 settings/ui-state mutation queue — `[~]`

- [x] 读改写/写盘/cache commit 同队列。
- [x] 写失败不更新缓存且队列可恢复。
- [ ] session/ui-state 写失败的统一 GUI 可见反馈。
- [ ] 重启后并发字段保留验证。

**证据**：`89c71c8`；main atomic/settings/ui-state tests。
**退出条件**：设置、最近文件、窗口状态均不丢，失败可操作。

### OPT-1.4 批量副作用 — `[~]`

- [x] 批次 immutable settings snapshot。
- [x] batch after-convert 一次、取消跳过。
- [ ] merge 最终取消检查。
- [ ] single/batch/merge cancel/close 精确 after-action 次数测试。

**证据**：`89c71c8`；`test/main/converter.test.js`。
**退出条件**：任何取消/失败/关闭后不打开产物。

### 阶段 1 门禁

- [ ] OPT-1.1～1.4 全部 `[x]`。
- [ ] main 并发/取消/关闭和 renderer GUI 验收完成。
- [ ] 独立提交可回退，阶段验证记录完整。

## 3. 阶段 2：内容完整性、页面几何、输出原子性

### OPT-2.1 Markdown 预处理安全 — `[~]`

- [x] core frontmatter LF/CRLF/CR。
- [x] core fenced/inline/HTML code/escaped 保护。
- [x] core thematic break 与开关关闭保真。
- [x] single/batch/merge/preview/precheck 同一 preparation chain（含 readFrontmatter）。
- [x] GBK/UTF-16 预览/预检/转换一致，warning 顺序稳定。
- [x] D-03 本地图片绝对/UNC/file URL/越界/链接规范化拒绝及测试。
- [ ] D-03 本地扩展名/魔数/单文件大小限制（留阶段 3 资源预算）。

**证据**：`1180218`；本 2A 提交；core/main segments。
**退出条件**：所有入口使用同一准备语义，内容保真和图片边界全绿。

### OPT-2.2 页面几何 validator — `[~]`

- [x] core 唯一 `validatePageSetup()` 与 `correctPageSetup()`。
- [x] docx/pdf render 边界接入，PDF 在尺寸计算前校验。
- [x] 纸张/方向/边距/最小内容区与最小溢出修正测试。
- [x] main sanitize/load 迁移、结构化 warning、队列固化与 cache 状态。
- [x] renderer normalize/merge 接入同一契约，保存失败完整回滚运行时副作用。
- [x] 旧 settings 保留其它字段并给可见反馈。

**证据**：`1180218`；本 2A 提交；page-setup/main settings/renderer tests。
**退出条件**：main/renderer/core 三层对非法几何策略一致且可解释。

### OPT-2.3 输出选名与原子提交 — `[ ]`

- [ ] 独占 reservation/重选序号。
- [ ] 同目录临时文件 + 原子提交。
- [ ] docx/pdf/batch/merge 共用提交器。
- [ ] 失败清理临时文件。
- [ ] 并发同名/进程中断/ZIP/PDF magic 测试。

**证据**：当前 `paths.ts`、`single.ts` 仍直接最终写入。
**退出条件**：并发不覆盖、中断无错误最终文件。

### 阶段 2 门禁

- [ ] OPT-2.1～2.3 全部 `[x]`。
- [ ] 阶段 2 红测试全部对应生产实现并通过。
- [x] `verify:ci` 在不含未来阶段红测试的当前 2A 工作树上全绿（77 段、coverage、fixtures、smoke、geometry）。

## 4. 阶段 3：资源预算、取消传播与生命周期

### OPT-3.1 core 取消与预算契约 — `[ ]`

- [ ] AbortSignal/deadline/稳定取消错误码。
- [ ] docx/pdf/resolver 取消传播。
- [ ] 单 URL/单图/文档图片数量、字节、并发预算。
- [ ] KaTeX maxExpand/maxSize/trust 资源边界。
- [ ] 正向 deadline 与各阶段取消测试。

**证据**：当前无 core resource-limits/signal 契约；`test/segments/core-resources.test.js` 是未提交红测试。
**退出条件**：永不 resolve、超时、取消、正常完成均有确定结果。

### OPT-3.2 输入与目录预算 — `[ ]`

- [ ] realpath/junction/symlink 循环保护。
- [ ] 深度/条目/单文件/批量/merge 总量上限。
- [ ] 本地/外链图片有界并发与 warning 顺序。
- [ ] DNS/连接/超时/取消/缓存预算。

**证据**：当前 `paths.ts`、merge、图片 resolver 尚无完整契约。
**退出条件**：压力输入在预算内结束且不留半成品。

### OPT-3.3 临时文件、预览与 Mermaid — `[ ]`

- [ ] clipboard Markdown 一次性 cleanup handle。
- [ ] preview generation/串行刷新。
- [ ] Mermaid epoch/dispose。
- [ ] 取消后 after-convert/临时资源清理。

**证据**：`temp-html.ts`、preview、Mermaid 尚有缺口。
**退出条件**：成功/失败/取消/退出均无敏感临时文件和孤儿窗口。

### 阶段 3 门禁

- [ ] OPT-3.1～3.3 全部 `[x]`。
- [ ] 取消/超时/压力/生命周期测试全绿。
- [ ] 阶段 2/3 的红测试全部转绿并按逻辑单元提交。

## 5. 阶段 4：renderer UX、向导、动态 i18n、主题

### OPT-4.1 舞台与模态交互 — `[ ]`

- [ ] dropZone region/事件隔离。
- [ ] 内部控件统一冒泡阻断。
- [ ] 模态/向导/菜单/快捷键完整 GUI 验收。

### OPT-4.2 初始化、向导和语言 — `[ ]`

- [ ] settings/language/theme 初始化 barrier。
- [ ] 动态状态不由静态 i18n 覆盖。
- [ ] 向导重开同步最新设置。
- [ ] main 语言/菜单/标题栏同步。

### OPT-4.3 预设与取消状态 — `[ ]`

- [ ] D-02 作用域文档/代码/文案统一。
- [ ] 内置 `TEMPLATE_PRESETS` 提示三语化（消除 core 硬编码 hint）。
- [ ] `resolvePresetHint` 自定义/微调分支可达性与提示复位。
- [ ] canceled 中性视觉与批量标题组合。
- [ ] 复制状态复位与 i18n。

### OPT-4.4 键盘、ARIA、视觉契约 — `[ ]`

- [ ] 历史/队列/设置 Tab/向导 label 与错误关联。
- [ ] 进度阶段播报。
- [ ] 消息固定槽、深色对比度、网格/token/pulse 修复。
- [ ] 几何 gate 失败可定位。

**阶段 4 门禁**：以上四组全部 `[x]`，几何与人工 GUI 验收完成。

## 6. 阶段 5：边界、双管线契约、测试工程

### OPT-5.1 边界契约 — `[~]`

- [x] 部分 IPC contract 归位。
- [ ] main logic 纯化/IO 边界明确。
- [ ] renderer/preload type-only 依赖清理。
- [ ] import boundary 自动检查。

### OPT-5.2 双管线差异矩阵 — `[ ]`

- [ ] 必须一致/允许不同矩阵。
- [ ] differential fixtures。
- [ ] heading/caption/equation/HTML/TOC 显式契约。
- [ ] PDF 目录结构化数据渐进替换。
- [ ] DOCX Ctx 按范围拆分。

### OPT-5.3 测试工程 — `[~]`

- [x] coverage/fixture/77 段基础门禁。
- [x] core/main coverage 范围明确。
- [ ] 全部测试 `checkJs`。
- [ ] 逐段子进程隔离与失败 artifact。
- [ ] fixture 显式注册、mock 边界、case 级报告。

**阶段 5 门禁**：以上全部 `[x]`，checkJs/runner/fixture/差异测试通过。

## 7. 阶段 6：发布可重复性、供应链、视觉/安装

### OPT-6.1 clean build/ASAR — `[~]`

- [x] clean dist：`clean:dist`/`clean:release` 在 dist 链的 build 之前（`scripts/clean-artifacts.mjs`；只删 dist/release 两个生成目录，路径/存在/链接/白名单守卫齐备）。
- [x] dist/ASAR manifest/hash/入口可达性核对进入 `dist` 链：清单在 electron-builder 之前生成，包内 `dist/**` 与清单逐项 SHA-256 交叉核对（证明「打进包的就是本次 dist」，并挡住顶层误打包）。
- [x] 陈旧/改名残留探针已实跑：向 dist 注入模拟残留后 `check:dist-manifest --check` 判红（`产物陈旧(stale):core/__stale_probe.js`），移除后复验转绿。
- [x] 本机整条 `npm run dist` 实跑通过：clean → build → 清单(262 文件)→ electron-builder → `check:dist-manifest` ✓ → `check:asar` ✓(10633 个文件、与清单核对 262 项)→ `check:release` ✓(3.12.0 三件套、无历史残留、SHA-256 报告已生成)。
- [ ] 删除/重命名**源**文件探针（真改源码验证产物随之消失，未做）。

### OPT-6.2 供应链 — `[~]`

- [x] Node/lockfile/版本一致性基础。
- [ ] OSV/SCA、SBOM、许可证/NOTICE。
- [ ] action SHA/环境指纹。
- [ ] 安装包 hash、未签名提示与状态记录。

### OPT-6.3 视觉/安装验证 — `[ ]`

- [ ] geometry gate 进入 CI/Release。（脚本与 workflow 步骤已随阶段 0 接好：几何门禁在 `verify:ci` 链内，主 CI 与 Release 均 `always` 上传报告/截图；待真实 GitHub lane 运行记录后再勾）
- [ ] 截图 artifact/失败定位。（同上，artifact 步骤已就位，缺远端实证）
- [ ] unpacked 启动、ASAR 清单、安装/启动/卸载 smoke。（ASAR 清单核对已在 `dist` 链内；unpacked 启动与安装/卸载 smoke 未做）

**阶段 6 门禁**：发布链路完整、产物可追溯、geometry/安装验证全绿。

## 8. 阶段 7：P2/P3 维护与可选提升

- [ ] coverage/fixture/smoke 故意失败探针与报告（阶段 0 后置项）。
- [ ] assertion helper/机器可读 smoke。
- [ ] 临时资源 helper、ASAR/EXE 体积实测。
- [ ] 允许版本线内 patch/minor。
- [ ] prerelease、allowed path、fsync、权限 handler、Mermaid warning。
- [ ] 完成态动画、复制状态、about 标题、初始焦点、队列/脉冲等 UI polish。
- [ ] 跨 DPI 像素基线（后置）。

## 9. 当前工作树残留处理

- [x] 阶段 2 集成红测试已转绿并纳入 2A 提交。
- [x] 阶段 3 `test/pending/` 红测试已隔离，不参与当前 acceptance；阶段 3 实现时迁回并拆分。
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
