# ADR-086 · 模板深导入与自家 docx 回读：解析层落点与依赖引入

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-21 |
| 关联 | [ADR-008](ADR-008-模板导入浅导入.md)（浅导入 v1 —— 本条把「深导入」从独立候选变成本仓的现行方向，但**不推翻** v1 的解析层可演进判断）· [ADR-064](ADR-064-源码树一职责一文件与内部边界判据.md)（一职责一文件与目录准入）· [ADR-060](ADR-060-多层交付面与headless装配层.md)（四个交付面共用同一套装配层）· 全局 `AGENTS.md` 五（引入依赖 ⇒ 写 ADR） |
| 工作项 | REQ-002（模板深导入）· REQ-003（自家 docx 回读）· REQ-261（CLI/MCP 交付面） |

## 决定

1. **新增 OOXML 部件解析层，落 `src/core/ooxml/`**（新目录，core 之下的一层职责类别），只做**内存内**的部件读取与结构化：读 `word/styles.xml`（含 `basedOn` 继承链求解）、`word/theme/theme1.xml`、`word/numbering.xml`、`word/settings.xml`、`word/document.xml`、`word/_rels/document.xml.rels`、`word/media/*`；产出**结构化中间表示**（不是设置值、不是 Markdown）。
2. **该层零 `node:` 内建 import**：解包用已在 `dependencies` 的 `jszip`，输入是 `Uint8Array`；读盘（打开 .docx）与媒体落地（写 `报告_media/`）留在 `main/` 与 `convert/`。依据：`check-import-boundary.mjs` 的 core 内建白名单只放行 5 个文件，core 内 import `node:fs` 一定判红。
3. **字段映射层与部件解析层分开**：`template-import.ts`（现浅导入）保留「OOXML → 设置字段」的映射语义，但**其 XML 读取原语删除**，改为消费解析层的中间表示 —— 不留两份 XML 读取逻辑。
4. **深导入只做字段级逆映射**，不做 Pandoc 式部件级 `styles.xml` 替换：后者会绕过 `src/core/docx/theme.ts` 的集中字体配置硬约束（项目 `AGENTS.md` 明列）。
   **正文字体/字号的取值走「继承链」**：`w:docDefaults/w:rPrDefault/w:rPr` 为底 → `Normal` 样式（若存在）覆盖 → 目标样式沿 `basedOn` 逐级覆盖。**不是「只读 docDefaults」** —— 外部模板（真 Word 文件）的 `Normal` 常带 rPr 且与 docDefaults 不同，只读 docDefaults 会取错正文；自家稿**恰好**没有 `Normal` 样式这一环（`Heading1` 却 `basedOn="Normal"` 指向一个不存在的样式），所以自家稿只剩 docDefaults 一层，**这是自家稿的形态特点，不是通用规则**。
   现有浅导入 `template-import.ts` 取的正是 `Normal` 块的 rPr ⇒ 它对自家稿取不到正文字号（须改为继承链取值）。**标题字号取段落级 run 的 `w:sz`**（本仓把档位算出的标题字号写进 run），样式级 `w:sz` 只作兜底。**样式继承链要容忍「父样式缺失」**（取到即用、取不到即跳过，不得因此判解析失败），但要带**环检测**（外部模板畸形数据）。形态实测见 [自家 docx 产物形态实测](../evidence/20261021-220818-自家docx产物形态实测.md)。
   **补 `Normal` 样式（REQ-262）时，`Normal` 只补 `w:default="1"` + 名字，不在 `Normal` 里放 rPr** —— 正文属性继续唯一来自 `docDefaults`，不产生第二真源（与项目「单一来源不复制」一致），且自家稿的正文取值口径不受补样式影响。
