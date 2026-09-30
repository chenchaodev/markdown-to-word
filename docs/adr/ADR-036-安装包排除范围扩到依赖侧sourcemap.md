# ADR-036 · 安装包排除范围扩到依赖侧 sourcemap

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-09-30 |
| 取代 | 无 |
| 关联 | [ADR-035](ADR-035-安装包不含sourcemap.md) |

## 决定

[ADR-035](ADR-035-安装包不含sourcemap.md) 定的排除范围（**仅 `dist/**/*.js.map`**）扩到**全包**：追加一条覆盖 `node_modules/**/*.map` 的负向 glob，asar 门禁的禁止项断言同步从「只筛 `dist/` 前缀」放宽为全包筛选。

[ADR-035](ADR-035-安装包不含sourcemap.md) 的其余裁决**继续现行**，本条不动：① `tsconfig.json` 的 `sourceMap: true` 保持开启（覆盖率门禁的测量依据）；② `dist/` 目录本身仍产出 `.js.map`，排除只发生在「打进安装包」这一层；③ 线上崩溃栈还原若成需求，另立受控上传流程而非把 `.js.map` 放回包内。

## 背景

[ADR-035](ADR-035-安装包不含sourcemap.md) 落地后实测真实产物发现：它只挡了 `.map` 总量的 10%。现存包 `.map` 共 1316 个 —— `dist/` 侧 132（已被挡住，重打后实测为 0），`node_modules/` 侧 **1184**，大头是 `pdf-lib` 560、`mermaid` 276、`@mermaid-js/parser` 96、`mdast-util-to-markdown` 48、`micromark-core-commonmark` 46、`entities` 32。也就是说依赖随包分发的调试残留才是主体，原范围等于只清了十分之一。

放宽前先做了运行时安全性实测（结论：**无需任何白名单**）：

- 7 个大头依赖包内 `'.map'` 字面量与 `require`/`import` 该后缀的用法**全部零命中**；`sourceMappingURL` 只出现在行尾注释里。
- 全仓无 `source-map-support` / `Error.prepareStackTrace` / `--enable-source-maps`；lockfile 里的 `source-map-support@0.5.21` 是 **dev-only** 传递依赖，宿主是 electron-builder 自己的 `builder-util`，只在打包期用，不进产物运行时。
- 产物的行尾 `//# sourceMappingURL=…` 注释在 `.map` 被排除后会指向不存在的文件，但 V8 与 Electron 都不会自动解析它，只有 devtools 会，而 devtools 未开。它是纯注释。

排除顺序依赖 electron-builder 的 `FileMatcher`：它只把 `config.files` 里以 `!` 开头的模式收进 node_modules 匹配器，靠「正向+负向全量保序列表」过 `minimatchAll`，因此负向必须排在收录它的正向项之后。已实证两条负向（`highlight.js/styles/**` 与 `*.map`）叠加后互不干扰。

## 备选方案

| 方案 | 不选的理由 |
|---|---|
| 维持只挡 `dist/` 侧 | 留下 90% 的量，且它们恰恰是最不像「本仓源码」因而最没必要随包分发的部分 |
| 对每个依赖包逐个开白名单 | 实测无一个包运行时读 `.map`，白名单是为不存在的问题付维护成本 |
| 连带关掉依赖的 `sourceMap` 产出 | 依赖的构建配置不由本仓控制，且它们本就不参与本仓覆盖率测量 |
| 改用「解包后删文件」 | 等于在产物上做二次加工，破坏 electron-builder 的可重现性 |

## 后果

- 安装包体积进一步下降（本条排除的量级是 [ADR-035](ADR-035-安装包不含sourcemap.md) 的十倍量级；具体数字以打包后实测为准，不写进文档）。
- 禁止项断言的语义变了：现在 `.map` 在包内任何位置都是违规，包括 `node_modules/`。断言常量随之改名（原名限定了 dist，已不副实）。
- 「包内多余」检查对 `.map` 让位：dist 清单本就收录 `.map`，陈旧 `.map` 会同时命中禁止项与多余检查，同一文件刷两遍会被误读成两个问题，故排除类条目一律不判多余。
- **已知边界**：该断言只解析 asar 头，`resources/app.asar.unpacked/` 里解包的文件（native 模块）不在覆盖范围。当前那里没有 `.map`，若日后出现需另行处理。
- 排除规则要等下一次完整打包才进包；`scripts/pack-size` 的体积基线需在那之后重取，否则会与新包体积失配。
