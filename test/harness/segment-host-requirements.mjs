// @ts-check
/**
 * 验收段的**真实 Electron 宿主需求表**:哪些段要真宿主,以及缺的是哪个能力、为什么 mock
 * 补不了。键 = 段名(相对 `test/` 的 posix 路径,与 `shared/test-common-surface.js` 的
 * `SEGMENT_DIRS` 同域,与 `runner.js` 的 `segmentPrefix` 产出的段名逐字同形)。
 *
 * ## 这张表回答什么、不回答什么
 *
 * **回答**:哪些段不能脱离真实 Electron 宿主跑,以及**根因**。名单的价值全在根因可复核 ——
 * 只列段名等于让下一个人重新实测一遍。
 *
 * **不回答**「该派哪个可执行文件」。那是 REQ-219 / `docs/PLAN.md` #07 的写域,已裁决撤步
 * (见 `docs/adr/ADR-067-验收宿主两档分档.md`)。**本表独立于那个决定存在**:分档没了,
 * 「哪些段要真宿主」这个问题仍然是本仓的事实,表就不随之作废。反过来说,若哪天有人拿
 * 「表里有 16 条却没人读」当理由删掉它,那是把知识删了 —— 删之前先看下面这段来历。
 *
 * ## 来历(为什么一张提速清单里长出了知识表)
 *
 * REQ-133「验收段迁纯 node 宿主」(`docs/REQ.md` 台账,状态**已作废**)做过一次实测,结论是
 * **方向无效**:CI 地板不降反升(2125→2196ms,`sum` −1.9% 落在抖动内),CI 的地板是
 * **创建 `electron.exe` 这个进程**的成本(全新 VM + Defender 实时扫描),`ELECTRON_RUN_AS_NODE`
 * 省不掉。那次实现里带出一份 opt-out 表,本文件是它的知识留存。
 *
 * **值得留的不是提速,是那份表**:它把「哪些段不能迁、为什么」从一份 evidence 搬进了代码,
 * 于是根因可复核 —— 段要真宿主的理由不再只存在于一份两个月前的实测记录里。
 * 顺带说明:键名已按现状订正过一轮(原表含 `segments/` 前缀,该目录已被 ADR-062 的测试树
 * 瘦身移除;另有段在目录搬移中改了前缀)。故本表键与 `cb3eb9c` 里的原表**不是逐字相同**,
 * 但 16 条根因原文一字未改 —— 它们是实测结论,改写即失去可复核性。
 *
 * ## 根因分三类(判读本表的坐标系)
 *
 * - **① 需真实渲染**:Chromium 真出 PDF / PNG,mock 只能返空 Buffer(空 Buffer 连
 *   「可解析」这一层都过不去)。
 * - **② 需真实宿主对象**:窗口 / 会话 / 菜单 / 剪贴板 / 显示器,mock 是空实现,**补它等于把
 *   断言改成断言 mock 自己**(断言的是 mock 的返回值,不是被测行为)。
 * - **③ 段测的就是宿主自身**:它断言的正是「段宿主怎么起进程、怎么杀超时」。
 *
 * ⚠ 本表当前**没有 ③ 类成员** —— 当年归类时留了这一档,实际 16 条全落在 ① 与 ②。
 * 留着这档是为了下一个人新增段时有现成归口(尤其是「本段就是在测宿主」这类,极易被误当成
 * 「别的段顺手测一下」而错归到 ②),不是指它有成员。归类速查:`behavior/packaged-smoke`
 * 与 `main/converter` 是 ①;`main/ipc-register`(Menu)、`main/temp-markdown`(剪贴板)是 ②;
 * `behavior/mermaid-warning-channel` 与 `main/operation-single-flight` **同属两类**(根因
 * 原文自身就写了两个能力),不是归类含糊。
 *
 * ## 键用精确匹配,不用子串包含
 *
 * 本仓有真实歧义:`merge` 会同时命中 `core/merge-toc` 与 `behavior/merge-cancel`,
 * `converter` 会同时命中 `main/converter-after-convert`。包含匹配会把「豁免一段」变成
 * 「豁免两段」,后者**静默多跑一条**(该跑的段没跑,且报告上看不出来)。精确匹配没有这个面。
 *
 * ## 反向(漏登记)不靠自检 —— 这是已知且接受的缺口
 *
 * 存活性自检只抓「表里有登记、但那段已经不存在」。**反方向没有静态信号**:一个新段需要真
 * 宿主却漏了登记,没有任何东西会报红 —— 要等它在缺能力的宿主下跑出失败,失败面就是它自己
 * 的能力缺口。本仓**接受**这个缺口:能自动抓住它的机制是「按表分派宿主」,而那正是 #07
 * 撤步撤掉的东西(判据在本仓不可达)。换句话说,这张表目前的判据是**单向的**。
 *
 * @see assertHostRequirementsAlive 存活性自检(搬运自 `cb3eb9c` 的 `assertOptOutListAlive`)
 */