5. **不接颜色、不接管模板编号**：颜色不进设置模型（要改 schema + 预设 + 两侧渲染共五处，另立号）；模板的 `numbering.xml` 不接管（本仓章节/题注编号由自己的开关生成，混用会出两套编号）。
6. **docx 回读（REQ-003）只承诺读回本仓导出的 docx**，不承诺通用 Word 保真；承诺边界与丢弃项必须在 UI 与 CLI/MCP 的产物说明里逐条写明。
7. **mdast → Markdown 序列化引入 `remark-stringify@11.0.0`**（精确版，与本仓 `unified@11.0.5` / `remark@15` 同代），不自研受限序列化器 —— 理由：回读产物还要被本仓自己再转回去，序列化器必须与解析侧同代，混搭 `mdast-util-to-markdown` 各版本会让往返行为随依赖树漂移。
8. **不写「修订逐条并回」（diff 合并）**，且不为其登记工作项。
9. **产品定位不变**：docx 回读是工具箱里的一件工具，不进主转换路径，不改首页与 README 话术。
   **GUI 入口只走「拖入 .docx」，不提供显式按钮**（2026-10-21 用户裁决）：不作为重点功能推荐。理由：静态界面的按钮载体是 `src/renderer/index.html`，而抽屉/舞台有几何门禁（`shared/geometry/geometry-spec.mjs`），新增按钮要连带改几何登记；且拖入这条路对「手里有 Word 稿」的用户已足够直观。**这不是「漏做按钮」** —— 后继者不要顺手补。CLI 侧的 `readback` 子命令与 MCP 侧的 tool 不受此限（那两个面本就是命令/工具形态）。

## 实施约束（2026-10-21 架构复核补记，ora-1 探针实测闭合）

### 一、样式表的分层归属（REQ-262）

| 层 | 归属 | 内容 |
|---|---|---|
| `w:docDefaults` | **仍由库写** | `options.styles.default.document.run` → typography 单源不动，正文属性不产生第二真源 |
| 库内置 16 样式 | **仍由库写** | Title/Heading1-6/Strong/ListParagraph/Hyperlink/Footnote*/Endnote* —— 库升级自动跟随，**不 fork** |
| **本仓 6 样式** | **本仓写** | `Normal`（段落，`w:default="1"`）· `DefaultParagraphFont`（字符，`w:default="1"`）· `TOC1`/`TOC2`/`TOC3`（段落）· `IndexLink`（字符） |

**载体 = `options.externalStyles`（库的合并分支）**：走这条分支时，库把内置样式与我们的外部样式**合并**（`[...defaultStyles.importedStyles, ...externalStyles.importedStyles]`），实测 `options.styles.default` 注入的 `docDefaults` 仍在、命名空间与 `mc:Ignorable` 完好、内置 16 个零丢失，且外部 XML **能带 `w:default="1"`** —— 这是 `options.styles.paragraphStyles` 永远给不出的（`StyleForParagraph` 静默丢弃 `default` 字段）。

**两个必须写进代码注释的坑**：
1. **`externalStyles` 与 `options.styles.paragraphStyles`/`characterStyles` 互斥** —— 走 external 分支时后两者被整段丢弃（库的 `else if` 分支）。本仓所有自定义样式**只**放外部 XML。
2. **外部 XML 的根属性接管了 `styles.xml` 的命名空间集** ⇒ 命名空间从此是本仓的责任；库**不拦**未声明前缀（实测 `mc:Ignorable` 里写未声明前缀时库原样透传 ⇒ 产物成 MCE 非法文档、Word 可能弹「内容有问题」）⇒ **必须由门禁兜**。

**外部 XML 只放 `w:style` 元素**：`docDefaults` 放进去会重复（库里永远产一份，第二份落在 `w:style` 之后，违反 `CT_Styles` 序列）；`w:latentStyles` 也放不进合法位置（合并分支只能追加到末尾，序列要求它在所有 `w:style` 之前）。

**`Normal` 与 `DefaultParagraphFont` 都不放 rPr** —— 正文属性继续唯一来自 `w:docDefaults`（`theme.ts` 集中配置），不产生第二真源；两者只带 `w:default="1"` + 名字（+ `DefaultParagraphFont` 的 `w:uiPriority="1"` / `w:semiHidden` / `w:unhideWhenUsed`，与 Word 自家文件同款）。

