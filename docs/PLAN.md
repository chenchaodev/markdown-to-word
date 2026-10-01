# 树边界与自算根收口（剩余三项）

## 相关 ADR（一行结论）

- ADR-038：三层划分与跨树边界 —— 门禁实现归 `gates/`，被两棵树共用的纯机制才归 `shared/`
- ADR-040：项目根单源 —— 自算根是 depth-coupled 的病根形态，一律 `import { ROOT } from shared/paths.js`
- ADR-042：行为契约清单走声明+等式，纯清单走磁盘派生
- ADR-043：树边界用 allow-list 形态；ADR-043:40 点名「换个写法就绕过门禁」是它自己警惕的失效模式
- **ADR-044**：工具树（`build/` `dev/`）**不纳入**树边界治理 —— 这是显式决策；跨树运行时路径依赖改由路径常量存活性断言看守

## 验证基线

`docs/DEV-GUIDE.md` 的「验证基线」节是命令单一出处；`docs/REQ.md` 是号与状态的唯一分配源。

## 目标

上一轮 7 项里 6 项已收口（见下表），**剩 REQ-121 未开工**，加上评审期间新登记的 REQ-124 / REQ-125。本轮把这三项落地。

## 已完成（本轮）

| 步 | 工作项 | 结果 |
|---|---|---|
| #A | REQ-118 / 119 / 123 | 通过 2026-10-02：三道门禁顶层自执行痕迹 = 0；报告判据覆盖 POSIX 形态且 URL / 日期不误伤（21 条夹具）；`--all` 面同病因只计一次 |
| #B | REQ-117 / 120 | 通过 2026-10-02：图片夹具逐字节比对 2 → 5 张（磁盘派生）；`getVersion` 拒绝分支显 `v?` + 本地化原因，不回填假版本号 |
| #C | REQ-126 / 127（由 REQ-116 拆出） | 通过 2026-10-02：preload 根改注入传入并删掉自算根，缺失时显式抛错指名注入方；`mediaConditions` 改惰性 + 记忆化 |

## 剩余泳道

| 步 | 工作项 | 目标 | 可写文件（互不重叠） | 退出条件 | 门禁 | 结果 |
|---|---|---|---|---|---|---|
| #D | REQ-121 | 收口 16 处自算根存量 | `test/renderer/*.test.js`（9 个文件） | 16 处改为 `import { ROOT } from "../../shared/paths.js"`，各段行为不变 | `check:boundary` `lint` `typecheck` `M2W_ONLY=<受影响段> test:only` | 未开始 |
| #E | REQ-124 / 125 | 补判据本体 + `src/` 纳入扫描面 | `gates/repo/check-import-boundary.mjs`；其 selftest；`src/main/menu.ts`；`src/main/windows/main-window.ts` | 两语句式自算根判红；`src/` 与 `.ts` 纳入扫描面；`selfCheck` 补双向锚点否则恒绿 | `check:boundary` `check:contract:selftest` | 未开始 |

**#D 与 #E 必须串行**：#E 扩大扫描面后会把 #D 改过的文件纳入判定面，两者同时改会互相污染。#D 先行。

## 完成标准

- [ ] 16 处 `test/renderer/*` 自算根改完，`check:boundary` 绿（REQ-121）
- [ ] 两语句式自算根判红；`.cjs` 隐式 `__dirname`、多行连写 `path.join`、二次赋值、字符串字面量未遮罩 4 个绕过面同堵（REQ-124）
- [ ] `src/` 与 `.ts` 纳入扫描面，源侧两处自算根收口；`selfCheck` 补 `(relPath, text)` 双向锚点（REQ-125）
- [ ] `npm run verify:ci` exit=0 且 `npm run check:gates` 全绿 —— **两者均只由主会话在泳道收工后各跑一次**

## 修复项复测

- [ ] 已修并复测：`repo-manifest.mjs` 声明被按磁盘存在性过滤 → `build.files` 判据在干净检出上恒红（CI 实证红），已改为取声明 + 交付面豁免存在性，并补「干净检出 → 判绿」回归守卫夹具（41 → 42 条）

## 怎么回滚

两条泳道各自独立成提交，`git revert <sha>` 即可。#E 若新规则误伤面过大，先撤回规则本体而保留 REQ-125 的登记。
