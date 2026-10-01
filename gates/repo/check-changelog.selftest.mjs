// CHANGELOG 口径门禁自身的回归守护(负向夹具)。
//
// check-changelog.mjs 是一道「扫不到东西就恒绿」风险极高的门禁:判据的输入是**一行 markdown
// 文本**,若词表被清空 / 锚点正则被改坏 / 扫描面塌缩,本脚本会打印 `[ok]` 而六类禁词照旧长在
// CHANGELOG 里。此处用临时夹具逐条制造这些漂移,断言门禁确实以非零码拒绝,并断言未漂移时通过。
//
// **不修改被测门禁本体**:夹具 = 把门禁脚本原样拷进临时目录的 gates/repo/(它的 projectRoot
// 由 shared/paths.js 推导,故拷贝后扫描面自动指向夹具根),连同它的仓内依赖 shared/paths.js
// 一起拷贝,再放一份夹具 CHANGELOG。真实仓库只被**读**(baseline 那一条跑真实 docs/CHANGELOG.md)。
// 少拷一个的代价不是「夹具少测一条」而是「门禁在沙盒里直接起不来」:相对 import 解析不到,
// 那条守护段 test/gates/contract-single-source.test.js 的副本闭包判定会先把它拦下。
//
// 每条负向夹具须命中一个真实漂移形态,而非人造噪声 —— 依据见各夹具的 why 注释。

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const checkerPath = join(projectRoot, 'gates', 'repo', 'check-changelog.mjs');

/**
 * 合规 CHANGELOG 底板:头部有一句**故意提到禁词**的口径说明(真实仓库头部就是这种形态),
 * 条目区三条都是「用户能感知的变化」的第三人称叙述。
 */
const CLEAN = [
  '# CHANGELOG',
  '',
  '> 版本演进历史,面向终端用户。只记录你能感知的变化;内部重构、测试、构建与发版流程不在此列出。',
  '',
  '## [待发版]',
  '',
  '### 修复',
  '',
  '- 图 / 表题注的字号此前两种导出不一样。现在两者一致,都跟随正文字号。',
  '- 设置的默认值此前是浅拷贝:改动某项设置时默认值本身可能被一并改掉。现在默认值每次独立构造。',
  '',
  '## [1.0.0] - 2026-01-01',
  '',
  '- 首个版本:支持 Markdown 转 Word 与 PDF。',
  '',
].join('\n');

/**
 * 造一份夹具:拷贝门禁本体 + shared/paths.js + 一份 CHANGELOG,再由 mutate 打上漂移。
 * @param {string} body CHANGELOG 正文
 * @param {(dir: string) => void} [mutate] mutate 抛异常时调用方拿不到 dir,其 finally 清不到
 *   → 在这里兜住(临时产物不留残)
 * @returns {string} 夹具根目录
 */
function createFixture(body, mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'm2w-changelog-selftest-'));
  try {
    mkdirSync(join(dir, 'gates', 'repo'), { recursive: true });
    copyFileSync(checkerPath, join(dir, 'gates', 'repo', 'check-changelog.mjs'));
    // 被测门禁从 shared/paths.js 取项目根(ADR-040),那是它唯一的仓内依赖,必须一起带进夹具
    mkdirSync(join(dir, 'shared'), { recursive: true });
    copyFileSync(join(projectRoot, 'shared', 'paths.js'), join(dir, 'shared', 'paths.js'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'CHANGELOG.md'), body, 'utf8');
    mutate?.(dir);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return dir;
}

