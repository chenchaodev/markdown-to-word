# PLAN · 目录治理三条需求(REQ-144 / REQ-142 / REQ-143)

> 大型需求载体。**执行顺序 144 → 142 → 143** 由写集依赖决定:144 让 `build/`+`dev/` 落到最终位置 `tools/`,后两条就不必改两遍路径。

## 相关 ADR

- [ADR-038](adr/ADR-038-gates-test-shared三层与跨树边界.md) · 部分被取代 —— 三层划分与「层按断言对象分」不变;「`build`/`dev` 不 assert 任何东西」一句与实现不符(见 ADR-049)
- [ADR-043](adr/ADR-043-树边界规则allowlist与shared零跨树出边.md) · 现行 —— 树边界规则取 allow-list 形态、`shared/` 零**跨树**出边(树内互依与 `node:` 内建放行)。本次不改此条
- ADR-049 · REQ-144 新立 —— 工具函数下沉 `shared/` 与 `clean-artifacts` 归位(开工时落)

## 验证基线

`docs/DEV-GUIDE.md`「验证基线」一节。本次全三条命中「开发回路不得省全量」第 ① 类(动了门禁脚本与段目录发现机制),故每步跑筛段 + 全部纯文本门禁,**收尾跑一次 `npm run test` 全量**。

纯文本门禁清单(`package.json` scripts 为唯一单源):`check:boundary` `check:temp-cleanup` `check:test-numbering` `check:contract` `check:docs`(本地手动) `check:archive-index`。

## 目标

把顶层六棵树按「是否产生断言」重新归类,让测试树的目录名表达被测主体而非执行单元,并消掉 `gates/artifacts/check-dist-manifest.mjs` 被当通用工具库用这一根源。

## 下一步

等 REQ-144 步骤 ①②(fixer `fix-1`)落位并验证通过;随后派 ③(合并为 `tools/` + 补两条边界规则),再依次 REQ-142、REQ-143。

## 步序与泳道(串行,无并行)

| 步 | 号 | 内容 | 依赖 |
| --- | --- | --- | --- |
| 1 | REQ-144①② | 工具函数下沉 `shared/cli.mjs`+`fsx.mjs`;`clean-artifacts.mjs` → `gates/artifacts/` | — |
| 2 | REQ-144③ | `build/`+`dev/` → `tools/`;`TREE_BOUNDARY_LITERAL_PREFIXES` 缩到 `['dist']`;加 `tools-stay-in-tools` 规则 | 步 1 |
| 3 | REQ-142 | `test/segments/` → `test/core/`+`test/gates/`(17 段);删 `test/tools/` | 步 2 |
| 4 | REQ-143 | `acceptance/`→`docs/`;两个 png 入 `input/`;`main/`→`input/` | 步 3 |

**为何全串行**:三对两条写集重叠 —— `test/segments/import-boundary.test.js`(142 与 144③)、`dev/visual-check.mjs`(143 与 144③)、`test/segments/contract-single-source.test.js`(三条全动)。顺序反了要多一轮路径返工。

## 整体完成标准

1. **顶层六棵树 → 五棵**:`src` `test` `gates` `shared` `tools`;`tools/**` 对 `gates/**` 的 import 零条(用 `grep` 复核)。
2. **边界规则覆盖五棵树**:`TREE_RULES` 五条(`gates` `test` `shared` `tools` + …),`TREE_BOUNDARY_LITERAL_PREFIXES` 只剩 `dist`;`check:boundary` 实跑绿,且**两条新增负向锚点**证明 `tools` 的 allow-list 真会判红(不是恒绿断言)。
3. **测试树四对镜像**:`test/{core,main,renderer,gates}/` 各自对应 `src/{core,main,renderer}/` 与 `gates/**`;段数与迁移前逐段相等(`git mv` 不改内容,不等即有文件丢失或重复)。
4. **`test/tools/` 目录消失**,ADR-038 该条目标态达成;负向锚点换替身(`test/pending`,历史上真存在过的被删暂存区名)。
5. **夹具区三子目录命名轴统一**为「内容是什么」:`docs/`(原 `acceptance/`)+ `input/`(原 `main/` + 两个散落 png)+ `manual/`;`test/fixtures/` 根目录只留这三个目录,无散落文件。
6. **`check:fixtures` 绿** —— 它同时覆盖「生成产物与磁盘一致」与「全部图片夹具字节与基线一致」两条,是 REQ-143 的天然判据。图片基线须经 `--print-image-baseline` 重新登记,不得手改 JSON。
7. **全部纯文本门禁绿** + `npm run test` 全量绿(收尾一次)。
8. **文档同步**:`docs/DEV-GUIDE.md` 的命令表路径与代码地图(六棵树那几行改 `tools/`)、`AGENTS.md`「文件信息」节、ADR-038 状态行标取代、ADR-049 已立、`docs/evidence/INDEX.md` 脚本重生成。
9. **三条台账行各自落「已完成」**,`docs/PLAN.md` 逐条划完后删除。

## 步 3(REQ-144③)执行前的核查结论

