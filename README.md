# dsh-time-memory · 时忆

一个纯 Host 的 DSH 聊天记忆插件：**把聊天按发生时间存成事件，提到某个时段时先查那个时段，查不到就扩大一次、再扩大一次，两次都落空就回答「我忘记了」。**

它同时给会话装上一套「时忆」人格：回答前先输出两三行 `[调试]` 自检，把"时间锚点 → 检索层数 → 命中数 → 判定"摊开给你看。

## 行为规则

| 场景 | 行为 |
|---|---|
| 每条真实的用户消息 / 助手回复 | 按事件时间自动写入记忆库（子代理会话不记） |
| 用户提到时间段（"上周二""三天前""10月20日下午"） | 强制先调用 `memory_recall`，不允许凭印象作答 |
| 第 0 层 | 在指认的时段内检索 |
| 未命中 → 第 1 层 | 以窗口中心等比扩大（默认 ×3）后再检索 |
| 仍未命中 → 第 2 层 | 再扩大一次（×3²=9 倍） |
| 两次扩大后仍无结果 | 工具返回 `verdict="forgot"`，人格回答「我忘记了」，禁止编造 |
| 时间说法解析不出来 | 返回 `verdict="unparsed"`，提示改用 `2026-10-20` 这类明确写法重试一次 |

命中时，工具结果本身就会渲染成聊天里的一段调试日志，例如：

```
[记忆检索] 时间锚点："上周二" → 2026-10-20（周二）全天
[记忆检索] 线索：海边
[记忆检索] 第 0 层（原始时段）：2026-10-20（周二）全天 · 库内 3 条 · 命中 0 条 → 扩大
[记忆检索] 第 1 层（扩大 1 次）：2026-10-19 至 2026-10-21（3 天） · 库内 9 条 · 命中 1 条
[记忆检索] 说明：原始时段没有命中，扩大 1 次后才找到，引用时要说明大致范围。
[记忆] 2026-10-20 20:14 · 用户：我说想去海边看日出，风很大
```

## 安装

插件由 `package.json` 的 `dsh.bundle.patch` 声明，是一个标准组合包。在 Web GUI 侧边栏 **插件** 页选择安装，粘贴这个目录的绝对路径：

```
<本仓库在你机器上的绝对路径>
```

安装后默认启用，立即对当前 profile 的所有会话生效。也可以在 Creator 模式里用 `plugin_manager` 的 `install_bundle`，`target` 同上。

卸载：插件页里移除该组合包即可，记忆文件不会被删。

## 配置

写在 profile 的 `cordis.patch.yml`，覆盖 `time-memory` 这一行：

```yaml
- id: time-memory
  name: dsh-time-memory
  config:
    dataFile: 'D:\my-memories\events.jsonl'
    capture: true
    expandFactor: 3
    maxExpansions: 2
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dataFile` | `$DSH_HOME/time-memory/events.jsonl` | 记忆库文件；一条记忆一行 JSON |
| `capture` | `true` | 是否自动把对话按时间入库 |
| `expandFactor` | `3` | 每次扩大窗口的倍数（1 天 → 3 天 → 9 天） |
| `maxExpansions` | `2` | 最多扩大几次；两次后仍无命中即「忘记了」 |
| `maxResults` | `3` | 单次最多返回几条记忆（多数问题 3 条足够） |
| `minScore` | `2` | 关键词命中阈值（一个两字词=2 分） |
| `maxTextChars` | `300` | 入库时单条记忆的截断长度 |
| `lineChars` | `90` | 回显时单条记忆的截断长度，直接决定检索输出的 token |
| `persona` | 内置「时忆」人设 | 整段替换人格文本 |
| `includePersona` | `true` | 是否把人设放进 charter；预设里另有 persona 行时关掉它，避免重复 |
| `cognition` | 空 | 内联的「基本认知」文本，接在人格之后 |
| `cognitionFile` | 空 | 基本认知的 markdown 文件；按 mtime 缓存，改完下一轮就生效 |
| `excludePresets` | `[]` | 这些 agent preset 的会话不写进本实例的记忆库（QQ 专属 bot 用） |
| `includeProtocol` | `true` | 是否附带记忆协议（一般不要关） |

## token 成本

