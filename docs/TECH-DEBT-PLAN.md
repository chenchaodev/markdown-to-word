# 技术债处置计划（代码分析产出）

> 来源:2026-09-25 四路并行代码分析(核心转换 / GUI / 测试工程化 / 文档状态)汇总。
> 前提:项目处于 3.11.5 封版期(定位=文档维护+技术债清理),计划按风险分层——
> **A 封版期可直接做 → B/C 小步维护批 → D/E 恢复开发后**。
> 执行时每批独立提交可回退;核心路径改动跑对应测试段 + smoke;GUI 面走 ACCEPTANCE。
>
> **已完成(不再执行)**:lockfile 版本 3.10.2→3.11.5 修正 + release.yml 四源版本门禁、ROADMAP D1/F8/F9 状态回写、ACCEPTANCE 陈旧副本删除、关于页更新提示验收关闭(U1-U3,2026-09-25 实测)、本地 tag 同步(v3.11.4/v3.11.5)。
>
> **仅有的两个决策点**:C4(core 零 IO 口径)、E2(smoke 断言治理),执行前需拍板方向。
>
> **A 批完成(2026-09-25)**:A1 段数订正(STATUS/ci.yml → 69 段,实测 60 segments + 9 main)、A2 沉没债补登记(ROADMAP「已知限制」节:契约类型归位 core[候选池 E1 本就在册]+ test 段归位)、A3 coverage/tmp 残留 JSON 清理、A4 G1-G9 盘点**全部关闭**(G1-G8 断言证据齐全,G9 维持不补;关闭记录写入 RESEARCH 2026-08-15 条目 + 候选池 E2 状态回写);A5 留待随 B2。纯文档/chore 提交。

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
  ├─ D 批(一个大迭代拆 6 独立提交):D5 → D6 → D4/C5 → D3/C4 → D2 → D1
  └─ E 批:E1(优先,含 A4 落地)→ E4 → E2 → E3 → E5
不做/冻结:R1 双管线合并(勿动)、E2 全量化
```

**总计**:已完成 4 项;剩余 **A5 项 + B5 项 + C4 项(C5 并入 D4)+ D6 项 + E5 项 ≈ 20 项**,其中封版期可消化约 9 项,其余 11 项待恢复开发。
