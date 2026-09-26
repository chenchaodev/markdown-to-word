# docs/ 文档索引

markdown-to-word:Markdown 转 Word / PDF 的 Windows 桌面应用。本目录存跨会话需要保留的结论、决策与手册;本文件只做**索引与容量约定**,不承载内容。

## 阅读路径（按场景）

- 第一次用这个软件 → [`USER-GUIDE.md`](USER-GUIDE.md)（安装 / 操作 / 设置 / FAQ）
- 接开发任务、不知从哪下手 → [`DEV-GUIDE.md`](DEV-GUIDE.md)（环境 / 命令 / 代码地图 / 验证基线）
- 想知道现在做到哪、接下来做什么 → [`STATUS.md`](STATUS.md)
- 想提新需求、或看已排期与「不做」项 → [`ROADMAP.md`](ROADMAP.md)「候选区」（**需求唯一入口**）
- 交付前跑实测、看还剩哪些没验 → [`ACCEPTANCE.md`](ACCEPTANCE.md)
- 追问「为什么这么设计」 → [`ADR.md`](ADR.md)（决策）/ [`RESEARCH.md`](RESEARCH.md)（库与技术事实、踩坑）
- 要改界面或设置面板 → [`design/ui-guidelines.md`](design/ui-guidelines.md)（renderer 权威）+ [`design/settings-ia.md`](design/settings-ia.md)
- Word / WPS 打开产物有问题 → [`WPS-COMPAT.md`](WPS-COMPAT.md)
- 查安装包签名状态 → [`SIGNATURE-STATUS.md`](SIGNATURE-STATUS.md)
- 大型重构进行中 → `campaigns/`（阶段细节只写在那里,常驻层只留一行指针）

## 目录结构（三层）

| 层 | 内容 | 生命周期 |
|---|---|---|
| **常驻** | 下表登记的文档 + `design/` + `images/` + `index.html` | 跨迭代长期有效 |
| **campaign** | `campaigns/<工作项ID>-<说明>/`（仅大型重构） | 一次性,全部阶段关闭后按归档五步升格并删除 |
| **归档** | `archive/`（调研 / 评审原文、已关闭 campaign 原文） | 只增不改 |

> 大型重构期间**阶段细节一律不进常驻层**,只写一行指针 → 全局配置目录 @CAMPAIGN-GUIDE.md。

## 文档登记

| 文档 | 受众 | 用途 | 更新时机 |
|---|---|---|---|
| `README.md` | 双 | 本文件:索引 + 容量契约 | 新增/删除文档、容量上限变动 |
| `STATUS.md` | 开发 | 仪表盘:当前项 / 门禁 / 阻塞 / 更新时间 | 模式 1、2 收尾(模式 3 不写) |
| `ROADMAP.md` | 开发 | 需求唯一入口:候选区 + 已排期 + 编号台账 | 需求登记/确认、批次完成 |
| `ACCEPTANCE.md` | 双 | 覆盖矩阵(`A-0NN` 为稳定锚点)+ 人工待测 | 规划建项;实测通过即移入 CHANGELOG |
| `ADR.md` | 开发 | 架构决策(追加式,`ADR-0NN`) | 做架构决策;campaign 归档升格 |
| `RESEARCH.md` | 开发 | 库/技术事实、坑、调研结论(追加式) | 得到终态事实或自踩坑;归档升格 |
| `CHANGELOG.md` | 双 | 面向用户的发布历史 | 发版时按发布纪律整体重写(平时不写) |
| `DEV-GUIDE.md` | 开发 | 环境 / 命令 / 代码地图 / 验证基线 | 环境、命令、基线变化时 |
| `USER-GUIDE.md` | 用户 | 终端用户使用说明 | 功能或设置变化时 |
| `WPS-COMPAT.md` | 用户 | Word/WPS 兼容矩阵与图片取值边界 | 兼容性实测结论变化时 |
| `SIGNATURE-STATUS.md` | 双 | 安装包签名状态的声明侧单源 | 签名状态有意变更时(与核对脚本常量同批) |
| `design/ui-guidelines.md` | 开发 | UI 视觉规范(renderer 权威) | UI 视觉变更时 |
| `design/settings-ia.md` | 开发 | 设置信息架构;**预设作用域口径单源**(§1.5) | 设置重组时 |
| `index.html` | 用户 | GitHub Pages 单页门面 | 与根 README 的特性文案同批同步 |
| `images/` | 用户 | README 与单页门面引用的图片 | 截图更新时 |
| `campaigns/` | 开发 | 大型重构的阶段细节活载体 | 阶段收尾;全部阶段关闭后删除 |
| `archive/README.md` | 开发 | 归档层说明(**不登记目录内具体文件**) | 归档约定变化时 |

## 容量契约（字符制,按码点计）

> 核对用 node(`[...fs.readFileSync(f,'utf8')].length`);**不要用 `wc -m`**(中文虚高约 2 倍)。
> **豁免 ≠ 无门禁**:标「不设上限(豁免)」的行须在容量核对中**显式列为有意豁免**,不得靠「解析不到即跳过」实现。

| 文件 | 字符上限 | 超限动作 |
|---|---|---|
| `STATUS.md` | **1,200** | 压缩;历史进 CHANGELOG(每会话入口,应最紧) |
| `ACCEPTANCE.md` | **6,000** | 按功能域**折叠**行,**不删行** |
| `ROADMAP.md` 单元格 | **200** | 拆行或改写指针 |
| `RESEARCH.md` | **40,000** | 分二级标题 |
| `ADR.md` | **8,000** | 加索引表;更早的拆 `adr/` |
| `CHANGELOG.md` | 不设上限(豁免) | 唯一以**发版次数**决定长度的文档,压缩它等于删除用户可见的发布记录;**豁免须在容量核对门禁里显式登记为有意豁免项**,不得靠「未登记即跳过」实现 |
| `DEV-GUIDE.md` / `USER-GUIDE.md` | **12,000** | 拆 `<主题>.md`,索引留本文件 |
| 引用跨文档路径 | —— | 可点链接 + 相对路径(形式要求,不可用字符量) |
| `README.md`(本文件) | **5,000** | 「阅读路径」压成指向各文档头部的一句话 |

`campaigns/<工作项ID>-<说明>/` 内文件的容量由该 campaign 自述与全局配置目录 @CAMPAIGN-GUIDE.md 承担(计划项过多即拆节),不进本表。

## 维护约定

- 交叉引用须**可点且存在**,不写裸反引号路径;规划编号(`REQ-0NN` / `REF-0NN` / `#NN` / 阶段号)不进交付物正文,唯一例外是 commit message 尾部的工作项标记。
- 累积型文件(ADR / RESEARCH / CHANGELOG)一律**追加式**:新条目在上,同主题更新旧条目并置顶;读到已失效结论即删除该条目,被推翻的旧决策首行标「已被 <时间戳> 条目取代」并保留。
- 条目格式与置顶/升序纪律 → 全局配置目录 @AGENTS.md「落盘格式」节。
- 同一事实只留一处真源,其余位置写指针;新增文档登记行时同批更新上面的容量表。
