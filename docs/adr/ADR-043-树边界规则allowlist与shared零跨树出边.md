# ADR-043 · 树边界规则取 allow-list 形态，shared 零出边收窄为零跨树出边

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-01 |
| 取代 | **部分取代 [ADR-038](ADR-038-gates-test-shared三层与跨树边界.md)** —— 只把其表里 `shared/**` 的「无（零出边）」精确为「零**跨树**出边」；三层划分、其余四条规则、`test/fixtures/` 只读数据一条不动 |
| 关联 | [ADR-038](ADR-038-gates-test-shared三层与跨树边界.md) · [ADR-042](ADR-042-行为契约清单走声明加等式纯清单走磁盘派生.md) · [REQ-110](../REQ.md) |

## 决定

[ADR-038](ADR-038-gates-test-shared三层与跨树边界.md) 定的五条边界规则落地为 `scripts/check-import-boundary.mjs` 的一张新规则表 `TREE_RULES`，两点与 ADR-038 的字面表述不同：

1. **判据形态是 allow-list**（白名单外一律判红），与既有 8 条 `src/**` 规则的 deny-list 形态**语义相反**，故两者**分表**、不合并 —— 合并会出现「同一张表里既有黑名单又有白名单」的读法歧义。
2. **`shared/**` 的「零出边」精确为「零跨树出边」**：树内互依与 `node:` 内建**放行**。`shared/paths.js:17` 本身 `import path from "node:path"`；几何三件套迁入后 `geometry-page.mjs → ./geometry-core.mjs`。按字面「零 import」实现就必须先改写 `shared/paths.js`，与迁移实况直接冲突。

## 背景

ADR-038 立下边界规则，但落地时暴露出两条此前没写下的约束：

**其一，既有规则的形态是 deny-list。** `LAYER_RULES` 的 8 条 `src/**` 规则是「命中某模式即违规」，它的价值在于**新写法默认合法**（先有 `core-no-host` 才知道 core 不能 import `node:fs`）。树边界要求的是反过来的形态：`scripts/` **只许**引 `scripts/`·`shared/`·`test/fixtures/`。若沿用 deny-list，就得手写「`scripts/` 不得引 `test/common/`」「不得引 `test/tools/`」等 N 条，而 `test/` 下新增任何子目录都不在 N 条覆盖内 —— 又变成一次「枚举已知」。allow-list 让「新目标默认非法」，新增目录无需登记即被拦。

**其二，「零出边」按字面实现不可行。** 这是执行期的实测结论，不是设计偏好：`shared/paths.js` 要 import `node:path`，几何三件套作为判定层要互相引用。共享层的「零出边」若字面化，连共享层自己都写不出来。按 ADR-042 的判据回看 —— 一个**不能引用自身、也不能引用宿主内建**的层不是层，只是碎片。

## 备选方案

| 方案 | 不选的理由 |
|---|---|
| 沿用 deny-list，与既有 8 条合并成一张表 | 读法歧义（同一张表两种语义相反的判据）；且 deny-list 要求逐个枚举 `test/` 子目录，新目录漏登记即静默放行 —— 与本仓反复在治的「静默降级」同类 |
| `shared/**` 字面零 import（含 `node:` 内建） | `shared/paths.js` 必须重写才能存在；且共享层连宿主内建都不能用，它与 `src/core/` 的区别就只剩「名字不同」了 |
| 树内互依放行但 `node:` 内建不放行 | 内建 import 不构成跨树依赖，与边界规则要防的东西无关。拦住它只会逼出绕过写法 |
| 把 `shared/` 判为 `src/core/` 那种「能力靠注入」 | 共享层要用 `node:fs` 遍历（`copy-closure`）与 `node:path`（`paths`），它就是机制层不是产品层，判成 core 类别会让「core 不依赖宿主」那条规则的语义被稀释 |

## 后果

- 规则表按**逻辑树名**书写、判定时才换实际目录名，唯一改名点在 `TREE_DIRS`。泳道把 `scripts/` 改名为 `gates/` 时只改这一行，避免改名漏改诊断文案里的路径。
- 树扫描**固定锚在 `projectRoot`**，与 `--src` / `--flavor` 无关（理由同 `ROOT_COMPUTE_SCAN_DIRS`）。**不是**锚在 `path.dirname(--package)`：树边界守的是**本仓的三棵树**，而 `--src` / `--package` 描述的是「某棵子树的某次局部扫描」—— 沙盒只铺 `src/` 一棵树，让它参与树边界判定会因「缺 `test/` 与 `shared/`」恒红，而 `main()` 的树自检分支会**提前 return 1**，把那些沙盒本来要验的 src 层诊断一并吞掉（实测：`import-boundary` 段 6 条既有锚点连带失败）。沙盒要验树边界，直接调 `analyzeTreeBoundaries(sandboxDir)` / `selfCheckTreeLayout(sandboxDir)`，那才是精确的单元级断言。
- 「扫不到就等于没规则」是这类判据最危险的失效形态，故 `selfCheckTreeLayout` 每次 `check:boundary` 都验：三棵树齐备、规则表覆盖完整、**允许元素首段不是拼错的树名**（拼错的树名会退化成字面量、整条规则恒绿）。前两条是存在性，第三条是判据写法 —— 三者缺一条，门禁就会以「恒绿」的形式失效。
- 判定前先喂 `lexSource(...).code`（已抹注释），否则注释/文档里为说明「历史上长这样」而写的 specifier 会被当成真依赖（本仓实测有这类假边 3 处）。`cjs:true` 一并覆盖 `.cjs` 的 `require()`。
- 白名单元素按**路径段**比而非 `startsWith` —— 否则 `test/fixtures-old/` 会被 `test/fixtures` 放行。规则表另有自检：白名单元素树名段必须落在已登记的树名集合内，否则拼错的树名退化成字面量、整条规则恒绿。
- 判定消息带**行号**：诊断形态为 `<路径>:<行号>:import「<specifier>」越出 <scope>/ 的允许面;违反树边界规则 <id>`。行号真实性有负向锚点钉住（造 2 行注释 + 第 3 行 import，断言诊断点名第 3 行）。