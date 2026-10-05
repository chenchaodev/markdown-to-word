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
 * ⚠️ **本仓暂有两份,这是已知的、有意的中间态**:这三个数原本硬编码在
 * `gates/repo/check-pointers.mjs` 的载体形态判据常量里(其 C1 / C2 报错文字从这三个常量拼)。
 * 写工具不能从那里 import(见模块头),所以唯一一份落在这里;**下一阶段(尚未做)门禁会改为
 * 从本模块 import 并删掉本地那份**。在那之前两份并存,改数值必须同时改两处
 * (本文件 · `gates/repo/check-pointers.mjs` 的三个同名导出)。
 *
 * **不要在本文件之外再加第三份** —— 这三个数是判据的一部分,每多一份就多一个能单独漂移的副本。
 */
export const TITLE_LIMIT = 30;

/**
 * 台账「判断依据」列的字数上限(字),「已完成」节之外各节适用。
 *
 * 与 `TITLE_LIMIT` 同属那份「两份并存」的中间态,理由见该常量注释。
 */
export const WHY_LIMIT = 250;

/**
 * 「已完成」节「判断依据」列的字数上限(字)—— 比其余节更紧,故单独一个常量。
 *
 * 与 `TITLE_LIMIT` 同属那份「两份并存」的中间态,理由见该常量注释。
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
 * **并集自两份既有实现**:台账门禁给出基础判据(每格都匹配 `^:?-+:?$`),PLAN 子步门禁给出
 * 「先剥 `` ` `` 与 `*` 再测」这一步。取并集而非二选一:剥掉装饰后基础判据照样匹配,
 * **不会让真分隔行漏判**,而漏判真分隔行的后果是把它当数据行读进去(行数照样对得上,判据照样绿)。
 *
 * @param {string[]} cells 格数组(由 `splitTableRow` 产出)
 * @returns {boolean} 是分隔行则 `true`;空数组按「不是」处理
 */
export function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.replace(/[`*]/g, '').trim()));
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
 * 围栏判定只认行首 ``` / ~~~(可带缩进);围栏嵌套不处理。
 *
 * @param {string} text 文件全文
 * @returns {string[]} 遮罩后的行序列(长度与行数一致,行号 1:1 对齐)
 */
function maskFencedLines(text) {
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
 * @param {string[]} lines 已遮罩的行序列
 * @returns {Map<number, string>} 行号(1 起)→ 所属 `## ` 小节名
 */
function sectionByLine(lines) {
  /** @type {Map<number, string>} */
  const map = new Map();
  let current = '';
  lines.forEach((line, idx) => {
    const m = /^##\s+(.*\S)\s*$/.exec(line);
    if (m) current = m[1];
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
  /** @type {Array<{ rows: Array<{ lineNo: number, text: string }> }>} */
  const raw = [];
  /** @type {{ rows: Array<{ lineNo: number, text: string }> } | null} */
  let cur = null;
  lines.forEach((line, idx) => {
    if (/^\s*\|/.test(line)) {
      if (!cur) {
        cur = { rows: [] };
        raw.push(cur);
      }
      cur.rows.push({ lineNo: idx + 1, text: line });
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
    if (normalizeHeaderCell(header[0]) !== '项') continue;
    if (normalizeHeaderCell(header[1]) !== '值') continue;
    /** @type {{ max: string | null, next: string | null, maxLine: number | null, nextLine: number | null }} */
    const out = { max: null, next: null, maxLine: null, nextLine: null };
    for (const row of block.rows) {
      if (isSeparatorRow(row.cells) || row.cells.length < 2) continue;
      const value = row.cells[1] ?? '';
      if (row.cells[0].includes('已用最大号')) {
        out.max = value;
        out.maxLine = row.lineNo;
      } else if (row.cells[0].includes('下一个可用号')) {
        out.next = value;
        out.nextLine = row.lineNo;
      }
    }
    return out;
  }
  return null;
}