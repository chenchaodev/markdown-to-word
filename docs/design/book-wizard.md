# 成书向导 · UI/交互设计（草稿）

> 状态：**设计稿（待校订）**。文案均为 DRAFT，措辞后续由人工校订。
> 适用范围：renderer 内 stepper 模态（非独立 BrowserWindow）+ 剪贴板直转按钮。
> 单一事实源：`docs/design/ui-guidelines.md`（令牌/控件/红线）、`docs/design/settings-ia.md`（7 组 IA）。
> 本文件不写实现代码，只描述结构、交互、令牌与文案键。

---

## 1. 概述与目标

把已有的零散能力（模板预设、封面、页眉页脚、水印、合并、目录）串成一条「成书」多步流程，让不熟悉设置的用户也能产出一本书。向导是**设置抽屉的另一种入口**——它读写的是同一份 `state.settings` 与同一份文件列表，不是平行的另一套状态。

两条红线贯穿本设计：

1. **朱砂只用于「付印」语义**：向导里只有最后一步的「付印」主按钮是 `--acc`（朱砂）；「下一步 / 上一步 / 跳过」一律墨色或幽灵，stepper 当前态也不许用朱砂。
2. **签名元素（裁切线 + 直排 + 钤印）只在空态纸面一处**：向导是模态弹窗，自身不带签名装饰；成书完成后的反馈复用既有「转换完成」弹窗（钤印 `梓`），不另起钤印。

---

## 2. 设计令牌与控件约束（重申，禁止绕过）

全部走 `ui-guidelines.md` 的 CSS 变量，不硬编码 hex/px。

| 用途 | 令牌 |
|---|---|
| 模态遮罩 | `--scrim`（复用 `.dialog-overlay` 既有遮罩 + `backdrop-filter: blur(3px)`） |
| 向导卡片 | `--card` 底 / `--line` 边 / `--radius-card`(10) / `--shadow-pop` |
| 次级面（预览/凹陷） | `--card-2` / `--inset` |
| 文字三级 | `--ink` / `--ink-2` / `--mut` |
| 朱砂（仅付印） | `--acc` / `--acc-h` / `--acc-soft` / `--acc-ring` |
| 墨色实心（次主动作） | `--solid-bg` / `--solid-fg` |
| 成功（仅结果） | `--ok` |
| 字体三角色 | `--font-display`（标题/题字，只做声音）/ `--font-ui`（正文控件）/ `--font-mono`（路径/数值/日期） |
| 形状 | 窗口 12 / 卡片·抽屉 10 / 按钮 8（sm 7）/ 输入件 7 |
| 控件高 | 输入件·标准按钮 32–34、sm 29、主按钮 40 |

**控件映射（强制沿用，不发明新形态）**：枚举 ≤5 → `seg` 分段；枚举 >5 → `sel` 下拉；布尔 → `switch`；有界数值 → `stepper`/`range`；路径 → `path-chip` + 「更改…」；多字段数值组 → 带单位输入件网格。向导每步都复用这些既有控件类（`.segmented`/`.segment`、`.setting-select`/`.sel-wrap`、`.switch-input`、`.tin`、`.stepper`、`.path-chip`、`.cond`、`.mlist`/`.multi-grip`、`.progress-*`、`.result-summary`、`.toast`）。

---

## 3. 向导外壳

### 3.1 DOM 结构（草稿标记，非实现）

复用 `.dialog-overlay` + 新增 `.dialog--wizard`（在 `dialogs.css` 内追加，不新建文件）。结构骨架：

