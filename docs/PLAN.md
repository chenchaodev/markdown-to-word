# AI 清理 · 步 01 · 三条结构改写规则

> 开工只需读这三处：相关 ADR 给约束，验证基线给命令（命令本体在 `docs/DEV-GUIDE.md`，本文件只留指针），下一步是要动的那个动作。

## 相关 ADR

开工时把相关 ADR 的「一句话结论」抄进来，目的是让结论进入上下文；抄完即可，ADR 原文不动。

- `docs/adr/adr-021`：AI 清理开关分档为「总开关 + 保守规整/结构改写两组子开关」；检测告警不归它管辖，另走 precheck 通路
- `docs/adr/adr-018`：core 的 pdf 渲染路径不做文件 IO（`precheck.ts` 已在 `check-import-boundary.mjs` 的 `CORE_NODE_BUILTIN_FILES` 白名单里；本步纯字符串改写，**不得**新增 core 文件若需 `node:` 内建则先加白名单）

**验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」—— 命令只存那一处，本文件不复制；那里也只写命令、不写结果。

## 目标

用户在设置里打开「AI 清理」后转换一份 ChatGPT 复制的 Markdown，裸数字引用标记 `[1]` 与 emoji 消失、标题从 `#` 一级起且无跳级，得到的是能直接付印的稿子；关掉「AI 清理」时产物与改动前逐字节一致。

## 下一步

把 `src/core/markdown/ai-cleanup.ts` 的 `AiCleanupOptions` 扩三个字段（`stripCitationMarkers` / `stripEmoji` / `fixHeadingLevels`，默认皆 `true`），并在其中实现三条规则，复用已有的 `replaceMarkdownOutsideProtectedRegions`（`:51-64`）与保护区机制（`:92-182`）保证代码围栏、行内代码、HTML、frontmatter 不受影响；改完跑 `npm run typecheck`。

## 完成标准

- [x] 清数字型引用标记：只删**裸内联**标记 `[1]` / `[1,2]` / `[1-3]` / `【1】`；`[^1]`、`[^1]: 定义`、`[文本](url)`、`![图](url)`、`[1]: url` 定义行、`(Smith, 2020)` **一个都不能被改**；代码围栏 / 行内代码 / HTML 内的同类字面量原样保留；自动断言见 `test/segments/ai-cleanup.test.js`
- [x] 去 emoji：删除全部 emoji，含变体选择符（U+FE0F）与 ZWJ 序列（👨‍👩‍👧 要整体删成空串、不留残渣）；**中英文、CJK 标点、其它 Unicode 符号（如 ✓ § † ※ ♠）一个都不能被误删**；保护区同上一条；自动断言见 `test/segments/ai-cleanup.test.js`
- [x] 重整标题层级：全文无 h1 时全部标题上移一级（h2→h1 … h6→h5，且不得越过 h1 上限）；有跳级时补齐（h1→h3 变 h1→h2，h2→h4 变 h2→h3）；**代码围栏内的 `#` 注释行不被当成标题**；顺序调整后 `{#sec:...}` 锚点与 `[[双链]]` 引用文本不被破坏；自动断言见 `test/segments/ai-cleanup.test.js`
- [x] 契约不回退：`AiCleanupOptions` 全字段传 `false` 时输出与输入逐字节一致；三条新规则各自单独 `false` 时只影响自己那一类；`npm run typecheck`、`npm run lint`、`npm run test`、`npm run test:smoke` 全绿
- [ ] 人工实测（需构建后经 `npm run dev` 走 GUI）：拿一份含 `[1]`、emoji、`##` 起头的真实 AI 输出，docx 与 pdf 两条路线目视确认三项均已清理，且关闭总开关时产物回到原状

## 修复项复测

- [ ] 无（首步）

---

> 填写提示：**本文件是骨架，拷进项目后立即删除**；开工时按需新建（新建的那份没有首行版本行）。任务做完时直接删掉这份，不要留档。**别把本文件与 `docs/large/01-AI清理细化.md` 搞混**：本文件是步 #01 的当前状态、做完就删；`docs/large/01-AI清理细化.md` 是整个大型需求、收尾才删。
