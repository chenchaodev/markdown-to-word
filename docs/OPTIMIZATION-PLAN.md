# 全库代码优化开发计划

> **状态**：阶段 0 本地门禁已完成（远端 lane 证据待补）；阶段 1 部分完成；阶段 2A 已完成、2B 输出原子提交待办；阶段 3 未开始（仅待实现红测试草稿）；阶段 4-7 按 checklist 依赖推进。
>
> **执行台账**：`docs/OPTIMIZATION-CHECKLIST.md`。每阶段开始/结束必须逐项更新，未满足门禁不得进入下一阶段。
>
> **范围**：纳入裁决后的全部可行动 P0/P1/P2/P3 问题；按“先不变量、后结构、再体验与发布工程”推进。
>
> **原则**：一个逻辑单元一个提交；每项可独立回退；行为变化必须有断言或人工验收；不把双管线合并成大重构。

## 1. 已确认的产品与工程裁决

| ID | 裁决 | 落地要求 |
|---|---|---|
| D-01 | 宿主 Node 统一提升到 **22.13+**（满足当前 ESLint/Electron engine，仍在批准的 22.12+ 范围内） | 保持 Electron 43、markdown-it 14.3、remark/自研 docx、markdown-it+HTML+printToPDF PDF 路线；同步 package、CI、Release、文档和验证矩阵。 |
| D-02 | 预设按最新“完整交付链” | 内置预设覆盖排版、编号、页眉页脚、水印、公式编号和 H1 分页；统一设计文档、USER-GUIDE、CHANGELOG、ACCEPTANCE、UI 文案和 toast。自定义预设的存储范围必须显式定义。 |
| D-03 | 本地图片严格限制 | 仅允许源文档目录或明确可信根目录内图片；校验扩展名/魔数/大小；拒绝绝对路径、UNC 和越界 `..`。 |
| D-04 | 暂不代码签名 | 不接入证书；加强发布哈希、发布说明、SmartScreen 提示、签名状态记录和产物验证；将“未签名”保留为明确风险。 |
| D-05 | 几何门禁强制、像素基线后置 | CI/Release 强制检查关键窗口的溢出、固定槽、舞台稳定性和 DOM 几何；截图保留 artifact/人工复核，跨 DPI 像素 diff 后续再做。 |
| D-06 | 双管线保持独立 | 不合并 remark 与 markdown-it；建立输入准备、设置、预算、错误和共同语义的差异矩阵与 differential fixtures。 |
| D-07 | 全部测试纳入 `checkJs` | 清理测试类型错误，测试、runner、mock 不再依赖隐式 any；新增测试不得绕过类型门禁。 |
| D-08 | 测试段逐子进程隔离 | 每段独立进程、硬超时、资源回收、case 级报告和失败 artifact；覆盖旧的“不做”裁决。 |
| D-09 | 外链图片默认允许但严格限额 | 保留 HTTP(S) 功能；统一 DNS/连接校验、取消、超时、单图/文档总量/并发预算和失败 warning。 |
| D-10 | 自动更新继续排除 | 保留手动检查更新/下载；不把无自动更新作为本轮缺陷。 |
| D-11 | resolver/HTTP 缓存增加上限 | LRU + 条目数 + 字节数 + 文档/会话预算；失败不缓存。 |
| D-12 | 纳入全部可行动问题 | P0/P1/P2/P3 均进入计划；仅保留 D-04、D-06、D-10 及项目硬约束明确排除项。 |

## 2. 全局实施规则

1. 先写/更新对应测试与失败探针，再改实现；行为等价重构不改变用户结果。
2. core 行为改动跑对应 segment + smoke；main 改动跑 main 测试 + IPC/失败路径；renderer 改动跑 renderer 测试 + GUI/几何验收。
3. 每个阶段拆成独立提交，提交前至少通过 `typecheck`、`lint`、`build` 和受影响测试；发布相关改动另跑 T6。
4. 不使用 `reset --hard`、删除式回滚或改写历史；优先 `git revert`。
5. 不回退 Electron 43、markdown-it 14.3、docx 9.x、remark 自研 docx、PDF HTML/printToPDF、集中字体配置、显式分页符、国内镜像和 HTML 白名单等硬约束。
6. 不引入大型依赖注入框架，不合并双管线，不做 Electron 44、markdown-it 15、Mermaid 12、electron-builder 27 alpha 或其他未批准 major 升级。
7. 发现新的产品边界或安全取舍，先记录决策，不在实现中隐式决定。

## 3. 阶段总览与依赖