```html
<div id="bookWizard" class="dialog-overlay hidden"
     role="dialog" aria-modal="true" aria-labelledby="wizardTitle">
  <div class="dialog dialog--wizard">

    <!-- 头部：题字标题 + 关闭 -->
    <header class="wizard-head">
      <div class="wizard-head-texts">
        <h2 id="wizardTitle" class="dialog-title" data-i18n="wizard.title">成书向导</h2>
        <p class="wizard-sub" data-i18n="wizard.sub">把多篇文档合成一本书</p>
      </div>
      <button type="button" id="wizardCloseBtn" class="icon-btn"
              data-i18n-aria-label="wizard.close" aria-label="关闭向导">
        <!-- 复用设置抽屉的同款叉号 svg -->
      </button>
    </header>

    <!-- 步骤指示器（见 3.3） -->
    <ol class="wizard-steps" id="wizardSteps" aria-label="成书步骤"></ol>

    <!-- 内容区：每步一个 section，按 data-step 显隐 -->
    <div class="wizard-body" id="wizardBody">
      <section class="wz-pane" data-step="1"> …模板… </section>
      <section class="wz-pane" data-step="2"> …封面… </section>
      <section class="wz-pane" data-step="3"> …页眉页脚… </section>
      <section class="wz-pane" data-step="4"> …水印… </section>
      <section class="wz-pane" data-step="5"> …合并源… </section>
      <section class="wz-pane" data-step="6"> …目录… </section>
      <section class="wz-pane" data-step="7"> …付印… </section>
    </div>

    <!-- 底部导航（见 3.4） -->
    <footer class="wizard-foot">
      <button type="button" id="wizardSkip" class="btn btn-text sm" data-i18n="wizard.skip">跳过此步</button>
      <span class="spacer"></span>
      <button type="button" id="wizardPrev" class="btn btn-ghost" data-i18n="wizard.prev">上一步</button>
      <button type="button" id="wizardNext" class="btn btn-solid"  data-i18n="wizard.next">下一步</button>
      <!-- 第 7 步时 wizardNext 替换为 wizardFinish（朱砂）： -->
      <!-- <button type="button" id="wizardFinish" class="btn btn-primary" data-i18n="wizard.finish">付印</button> -->
    </footer>
  </div>
</div>
```

### 3.2 遮罩 / 焦点陷阱 / 关闭

- **焦点陷阱**：打开即 `trapFocus(bookWizard)`（复用 `src/renderer/state/utils.ts` 的栈式 `trapFocus`，与设置抽屉、另存预设弹窗同一机制）；关闭时调用返回的 release 函数。多弹窗并存时栈顶优先，行为与其他模态一致。
- **Esc 关闭**：绑定 `keydown` 监听 `Escape` → `closeWizard()`。与既有弹窗 Esc 约定对齐（设置抽屉/完成弹窗的 Esc 行为同语义）。
- **点遮罩关闭**：`bookWizard.addEventListener('click', e => { if (e.target === bookWizard) closeWizard(); })`——只响应遮罩本身，点卡片内部不关（与设置抽屉、弹窗同语义）。
- **关闭后焦点归还**：关闭把焦点还给触发向导的按钮（与 `closeSettingsDrawer` 把焦点还给 `settingsOpenBtn` 同模式）。
- **与抽屉互斥**：向导与设置抽屉都是模态。打开向导时若抽屉开着，先关抽屉（释放其陷阱）再开向导；反之亦然。避免两个陷阱栈互相抢焦点。

### 3.3 步骤指示器（stepper）

7 步：① 模板 ② 封面 ③ 页眉页脚 ④ 水印 ⑤ 合并源 ⑥ 目录 ⑦ 付印。

- **当前/总数**：舒适/紧凑档显示 7 个带标签的圆点（`模板 · 封面 · 页眉页脚 · 水印 · 合并源 · 目录 · 付印`）；窄窗/半屏（≤900 / ≤720）折叠为「`3 / 7` 封面」单行 + 一条细进度轨（用 `--line` / `--ink-2`，**不用朱砂**）。
- **状态着色（严守红线）**：
  - 已完成：圆点 `--ink-2` 底 + 对勾（✓，用 `--ok`？不——`--ok` 仅限结果勾选与完成态；stepper 的「已完成」用 `--ink-2` 描边 + 灰阶对勾，避免与结果绿勾混淆）。
  - 当前：`--ink` 实心圆点 + 加粗标签 + 左侧 2px `--line-2` 短轨（**不用朱砂**）。
  - 未来：`--mut` 灰点。