- **`selfCheckTreeLayout` 有连带**(`gates/repo/check-import-boundary.mjs:1008`):它把 `TREE_DIRS` 的键与 `TREE_BOUNDARY_LITERAL_PREFIXES` 合起来当「已登记树名」白名单。故把字面前缀组缩到 `['dist']` **不是单独一处编辑** —— `test-stay-in-test` 的 allow 面(`:898`)现写着 `build` 与 `dev`,一旦移出字面组即成「既非树名也非字面前缀」,自检判红。须同步改为 `tools`。诊断文案里的树名列表(`:1019`)从 `TREE_DIRS` 派生,不用手改。
- **无需改的**:`.gitignore`、`package.json` 的 `build.files`、两个 tsconfig 均无 `build`/`dev` 字面项(已 grep 确认)。
- **DEV-GUIDE 待改 5 处**:`:8` `:12`(setup-env 路径)、`:32`(icons 路径)、`:63`(ui:shots 路径)、`:130`(代码地图六棵树那几行合并为 `tools/`)。

## 怎么回滚

每步一个提交(`git log --oneline` 按 `REQ-0NN` 可反查),逐步 `git revert <sha>` 即可单步回退。**跨步依赖方向单一**(1→2→3→4),不存在需要同时回退多步的情形。

唯一需注意的跨步残留:步 3 与步 4 若已分别提交,回滚步 2(③)时步 3/4 的 `tools/` 路径会失效 —— 故回退须**从后往前**(4→3→2→1),或直接回退到步 1 之前的 commit。

## 修复项复测

| 步 | 提交 | 状态 |
| --- | --- | --- |
| 1 REQ-144①② | `63dfe59` | ✅ 已验证 |
| 2 REQ-144③ | `09d03ff` | ✅ 已验证 |
| — 台账 | `3ae911b` | REQ-144 转已完成 |
| 3 REQ-142 | `0852954` | ✅ 已验证 |
| — 台账 | `c7333c6` | REQ-142 转已完成 |
| 4 REQ-143 | (fix-4 运行中) | ⏳ |
| 收尾 | — | ⏳ 全量 `npm run test` 未跑 |

### 步 3(REQ-142)的复核结论

- 段数守恒已独立复核:`core=58` `gates=17` 合计 **75**,与迁移前相等(不等即有文件丢失或重复)。
- 两个 `BASE_SHAPE` 陷阱已绕过:原五目录计数 16+11+11+6+6=50 恰好压 `MIN_SCAN_FILES=50`,删 `test/tools/` 后 45 跌破下限;配额已重分配为 54/55。子代理顺带发现旧注释的「+1」算术本就不成立(`createFixture` 把 `test-common-surface.js` 拷到 `shared/` 下,不在扫描面内),真正必须补的是**顶层四个空树** —— 镜像判据判的是顶层,夹具不造就恒红。
- 镜像判据的判定对象比派工描述宽一层:实跑第一版按「顶层须有 `core/`」写立即判红(`src/core` 才是那棵树),改为「顶层目录自身 ∪ 其直接子目录」—— 四对镜像里 `test/gates/` 镜像顶层树自身、`test/{core,main,renderer}/` 镜像 `src/` 的子目录,两层正好。
- `check:archive-index` 曾判红,是 REQ-144 收尾残留(台账行改指 ADR 后 evidence 文件不再被按名引用,生成器改判 `—`),已重生成修正 —— **非 REQ-142 引入**。

### 已交付的复核结论(主会话独立验证,不采信子代理自证)

- **步 1 抓到一处子代理引入的层级缺陷并当轮修掉**:`shared/cli.mjs` 里 `CLI_USAGE` 写死 dist 清单门禁的 `--help` 文案,还被 `parseArgs` 拼进所有调用方的报错 —— 机制层知道了某门禁的参数表,且比下沉前更糟(原先是 `check-dist-manifest.mjs` 的**私有** `const`,单使用者)。改为 `parseArgs` 收可选 `usage`、各门禁各传各的。顺带发现 `clean-artifacts.mjs` 早前正因此另写了一份 `parseArgs`,现已并回共享实现。
- **步 2 的树边界规则独立复核**:造沙盒跑 `analyzeTreeBoundaries`,三条负例(`tools/` 引 `test/` `src/` `gates/`)全部判红并点名规则 id 与行号,正向样本(引 `shared/`)零误伤,`selfCheckTreeLayout` 返回空 ⇒ 规则真会判红,非恒绿断言。
- **步 2 查出的清单外硬编码**(漏改会静默失效):`gates/geometry/geometry/driver.mjs` 的 preload 运行时常量 · `gates/probe/gate-probes/sandbox.mjs` 的运行时 argv · `test/segments/contract-single-source.test.js` 的 `listJsSources` 扫描面 · `AGENTS.md` 与 `CONTRIBUTING.md` 各一处 `setup-env.ps1` 活路径。
- **`check-import-boundary` 只判方向不判存在性**:步 1 实施中 `gates/artifacts/pack-size/{cli,util}.mjs` 相对深度写错(方向合法、模块不存在),靠逐个 `import()` 才抓住。步 2 移动全部 7 个文件时同样逐个验了可解析性。

### 已知未覆盖

- `npm run ui:shots` 未实跑(需 GUI + dist 产物)。`tools/visual-check.mjs` 的可解析性以「相对 specifier 逐条 resolve + 零 `../gates/` 出边」等效证明;它在真 Electron 下的启动路径未被覆盖 —— `shared/entry-guard.mjs` 只能在真 Electron 主进程加载,纯 node 下 import 必失败,与本次移动无关。