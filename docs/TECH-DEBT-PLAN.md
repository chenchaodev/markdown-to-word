# 技术债处置计划（代码分析产出）

> 来源:2026-09-25 四路并行代码分析(核心转换 / GUI / 测试工程化 / 文档状态)汇总。
> 前提:项目处于 3.11.5 封版期(定位=文档维护+技术债清理),计划按风险分层——
> **A 封版期可直接做 → B/C 小步维护批 → D/E 恢复开发后**。
> 执行时每批独立提交可回退;核心路径改动跑对应测试段 + smoke;GUI 面走 ACCEPTANCE。
>
> **已完成(不再执行)**:lockfile 版本 3.10.2→3.11.5 修正 + release.yml 四源版本门禁、ROADMAP D1/F8/F9 状态回写、ACCEPTANCE 陈旧副本删除、关于页更新提示验收关闭(U1-U3,2026-09-25 实测)、本地 tag 同步(v3.11.4/v3.11.5)。
>
> **决策点状态**:C4(core 零 IO 口径)已拍板 ①a 最小注入并随 C 批完成;E2(smoke 断言治理)已拍板「仅动等待,计数全保留」并随 E 批完成(2026-09-25)——**决策点全部关闭**。
>
> **A 批完成(2026-09-25)**:A1 段数订正(STATUS/ci.yml → 69 段,实测 60 segments + 9 main)、A2 沉没债补登记(ROADMAP「已知限制」节:契约类型归位 core[候选池 E1 本就在册]+ test 段归位)、A3 coverage/tmp 残留 JSON 清理、A4 G1-G9 盘点**全部关闭**(G1-G8 断言证据齐全,G9 维持不补;关闭记录写入 RESEARCH 2026-08-15 条目 + 候选池 E2 状态回写);A5 留待随 B2。纯文档/chore 提交。
>
> **B 批完成(2026-09-25,每批一提交)**:B1 about 外链 IPC 收口进 channels 单源(about-preload 侧内镜像 + ipc-channels 段双向断言扩展)、B3 日字典 Partial→satisfies 全量锁(441 键编译期锁定 + 过时口径同步)、B4 令牌破例清零(switch 拨钮/钤印内环/抽屉投影三令牌化 + 关于窗原生底色经 nativeTheme 随系统主题,ui-guidelines 令牌表同步)、B2+A5 关于窗 `sandbox: false→true`(调研结论:preload 仅依赖 electron 白名单、脚本全外部、链接经 IPC 外开,均沙箱兼容)+ about.html CSP 与主窗同口径(一次性脚本 13 项断言:preload API/CSP 生效/IPC 往返/深浅主题/console 零 violation)、B5 深色双块恒等断言段(**修法偏离原案并声明**:「合并选择器组」受 CSS 语法限制不可行、「生成式去重」对过渡态块过重,改镜像+恒等断言与 preload 同构,段数 69→70)。全量 70 段 + typecheck/lint + ui:shots 双主题抽查全绿;**B2 三项人工实测 2026-09-25 通过(ACCEPTANCE「关于窗沙箱与 CSP 验收记录」关闭)**。
>
> **C 批完成(2026-09-25,每批一提交)**:C3 水印色三处与表格边框色收 `core/style/colors.ts`/theme 单源、C2 hljs 30 色板抽 `core/style/hljs-palette.ts` 共享常量(docx handler 与 pdf CSS 双侧引用)、C1 警告去重抽 i18n 共享 `warnDedupKey`+`pushWarningOnce`(docx ctx 改薄封装,pdf equation/xref/image 三处自建 Set 归零)、C4 决策点拍板 **①a 最小注入**——`loadKatexCss` 增 `deps.read` 注入与 precheck `exists` 同构(默认 readFileSync),DEV-GUIDE「零 IO」口径订正为「常态零 IO + 两处 fs 访问依赖注入默认值」,formula 段补注入断言。每批核心回归:全量 typecheck/lint/70 段 + smoke 全绿。**C5 并入 D4 不单独做 → 封版期 A/B/C 三批全部完成,剩余 D/E 待恢复开发。**
>
> **D 批完成(2026-09-25,六项独立提交,顺序 D5→D6→D4/C5→D3→D2→D1)**:D5 test 段归位(9 段迁 `test/main/`、4 段迁新建 `test/renderer/`,acceptance.mjs 扩三发现根,段分布 48+18+4→经 D6 后 47+19+4=70)、D6 对话框样板收口(`selectAndRememberDir` 助手四处收口 + `compareVersions` 下沉 `ipc/logic.ts`;**行为等价偏离声明**:模板导入目录记忆提前为选择成功即记忆)、D4/C5 契约类型迁 `core/ipc-contract.ts` 单源(renderer→main type-only 反向依赖清零,仅剩 `PreloadApi` 属 preload「实现即契约」推导设计声明出范围)+ `convert.ts` re-export 删除 7 处消费点直连、D3 `pdf/template.ts` 三拆(`template.ts` 模板结构与安全 158 / `template-css.ts` 213 / `katex-css.ts` 44,配合 C4 零 IO 口径同步)、D2 settings 接线按六组 Tab 拆(`settings-bindings.ts` 710→编排 51+六组 binder,57 处 addEventListener 零增减;`settings-panel.ts` 560→443+预设动作岛 `settings-preset-actions.ts` 163;**契约守卫口径订正**:控件 id/name 无独立断言段,实为 refs 类型导出编译期守卫 + smoke 控件计数)、D1 `book-wizard.ts` 967→五文件(步骤渲染两岛 wizard-steps/wizard-steps-delivery + 校验 wizard-fields + 提交在外壳 book-wizard 219 + 单例 wizard-runtime setter 收口防环)。每批 typecheck/lint/build/70 段/smoke 全绿 + 机械化等价核对(函数体零漂移);**GUI 实测随收尾统一走 ACCEPTANCE(待人工)**。
>
> **E 批完成(2026-09-25,五项独立提交,顺序 E1→E4→E2→E3→E5)**:E1 覆盖率门槛进 CI(本地摸底基线 stmts 93.92/branch 88.84/funcs 93.15/lines 93.92——A4 已证 G1-G8 断言全覆盖故「补 G1-G9 断言」步经核实无需执行;门槛 **90/85/90/90** 写入 `test:coverage` 脚本单源,ci.yml 验收步改跑该脚本,本地与 CI 同一门禁,c8 自清 tmp 与门禁退出码均实证)、E4 `allowDefaultProject` 手工清单改运行时自动扫描(库源码实证 glob 禁 `**`/裸 `*`,按 src/test/scripts 实际目录 × 扩展名生成逐目录 glob,新子目录零登记;lint 面 215 文件等价 + 新目录探针实证)、E2 决策点拍板 **「仅动等待,计数全保留」**——smoke 两处固定等待改条件等待(1500ms 页面加载→readyState+convertBtn 轮询、页内 50ms→status.textContent 轮询;`writeWithRetry` 150ms 核实为失败重试退避保留),9 处精确计数断言零触碰(全量化维持冻结),smoke ×2 diag 与改造前逐字节一致、E3 看门狗「超时不中止后续」试点(`runAll` 超时分支去 break,`aborted`→`hung` 语义改「存在悬挂段,结果打印完入口硬退出」;悬挂探针实证后续段照常执行;悬挂段与后续段隔离仍不做,为已知局限)、E5 测试树类型检查渐进落地(`tsconfig.test.json` allowJs + checkJs:false,按 `// @ts-check` 逐文件启用无手工排除清单;全量摸底 83 文件 809 错误→首批 13 个零错误文件标注,`npm run typecheck` 串联双配置成 CI 门禁)。每项独立验证全绿(门禁正反向/等价核对/探针/双探针语义 + 70 段)。**至此 A-E 五批 24 项全部关闭,无剩余项。**