- **可跳过**：每步都有「跳过此步」文字按钮（见 3.4）；跳过的步在指示器上标记为「已跳过」（虚线环 `--line-2`），可随时回退补做。
- **`aria`**：`<ol>` 给 `aria-label`；当前步 `<li aria-current="step">`；每步按钮 `aria-label` 含步号与名称（如「第 2 步：封面」）。

### 3.4 导航与按钮语义（朱砂纪律落点）

| 按钮 | 类 | 语义 | 朱砂？ |
|---|---|---|---|
| 跳过此步 | `btn btn-text sm` | 放弃本步，用现有/默认设置 | 否 |
| 上一步 | `btn btn-ghost` | 返回上一步 | 否 |
| 下一步（1–6 步） | `btn btn-solid` | 次主动作（墨色实心） | 否 |
| **付印（第 7 步）** | `btn btn-primary` | **付印语义** | **是（唯一朱砂）** |

- 第 1 步时「上一步」禁用（墨色描边/幽灵禁用态，不用红）。
- 「下一步」在最后一步（第 6 步）切换为「付印」`btn-primary`（朱砂），触发 `runMerge`。
- 禁用态：某步必填项缺失时（如第 5 步文件 < 2 个），「下一步/付印」禁用——但「跳过」仍可用（跳过 = 该步留空/默认）。

### 3.5 响应式与断点

- 向导宽度：`min(680px, 100%)`，内边距沿用 `.dialog` 的 22px。
- 复用 `ui-guidelines §5.3` 档位：
  - 舒适（>1080）/ 紧凑（≤1080）：stepper 全标签；卡片内两列布局可用。
  - 窄窗（≤900）/ 半屏（≤720，应用 minWidth 640）：stepper 折叠为「n/7 名称」；`.wizard-body` 内部滚动（`max-height` + `overflow-y:auto`，`min-height:0` 弹性链路不断），**底部导航栏恒高不跳动**（与动作栏零跳动同纪律）。
  - 矮窗（≤640）：向导高度受限时，`.wizard-body` 滚动优先，头部/导航不收缩。
- 过渡：`transition ≤ 260ms`，且全部包 `prefers-reduced-motion` 兜底（复用 `.dialog-overlay-in` / `.dialog-in` 动画令牌，不新造）。

### 3.6 与主舞台 + 7 组抽屉的集成

- **共享状态**：向导内改的模板/页眉/水印/目录，直接写 `state.settings`（与抽屉同源），并走既有 autosave。关向导不丢设置——与关抽屉行为一致。
- **合并源**：第 5 步选的文件直接进 `state.selectedFiles`（复用 `appendSelection` / `collectMarkdowns`），即使中途关向导，文件也留在主舞台队列。
  - **封面字段**：标题/作者/日期是**文档元数据**，不在 `state.settings` 里。向导收集进一个临时 `wizardDraft.cover`，在「付印」时随 `runMerge` 传入（见 §4.2 与 §9 风险）。
  - **入口（已拍板）**：仅空态投放区加一个「成书向导」按钮（与剪贴板直转并列），`btn-solid`（墨色），与剪贴板直转同级；不做菜单入口。
- **付印后反馈**：第 7 步「付印」→ 关向导（释放陷阱、焦点归还触发钮）→ 调 `runMerge`（`convert-flow.ts:165`）→ 复用主舞台动作栏的进度条 + 既有「转换完成」弹窗（钤印 `梓`）+ 常驻结果汇总条。向导自身不重造进度/结果 UI。

---

## 4. 各步骤布局与交互