export const SEGMENT_HOST_REQUIREMENTS = Object.freeze({
  "core/footnotes.test.js": "需真实 printToPDF 出可解析的 PDF(Chromium 渲染,mock 返空 Buffer)",
  "core/merge-toc.test.js": "需真实 printToPDF 出可解析的 PDF(合并后目录页码要读真 xref)",
  "core/merge.test.js": "需真实 printToPDF 出可解析的 PDF(合并产物的页码/书签断言)",
  "core/pdf-bookmarks.test.js": "需真实 printToPDF 出可解析的 PDF(书签注入读真 xref)",
  "core/pdf-meta.test.js": "需真实 printToPDF 出可解析的 PDF(读真元数据)",
  "core/toc-pagenum.test.js": "需真实 printToPDF 出可解析的 PDF(目录页码要真排版结果)",
  "behavior/packaged-smoke.test.js": "需真实 printToPDF:冒烟打印链路要走 webContents.executeJavaScript",
  "main/converter.test.js": "需真实 printToPDF:合并转换的 PDF 产出要走 webContents.executeJavaScript",
  "main/mermaid-service.test.js": "需真实渲染引擎出 PNG(mock 无 Chromium,renderMermaid 直接返 null)",
  "behavior/mermaid-warning-channel.test.js": "需真实渲染引擎 + 真实窗口(w.isDestroyed/executeJavaScript)",
  "main/ipc-register.test.js": "需真实 Menu 对象:断言的是「改语言后应用菜单被重建」,mock 补方法即断言 mock",
  "main/operation-single-flight.test.js": "需真实窗口(w.isDestroyed)与真实 PDF 产出共同决定占用窗口期",
  "main/window-close-abort.test.js": "需真实窗口(w.isDestroyed)才能观察到关窗中止的真实时序",
  "main/preview.test.js": "需真实显示器(screen.getAllDisplays)与真实窗口:GBK 预览落位按真实屏幕算",
  "main/session-permission-deny.test.js": "需真实 session(fromPartition 要返真 session 才能装权限处理器)",
  "main/temp-markdown.test.js": "需真实系统剪贴板(clipboard.readBuffer 读真 GBK 字节,mock 恒空)",
});

/**
 * 宿主需求表存活性自检:每条登记都必须命中一个已发现的段,否则整轮判红并点名是哪几条。
 *
 * **为什么必须自动抓 —— 失效形态是静默的。** 段改名或删除后,本表那一条再也匹配不到任何段,
 * 而该段(改名后的)会因不在表里被派到缺能力的宿主,于是「一条过期登记 + 一个没登记的段」
 * **互相抵消**:一轮全绿,而实际覆盖面比声明的小。这类漂移不靠人记得住,也不靠 grep 段名
 * 数量(键数不变、只有键变)。
 *
 * **只在顶层未筛选的轮次跑。** 筛选轮(`M2W_ONLY`)本就只发现部分段,段内嵌套编排
 * (`test/harness/runner-report.test.js` 的沙盒段)发现面更是与本表无关 —— 两者跑这条自检
 * 都必然假红,把真信号淹掉。
 *
 * **判据取「父进程自身不是段宿主」**,与 `runner.js` 里覆盖采集那处同一口径:段宿主子进程
 * 跑本段时,它的发现面是「段内自己声明的那几个」,拿它去校验全局表必假红。
 *
 * ⚠ 本函数**目前无调用点**(刻意:接调用点属 #07 写域,已撤步)。调用时必须自带上面两个前置
 * 条件(顶层编排器 + 未筛选轮次)—— 本函数自身**不读环境变量**去判断,因为判定「当前是不是
 * 顶层编排器」需要 `runner.js` 的段名环境变量常量,而本模块是**数据层**:让数据层 import
 * 编排层会形成环(将来接线时正是 `runner.js` → 本文件),且一份纯数据表不该拖着编排器的
 * 依赖走。前置条件由调用点保证,理由随代码留在上面。
 *
 * @param {readonly string[]} discoveredNames 本轮已发现的段名(相对 `test/` 的 posix 路径)
 * @returns {void}
 * @throws {Error} 有登记未命中任何已发现段时抛出,消息点名全部失配键
 */
export function assertHostRequirementsAlive(discoveredNames) {
  const found = new Set(discoveredNames);
  const stale = Object.keys(SEGMENT_HOST_REQUIREMENTS).filter((name) => !found.has(name));
  if (stale.length === 0) return;
  throw new Error(
    `宿主需求表有 ${stale.length} 条匹配不到任何已发现段(段改名/删除/搬目录后本表未同步):` +
      `${stale.join(", ")}。要么把键改回本表登记的段名,要么把该行删掉 —— ` +
      "留着的后果是该段被派到缺能力的宿主,而它正是需要真实 Electron 的那段。",
  );
}