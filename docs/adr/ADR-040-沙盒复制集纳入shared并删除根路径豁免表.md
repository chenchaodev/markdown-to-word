# ADR-040 · 沙盒复制集纳入 shared/ 并删除根路径豁免表

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-09-30 |
| 取代 | 无 |
| 关联 | [ADR-037](ADR-037-顶层与扫描面一律派生.md) · [ADR-038](ADR-038-gates-test-shared三层与跨树边界.md) · [ADR-039](ADR-039-门禁自检判据与探针必填.md) · [REQ-110](../REQ.md) |

## 决定

沙盒（per-file 与 tree-mirror 两种）执行的门禁脚本一律从 `shared/paths.js` 取项目根，`scripts/check-import-boundary.mjs` 的 `ROOT_COMPUTE_EXEMPT_FILES` **整表删除**。

同时新增一条 **per-`via`** 断言：任一复制点文件复制了会 import `shared/paths.js` 的脚本，则该复制点的复制集合必须含 `shared/paths.js`。

## 背景

[ADR-037](ADR-037-顶层与扫描面一律派生.md) 要求项目根单源化，收口到 `shared/paths.js`（`ROOT = path.resolve(import.meta.dirname, "..")`）。26 处自算里 17 处已收口，余 9 处改不了 —— 它们被**逐字节复制进沙盒**执行，沙盒里没有 `shared/`，两条失败路径同时成立：运行时 `ERR_MODULE_NOT_FOUND`，以及副本闭包门禁报 `relative-outside-copy-set`。

先例已存在：`check-temp-cleanup.mjs:77` 早已 import `../test/common/copy-closure.js`（副本在 `scripts/` 外），其 selftest 为此补过复制点。本条是沿用同一模式，不是新机制。

两套复制机制**完全正交**（`copy-closure-audit.js:30-36`）：per-file（6 个复制点 → 11 个副本，**判红**）与 tree-mirror（仅 `gate-probes/sandbox.mjs:226`，清单 = `TREE_MIRROR_PATHS`，**只登记不判红**）。本条要求两套都加 `shared`。

### 三处必须写进背景的事实

**一、闭包门禁是全局并集，会 fail-open。** `auditCopySet` 的 `relSet` 是**所有复制点副本的并集**（`copy-closure-audit.js:276`），不是 per-sandbox。所以只要**任意一个**复制点复制了 `shared/paths.js`，门禁就全绿 —— 而另外 6 个沙盒全断。**门禁无法发现「某个点忘了复制」。** 这条直接决定了 per-`via` 断言的必要性。

**二、tree-mirror 沙盒当前已坏，且 CI 看不见。** `TREE_MIRROR_PATHS`（`contract.mjs:27-35`）有 `scripts` 无 `shared`，而沙盒内执行的两个文件已 import 它：`scripts/copy-renderer.mjs:17`（经 `buildSandbox`）与 `test/tools/gen-fixtures.mjs:26` → `test/common/paths.js` → `shared/paths.js`（经 `probeFixtures`）。这是收口根路径时引入的，**与「26 处收口」是两件事**（后者是重构，前者是它带来的缺陷）。更糟的是 `check:gates` 不在 `verify:ci`、也不在任何 CI workflow 里（只有 `package.json` 的本地脚本），所以这条破坏 CI 看不见，**只能靠显式跑 `npm run check:gates` 验证**。

附带两处既有洞：`report.mjs:58-62` 只对 `build.caveat` 建 finding，从不检查 `build.clean === false` ⇒ 沙盒构建失败降级成装饰性 advisory；`PROTECTED_PATHS`（`contract.mjs:38-46`）同样没有 `shared` ⇒ 「真实工作树零注入」指纹不覆盖新顶层目录。本条一并修 `PROTECTED_PATHS`。

**三、`clean-artifacts.mjs` 不在副本集合里。** `clean-artifacts-gate.test.js:95` 是 `writeFileSync` 而非 `copyFileSync`，扫描器看不见它。所以它的豁免理由与其余 8 个**不同源**，且闭包门禁**结构上看不见它** —— 若改成 import `shared/paths.js`，沙盒漏写不会被 `relative-outside-copy-set` 抓到，只能靠 `test:coverage` 运行时红。

## 备选方案