每步一个 `.wz-pane`，结构统一：左为控件区（复用既有控件类），右为说明/预览（窄窗时上下堆叠）。字段分组靠 `--line` 发丝线，不靠大色块。

### 4.1 步骤 1 · 模板 / 预设

- **控件**：
  - `sel` 下拉（`#wizardPreset`，复用 `templatePreset` 同款选项集，由 `rebuildPresetOptions` 填充）：枚举 >5 → 下拉合规。
  - 「导入 Word 模板…」`btn btn-ghost sm`：触发 `template:importDocx`（`importDocxTemplate`），回填 typography/pageSetup。
- **映射**：选预设 → `applyTemplatePreset(id)`；导入 → `importDocxTemplate()`。两者都写 `state.settings`（排版 + 页面）。
- **说明**：一行灰字「选一个起点，或导入你现有的 Word 模板」（DRAFT）。
- **空/错态**：无预设时下拉默认「默认」；导入失败走 `setError` + toast（复用既有）。
- **可跳过**：跳过 = 用当前已生效的预设/设置。

### 4.2 步骤 2 · 封面页

- **表单字段**（文本输入件 `.tin`，UI 栈）：
  - 标题（`wizard.cover.fieldTitle`）——必填感知，缺失则降级（见下）。
  - 作者（`wizard.cover.fieldAuthor`）。
  - 日期（`wizard.cover.fieldDate`，`.tin` 或日期输入，mono 回显）。
- **来源与回填**：打开本步时，读 `state.selectedFiles[0]` 的 frontmatter（`parseFrontmatter`），若有 title/author/date 则预填表单，并显示一行灰字「已从首篇文档的 frontmatter 读取」（DRAFT）。用户手动改的优先。
- **实时预览**（右侧 `.wz-cover-preview` 卡，用 `--card-2` 底 + `--inset` 边）：
  - 标题用 `--font-display`（衬线，只做声音）；作者用 `--font-ui`；日期用 `--font-mono`。
  - 布局模拟真实封面：标题居中偏大、作者居中小字、日期底部 mono。
- **双格式说明**（两行小字，mono 角标风格）：
  - `Word：生成独立封面节（独占一页）`
  - `PDF：使用 HTML 模板封面`
  - **字段缺失降级**：标题为空 → 预览区显示灰字「未填标题时将不生成封面页」（DRAFT），且「付印」时跳过封面（与现有 `metadata.title` 缺失不渲染封面一致）。作者/日期缺失则对应行不显示，不报错。
- **映射**：收集进 `wizardDraft.cover`，付印时传入转换管线（核心需支持，见 §9）。

### 4.3 步骤 3 · 页眉页脚（F4）

- 复用设置抽屉 03 组的「模式 + 条件字段」结构（`.cond` 凹陷容器 + 左侧轨）：
  - `seg` 页眉模式（默认/自定义/无）→ 仅「自定义」展开条件字段。
  - 条件字段：页眉文字（`.tin`）、页眉图片（`path-chip` + 「选择图片…」）、页眉布局（`seg` 居中/左右分栏）、自定义页脚（`switch` + 说明「显示『第 X 页 / 共 Y 页』；仅自定义模式生效」）。
- **映射**：直接写 `state.settings.headerMode / headerText / headerLogoPath / headerLayout / footerEnabled`（与抽屉同字段、同 bindings）。
- **可跳过**：跳过 = 保留当前页眉页脚设置。

### 4.4 步骤 4 · 水印（F5）

- 复用设置抽屉 03 组第二区块：水印文字（`.tin`）、旋转角度（`.tin` + `°`）、不透明度（`.tin`，0–1）、浅灰经典观感（`switch` + 说明「关闭则沿用正文字色」）。
- **映射**：写 `state.settings.watermarkText / watermarkAngle / watermarkOpacity / watermarkGray`。
- **可跳过**：跳过 = 无水印（或保留当前）。

### 4.5 步骤 5 · 合并源

