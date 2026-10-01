> 结论去向：落 REQ.md 行
>
> 未升 ADR：修法未落地，且「失败项保留在注册表」是既有设计而非待改决定，不构成需要新 ADR 的架构变更。

# CI run 36836273547 现场取证:`test-common-helpers` 的 EPERM 判红

> 这份材料的价值在于它是**唯一一份 CI 侧现场**。此前 REQ-136 的真因一直标「未证实」,
> 正是因为 `failure.log` 没被捞到;捞到后**当场推翻了主会话此前的判断方向**(见第六节)。

## 一、来源与取法

```
gh run download 36836273547 -n ci-diagnostics -D <tmp>
→ failures/segments_test-common-helpers/failure.log   (77 行, 未过保留期)
```

run 元信息:`2026-10-01T08:26:06Z` · sha `07c2ea2` · 标题 `docs: REQ-133 判作废` ·
artifact `ci-diagnostics` 2915 B · `expired: false`。

⚠️ **`gh run download` 必须在 git 仓库目录内执行** —— 在临时目录里跑会报
`fatal: not a git repository`,输出目录另用 `-D` 指定即可。

## 二、三条失败同源,不是三个独立事件

| # | case | 结果 | 耗时 |
|---|---|---|---|
| 1 | Windows 真实占用:删不掉时全链路上报,解除占用后兜底能收干净 | **失败** | 4562ms |
| 2 | 退避真的在重试:占用型 EPERM 靠等待化解(不是靠删后复查) | 通过 | 1001ms |
| 3 | withTempResource:主体失败与清理失败同时发生时两条都在消息里 | **失败** | 3028ms |
| 4 | 段末无临时资源残留 | **失败** | 1512ms |

**全部 3 条失败指向同一个目录** `m2w-selftest-RTHDwm`,且**入口基线是 0**
(第 55 行 `系统临时区 m2w-selftest-* 基线 0`)⇒ 该目录在本段内创建、至段末未消失。

第 1 条耗时 **4562ms** 而其内部操作均为毫秒级 ⇒ 这 4.5 秒是 `removeTree` 的重试退避
在空转,不是业务耗时。

## 三、自我污染的机制(已核实)

`test/common/temp-resource.js`:

- `tryCleanup:225-229` —— **只在 `outcome.ok` 时** `registry.delete(resource.path)`;
  失败时**保留注册项**
- `cleanupTempResources:249-260` —— 收集全部失败项后 `throw`,**不清空注册表**

⇒ `stuck` 这个删不掉的资源**一直挂在注册表里**,后续每个 case 的兜底清理都会再次
撞上它、再次抛同一条消息。**这就是 3 条失败的同源性,以及它自我传播的机制。**

**且这是有意设计,不是疏漏**:`test-common-helpers.test.js:471-472` 有断言明写
「删除失败时资源须保留在注册表(可被后续重试/兜底寻址)」。⇒ **任何"失败即清空注册表"
的修法都是错的** —— 那会推翻一条被断言守着的意图。

## 四、真正的缺陷候选:释放占用后只给了**一次立即**重试

`test/segments/test-common-helpers.test.js`:

```
:474    } finally {
:475      releaseOccupancy();      ← 同步 process.chdir 回原处,零等待
:476    }
:477    const retried = cleanupTempResources();   ← 紧接着第一次重试
:478    assertIncludes(retried.removed.join(","), stuck.path, …)
:479    assertEq(fs.existsSync(stuck.path), false, …)
```

`releaseOccupancy()` 是同步 `process.chdir`,`:477` **零间隔**跟上。

**该 case 本身断言的行为与夹具存在张力**:`:455` 要求「被占用时删除必须报失败」、
`:469` 要求 `existsSync(stuck.path) === true` ⇒ **占用期间删不掉是预期行为,不是缺陷**。
缺陷候选**只有一个**:释放占用后 `:477` 那一次重试**没给 Windows 足够时间**让句柄真正释放。

重试参数在 `test/common/temp-resource.js:55-61`:`REMOVE_RETRY_DELAY = 100`、
`REMOVE_MAX_RETRIES` 默认值有限(该处注释自陈:参数被调成 0 会「Windows 必假失败」)。

## 五、本机零复现的原因(此前压测压错了对象)

REQ-136 期间做过 5600+ 次「释放 cwd 占用后立即删除」压测,零失败。那批压测的是
**裸 `fs.rmSync`**,而真实路径走 `removeTree` 的重试循环 + `cleanupTempResources`
的注册表语义 —— **压的不是同一条路径**。

⇒ 「本机 5600 次零复现」**不能**用来否证本条真因。

## 六、被这份现场推翻的既有判断(记录在此以免重犯)

| 原判断 | 事实 |
|---|---|
| 「同源假设:runner-report 的 `taskkill /T /F` 杀树时句柄未释放 → 撞掉邻段 EPERM」 | 进程树快照已否证(两段宿主是兄弟,树不覆盖邻段)—— 此判断**成立** |
| 「真因是 `releaseOccupancy()` → `fs.rmSync` 之间的句柄释放窗口」 | **方向错**。真因在 `:477` 那一次重试的**等待不足**,以及失败项留存导致的**自我污染**。原派工把验证对象设成裸 `fs.rmSync`,压错了路径 |
| 「判据零活样本 ⇒ 不成立」类推 | 本案证明:**压测对象选错,会让真缺陷显示为零**。这是 REQ-124「全仓 0 命中」之外的另一个同型陷阱 |

## 七、仍未证实

- Windows 上 `process.chdir` 释放后**到底需要多久**才能重新删除该目录 —— 日志只证明
  「即刻删除失败」,没有给出所需时间量级。**修法要给有界等待,具体值需要实测确定。**
- 该 run 是否为孤例:此失败自出现起 8+ 轮未复现,样本量为 1。**不能声称已修复。**
- 第 2 条 case(退避真的在重试)通过且耗时 1001ms,与第 1 条的 4562ms 形成对比 ⇒ 退避
  机制本身在工作,但**对它实际重试的那个 case 给的时间不够** —— 该推断未实测。