- **提示词是静态的**：人格、基本认知、协议里不含时间戳和记忆条数，整段系统提示词可以命中前缀缓存，稳态下几乎不额外计费；"现在"与"库里多少条"由 `memory_recall` 的返回值给出。
- **检索输出有上界**：默认 3 条 × 90 字，一次检索 ≈ 200 token。
- **成本与库大小无关**：1000 条还是 10000 条，单次开销一样；而"整卷记忆塞进上下文"是 O(N)，几千条就会把窗口撑爆。
- **代价**：每次检索多一轮工具调用；记忆库很小、或本来只滚最近几十条时，直接塞上下文反而更便宜。它买的是"按时间精确定位 + 不随库增长"。

## QQ 专属 bot

`qqbot/` 里是一条龙：`preset-shiyi` 模板、基本认知 `cognition.md`、安装脚本 `install.mjs`。它把 desktop profile 的 QQ 机器人变成独立记忆库、独立认知、只对主人说话的时忆。

这部分含本机绝对路径与个人化认知文件，**不在本仓库发布**（已在 `.gitignore` 里排除），只在你本地保留。

```powershell
node qqbot/install.mjs
```

改完一般会热重载；没动静就重启 DSH。细节见 [`qqbot/README.md`](qqbot/README.md)。

## 两个工具
- `memory_recall({ time_hint, query?, limit? })`：`time_hint` 支持
  今天/昨天/前天/大前天 / N 天前 / 上周三 / 上上周五 / 上个月 / 8月 / 去年 /
  昨天下午 / 刚才 / 最近三天 / `2026-10-20` / `2026-10-01~2026-10-07`，
  也可以直接传整句（"你还记得上周二我们去海边吗"），插件会自己抠时间。
- `memory_save({ happened_at?, summary, details?, tags? })`：把值得单独记住的事件归档到它发生的时间点。

## 记忆文件

默认在 `%USERPROFILE%\.dsh\time-memory\events.jsonl`，一行一条：

```json
{"v":1,"id":"m_…","t":1792500000000,"kind":"user","text":"……","session":"…","seq":42,"source":"auto","stored":1792500000123}
```

- 纯 append；损坏的行读取时跳过，不影响其它记忆。
- 同一会话的同一条事件用 `session + seq` 去重，重启或 resume 不会写重复。
- 想清空记忆：停掉插件后删除该文件即可。

## 自检与开发

激活自检（排查安装是否成功）：设置环境变量 `DSH_TIME_MEMORY_PROBE` 指向一个可写文件，插件激活成功会追加一行回执。

```powershell
$env:DSH_TIME_MEMORY_PROBE = "C:\tmp\time-memory.probe.log"
```

离线测试（不依赖 DSH，使用 Electron 自带的 Node）：

```powershell
# 在仓库根目录执行
$env:ELECTRON_RUN_AS_NODE=1; $env:TZ="Asia/Shanghai"
& "<DSH 安装目录>\DeepSeek Harness.exe" "test/run.mjs"
Get-Content test/last-run.json
```

覆盖时间解析（26 种说法）、扩大两次的边界、忘记判定、去重、损坏行容错、插件装配与两个工具的真实调用。

## 设计边界

- 不往会话日志里追加新事件类型；记忆是插件自己的派生数据，卸载不损坏会话。
- 人工归档用 `memory_save`，自动归档只记用户亲手发的内容与助手回复，不记注入上下文和工具回填。
- 子代理（`header.origin === "subagent"`）会话不入库，避免把内部推理当经历。
- 人格与协议是 profile 级提示词段，启用后对所有会话生效；只想在某个 preset 用，可把这一行放进该 preset 的 patch。

## 发布到 GitHub

仓库自带一键脚本（用 `-ExecutionPolicy Bypass` 启动，不受本机"禁止运行脚本"策略影响）：

```powershell
.\publish.cmd                                  # 私有仓库，含 qqbot/
.\publish.cmd -Visibility public -SkipQqbot    # 公开仓库，不含 qqbot/
```

装了 GitHub CLI 且 `gh auth login` 过，它会建仓库、写入 Description、打上 Topics 并推送；否则打印手动步骤，并把要粘进 About 的那句话打印出来。

想改简介：`.\publish.cmd -Visibility public -Description "你的一句话"`，或在 GitHub 仓库页右上角 About 里直接改。
