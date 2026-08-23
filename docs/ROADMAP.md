# 路线图与迭代规划

> 2026-08-02 18:20:36 制定,19:20:18 因需求变更(GUI)修订;21:43:23 二期规划经 @oracle 评审重排。迭代完成记录见 `docs/CHANGELOG.md`;选型结论见 `docs/ADR.md`(ADR-001/002);调研证据见 `docs/RESEARCH.md` 与 `docs/archive/` 存档。
> 2026-08-13 整理:待办收敛为「当前待办」唯一入口(合并原待办排期/延后/批次 8-9 备选暂缓,去重),历史规划压缩至「已完成」节,详情见 archive 存档。
> 2026-08-23 全库质量审计后新增「审计改进排期 B1-B14」(全部待办唯一明细在此;证据链见 archive/2026-08-23-133005)。

## 需求范围
- Windows 桌面 GUI 应用:选择 markdown 文件 → 转 .docx / .pdf
- GUI 界面中文;中文内容排版可控(硬需求);架构预留其他格式扩展(「等」)

## 语法覆盖范围(转换矩阵)
| 语法 | 支持 | 阶段 |
| ---- | ---- | ---- |
| 标题/段落/粗斜体/行内代码/链接/引用 | ✅ | G1 |
| 无序/有序/嵌套列表 | ✅ | G1 |
| 表格/代码块(等宽字体)/图片(本地路径) | ✅ | G1 |
| GFM 删除线/任务列表 | ✅ | G3 联调期顺手 |
| 脚注/公式/docx 代码高亮/目录 TOC | ✅ | 二期 |
| raw HTML 白名单(14 个无属性内联标签) | ✅ | 批次 5 |

## 里程碑(全部完成)
| 阶段 | 内容 | 状态 |
| ---- | ---- | ---- |
| G1 core 打底 | remark 管线 + docx 完整渲染 + eastAsia 字体 | ✅ |
| G2 Electron 骨架 | 窗口 + preload + IPC + 文件选择/拖放 | ✅ |
| G3 转换联调 | convert IPC + 进度事件 + 输出落盘 | ✅ |
| G4 PDF 自研 | markdown-it + HTML 模板 + printToPDF + 高亮 | ✅ |
| G5 收尾 | 错误处理 + electron-builder(NSIS)打包实测 | ✅ |

## 当前待办(唯一入口)
> 2026-08-13 整理:合并原「待办(排期)」「延后(不排批)」与批次 8/9「备选/暂缓/不做(记后续)」并去重,历史规划压缩至「已完成」节,详情见 archive 存档。
> 2026-08-23 全库质量审计后新增「审计改进排期 B1-B14」(全部待办唯一明细在此;证据链见 archive/2026-08-23-133005)。
> 2026-08-23 目录结构优化方案探查定稿入待办(暂缓排期,排在现有待办之后;实施前须重新探查;证据链见 archive/20260823-230554)。

### 审计改进排期 B1-B14(2026-08-23,完成即勾选)
> 原则:每项独立提交可回退;core 行为改动须补测试段断言;重构行为等价。规模:S≤3 文件 / M 中 / L 大。决策点已于 2026-08-23 全部拍板(见各条「已拍板」)。

#### B14 文档修正(S,零风险,建议最先做)
- [ ] docs/README.md:3 自述「命令行工具」→「Windows 桌面应用」
- [ ] convert.ts 头注释「docx 无代码高亮」差异行更新(0.32.0 已实现 code-highlight.ts)
- [ ] WPS-COMPAT.md 目录条目修正:「页码占位」失实 + 「非域却称更新域可刷新」自相矛盾(实为无页码静态列表)
- [ ] WPS-COMPAT 矩阵状态回填(0.31.0 双实测整体通过:矩阵标 ✅ 或表头注明「整体按通过处理」)
- [ ] ui-state.ts:156 panelOpen 默认值注释修正(缺省 false 非 true)
- [ ] 根 README 安装节补 ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR 前置说明(指向 DEV-GUIDE)
- [ ] USER-GUIDE FAQ 扩充:公式未编号排查 / 图片不显示排查 / SmartScreen 未签名安装提示

