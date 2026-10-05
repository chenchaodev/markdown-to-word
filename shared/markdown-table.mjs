// @ts-check
/**
 * Markdown 表格的**纯解析层**:切格、聚表块、定位登记表与号段表、归一表头与单元格。
 *
 * 三条边界(本模块的契约,不是风格偏好):
 * - **零 IO**:不 import `node:fs` / `node:path`,不读文件、不写文件。全文由调用方读好后传进来。
 * - **零判据**:只做切分与定位,**不做任何「是否合法」的判断并报错**。形态是否合规、
 *   字数是否越界、号是否连续一律由调用方判 —— 判据与解析混在一层,解析层就再也不能被第二个调用方复用。
 * - **零第三方依赖**:只用语言内建。
 *
 * 依赖方向:`gates/repo/*` 与 `tools/*` 单向引用本模块,本模块不反向引用它们。写工具
 * **不能**从 `gates/` import(`check-import-boundary.mjs` 的 `tools-stay-in-tools` 规则禁止
 * `tools/` 引用 `gates/`),而台账解析必须只有一份实现,故落在这里。
 */

/**
 * 台账「一句话标题」列的字数上限(字)。
 *
 * ✅ **全仓单点持有**:这三个数在本仓**只有这一处声明**,所有消费方一律 import 本模块 ——
 * `gates/repo/check-pointers.mjs`(载体形态判据 C1 / C2 的判红与 `CARRIER_RULES` 文案都从
 * 这三个常量拼,本仓**不再另留一份**)、`tools/req-edit.mjs`(写侧列宽预判),
 * 以及 `gates/repo/check-docs.selftest.mjs` 与 `test/gates/` 下两段单测的**夹具长度**。
 *
 * 之所以能单点持有:`shared/` 是 `gates` 与 `tools` **唯一共同的合法依赖**
 * (`gates/repo/check-import-boundary.mjs` 的 `TREE_RULES`,两侧 allow 面都含 `shared`),
 * 门禁与写工具因此能引同一份而互不越界。门禁侧那份副本已按 `docs/PLAN.md` 泳道 #06 删除。
 *
 * **不要在本文件之外再加第二份** —— 这三个数是判据的一部分,每多一份就多一个能单独漂移的副本。
 *
 * ⚠️ **与全局配置目录那三份之间没有机器对读**(既有缺口,已认领):改数值要同时改四处 ——
 * 本文件 · 全局配置仓门禁常量 · 全局 `DOC-SYSTEM.md` 载体表那一行 · 本仓 `AGENTS.md` 那一行,
 * 而只有前两处之间那一对有 T2 强制对读。理由链见 `gates/repo/check-pointers.mjs` 里
 * C1 / C2 判据上方那段 T2 tombstone 注释(**归一后仍成立**:位置从 `gates/` 变成 `shared/`,
 * 但「本仓必须留一份」这件事不变)。
 */
export const TITLE_LIMIT = 30;

/**
 * 台账「判断依据」列的字数上限(字),「已完成」节之外各节适用。
 *
 * 与 `TITLE_LIMIT` 同属那份单点持有,理由见该常量注释。
 */
export const WHY_LIMIT = 250;

/**
 * 「已完成」节「判断依据」列的字数上限(字)—— 比其余节更紧,故单独一个常量。
 *
 * 与 `TITLE_LIMIT` 同属那份单点持有,理由见该常量注释。
 */
export const WHY_LIMIT_DONE = 150;

