# adr-026 · 阶段契约落在 core 的分派点

| 项 | 值 |
|---|---|
| 状态 | **部分被取代** —— 「决定要点一」被 [adr-027](adr-027-窄契约携带主开关.md) 取代（窄契约**携带主开关**，否则照本条字面实现会造出第三个 mapper）。决定、要点二/三/四、备选方案与后果沿用 |
| 日期 | 2026-09-28 |
| 关系 | **部分更正 [adr-024](adr-024-设置分组与渲染前变换层下沉.md) 的备选方案第 3 条**（该条否决写宽了，理由描述的是别的函数）。adr-024 的决定要点与后果沿用。 |

## 决定

把「渲染前变换」阶段变成 core 里的真模块：新增 `core/markdown/preprocess-body.ts`，导出**窄契约类型**（`{ obsidian: ObsidianSettings; aiCleanup: Pick<AiCleanupSettings, "tidy" | "rewrite"> }`）与**纯分派函数**；`main/converter/preprocess.ts` 退化为 IO / frontmatter 薄壳，只负责读文件、解码、隔离并拼回 frontmatter、收集 warning。

`core/convert.ts` 侧只接受一种形式：给「已变换的 markdown」形参加一个 core 导出的类型别名（`export type PreprocessedMarkdown = string`）并在 JSDoc 里记阶段顺序。**不引入**任何「声明但不消费」的上下文字段或返回标记。

## 背景

规格 2-4 要求「让 `core/convert.ts` 对『先变换后渲染』这个阶段有显式概念」，并把「`core/convert.ts` 对这批设置的引用数从 0 变为 1」写成退出条件。开工前的形状评审（全文在 [archive/](../archive/20260928-200721-步02子步2-4阶段契约形状裁决.md)）查实了三件让原退出条件**方向可疑**的事：

1. `convert()` 收到的是**已经变换完**的正文（`preprocessMarkdown` 拼回 frontmatter 后传入），`core/convert.ts` 还会自己重解一次 frontmatter。所以「把变换类设置挂到 `ConvertContext` 上」断言的是一件假事 —— 那批设置**不影响渲染**。
2. 生产侧三个入口全部先过 `prepareMarkdown` 再 `convert()`，而多个测试段**直接**给原始 markdown 调 `convert()`。即「变换已完成」这件事在类型上无法验证：生产恒真、测试恒假，任何品牌化手法要么在测试里变成谎言，要么要改十余处测试段。
3. 档位映射函数的入参**已经是窄 `Pick`、不含总开关**，这个「总开关不进下一层」的惯例已在 `preprocess.ts` 成型。

由此得出一条判据：**一个不存在的消费方，其契约就是类型谎言。** 评审据此否决了三个「声明但不消费」的形状。

## 对 adr-024 备选方案第 3 条的更正

adr-024 的备选方案第 3 条否决「把 `preprocessBody` 整体下沉 core」，理由写的是「它要读文件、解码、收集 warning，依赖宿主能力」。

**该理由描述的是 `prepareMarkdown`，不是 `preprocessBody`。** 实测 `preprocessBody(body, settings)` 是纯函数：只调 `normalizeObsidian` 与 `cleanupMarkdown` 两个 core 内纯函数，零 IO、零宿主能力。读文件与解码在 `prepareMarkdown`，frontmatter 隔离与拼回在 `preprocessMarkdown`。

所以那条否决**成立但写宽了**：它正确地否决了「把 `prepareMarkdown` 下沉」（那会带 `node:fs` 进 core，而边界门禁的 node: 内建白名单是逐文件的），但顺带把 `preprocessBody` 也扫进去了。本条把那半句的适用范围收回来 —— **收回来，不推翻**：`prepareMarkdown` 仍然不下沉。

## 决定要点

### 一、窄契约里没有总开关