```text
阶段 0 决策/基线/门禁
  ↓
阶段 1 single-flight、取消、持久化一致性
  ↓
阶段 2 内容完整性、页面几何、输出原子性
  ↓
阶段 3 资源预算、生命周期、取消传播
  ↓
阶段 4 renderer UX、向导、动态 i18n、主题
  ↓
阶段 5 core 边界、双管线差异契约、可测试性
  ↓
阶段 6 发布可重复性、供应链、视觉/测试门禁
  ↓
阶段 7 P2/P3 维护、性能、体积、可选质量提升
```

## 4. 阶段 0：决策落地、基线与门禁（P0）

### OPT-0.1 Node 与工程口径

- 更新 `package.json` engines、lockfile/安装检查、CI、Release、DEV-GUIDE、README 和本计划中的 Node 口径为 22.13+（满足当前 ESLint/Electron engine，仍在批准的 22.12+ 范围内）。
- 在 Node 22.13+、当前稳定 Node 22/后续支持版本分别执行安装、build、typecheck、lint、smoke。
- 记录 `node --version`、`npm --version`、Electron/Chromium/内置 Node 版本和环境指纹。

### OPT-0.2 统一验证入口

- 新增 `verify:ci`：build → typecheck → lint → acceptance → coverage → fixture drift → smoke → geometry gate。
- 新增 `verify:release`：复用 `verify:ci`，追加 clean dist、ASAR manifest、安装包 hash/结构检查。
- Release 不再维护一份缩水的独立命令清单；Node 版本和失败语义与 CI 一致。
- 故意制造 coverage、fixture、smoke、geometry 失败，确认门禁能阻止发布。

### OPT-0.3 决策与问题台账

- 建立 issue register、decision log、source coverage、test matrix。
- 把 D-01～D-12 的答案、证据、负责人、验收和回退点写入台账。
- 不把已明确不做项重新混入开发任务；保留引用和理由。

### 阶段 0 验收

- CI、Release、开发者文档的 Node 和命令一致。
- 每个 actionable issue 都有唯一 ID、阶段、文件范围、测试层和回退点。
- 发布无法绕过约定门禁。
- 不修改业务行为即可独立回退本阶段。

## 5. 阶段 1：操作 single-flight、取消与持久化一致性（P0）

### OPT-1.1 main operation registry

- 在 `src/main/ipc/register.ts`、`src/main/ipc/logic.ts`、`src/main/windows/web-contents-registry.ts` 建立以 `webContents.id` 为边界的权威操作注册。
- 同一窗口只允许一个转换/预检/批量/合并活动操作；第二次请求返回明确 busy 或受控排队结果。
- context 注销采用 compare-and-delete，旧任务不能删除新任务 context。
- 主窗关闭、取消、预检、向导和 renderer 快捷键共享同一操作状态。

### OPT-1.2 renderer command/precheck lock

- 在 `src/renderer/convert/convert-flow.ts`、`convert/events/convert-actions.ts`、预检弹窗链路增加 `prechecking`/command 状态。
- 预检 Promise 单实例；任何关闭路径都必须结算 Promise。
- 模态、向导、转换期间禁止背景快捷键和新命令；skip/下一步统一执行前置校验。

### OPT-1.3 settings/ui-state mutation queue

- 在 `src/main/persist/settings.ts`、`ui-state.ts`、`atomic-json.ts` 将“读当前值 → 合并 patch → 序列化 → 提交缓存”整体放入同一 mutation queue/mutex。
- 修复最近文件、窗口 bounds、会话文件、预设/设置并发丢更新。
- 写失败保留编辑内容并反馈保存失败，不再静默显示成功。
- 去掉 renderer 重复 session 持久化调用，保证缓存只在成功提交后更新。

### OPT-1.4 批量副作用

- 明确单文件、批量、合并的 after-convert 所有权：批量/合并结束后只执行一次。
- 设置在批次开始取得 immutable snapshot，批次中修改设置不能产生混合配置。
- 取消后禁止 after-convert。

### 阶段 1 验收

- 并发转换最大活动数为 1。
- 双击、连续 Ctrl+Enter、预检中再转换、向导中转换均得到单一明确结果。
- cancel 指向当前操作；关窗确认状态正确。
- 并发写 settings/ui-state 后所有字段都保留，重启不回退。
- after-convert 调用次数准确；保存失败可见。

### 阶段 1 回退

- operation registry、renderer lock、mutation queue、批量副作用分别提交。
- IPC 返回结构变化时 preload/renderer/测试同批回退。
- 不把 UI 状态修复与持久化队列合成单一不可回退提交。

## 6. 阶段 2：内容完整性、页面几何与输出原子性（P0）

