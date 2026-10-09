// @ts-check
/**
 * slug.ts 三函数单测(中优先级缺口,纯函数零 IO):
 * - slugify:中文保留、空白转连字符、仅保留 字母/数字/_/-、连续连字符合并、
 *   首尾连字符剥除、空结果回退 "section";大小写不转换(实现无 toLowerCase);
 * - uniqueSlug:同 slug 基数重复 → -2/-3 递增(不同基数不递增);
 * - docxBookmarkId:数字开头前缀 h-、空白兜底转连字符;超 40 字符截断时
 *   追加 4 位 FNV 短哈希(35+1+4=40),防共享前缀的长标题书签碰撞跳转错位,
 *   且确定性(同输入同输出,交叉引用可对上)。
 */
import { slugify, uniqueSlug, docxBookmarkId } from "../../dist/core/markdown/slug.js";
import { createCaseSuite } from "../harness/case.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/** slug.ts 三函数单测 */
export async function run() {
  // ---------- slugify ----------
  // 标注为**元组**数组而非默认的 (string)[]:后者解构出的是 `string | undefined`
  // (noUncheckedIndexedAccess),把「每条样例必是 [输入, 期望] 二元组」这一事实
  // 写进类型,而不是让 6 个调用点各判一次空
  /** @type {Array<[string, string]>} */
  const slugCases = [
    // 中文保留 + 空白转连字符
    ["冒烟测试 中文标题", "冒烟测试-中文标题"],
    // 中文全角空格(U+3000)亦属 \s → 连字符
    ["冒烟\u3000测试", "冒烟-测试"],
    // 符号删除(大小写保留:无 toLowerCase)
    ["Hello World!", "Hello-World"],
    // 首尾空白剥除 + 连续空白合并
    ["  A  B  ", "A-B"],
    // 下划线/连字符保留
    ["foo_bar-baz", "foo_bar-baz"],
    // 标点删除(。等非 L/N/_- 字符)
    ["章节1.2。", "章节12"],
    // 空结果回退 "section"(纯符号)
    ["---", "section"],
    ["!!!", "section"],
    ["", "section"],
  ];
  const suite = createCaseSuite();
  // slugify 矩阵逐行一个 case:输入串即该条的稳定标识,直接从输入取名
  for (const [input, expected] of slugCases) {
    await suite.case(`slugify: ${JSON.stringify(input)}`, () => {
      const actual = slugify(input);
      if (actual !== expected) {
        throw new Error(`slugify 断言失败: ${JSON.stringify(input)} → ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
      }
    });
  }
  console.log(`[ok] slugify:${slugCases.length} 组断言通过(中文保留/空白转连字符/符号删除/大小写保留/空回退)`);

  // ---------- uniqueSlug ----------
  // 取数备在 case 之前:三次连续调用共享同一个 seen(递减序列本身是被断言的事实,
  // 拆进 case 各自重建 seen 就测不到递增了)
  const seen = new Map();
  const u1 = uniqueSlug("标题", seen);
  const u2 = uniqueSlug("标题", seen);
  const u3 = uniqueSlug("标题", seen);
  await suite.case("uniqueSlug:同一标题重复出现时 -2/-3 递增", () => {
    if (u1 !== "标题" || u2 !== "标题-2" || u3 !== "标题-3") {
      throw new Error(`uniqueSlug 断言失败:重复标题应 -2/-3 递增,实际 ${u1}/${u2}/${u3}`);
    }
  });
  // 不同标题不递增(基数不同 → 各自从 -1 起)
  await suite.case("uniqueSlug:不同标题不递增", () => {
    const other = uniqueSlug("其他", seen);
    if (other !== "其他") {
      throw new Error(`uniqueSlug 断言失败:不同标题不应递增,实际 ${other}`);
    }
  });
  // 不同原文但 slug 基数相同 → 仍按基数去重递增(如空白与连字符归一后同基数)
  await suite.case("uniqueSlug:同基数不同原文仍去重递增", () => {
    const seen2 = new Map();
    const s1 = uniqueSlug("A B", seen2);
    const s2 = uniqueSlug("A-B", seen2);
    if (s1 !== "A-B" || s2 !== "A-B-2") {
      throw new Error(`uniqueSlug 断言失败:同基数不同原文应递增,实际 ${s1}/${s2}`);
    }
  });
  console.log("[ok] uniqueSlug:-2/-3 递增、不同标题不递增、同基数跨原文去重 断言通过");

  // ---------- docxBookmarkId ----------
  // 元组数组(同 slugCases):expected 为 null 表示「该输入走截断分支」,不断言具体值
  /** @type {Array<[string, string | null]>} */
  const bookmarkCases = [
    // 数字开头 → 前缀 h-(空格先兜底转连字符)
    ["1 标题", "h-1-标题"],
    ["42abc", "h-42abc"],
    // 非数字开头不加前缀
    ["abc-def", "abc-def"],
    ["冒烟测试-中文标题", "冒烟测试-中文标题"],
    // 超长截断 → 前 35 字符 + "-" + 4 位哈希(共 40);哈希确定性可先算期望:
    // 用同长度不同后缀的两个输入验证格式与唯一性,精确值由实现自洽
    ["a".repeat(50), null],
    [`1${"a".repeat(50)}`, null],
    // 中文截断(BMP 单码元)
    ["中".repeat(50), null],
  ];
  /** @type {Array<[string, string]>} */
  const truncated = [];
  for (const [input, expected] of bookmarkCases) {
    const actual = docxBookmarkId(input);
    if (expected !== null) {
      await suite.case(`docxBookmarkId: ${JSON.stringify(input)}`, () => {
        if (actual !== expected) {
          throw new Error(`docxBookmarkId 断言失败: ${JSON.stringify(input)} → ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
        }
      });
    } else {
      truncated.push([input, actual]);
    }
  }
  // 截断分支:形态与确定性是两件事,故同一输入拆两个 case
  for (const [input, actual] of truncated) {
    await suite.case(`docxBookmarkId: ${JSON.stringify(input)} 走截断加哈希(35 字符 + - + 4 位十六进制)`, () => {
      if (actual.length !== 40) {
        throw new Error(`docxBookmarkId 断言失败:截断后应恰为 40 字符,实际 ${actual.length}`);
      }
      if (!/^.{35}-[0-9a-f]{4}$/u.test(actual)) {
        throw new Error(`docxBookmarkId 断言失败:截断格式应为 35 字符 + - + 4 位十六进制哈希,实际 ${JSON.stringify(actual)}`);
      }
    });
    await suite.case(`docxBookmarkId: ${JSON.stringify(input)} 截断哈希确定性(同输入同输出)`, () => {
      if (docxBookmarkId(input) !== actual) {
        throw new Error("docxBookmarkId 断言失败:截断哈希应确定性(同输入同输出)");
      }
    });
  }
  // 核心场景:两个共享前 40 字符的不同长标题 → 书签名必须不同(此前碰撞)
  const long1 = `${"共享前缀".repeat(13)}甲`; // 超 40 字符,前 40 与下者相同
  const long2 = `${"共享前缀".repeat(13)}乙`;
  // 前置校验留在 case 之外:它保证的是下一条的判定对象成立,
  // 拆进去会让「构造错了」报成「书签名碰撞」,与真因无关
  if (long1.slice(0, 40) !== long2.slice(0, 40)) {
    throw new Error("docxBookmarkId 测试前置失败:构造的两标题应共享前 40 字符");
  }
  await suite.case("docxBookmarkId:共享前 40 字符的不同标题不得产出同名书签", () => {
    if (docxBookmarkId(long1) === docxBookmarkId(long2)) {
      throw new Error("docxBookmarkId 断言失败:共享前 40 字符的不同标题不得产出同名书签");
    }
  });
  console.log("[ok] docxBookmarkId:数字前缀/短输入原样/截断加哈希(40 字符·确定性·防碰撞)断言通过");
  return { cases: suite.results };
}
