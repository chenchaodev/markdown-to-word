// 文档指针门禁(判定本体 gates/repo/check-pointers.mjs)的回归守护(负向夹具)。
//
// gates/repo/check-pointers.mjs 持有**真实的判定逻辑**,而判据本体的每一族都可能被改成
// 「看起来还在跑、实际什么都不查」或「判得过宽/过窄」的形态,而**没有任何其他检查能发现**:
//   · 退出码回落(恒 0)            ⇒ 真判红时本地提交照样放行,而「项目模式通过」照打;
//   · 目标文件不存在这一档被摘掉 ⇒ 断链永久放过(最常见、最该抓的一族);
//   · 台账四节只取第一节         ⇒ 重号 / 号段缺口 / 未划掉的墓碑在别节全部不可见;
//   · 「已完成」节更严的上限失效  ⇒ 超限文本按较宽的上限判绿;
//   · 跨仓路径「只分类」被悄悄改回「判定」或反过来被当成「已查过」⇒ 以为被查过;
//   · 代码扩展名引用(`.mjs`/`.ts`/`.js`/`.cjs`)那一档同样恒绿,且**零覆盖时整段消失**;
//   · 未匹配形态的路径引用那一档(首字符/名字落在 `REF_FORMS` 允许集之外)**彻底消失** ⇒
//     写坏的指针重新变成隐形,且**零覆盖时连结论行都不出声**。
//
// 因此这里逐条制造这些漂移,断言本体以非零码拒绝并给出**可分辨的诊断**,并断言未漂移时通过。
//
// ---- 夹具在系统临时目录现造一个合成项目仓,靠 `cwd` 指向它跑**仓内真门禁** ----
// 本体不复制、不改写、不换根:跑的就是 `gates/repo/check-pointers.mjs` 本身。
// **夹具复制一份真实门禁进来只会把「规则的演进」也冻在夹具里** —— 那样门禁改了规则夹具还绿,
// 夹具就变成了规则的第二份冻结副本。
//
// ⚠️ **本文件刻意不用 `test/common/temp-resource.js` 的 `removeTree`**:树的允许面是
// `gates` / `shared` / `test/fixtures`(`gates/repo/check-import-boundary.mjs` 的
// `gates-stay-in-gates` 规则),`test/common/` **不在允许面内** ⇒ 引用它会被那道门禁判红;
// 而 `check-temp-cleanup` 的扫描面是 `test/**`(`shared/test-common-surface.js` 的
// `SCAN_TARGETS` 单源),**不扫 `gates/`** —— 同仓另外 5 个 `gates/repo/*.selftest.mjs`
// 同样直接用 `rmSync(dir, { recursive: true, force: true })`。故此处照既有先例,
// 不为了「看起来更收口」而越树。
//
// ⚠️ 已沉淀的教训:临时产物必须在 finally 清理 —— 中途断言失败抛异常时同样要删,否则系统临时区
// 会堆满夹具树。真实仓库只被**读**(本体只读 `cwd` 下那棵合成仓)。

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from '../../shared/paths.js';
import { TITLE_LIMIT, WHY_LIMIT_DONE } from './check-pointers.mjs';

// **超上限夹具的长度必须跟着判据常量走** —— 写死 21 / 120 字面量时，上限一改就红。
const OVER_TITLE = '长'.repeat(TITLE_LIMIT + 1);
const OVER_WHY = '因'.repeat(WHY_LIMIT_DONE + 1);

const projectRoot = ROOT;
const gatePath = join(projectRoot, 'gates', 'repo', 'check-pointers.mjs');

/** 登记表表头(必须同时含「号」与「状态」,否则台账解析零覆盖 —— 那正是要防的形态)。 */
const REGISTRY_HEADER = '| 工作项号 | 状态 | 一句话标题 | 为什么停在这 |';
const REGISTRY_RULE = '| --- | --- | --- | --- |';

/**
 * 号段表(首格 `项`、次格 `值`;两行取**前导**号)。R4/R5 判的是它与登记表实算最大号的一致性,
 * 缺了它这两条判据零覆盖。
 * @param {string} max 已用最大号
 * @param {string} next 下一个可用号
 * @returns {string} 号段表 markdown
 */
