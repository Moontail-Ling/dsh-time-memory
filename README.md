# 时忆 · dsh-time-memory

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522.19-informational.svg)](package.json)
[![dsh](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4f7cff.svg)](#)

给 DeepSeek Harness 的聊天记忆插件：**把对话按发生时间存成事件，提到某段时间时先查那段，没命中就扩大一次、再扩大一次，两次都落空就回「我忘记了」——不编造、不推测。**

同时给会话装上一套「时忆」人格：回答前先输出两三行 `[调试]` 自检，把「时间锚点 → 检索层数 → 命中数 → 判定」摊开给你看。

```
[记忆检索] 时间锚点："上周二" → 2026-10-20（周二）全天
[记忆检索] 线索：海边
[记忆检索] 第 0 层（原始时段）：2026-10-20（周二）全天 · 库内 3 条 · 命中 0 条 → 扩大
[记忆检索] 第 1 层（扩大 1 次）：2026-10-19 至 2026-10-21（3 天） · 库内 9 条 · 命中 1 条
[记忆检索] 说明：原始时段没有命中，扩大 1 次后才找到，引用时要说明大致范围。
[记忆] 2026-10-20 20:14 · 用户：我说想去海边看日出，风很大
```

## 目录

- [为什么需要它](#为什么需要它)
- [检索流程](#检索流程)
- [安装](#安装)
- [使用](#使用)
- [配置](#配置)
- [token 成本](#token-成本)
- [记忆文件](#记忆文件)
- [开发与测试](#开发与测试)
- [项目结构](#项目结构)
- [已知限制](#已知限制)

## 为什么需要它

模型的上下文没有「长期记忆」。常见的替代做法是把历史全塞进 prompt，代价是 token 随对话线性增长，几千条之后直接撑爆窗口；另一种是让模型自己「回想」，结果就是编造细节。

这个插件换了一条路：**记忆存在磁盘上，只有被点名的那一段时间才会进上下文。**

三条规则，全部由代码保证，不靠模型自觉：

1. **按时间存** —— 每条真实的用户消息与助手回复，按事件时间写进 jsonl；
2. **按时间查** —— 用户提到时间段，强制先调 `memory_recall`；
3. **查不到就说忘了** —— 两次扩大仍无结果，「我忘记了」是唯一允许的回答。

## 检索流程

| 层 | 窗口 | 结果 |
|---|---|---|
| 第 0 层 | 用户指认的时段（"上周二" = 10-20 全天） | 命中即返回 |
| 第 1 层 | 以窗口中心等比扩大 ×3（1 天 → 3 天） | 命中即返回，并标注"扩大 1 次" |
| 第 2 层 | 再 ×3（→ 9 天） | 命中即返回 |
| 两次扩大后仍空 | — | 返回 `verdict="forgot"`，人格只能回答「我忘记了」 |
| 时间说法解析不了 | — | 返回 `verdict="unparsed"`，提示改用 `2026-10-20` 这类写法重试一次 |

`time_hint` 认这些说法（共 26 种，含区间与时间点）：

- 相对：今天 / 昨天 / 前天 / 大前天 / 三天前 / 上个月 / 三个月前 / 去年
- 周历：上周三 / 上上周五 / 本周五 / 周三 / 上星期 / 8月
- 时段：昨天下午 / 今天上午 / 凌晨 / 晚上
- 绝对：`2026-10-20`、`2026-10-20 14:30`、`2026-10-01~2026-10-07`
- 整句也行：`你还记得上周二我们去海边吗` —— 插件自己抠时间

命中与否都用关键词打分（中文按二元组切词），不是语义向量检索，见[已知限制](#已知限制)。

## 安装

要求：DeepSeek Harness（Desktop 或源码 checkout）已能正常使用。Node.js 只在跑测试时需要（≥ 22.19）。

```bash
git clone https://github.com/Moontail-Ling/dsh-time-memory.git
```

然后在 DSH 的 Web GUI 里：

1. 侧边栏 **插件** 页 → 安装；
2. 粘贴克隆下来的**绝对路径**，例如 `D:\code\dsh-time-memory`；
3. 确认，插件默认启用。

装完即对当前 profile 的所有会话生效（启用 HMR 时热加载，否则重启 DSH）。也可以在 Creator 模式下用 `plugin_manager` 的 `install_bundle`，`target` 填同一个路径。

**卸载**：插件页里移除该组合包即可，记忆文件不会被删。

## 使用

装好之后不需要额外操作，正常聊天即可。两件事会自动发生：

- 说起某段时间，模型先调 `memory_recall`，把命中结果作为「记忆」贴进上下文；
- 你讲到值得单独记的事，模型可以调 `memory_save` 把它钉在那一天。

两个工具（也可被 PTC 代码直接调用）：

| 工具 | 参数 | 作用 |
|---|---|---|
| `memory_recall` | `time_hint`（必填）、`query`、`limit` | 按时间段 + 关键词检索，自带三层扩大与忘记判定 |
| `memory_save` | `summary`（必填）、`happened_at`、`details`、`tags` | 手工归档一条事件到指定时间点 |

## 配置

写在 profile 的 `cordis.patch.yml`，覆盖 `time-memory` 这一行：

```yaml
- id: time-memory
  name: dsh-time-memory
  config:
    dataFile: 'D:\my-memories\events.jsonl'
    expandFactor: 3
    maxExpansions: 2
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dataFile` | `$DSH_HOME/time-memory/events.jsonl` | 记忆库文件，一条记忆一行 JSON |
| `capture` | `true` | 是否自动把对话按时间入库 |
| `expandFactor` | `3` | 每次扩大窗口的倍数（1 天 → 3 天 → 9 天） |
| `maxExpansions` | `2` | 最多扩大几次；两次后仍无命中即「忘记了」 |
| `maxResults` | `3` | 单次最多返回几条记忆 |
| `minScore` | `2` | 关键词命中阈值（一个两字词 = 2 分） |
| `maxTextChars` | `300` | 入库时单条记忆的截断长度 |
| `lineChars` | `90` | 回显时单条记忆的截断长度，直接决定检索输出的 token |
| `persona` | 内置「时忆」人设 | 整段替换人格文本 |
| `includePersona` | `true` | 是否把人设放进 charter；preset 里另有人格时关掉，避免重复 |
| `cognition` | 空 | 内联的「基本认知」文本，接在人格之后 |
| `cognitionFile` | 空 | 基本认知的 markdown 文件，按 mtime 缓存，改完下一轮生效 |
| `excludePresets` | `[]` | 这些 agent preset 的会话不写进本实例的记忆库 |
| `includeProtocol` | `true` | 是否附带记忆协议（一般不要关） |

## token 成本

- **提示词是静态的**：人格、认知、协议里不含时间戳和记忆条数，整段系统提示词可以命中前缀缓存，稳态下几乎不额外计费；「现在几点」「库里多少条」由 `memory_recall` 的返回值给出。
- **检索输出有上界**：默认 3 条 × 90 字，一次检索约 200 token。
- **成本与库大小无关**：1000 条还是 10000 条，单次开销一样；"整卷记忆塞进上下文"则是 O(N)。
- **代价**：每次检索多一轮工具调用。记忆库很小、或本来只滚最近几十条时，直接塞上下文反而更便宜 —— 它买的是"按时间精确定位 + 不随库增长"。

## 记忆文件

默认在 `%USERPROFILE%\.dsh\time-memory\events.jsonl`（`$DSH_HOME` 未设置时），一行一条：

```json
{"v":1,"id":"m_…","t":1792500000000,"kind":"user","text":"……","session":"…","seq":42,"source":"auto","stored":1792500000123}
```

- 纯 append；损坏的行读取时跳过，不影响其它记忆。
- 同一会话的同一条事件用 `session + seq` 去重，重启或 resume 不会重复写入。
- 清空记忆：停掉插件后删除该文件即可。

## 开发与测试

测试不依赖 DSH，只用到 Node 内置模块：

```bash
node test/run.mjs        # 结果写入 test/last-run.json，失败时退出码非 0
```

覆盖时间解析（26 种说法）、扩大两次的边界、忘记判定、去重、损坏行容错、插件装配，以及两个工具的真实调用。没有 Node 时也可以用 DSH Desktop 自带的 Electron 运行时：

```powershell
$env:ELECTRON_RUN_AS_NODE=1; $env:TZ="Asia/Shanghai"
& "<DSH 安装目录>\DeepSeek Harness.exe" "test/run.mjs"
```

激活自检（排查安装是否成功）：把 `DSH_TIME_MEMORY_PROBE` 指向一个可写文件，插件激活成功会追加一行回执。

```powershell
$env:DSH_TIME_MEMORY_PROBE = "C:\tmp\time-memory.probe.log"
```

## 项目结构

```
index.js             插件入口：注册提示词段、两个工具、session/event 监听
lib/time.js          时间说法 → 半开区间；窗口扩大与格式化
lib/hint.js          从整句里抠时间片段
lib/recall.js        分词、打分、三层检索
lib/store.js         JSONL 记忆库（append、去重、坏行容错）
lib/capture.js       把 session 事件归档成记忆
lib/format.js        工具结果渲染（也就是聊天里看到的 [调试] 输出）
lib/prompt.js        人格与记忆协议文本（静态，便于前缀缓存）
lib/config.js        配置解析与默认值
test/run.mjs         离线测试
publish.cmd/.ps1     作者自用的一键发布脚本，与插件运行无关
```

插件不导入任何 DSH 包，只依赖 Node 内置模块，因此宿主升级不会带来解析失败。

## 已知限制

- **人格是 profile 级的**：启用后对该 profile 下所有会话生效。只想在某类会话用，把 `time-memory` 那一行放进对应 agent preset 的 patch。
- **检索是「时间窗 + 关键词」**，不是语义向量检索：换个说法（"看海" vs "海边"）可能命中，也可能不中；扩大窗口能兜住时间上的偏差，兜不住词义上的偏差。
- **只归档用户与助手文本**，不记工具调用与注入上下文；子代理会话不入库。
- **中文时间解析覆盖常见说法**，生僻表达会返回 `unparsed` 并提示改用明确日期。
- **本仓库不含 QQ 桥接层**：那份配置带本机路径与个人化认知，留在作者本地。

## License

[MIT](LICENSE)