### OPT-2.1 Markdown 预处理安全

- 统一 frontmatter 解析边界，支持 LF/CRLF/单独 CR；普通 `---` thematic break 不误判。
- AI 清理复用正式 frontmatter 契约。
- Obsidian 转换跳过 fenced code、inline code、HTML code 和 escaped 文本；优先使用 tokenizer/AST 位置感知方案。
- 开关关闭时保证输入字节级不变；预览、预检、docx、PDF 使用同一准备链。

### OPT-2.2 页面几何 validator

- 在 core 建立唯一 `validatePageSetup()`，依据纸张与方向计算可用宽高。
- 校验左右/上下边距和最小内容区；在 renderer、main sanitize、core render 边界重复执行。
- 旧 settings 明确迁移、钳制或拒绝并给 warning。
- 覆盖 A4/A3/A5/Letter/Legal、portrait/landscape、0/1000/越界组合。

### OPT-2.3 输出选名与原子提交

- 将选名和占位合并为独占创建；`EEXIST` 重新选择序号。
- 产物使用同目录临时文件 + 原子提交；失败清理临时文件。
- docx、PDF、批量、合并统一提交策略。
- 防止单文件、合并、批量和外部进程互相覆盖；进程中断不留下可被误认成功的最终文件。

### 阶段 2 验收

- 代码区、CRLF/CR、frontmatter 边界 fixture 双格式一致。
- 无效边距在 UI/main/core 三层一致拒绝或迁移。
- 并发同名转换不覆盖；中断后无错误最终文件；ZIP/PDF magic 完整。
- 旧 settings 可加载且有明确反馈。

### 阶段 2 回退

- 预处理、几何、输出三个 epic 完全独立提交。
- 输出层失败只回退输出提交，不回退 core 渲染。
- 保留旧格式读取与迁移备份。

## 7. 阶段 3：资源预算、取消传播与生命周期（P0/P1）

### OPT-3.1 core 取消与预算契约

- `ConvertContext` 增加 AbortSignal/deadline；docx block loop、pdf 阶段和异步 resolver 检查取消。
- 单 URL 超时、单图大小、文档图片数量/总字节、图片并发和 KaTeX `maxSize`/`maxExpand` 有明确上限。
- 取消使用独立错误码/状态，不与普通失败混淆。
- 同步解析也至少在阶段边界检查取消；必要时评估 worker/分片。

### OPT-3.2 输入与目录预算

- `collectMarkdownPaths` 用 realpath/visited 处理 symlink/junction，增加深度、条目数和总字节上限。
- handler 限制路径数量、单文件大小、批量总量和 merge 总内存。
- PDF 本地图片使用有界 worker；外链图片使用有界 worker + DNS/连接校验。
- 失败 warning 顺序和降级行为稳定可测。

### OPT-3.3 临时文件、预览与 Mermaid

- clipboard Markdown 使用一次性句柄；成功、失败、取消、退出均在 finally 清理。
- preview entry 增加 generation/串行刷新；旧任务不得清理新任务或覆盖新页面。
- Mermaid service 增加 epoch/dispose；旧任务不得在 dispose 后重建窗口。
- 输出 after-convert 受取消状态控制。

### 阶段 3 验收

- 永不 resolve 的 resolver、超大 TeX、大量图片、junction 环和数千路径均在预算内结束。
- 取消后不进入后续渲染，不产生未声明最终文件。
- 粘贴各路径无残留；preview 只保留最新结果；dispose 后无孤儿窗口。
- warning、超时、取消和普通失败有独立可观察状态。

## 8. 阶段 4：renderer UX、向导、动态 i18n 与主题（P1）

### OPT-4.1 舞台与模态交互

- `#dropZone` 改为 region/普通容器；祖先 Enter/Space/click 仅在自身目标响应。
- 统一内部控件事件隔离；首启引导、粘贴、向导、预览、追加、清空只触发一个动作。
- 预检/向导/完成弹窗实现单实例、Esc、遮罩关闭、焦点陷阱和 Promise 结算。

### OPT-4.2 初始化、向导和语言

- settings/language/theme 加载完成后恢复 UI state；或增加初始化 barrier 后统一重绘。
- 动态节点不再由 `applyStaticTexts` 覆盖真实输出目录、Logo、CSS、预设状态。
- 向导每次打开完整同步最新 settings；语言变化刷新所有动态文案。
- main 同步语言、菜单、标题栏 overlay 和设置副作用。

### OPT-4.3 预设与取消状态

- 按 D-02 统一内置/自定义预设字段、toast、提示、恢复默认、文档和验收。
- 取消使用独立中性状态；批量标题按成功/失败/取消组合生成。
- 复制按钮状态每次打开复位，不破坏 i18n。