/** 在夹具上跑门禁;返回退出码与合并输出 */
function runChecker(dir, args = []) {
  const result = spawnSync(process.execPath, [join(dir, 'gates', 'repo', 'check-changelog.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/** 把一条待发版条目注入到合规底板的条目区(锚点 `## [待发版]` 之后) */
function injectEntry(line) {
  return CLEAN.replace('## [待发版]\n', `## [待发版]\n\n${line}\n`);
}

const CASES = [
  {
    name: '真实仓库当前未漂移 → 通过',
    dir: projectRoot,
    expect: null,
  },
  {
    name: '夹具基线未漂移 → 通过',
    expect: null,
  },
  {
    // 判据一:禁内部工程词。逐词覆盖过一半枚举,证明词表不是只挂着两三个词。
    name: '判据一:条目里出现「CI 拦截」→ 判红',
    body: injectEntry('- 设置契约守卫补第 15 键(此前漏更致 CI 拦截)。'),
    expect: /\[changelog:fail] docs\/CHANGELOG\.md:\d+:\d+ → 禁内部工程词\(CI\)/,
  },
  {
    name: '判据一:条目里出现「门禁」→ 判红',
    body: injectEntry('- 新增一道门禁,校验导出产物的结构。'),
    expect: /→ 禁内部工程词\(门禁\)/,
  },
  {
    name: '判据一:条目里出现「DEV-GUIDE」与「代码地图」→ 判红',
    body: injectEntry('- 代码地图更新:DEV-GUIDE 新增若干文件说明。'),
    expect: /→ 禁内部工程词\((DEV-GUIDE|代码地图)\)/,
  },
  {
    name: '判据一:条目里出现「GitHub Actions」→ 判红',
    body: injectEntry('- 升级 GitHub Actions 至 v5,消除弃用警告。'),
    expect: /→ 禁内部工程词\(GitHub Actions\)/,
  },
  {
    name: '判据一:条目里出现「tsconfig」→ 判红',
    body: injectEntry('- 开启 tsconfig 的严格开关,暴露若干潜在问题。'),
    expect: /→ 禁内部工程词\(tsconfig\)/,
  },
  {
    name: '判据一:条目里出现「覆盖率」→ 判红',
    body: injectEntry('- 覆盖率阈值上调,顺带把断言补齐。'),
    expect: /→ 禁内部工程词\(覆盖率\)/,
  },
  {
    name: '判据一:条目里出现「lint」→ 判红',
    body: injectEntry('- lint 规则清掉了两条误报。'),
    expect: /→ 禁内部工程词\(lint\)/,
  },
  {
    // 判据二:禁第二人称。测的是**叙述句**里的你,而白名单里那条「你好」是另一形态。
    name: '判据二:条目里出现第二人称「你」→ 判红',
    body: injectEntry('- 水印透明度此前只在 PDF 生效 —— 你在设置里调透明度,Word 那边看不出变化。'),
    expect: /→ 禁第二人称\(你\)/,
  },
  {
    // 白名单按内容匹配的正向锚点:问候语「你好」是白名单登记的唯一形态,它必须仍判绿,
    // 否则白名单一旦腐烂成「整行放行」,自检也发现不了。
    name: '判据二:问候语「你好」走白名单 → 通过',
    body: injectEntry('- 首次启动的问候语改成「你好」,并补上副标题。'),
    expect: null,
  },
  {
    name: '判据三:条目里出现 REQ-138 → 判红',
    body: injectEntry('- 修复若干问题(REQ-138)。'),
    expect: /→ 禁内部编号\(REQ-0NN\)/,
  },
  {
    name: '判据三:条目里出现 commit hash → 判红',
    body: injectEntry('- 升级依赖,commit 为 a1b2c3d。'),
    expect: /→ 禁内部编号\(commit hash\)/,
  },
  {
    // 判据一的 commit 裸词形态:它与判据三是两条独立口径,故两条都会报(不互相遮掩)。
    name: '判据一:条目里出现「commit」裸词(无哈希)→ 判红',
    body: injectEntry('- 仓库补了一份 commit 规范说明。'),
    expect: /→ 禁内部工程词\(commit\)/,
  },
  {
    // hash 形态的误报面锚点(反向):纯数字长串与纯字母长串都不是 commit hash,
    // 判红它们会逼着人把正常数据从 changelog 里删掉。
    name: '判据三:紧凑日期 20261001 不是 hash → 通过',
    body: injectEntry('- 打包时间戳此前取构建日 20261001,导致同日多次构建产物不一致。'),
    expect: null,
  },
  {
    name: '判据三:纯字母长串(defaced)不是 hash → 通过',
    body: injectEntry('- 界面上的一处英文文案 defaced 拼错了,现已改对。'),
    expect: null,
  },
  {
    // 结构性负向:头部是要写反例的地方(真实仓库头部就写着「内部重构」与「你」),
    // 连头部一起扫的话唯一的修法是把口径说明改成绕口令 —— 那是损害而不是守护。
    name: '结构性负向:头部含全部六类禁词 → 通过(只扫条目区)',
    body: [
      '# CHANGELOG',
      '',
      '> 只记录你能感知的变化;内部重构(门禁 / CI / 覆盖率 / 契约守卫 / 代码地图 / DEV-GUIDE /',
      '> tsconfig / GitHub Actions / refactor / lint / commit)与 REQ-138 等内部编号不在此列出。',
      '> 文言虚词(亦 / 兹 / 遂 / 矣 / 焉 / 兮 / 尔)、装饰性副词(均 / 一概 / 悉 / 俱 / 概 / 仅)',
      '> 与载体维护(截图重拍 / 重新拍摄 / 重新截图 / 重新导图 / 示例路径 / 图片格式)一概不列出。',
      '',
      '## [待发版]',
      '',
      '### 修复',
      '',
      '- 题注字号此前两种导出不一致。现在两者一致。',
      '',
      '## [1.0.0] - 2026-01-01',
      '',
      '- 首个版本。',
      '',
    ].join('\n'),
    expect: null,
  },
  {
    // 防空过(判据一):锚点被改名 ⇒ 扫描面塌缩成「扫不到任何东西」⇒ 必须判红,
    // 否则这类漂移会静默恒绿(恒绿是纯文本门禁最危险的失效形态)。
    name: '防空过:锚点 `## [待发版]` 被改名 → 判红(扫描面塌缩)',
    body: CLEAN.replace('## [待发版]', '## 待发版'),
    expect: /找不到版本条目区锚点/,
  },
  {
    // 防空过(判据二):条目区被清空(只剩锚点与空小节)⇒ 扫不到任何版本条目 ⇒ 判红。
    name: '防空过:条目区无任何版本条目 → 判红',
    body: ['# CHANGELOG', '', '## [待发版]', '', '（空）', ''].join('\n'),
    expect: /在锚点之后没有任何 `## \[` 版本条目/,
  },
  {
    // 防空过(判据三):CHANGELOG 路径写成不存在的 ⇒ 读不到 ⇒ 判红,
    // 而不是「扫不到东西所以恒绿」。这条同时证明 CHANGELOG_REL 是真的被用上了。
    name: '防空过:CHANGELOG 路径不存在 → 判红',
    body: CLEAN,
    mutate: (dir) => rmSync(join(dir, 'docs', 'CHANGELOG.md')),
    expect: /扫描失败/,
  },
  {
    // 判据四:禁文言虚词。逐字覆盖枚举 —— 文言腔正是本次改写质量不合格的主因之一。
    name: '判据四:条目里出现文言虚词「亦」→ 判红',
    body: injectEntry('- 题注此前两处导出不一致，图上版本号亦停留在旧版本。'),
    expect: /→ 禁文言虚词\(亦\)/,
  },
  {
    name: '判据四:条目里出现「遂」→ 判红',
    body: injectEntry('- 改用统一解析后，遂不再出现重复题注。'),
    expect: /→ 禁文言虚词\(遂\)/,
  },
  {
    name: '判据四:条目里出现「兹 / 矣 / 焉 / 兮 / 尔」→ 判红',
    body: injectEntry('- 兹项修复已生效，界面矣 cleaner，行为焉 cleaner，标题兮 cleaner，待尔复验。'),
    expect: /→ 禁文言虚词\((兹|矣|焉|兮|尔)/,
  },
  {
    // 成词护栏的反向锚点:`覆盖` 是本仓 changelog 的高频正当用词(实测 9/9 命中全在成词里),
    // 按裸「盖」判红会把它们全部打红 —— 噪声源的下场是被关掉,故护栏必须逐词钉住。
    name: '判据四:成词「覆盖 / 遮盖 / 涵盖 / 均匀 / 俱全 / 概览 / 偶尔」→ 通过',
    body: injectEntry('- 预设覆盖页眉页脚与公式编号；灰底遮盖住引用块边界；目录涵盖全部源文件；字距均匀；图标俱全；附功能概览；偶尔出现。'),
    expect: null,
  },
  {
    // 反向锚点:护栏是**逐词**的,不能因为一行里有「覆盖」就把同行的裸「盖」一起放过。
    name: '判据四:成词护栏不掩盖同行裸用「盖」→ 判红',
    body: injectEntry('- 预设覆盖范围扩展，此外盖住了原先的例外项。'),
    expect: /→ 禁文言虚词\(盖\)/,
  },
  // 判据五:禁装饰性副词。均/一概/俱/概 在真实语料里确有副词用法(实测均 2 处、概览 1 处已放行)。
  {
    name: '判据五:条目里出现装饰性副词「均」→ 判红',
    body: injectEntry('- 两种导出的字号此前不一致，现两者均跟随正文字号。'),
    expect: /→ 禁装饰性副词\(均\)/,
  },
  {
    name: '判据五:条目里出现「一概 / 悉 / 俱 / 概」→ 判红',
    body: injectEntry('- 该问题一概不再出现；错误界面悉已对齐；图标俱已就位；功能概已补齐。'),
    expect: /→ 禁装饰性副词\((一概|悉|俱|概)/,
  },
  {
    // 实义限定判定:语料实测 `仅` 的 21 处命中全是实义限定，故这条分支必须放行 ——
    // 反过来，「仅」后面跟程度副词(无限定对象)才是装饰用法，必须判红。
    name: '判据五:实义限定的「仅 PDF」→ 通过',
    body: injectEntry('- 水印不透明度此前仅 PDF 导出有效，现 Word 侧也生效。'),
    expect: null,
  },
  {
    name: '判据五:实义限定的「仅显示当前分组」→ 通过',
    body: injectEntry('- 设置抽屉改为两栏，左侧为标签栏，右侧仅显示当前分组的选项。'),
    expect: null,
  },
  {
    name: '判据五:无实义限定的装饰性「仅」→ 判红',
    body: injectEntry('- 题注字号仅略微缩小了一点，两种导出现已一致。'),
    expect: /→ 禁装饰性副词\(仅\)/,
  },
  {
    name: '判据五:「平均」走白名单(实义用法)→ 通过',
    body: injectEntry('- 灰底此前仅部分内容带底，现整块平均覆盖引用块。'),
    expect: null,
  },
  // 判据六:禁载体维护。这三个是本次改写被判定不合格的另一主因。
  {
    name: '判据六:条目里出现「截图重拍」→ 判红',
    body: injectEntry('- 界面预览图重拍主窗口与空状态两张。'),
    expect: /→ 禁载体维护\(重拍\)/,
  },
  {
    name: '判据六:条目里出现「重新拍摄 / 示例路径 / 图片格式」→ 判红',
    body: injectEntry('- README 截图按新版重新拍摄；本机路径已换成示例路径；修正图片格式为 .jpg。'),
    expect: /→ 禁载体维护\((重新拍摄|示例路径|图片格式)/,
  },
  {
    // `原生标题栏` 的语境判定:讲截图(载体维护)判红,讲界面变更(正当条目)放行。
    name: '判据六:截图语境里的「原生标题栏」→ 判红',
    body: injectEntry('- 官网截图展示的还是早已不用的原生标题栏样式，现已重拍。'),
    expect: /→ 禁载体维护\(原生标题栏\)/,
  },
  {
    name: '判据六:纯界面语境的「原生标题栏」→ 通过(正当界面变更)',
    body: injectEntry('- 主窗口移除原生标题栏，改用自定义标题区，拖动与双击行为不变。'),
    expect: null,
  },
  {
    name: '未知参数(不得静默按默认扫描面跑一遍报绿)',
    raw: ['oops'],
    expect: /无法识别的参数:oops/,
  },
];

const failures = [];
for (const testCase of CASES) {
  let dir;
  try {
    // `dir` 显式给出 = 跑真实仓库(只读);否则造夹具并在 finally 清理
    try {
      dir = testCase.dir
        ?? createFixture(
          /** @type {string} */ (testCase.body ?? CLEAN),
          /** @type {(dir: string) => void} */ (testCase.mutate),
        );
    } catch (error) {
      // createFixture 抛异常时它自己已清理;这里只登记,不让一条夹具的构造失败
      // 打断整批(否则后面的夹具一条都跑不到,报告里也看不出是哪条坏了)
      failures.push(
        `夹具 ${testCase.name}:造夹具抛异常:${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const { code, output } = runChecker(dir, testCase.raw ?? []);
    const tag = testCase.dir === undefined ? '夹具' : '真实仓库';
    if (testCase.expect === null) {
      if (code === 0) {
        console.log(`[ok] changelog-selftest:${testCase.name}(门禁通过,exit 0)`);
      } else {
        failures.push(`${tag} ${testCase.name}:期望通过,实际 exit ${code}\n${output}`);
      }
      continue;
    }
    if (code !== 0 && testCase.expect.test(output)) {
      console.log(`[ok] changelog-selftest:${testCase.name}(漂移被拦截,exit ${code})`);
    } else {
      failures.push(
        `${tag} ${testCase.name}:期望 exit≠0 且输出匹配 ${testCase.expect},实际 exit ${code}\n${output}`,
      );
    }
  } finally {
    if (testCase.dir === undefined && dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[changelog-selftest:fail] ${failure}`);
  console.error(`[changelog-selftest:fail] CHANGELOG 口径门禁回归守护失败,共 ${failures.length}/${CASES.length} 条`);
  process.exit(1);
}
console.log(`[ok] changelog-selftest:${CASES.length} 条夹具全部符合预期(未漂移通过 / 漂移拦截)`);