#### B1 安全加固·预览链路(M,P0)
- [ ] buildTemplate 加 CSP meta(template.ts:218-231;对齐 mermaid 窗口既有实践)
- [ ] pdfCss/katexCss 注入前净化 `</style` 序列(template.ts:208,224)
- [ ] 外链导航收口:四类窗口 setWindowOpenHandler deny + will-navigate preventDefault;外链改 shell.openExternal 仅 https/http(index.ts + template.ts)
- [ ] IPC 参数类型守卫统一:convert filePath/format、shell:reveal/open、preview:open、paths:* 数组元素校验,非法返回 {ok:false}(index.ts:318,350-355,486-501)
- [ ] session.setPermissionRequestHandler 显式全拒(低优先加固)
- [ ] mermaid-service CSP unsafe-inline 已知接受项注释固化(mermaid-service.ts:46)

#### B2 主进程健壮性(M,P0)
- [ ] requestSingleInstanceLock + second-instance 聚焦已有窗口(index.ts)
- [ ] unhandledRejection/uncaughtException 兜底日志;index.ts:119/192 void loadFile/loadURL 补 catch
- [ ] 关窗时活动转换拦截确认(close 检查 ctxByWebContents;index.ts:128-137)
- [ ] refreshPreviewWindow loadFile reject 补 oldCleanup 防 tmp 残留(index.ts:200-215)
- [ ] activate 监听移到 createWindow 前(index.ts:562-585)
- [ ] mergeConvertImpl 尊重 skipAfterConvert(与 convertImpl 对齐;converter.ts:456 vs 261)
- [ ] resolverCache 容量上限/LRU(converter.ts:67)
- [ ] mermaid-service 超时后 destroy 重建窗口再放行队列(mermaid-service.ts:138-152,180-187)
- [ ] smoke 断言去中文冻结:菜单/守卫文案按 t() 取值或强制 zh 运行(smoke.ts:88,222-227)

#### B3 core 数据与渲染正确性(L,P0;每项独立小修+断言)
- [x] frontmatter 守卫:块内至少命中一个已知 key 才认定,防误吞 `---` 开头正文(frontmatter.ts:24)(7d85fad)
- [x] slug 截断碰撞:id.slice(0,40) 场景追加短哈希保书签唯一(slug.ts:32)(c9e16b6)
- [x] headingNumbering=false 题注编号双格式对齐(captions.ts:60-66 vs 注释 49-51 vs pdf 连续;已拍板:全文档连续,docx 向 pdf 对齐并修正注释)(c9e16b6)
- [x] docx 表格列对齐:消费 mdast table.align(docx/render.ts renderTable)(B3c 批次)
- [ ] 列表项/引用块内不支持块级内容的处理见 B4(此处仅登记关联)
- [x] eq label 登记口径双格式对齐(docx equations.ts:48 vs pdf/render.ts:230-234;已拍板:pdf 放宽对齐 docx,粗斜体包裹的 label 也生效)(B3c 批次:pdf label 识别改为整段纯文本串接匹配)
- [x] encoding:UTF-16 BE BOM(FE FF)识别 + UTF-16 LE encoding 字段如实返回(encoding.ts)(7d85fad)
- [x] 白名单扫描大小写对称(闭标签加 i)+ 自闭合 `<br/>` 分支(pdf/render.ts:550,556;html-whitelist.ts:32)(B3c 批次;复核修正:两处闭标签均先 toLowerCase 再严格匹配,本无大小写缺陷——真实缺口仅自闭合 `<br/>`,三处扫描器 html-whitelist/pdf matchAllowedHtmlExpression/docx parseInlineHtml 同步放行,非空标签自闭合仍非法)
- [x] merge absolutizeImages 感知代码块(fenced/inline 内不改写)+ index=0 frontmatter 剥离(merge.ts)(B3c 批次;复核修正:index=0 frontmatter 保留为设计决策(merge.ts 头注释「首文件保留原样」),不改;代码块感知经占位符摘除围栏+行内代码后替换再还原)
- [x] merge 分页符叠加防空白页(join 前检查尾部已有 page-break;merge.ts:18,42)(B3c 批次:尾部已有显式分页符改普通空行拼接)
- [x] 脚注重复引用共享同一脚注 id(docx/render.ts:975-982)(c9e16b6)
- [x] docx 悬空交叉引用/公式 label 警告去重(对齐 pdf unknownLabels 模式;render.ts:895,944)(c9e16b6)
- [x] pdf metadata date 解析失败不静默兜底当前时间(metadata.ts:25)(7d85fad)
- [x] image-type 未知字节兜底策略(已拍板:跳过嵌入+警告,不再伪装 png;image-type.ts:27,92)(B3c 批次:sniffImageType/mimeFromBuffer 未知返回 null,docx imageToDocx 与 pdf embedExternalImages 调用方跳过+unrecognizedImageWarning 统一文案)