### OPT-4.4 键盘、ARIA、视觉契约

- 最近记录、队列预览、设置 Tab、向导 label/checkbox/switch、错误、进度补齐键盘和程序关联。
- 错误就地显示并使用 `aria-invalid`/`aria-describedby`/appropriate live semantics。
- 消息区恢复固定槽；保证 640×560、880×620、1280×680 几何稳定。
- 修正深色朱砂/弱化文字对比度、队列卡壳、双脉冲、向导三列网格、未定义 token、about 主题/token。
- 清空历史/恢复默认增加确认或短时撤销；保留设计稿视觉结构。

### 阶段 4 验收

- 仅键盘/读屏可完成选择、预览、队列排序、设置、向导、预检、取消和错误恢复。
- 三语切换后动态状态与真实设置一致。
- 640×560 等尺寸无页面级滚动和舞台跳动。
- 视觉几何 gate 自动失败可定位；截图 artifact 可人工复核。

## 9. 阶段 5：core 边界、双管线契约与核心可测试性（P1/P2）

### OPT-5.1 边界契约

- 明确 core 是 Node-compatible 尽量无 IO，还是严格无 IO；将 FS/Electron 适配器移到 main 或修正文档。
- 公共 IPC/API 类型归位到 contract；消除 renderer → main 实现路径依赖、ctx/handler type-only cycle。
- 直接使用的传递依赖改为直接声明或稳定公开入口。
- 增加轻量 import boundary 检查，禁止新的反向依赖。

### OPT-5.2 双管线差异矩阵

- 共同语义抽成纯函数/契约：输入准备、页面设置、编号、题注、交叉引用、HTML 白名单、编码、警告。
- 建立“必须一致/允许不同”矩阵与 differential fixtures。
- 修复 `convert()` heading/caption 显式选项契约。
- 逐步将 PDF 目录/页码从 HTML 正则反解析改为结构化数据。
- 按触碰范围拆 DOCX `Ctx`，不一次性大重构。

### OPT-5.3 测试工程

- 全部 test/runner/mock 纳入 `checkJs`。
- `test:coverage` 继续覆盖 core/main 自动验证产物；renderer GUI 编排层按既定人工验收边界排除，但 renderer 自动断言必须继续执行。
- 测试段逐子进程隔离、硬超时、资源回收、case 级报告和失败 artifact。
- fixture 改为显式注册契约；import 失败不再静默跳过。
- Electron mock 明确只做导入/fixture 验证，真实行为由 acceptance/smoke 负责。

### 阶段 5 验收

- import boundary、类型、依赖声明自动守护。
- 双格式共同语义与允许差异有测试。
- runner 超时不会污染后续段；失败定位到 case。
- 全部测试通过 `checkJs`，关键目录覆盖率可追踪。

## 10. 阶段 6：发布可重复性、供应链与视觉/测试门禁（P0/P1/P2）

### OPT-6.1 clean build 与 ASAR

- 每次正式 build 从空 dist 开始，避免增量残留 JS/map。
- 生成并校验 dist/ASAR manifest、关键文件 hash 和入口可达模块。
- freshness 从 mtime 启发式升级为 manifest/hash 或明确标记为弱防护。
- 验证删除/重命名源文件、缺 dist 文件、静态资源变化均能被发现。

### OPT-6.2 发布供应链

- 保持国内 npm 镜像；接入可用的 OSV/SCA 替代源，区分 production/dev/build，保存 SBOM。
- 生成第三方许可证/NOTICE 清单；不把“audit 不可用”表述为“无漏洞”。
- 固定关键 Node patch、runner/action SHA 和环境指纹；在允许版本线内跟进 patch/minor。
- 按 D-04 生成安装包 SHA-256、发布说明、SmartScreen/未签名提示和签名状态记录；不接入证书。

### OPT-6.3 视觉与安装验证

- geometry gate 强制进入 CI/Release；截图作为 artifact。
- 覆盖空/单/多/历史/转换中/完成/批量/向导/设置/about/错误/取消/三语/浅深主题。
- 打包后执行 unpacked 启动、ASAR 清单、安装/启动/卸载 smoke。
- `test:all`、`verify:ci`、`verify:release` 文档与脚本契约一致。

### 阶段 6 验收

- tag 不能绕过 coverage、fixture、smoke、geometry。
- 陈旧产物、fixture 漂移、coverage 下降、smoke 超时、Node engine 不一致均阻止发布。
- 产物 hash、ASAR manifest、依赖/许可证/SBOM 可追溯。
- 未签名状态被明确告知，不伪装为已签名。

