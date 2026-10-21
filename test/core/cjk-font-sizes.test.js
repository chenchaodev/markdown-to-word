// @ts-check
/**
 * 中文字号表(号数制 ⇄ 磅值)契约单测:
 * - 表形状:CJK_FONT_SIZES 恰好 9 档,id 序列与 pt 序列逐字钉住,按 pt 严格升序;
 * - 值域:每一档 pt 都落在正文字号域(BODY_SIZE_MIN–BODY_SIZE_MAX)内 —— 域外档不选;
 * - 磅值 → 字号条目:精确匹配(0.5 网格);离网格或不在表内一律 null(不静默就近取整:
 *   那样用户设的 9.2pt 会被显示成小五 9pt,两值不同的档被误标);
 * - 字号 id → 磅值:id 不存在一律 null;
 * - 三语文案齐备:字号表 9 档 + `typography.size.custom` + 控件标签 `settings.cjkFontSize`
 *   在三份字典里都存在且非空、值不等于裸键;且三语的 `typography.size.*` 键集
 *   **恰为** core 表 9 档 + custom(抓「core 加了一档、字典没补」这一已知耦合 ——
 *   缺键时 UI 回退成裸键且**不报错**)。
 *
 * 为什么单开一段(不并进「排版设置」段):那一段走 convert 全链路(主体经产物到达,
 * 段内零 core import),本段是**纯函数契约**(主体经 dist 直接 import 到达)——
 * 两条到达路径各守各的事实,合成一段会让其中一条的失败被另一条掩盖。
 *
 * 本段测哪一层(ADR-062 L4 声明通道):**core**,主体经 `dist/core/settings/typography.js`
 * 与 `dist/core/i18n/index.js` 的直接 import 到达(与 presets 段同形态)。
 */
import {
  CJK_FONT_SIZES,
  cjkFontSizeOfPt,
  cjkFontSizePtOfId,
} from "../../dist/core/settings/typography.js";
import { BODY_SIZE_MAX, BODY_SIZE_MIN } from "../../dist/core/settings/settings-defaults.js";
import { DICT, LANGUAGES } from "../../dist/core/i18n/index.js";
import { createCaseSuite } from "../harness/case.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**core**,主体 `src/core/settings/typography.ts`
 * 的中文字号表与两个反解纯函数,以及 `src/core/i18n/{zh,en,ja}.ts` 里与字号表配套的
 * 三语文案键(经 dist 产物直接 import 到达)。
 */
export const covers = [
  "src/core/settings/typography.ts",
  "src/core/i18n/zh.ts",
  "src/core/i18n/en.ts",
  "src/core/i18n/ja.ts",
];

export const meta = {
  description:
    "中文字号表契约:9 档号数制表(逐字钉住 id/pt 序列 + 严格升序 + 落在正文字号域内)"
    + " + 磅值/id 双向反解(精确匹配,离 0.5 网格或不在表内一律 null)"
    + " + 三语文案齐备(9 档 + custom + 控件标签,缺键即回退裸键且不报错)。",
};

// 纯函数契约段,无验收样例(契约见 gates/fixtures/check-segment-contracts.mjs 文件头)
export const fixtures = null;

/** 号数制九档的 id 序列(逐字钉住:顺序即磅值升序,不得重排) */
const EXPECTED_IDS = [
  "xiaowu",
  "wuhao",
  "xiaosi",
  "sihao",
  "xiaosan",
  "sanhao",
  "xiaoer",
  "erhao",
  "xiaoyi",
];

/** 号数制九档的磅值序列(逐字钉住:小三=15 / 三号=16 是非直觉序列,按直觉排会错位) */
const EXPECTED_PTS = [9, 10.5, 12, 14, 15, 16, 18, 22, 24];

/**
 * 断言辅助:统一报错格式(与 presets 段同风格)。
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @param {string} label 失败标签
 * @returns {void}
 */