#### B10 工程门禁与测试基建(M,P1,建议在功能批前建立护栏)
- [x] 新增 ci.yml(PR/push:windows-latest,typecheck+lint+build+test;concurrency 组;timeout-minutes)(B10a 批次)
- [x] release.yml 加固:concurrency / timeout-minutes / 失败 artifact 上传(B10a 批次)
- [x] acceptance.mjs 最早期 app.setPath("userData", tmpdir) 隔离(settings/i18n/ui-state/converter 段适配;消除真实 %APPDATA% 读写;原型 patch 限制并行为已知不专项)(B10a 批次;40 段全绿验证通过,无需段内适配)
- [x] runner 逐段超时看门狗(可配置)+ 总时长/最慢段排行输出(+可选 expect 式 diff 增强)(B10a 批次:M2W_SEGMENT_TIMEOUT_MS/acceptance 默认 180s;排行输出已做,diff 增强未做)
- [x] tsconfig incremental:true(build/test 提速)(B10a 批次;坑:产物被外部删除后 tsc 不重建,恢复须 tsc --build --force,见 RESEARCH 同日条目)
- [x] tsconfig 启用 noUncheckedIndexedAccess(存量适配)(B10c 批次:3 子代理按域并行,约 145 错清零;修复全部行为等价——循环边界后 `!`+不可达依据注释为主,bookmarks 跟随既有 null 守卫风格)
- [x] 删除死配置 tsconfig.eslint.json(B10a 批次;eslint.config.js 用 projectService 无引用,已核实)
- [x] test:smoke 构建新鲜度守卫(src mtime vs dist mtime,过期报错或自动 build)(B10a 批次:scripts/check-build-fresh.mjs 前置拦截)
- [x] copy-renderer.mjs 加 dist/renderer 清空步骤(防陈旧资源进安装包)(B10a 批次;坑:混合目录不可整删,按 .html/.css 扩展名清理,见 RESEARCH 同日条目)
- [x] scripts/svg-to-ico.mjs 登记 icons npm script(B10a 批次)
- [x] docx 解包机制统一 jszip(common/docx-utils.js 删系统 tar 路径)(B10b 批次:unzipPart 转 async,71 处调用点适配,验收总耗时 23.5s→19.1s)

#### B6 i18n 收口(M,P1;为 B4 提供 key 机制;2026-08-23 完成,commit 9d6a2d5)
- [x] core 警告文案 key 化机制:ctx.warnings 携带稳定 key+插值参数,GUI 显示层 t() 映射,缺失回退存量中文(ConvertWarning=string|KeyedWarning+formatWarning,zh 行为逐字等价)
- [x] converter.ts warnings/throw 文案接字典(throw 经 error.message 单次字符串通道无法显示层重映射,改生成期 t() 本地化并注释决策)
- [x] index.ts throw 文案接字典(实际落点 main/converter.ts,审计行号漂移)
- [x] Mermaid 降级警告 key 化(warn.mermaidEmpty/warn.mermaidFailed 双侧共用)
- [x] renderer.ts ERROR_MESSAGE 模块级求值改使用点 t()(语言切换后仍中文的 bug 已修)
- [x] renderer.ts 版本 title 走字典(app.versionTitle)
- [x] i18n DICT en 键集编译期锁定(ZH as const + EN: Record<keyof typeof ZH,string>,缺键/多键编译报错)
- [x] preset.nameLimit 全角逗号统一为半角
- [x] index.html zh FOUC 缓解(CSP 禁内联,改 localStorage 语言镜像+lang-bootstrap.js 外部引导脚本设 html lang)

