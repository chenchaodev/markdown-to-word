// docs/evidence/INDEX.md 生成器(零依赖,幂等;--check 内存重生成逐字节比对)。
//
// 为什么索引必须由脚本生成:全局配置目录 `AGENTS.md`「落盘格式」节要求「索引须由脚本
// 生成(门禁校验同步)」。手工登记时新增一份归档原文要动三处(加文件、加行、判定「分流
// 去向」列),漏掉任何一处都不报错 —— 索引只会在几周后有人追一个点不开的指针时才暴露。
// 改成「目录枚举生成 + 门禁校验」后,漂移是 CI 上的硬失败。
//
// 「分流去向」列只用**一条机械可复现判据**:除 `docs/evidence/**` 与 `docs/campaigns/**`
// 外的全部 `docs/**/*.md` 里有没有出现本文件名(带反引号或裸名均可);命中则取排序最靠前
// 的宿主文件,填可点相对链接;无命中填 `—`。一条判据 = 结果可复现 = 链接可点。
//
// 刻意砍掉的一档:旧表头里的 `campaign 升格` 一档靠「`ADR.md` 头部声明 / 条目「来源」
// 字段」这类叙述性文字判定,机械复现不了,故本版不保留 —— 相关行落进 `—`。
// 取舍:宁可标注 `—`(老实说「没有可点直链」),也不写复现不出来的指针。

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const docsDir = path.join(projectRoot, 'docs');
const evidenceDir = path.join(docsDir, 'evidence');
const INDEX_REL = 'evidence/INDEX.md';
const USAGE = '用法: node gates/repo/gen-archive-index.mjs [--check]';

/** 不进「分流去向」检索的 docs/ 一级子目录(posix 相对 docs/) */
const HOST_EXCLUDE_DIRS = new Set(['evidence', 'large']);

/**
 * 同理排除的**文件**:`PLAN.md` 按设计是临时载体,完成标准逐条划完即删。
 *
 * 索引是永久的(只增不删的一层),「分流去向」列若解析到 `PLAN.md`,任务收尾那一刻
 * 就会留下一条指向已删文件的指针,且 `check:archive-index` 会在删除后判红(生成器
 * 重新解析到 `REQ.md` 而表里还写着 PLAN.md)。**危害方向是双向的**:既产出死指针,
 * 又让索引内容取决于「此刻有没有临时文件存在」——那是不可复现的派生量。
 * 真实触发:单任务 PLAN.md 的抬头按惯例链到本轮 evidence 文件,该链接曾被解析成
 * 分流去向,顶掉同文件在 `REQ.md` 分析列里的常驻引用。
 */
const HOST_EXCLUDE_FILES = new Set(['PLAN.md']);

/** 归档文件名里不登记进表的两个文件:本索引自身与该目录说明页 */
const ARCHIVE_EXCLUDED = new Set(['INDEX.md', 'README.md']);

/**
 * 形态豁免:全局配置目录 `DOC-SYSTEM.md` §二 载体表行里,`user-guide-vX.Y.md` 是唯一
 * 不由时间戳命名的归档专用名(用户指南按大版本归档),故它不受形态断言约束。
 */
const NAME_FORM_EXEMPT_RE = /^user-guide-v\d+\.\d+\.md$/;

/** 归档文件名形态:`YYYYMMDD-HHmmss-<工作项ID>-<主题>`(工作项ID 可缺省) */
const TIMESTAMP_PREFIX_RE = /^\d{8}-\d{6}-/;
/** 工作项号:用户需求 REQ-NNN / 技术债 REF-NNN */
const WORK_ITEM_RE = /(?:REQ|REF)-\d+/;

/** 本表要检索的宿主文件集合:docs/ 下除 archive/、campaigns/ 外的全部 *.md,按路径升序 */
function listHostFiles() {
  /** @type {string[]} docs/ 相对、posix 分隔的宿主文件路径(已排序) */
  const found = [];
  /** @param {string} dir 绝对目录 */
  /** @param {string} rel 相对 docs/ 的 posix 路径(根为 '') */
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (rel === '' && HOST_EXCLUDE_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && entry.name.endsWith('.md') && !HOST_EXCLUDE_FILES.has(entry.name)) {
        found.push(childRel);
      }
    }
  };
  walk(docsDir, '');
  return found.sort();
}

/** 宿主文件内容缓存(文件名 → 文本),按需读取 */
function makeHostIndex() {
  /** @type {{ rel: string, text: string }[]} */
  const hosts = listHostFiles().map((rel) => ({ rel, text: readFileSync(path.join(docsDir, rel), 'utf8') }));
  return (fileName) => hosts.find((h) => h.text.includes(fileName))?.rel ?? null;
}