- **文件选择**：「添加文件」`btn btn-ghost` → 复用 `appendSelection` / `collectMarkdowns`（与拖放同链路）。
- **排序 UI**：复用主舞台文件队列的 `grip` 拖拽排序（`.mlist` / `.multi-grip`，n≥2 显示手柄与序号，序号自动重排）。向导内嵌一个精简版 `.mlist`（仅文件名 + 手柄 + 移除），不显示预览/追加等主舞台专属动作。
- **空/错态**：
  - 文件 < 2：显示灰字「至少添加两个文件才能合并成书」（DRAFT），「下一步/付印」禁用（但可跳过 = 不合并，仅单文件？见 §9）。
  - 重复/跳过：复用 `showSkippedList` 逻辑（可折叠列表）。
- **映射**：`mergeMarkdowns`（首文件 frontmatter 保留、后续剥离、图片绝对化）以 `<!-- page-break -->` 拼接 → 单次 convert。文件即 `state.selectedFiles`。
- **可跳过**：跳过 = 不合并（仅对当前列表做普通转换，非成书）。

### 4.6 步骤 6 · 目录 / 页码（F8）

- 自动目录（`switch`）+ 目录模式（`sel`：静态 / Word 域（带真实页码））。
- **映射**：写 `state.settings.toc`（开）与 `tocMode: 'field'`（选 Word 域时）。
- **说明**：一行灰字解释「Word 域目录会在打开后显示真实页码」（DRAFT）。
- **可跳过**：跳过 = 无目录。

### 4.7 步骤 7 · 付印（输出）

- **格式选择**（`seg`，枚举 3 → `seg` 合规）：
  - `Word (.docx)` / `PDF (.pdf)` / `双格式（docx + pdf）`。
- **触发**：点「付印」(`btn-primary` 朱砂) → `closeWizard()` → `runMerge()`（用当前 `state.settings` + `state.selectedFiles` + `wizardDraft.cover`）。
- **进度 + 结果（复用现有模式，不重造）**：
  - 进度：主舞台动作栏 `.progress-area`（5px 细轨 + mono 百分比 + 取消），与现有转换同链路。
  - 成功：既有「转换完成」弹窗（钤印 `梓`）+ 常驻结果汇总条（绿勾 + mono 路径 + 打开/所在文件夹）。双格式时路径区列出两个文件。
  - 失败：既有失败弹窗 / 汇总条红字（朱砂仅此处作结果警示，符合「结果警示」既有用法）。
- **可跳过**：本步不可跳过（它是终点）；「上一步」可回改。

---

## 5. 剪贴板直转按钮（极简）

- **位置**：空态投放区（`.pane-empty` 的 `.drop-core`）内，与「选择文件」按钮并列——放在「选择文件」下方或右侧，作为次级输入动作。
- **标签（DRAFT）**：`粘贴 Markdown 转换`。
- **视觉**：`btn btn-solid`（墨色实心），与「选择文件」同级，保持空态克制；**不用朱砂**（朱砂留给主转换按钮 `convertBtn`，避免空态出现两个强调色）。
- **交互**：
  1. 点击 → 读剪贴板纯文本（`navigator.clipboard.readText()`，经 preload 暴露）。
  2. 文本为空或非文本 → toast「剪贴板里没有可转换的文本」（DRAFT），按钮不动。
  3. 有文本 → 写临时 `.md` → `convert:single`（IPC `CH.convertSingle`）→ 复用主舞台进度条 + 结果汇总条/完成弹窗。
  4. 转换中：按钮禁用（墨色禁用态），进度走动作栏；结束后恢复。
- **不做热键**（规划已拍板）：纯按钮触发，不绑 Ctrl+V 等。
- **无障碍**：`aria-label` = 「从剪贴板粘贴 Markdown 并转换」（DRAFT）；读屏播报状态变化（toast 已 `aria-live="polite"`）。

