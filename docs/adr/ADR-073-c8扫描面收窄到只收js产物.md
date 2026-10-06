# ADR-073 · c8 扫描面收窄到只收 .js 产物

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-06 |

## 决定

`package.json` 的 `test:coverage` 里，c8 的扫描面参数由 `--include="dist/**"` 收窄为 **`--include="dist/**/*.js"`** —— 声明文件（`.d.ts` / `.d.cts`）不进覆盖率报告，**且不用 `--exclude` 表达这件事**。

## 背景

ADR-069 开了 `tsconfig.json` 的 `declaration: true`（测试的类型面必须指产物而非源码）。副作用落在覆盖率链上：`dist/` 产出 **159 个 `.d.ts`**，而 c8 的扫描面是 `--include="dist/**"`，把它们一并收进报告。

实测口径（`output/coverage/coverage-summary.json`）：`.d.ts` 合计贡献 **8665 statements / 159 functions / 159 branches，covered 全为 0**；`total` 因此被压到 statements 71.19%，同时打穿 90/85/90/90 四档阈值。`check-coverage-zero --zero` 另有 **159 项判红**，逐条点名 `dist/**/*.d.ts`。

**根因不是「c8 会收 `.d.ts`」，而是「默认排除被顶掉了」**：c8 的默认 exclude 列表（`@istanbuljs/schema/default-exclude`）里本来就有 `**/*.d.ts`，声明文件不进报告是它的既有行为。但 yargs 的数组语义是「传了 `--exclude` 就**整体替换**默认数组」—— 本仓为逐文件登记豁免而写了 9 条显式 `--exclude`，那份默认列表于是一并消失。

已排除的现成解法：`package.json` 的 `build.files` 里的 `!dist/**/*.d.ts` **只管 npm 打包白名单，不作用于 c8**（实测：两者互不作用）。

## 备选方案

**否决 · 给 c8 加 `--exclude=**/*.d.ts`。** `check-coverage-zero.mjs:409-416`（静态面 ⑦）判「`--exclude` 里的每一条都必须在豁免清单里有对应条目」，反之亦然 —— **严格双射**。而豁免条目的键是**单个源文件路径**（经 `distArtifactOf` 映射成产物路径），glob 无法登记 ⇒ 加这条 glob 当场判红，要解它就得改判据本体。为一条正则付出改判据的代价不划算。

**否决 · 改用 c8 的 `--extension=.js --extension=.cjs`。** 同样能挡住（实测报告键集与本决定完全一致），但那是 `--include` 之外的**第二处收窄机制**：`requireFlags` 记不到它，也没有任何判据与它对读，删掉它不会有任何门禁变红。与本仓「多处登记必留机器对读」的取向相反。收窄 `--include` 至少让「扫描面收紧」仍是 `requireFlags` 里一个被点名的收紧面选项（删掉 `--include` 这个选项本身即判红）。

**否决 · 靠 `build.files` 的 `!dist/**/*.d.ts` 顺带解决。** 见「背景」末段，那是打包层，与 c8 的采集面无关。

## 后果

**收益。** 159 项判红消失；分母回到只含可执行产物的形态，四档阈值（90/85/90/90）**不需要动**。声明文件继续留在 `dist/` 供测试的类型面消费，同时被 `build.files` 挡在安装包外（ADR-069 已定的打包侧口径，本条不动它）。

**⚠ 约束一 · 本条同时把 `.cjs` / `.mjs` 移出了扫描面。** 当前 `dist/` 下 `.mjs` 为 0、`.cjs` 仅 2 份且都在豁免清单与 `--exclude` 内，故对报告键集与数字**无实际影响**（实测两种写法的键集完全相同）。**将来若新增不由 tsc 产出的 `.cjs`，须回头看本条** —— 那类文件会静默失去覆盖率统计，且不会有任何门禁提示（与 ADR-069 同族的「靠上游默认」风险）。

**⚠ 约束二 · 本条的取值没有机器看守。** `requireFlags` 只核**选项名在不在**（`check-coverage-zero.mjs:237` 把 `--include=dist/**/*.js` 砍成 `include` 再只判 `flagValue(...) === null`），**取值没有任何判据与它对读** —— 与 `coverage-baseline.json` 的 `note` 第 9 条「`measured` 是本表唯一靠人守的环节」同族，是第二处靠人守的地方。缓解是暴露而非静默：取值一旦被改宽，`.d.ts` 立刻进分母，动态面当场以**上百条具名判红**把它指出来。补取值比对判据的收益只是「让报错早一轮」，是独立的一笔账，不在本条。

**⚠ 约束三 · 改本参数就是改分母，`measured` 必须手工重测。** 这是 `coverage-baseline.json` 的 `note` 第 9 条明写、本门禁**唯一不核对**的环节（同批已按该条在干净树重测并刷新 `measured` 与 `headroomPp`）。任何后续改动本参数的人都必须重做一次。

**与 ADR-069 的关系。** ADR-069 的「必须同批做的连带项（漏了会红）」只列了 ① 打包清单排除 `.d.ts` ② 产物清单门禁的期望清单，**客观上漏了 c8 扫描面这一条**（实测漏了会红 159 项）。**本条补上该缺项，不改 ADR-069 正文** —— 按全局配置目录 `DOC-SYSTEM.md` 的「旧条不改动只标取代」，ADR-069 的决定（开 `declaration`）本身未被推翻，被补全的是它的落地清单。

**与更早 ADR 的关系。** ADR-035 / ADR-060 / ADR-065 的正文里转抄过 `--include="dist/**"` 这个字面值。**一律不改**：那三处都是**背景转抄**而非其决定本体（ADR-035 的决定是「安装包不含 sourcemap」，未被动；ADR-060 §5 的决定是「新目录自动进分母」，对 `.js` 仍然为真；ADR-065 §七的 renderer 论断已自行标注失效）。当前取值的唯一权威是本条与 `gates/repo/coverage-baseline.json` 的 `requireFlags`。