function rangeTable(max, next) {
  return [
    '| 项 | 值 |',
    '| --- | --- |',
    `| 已用最大号 | ${max} |`,
    `| 下一个可用号 | ${next} |`,
  ].join('\n');
}

/**
 * 一条登记表数据行。列序刻意不是「先标题后号」—— **列序颠倒是合法写法**,判据按列名取位,
 * 夹具若按固定下标写就测不到这一点。
 * @param {string} id 工作项号
 * @param {string} status 状态
 * @param {string} title 一句话标题
 * @param {string} why 为什么停在这
 * @returns {string} 数据行 markdown
 */
function registryRow(id, status, title, why) {
  return `| ${id} | ${status} | ${title} | ${why} |`;
}

/**
 * 造一份**可判绿**的最小台账:一号一行、号段与实算最大号一致、标题与判断依据都在上限内。
 * @returns {string} `docs/REQ.md` 全文
 */
function goodLedger() {
  return [
    '# 台账',
    '',
    '## 在办',
    '',
    REGISTRY_HEADER,
    REGISTRY_RULE,
    registryRow('REQ-001', '在办', '建立最小可判台账', '合成夹具,无阻塞'),
    '',
    '## 号段',
    '',
    rangeTable('REQ-001', 'REQ-002'),
    '',
  ].join('\n');
}

/** ADR 夹具:`## 背景` 存在且非空(否则背景判据判红)。正文刻意不含任何 `.md` 指针。 */
const GOOD_ADR = [
  '# ADR-001 · 合成决策',
  '',
  '## 背景',
  '',
  '合成夹具需要一个非空背景,否则该判据零覆盖。',
  '',
  '## 决定',
  '',
  '写最小可判的那一份。',
  '',
].join('\n');

/** evidence 夹具:头部第一处非空非标题行带「结论去向」,取值落在三选一域内。 */
const GOOD_EVIDENCE = [
  '> 结论去向：未升',
  '',
  '# 合成取证',
  '',
  '这是合成夹具的取证快照。',
  '',
].join('\n');

/** 根 README(在扫描面内:仓根 `*.md` 与 `docs/` 一起扫)。刻意不含指针。 */
const ROOT_README = [
  '# 合成仓',
  '',
  '这是文档指针门禁自检现造的合成项目仓,内容全部内联构造。',
  '',
].join('\n');

/**
 * 写一棵合成项目仓:仓根 README + 台账 + 一份 ADR + 一份 evidence。
 *
 * **不 vendor 任何模板**:再写一份模板就多一个会漂的东西。夹具内容就地内联构造。
 *
 * @param {string} root 合成仓根(临时目录)
 * @param {Record<string, string>} overrides 覆盖/新增的仓内相对路径 → 文本
 */
function writeSyntheticRepo(root, overrides = {}) {
  /** @type {Record<string, string>} */
  const files = {
    'README.md': ROOT_README,
    'docs/REQ.md': goodLedger(),
    'docs/adr/ADR-001-合成决策.md': GOOD_ADR,
    'docs/evidence/20260101-000000-合成取证.md': GOOD_EVIDENCE,
    ...overrides,
  };
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, 'utf8');
  }
}

/**
 * 跑仓内真门禁。**cwd 指向合成仓根** —— 本体的扫描根恒等于 `process.cwd()`,
 * 所以不需要(也不该有)`--root` 参数:加了开关就等于给判据留逃生阀。
 * @param {string} root 合成仓根
 * @returns {{ code: number | null, output: string }} 退出码与合并输出
 */