#### B4 降级与失败可见性(M,P1;依赖 B6 key 机制;2026-08-23 完成,commit d6dd721)
- [x] renderList/renderBlockquote 不支持的块级内容(display 公式/表格/html/代码块)降级渲染+警告(renderContainerFallback+warnDedup)
- [x] hljs 高亮降级加警告(code-highlight onFallback 回调保持纯模块,pdf 同 key 同口径 warn.highlightFallback)
- [x] loadKatexCss 失败经 warnings 上报(warn.katexCssLoadFailed,返回空串行为不变)
- [x] 图片读取失败原因细分(imageLoadFailureWarning 分类器 ENOENT/EACCES/EPERM/兜底,docx/pdf 双侧对齐)

#### B5 性能(S-M,P1;2026-08-23 完成,commit 3ebec63)
- [x] docx 图片 resolver memo 缓存(ctx 挂 Promise Map,并发同 URL 共享在途请求,失败不缓存可重试)
- [x] embedExternalImages cursor 分段一次遍历(只处理 img 标签内 src,比旧全局 replace 更精确,产物等价)
- [x] (评估)checkLocalImages 轻量存在性通道(resolver 契约加 optional exists,main 侧 fs.access 实现,http 防御性退回)
- [x] (可选)buildMarkdownIt 实例复用——评估后不做(highlight 回调闭包捕获本次 warnings 数组,复用会丢警告)