`PreprocessBodyOptions` 的 `aiCleanup` 只含 `tidy` 与 `rewrite`（沿用既有的 `Pick` 惯例），**不含 `enabled`**。这是 adr-024 决定要点二在类型层面的延续：总开关判定留在分派函数之外的那一层，档位不构成旁路。分派函数的注释必须写明「本函数不含总开关判定」。

### 二、分派点必须真在 core，且 main 侧只剩一处调用

做完后的判据：`rg -n "preprocessBody" src/` 只应命中 core 的定义、一处薄调用点，以及测试。**两个 dispatcher 并存 = 总开关门控出现第二个实现点**，直接破 adr-024 要点二。

### 三、退出条件改写为反向不变量并接进门禁

原退出条件「`core/convert.ts` 引用数从 0 变为 1」**方向错了** —— 该守的不是「core 引用了变换设置」，而是「**渲染层不得枚举变换类设置**」。因为分派点搬到 core 之后，渲染层枚举它恰恰是错的方向。

改为一道门禁，语义取反：
- 渲染层（`src/core/convert.ts` + `src/core/docx/**` + `src/core/pdf/**`）出现 `aiCleanup` / `obsidian` 标识符 → 退出码非 0
- 变换类设置的枚举点恰好 2 处且都在 `src/core/markdown/**` → 计数漂移即红

门禁须**先注入一次故障演示它会红**，再提交（沿用步 01 的 1-1「护栏必须自证有效」）。

## 备选方案

- **`ConvertContext` 加一个可选的变换设置字段（原形状 1）** —— 否决。它断言「这批设置影响渲染」，而 `convert()` 收到的是变换后正文，断言为假；它本身还是第三个 mapper（与本步退出条件自相矛盾），且会被步 04 的批量映射顺手接上，变成事实上的假开关。
- **`convert()` 返回「变换已由谁完成」的标记（原形状 2）** —— 否决。标记的消费者数为 0（产物只被 main 落盘与测试断言），无人读是另一种类型谎言；且要动 `ConvertArtifact` 的判别式联合，破坏面超出「1~2 文件」。
- **把 `ConvertContext` 拆成变换阶段与渲染阶段两个类型、后者由前者派生（原形状 3）** —— 否决。无消费方时是纯类型体操；`ConvertContext` 已有 30+ 字段，再拆一层派生要同步三处构造器。
- **只加 JSDoc + 类型别名，不搬分派（原形状 4）** —— 保留为**降档方案**，非首选。10 行成本换一个有可 grep 的阶段锚点，但诊断里「加一个能力要改 12~22 个源文件」那个数字一点不会动 —— 那个收益其实已由 2-1 与 2-2 交付。形状 5 成立时本条无意义；若 ADR 冲突短期解不了，才退到这一档。

## 后果

- main 侧 `preprocess.ts` 显著变薄，只剩 IO 与 frontmatter 两件事；「加一个渲染前变换类设置」的改动面收敛到 core 一侧，main 侧恒为 0。这让 adr-024 后果行那句「持久化侧只改 `AppSettings` + 迁移 + core 的阶段契约」从愿望变成事实。
- 步 04 的「按类别批量映射」将来若把变换类键组接进 core context，**会直接被本条的门禁判红** —— 这是有意的：那条接线本身就是错的。
- **2-2 必须先于本条落地**。硬依赖：映射函数未下沉时，core 的分派函数要么反向 import main（违反依赖单向），要么把映射表复制进 core（当场造出第三处枚举）。
- 关联：[adr-024](adr-024-设置分组与渲染前变换层下沉.md)（本条更正其备选方案第 3 条的适用范围）· [adr-021](adr-021-AI清理开关分档.md)（双重门控不变式来源）· [adr-025](adr-025-区间判据不合并.md)（同一步骤的 2-3 决定）· 评审全文 [archive/20260928-200721-步02子步2-4阶段契约形状裁决.md](../archive/20260928-200721-步02子步2-4阶段契约形状裁决.md)