---

## 阶段 A:零风险维护批(封版期,纯文档/清理)

| # | 问题 | 规模 | 动作 |
|---|---|---|---|
| A1 | 段数陈旧:STATUS「57 段」、ci.yml 注释「51 段」vs 实际 69 段 | S | 文档/注释数字订正,一次 docs 提交 |
| A2 | 沉没技术债未登记:RESEARCH 的「契约类型迁 core(E1)」「test 段归位」两项无任何待办入口 | S | 补登记进 ROADMAP 候选池/记录不排期节 |
| A3 | `coverage/tmp/` 残留旧原始 JSON(易误认为有报告) | S | 删本地残留(已 gitignore,无追踪风险) |
| A4 | G1-G9 分支覆盖缺口(math 60%、metadata 25% 等)无关闭记录 | S | 对照当前代码盘点哪些仍存在 → 有效项登记入 E1,失效项标注关闭 |
| A5 | 关于窗 `about.html` 无 CSP meta(主窗有) | S | 补 CSP meta(与主窗同口径),随 B2 一并做亦可 |

**验证**:A1/A2 纯文档;A5 需 about 窗冒烟一次。

---

## 阶段 B:安全与契约收口(小步代码批,每批独立提交可回退)

| # | 问题 | 规模 | 动作 | 验证 |
|---|---|---|---|---|
| B1 | `about:open-external` 游离 IPC 单源(menu.ts/about-preload.cjs 裸字符串双写) | S | 收口进 `IPC_CHANNELS`,两处改引用 | `ipc-channels` 段恒等断言 + typecheck/lint |
| B2 | 关于窗 `sandbox: false` 全仓唯一且无豁免论证 | S-M | 先调研能否改 `true`(preload/fetch 依赖);能则改,不能则补威胁模型注释 + 配合 A5 CSP | 改 sandbox 需 about 窗实测;仅注释则零风险 |
| B3 | ja 字典类型 `Partial`(加 zh 忘 ja 静默回退英文) | S | 改为与 en 同款 `satisfies` 全量锁(当前实测 441 键全量,收紧即通过) | typecheck 即门禁 + `i18n` 段 |
| B4 | 令牌纪律三处破例:switch 拨钮硬编码 hex、两处裸 rgba、menu.ts `#F1F1EE` 双源 | S | 全部改经语义变量;menu 窗背景接主题值 | typecheck + 深浅主题 GUI 抽查(或 ui:shots) |
| B5 | 深色令牌双块逐行手工双写(base.css:72-129) | S-M | 合并选择器组或生成式去重,消除漏改一侧风险 | ui:shots 双主题视觉验证 |

