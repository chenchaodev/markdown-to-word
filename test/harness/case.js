// @ts-check
/**
 * case 级断言契约的**转出门面**(路径不动,真实现见 `shared/case.js`)。
 *
 * 为什么留这一层(ADR-074 决定一):真实现搬进 `shared/` 是为了让门禁自测
 * (`gates/**`)也能引到同一套 case 机制 —— `gates-stay-in-gates` 的允许面
 * (`gates/repo/check-import-boundary.mjs`)只有 `gates` / `shared` / `test/fixtures`,
 * `test/` 整棵树不在其中,而给 allow 加 `test/harness` 会在两棵树之间开出双向
 * 合法边(否决理由见 ADR-074 备选方案一)。段侧 `CASE_MODULE_REL` 白名单的是
 * **一个精确路径**,故本路径必须原样保留。
 *
 * 必须 `export *`、不得改成具名再导出:`test/harness/runner.js` 有
 * `@typedef {import("./case.js").CaseResult}`,而 `CaseResult` 是模块级 JSDoc
 * typedef —— 具名再导出会把类型一起丢掉(typecheck 报 TS2304/TS2694)。
 * 运行期经此门面的 `drainSuites` 与真实现是**同一个模块实例**,故模块级的
 * `registered` 状态天然共享,这里不做任何复制。
 */
export * from "../../shared/case.js";