/**
 * 把一行 markdown 表格切成单元格。
 *
 * **并集自两份既有实现,各自补的坑都保留**:
 * - 台账门禁(`gates/repo/check-pointers.mjs` 的 `splitTableRow`)提供:①**收整行、自己 trim**;
 *   ②尾竖线的 `!endsWith('\\|')` 判据 —— 一行以转义竖线结尾时那个竖线是**内容不是分隔符**,
 *   照 `endsWith('|')` 剥掉会把末格内容吃掉。
 * - 已退役的 PLAN 子步门禁(原 `gates/repo/check-plan-in-progress.mjs`,2026-10-05 随其载体
 *   `docs/PLAN.md` 一并退役,原文取回见 git 历史)提供:切格主循环
 *   与「`\|` 还原成字面 `|`」的还原口径。
 *
 * **刻意不照搬 PLAN 门禁的「无条件剥首竖线」**:那是靠调用方(`parsePlanSteps`)先 trim 才成立的
 * 写法,它的 `replace(/^\|/, "")` 对**不以 `|` 开头**的行会破坏内容(把首格的第一个字符吃掉)。
 * 改成「仅当首字符是 `|` 才剥」—— 不以 `|` 开头的行原样参与切分。
 *
 * ⚠️ **切分结果可能与渲染结果不一致**:GFM 表格是先切格再解析行内,所以**反引号包住的竖线照样切格**
 * (要留住必须写 `\|`)。按行内规则实现会让本函数的边界与渲染边界分叉,而调用方的首格判定依赖切格边界。
 *
 * ⚠️ **列数不足不抛异常**,整行照常返回(可能只有一格)。**调用方须自己核对 `cells.length` 与表头列数** ——
 * 本函数不替调用方决定「这行算不算合法」。
 *
 * @param {string} line 整行原文(**不必**预先 trim)
 * @returns {string[]} 单元格数组(每格已 trim;不会因列数不足而抛错)
 */
export function splitTableRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  /** @type {string[]} */
  const cells = [];
  let cur = '';
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * 一组单元格是否为表格分隔行(`|---|---|`)。
 *
 * **判据 = 每格 trim 后逐格匹配 `^:?-+:?$`**(逐格全满足;**不得**弱化成「任一格满足」——
 * 那会让「单格带装饰的正常数据行」被误当整行分隔行而豁免全部台账判据)。
 *
 * ⚠️ **这里曾取过「并集」,2026-10-05 已反转回窄口径 —— 反转理由比原裁决更重要,勿"顺手统一"回去**:
 *
 * - **原裁决(§7.1)要求取并集**:两份既有实现不同,门禁那份只 `trim()`,PLAN 子步门禁那份先剥
 *   反引号与星号再测。取并集的表面理由是「剥掉装饰后基础判据照样匹配,不会让真分隔行漏判」,
 *   而漏判真分隔行的后果是把它当数据行读进去(行数照样对得上、判据照样绿)。
 * - **那条理由的前提已消解**:它描述的受害者是 PLAN 子步门禁,而该门禁已于 2026-10-05 随其载体
 *   `docs/PLAN.md` 一并退役。**剩下的唯一消费者是台账门禁,而宽口径对它是净损害** —— 方向相反。
 * - **宽口径在门禁侧造成真·假绿(本仓实测,非推断)**:GFM 只认**第二行是真 delimiter** 才把整块
 *   当表格;反引号包住横线的伪分隔行**不是**合法 delimiter row,于是整块在 GitHub 上**渲染成
 *   普通段落、根本不是表格** —— 表形状已破坏,而 C7 的判红点之一正是「表头下一行必须是分隔行」。
 *   实测:宽口径下 `checkTableShape` 对那张坏表 findings=0(**绿**),窄口径下判红。
 *   更隐蔽的一处:伪分隔行出现在**表块中段**时,`locateRegistry` 会把它当分隔行跳过 ⇒ 它**不进
 *   数据行集** ⇒ R 族「号形态错」对它**零判且零出声**。窄口径下它进数据行集、被判红。
 * - **⚠️「197 份真实 md 跑出 0 差异」不是放宽的理由**:那份语料 **100% 是正例**,一条带装饰的
 *   伪分隔行都没有 ⇒ 0 差异只证明「本仓现有文件判定不变」,对**负空间零证明力**。「我这份语料里
 *   没有反例」对「判据对反例是否正确」什么也没说。**负向性质只能用负向夹具钉住** ——
 *   见 `test/gates/check-pointers-ledger.test.js` 的「伪分隔行」那几条 case;谁把这里改回宽口径,
 *   那些 case 立刻红。
 *
 * **对写侧工具无代价**(`tools/req-edit.mjs` 的锚点定位也用它):实测对真实台账
 * `docs/REQ.md` 的 4 个登记表块**零影响**(每块的分隔行号与数据行集合逐字相同);畸形输入下
 * 方向也安全 —— 伪分隔行被当**数据行**,于是走 `assertRowShape` 与列宽校验(响亮失败),
 * 而非被静默跳过。
 *
 * @param {string[]} cells 格数组(由 `splitTableRow` 产出)
 * @returns {boolean} 是分隔行则 `true`;空数组按「不是」处理
 */