---

## 6. 设计令牌 / 视觉处理速查

- **纸感底**：向导卡片 `--card`，遮罩 `--scrim` + `blur(3px)`，与所有弹窗同语汇。
- **朱砂仅付印**：全向导唯一 `--acc` 处 = 第 7 步「付印」按钮 + 结果失败红字（既有用法）。stepper 当前态、下一步、跳过均墨色/灰阶。
- **字体三角色**：向导标题 `dialog-title` 用 `--font-display`（衬线题字）；所有控件/说明 `--font-ui`；路径/日期/百分比/角度 `--font-mono`。封面预览严格守此分工。
- **签名元素落位**：向导自身**不带**裁切线/直排/钤印（签名只在空态纸面）。成书完成的钤印由既有「转换完成」弹窗的 `梓` 提供——全站钤印笔触不增不减。
- **密度秩序**：信息分层靠字重 + 三级文字色（`--ink/--ink-2/--mut`），不靠加框堆线；分组用 1px `--line` 发丝线。
- **hover/动效**：hover 微交互 ≤150ms，transition ≤260ms，全包 `prefers-reduced-motion`。

---

## 7. 无障碍

- **焦点顺序**：打开 → 焦点落首个可聚焦元素（或关闭钮）；`trapFocus` 保证 Tab/Shift+Tab 在向导内循环；关闭 → 焦点归还触发钮。
- **stepper**：`<ol aria-label>` + 当前步 `aria-current="step"`；步按钮 `aria-label` 含「第 N 步：名称」。
- **每步表单**：`<label for>` 关联；`seg`/`switch`/`sel` 沿用既有 `role="radiogroup"` / `aria-label`。
- **Esc**：关闭向导（等同点遮罩/关闭钮），不触发付印。
- **进度/结果**：复用 `.progress-track`（`role="progressbar"` + `aria-valuenow`）与 toast（`aria-live="polite"`）、结果汇总条（`role="status"`）。
- **reduced-motion**：向导所有入场/过渡动画继承 `.dialog-*` 的 reduced-motion 兜底，不新造会逃逸的动画。
- **对比度**：文字均走令牌三级色，满足 WCAG AA（与现有界面一致）。

---

## 8. i18n 新键清单（zh / en / ja，标注 DRAFT）

> 键名前缀 `wizard.*` 与 `b3.*`；文案为 DRAFT，待校订。zh 为源，en 全量，ja 按现有 Partial 回退链补。

**向导外壳**
| 键 | zh(DRAFT) | en(DRAFT) | ja(DRAFT) |
|---|---|---|---|
| `wizard.title` | 成书向导 | Book Wizard | 製本ウィザード |
| `wizard.sub` | 把多篇文档合成一本书 | Turn several docs into a book | 複数の文書を一冊にまとめる |
| `wizard.close` | 关闭向导 | Close wizard | ウィザードを閉じる |
| `wizard.skip` | 跳过此步 | Skip this step | この手順をスキップ |
| `wizard.prev` | 上一步 | Previous | 前へ |
| `wizard.next` | 下一步 | Next | 次へ |
| `wizard.finish` | 付印 | Print | 印刷 |
| `wizard.stepTemplate` | 模板 | Template | テンプレート |
| `wizard.stepCover` | 封面 | Cover | 表紙 |
| `wizard.stepHeader` | 页眉页脚 | Header & Footer | ヘッダー・フッター |
| `wizard.stepWatermark` | 水印 | Watermark | 透かし |
| `wizard.stepMerge` | 合并源 | Merge Sources | 結合元 |
| `wizard.stepToc` | 目录 | Table of Contents | 目次 |
| `wizard.stepOutput` | 付印 | Print | 印刷 |