**建议顺序**:B1 → B3 → B4 → B2 → B5(由纯机械到需视觉验证)。B 批不碰转换核心,符合封版期维护定位;每批跑 typecheck/lint + 受影响测试段,B2/B4/B5 加 GUI 抽查。

**问题定位备忘**:
- B1:`src/main/menu.ts:13`、`src/renderer/about-preload.cjs:3`
- B2:`src/main/menu.ts:55-60`
- B3:`src/core/i18n/ja.ts:8`
- B4:`src/renderer/style/base.css:994/1000`、`dialogs.css:81`、`settings.css:27`、`src/main/menu.ts:56`
- B5:`src/renderer/style/base.css:72-129`

---

## 阶段 C:core 双源收敛(封版期可选,动核心需回归守护)

> 前置:每批必须跑对应测试段 + smoke(核心路径改动硬要求)。

| # | 问题 | 规模 | 动作 | 验证 |
|---|---|---|---|---|
| C1 | 警告去重双源(docx `ctx.warnedKeys` vs pdf 各 rule 自建 Set) | M | 抽共享 `warnDedup` 纯函数,两侧接入,语义对齐 | 新增断言 + `precheck`/`cross-ref`/pdf 相关段 + smoke |
| C2 | hljs 配色板双源(docx handler vs pdf CSS 各写 30 色) | S-M | 抽共享常量,docx/pdf 两侧引用 | `code-highlight`/`pdf-css` 段 + 快照比对 |
| C3 | 零散色值未入 theme(水印色三处、表格边框) | S | 收敛进 `theme.ts`/共享常量 | `watermark`/`table-width` 段 |
| C4 | 「core 零 IO」口径:`template.ts` readFileSync KaTeX、precheck fs | S-M | **决策点**:①改注入(纯度优先)②修正注释口径(务实)——建议先拍板再动 | ①需 pdf 段+smoke;②零风险 |
| C5 | convert.ts re-export 兼容层(双入口表象) | S | 随 D4 调用点迁移后清理,**不单独做** | 并入 D4 |

**问题定位备忘**:C1:`src/core/docx/ctx.ts:62-64` + pdf rules;C2:`src/core/docx/handlers/code-highlight.ts` vs `src/core/pdf/template.ts`;C3:`src/core/docx/chrome.ts:250`、`table.ts:49`、`pdf/template.ts` 水印 CSS;C4:`src/core/pdf/template.ts` loadKatexCss、`src/core/markdown/precheck.ts`。