export function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/**
 * 表头列名比较用的归一:去空白、粗体 `*`、反引号、冒号(半角与全角)。
 *
 * 这些字符是**写法**不是**内容**,参与比较会让同一列因写法不同而「看起来叫两个名字」。
 *
 * ⚠️ **只去这四类,不去括注**:`为什么停在这（≤150 字）` 归一后仍带括注 —— 这是既有口径,
 * 列名判定用的是 `includes` 而不是全等,擅自扩大归一范围会把别处的列名匹配一起改掉。
 *
 * @param {string} cell 表头单元格原文
 * @returns {string} 归一后的列名
 */
export function normalizeHeaderCell(cell) {
  return cell.replace(/[\s*`:：]/g, '');
}

/**
 * 台账单元格归一:去反引号 + 去 `~~` + trim。**号列与状态列共用这一份**。
 *
 * 墓碑行的号写作 `~~REQ-004~~`,那对 `~` 是**标记不是内容**;不剥它,每一条合法墓碑的号列
 * 都会与另一种写法对不上。
 *
 * @param {string} cell 单元格原文
 * @returns {string} 归一后的内容
 */
export function normalizeLedgerCell(cell) {
  return cell.replace(/`+/g, '').replace(/~~/g, '').trim();
}

/**
 * 逐行**遮罩**围栏代码块(块内行替换成空串),行号与原文保持 1:1 对齐。
 *
 * 为什么必须遮:示例代码块里的 `|` 开头的行与 `## 标题` 会被当成真表格行与真小节,
 * 而本层的调用方要报 `文件:行`,行号错位会让整份诊断指错地方。
 * 围栏判定只认行首的反引号三连 / 波浪号三连(可带缩进);围栏嵌套不处理。
 *
 * ⚠️ **本注释里不得出现反引号三连的字面量** —— TS 的 JSDoc 解析器把它当代码块起点,
 * 紧随其后的 `@param` 会被吞成代码块**内容**而非标签,该参数的类型随即整个失效
 * (报 TS7006 隐式 any,且现象与「忘了写 @param」无法区分)。要指代围栏标记就用
 * 「反引号三连」这种文字形态。判据:`gates/repo/check-tscheck-coverage.mjs` 守覆盖面,
 * 但**不守单条 JSDoc 是否真被解析** —— 这类错只有 tsc 报得出。
 *
 * @param {string} text 文件全文
 * @returns {string[]} 遮罩后的行序列(长度与行数一致,行号 1:1 对齐)
 *
 * 导出供 `gates/repo/check-pointers.mjs` 直接消费(该门禁要报 `文件:行`,故必须用本函数
 * 而不是整块删除围栏的写法 —— 两者区别见该文件里 `stripFences` 的对比注释)。
 */
export function maskFencedLines(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    out.push(inFence ? '' : line);
  }
  return out;
}

/**
 * 行号 → 最近的祖先 `## ` 小节标题原文(取不到则空串)。
 *
 * 为什么需要:台账**按状态分节**,而「已完成」节的字数上限与其余节不同 —— 判上限必须知道行落在哪一节,
 * 而表格解析本身不产节信息。
 *
 * 导出供 `gates/repo/check-pointers.mjs` 直接消费(台账判据要按节判「已完成」节的字数上限)。
 *
 * @param {string[]} lines 已遮罩的行序列
 * @returns {Map<number, string>} 行号(1 起)→ 所属 `## ` 小节名
 */
export function sectionByLine(lines) {
  /** @type {Map<number, string>} */
  const map = new Map();
  let current = '';
  lines.forEach((line, idx) => {
    const m = /^##\s+(.*\S)\s*$/.exec(line);
    // 捕获组由 `(.*\S)` 保证非空(整条正则要求行尾有非空白字符)⇒ `?? ''` 恒不触发,
    // 它只是把 `string | undefined` 收窄成 `string` 以过 `noUncheckedIndexedAccess`。
    if (m) current = m[1] ?? '';
    map.set(idx + 1, current);
  });
  return map;
}