**目录 `TOC1`/`TOC2`/`TOC3` 必补**：缓存目录条目的 `w:pPr` 里**只有 `w:tabs`（点线引导 + 右对齐制表位），没有 `w:ind`** ⇒ 层级缩进**只能来自样式定义**。且 static 模式下条目永不重生成 ⇒ styles.xml 的定义是缩进的唯一来源。`IndexLink` 同理（目录条目超链接的字符样式）。

**TOC 缩进阶梯取 Word 内置值 `0 / 220 / 440` twips**（2026-10-21 用户裁决）—— 与 PDF 侧 `1.5em/3em` 的 em 阶梯**有意分歧**：取内置值 ⇒ field 模式用户 F9 更新域后目录缩进**不跳变**（Word 用的就是内置阶梯）；对齐 PDF 侧则会让 field 模式更新后跳变一次。缩进常量属样式常量，**落 `src/core/docx/theme.ts`**（与 `CODE_FONT`/`LINK_COLOR` 同级）。

**有意不补**（理由入档，不落常驻告警判据）：
- **`w:latentStyles`** —— 规范上可选（`minOccurs=0`），只影响 Word「样式」窗格的显示密度，**不影响任何渲染**、也不影响第三方工具（它们读已定义的 `w:style`）；且**公开 API 下补不进合法位置**（合并分支只能追加到 `w:style` 之后 ⇒ 序列违规；`options.styles.initialStyles` 槽位只承载根属性载体，塞 `ImportedXmlComponent` 会产出 `<undefined>` 且丢命名空间）⇒ 唯一干净入口是打包后改 zip，届时单独决策。
- **`word/theme/theme1.xml`** —— `docx@9.7.1` **从不**产 theme 部件也**无 theme API**（库源码零 theme 写入路径）⇒ 只能后处理 zip；本仓字体是**显式名**（`w:ascii`/`w:eastAsia`，非 `w:asciiTheme`）⇒ 产物**没有任何一处依赖 theme** ⇒ 补它是「像 Word 的文件」的装饰，不修任何行为。

### 二、判据的级别判别式（准确性兜底）

> **闭合性/一致性判据（内容型、稳定）⇒ 判红；快照/位置型（漂移源）⇒ 告警 + 基线。**

行号漂移之所以只能告警，正因为它是位置型（改一行注释就漂）；样式引用闭合性是集合关系，改代码不会让它偶然成立 ⇒ **可以判红、不会假红**。

八项判据判红（引用闭合性 · styleId 唯一 · `docDefaults` 恰好一份且 `latentStyles` 顺序合法 · 段落/字符类型各有唯一 `w:default="1"` · 前缀全声明且 `mc:Ignorable` 所列前缀全声明 · 部件声明完整 · `r:id` 可解且关系目标存在）；其中「同类多个 `w:default="1"`」= 歧义，库升级可能引入 ⇒ **只告警**；`w:latentStyles` / theme 缺失是**恒定告警 ⇒ 不落成判据**（只在本 ADR 记「有意不补」）。

⚠ **判据 id 用描述性 slug、不用编号**（`style-ref-closure` / `style-id-unique` / `styles-sequence` / `default-style-missing` / `default-style-ambiguous` / `namespace-prefix-undeclared` / `content-types-uncovered` / `relationship-unresolvable`）—— 编号形态与本仓已退役的「规划编号」字面量同形（`check:test-numbering` 的退役字母表含 `C[1-4]`），会在测试树里判红；id 是产品级概念，不该长得像规划编号。

**落点：判定逻辑落 `src/core/ooxml/`（零 IO 纯函数，复用现成原语）→ 一个验收段消费它 → `gates/repo/gate-index.mjs` 照 `dual-matrix` 先例登记（`modulePath` 指向验收段、`access: offchain`）**。**不新起 `gates/repo/` 门禁** —— 门禁面是「仓形状」，产品级样式断言的既定家是测试层；且 `verify:static` 排在 build 之前，要产物的门禁在 `gates/repo/` 跑不到产物。真要另起门禁本体，也必须 import 同一个 `dist/core/ooxml/*` 导出，**不得复制判据**。

