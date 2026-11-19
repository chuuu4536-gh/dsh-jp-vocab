# dsh-jp-vocab · 日语生词日汇总

在 Edge 里选中日文单词查词、点星收藏；每天用一条命令，把这些词变成一份按词性分组的 Markdown 汇总。

本仓库是**三件套**，市场只能安装其中的 DSH 插件部分，另外两部分需要手动安装：

| 组件 | 位置 | 作用 | 如何安装 |
|---|---|---|---|
| DSH 插件 | 仓库根目录 | 读取当日词汇 JSONL，套模板写 Markdown 汇总 | `dsh plugin add`（可被插件市场收录） |
| Edge 扩展 | `edge-ext/` | 网页选词 → 查 dict.asia → 星标收藏 | `edge://extensions` 手动加载解压目录 |
| 本地宿主 | `native-host/` | 把星标词写进本地 JSONL | 运行 `install.ps1` 注册 |

> 只装 DSH 插件也能跑起来，但**没有数据源**——词表得由扩展收藏产生。扩展和宿主不在市场的安装范围内。

## 安装 DSH 插件

从 GitHub 安装：

```sh
dsh plugin --profile <profile> add github:chuuu4536-gh/dsh-jp-vocab
```

发布到 npm 之后也可以：

```sh
dsh plugin --profile <profile> add dsh-jp-vocab
```

装好后会注册三个工具：

| 工具 | 作用 |
|---|---|
| `jp_vocab_today` | 读取指定日期（默认今天）的词汇，返回词条与当前配置 |
| `jp_vocab_summary` | 按模板生成 `summaries/YYYY-MM-DD.md` |
| `jp_vocab_settings` | 读取/修改共享配置 |

## 安装 Edge 扩展与本地宿主

1. **注册宿主**（Windows，普通权限）：

   ```powershell
   cd native-host
   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
   ```

2. **加载扩展**：打开 `edge://extensions` → 开发者模式 → 加载解压缩的扩展 → 选择 `edge-ext/`。

3. 打开扩展选项页，确认顶部显示「本地宿主已连接」。

详细排查见 [`native-host/README.md`](native-host/README.md)。

## 使用

1. 在网页上选中日文单词 → 点「查词」；
2. 结果卡默认出现在**网页右上角**（不遮挡正文）；想让它跟着选区走，可在扩展选项页把「结果卡位置」改成「所选词旁边」；
3. 点结果卡右下角星标收藏；
4. 对 DSH 说「生成今日总结」，或直接调用 `jp_vocab_summary`；
5. 汇总写到配置的 `summariesDir`，形如 `2026-11-18.md`。

词形还原由扩展侧完成（kuromoji + 规则兜底）：选「惹かれて」会落到最原本的「惹く」，候选条可切回中间层。

## 配置

扩展设置页与 DSH 插件读**同一份**文件：`%USERPROFILE%\.jp-vocab\config.json`。

| 键 | 默认 | 说明 |
|---|---|---|
| `vocabDir` | `D:\...\vocab` | 每日词汇 JSONL 目录（宿主写） |
| `summariesDir` | `D:\...\summaries` | 汇总 Markdown 输出目录（插件写） |
| `timeZone` | `Asia/Shanghai` | 业务日期所用时区 |
| `dayStartHour` | `0` | 一天从本地几点开始（0–6），6 表示 06:00–次日 05:59 算同一天 |
| `enrichMode` | `auto` | `auto` 生成前先联网补例句/搭配；`manual` 只出草稿 |
| `overwrite` | `true` | 同名汇总文件是否覆盖 |
| `groupByPos` | `true` | 汇总按词性分组 |
| `templatePath` | 空 | 自定义模板路径，空则用内置模板 |

扩展侧另有两个**浏览器本地偏好**（存在 `chrome.storage.sync`，不进 `config.json`）：

| 偏好 | 默认 | 说明 |
|---|---|---|
| `direction` | `auto` | 词典方向：自动 / 日中 / 中日 |
| `cardPosition` | `top-right` | 结果卡位置：网页右上角 / 所选词旁边 |

> `enrichMode` 是给 agent 的执行约定：插件本身不联网，联网补全由调用它的 agent 完成。

## 模板

内置模板在 `templates/daily-summary.md`，支持 `{{date}}`、`{{count}}`、`{{#words}}…{{/words}}`，词条内可用 `{{no}}`、`{{word}}`、`{{reading}}`、`{{pitchText}}`、`{{posText}}`、`{{gloss}}`、`{{examplesText}}`、`{{context}}`、`{{url}}`、`{{note}}`，以及可选的 `{{#groupHeading}}` 分组标题。

## 开发

```sh
node --test test/            # 或逐个运行 test/*.test.mjs
```

## 许可

MIT，见 [LICENSE](LICENSE)。
