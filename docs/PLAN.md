# 步 02 · 渲染前变换层归位与判据统一

> 开工只需读这三处：相关 ADR 给约束，验证基线给命令（命令本体在 `docs/DEV-GUIDE.md`，本文件只留指针），下一步是要动的那个动作。

## 相关 ADR

- `docs/adr/adr-026`：**阶段契约落在 core 的分派点** —— 分派函数与窄契约类型都进 `core/markdown/`，main 侧退化为 IO / frontmatter 薄壳。**窄契约里没有总开关**（`aiCleanup` 只含 `tidy` / `rewrite`）。**退出条件已取反**：该守的不是「`core/convert.ts` 引用了变换设置」，而是「渲染层不得枚举变换类设置」，且要接成门禁并自证会红。**同时更正 adr-024 备选方案第 3 条的适用范围**（那条否决写宽了，理由描述的是 `prepareMarkdown` 而非 `preprocessBody`）
- `docs/adr/adr-024`：**分组键的校验口径必须与今天等价**（`isValidSettings` 整文件拒绝 + 加载兜底两处都要补，照抄 sanitizer 范式会静默放宽成字段级兜底）· **双重门控不得压成一层**（三处门控是 adr-021 写死的不变式）· **档位是派生量，映射表不得上浮** · **迁移双向可逆** · **新落点不得 import 任何 `node:*`**
- `docs/adr/adr-025`：**区间判据不合一** —— 只归位真正逐字相同的 `SourceRange` 与合并循环；节点集合收集、两套 masking、两处切行口径保持独立。理由是两侧对反斜杠转义的角色相反（AI 清理拿它当保护对象，预检恰要看它），以及预检的第二个节点集合刻意不含 `code`/`inlineCode`
- `docs/adr/adr-021`：AI 清理「总开关 + 两档」双重门控是不变式来源
- `docs/adr/adr-015`：测试全量纳入类型门禁（逐文件 `@ts-check` pragma）

**验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」—— 命令只存那一处。本步适用门禁类别见 [large/01](large/01-设置契约与主管线收敛.md) 门禁表的「步 02 结果」列（类型检查 + 静态检查 · 构建 · 全量测试 · 架构边界门禁 · 跨进程契约门禁 · 双管线差异矩阵段 · 文档与台账门禁）。

## 目标

新增一个渲染前变换类能力时，持久化侧不再需要在 main 层加 mapper，且「关掉结构改写 = 回到现状」这条判据在搬迁后依然可验。

## 下一点

把 `AppSettings` 里 `aiCleanup` 三个平铺 boolean 与 `obsidianCompat` + `obsidianAttachmentFolder` 收成两个嵌套对象，同步改 `settings-defaults.ts` 的类型与默认值、`main/persist/settings.ts` 的四处（键白名单 / 形状校验 / 加载兜底 / 更新 switch），并加旧形状 → 新形状的迁移函数；改完跑 `npm run typecheck` 看剩余待跟进的消费点。

## 完成标准

- [ ] 新旧两种形状的 `settings.json` 都能正确读入；分组键的校验口径与迁移前等价（整文件拒绝与字段兜底两处都在）—— 自动断言见 `test/main/settings.test.js`
- [ ] 迁移前后同一份 markdown 的 docx 与 pdf 产物一致，两侧都取「内容」而非「整文件字节」：docx 解出 `word/document.xml`（zip 容器），pdf 取逐页内容流。**pdf 侧不能比整文件字节** —— 实测同一份 HTML 连续两次 `printToPDF` 整文件字节必不同（Skia 把临时 HTML 文件名写进 Info 的 `/Title`，另有 `/CreationDate` 与 `/ModDate`），而页内容流不含这三者 —— 自动断言见 `test/main/converter.test.js`
- [ ] 双重门控三者各自独立可验：总开关单独关 → 整段跳过；某一档单独关 → 对应 per-rule 全 false；6 个 per-rule 全 false → 产物零改动
- [ ] 该类设置在全仓只被枚举 2 处（core 的变换分派 + core 的档位映射），两处都在 `src/core/markdown/**`，`buildConvertContext` 仍不映射；**反向门禁生效** —— 渲染层（`core/convert.ts` + `core/docx/**` + `core/pdf/**`）出现 `aiCleanup` / `obsidian` 即判红，枚举点计数漂移即判红。门禁须**先注入一次故障自证会红**（原退出条件「`core/convert.ts` 引用数从 0 变为 1」方向错了，见 adr-026）
- [ ] `SourceRange` 与区间合并逻辑在源码内只有一份定义（`core/markdown/source-ranges.ts`）；节点集合与 masking 两侧保持独立，不合并（理由见 adr-025）

## 修复项复测

- [ ] AI 清理的 6 条规则逐条行为不变（智能引号 / 破折号 / 列表标记补空格 / 行尾空白与空行折叠 / 裸数字引用标记 / emoji / 标题层级）
- [ ] Obsidian 兼容（图片链接规范化 + 附件目录重定位）在分组后行为不变；`obsidianAttachmentFolder` 单独设而 `compat` 关着时仍是死值（该耦合关系由分组后的对象形状表达，不新增行为）
- [ ] 预检侧四类「内容可能已被静默丢掉」的告警在区间判据归位后全部仍报得出来 —— 归位若掩掉了 `\(` 检测会静默失效，这是本步最需要盯的回归

---

> 本步是 [large/01](large/01-设置契约与主管线收敛.md) 六步方案的第 2 步（大型需求），本文件是它的**单步**当前状态，做完即删。**涉架构**（改持久化结构 + mapper 移层），ADR 已在开工时建（adr-024 / adr-025），不等到收尾。本步不做用户可见变化，除迁移导致旧 settings 需重写外无 CHANGELOG 条目；若实现中出现用户可感知的差异，回收尾时按全局写入判据 ② 补。