## 11. 阶段 7：P2/P3 维护、性能与质量提升

纳入但不阻塞主线：

- assertion helper、机器可读 smoke、统一临时资源 helper。
- 生产 ASAR/EXE 体积测量后再处理 Mermaid/重复 KaTeX；不强制 overrides。
- 允许 Electron 43.x、markdown-it 14.3.x、docx 9.x、KaTeX 0.18.x 等批准范围内 patch/minor。
- prerelease 版本比较、允许路径失效、显式 fsync、权限 handler、Mermaid warning 可见性。
- 完成态动画、标点、about 标题、初始焦点、队列卡壳、双脉冲、复制状态等 UI polish。
- 只在环境稳定后建立跨 DPI 像素基线。

## 12. 完整问题覆盖索引

| 计划 ID | 覆盖的 canonical 问题 | 阶段 |
|---|---|---|
| OPT-1.1/1.2 | single-flight、ctx 覆盖、precheck/向导并发、取消指向、关窗竞态 | 1 |
| OPT-1.3 | settings/ui-state 丢更新、保存失败静默、重复持久化 | 1 |
| OPT-1.4 | N+1 after-convert、批次设置混合、取消副作用 | 1 |
| OPT-2.1 | AI/Obsidian 内容破坏、CRLF/CR、代码区、预处理不一致 | 2 |
| OPT-2.2 | 边距几何、负内容宽高、旧配置迁移 | 2 |
| OPT-2.3 | 输出 TOCTOU、覆盖、半成品、原子提交 | 2 |
| OPT-3.1 | core AbortSignal/deadline、图片预算、KaTeX 资源边界 | 3 |
| OPT-3.2 | symlink/junction、数量/大小/内存上限、本地图片无界并发 | 3 |
| OPT-3.3 | clipboard 临时文件、preview refresh、Mermaid dispose | 3 |
| OPT-4.1 | dropZone、模态、precheck、键盘事件隔离 | 4 |
| OPT-4.2 | 初始化竞态、动态 i18n、main 语言/主题、向导缓存/语言 | 4 |
| OPT-4.3 | 预设作用域、取消视觉、复制状态 | 4 |
| OPT-4.4 | 键盘/ARIA/错误/进度、固定槽、对比度、主题、网格、视觉债 | 4 |
| OPT-5.1 | core/main/renderer 边界、IO、类型 cycle、传递依赖 | 5 |
| OPT-5.2 | 双管线选项、题注/编号/HTML/TOC、目录正则、Ctx | 5 |
| OPT-5.3 | checkJs、coverage、runner 隔离、fixture、mock | 5/6 |
| OPT-6.1 | dist 残留、ASAR manifest、hash freshness | 6 |
| OPT-6.2 | 浮动环境、SCA、SBOM、许可证、依赖策略、发布哈希 | 6 |
| OPT-6.3 | 几何 gate、截图 artifact、打包安装/启动/卸载、入口一致性 | 6 |
| OPT-7 | P2/P3 性能、体积、低成本 UI、局部加固、允许范围升级 | 7 |

### 明确不进入实现的任务

- 自动更新（保留手动检查/下载）。
- 代码签名本身（保留发布风险说明和哈希/提示）。
- 双管线合并、CLI 转正、文档加密、云端 AI、完整 CSL、表格合并、目录监视、PDF 多栏。
- Electron 44、markdown-it 15、Mermaid 12、electron-builder 27 alpha 等未批准 major。
- 大型依赖注入框架、无差别全 GUI 自动化、跨 DPI 像素基线（后置）。

## 13. 每个任务的完成定义

1. 行为变化有自动断言，或明确列入 `ACCEPTANCE.md` 的人工 GUI 项。
2. 失败、取消、超时、降级、清理路径可观察且有测试。
3. 旧配置/旧数据可迁移或明确拒绝，不静默丢数据。
4. 提交可独立 revert，文档/测试/配置与代码同批。
5. 通过 T0；按影响范围通过 T1～T6。
6. 不违反 D-01～D-12 和项目硬约束。
7. 新的产品决策先记录，不在实现中隐式决定。

## 14. 执行前待办

- 用户确认本计划后，按项目流程将 actionable 项登记/晋升到 `BACKLOG.md` 与 `ROADMAP.md`。
- 开发前读取 `CODE-GUIDE.md`；Windows 命令/构建异常时读取 `WINDOWS-GUIDE.md`。
- 每个阶段开始前建立对应测试安全网和回退点。
- 本文件是开发计划，不代表任何阶段已经获得执行授权。