/**
 * 表块 = **连续**的以 `|` 开头的行;**块内允许夹空行与 `<!-- -->` 注释行**(跳过、不终止)。
 *
 * 放宽是必须的:按 markdown 严格语义在空行处断表,会让一行被拆到下一块去,后半截行**不可见**
 * ⇒ 实算出的最大号偏小 ⇒ 报成「号段缺行」的假红。
 *
 * **块首行当表头、其余一律当数据行**(不看分隔行):分隔行仍会被放进 `rows`,由调用方按需用
 * `isSeparatorRow` 过滤。解析层不替调用方决定哪些行参与判定。
 *
 * @param {string[]} lines 已遮罩的行序列(`tableBlocks` 自身不遮罩,要调用方先遮或接受示例块被读入)
 * @returns {Array<{ header: { text: string, lineNo: number }, rows: Array<{ text: string, lineNo: number, cells: string[] }> }>}
 *   表块数组。`header` 只有 `text` 与 `lineNo`(**未切格**)—— 表头列数要调用方自己
 *   `splitTableRow(block.header.text)` 拿;`rows` 每项已带切好的 `cells`。
 */
export function tableBlocks(lines) {
  // ⚠️ `rows` 标成**首元素必有**的元组(`[T, ...T[]]`),不是 `T[]`:建块那一刻就把触发行
  // push 进去了(`cur` 只在 push 行时创建),故每个块的 `rows` 恒非空 —— 调用方
  // `const [header, ...rest] = block.rows` 解构出的 `header` 因此永不为 undefined。
  // 标成 `T[]` 会让下游在 `noUncheckedIndexedAccess` 下拿到 `T | undefined` 而被迫加守卫,
  // 而那个守卫**没有分支可走**(空块不存在),只会诱使人写下永不触发的兜底。
  /** @type {Array<{ rows: [{ lineNo: number, text: string }, ...Array<{ lineNo: number, text: string }>] }>} */
  const raw = [];
  /** @type {{ rows: [{ lineNo: number, text: string }, ...Array<{ lineNo: number, text: string }>] } | null} */
  let cur = null;
  lines.forEach((line, idx) => {
    if (/^\s*\|/.test(line)) {
      const row = { lineNo: idx + 1, text: line };
      if (cur) cur.rows.push(row);
      else {
        // ⚠️ **建块时就把触发行放进去**,不是「先建空块再 push」—— 后者让上面那个
        // 「首元素必有」的标注在创建那一刻是假的(空数组赋给非空元组),类型检查当场翻脸。
        // 两种写法产出的块内容逐字相同,只是这一种让标注与代码同真。
        cur = { rows: [row] };
        raw.push(cur);
      }
      return;
    }
    if (!line.trim() || /^\s*<!--/.test(line)) return; // 块内跳过,不终止
    cur = null;
  });
  return raw.map((block) => {
    const [header, ...rest] = block.rows;
    return {
      header: { text: header.text, lineNo: header.lineNo },
      rows: rest.map((r) => ({ text: r.text, lineNo: r.lineNo, cells: splitTableRow(r.text) })),
    };
  });
}

/**
 * 登记表定位:在所有表块里找**表头同时含「号」与「状态」**的块,**列位置按名取**,
 * 并**合并全部同构块的行集**。
 *
 * 两条识别条件都是必须的:同时含两个词才能与号段表(表头 `项` / `值`)区分开;按名取列是因为
 * **列序颠倒是合法写法**,按下标读会把状态列当标题列 ⇒ 相关判据恒红。
 *
 * ⚠️ **必须合并全部同构块,不能只取第一处**:台账按状态分节,各节各是一张同构表,而
 * 「号唯一 / 已用最大号 / 号段连续 / 墓碑必须划掉」四条都是跨节判据 —— 只取第一节,
 * 其余各节里的重号、号段缺口、未划掉的墓碑全部不可见,而门禁仍然 exit 0。
 *
 * **列映射逐块取、不共用**:各节表头宽度可以不同,故把 `idCol` / `statusCol` / `headerCount`
 * 挂在**每一行**上;顶层那一份取自第一块,只供「只读一行」的场景省事用。共用第一块的列映射会让
 * 后面几节整节错位 —— 又是静默假绿。
 *
 * 节名取该块**首行**所在的 `## ` 小节标题原文(取不到则空串,不因此丢弃该块)。
 *
 * @param {string} text 文件全文(本函数内部先遮罩围栏代码块)
 * @returns {{ idCol: number, statusCol: number, blocks: number,
 *   rows: Array<{ lineNo: number, text: string, section: string, cells: string[],
 *     idCol: number, statusCol: number, headerCount: number }> } | null}
 *   定位不到任何同构块 → `null`。`rows` 是跨节合并后的全部数据行(**表头行与分隔行不算数据行**)。
 */