#### B7 契约单源与解环(M-L,P1 重构;行为零变化;2026-08-23 完成,三波提交 089eac3/e471d2d/0694814)
- [x] 循环依赖解除:docx/pdf render 与 main/settings 的 DEFAULT_PAGE_SETUP 改从 settings-defaults 导入
- [x] CROSS_REF_KINDS 抽 core 单源(新增 core/cross-ref.ts)
- [x] {#sec:} 正则族单源(core/cross-ref.ts SEC_LABEL_RE/kindLabelRegex/stripSecLabelSuffix)
- [x] ImageResolver 类型单源(新增 core/image-resolver.ts,含 optional exists;第三处定义实际在 main/image-downloader.ts)
- [x] pdf 容器深度跟踪器提取 createDepthTracker(caption/eq/xref 三处逐字同构核实后抽象,现居 pdf/rules/shared.ts)
- [x] pdf eq/xref 第二遍链接替换循环合并(forEachRefLink 共享 helper,解包策略经回调)
- [x] bookmarkChildren 共享 helper + as unknown 断言收敛一处(新增 core/docx/bookmark.ts wrapBookmark;冗余断言实际落点 pdf/bookmarks.ts:193)
- [x] decodeEntities 双实现统一(utils 单源;hljs 实体域等价性已核实并记注释)
- [x] 白名单标签集恒等断言(ALLOWED_INLINE_TAGS ↔ INLINE_TAG_STYLES)
- [x] typography 平行定义 type-only 共享(renderer 侧改 PageSetup/AppSettings 派生)
- [x] matchesPreset 字段数组驱动(PRESET_COMPARE_FIELDS,keyof 约束)
- [x] theme.ts 死导出处置(DEFAULT_FONT/DEFAULT_SIZE/QUOTE_COLOR 零消费点删除,「兜底」角色经核实不成立)
- [x] 链接文本提取复用 collectPlainText 消断言(docx link case;嵌套标记链接文本由空变实为修正方向,41 段全绿佐证无回归)
- [x] mermaid.ts 契约注释声明 SVG 信任边界假设
- [x] docx 颜色/字号魔法数字收敛常量(颜色入 theme.ts MUTED/SECONDARY/QUOTE_BG/RULE_GRAY,版面字号与图片上限入常量区)

#### B8 大文件拆分(L,P2 重构;依赖 B7;2026-08-23 完成,两波提交 20ed1c8/0a6c9ce)
- [x] docx/render.ts pushRuns link case 抽 link-xref 模块
- [x] docx/render.ts renderDocx 五轮预扫提取(prescanDocument)
- [x] docx/render.ts 封面/目录/页眉页脚 chrome 模块拆出(1262→467 行,抽 ctx/chrome/prescan/link-xref/image-run/code-block/fallback/content 8 模块,依赖单向无环)
- [x] pdf/render.ts overrideXrefRule 三段拆分 + 按 rule 拆文件(790→209 行,rules/caption|equation|xref|html|image|heading-id+shared)
- [x] renderer.ts 抽 events.ts(705→147 行,bindEvents 集中全部事件绑定)
- [x] settings-panel.ts 绑定函数抽离(656→374 行,settings-bindings.ts)
- [x] renderer 卫生:unload 监听生命周期等价注明/state 删 converting 改 mode!==null 单源/dialogs trapFocus 二次调用先解旧句柄

#### B11 测试盲区补齐(S-M,P2;依赖 B10 userData 隔离;2026-08-23 完成,commit dd9dfbd)
- [x] atomic-json 直测段(test/main/atomic-json.test.js:原子写读回/20 并发串行序/实例队列隔离/失败不破坏旧文件)
- [x] katex-dir/mermaid-dir 三态路径直测(抽 resolveKatexDir/resolveMermaidDir 纯函数,test/main/resource-dirs.test.js 参数化)
- [x] theme.ts eastAsia 字体规则专断言(theme-fonts 段:集中配置单源+16 文件零 CJK 硬编码扫描+styles.xml 产物一致;架构适配: eastAsia 单源已迁 typography 设置)
- [x] converter.test.js 内联 SAMPLE_MD/PNG 迁 fixtures 体系(test/fixtures/main/)
- [x] main/index.ts runWithCtx 错误归一化抽 runConvertTask 纯逻辑入 ipc-logic.ts 直测;preview 生命周期维持人工不自动化

#### B9 UX 体验批(M,P1-P2;2026-08-23 完成,提交 8780c14 视觉批+46c0d4d 交互逻辑批;待 GUI 实测后随下版发版)
- [x] 进度分阶段:PDF parse/inline/katex/mermaid/print 上报(core onStage 回调协议只增不改向后兼容);print 阶段取消置灰+「正在写入」文案
- [x] 错误码→可操作文案映射(EBUSY/ENOENT/EACCES/ENOSPC/长路径;actionableError 纯函数直测,未识别透传)
- [x] 转换中拖入文件 setStatus 提示(drop.busy 提示不再静默)
- [x] 拖放反馈:重复文件单独计数;skipped 列具体文件名(可折叠 details+smoke diag 守卫)
- [x] 最近条目交互:单击=加载到列表/双击=直接重转(title/aria 同步字典)
- [x] 窗口最大化状态记忆 isMaximized(ui-state 持久化+恢复时 maximize)
- [x] 边距输入 HTML max 属性 + marginError 文案对称(max=1000 与 MARGIN_MAX_MM 对称)
- [x] 弹窗动画尊重 prefers-reduced-motion(降瞬时出现,keyframes 终态=自然态无跳变)
- [x] .settings-grid 窄窗响应式断点(≤720px 降单列)

#### B13 暗色模式(M,P2 功能新增;已拍板做;2026-08-23 完成,commit 5a91a4a,待 GUI 实测)
- [x] CSS 变量双主题(33 个语义化变量,data-theme=dark 与 prefers-color-scheme 双作用域同套深色值)+设置「跟随系统/浅色/深色」三态(AppSettings.theme 全链路,applyThemeOn 纯函数直测)

#### B12 IPC 面整理(M,P3;面广靠后;已拍板做;2026-08-23 完成,commit 2df5e35)
- [x] channel 命名统一「域:动作」(23 channel 单源 main/ipc-channels.ts,8 个改名;preload 沙箱侧镜像+dist 恒等断言)
- [x] convert:progress 事件带 mode 标识,去 renderer 侧推断耦合(payload {stage,mode},renderer 直接消费)
- [x] preload/renderer/smoke/测试全量同步(smoke 新增 IPC 端到端 diag+ipc-channels 测试段)

#### 目录结构重组(L,P2 重构;2026-08-23 探定稿;已完成 5 批提交 6f3d72a/b1e50e9/061e8dd/d31cb21/2819a2a,待 GUI 回归实测)
> 方案全文见 archive/20260823-230554-目录结构优化方案.md(目标结构树/拆分明细/纯移动清单/划分原则/明确不做清单);RESEARCH 同日条目有摘要。
- [x] **前置:实施前对代码做再次探查**(exp-1 结论:欠账①②③④⑤仍成立且 events/index 因 B9/B12 略加重;⑥已被 B8 大部分消化降级纯移动;i18n 引用面实测 35 处 import 远低于原估 ~90)
- [x] 批① core/i18n.ts 拆 dict/index(i18n-dict.ts 同文件保键集编译期锁定+facade re-export 引用面零改动)+ core 根级 16 文件归组 pipeline/settings/markdown/image/util(~107 处 import 改写;contract-single-source.test.js 路径断言同步)
- [x] 批② core/docx handlers/ 归拢 11 个节点处理器(theme/render/ctx/prescan/chrome 留顶层不动)
- [x] 批③ renderer 功能域归组 dom/state/settings/convert/ui 六域+events.ts 按域拆 4+1 文件+style.css 拆 base/drop/settings/dialogs 四文件多 link 引入(copy-renderer 改递归拷贝;openPreviewFor 归 selection 防环为方案偏差已注释)
- [x] 批④ main/index.ts 抽 windows/main-window+windows/preview+ipc/register+menu(ctxByWebContents 前置收敛 ipc/register 防循环;708→74 行)
- [x] 批⑤ main/converter.ts 拆 context/single/batch/merge/paths 五子模块(原文件桶导出 import 面零变化)+ smoke.ts 迁 test/tools/smoke/(纯 .mjs 直连 dist,dist 递归扫描 0 个 smoke 文件=打包天然排除)+ mermaid-dir/katex-dir 合并 resource-dirs.ts
> 每批独立提交,typecheck/build/test 全绿验证;批③④⑤ 有 GUI 面列入人工实测。

#### 排期顺序与理由
1. **B14**(零风险速修)→ 2. **B1+B2**(P0 安全/健壮性)→ 3. **B3**(P0 数据正确性)→ 4. **B10**(护栏先行,后续大批次受益;ci.yml 前 userData 隔离)→ 5. **B6**→ 6. **B4**(消费 B6 key)→ 7. **B5**→ 8. **B7**(bug 清完后重构少冲突)→ 9. **B8**(依赖 B7)→ 10. **B11**(依赖 B10)→ 11. **B9** → 12. **B13** → 13. **B12** → 14. **目录结构重组**(排在全部待办之后;开工前先重新探查核对方案)
> B9/B11 无硬依赖可按价值提前;每批完成后跑验证基线(typecheck/lint/build/test/smoke),GUI 可见变更走 ACCEPTANCE 实测。


### 功能候选(排期)
- [x] **8c Mermaid 渲染导出**(中;无依赖)——PDF 近白送(Chromium 有 DOM,隐藏窗口渲染),docx 嵌入 SVG/PNG;原「砍」理由「无 DOM 环境」在 Electron 内不成立(批次 8 已重新评估升回);差异化亮点,建议起手;**已完成(2026-08-13 提交 a89507a,0.23.0,用户实测通过)**
- [x] **题注/章节交叉引用**(中;依赖 8b 补 label 机制)——承接批次 8/9 决策链(D1-D4 免更新路线,静态注入编号 + 超链接跳转);学术正式化闭环,建议起手;**已完成(2026-08-13,160b0d1,0.24.0,用户实测通过,验收见 ACCEPTANCE.md 批次 10 功能 2 节)**
- [x] **模板导入**(中高)——批次 13「预设 JSON 导入/导出」+ 批次 16「CSS 覆盖 pdf 路线」已完成(0.27.0/0.29.0,用户实测通过);docx 模板导入暂缓(docx4js 停维护 + OOXML 样式逆映射工程量大,方案对比见 archive/20260814-201622)
- [x] **代码块语法高亮写 docx**(中;无依赖)——逐 token 着色;pdf 侧 hljs 已就绪可复用,docx 侧需 token→TextRun 转换器 + 颜色映射(~200 行新模块 + 测试段);**已完成(2026-08-16,3eb22c7,0.32.0,用户实测通过)**
- [x] **i18n**(中)——界面文案抽离 + 多语言(中文为主,英文兜底);**已完成(2026-08-16,218b183,用户 GUI 实测通过,验收见 ACCEPTANCE.md)**
- [ ] **文档加密**(低-中)——docx 库原生加密;pdf 侧 pdf-lib 后处理(书签注入已有经验可复用);**已决策不做(2026-08-16 用户确认,见「砍」节;调研依据 archive/20260816-114520)**
- [x] **公式编号开关**(低)——已完成(2026-08-16,66681a9,0.29.0,用户实测通过)
- [x] **批注**(低)——已完成(2026-08-16,308769e,0.31.0,用户实测通过;语法 [锚定文本]{批注=内容})
- [x] **WPS 兼容矩阵**(低)——已完成(2026-08-16,4be7012,0.31.0,用户 Word/WPS 双实测通过;矩阵见 docs/WPS-COMPAT.md)

### 测试遗留
- [x] **B1 renderer 纯函数段**(2026-08-11 R8 收尾评审提出,未执行;低风险纯测试)——抽 `src/renderer/pure.ts`(isMarkdown/baseName/truncateMiddle/stageText/STAGE_PERCENT 等零 DOM 函数,现居 utils.ts),utils.ts 改 re-export(renderer 内部 import 路径不变),新建 segments/renderer-pure.test.js;建议作为下一个小迭代(零行为改动);**已完成(2026-08-13,482160e,renderer-pure.test.js 已建,缺口清零)**
- [x] C4(不排期):isCaptionTarget/buildEquationContext/collectPlainText 直测——产物断言(toc-caption/formula/eq-numbering)已间接覆盖,边际收益低,不做
- [x] R10-7(不做留档):pdf/render.ts 容器深度跟踪 helper——收益 ~20 行且 token 流语义敏感,评审结论「可不做」

### 砍(已决策不做)
- CLI 转正(无用户需求,调试可走脚本/直接调 core)、自动更新与签名(本地离线隐私卖点,更新反噬)、目录监视与同步、PDF 多栏、批量重命名
- 完整 CSL 参考文献(成本高≈重写 citeproc,ROI 低)、AI 改写(与本地离线隐私卖点冲突)、表格合并单元格(markdown 无标准语法,需自定义+双格式对齐)、代码高亮主题切换(仅 pdf 有意义,打印需求趋零)——2026-08-16 用户确认不做
- 文档加密(2026-08-16 用户确认不做):docx 库不支持加密(非 OOXML 标准),替代需引入 officecrypto-tool 新依赖;pdf 侧需 qpdf 原生二进制分发,成本高 ROI 低;调研依据 archive/20260816-114520
- 完整 Mermaid 取消不再成立(已升回功能候选 8c)
- 最近文件:批次 11 I1 已实现(一键重转/会话恢复),原延后项作废

### 已知限制(技术债/不做,记录不遗忘)
- **M7 extractHeadings 正则依赖渲染细节**(pdf/render.ts):标题提取正则与渲染结构耦合,重构需谨慎(2026-08-11 审计记录)
- **M8 resolverCache/HTTP 缓存无上限**:当前可接受,记录即可(2026-08-11 审计记录)
- **printToPDF 产物图片显示无法自动化断言**:smoke 可见图人工验证(维持人工不自动化)
- **renderer 交互 / IPC dialog / preview 生命周期**:维持 GUI 实测,不自动化(见「维持人工不自动化」节)
- **docx 侧任务列表无 checkbox 视觉**:设计如此(与 pdf ☐/☑ 字符替代不同)

## 已完成(历史规划压缩;详情见 CHANGELOG 对应版本与 archive 存档)

### 二期批次 1-9(按批独立交付,含验收标准)
- 批次 1「排版控制 + 设置底座」✅ 0.6.0
- 批次 2「保真 + 正式文档化」✅ 0.7.0
- 批次 3「批量 + 合并」✅ 0.8.0 + 0.8.1
- 批次 4「长文档」✅ 0.9.x~0.10.0(书签/脚注/页眉页脚)
- 批次 5「中文排版深化 + 保真补全」✅ 0.11.0~0.14.0
- 批次 6「学术正式化」✅ 0.15.0~0.16.0(模板包/公式双格式)
- 批次 7「体验优化 + 流程简化」✅ 0.17.0 + 0.17.1,用户 GUI 实测通过(0.17.3,见 ACCEPTANCE.md)
- 批次 8「功能扩展:学术正式化延伸」✅ 0.18.0~0.18.1——**D1=免更新路线**(beginDirty:false + 渲染期静态注入,零提示全端一致,改标题后需重新导出)、**D2=前缀行识别**(图/表后紧跟「图: 标题」行);8a TOC 开关化 + 静态标题列表(无页码,右键更新域可刷新)、8b 题注全文连续编号(图 1/2/3、表 1/2 独立计数);验收 toc-caption.test.js 9 断言 + 用户实测通过(2026-08-09)
- 批次 9「学术正式化:公式编号 + 交叉引用」✅ 0.19.0~0.19.1——**D3=免更新路线延续**(静态「(N)」编号 + 静态「式 (N)」超链接,改号后重新导出)、**D4 语法拍板**($$ 块自动编号全文连续 (1)(2)(3)…;锚点 `{#eq:label}` 独立行不渲染;引用 `[式](#eq:label)`);验收 eq-numbering.test.js 9 断言,待 GUI 实测(ACCEPTANCE.md 批次 9 节)

### 测试缺口补齐(2026-08-10~13,24 项全部完成)
- 高 10 项 ✅:封面双格式/breakBeforeH1 产物/取消链路/重名保护/缺失图片警告/公式降级/外链图片下载/任务列表/h4-h6/分页符产物
- 中 9 项 ✅:settings sanitize 边界/slug/frontmatter/非 A4 纸张与边距/行距缩进值/代码块序列化/引用块列表表格/外链 rels/页脚文案
- 低 5 项 ✅:renderer 交互与 IPC dialog 转 GUI 实测(2026-08-11 用户实测通过)/runAfterConvert/collectMarkdownPaths/resolveOutputPath
- R8 收尾评审 A 组 ✅(A1 分页符下沉、A2 书签端到端、A3 smoke diag 修盲区);B1 未执行,转「当前待办」
- R10 评审 T 组 ✅(T1 GBK 端到端、T2 merge→pdf file:// 守卫、T3 书签 w:id 唯一性、T4 renderPdf 失败路径、T5 行内 HTML 交叉边界、T6 核实覆盖免补、T7 超时注入、T8 resolver 同一性)

### 重构 R1-R10(2026-08-10~13,审计驱动,全部行为等价/注明修复项,每迭代独立提交可回退)
- **R1 契约共享**(394950f):白名单/settings-defaults 下沉 core
- **R2 docx/render.ts 拆分**(1295→~850):captions/equations/mdast-utils/image-type
- **R3 pdf/render.ts 拆分**(802→~250):template/postprocess
- **R4 H3 图片变形修复 + L1 类型统一**:PNG/JPEG 原始尺寸等比缩放,webp 降级
- **R5 中优先级快修(M1/M2/M5)**:括号 URL/临时 HTML 随机后缀/pushRuns 统一 async
- **R6 中优先级快修(M4/M6)**:settings 写队列串行化/图片缺失检查并入 resolver
- **R7 renderer 阶段一**:dom.ts 抽取/删 L4 死代码/L5 状态合并
- **R8 renderer 阶段二**:拆分 state/utils/convert-flow/file-list/dialogs,组合根 ~950 行
- **R9 低风险清扫**:L6/L7(批 3)+ L3/M3(批 4)完成,L9 取消(不值得重构);M7/M8 已知限制不动
- **R10-1 convert context 收敛**(e015fae)、**R10-2 renderPhrasing 合并**(ec26a4b)、**R10-3 runWithCtx**(16c3d3f)、**R10-4 HTTP 失败不缓存**(5abe4fe)、**R10-5 settings-panel.ts**(5454426)、**R10-6 inline-html.ts**(ffa5e7c);R10-7 不做(见当前待办)

### 其他完成项
- **待修复**:PDF 任务列表 checkbox 替换失效(289b837,2026-08-10);docx 侧无 checkbox 视觉为设计如此
- **迭代 4「预览入口迁移」**(2026-08-11):单/多文件态预览按钮 + 完成弹窗移除预览,用户 6 项清单全通过
- **P0 bug:smoke-merge-1-合并.pdf 图片未显示**(392fca1,2026-08-11 用户验证通过)——merge 反斜杠绝对路径 %5C 编码 bug + 样例图可见化;不加端到端断言(printToPDF 图片自动化检测不可靠,实证),由 smoke 可见图人工验证

### 维持人工不自动化
- printToPDF 产物图片显示(smoke 可见图人工验证)、renderer 交互、preview:open 生命周期、IPC dialog(ACCEPTANCE GUI 实测清单)