### 三、产物级判据的 id 不用编号（2026-10-21 CI 实测教训）

首版判据 id 写成 `C1-style-reference-closure` … `C8-relationship`，CI 的 `check:test-numbering` 判红 17 项 —— 那道门禁退役的是**规划编号**字面量（REQ-028），退役字母表含 `C[1-4]`，而判据 id 与它在测试树的断言消息里**同形**。

**根因不是撞车，是分类错了**：判据 id 是**产品级概念**（会出现在诊断文案里、会被引用），规划编号是**批次内临时语**（晋升为功能名之前不得进交付物）。两者用同一形态 ⇒ 后者退役时前者被牵连。

**修法在根上**：id 改描述性 slug（`style-ref-closure` / `style-id-unique` / `styles-sequence` / `default-style-missing` / `default-style-ambiguous` / `namespace-prefix-undeclared` / `content-types-uncovered` / `relationship-unresolvable`），**不用白名单绕过** —— 白名单是给「确实是纸型 B5」这类同形异义开的后门，给判据 id 开后门等于把门禁关掉。

⚠ **改 id 时别用无边界的批量正则替换**：`C1` 是 `TOC1` 的子串 —— 批量替换会把 `TOC1`/`TOC2`/`TOC3` 这类**真实 styleId** 改坏（本次实测改坏了三处，段内断言才暴露）。**带词边界的替换 + 逐处人工核对**是唯一可靠做法。

### 四、跨条目边界（别把别的活记在本条头上）

补 `Normal` **不解**「浅导入读不到自家稿正文字号」—— 那是 REQ-002 的活，正解是从 `w:docDefaults/w:rPrDefault/w:rPr` 取正文默认值（见 [自家 docx 产物形态实测](../evidence/20261021-220818-自家docx产物形态实测.md)）。本条只负责让产物**自洽**（引用闭合 + 默认样式齐备）。

### 五、深导入的「未映射」分两类（2026-10-21 用户裁决「本轮修」，落步 #02c）

导入结果的「没吃下的东西」有**两种性质**，必须分开呈现：

1. **本仓的能力边界**（恒定）：字体颜色 · 主题配色 · 模板编号定义 · 兼容选项 · 字符样式 · 潜在样式 —— 这六类是**本仓不接**，与本次模板无关。
2. **本次模板的事实性问题**（条件）：正文字号越界 · 行距非倍数制 · 对齐无对应档位 · 标题字号档位判不出 · 标题间距档位判不出 · 纸张非标准尺寸。

**为什么必须分开**：混在一起时，用户每次导入都看到六条与这份模板无关的固定项 ⇒「模板没吃下什么」被读成「本仓不支持什么」，**把一次性诊断变成常驻能力清单**，真正可操作的那几条被淹没。处置：能力边界折叠成**一句固定说明**（如「本仓不接管：字体颜色、主题配色、模板编号定义、兼容选项、字符样式、潜在样式」），事实性问题**逐条列**。

**失败路径不得谎报成功**：整包解不开（损坏 / 非 docx）时解包结果为 null ⇒ 映射结果为空。此前 `importDocxTemplate` 返回空结果且「未映射」为空，main 侧仍回 `ok:true`，界面走「已应用 Word 模板」分支 ⇒ **用户看到的是成功提示，实际什么都没导入**。处置：解包失败必须产出**可区分的失败态**（不是「成功但没有未映射项」），界面提示失败。判据：**「未映射项为空」与「导入失败」必须是两件事**，不能靠同一个空数组表达。

**承载位置**：那六类的**类型与常量单源**放一个**零依赖**模块（`src/core/docx/template-fields.ts`）—— renderer 要引用该常量，若经 `template-import.ts` 取会把 jszip 拖进 renderer 产物。