export function locateRegistry(text) {
  const lines = maskFencedLines(text);
  const sections = sectionByLine(lines);
  /** @type {Array<{ lineNo: number, text: string, section: string, cells: string[], idCol: number, statusCol: number, headerCount: number }>} */
  const rows = [];
  let blocks = 0;
  let firstIdCol = -1;
  let firstStatusCol = -1;
  for (const block of tableBlocks(lines)) {
    const header = splitTableRow(block.header.text);
    const names = header.map(normalizeHeaderCell);
    const idCol = names.findIndex((n) => n.includes('号'));
    const statusCol = names.findIndex((n) => n.includes('状态'));
    if (idCol === -1 || statusCol === -1) continue;
    blocks += 1;
    if (firstIdCol === -1) {
      firstIdCol = idCol;
      firstStatusCol = statusCol;
    }
    const section = sections.get(block.header.lineNo) ?? '';
    for (const r of block.rows) {
      if (isSeparatorRow(r.cells)) continue;
      rows.push({
        lineNo: r.lineNo,
        text: r.text,
        section,
        cells: r.cells,
        idCol,
        statusCol,
        headerCount: header.length,
      });
    }
  }
  if (blocks === 0) return null;
  return { idCol: firstIdCol, statusCol: firstStatusCol, blocks, rows };
}

/**
 * 台账的「标题列」与「判断依据列」在哪 —— **按列名取,不按下标**(同 `locateRegistry` 的理由)。
 *
 * 标题列认「标题」;判断依据列认「为什么停在这」**或**「为什么停在哪」—— 规则文本自身用词不统一,
 * 两种都收,否则该列静默零覆盖(判据恒绿)。
 *
 * @param {string[]} header 表头格数组(未经 `normalizeHeaderCell` 归一也可以,本函数内部会归一)
 * @returns {{ titleCol: number, whyCol: number }} 列名不存在时对应项为 `-1`
 */
export function ledgerTextCols(header) {
  const names = header.map(normalizeHeaderCell);
  return {
    titleCol: names.findIndex((n) => n.includes('标题')),
    whyCol: names.findIndex((n) => n.includes('为什么停在这') || n.includes('为什么停在哪')),
  };
}

/**
 * 号段小表定位:表头**首格 `项`、次格 `值`** 的那块;两行按**首格包含**「已用最大号」/「下一个可用号」
 * 取(容忍括注写法),值格取**前导**那格。
 *
 * ⚠️ **返回原始文本形态,不解析数字**:号段格里的值形态(是不是 `REQ-0NN`、前导号对不对)
 * 属于判据,由调用方判 —— 解析层一旦在这里 `Number(...)`,形态错与非形态错就再也分不开了。
 *
 * @param {string} text 文件全文(本函数内部先遮罩围栏代码块)
 * @returns {{ max: string | null, next: string | null, maxLine: number | null, nextLine: number | null } | null}
 *   值格原文(`trim` 后);定位不到号段表 → `null`。行号供调用方组织 `文件:行` 诊断。
 */
export function rangeTable(text) {
  const lines = maskFencedLines(text);
  for (const block of tableBlocks(lines)) {
    const header = splitTableRow(block.header.text);
    if (header.length < 2) continue;
    // 上一行的 `length < 2` 已保证两格都在 ⇒ 这里的 `?? ''` 恒不触发,只为收窄下标取值。
    if (normalizeHeaderCell(header[0] ?? '') !== '项') continue;
    if (normalizeHeaderCell(header[1] ?? '') !== '值') continue;
    /** @type {{ max: string | null, next: string | null, maxLine: number | null, nextLine: number | null }} */
    const out = { max: null, next: null, maxLine: null, nextLine: null };
    for (const row of block.rows) {
      if (isSeparatorRow(row.cells) || row.cells.length < 2) continue;
      // 同上:`row.cells.length < 2` 已在上方守卫 ⇒ 首格必存在,`?? ''` 恒不触发。
      const value = row.cells[1] ?? '';
      if ((row.cells[0] ?? '').includes('已用最大号')) {
        out.max = value;
        out.maxLine = row.lineNo;
      } else if ((row.cells[0] ?? '').includes('下一个可用号')) {
        out.next = value;
        out.nextLine = row.lineNo;
      }
    }
    return out;
  }
  return null;
}