function runGate(root) {
  const result = spawnSync(process.execPath, [gatePath], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * 每条负向夹具须命中一个**真实漂移形态**,而非人造噪声。
 *
 * `require` 逐条断言**可分辨的诊断文案**而不是只看退出码 —— 只看退出码的话,
 * 「因错误原因失败」(本体自身崩了 / cwd 指错 / 参数写错)会蒙混过关,而那恰恰是门禁
 * 从仓外搬进仓内最可能出的事故(根取错 ⇒ 全 false 而静默零覆盖)。
 *
 * @type {{ name: string, overrides?: Record<string, string>, expectCode: number,
 *   require?: RegExp[], forbid?: RegExp[] }[]}
 */
const CASES = [
  {
    // **反向锚点:好台账必须零错误。** 没有这条,上面每一条都可能是「恒红」而不是「真判红」。
    // 断言项目侧结论行是实施约束 2 的验收点:只判退出码会漏掉「恒走别的路径 + exit 0」那个陷阱。
    name: '好台账(在办一行 + 号段自洽 + ADR 背景非空 + evidence 去向合法)→ 绿,且必须出项目侧结论行',
    expectCode: 0,
    require: [/项目模式通过/, /门禁结论:已判定 \| 通过 \| 模式:项目/],
    forbid: [/目标文件不存在/, /重号/],
  },
  {
    // 「项目模式通过」这行是**可判定的**判别锚点:只断言退出码 0 的话,一个「恒走空路径 + exit 0」
    // 的漂移照样通过(实施约束 2 的验收点就是这条)。
    name: '零覆盖必须出声:好台账那一跑也必须自报「判定 0 处」并把跨仓未判推进结论行 gaps',
    expectCode: 0,
    require: [/判定 0 处 · 未判/, /覆盖:不全\(/],
  },
  {
    name: '台账重号(同号两行)→ 判红并指名「重号」与首次登记的行号',
    overrides: {
      'docs/REQ.md': [
        '# 台账',
        '',
        '## 在办',
        '',
        REGISTRY_HEADER,
        REGISTRY_RULE,
        registryRow('REQ-001', '在办', '第一条', '无阻塞'),
        registryRow('REQ-001', '在办', '重号了', '无阻塞'),
        '',
        '## 号段',
        '',
        rangeTable('REQ-001', 'REQ-002'),
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [/重号:该号已在 docs\/REQ\.md:\d+ 登记/],
  },
  {
    name: '号段不连续(登记 001 与 003,缺 002)→ 判红并列出缺号',
    overrides: {
      'docs/REQ.md': [
        '# 台账',
        '',
        '## 在办',
        '',
        REGISTRY_HEADER,
        REGISTRY_RULE,
        registryRow('REQ-001', '在办', '第一条', '无阻塞'),
        registryRow('REQ-003', '在办', '第三条', '无阻塞'),
        '',
        '## 号段',
        '',
        rangeTable('REQ-003', 'REQ-004'),
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [/号段不连续/, /REQ-002/],
  },
  {
    name: `标题列超上限(${OVER_TITLE.length} 字 > ${TITLE_LIMIT})→ 判红并同时报出实测字数与上限`,
    overrides: {
      'docs/REQ.md': [
        '# 台账',
        '',
        '## 在办',
        '',
        REGISTRY_HEADER,
        REGISTRY_RULE,
        registryRow('REQ-001', '在办', OVER_TITLE, '无阻塞'),
        '',
        '## 号段',
        '',
        rangeTable('REQ-001', 'REQ-002'),
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [new RegExp(`标题列 ${OVER_TITLE.length} 字 > ${TITLE_LIMIT}`)],
  },
  {
    // 这一条专打「已完成节更严的那档上限」:超过该档上限一字、但不超过其余节的宽限档。
    // 若那档上限被摘掉(或节名判定失效),它会按较宽的上限判绿 —— 而 120 < 200 恰好蒙混过关。
    name: `「已完成」节的判断依据超该节更严的上限(${OVER_WHY.length} 字 > ${WHY_LIMIT_DONE})→ 判红并报出该节的上限`,
    overrides: {
      'docs/REQ.md': [
        '# 台账',
        '',
        '## 已完成',
        '',
        REGISTRY_HEADER,
        REGISTRY_RULE,
        registryRow('REQ-001', '已完成', '已完成的一条', OVER_WHY),
        '',
        '## 号段',
        '',
        rangeTable('REQ-001', 'REQ-002'),
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [new RegExp(`判断依据 ${OVER_WHY.length} 字 > ${WHY_LIMIT_DONE}`)],
  },
  {
    name: 'evidence 头部缺「结论去向」→ 判红并列出三选一取值域',
    overrides: {
      'docs/evidence/20260101-000000-合成取证.md': [
        '# 合成取证',
        '',
        '这一份快照的头部刻意没有「结论去向」行。',
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [/头部没有「结论去向」行/, /未升/],
  },
  {
    name: 'evidence 头部「结论去向」取值非法 → 判红并指出该取值',
    overrides: {
      'docs/evidence/20260101-000000-合成取证.md': [
        '> 结论去向：随手记',
        '',
        '# 合成取证',
        '',
        '取值不在三选一域内。',
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [/结论去向「随手记」不在取值域内/],
  },
  {
    name: 'ADR 的「## 背景」为空 → 判红(背景是必填字段,没有它无法复核)',
    overrides: {
      'docs/adr/ADR-001-合成决策.md': [
        '# ADR-001 · 合成决策',
        '',
        '## 背景',
        '',
        '## 决定',
        '',
        '写最小可判的那一份。',
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [/「## 背景」是空的/],
  },
  {
    // 断链这一族最容易被「摘掉存在性判定」而静默失效,所以单列一条并锚在诊断文案上。
    name: '断链(反引号指针指向已不存在的文件)→ 判红并指名文件:行与目标',
    overrides: {
      'docs/手工笔记.md': [
        '# 手工笔记',
        '',
        '这一行指向 `docs/已删除.md`,那份文件不在本仓。',
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [/docs\/手工笔记\.md:\d+ → docs\/已删除\.md → 目标文件不存在/],
  },
  {
    // 反向:空节**合法**。这张表只有表头与分隔行、没有数据行 —— 「没有任务时该节必须为空」
    // 是规则的预期状态,判红它等于逼人填占位行。若结构判据把它判红,那是规则过宽。
    name: '空节合法(某状态节只有表头与分隔行、无数据行)→ 判绿',
    overrides: {
      'docs/REQ.md': [
        '# 台账',
        '',
        '## 在办',
        '',
        REGISTRY_HEADER,
        REGISTRY_RULE,
        registryRow('REQ-001', '在办', '第一条', '无阻塞'),
        '',
        '## 已作废',
        '',
        REGISTRY_HEADER,
        REGISTRY_RULE,
        '',
        '## 号段',
        '',
        rangeTable('REQ-001', 'REQ-002'),
        '',
      ].join('\n'),
    },
    expectCode: 0,
    require: [/项目模式通过/],
    forbid: [/缺分隔行/, /之间夹了/],
  },
  {
    // 决定四的验收:跨仓裸名**只分类、不判定**。这一行指向全局配置目录里的一份指南,
    // 本仓解析不到 ⇒ 被分类为跨仓指针,但**判红基准在仓外不可达** ⇒ 不判红,
    // 且必须**自报「分类 1 处 · 判定 0 处 · 未判」**。
    // 若有人把这一步改回「判定」(拿本仓去查存在性),它会变成确定性假红;
    // 若有人把「未判」那行删掉,就是「以为被查过」。
    name: '跨仓裸名只分类不判定 → 判绿,且必须自报「分类 1 处 · 判定 0 处 · 未判」',
    overrides: {
      'docs/手工笔记.md': [
        '# 手工笔记',
        '',
        '这一行指向全局配置目录的 `CODE-GUIDE.md`,本仓没有那一份。',
        '',
      ].join('\n'),
    },
    expectCode: 0,
    require: [/分类 1 处/, /判定 0 处 · 未判/, /覆盖:不全\(/],
  },
  {
    // 代码扩展名档的**正向 + 自报**:一个 `.mjs` 引用 ⇒ 分类 1 处、**判定 0 处**、exit 0。
    //
    // ⚠️ 路径**刻意取合成仓里不存在的那一个**(`gates/repo/check-pointers.mjs` 在合成仓里没有):
    // 本档分类的对象是**形态**不是有效性,引用指向的文件在不在都不该改变「分类 1 处」这个数 ——
    // 放一个真能解析到的路径会让这条夹具顺带证明「有效性」,而那不是本档的语义。
    // (这也是它**只能分类、不能判红**的原因:判红要人裁决「文件真的搬走了」与「文档记的是决策史」。)
    name: '代码扩展名引用只分类不判定(.mjs 形态)→ 判绿,且必须自报该族的分类数与「判定 0 处 · 未判」',
    overrides: {
      'docs/手工笔记.md': [
        '# 手工笔记',
        '',
        '判定本体在 `gates/repo/check-pointers.mjs`,这一族只分类、不判定。',
        '',
      ].join('\n'),
    },
    expectCode: 0,
    require: [
      /代码扩展名引用\(只分类,未判\):检查 \d+ 份 · 分类 1 处/,
      /代码扩展名引用未判\(分类 1 处 · 判定 0 处/,
      /判定 0 处 · 未判,非「查过没问题」/,
      /覆盖:不全\(/,
    ],
    // 判红侧:本档**绝不**产出这一族的错误 —— 出现即说明「只分类」被改成了「判定」。
    forbid: [/check-pointers\.mjs → 目标文件不存在/, /目标文件不存在/],
  },
  {
    // **反向对照**:形态相同、只把收尾从 `.mjs` 换成 `.md` 且指向不存在的文件 ⇒ **必须真判红**。
    // 这一条是上一条的判红侧:证明新档没有把判定档一起放过(两档形态相邻,最容易互相误伤)。
    // 判红文案与第 10 条(断链)同源 —— 断链那一族若被摘掉,这条会跟着绿。
    name: '反向对照:同一形态改成 .md 且指向不存在的文件 → 真判红(证明新档没把判定档一起放过)',
    overrides: {
      'docs/手工笔记.md': [
        '# 手工笔记',
        '',
        '这一行指向 `docs/已删除.md`,那份文件不在本仓。',
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [/docs\/手工笔记\.md:\d+ → docs\/已删除\.md → 目标文件不存在/],
  },
  {
    // **零覆盖必须出声**:合成仓里一条代码扩展名引用都没有 ⇒ 这一族在结论行**仍然出现**,
    // 且措辞明确是「零覆盖」而不是「未判」——「没人写这种引用」与「这一族没人管」必须可区分。
    // forbid 钉住反向:零命中时**不许**改口成「未判 N 处」(那会把「零覆盖」说成「有东西但没查」)。
    name: '代码扩展名引用零覆盖 → 仍判绿,但该族必须在自报区与结论行出声(措辞是「零覆盖」)',
    expectCode: 0,
    require: [
      /代码扩展名引用\(只分类,未判\):检查 \d+ 份 · 分类 0 处/,
      /代码扩展名引用零覆盖\(形态 0 处 · 判定 0 处,未判,非「查过没问题」\)/,
      /覆盖:不全\(/,
    ],
    forbid: [/代码扩展名引用未判\(分类 0 处/],
  },
  {
    // **判定档未受影响**:`.md` 引用的判红条数与结论行报出的条数仍然一致。
    // 两条死链 + 一条 `.mjs`(只分类)⇒ 失败条数必须**恰好是 2**:
    // 多了说明 `.mjs` 那条被算进了错误流(新档越界),少了说明死链被放过(判定档被误伤)。
    name: '判定档未受影响:2 条 .md 死链判红,而同文件里的 .mjs 引用不计入错误条数(失败条数恰为 2)',
    overrides: {
      'docs/手工笔记.md': [
        '# 手工笔记',
        '',
        '第一条死链:`docs/已删除一.md`。第二条死链:`docs/已删除二.md`。',
        '',
        '同文件里还有一条 `gates/repo/check-pointers.mjs`,那一族只分类、不判定。',
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [
      /docs\/手工笔记\.md:\d+ → docs\/已删除一\.md → 目标文件不存在/,
      /docs\/手工笔记\.md:\d+ → docs\/已删除二\.md → 目标文件不存在/,
      /门禁结论:已判定 \| 失败\(2\) \| 模式:项目/,
    ],
  },
  {
    // **未匹配形态出声(本档的正向)**:三条 `REF_FORMS` 全不匹配的写法各一条 ⇒ **分类 3 处**、
    // 退出码 **0**。这一档守护的是「看不见」,所以它命中时**不许判红** ——
    // 若这里 exit 1,说明有人把本档接到了判定面上,那正是 ADR-057 决定一否决的改法。
    //
    // ⚠️ 三条的形态**逐条不同**(首字符 `·` / 首字符 `-` / 名字含空格),因为 ADR-057 背景那份实测表
    // 就是这三条:一个只覆盖其中一条的实现不该通过本条。
    // ⚠️ 目标**刻意取合成仓里不存在的名字** —— 但本档判的是**形态**不是有效性,存在与否都不该
    // 改变这个数(与代码扩展名档同一处置)。
    name: '未匹配形态出声:首字符 ·/- 与名字含空格的三种 .md 写法 ⇒ 判绿,且必须自报分类 3 处与「判定 0 处 · 未判」',
    overrides: {
      'docs/手工笔记.md': [
        '# 手工笔记',
        '',
        '这一行指向 `·撤销跨仓死指针的无效缓解.md`,漏了文件名前缀。',
        '',
        '这一行指向 `-foo.md`,首字符是连字符。',
        '',
        '这一行指向 `foo bar.md`,名字里含空格。',
        '',
      ].join('\n'),
    },
    expectCode: 0,
    require: [
      /未匹配形态的路径引用\(只分类,未判\):检查 \d+ 份 · 分类 3 处\(\.md 3 处\)/,
      /未匹配形态的路径引用未判\(分类 3 处 · 判定 0 处/,
      /判定 0 处 · 未判,非「查过没问题」/,
      /覆盖:不全\(/,
    ],
    // 判红侧:本档**绝不**产出这一族的错误 —— 出现即说明「只出声」被改成了「判定」。
    // (三个目标都不存在,故这里同时证明「不存在」不会被本档拿去做判红。)
    forbid: [/目标文件不存在/, /·撤销跨仓死指针的无效缓解\.md/, /-foo\.md/, /foo bar\.md/],
  },
  {
    // **反向对照:判定档仍然判红**。形态相同(反引号 + `.md` + 指向不存在的文件),
    // 只把首字符换成 `REF_FORMS` 允许的字母 ⇒ **必须真判红**。
    // 这一条是上一条的判红侧:证明本档没有把判定档一起放过(两档形态相邻,最容易互相误伤)。
    // ⚠️ 它同时把「本档的分类计数**不随形态是否合法而变**」钉住了:同一个坏指针,
    // 形态合法时进错误流、形态不合法时进分类计数 —— 两个去向,互不吞并。
    name: '反向对照:同一份坏指针的形态改成 REF_FORMS 认得的写法 ⇒ 真判红(证明本档没把判定档一起放过)',
    overrides: {
      'docs/手工笔记.md': [
        '# 手工笔记',
        '',
        '这一行指向 `·撤销跨仓死指针的无效缓解.md`,漏了文件名前缀。',
        '',
        '这一行指向 `-foo.md`,首字符是连字符。',
        '',
        '这一行指向 `foo bar.md`,名字里含空格。',
        '',
        '这一行改成 `docs/已删除.md`(形态合法),它就必须被判红。',
        '',
      ].join('\n'),
    },
    expectCode: 1,
    require: [
      /docs\/手工笔记\.md:\d+ → docs\/已删除\.md → 目标文件不存在/,
      // 本档仍数那三条未匹配形态(它们仍在文件里),但**错误条数恰好 1** ——
      // 多了就是本档越界判红了,少了就是判定档被放过。
      /门禁结论:已判定 \| 失败\(1\) \| 模式:项目/,
      /未匹配形态的路径引用未判\(分类 3 处 · 判定 0 处/,
    ],
    forbid: [/·撤销跨仓死指针的无效缓解\.md → 目标文件不存在/, /-foo\.md → 目标文件不存在/],
  },
  {
    // **零覆盖必须出声**(ADR-057 决定二):合成仓里一条未匹配形态都没有(用默认那套夹具文件,
    // 它们刻意不含指针)⇒ 这一族在结论行**仍然出现**,且措辞必须是「零覆盖」。
    // forbid 钉住反向:**零命中时不许改口成「未判 0 处」** —— 那把「这一族在本仓没有对象」
    // 说成「有东西但没查」,是反向误读,比不出声更坏。
    //
    // ⚠️ 为什么这条必须与「代码扩展名引用零覆盖」那条分开写:两族的措辞骨架相同,但**归零的含义不同**
    // —— 代码扩展名档归零说明「没人写这种引用」,本档归零既可能是这个,也可能是「形态正则被改窄/删掉」。
    // 合成仓同时满足两族的零覆盖,合成一条断言就等于只钉住其中一族的一半语义。
    name: '未匹配形态零覆盖 → 仍判绿,但该族必须在自报区与结论行出声(措辞是「零覆盖」,不是「未判 0 处」)',
    expectCode: 0,
    require: [
      /未匹配形态的路径引用\(只分类,未判\):检查 \d+ 份 · 分类 0 处/,
      /未匹配形态的路径引用零覆盖\(形态 0 处 · 判定 0 处,未判,非「查过没问题」\)/,
      /零覆盖\(扫描面内一条未匹配形态的路径引用都没有\)/,
      /覆盖:不全\(/,
    ],
    forbid: [/未匹配形态的路径引用未判\(分类 0 处/, /分类 0 处\(\./],
  },
  {
    // **不重复计数(与代码扩展名档去重)**:同一行里一条 `.mjs`(归代码扩展名档)+ 一条未匹配形态的
    // `.md`(归本档)⇒ **两族各 1 处**。这才是「两族计数之和 == 去重后总数」的机械形态:
    // 若本档把那条 `.mjs` 也数进来,它的计数会是 2,而同一个数在结论行出现两次 ⇒ 自相矛盾。
    //
    // 反向对照:同一条 `.mjs` 在**形态合法**(代码扩展名档独占)与**形态不合法**(本档独占)两种写法下
    // 各数一次 —— 「同一份内容换一个写法就从一族挪到另一族」这件事必须看得见,否则两族的边界是猜的。
    // ⚠️ **不许造出会真解析到的内容**:本档分类的对象是**形态**,给一个存在的文件会让这条顺带证明
    // 「有效性」,而那不是本族的语义。
    name: '不重复计数:一条 .mjs 归代码扩展名档、一条未匹配形态的 .md 归本档 ⇒ 两族各 1 处,无重叠',
    overrides: {
      'docs/手工笔记.md': [
        '# 手工笔记',
        '',
        '这一条归代码扩展名档:`gates/repo/check-pointers.mjs`。这一条归未匹配形态档:`·坏引用.md`。',
        '',
        '这一条形态也不合法:`-另坏引用.mjs`(同一个 .mjs 家族,但首字符不在允许集内)。',
        '',
      ].join('\n'),
    },
    expectCode: 0,
    require: [
      /代码扩展名引用\(只分类,未判\):检查 \d+ 份 · 分类 1 处\(\.mjs 1 处\)/,
      // 本档数的是**两条**:一条 `.md` + 一条 `.mjs`(后者形态不合法 ⇒ 不归代码扩展名档,归本档)。
      // 若本档也把合法的那条 `.mjs` 数进来,这里是 3。
      /未匹配形态的路径引用\(只分类,未判\):检查 \d+ 份 · 分类 2 处\(\.mjs 1 处 · \.md 1 处\)/,
      /未匹配形态的路径引用未判\(分类 2 处 · 判定 0 处/,
      /覆盖:不全\(/,
    ],
    forbid: [/代码扩展名引用\(只分类,未判\):检查 \d+ 份 · 分类 2 处/, /目标文件不存在/],
  },
];

const failures = [];
for (const testCase of CASES) {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'm2w-docs-selftest-'));
    writeSyntheticRepo(dir, testCase.overrides ?? {});
    const { code, output } = runGate(dir);
    /** @type {string[]} */
    const problems = [];
    if (code !== testCase.expectCode) {
      problems.push(`期望 exit ${testCase.expectCode},实际 exit ${String(code)}`);
    }
    for (const re of testCase.require ?? []) {
      if (!re.test(output)) problems.push(`输出未匹配 ${re}`);
    }
    for (const re of testCase.forbid ?? []) {
      if (re.test(output)) problems.push(`输出命中了不该出现的 ${re}`);
    }
    if (problems.length === 0) {
      console.log(`[ok] docs-selftest:${testCase.name}(符合预期,exit ${String(code)})`);
    } else {
      failures.push(`${testCase.name}:${problems.join(';')}\n--- 输出 ---\n${output}`);
    }
  } catch (error) {
    // 一条夹具的构造/执行异常不许打断整批(否则后面的夹具一条都跑不到,报告里也看不出是哪条坏了)
    failures.push(`${testCase.name}:夹具执行抛异常:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[docs-selftest:fail] ${failure}`);
  console.error(`[docs-selftest:fail] 指针门禁回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(
  `[ok] docs-selftest:${CASES.length} 条夹具全部符合预期`
    + '(好台账判绿 / 各类漂移按可分辨诊断判红 / 跨仓、代码扩展名引用、未匹配形态的路径引用三族只分类未判且自报 / 三族零覆盖出声)',
);