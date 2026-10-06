# ADR-072 · 设置补丁类型迁到 core 并在跨进程两侧一致放宽

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-06 |
| 关联 | [ADR-070](ADR-070-三处签名按真实读取面与兜底语义收放.md) 的后续约束①在本条落地 ｜ 与 [ADR-066](ADR-066-转换契约类型化.md)、[ADR-069](ADR-069-dist产出声明文件.md) 同属「签名必须等于运行期契约」这一条线 |

---

## 决定

**一、类型迁位：`SettingsMergePatch` 从 `src/renderer/settings/settings-logic.ts` 迁到 `src/core/settings/merge-patch.ts`（新文件），随被描述的域走。**

`AppSettings` 住在 `core/settings/`，而这条 patch 形状要穿过六处：renderer 两个 merge 函数、renderer 草稿台账（`settings-save.ts`）、`PreloadApi` 暴露面（`core/preload-api.ts`）、preload 实现（`main/preload.cts`）、main 侧 IPC 处理器（`main/ipc/register.ts`）与持久化合并（`main/persist/settings.ts`）。**留在 renderer 侧则 core 不得依赖 renderer**（依赖方向单向，`npm run check:boundary` 判红），`PreloadApi` 根本无从引它 ⇒ 只能迁。块清单 `DeepMergedBlock` 随之迁入，仍是**单点列举**，renderer 侧改为 `import type` 引入，仓内不存在第二份定义。

**二、同批把 `settingsSet` 整条链的 patch 入参放宽成 `SettingsMergePatch`**，即 ADR-070 的后续约束①：`core/preload-api.ts` · `main/preload.cts` · `main/ipc/register.ts`（IPC handler 入参）· `main/persist/settings.ts`（`updateSettings` 入参）· `renderer/settings/settings-save.ts`（`pendingSavePatch` 草稿台账的声明类型）。`mergePendingSavePatch` 的入参与返回类型一并从 `Partial<AppSettings>` 换成它。

**三、方向只许放宽。** 链上每一处改动的都是**入参**：`SettingsMergePatch` 接受的面严格大于 `Partial<AppSettings>`（五个块内字段由必填变可选），既有调用方（UI 控件表构造的 patch、测试夹具、main 侧内部调用）原样成立，**无一条调用点因此变红**。出参一律未动：`mergeSettingsWithDefaults` 与 `settingsSet` 的返回仍是完整 `AppSettings`，`sanitizePatch` 的返回仍是完整块的 `Partial<AppSettings>`。

## 背景

**零、本条取代 ADR-070 的哪一部分。** ADR-070 决定②成立（放宽成 `SettingsMergePatch`）且不动；**被本条取代的是它的实现位置** —— ADR-070 把该类型连同块清单单点持有在 `src/renderer/settings/settings-logic.ts`，本条把单点迁到 `src/core/settings/merge-patch.ts`。原因是 ADR-070 划界时把跨进程侧排除在改动面外，那时尚不知道放宽要同批贯穿 `settingsSet`；一旦贯穿，`PreloadApi`（core 侧）就必须能引它，而 core 不得依赖 renderer ⇒ 位置不迁则无解。ADR-070 后果②③（块清单是实现的投影 / 交付四块对应 `undefined` 容忍分支）继续有效，只是块清单的物理位置随之迁移。**旧条正文与状态行本条不改**（`adr/` 的分界线是可变性，见该目录 README「取代写法」），取代关系只记在此。

**一、要修的是声明面，不是夹具 —— 测试侧两条路都实测不通。**

`mergePendingSavePatch` 的实现走 `mergeBlock`（`settings-logic.ts` 的 `{...a, ...b}` 逐字段展开），运行期契约要求块内也浅可选，而入参声明写的是**浅** `Partial<AppSettings>`。上一泳道实测：按默认值补齐夹具 ⇒ 断言直接判红（被测语义被改掉，方向反了）；补成与 pending 同值虽然绿，但**整块替换的退化实现也能过**（等于把断言削弱）。⇒ 只能在声明面解决，这是本条的唯一修法。

**二、为什么必须同批放宽跨进程侧，而不是只改 renderer。**

`mergePendingSavePatch` 的返回值流向 `pendingSavePatch` 草稿台账，再流向 IPC `settingsSet`。若只把 renderer 的入参放宽而跨进程侧仍是浅 `Partial<AppSettings>`，那条链上会出现**同一处类型在进程内是深、在进程外是浅**的错配：进程内产出的对象传不出进程边界，声明与运行期契约各说一半。这正是 ADR-070 后果里点名的后续约束①，本条把它落地。

**三、`.cts` 那一处必须改，grep 按 `*.ts` 扫会漏掉。**

`src/main/preload.cts:127` 的 `settingsSet` 实现签名是**手写**的（`const api: PreloadApi` 只抓多余属性与键集漂移，**抓不到参数类型收窄**——手写实现接受更窄的入参在赋值检查里是逆变不通过，但只有当 core 侧也改了才会暴露）。tsconfig 的 `include: ["src"]` 把 `.cts` 纳入编译面（`--listFiles` 实测可见），所以它是硬约束点而非可选整洁项。

**四、刻意不套 `DeepPartial<T>`。** `customPresets` 这类「整块替换、从不逐字段展开」的字段一旦被一并放宽，声明面就比运行期契约**宽**——与本条要修的「窄」是同一类毛病的反面。故只逐块列举实现里真逐字段展开的那五块（`typography` / `headerFooter` / `watermark` / `aiCleanup` / `obsidian`），清单随实现单点持有。