**步骤 1 模板**
| `wizard.template.label` | 模板预设 | Template preset | テンプレート |
| `wizard.template.import` | 导入 Word 模板… | Import Word template… | Word テンプレートをインポート… |
| `wizard.template.importTitle` | 从 Word 文档导入字体与页面尺寸 | Import fonts and page size from a Word doc | Word 文書からフォントと用紙サイズをインポート |
| `wizard.template.hint` | 选一个起点，或导入你现有的 Word 模板 | Pick a starting point, or import your Word template | 起点を選ぶか、既存の Word テンプレートを取り込む |

**步骤 2 封面**
| `wizard.cover.fieldTitle` | 标题 | Title | タイトル |
| `wizard.cover.fieldAuthor` | 作者 | Author | 著者 |
| `wizard.cover.fieldDate` | 日期 | Date | 日付 |
| `wizard.cover.fromFrontmatter` | 已从首篇文档的 frontmatter 读取 | Read from the first document's frontmatter | 最初の文書の frontmatter から読み込み済み |
| `wizard.cover.preview` | 预览 | Preview | プレビュー |
| `wizard.cover.noteDocx` | Word：生成独立封面节 | Word: a standalone cover section | Word：独立した表紙セクション |
| `wizard.cover.notePdf` | PDF：使用 HTML 模板封面 | PDF: HTML template cover | PDF：HTML テンプレート表紙 |
| `wizard.cover.missingTitle` | 未填标题时将不生成封面页 | No cover page if title is empty | タイトル未入力時は表紙を生成しない |

**步骤 3 页眉页脚 / 步骤 4 水印**
> 这两步直接复用设置抽屉既有键（`settings.headerMode*`、`settings.headerText`、`settings.headerLogo*`、`settings.headerLayout*`、`settings.footerEnabled*`、`settings.watermark*`），**不新增键**。

**步骤 5 合并源**
| `wizard.merge.add` | 添加文件 | Add files | ファイルを追加 |
| `wizard.merge.empty` | 至少添加两个文件才能合并成书 | Add at least two files to merge a book | 製本には最低 2 ファイル必要 |
| `wizard.merge.hint` | 拖拽左侧手柄调整顺序，合并按当前顺序拼接 | Drag the handle to reorder; merge follows this order | 左のハンドルで順序変更、結合はこの順 |
| `wizard.merge.count` | 已选 {count} 个文件 | {count} files selected | {count} 件選択中 |

**步骤 6 目录**
| `wizard.toc.enable` | 自动目录 | Auto table of contents | 自動目次 |
| `wizard.toc.mode` | 目录模式 | TOC mode | 目次モード |
| `wizard.toc.modeStatic` | 静态目录（免更新） | Static TOC (no update) | 静的目次（更新不要） |
| `wizard.toc.modeField` | Word 域目录（带真实页码） | Word field TOC (real page numbers) | Word フィールド目次（実ページ番号） |

**步骤 7 付印**
| `wizard.output.format` | 输出格式 | Output format | 出力形式 |
| `wizard.output.docx` | Word (.docx) | Word (.docx) | Word (.docx) |
| `wizard.output.pdf` | PDF (.pdf) | PDF (.pdf) | PDF (.pdf) |
| `wizard.output.both` | 双格式（docx + pdf） | Both (docx + pdf) | 両方 (docx + pdf) |
| `wizard.output.start` | 开始付印 | Start printing | 印刷開始 |
| `wizard.output.progress` | 正在生成… | Generating… | 生成中… |
| `wizard.output.done` | 已生成 {name} | Generated {name} | {name} を生成しました |
| `wizard.output.fail` | 生成失败 | Generation failed | 生成失敗 |

**剪贴板直转**
| `b3.label` | 粘贴 Markdown 转换 | Paste Markdown to convert | Markdown を貼り付けて変換 |
| `b3.title` | 从剪贴板粘贴 Markdown 并转换 | Paste Markdown from clipboard and convert | クリップボードから Markdown を貼り付けて変換 |
| `b3.empty` | 剪贴板里没有可转换的文本 | No convertible text in clipboard | クリップボードに変換できるテキストなし |
| `b3.reading` | 正在读取剪贴板… | Reading clipboard… | クリップボードを読み込み中… |

