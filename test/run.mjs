/**
 * 离线测试：不依赖 DSH 宿主，直接用 Node 跑纯逻辑与插件装配。
 * 结果写入 test/last-run.json（沙箱里 stdout 管道不可用）。
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseTimeHint, expandRange, formatDate, formatClock } from '../lib/time.js'
import { tokenize, recallMemories, scoreText } from '../lib/recall.js'
import { MemoryStore } from '../lib/store.js'
import { resolveHint } from '../lib/hint.js'
import { captureEvent, messageText } from '../lib/capture.js'
import { renderRecallText } from '../lib/format.js'
import { buildCharter } from '../lib/prompt.js'
import { resolveConfig } from '../lib/config.js'
import { apply } from '../index.js'

const results = []
let failed = 0

function check(name, condition, detail) {
  if (condition) {
    results.push({ name, ok: true })
  } else {
    failed += 1
    results.push({ name, ok: false, detail })
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// 固定参照时刻：2026-10-26（周一）15:03，本地时区由 TZ 决定
const NOW = new Date(2026, 9, 26, 15, 3, 0).getTime()
const d = (ms) => formatDate(ms)
const hm = (ms) => formatClock(ms)

function parseOk(name, hint, startDate, endDate, startClock) {
  const parsed = parseTimeHint(hint, NOW)
  check(`${name} 可解析`, parsed.ok === true, JSON.stringify(parsed))
  if (!parsed.ok) return
  eq(`${name} 起始日`, d(parsed.start), startDate)
  eq(`${name} 结束日`, d(parsed.end - 1), endDate)
  if (startClock) eq(`${name} 起始时刻`, hm(parsed.start), startClock)
}

// ---- 时间解析 ----
parseOk('今天', '今天', '2026-10-26', '2026-10-26')
parseOk('昨天', '昨天', '2026-10-25', '2026-10-25')
parseOk('前天', '前天', '2026-10-24', '2026-10-24')
parseOk('大前天', '大前天', '2026-10-23', '2026-10-23')
parseOk('三天前', '三天前', '2026-10-23', '2026-10-23')
parseOk('上周二', '上周二', '2026-10-20', '2026-10-20')
parseOk('上周三', '上周三', '2026-10-21', '2026-10-21')
parseOk('上上周五', '上上周五', '2026-10-16', '2026-10-16')
parseOk('本周三', '本周三', '2026-10-28', '2026-10-28')
parseOk('周三', '周三', '2026-10-28', '2026-10-28')
parseOk('上星期', '上星期', '2026-10-19', '2026-10-25')
parseOk('上个月', '上个月', '2026-09-01', '2026-09-30')
parseOk('8月', '8月', '2026-08-01', '2026-08-31')
parseOk('10月20日', '10月20日', '2026-10-20', '2026-10-20')
parseOk('2026年9月1日', '2026年9月1日', '2026-09-01', '2026-09-01')
parseOk('去年', '去年', '2025-01-01', '2025-12-31')
parseOk('今年', '今年', '2026-01-01', '2026-12-31')
parseOk('三个月前', '三个月前', '2026-07-01', '2026-07-31')
parseOk('昨天下午', '昨天下午', '2026-10-25', '2026-10-25', '12:00')
parseOk('今天上午', '今天上午', '2026-10-26', '2026-10-26', '06:00')
parseOk('凌晨', '凌晨', '2026-10-26', '2026-10-26', '00:00')
parseOk('最近三天', '最近三天', '2026-10-24', '2026-10-26')
parseOk('区间', '2026-10-01~2026-10-07', '2026-10-01', '2026-10-07')
parseOk('区间到', '10月1日到10月7日', '2026-10-01', '2026-10-07')
parseOk('具体时刻', '2026-10-20 14:30', '2026-10-20', '2026-10-20', '14:30')

const unparsed = parseTimeHint('量子力学第二定理', NOW)
check('无法解析时返回 ok:false', unparsed.ok === false, JSON.stringify(unparsed))

// 扩大：1 天 -> 3 天 -> 9 天
const base = parseTimeHint('2026-10-20', NOW)
const w1 = expandRange(base, 3, 1)
const w2 = expandRange(base, 3, 2)
eq('扩大一次宽度', Math.round((w1.end - w1.start) / 86_400_000), 3)
eq('扩大两次宽度', Math.round((w2.end - w2.start) / 86_400_000), 9)

// ---- 线索提取 ----
const hinted = resolveHint('你还记得上周二我们去海边吗', NOW)
check('整句里抠出时间', hinted !== null && d(hinted.parsed.start) === '2026-10-20', JSON.stringify(hinted))
check('无时间句返回 null', resolveHint('今天天气不错', NOW) !== null) // "今天" 命中

// ---- 记忆库 ----
const dir = mkdtempSync(join(tmpdir(), 'time-memory-'))
const file = join(dir, 'events.jsonl')
const store = new MemoryStore({ file, maxTextChars: 100 })
const at = (iso) => new Date(iso).getTime()
store.add({ t: at('2026-10-20T20:00:00'), text: '去海边看日出，风很大', kind: 'user', session: 's1', seq: 1 })
store.add({ t: at('2026-10-23T09:00:00'), text: '加班到很晚，回家路上买了猫粮', kind: 'assistant', session: 's1', seq: 2 })
store.add({ t: at('2026-09-05T12:00:00'), text: '搬家到城西', kind: 'note', tags: ['搬家'] })
eq('库内 3 条', store.stats().count, 3)

const reopened = new MemoryStore({ file })
eq('重新读盘 3 条', reopened.stats().count, 3)
check('重复 key 去重', reopened.hasKey('s1', 1) === true)

const broken = new MemoryStore({ file: join(dir, 'broken.jsonl') })
writeFileSync(join(dir, 'broken.jsonl'), '{oops\n{"t":1,"text":"ok"}\n', 'utf8')
eq('跳过损坏行', broken.stats().count, 1)

// ---- 检索分层 ----
const records = store.all()
const recallAt = (hint, query) => recallMemories({
  records,
  range: parseTimeHint(hint, NOW),
  query,
  factor: 3,
  maxExpansions: 2,
  limit: 6,
  minScore: 2,
})

const exact = recallAt('2026-10-20', '海边')
check('原始时段命中', exact.found === true && exact.level === 0, JSON.stringify(exact.attempts))
eq('精确命中条数', exact.memories.length, 1)

const oneFlip = recallAt('2026-10-21', '海边')
check('扩大一次后命中', oneFlip.found === true && oneFlip.level === 1, JSON.stringify(oneFlip.attempts))
eq('扩大一次扫描层数', oneFlip.attempts.length, 2)

const twoFlip = recallAt('2026-10-24', '海边')
check('扩大两次后命中', twoFlip.found === true && twoFlip.level === 2, JSON.stringify(twoFlip.attempts))

const forgot = recallAt('2026-10-01', '海边')
check('两次扩大后仍无 -> 忘记', forgot.found === false && forgot.verdict === 'forgot', JSON.stringify(forgot.attempts))
eq('忘记前共扫描 3 层', forgot.attempts.length, 3)

const notMatch = recallAt('2026-10-23', '量子力学')
check('时段有记录但线索不匹配 -> 忘记', notMatch.found === false, JSON.stringify(notMatch.attempts))

const timeOnly = recallAt('2026-10-23', '')
check('只给时间也能取到记录', timeOnly.found === true && timeOnly.memories.length === 1)

check('中文二元组切词', tokenize('去海边玩').includes('海边'), JSON.stringify(tokenize('去海边玩')))
check('打分能命中模糊词', scoreText('我们去了海边看日出', tokenize('去海边玩')) >= 2)

const text = renderRecallText(oneFlip, { hint: '2026-10-21', query: '海边', parsed: parseTimeHint('2026-10-21', NOW) })
check('检索文本含调试行', text.includes('[记忆检索]') && text.includes('命中'), text)
const forgotText = renderRecallText(forgot, { hint: '2026-10-01', query: '海边', parsed: parseTimeHint('2026-10-01', NOW) })
check('忘记文本提示不要编造', forgotText.includes('我忘记了') && forgotText.includes('不要编造'), forgotText)

// ---- 归档 ----
const session = { id: 'sess-1', header: { id: 'sess-1' } }
const userEvent = {
  type: 'user/message',
  seq: 10,
  time: NOW - 60_000,
  data: { role: 'user', content: [{ type: 'text', text: '我今天买了一只猫' }], source: { kind: 'user' } },
}
const captured = captureEvent({ store, session, event: userEvent })
check('自动归档用户消息', captured !== null && captured.kind === 'user', JSON.stringify(captured))
eq('重复事件不再写', captureEvent({ store, session, event: userEvent }), null)

const injected = captureEvent({
  store,
  session,
  event: { type: 'user/message', seq: 11, time: NOW, data: { role: 'user', content: [{ type: 'text', text: '内部上下文' }], source: { kind: 'context' } } },
})
eq('注入上下文不归档', injected, null)

const assistantEvent = {
  type: 'assistant/message',
  seq: 12,
  time: NOW,
  data: { message: { role: 'assistant', content: [{ type: 'text', text: `[调试] 收到\n好，记住了。` }] } },
}
const assistantRecord = captureEvent({ store, session, event: assistantEvent })
check('自动归档助手消息', assistantRecord !== null && assistantRecord.kind === 'assistant', JSON.stringify(assistantRecord))

eq('纯工具调用不产生文本', messageText({ content: [{ type: 'tool_call' }] }), '')

// ---- 配置 ----
const cfg = resolveConfig({ expandFactor: 'x', maxExpansions: 9, dataFile: file })
eq('非法倍数回落默认', cfg.expandFactor, 3)
eq('扩大次数上限', cfg.maxExpansions, 4)
eq('自定义数据文件', cfg.dataFile, file)
eq('默认保留人格', cfg.includePersona, true)
eq('默认无基本认知', cfg.cognition, '')
eq('默认不排除任何预设', cfg.excludePresets.length, 0)
eq('默认单次返回 3 条', cfg.maxResults, 3)
eq('默认入库截断 300 字', cfg.maxTextChars, 300)
eq('默认回显行宽 90', cfg.lineChars, 90)

const cfgQQ = resolveConfig({
  includePersona: false,
  cognition: '  我在 QQ 上只用中文。  ',
  excludePresets: [' shiyi ', '', 42],
})
eq('可关闭人格段', cfgQQ.includePersona, false)
eq('基本认知去空白', cfgQQ.cognition, '我在 QQ 上只用中文。')
eq('预设过滤只留字符串', cfgQQ.excludePresets.join(','), 'shiyi')

const charterNoPersona = buildCharter({
  persona: '这段人格不该出现',
  includePersona: false,
  cognition: '用户住在城西。',
  now: '2026-10-26 15:03（周一）',
  count: 1,
  file: 'qq.jsonl',
})
check('includePersona=false 时不重复人格', !charterNoPersona.includes('这段人格不该出现'), charterNoPersona.slice(0, 60))
check('charter 带基本认知', charterNoPersona.includes('【基本认知】') && charterNoPersona.includes('用户住在城西。'), charterNoPersona.slice(0, 120))

// 提示词必须是静态的：不带时间戳/条数，否则整段前缀缓存每次失效
const charterStaticA = buildCharter({ persona: 'P', cognition: 'C' })
const charterStaticB = buildCharter({ persona: 'P', cognition: 'C' })
check('提示词文本恒定（利于前缀缓存）', charterStaticA === charterStaticB, charterStaticA.slice(0, 60))
check('提示词不含时间戳', !/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(charterStaticA), charterStaticA.slice(0, 80))
check('提示词不含记忆条数', !/记忆库：\d+ 条/.test(charterStaticA), charterStaticA.slice(0, 80))

// ---- 插件装配（假 ctx）----
function makeFakeCtx() {
  const registrations = { sections: [], tools: [], handlers: [], effects: 0, disposed: 0 }
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    on(event, handler) {
      registrations.handlers.push({ event, handler })
      return () => { registrations.disposed += 1 }
    },
    effect(fn) {
      registrations.effects += 1
      const dispose = fn()
      return () => { registrations.disposed += 1; if (typeof dispose === 'function') dispose() }
    },
    systemPrompt: {
      section(section) {
        registrations.sections.push(section)
        return () => {}
      },
    },
    tools: {
      register(tool) {
        registrations.tools.push(tool)
        return () => {}
      },
    },
  }
  return { ctx, registrations }
}

const pluginDir = mkdtempSync(join(tmpdir(), 'time-memory-plugin-'))
const { ctx: fakeCtx, registrations } = makeFakeCtx()
apply(fakeCtx, {
  dataFile: join(pluginDir, 'events.jsonl'),
  excludePresets: ['shiyi'],
  cognition: '我在 QQ 上只用中文。',
})
eq('注册了两个提示词段', registrations.sections.length, 2)
eq('注册了两个工具', registrations.tools.length, 2)
eq('注册了 session/event 监听', registrations.handlers.length, 1)

const charterSection = registrations.sections.find((section) => section.name === 'time-memory/charter')
check('找到人格段', charterSection !== undefined, registrations.sections.map((s) => s.name).join(','))

const charter = charterSection.text()
check('提示词含人格名', charter.includes('时忆'), charter.slice(0, 80))
check('提示词含忘记规则', charter.includes('我忘记了'), 'missing forgot rule')
check('提示词含记忆协议', charter.includes('memory_recall'), 'missing recall rule')
check('提示词含基本认知', charter.includes('我在 QQ 上只用中文。'), 'missing cognition')

const handler = registrations.handlers[0].handler
handler(session, userEvent)
const memoryFile = join(pluginDir, 'events.jsonl')
const afterUser = readFileSync(memoryFile, 'utf8')

// 被 excludePresets 命中的会话（专属 QQ bot）不写主库
handler(
  { id: 'qq-1', header: { id: 'qq-1', agentPreset: 'shiyi' } },
  { type: 'user/message', seq: 20, time: NOW, data: { role: 'user', content: [{ type: 'text', text: '这条不该进主库' }], source: { kind: 'user' } } },
)
eq('excludePresets 跳过专属会话', readFileSync(memoryFile, 'utf8'), afterUser)
check('主库没有专属会话的消息', !readFileSync(memoryFile, 'utf8').includes('这条不该进主库'))

// 认知文件按 mtime 读取
const cognitionFile = join(pluginDir, 'cognition.md')
writeFileSync(cognitionFile, '# 认知\n我认识用户。\n', 'utf8')
const second = makeFakeCtx()
apply(second.ctx, { dataFile: join(pluginDir, 'qq-events.jsonl'), cognitionFile, excludePresets: ['shiyi'] })
const secondCharter = second.registrations.sections.find((section) => section.name === 'time-memory/charter').text()
check('认知文件被注入', secondCharter.includes('我认识用户。'), secondCharter.slice(0, 120))
const recallTool = registrations.tools.find((tool) => tool.name === 'memory_recall')
const saveTool = registrations.tools.find((tool) => tool.name === 'memory_save')
check('工具名正确', recallTool !== undefined && saveTool !== undefined, registrations.tools.map((t) => t.name).join(','))

const toolResult = await recallTool.execute({ time_hint: '最近三天', query: '猫' })
check('工具内检索命中', toolResult.found === true, JSON.stringify(toolResult))
check('工具输出有调试行', toolResult.text.includes('[记忆检索]'), toolResult.text)

const toolForgot = await recallTool.execute({ time_hint: '最近三天', query: '量子力学' })
check('工具内判定忘记', toolForgot.verdict === 'forgot', JSON.stringify(toolForgot))

const toolUnparsed = await recallTool.execute({ time_hint: '很难说的那个时刻' })
check('工具内解析失败可提示', toolUnparsed.verdict === 'unparsed', JSON.stringify(toolUnparsed))

const saved = await saveTool.execute({ happened_at: '上周二', summary: '和用户在讨论记忆插件' })
check('归档工具落库', saved.id !== undefined && saved.text.includes('[记忆已归档]'), JSON.stringify(saved))
const afterSave = await recallTool.execute({ time_hint: '上周二', query: '记忆插件' })
check('刚归档的能立刻检索到', afterSave.found === true, JSON.stringify(afterSave))

// 工具输出 schema 必须是可序列化的普通对象
for (const [label, value] of [['recall', toolResult], ['save', saved]]) {
  let json = ''
  try {
    json = JSON.stringify(value)
  } catch (error) {
    json = String(error)
  }
  check(`${label} 结果可 JSON 序列化`, json.length > 0 && !json.includes('Error'))
}

// 清理
try {
  rmSync(dir, { recursive: true, force: true })
  rmSync(pluginDir, { recursive: true, force: true })
} catch {}

const summary = {
  passed: results.filter((r) => r.ok).length,
  failed,
  failures: results.filter((r) => !r.ok),
  at: new Date().toISOString(),
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  node: process.version,
}
writeFileSync(new URL('./last-run.json', import.meta.url), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
if (failed > 0) process.exitCode = 1
