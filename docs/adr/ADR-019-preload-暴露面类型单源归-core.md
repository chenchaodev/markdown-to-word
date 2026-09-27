# ADR-019 preload 暴露面类型单源归 core

> 规则见全局配置目录 @WORKFLOW-PLAN.md 阶段 1;全量索引与编号唯一真值 → `docs/ADR.md`「编号台账」。

### 2026-09-27 08:48:38 preload 暴露面类型单源归 core,renderer→main 反向依赖清零(ADR-019)
- 决策:`window.api` 的类型单源从 `src/main/preload.cts` 内的 `typeof api` 推导,改为 core 侧显式声明的 `core/preload-api.ts`。`preload.cts` 以 `const api: PreloadApi` 标注实现对象并在文件末尾做键集双向断言,`renderer.ts` 从 core 取用类型。`check-import-boundary.mjs` 的 `REVERSE_TYPE_ALLOWLIST` 放行机制**整体删除**(非只删条目),`renderer-no-main` 由此从「带一条 type-only 放行例外」变为**绝对**规则
- 理由:改动前 `renderer/renderer.ts` 只能 `import type { PreloadApi } from "../main/preload.cjs"`,那是全库唯一一条 renderer→main 依赖,靠门禁的放行表挂了近一年 —— 而该表自己的注释就写着「层向收口项(反向 type-only 依赖待收敛)」与「收口方向:把 PreloadApi 抽到 core 侧共享契约模块」。收口后 renderer 不再依赖 main 的任何东西
- 安全性未降低(这是手写类型相对推导类型的关键取舍):`typeof api` 是**推导**的,构造上不可能与实现漂移;手写类型会引入一个方向 —— 从 `api` 删方法而类型里留着时 tsc 是沉默的,renderer 要到运行期才炸。故在 `preload.cts` 补**键集双向断言**(`Exclude<keyof typeof api, keyof PreloadApi>` 与反向各一条),把两个方向都锁在编译期、报错信息即缺失键名。净效果与推导等价。签名级的漂移仍由「实现必须满足类型」单向覆盖,方向本就正确
- 为何删机制而非只删条目:放行表的唯一使用者就是那一条,删掉条目后它连同「失效条目提示」与其两处测试夹具一并成为死代码。`stripExtension` 因仍被 core 的 `node:` 白名单匹配使用而保留
- 附带反转了一条既有测试语义:原先「renderer type-only 引 preload」是**判绿**的正向锚点,收口后改为**判红**,并新增一条证明运行时 import 同样判红 —— 编译期擦除只能证明产物无此依赖,不能证明层向本身合理
- 来源:REF-025 #03
- 关联:`docs/ROADMAP.md` REF-025、`scripts/check-import-boundary.mjs`、`docs/adr/ADR-001`(非对称转换管线)