/**
 * 归档原文清单:docs/evidence/ 下 *.md,排除 INDEX.md 与 README.md,按文件名升序。
 * @returns {string[]} 文件名(不含目录)
 */
function listArchiveFiles() {
  return readdirSync(evidenceDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !ARCHIVE_EXCLUDED.has(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * docs/evidence/ 下全部 *.md 文件名(**含**本索引与说明页)。形态断言要用它而不是
 * `listArchiveFiles()` 的结果:枚举已把 ARCHIVE_EXCLUDED 滤掉,若断言复用枚举结果,
 * 「塞一份形态不对的特例文件」就会静默混过门禁,而本目录本来就存过一批历史偏差命名。
 * @returns {string[]} 文件名(不含目录)
 */
function listArchiveDirMd() {
  return readdirSync(evidenceDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name);
}

/**
 * 归档原文文件名形态断言:非豁免文件必须匹配 `TIMESTAMP_PREFIX_RE`。
 * 放在目录枚举门禁里(而不是只写进 README 约定)是因为本目录的历史偏差命名正是
 * 「靠散文约定慢慢滑过来」的产物 —— 偏差只有当场变红才拦得住。
 * @returns {string[]} 不合规文件名(空数组 = 通过)
 */
function findOffFormNames() {
  return listArchiveDirMd()
    .filter((name) => !ARCHIVE_EXCLUDED.has(name) && !NAME_FORM_EXEMPT_RE.test(name) && !TIMESTAMP_PREFIX_RE.test(name))
    .sort();
}

/** @param {string} fileName 归档文件名 */
function workItemOf(fileName) {
  return WORK_ITEM_RE.exec(fileName)?.[0] ?? '—';
}

/** @param {string} fileName 归档文件名 */
function topicOf(fileName) {
  return fileName.replace(/\.md$/, '').replace(TIMESTAMP_PREFIX_RE, '').replace(WORK_ITEM_RE, '');
}

/**
 * 生成索引正文。链接列一律相对链接:文件列指向同目录的归档原文,「分流去向」列指向
 * `docs/` 内的宿主文件(须经 `../` 上溯一级)。
 * @param {string[]} fileNames 归档文件名(已排序)
 * @param {(fileName: string) => string | null} findHost 宿主文件检索
 * @returns {string} 索引全文(以 \n 结尾)
 */
function buildIndex(fileNames, findHost) {
  const header = [
    '# evidence/ 索引（生成式）',
    '',
    '> **本表由脚本生成,不手工登记**;来源 = `docs/evidence/` 目录枚举(排除本文件与 `README.md`)。新增归档原文后重新生成(`npm run gen:archive-index`),不要手改本表;同步由 `npm run check:archive-index` 校验。',
    '> **回捞路径 = 本表「分流去向」列 → 对应结论条目**:先在本表定位原文文件,再按同行「分流去向」打开升格后的条目,条目里的 `**来源/验证**` 字段会指回本文件。',
    '> 「分流去向」两种形态:`按名引用` = 结论条目在**关联字段里点名了本文件**,故可按名反查;`—` = 本原文**未被任何常驻条目按名引用**(结论或已被后续条目以其他措辞吸收,或原文自足、无独立结论可升格),此时回捞靠本表的主题列 + 关键词检索,不存在可点直链。**禁止**用主题词相似度给 `—` 的行补指针 —— 那类指针不可复现,索引就退化成手写表。',
    '',
  ];
  const table = [
    '| 文件 | 工作项ID | 主题 | 分流去向 |',
    '|---|---|---|---|',
  ];
  for (const fileName of fileNames) {
    const host = findHost(fileName);
    const destination = host === null ? '—' : `[${host}](../${host})`;
    table.push(`| [${fileName}](${fileName}) | ${workItemOf(fileName)} | ${topicOf(fileName)} | ${destination} |`);
  }
  return `${[...header, ...table].join('\n')}\n`;
}

/**
 * 逐行差异摘要(不引三方 diff 库,零依赖):定位首个差异行并列出前若干处。
 * @param {string} diskText 磁盘现有内容
 * @param {string} wantText 应生成内容
 * @returns {{ total: number, shown: string[] }} 差异总数与已格式化条目
 */
function diffSummary(diskText, wantText) {
  const diskLines = diskText.split('\n');
  const wantLines = wantText.split('\n');
  const diffs = [];
  for (let i = 0; i < Math.max(diskLines.length, wantLines.length); i += 1) {
    if (diskLines[i] !== wantLines[i]) {
      diffs.push({
        line: i + 1,
        disk: diskLines[i] ?? '<无此行>',
        want: wantLines[i] ?? '<无此行>',
      });
    }
  }
  const shown = diffs.slice(0, 10).map((d) => `第 ${d.line} 行\n    现有: ${d.disk}\n    应生成: ${d.want}`);
  if (diffs.length > shown.length) shown.push(`…另有 ${diffs.length - shown.length} 行不同(未列)`);
  return { total: diffs.length, shown };
}

// --check 比对前做 EOL 归一化(CRLF→LF):生成器落盘 LF(无 BOM、带尾换行),但
// Windows autocrlf 下 checkout 会把工作区文本转成 CRLF。.gitattributes 已固定
// 本文件 eol=lf,此处归一化是双保险 —— 即使属性未生效/旧 checkout 也不误报。
// 落盘路径不归一(写出的形态就是 LF),只有比对需要。
const normalizeEol = (/** @type {string} */ s) => s.replace(/\r\n/g, '\n');

export function main(argv) {
  if (argv.some((a) => !['--check'].includes(a))) {
    console.error(`[gen-archive-index] 无法识别的参数:${argv.filter((a) => a !== '--check').join(' ')}(${USAGE})`);
    return 1;
  }
  const check = argv.includes('--check');
  // 形态断言排在生成/比对之前:不合规时宁可不写索引 —— 写出去的表会把偏差固化成「已登记」
  const offForm = findOffFormNames();
  if (offForm.length > 0) {
    console.error(
      `[gen-archive-index:fail] docs/evidence/ 下 ${offForm.length} 份文件名不符合 \`YYYYMMDD-HHMMSS-<主题>.md\` 形态(豁免仅 ${[...ARCHIVE_EXCLUDED].join(' / ')} 与 user-guide-vX.Y.md):`,
    );
    for (const name of offForm) console.error(`  ${name}`);
    console.error('[gen-archive-index:fail] 改成 6 位时间戳后重跑(原名只到分钟,秒位无信息就补 `00`);改名走 `git mv` 以保历史可追,改完跑 `npm run gen:archive-index`');
    return 1;
  }
  const fileNames = listArchiveFiles();
  const findHost = makeHostIndex();
  const want = buildIndex(fileNames, findHost);
  const indexFile = path.join(projectRoot, 'docs', INDEX_REL);
  const dash = fileNames.filter((n) => findHost(n) === null).length;

  if (check) {
    if (!existsSync(indexFile)) {
      console.error(`[gen-archive-index:fail] ${INDEX_REL} 不存在(应生成),跑 \`npm run gen:archive-index\``);
      return 1;
    }
    const diskLf = normalizeEol(readFileSync(indexFile, 'utf8'));
    const wantLf = normalizeEol(want);
    if (diskLf !== wantLf) {
      const { total, shown } = diffSummary(diskLf, wantLf);
      console.error(`[gen-archive-index:fail] ${INDEX_REL} 与目录实际内容不一致(共 ${total} 行不同),前几处:`);
      for (const entry of shown) console.error(`  ${entry}`);
      console.error('[gen-archive-index:fail] 索引须由脚本生成,跑 `npm run gen:archive-index` 重生成(勿手改)');
      return 1;
    }
    console.log(
      `[ok] 归档索引与目录实际内容一致:${fileNames.length} 份归档原文(其中 ${dash} 份未被常驻条目按名引用,记 —),跑 \`npm run gen-archive-index\` 可重生成`,
    );
    return 0;
  }

  writeFileSync(indexFile, want, 'utf8');
  console.log(
    `[ok] 已生成 ${INDEX_REL}:${fileNames.length} 份归档原文(其中 ${dash} 份未被常驻条目按名引用,记 —)`,
  );
  return 0;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。写法与
// gates/probe/gate-probes/coverage-gate.mjs 同形(全仓先例),不另创写法。
//
// 为什么必须有守卫(不是「整洁」问题,是危险):本模块**默认是生成模式**,
// 顶层自执行意味着「import 这个模块」= 「重写 docs/evidence/INDEX.md」。
// 任何只想读一下它导出的判定函数的驱动器(门禁注册表 / 验收段)都会顺手改掉工作树文件,
// 且这种写入极难归因(没人显式跑过它)。守卫之后 import 无副作用,注册表因此能登记它
// 并真 import 出 main。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.join(projectRoot, 'gates', 'repo', 'gen-archive-index.mjs')) {
  process.exitCode = main(process.argv.slice(2));
}