### 六、本地全量验证与 CI 同源（2026-10-21 关口裁决的前提）

关口①定为「提交前跑 `npm run verify:ci` 全量」能成立，靠的是一条**可核对的事实**：CI 的 `ci` job 跑的就是 `npm run verify:ci`，且 `runs-on: windows-latest` 与本地同 OS ⇒ **本地绿与 CI 绿是同一套标准、同一依赖树、同一命令**，不是两套。

因此关口②（推送前）与关口③（tag 前）**不重跑**，只做**同一性核对**与**版本自洽核对** —— 重跑是纯重复；tag 的放行判据在 CI 侧（`release.yml` 自己等同一 SHA 的 CI 绿、自己校验 tag↔package.json↔lockfile、自己重建 dist 并与 CI 清单逐字节比对）。

⚠ **前提会失效，要盯住**：一旦 CI 的 `ci` job 改了命令或换了 OS，本地全量就不再是「同源」，关口②③ 的「不重跑」就要重新评估。判据形态见 `docs/DEV-GUIDE.md`「验证基线」节（关口②③ 的核对项写明「① 跑的 SHA == 要推的 SHA」与「版本三处同号」）。

## 背景

- 浅导入 v1（ADR-008）已落地：jszip 内存解包，取 `Normal`/`Heading1` 的 rPr 与 `sectPr` ⇒ `Partial<TypographySettings> + Partial<PageSetup>`，入口是设置抽屉的「导入 Word 模板…」。
- 用户 2026-10-21 拍板三件事：① 深导入按字段级做；② docx 回读只做「自家稿 → Markdown」这一层，修订并回不做；③ 序列化器用 `remark-stringify`。
- 台账 REQ-002 原写的「读 styles.xml 之外的部件需 node:fs ⇒ 导入边界门禁变红」经查**不成立**（已订正）：core 侧只禁 electron 与 main/renderer，`node:fs` 另有一道「core 内建白名单只放行 5 个文件」的判据 —— 结论与原文相反的部分只有一处：**解析层必须零 IO**，而这与「读更多部件」无关。
- 门禁勘察结论（`gates/repo/check-import-boundary.mjs`、`check-src-layout.mjs`、`check-test-layout.mjs`）：core 之下无子目录 allow-list，新目录是「无规则」形态而非「违规」；新 `src/core/**` 文件必须被 `test/` 实际到达（`src-module-unaccounted` 判红），且会进覆盖率分母；新 IPC 通道需五处登记。

## 备选方案

- **部件级 styles 替换（Pandoc 式）** —— 不选：绕过 `theme.ts` 集中字体配置硬约束，要改项目级硬约束条目。
- **自研受限 mdast→Markdown 序列化器** —— 不选：与解析侧不同代，往返行为会随依赖树漂移；序列化不是本仓的差异化点，引入成熟实现更省。
- **把解析层放进 `src/core/docx/`** —— 不选：会让「回读」路径反向依赖「渲染管线」目录，违背 ADR-064 的「目录名 = 一层职责类别」。
- **在 core 内做文件 IO（读 .docx / 写 media）** —— 不选：撞 core 内建白名单，且违背 core「与宿主无关」定位。
- **通用 docx→md（承诺读任何 Word）** —— 不选：Pandoc / Typora / WPS 已免费覆盖，做不出差异。

## 后果

- 好处：模板导入能吃下更多真实模板（对齐/缩进/行距/标题层级），且解析层一次建好、两个方向复用；回读让「转出 → 客户改 → 回流」这条闭环有了第一段。
- 代价：本仓新增一个 core 子目录与一个运行时依赖；`remark-stringify` 进 SBOM/许可证面（`check:supply` 三段已过一次）；新模块必须补测试到达，否则 `src-module-unaccounted` 判红。
- 约束：解析层永远零 IO；读盘与媒体落地永远在 core 之外；深导入永远只映射进现有设置模型。
- 未做：修订并回（B2）；颜色进设置模型；模板编号接管；通用 Word 保真。
