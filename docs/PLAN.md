# AI 清理 · 步 02 · 设置面板分档开关

> 开工只需读这三处：相关 ADR 给约束，验证基线给命令（命令本体在 `docs/DEV-GUIDE.md`，本文件只留指针），下一步是要动的那个动作。

## 相关 ADR

开工时把相关 ADR 的「一句话结论」抄进来，目的是让结论进入上下文；抄完即可，ADR 原文不动。

- `docs/adr/adr-021`：AI 清理开关分档为「总开关 + 保守规整 / 结构改写两组子开关」；`AiCleanupOptions` 的 per-rule 开关在生产侧首次真正传参；两档默认**开**（随总开关）；关掉「结构改写」= 回到本需求前的产物；**检测告警不归它管辖**（步 03 另走 precheck 通路）
- `docs/adr/adr-018`：core 的 pdf 渲染路径不做文件 IO（本步不新增 core 文件，无需改门禁白名单）

**验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」—— 命令只存那一处，本文件不复制；其中 `check:docs` 不在 `verify:ci` 链里，提交前本地手动跑。

## 目标

用户在设置面板「排版」组展开 AI 清理，能分别关掉「保守规整」（引号/破折号/列表/空行）与「结构改写」（清引用标记/去 emoji/重整标题）——其中「结构改写」会删内容、必须可单独关；关掉「结构改写」后转换产物与本需求前逐字节一致。

## 下一步

在 `src/core/settings/settings-defaults.ts` 的 `AppSettings` 加两个字段 `aiCleanupTidy` / `aiCleanupRewrite`（默认皆 `true`）并进 `DEFAULT_SETTINGS`，改完跑 `npm run typecheck`。

## 完成标准

- [x] 两个档位开关在设置面板「转换」组可见、可切、**置灰跟随总开关**（总开关关时子开关不可操作，且子开关开着也不生效 —— 不允许子开关绕过总开关）；控件 id 与既有约定一致；自动断言见 `test/renderer/ui-interaction-guards.test.js` 与 `test/renderer/ui-contract-guards.test.js`
- [x] 生产链真正传参：`preprocess.ts` 的 `aiCleanupOptions` 按两档扇出六个 per-rule 开关；「总开关开 + 结构改写关」时 `[1]` / emoji / 标题层级三类痕迹均原样保留（断言见 `test/main/preprocess.test.js`）
- [x] 持久化四路径齐全：类型、`DEFAULT_SETTINGS`、`persist/settings.ts` 的键白名单 / 类型校验 / 反序列化回填 / 合并分支；旧 settings 文件缺这两个字段时走 `DEFAULT_SETTINGS` 兜底而不报错；预设导出再导入后档位不丢（断言见 `test/main/settings.test.js`）
- [x] 三语言文案：`core/i18n/zh.ts`（键集唯一事实源）· `en.ts`（`satisfies` 全量）· `ja.ts`（Partial）；`ru.ts` 在本仓已不存在（ko/fr/ru 早裁撤），无需处理；i18n 注册表恒等段仍绿
- [x] 门禁全绿：`npm run typecheck` + `npm run lint` + `npm run test`（118 段无一由绿转红）+ `npm run test:smoke` + `npm run check:docs` + `npm run ui:shots`
- [ ] 人工实测（GUI）：三档组合 —— 只开总开关（两档默认开）· 总开关开+结构改写关 · 全关。**注**：`ui:shots` 拍的是主窗口七态，脚本内无 settings / drawer 字样，**不覆盖本步的面板**，故面板只能人工确认；该项未做前本步不算收口

## 修复项复测

- [ ] 无（首次改动本区域）

---

> 填写提示：**本文件是骨架，拷进项目后立即删除**；开工时按需新建（新建的那份没有首行版本行）。任务做完时直接删掉这份，不要留档。**别把本文件与 `docs/large/01-AI清理细化.md` 搞混**：本文件是步 #02 的当前状态、做完就删；`docs/large/01-AI清理细化.md` 是整个大型需求、收尾才删。