| 方案 | 不选的理由 |
|---|---|
| 参数 / env 注入根 | 9 个脚本每个都要长出「没有 env 就自算」的分支 —— 那正是被禁写法，立刻要新豁免类别；且改 9 个脚本的 CLI 契约 = 改对外接口 |
| 把 `shared/paths.js` 挪到已被镜像的位置（如 `test/`） | `test/` 只被两个 per-file 沙盒复制，`scripts/` 语义上是可执行文件树。放进 `test/` 会让「门禁依赖测试目录」这条已有病更重 |
| 每个 per-file 沙盒改用 `cpSync` 复制 `shared/` | 这会注册成 `tree-mirror`，而 tree-mirror **永不判红** —— 恰好在需要守护的地方丢掉守护。明确否掉 |
| 保留 `ROOT_COMPUTE_EXEMPT_FILES` 豁免表 | 9 条豁免里 8 条由复制点解释、1 条由 `writeFileSync` 解释，全部改完后维护一张豁免表没有任何理由。删表是本条最强的净收益 |
| 把 `auditCopySet` 改成真正的 per-sandbox 分组 | 要重设数据模型。本条只做 per-`via` 断言（成本低，把 fail-open 收成近似 fail-closed），真正的 per-sandbox 分组**明确不做**，见后果节 |

## 后果

- 豁免表归零。**但删表后唯一的反向锚点也一起没了** —— 今天的反向锚点只查 `existsSync`（`check-import-boundary.mjs:568-572`），**不验证复制点是否还在**。即豁免表时期「文件被删」能发现，「复制点被删」发现不了。删表等于让这个弱点自然消失，是净改善；但要记住它是**既有的**独立弱点。
- **行为等价**：`import.meta.dirname` 是位置相对的，副本落在 `<sandbox>/shared/` 时算出的 `ROOT` 正好是沙盒根，`FIXTURES_DIR` / `ARTIFACTS_DIR` 等派生量随之指向沙盒 —— 与今日自算根完全一致。
- 验证必须**显式跑 `npm run check:gates`**（不在 CI 链上），不能指望 `verify:ci`。`PROTECTED_PATHS` 含 `output` 且 `diffProtectedTree` 是 strict ⇒ 副本若写进真实工作树会以 `protectedTree.unchanged === false` 判红，这就是检测「根指错」的机制。
- **明确放弃的**：per-sandbox 分组（`auditCopySet` 数据模型重设）。触发重看条件：per-`via` 断言多次漏判、或出现「需要按沙盒差异化复制集」的真实需求。
- `check-temp-cleanup.mjs` 少一个自算根、多个 `shared/paths.js` 入边；闭包门禁的 `[ok]` 打印会多一项；`clean-artifacts.mjs` 只能靠运行时红来兜（见背景三）。
## 后记:本 ADR 的门禁部分已退役（2026-10-04）

**上面「决定」里描述的那套门禁（副本闭包 + `auditCopySet` + `SANDBOX_ENTRY_EVIDENCE` 入口登记）已退役**，取代物是 `gates/repo/check-copy-sites.mjs` 的白名单式 fail-closed 门禁。决策记录按「旧条不改动」保留原文，**以本节为准**。

**退役理由不只是「简化」** —— 那套门禁是 fail-open 的，四个具体表现：全局并集（任一沙盒带了 `shared/paths.js`，其余全漏也判绿）· per-sandbox 只查一个硬编码文件 · 解析不出只登记不判红 · 机制白名单只有三个原语且整树镜像永不判红。抽查还查出一处**连登记都不出现**的形态：某个数组字面量 `for…of` 里的复制点，既不在 `copies` 也不在 `unresolved`（表达式求值器把未知标识符当仓库根，返回一个非源码字面量后被静默丢弃）⇒ 「新增复制点会被自动纳入」这句话当时**已经不成立**。

**本 ADR 仍然有效的部分**：复制集纳入 `shared/` 的分层判断仍然成立（两个逐文件沙盒今日仍保留副本），删除根路径豁免表也仍然成立。

**一处本 ADR 未预见、后来才显形的约束**：逐文件沙盒里有一条用例必须**改写门禁自己的源码**，而 `copyFileSync` 做不到这件事 ⇒ 该沙盒的副本不能按「反正不复制就不漏带」的直觉一并删掉。