**明确不做**:R1 双管线合并——候选池已标「勿动」,平行实现+测试护栏是既定架构代价,仅靠 C1/C2/C3 缩小双源面。

---

## 阶段 D:结构重构(恢复开发后,独立批次)

| # | 问题 | 规模 | 动作 |
|---|---|---|---|
| D1 | `book-wizard.ts` 967 行(超 500 红线最严重) | M-L | 按「步骤渲染 / 校验 / 提交」拆三块,reducer 已独立,行为等价重构 + `wizard-state` 段兜底 + 向导 GUI 实测 |
| D2 | `settings-bindings.ts` 710 / `settings-panel.ts` 560 | M | 按 6 组 Tab 分组拆接线文件,控件 id/name 全保留(有契约守卫段) |
| D3 | `pdf/template.ts` 409 行职责聚集(CSS/KaTeX IO/封面/CSP 混装) | M | CSS 模板与 KaTeX 加载拆出,配合 C4 一并处理最顺 |
| D4 | 契约类型寄居 main/renderer 反向依赖(RESEARCH E1,已沉没) | M | 类型迁 core,顺手收 C5 re-export |
| D5 | test 段归位(4 段 main 直测住在 segments/) | S | 移动目录 + acceptance 自动发现天然兼容 |
| D6 | 打开对话框样板重复、`compareVersions` 手写位置 | S | 抽 `selectAndRememberDir` 助手;compareVersions 下沉 logic/util |

**验证**:重构行为等价批次——typecheck/lint/build/全段/smoke 全绿,GUI 面走 ACCEPTANCE。

---

## 阶段 E:测试体系增强(恢复开发后,含权衡项)

| # | 问题 | 规模 | 动作 | 权衡 |
|---|---|---|---|---|
| E1 | 🔴 覆盖率无门槛不进 CI + G1-G9 分支缺口 | M | ①本地跑 `test:coverage` 摸基线 → ②CI 加宽松门槛(如 branch 60% 起)→ ③按 A4 清单补 G1-G9 关键分支断言,渐进收紧 | 门槛一次定太高会逼凑数断言,建议低起点 |
| E2 | smoke 硬编码 DOM 计数 + 固定 `setTimeout` flaky 风险 | M | **决策点**:计数断言是有意防回归守卫,不全删——只把「微调必红」的精确计数改语义断言、固定等待改条件等待 | 改动面大时防回归力度下降,需逐条评估 |
| E3 | 单进程串行 + 看门狗全局中止(一段悬挂全盘不跑) | M | 权衡项:改为「记录失败继续跑」需处理悬挂段隔离,收益=一次看全失败面;CI 30min 预算尚有 2 倍余量,优先级低 | 可先仅调看门狗为「超时不中止后续」试点 |
| E4 | eslint `allowDefaultProject` 手工清单(新目录忘加即报错) | S | 加 CI/注释守卫或改自动 glob 扫描 | 小 |
| E5 | tsconfig 不含 test/(测试段无类型检查) | M | 逐步 `checkJs`(可先 allowJs 起步) | 可能引入大量报错,渐进式 |

---

## 执行排布汇总

```
封版期(现在)
  ├─ A 批:A1+A2+A3+A4 一次 docs/chore 提交,A5 并入 B2
  ├─ B 批(推荐做):B1 → B3 → B4 → B2 → B5,每批一提交
  └─ C 批(可选):C3 → C2 → C1 → C4(先拍板) —— 每批跑核心回归
恢复开发时
  ├─ D 批(一个大迭代拆 6 独立提交):D5 → D6 → D4/C5 → D3 → D2 → D1 —— 全部完成(2026-09-25,GUI 实测待走 ACCEPTANCE)
  └─ E 批:E1(优先,含 A4 落地)→ E4 → E2 → E3 → E5 —— 全部完成(2026-09-25,E2 拍板「仅动等待,计数全保留」)
不做/冻结:R1 双管线合并(勿动)、E2 全量化
```

**总计**:已完成 **24 项**(A 批 4 项 + A5 随 B2 + B 批 5 项 + C 批 4 项,其中 C4 拍板 ①a;D 批 6 项,C5 并入 D4;E 批 5 项,其中 E2 拍板「仅动等待,计数全保留」);**无剩余项,计划全部关闭(2026-09-25)**。