## 备选方案

**否决 · 把 `SettingsMergePatch` 复制一份到 `src/core/preload-api.ts`。** core 不得依赖 renderer，那就得在 core 另写一份 —— 回到「同一个形状 N 份声明」，改名必漏改一半，且类型系统拦不住。与 ADR-064「core 契约跨进程数据形状单源」相悖。

**否决 · 用 `any` / `as any` 打通跨进程侧。** 与 ADR-070 同一条否决理由：本条的起因正是产物类型面到位后测试第一次被真正类型检查，`any` 会把那道刚建起来的检查拆掉，且掩盖真实缺口。

**否决 · 只改 `mergePendingSavePatch`，跨进程侧保持浅 partial。** 留下「进程内深、进程外浅」的错配（见「背景」二），草稿台账 `pendingSavePatch = attempt` 那一行直接判红。

**否决 · 套一个全局 `DeepPartial<AppSettings>` 一次了事。** 见「背景」四。

**否决 · 把 `pageSetup` 也加进块清单。** `mergePendingSavePatch` 对它确实走 `mergeBlock`（逐字段展开），但**没有任何消费方需要**：唯一的真实调用方 `settings-save.ts:103` 传的是控件表拼出的完整 `PageSetup`。加进去会连带把 IPC `settingsSet` 的跨进程契约放宽到「边距可以只带一个」，而这是本次修法之外的对接口放宽 —— 属无消费方需要的过度放宽。刻意留作一处已登记的残留（见「后果」），不在本条顺手做掉。

**否决 · 改夹具而不是改声明。** 见「背景」一，已实测两条路都不通。

## 后果

**收益。** `mergePendingSavePatch` 与 `mergeSettingsWithDefaults` 共用同一形状，`settingsSet` 链上六个文件不再是六份各说一半的声明；`test/renderer/settings-logic.test.js` 里那 3 条类型红归零（此前是 `TS2740` / `TS2739` / `TS2741`，落在块级深合并的夹具上）。全仓 `error TS` 计数：src 侧 0、测试侧 0。

**收窄会让哪些调用点变红 —— 无一，本条也没有一处是收窄。** 逐处方向核对：`PreloadApi.settingsSet` 入参、`preload.cts` 实现签名、IPC handler 入参、`updateSettings` 入参、`pendingSavePatch` 声明类型、`mergePendingSavePatch` 入参与返回，六处全部只增不减可接受面。**唯一需要小心的是返回类型**：`mergePendingSavePatch` 的返回由 `Partial<AppSettings>` 变宽为 `SettingsMergePatch` 后不能再直接赋给 `Partial<AppSettings>` 标注的变量 —— 仓内唯一读点是 `settings-save.ts` 的草稿台账，已同批放宽，故无残留。

**刻意不放开的一处（已登记的残留）。** `pageSetup` 不在块清单内，仍要求整块字段齐全。**真实原因是它与其余五块的兜底基准不同，不是「真实调用方不需要」**（后者结论虽恰好也成立，但理由站不住 —— 按它去改别处会推错）：`main/persist/settings.ts` 的 `sanitizePatch` 里，`pageSetup` 走 `sanitizePageSetup(value, current.pageSetup, …)`，**以 current 合并、省略的边距保留**；而 typography / headerFooter / watermark / aiCleanup / obsidian 五块都以 `DEFAULT_*` 起手再逐字段覆盖，**省略的字段被重置为默认值**。⇒ 把 `pageSetup` 放进块清单等于宣称「局部块会保留边距」，而把五块里的任何一块放进去等于宣称「省略字段不重置」—— 两者都与实现相反，故本条只放开与实现一致的那五块。**代价要说清**：对这五块，局部块 patch 是**整块重置**语义，不是「只改我给的那几项」；当前生产入口 `persistSettings` 仍收 `Partial<AppSettings>` 且各调用方展开完整块，故该形态暂不可达。若将来出现「只提交部分边距」的正当调用，应单独决策并连带复核那五块的兜底基准是否要改成 current。运行期语义的落点见 `src/main/persist/settings.ts` 的 `updateSettings` 头注。

**后续约束（三条）。** ① `SettingsMergePatch` 的块清单是**两个 merge 实现的投影**，不是「看起来该有的宽松」：任一 merge 函数改成整块替换，那一块必须从 `core/settings/merge-patch.ts` 的清单里去掉（沿用 ADR-070 后果②，现由 core 侧那一份单点持有）。② 该类型现在住在 core，任何一侧若想另写一份局部 patch 类型，都是在绕开这份单源；`check:boundary` 的 `core-no-duplicate-export` 族是它的机械看守（该族当前带 `pending` 标记，只报告不判红）。③ 放宽只到入参。**出参仍是完整 `AppSettings`** —— 若将来有人想用 `SettingsMergePatch` 作返回值下发，等于宣称「保存后的设置可能缺字段」，那是另一个决定。

**判据形态。** 「某字段该不该进块清单」需要读该 merge 函数的实现（是否 `{...base, ...patch}`），不是扫位置就能定的，故**不做成机械门禁**；由本 ADR 与 `core/settings/merge-patch.ts` 的单点注释共同看守。