**键数量估算**：`wizard.*` 约 44 个 + `b3.*` 4 个 ≈ **48 个新键**（zh/en 全量，ja 同步补 Partial）。步骤 3/4 复用既有设置键，不新增；封面「单位」字段已移除（不扩展核心）。

---

## 9. 开放问题 / 风险

1. **「单位」字段（已拍板：暂不包含）**：`DocMetadata` 仅解析 `title/author/date`，无 `organization`。已决策首版封面不含「单位」字段（不扩展核心）；后续若需，再单独评估核心扩展。本稿已移除 `fieldOrg` / `orgNote`。
2. **封面元数据传入管线（高）**：现有封面来自首文件 frontmatter；向导要支持「手动填 / 覆盖 frontmatter」。需 `convertMerge` / `convertSingle` 接受 `cover` 覆盖参数（核心改动）。否则向导封面步只能改首文件 frontmatter 文件本身（不优雅）。
3. **向导入口（已拍板：仅空态按钮）**：已决策仅空态投放区加「成书向导」按钮（与剪贴板直转并列），不做菜单入口。
4. **跳过合并源的含义（中）**：第 5 步跳过 = 不合并（仅当前列表普通转换）。但若列表 < 2，「成书」语义不成立——是否允许跳过？建议：文件 < 2 时「跳过」也禁用，强制至少合并两步或退回单文件流程。
5. **设置实时写 vs 草稿（已拍板：实时写入）**：采用「向导内改设置实时写 `state.settings` + autosave，与抽屉一致」，关向导不丢设置。封面元数据（标题/作者/日期）仍走 `wizardDraft.cover`，付印时随 `runMerge` 传入。
6. **双格式输出文件名（低）**：`runMerge` 当前输出 `{首文件名}-合并.{ext}`；双格式需两个扩展名。结果汇总条需能列两个路径（现有 `result-summary-path` 为单行截断，需小改支持双行）。
7. **clipboard 权限（低）**：`navigator.clipboard.readText()` 在 Electron 需上下文隔离/preload 暴露，且可能需用户手势（按钮点击已满足）。失败兜底走 toast。

---

## 10. 新增 / 复用组件清单

**复用（不新写控件形态）**
- 模态骨架：`.dialog-overlay` / `.dialog` / `.dialog-title` / `.icon-btn`（叉号 svg 同设置抽屉）。
- 焦点陷阱：`trapFocus`（栈式，与抽屉/预设弹窗同机制）。
- 控件：`.segmented`/`.segment`、`.setting-select`/`.sel-wrap`、`.switch-input`、`.tin`、`.stepper`、`.path-chip`、`.cond`、`.mlist`/`.multi-grip`、`.progress-*`、`.result-summary`、`.toast`、完成弹窗钤印 `梓`。
- 状态/反馈：`setStatus` / `setError` / `showProgress` / `showSummary` / `showCompleteDialog` / `appendSelection` / `collectMarkdowns` / `applyTemplatePreset` / `importDocxTemplate` / `runMerge`。

**新增（仅结构/CSS，不新发明控件）**
- `dialogs.css` 内追加 `.dialog--wizard`、`.wizard-head`、`.wizard-sub`、`.wizard-steps`、`.wz-step`、`.wizard-body`、`.wz-pane`、`.wizard-foot`、`.wz-cover-preview`（全部用既有令牌，无新 hex）。
- `index.html` 内新增 `#bookWizard` 模态块（结构见 §3.1）。
- 空态 `.drop-core` 内新增剪贴板直转按钮 `#pasteConvertBtn`（`btn-solid`）。
- i18n：新增约 50 个键（§8）。

**不新增**：独立 BrowserWindow、新动画体系、新钤印、新控件类型。