function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} 断言失败: ${JSON.stringify(actual)}(期望 ${JSON.stringify(expected)})`);
  }
}

/** 中文字号表契约单测 */
export async function run() {
  const suite = createCaseSuite();

  // ---------- 表形状:条目数 / id 序列 / pt 序列 / 升序 ----------
  await suite.case("中文字号表条目数应为 9", () => {
    assertEq(CJK_FONT_SIZES.length, 9, "中文字号表条目数");
  });
  await suite.case("中文字号表 id 序列应逐字相符", () => {
    assertEq(
      CJK_FONT_SIZES.map((entry) => entry.id).join(","),
      EXPECTED_IDS.join(","),
      "中文字号表 id 序列",
    );
  });
  await suite.case("中文字号表 pt 序列应逐字相符", () => {
    assertEq(
      CJK_FONT_SIZES.map((entry) => entry.pt).join(","),
      EXPECTED_PTS.join(","),
      "中文字号表 pt 序列",
    );
  });
  // 升序逐对判:某一对逆序是「表被重排」的形态,合成一个断言会让首处逆序掩盖其余
  for (let i = 1; i < CJK_FONT_SIZES.length; i += 1) {
    const prev = CJK_FONT_SIZES[i - 1];
    const cur = CJK_FONT_SIZES[i];
    if (!prev || !cur) continue; // 索引越界由上面的条目数断言负责,此处不重复报错
    await suite.case(`中文字号表按 pt 严格升序(${prev.pt} → ${cur.pt})`, () => {
      if (!(cur.pt > prev.pt)) {
        throw new Error(`中文字号表升序断言失败: ${prev.id}=${prev.pt} 之后是 ${cur.id}=${cur.pt}`);
      }
    });
  }
  console.log("[ok] 中文字号表形状:9 档 / id 与 pt 序列逐字相符 / 按 pt 严格升序 断言通过");

  // ---------- 值域:每一档都落在正文字号域内(域常量从 settings-defaults 取,不写死) ----------
  for (const entry of CJK_FONT_SIZES) {
    await suite.case(`字号 ${entry.id}(${entry.pt}pt)应落在正文字号域内`, () => {
      if (entry.pt < BODY_SIZE_MIN || entry.pt > BODY_SIZE_MAX) {
        throw new Error(
          `字号 ${entry.id}(${entry.pt}pt)越界:正文字号域为 ${BODY_SIZE_MIN}-${BODY_SIZE_MAX}pt`,
        );
      }
    });
  }
  console.log(
    `[ok] 中文字号表值域:${CJK_FONT_SIZES.length} 档字号均落在 ${BODY_SIZE_MIN}-${BODY_SIZE_MAX}pt 内 断言通过`,
  );

  // ---------- 磅值 → 字号条目:命中档(两条事实分开断言:命中了哪一档 / 该档的磅值) ----------
  const xiaosi = cjkFontSizeOfPt(12);
  await suite.case("cjkFontSizeOfPt(12) 应命中小四(xiaosi)", () => {
    assertEq(xiaosi?.id ?? null, "xiaosi", "cjkFontSizeOfPt(12) 的 id");
  });
  await suite.case("cjkFontSizeOfPt(12) 的磅值应为 12", () => {
    assertEq(xiaosi?.pt ?? null, 12, "cjkFontSizeOfPt(12) 的 pt");
  });
  const wuhao = cjkFontSizeOfPt(10.5);
  await suite.case("cjkFontSizeOfPt(10.5) 应命中五号(wuhao)", () => {
    assertEq(wuhao?.id ?? null, "wuhao", "cjkFontSizeOfPt(10.5) 的 id");
  });
  await suite.case("cjkFontSizeOfPt(10.5) 的磅值应为 10.5", () => {
    assertEq(wuhao?.pt ?? null, 10.5, "cjkFontSizeOfPt(10.5) 的 pt");
  });

  // ---------- 磅值 → 字号条目:不命中(null 语义) ----------
  await suite.case("cjkFontSizeOfPt(11) 应返回 null(在 0.5 网格上但不在表内)", () => {
    assertEq(cjkFontSizeOfPt(11), null, "cjkFontSizeOfPt(11)");
  });
  await suite.case("cjkFontSizeOfPt(9.2) 应返回 null(离 0.5 网格,不吸附到小五)", () => {
    assertEq(cjkFontSizeOfPt(9.2), null, "cjkFontSizeOfPt(9.2)");
  });
  // 浮点归一:比较前按 0.5 网格归一,吸收浮点表示误差
  await suite.case("cjkFontSizeOfPt(12.000000000000002) 应命中小四(浮点归一)", () => {
    assertEq(cjkFontSizeOfPt(12.000000000000002)?.id ?? null, "xiaosi", "浮点归一后的 id");
  });

  // ---------- 字号 id → 磅值 ----------
  await suite.case("cjkFontSizePtOfId(xiaosi) 应返回 12", () => {
    assertEq(cjkFontSizePtOfId("xiaosi"), 12, "cjkFontSizePtOfId(xiaosi)");
  });
  await suite.case("cjkFontSizePtOfId(nope) 应返回 null", () => {
    assertEq(cjkFontSizePtOfId("nope"), null, "cjkFontSizePtOfId(nope)");
  });
  console.log("[ok] 中文字号反解:12→xiaosi / 10.5→wuhao / 11 与 9.2→null / 浮点归一命中 / id 反解 断言通过");

  // ---------- 三语文案齐备(core 表 9 档 + custom + 控件标签) ----------
  //
  // 已知耦合(des-1 标出):**core 字号表加一档,三份字典必须同步补 `typography.size.<新 id>`
  // 键,否则该档文案回退成裸键且不报错**。故本组既逐键断言存在与非空,又断言
  // 「三语的 typography.size.* 键集恰为 core 表 9 档 + custom」—— 后者才是抓
  // 「core 加了档、字典没补」的那一档(逐键断言只覆盖已知的 9 个 id)。
  //
  // DICT 的语言码是字面量联合、键名也是 Dict 联合 ⇒ 按语言码动态索引时先转
  // Record 视图(写法同 i18n-registry 段:先取视图再按码取值,避免类型收窄报错)。
  const DICT_VIEW = /** @type {Record<string, Record<string, string>>} */ (/** @type {unknown} */ (DICT));
  /**
   * 取指定语言的字典。
   * @param {string} code 语言码
   * @returns {Record<string, string>} 该语言字典
   */
  const dictOf = (code) => {
    const dict = DICT_VIEW[code];
    if (!dict) throw new Error(`字典缺失语言 ${code}`);
    return dict;
  };
  /** 本组断言覆盖的 11 个键:core 表 9 档 + custom + 控件标签 */
  const SIZE_LABEL_KEYS = [
    ...CJK_FONT_SIZES.map((entry) => `typography.size.${entry.id}`),
    "typography.size.custom",
    "settings.cjkFontSize",
  ];
  // 逐键:存在且非空(缺键 ⇒ UI 回退成裸键且不报错)
  for (const key of SIZE_LABEL_KEYS) {
    await suite.case(`${key} 三语齐备且非空`, () => {
      for (const { code } of LANGUAGES) {
        const value = dictOf(code)[key];
        if (typeof value !== "string" || value.trim() === "") {
          throw new Error(
            `${key} 在 ${code} 字典缺失或为空(缺失时 UI 回退成裸键且不报错)`,
          );
        }
      }
    });
    // 逐键:值不得等于裸键本身(「有键但值就是键」是另一种回退形态)
    await suite.case(`${key} 三语值不得等于裸键`, () => {
      for (const { code } of LANGUAGES) {
        if (dictOf(code)[key] === key) {
          throw new Error(`${key} 在 ${code} 字典的值就是裸键本身(文案回退未翻译)`);
        }
      }
    });
  }
  // 键集对齐:三语的 typography.size.* 键集必须完全一致(任一语多出/缺一个都抓到)
  await suite.case("三语 typography.size.* 键集应完全一致", () => {
    const perLang = LANGUAGES.map(({ code }) => ({
      code,
      keys: Object.keys(dictOf(code)).filter((k) => k.startsWith("typography.size.")).sort(),
    }));
    const ref = perLang[0];
    if (!ref) throw new Error("语言注册表为空,无从比对键集");
    for (const other of perLang.slice(1)) {
      if (other.keys.join(",") !== ref.keys.join(",")) {
        const onlyRef = ref.keys.filter((k) => !other.keys.includes(k));
        const onlyOther = other.keys.filter((k) => !ref.keys.includes(k));
        throw new Error(
          `typography.size.* 键集在 ${ref.code} 与 ${other.code} 之间不一致:`
          + `${ref.code} 独有=${JSON.stringify(onlyRef)};${other.code} 独有=${JSON.stringify(onlyOther)}`,
        );
      }
    }
  });
  // 键集对齐(第二向):恰为「core 表 9 档 + custom」—— core 加档而字典没补 ⇒ 这里红
  await suite.case("三语 typography.size.* 键集应恰为 core 表 9 档 + custom", () => {
    const expected = SIZE_LABEL_KEYS.filter((k) => k.startsWith("typography.size.")).sort();
    for (const { code } of LANGUAGES) {
      const actual = Object.keys(dictOf(code)).filter((k) => k.startsWith("typography.size.")).sort();
      if (actual.join(",") !== expected.join(",")) {
        throw new Error(
          `typography.size.* 键集与 core 字号表不一致(${code}):`
          + `多出=${JSON.stringify(actual.filter((k) => !expected.includes(k)))};`
          + `缺失=${JSON.stringify(expected.filter((k) => !actual.includes(k)))}`,
        );
      }
    }
  });
  console.log(
    `[ok] 中文字号三语文案:${SIZE_LABEL_KEYS.length} 个键三语齐备非空且非裸键;三语 typography.size.* 键集一致且恰为 core 表 9 档 + custom 断言通过`,
  );

  return { cases: suite.results };
}
