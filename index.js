/**
 * dsh-time-memory —— 按时间归档、分层回忆的聊天记忆插件。
 *
 * 组成：
 * 1. 自动归档：每条真实的用户消息与助手回复按发生时间写入 jsonl 记忆库；
 * 2. 系统提示词：注入「时忆」人格、[调试] 自我输出习惯和强制记忆协议；
 * 3. memory_recall：先检索用户指认的时间段，未命中则扩大一次、再扩大一次，
 *    两次扩大后仍无结果即返回 verdict="forgot"，由人格回答「我忘记了」；
 * 4. memory_save：把值得单独记住的事件归档到某个时间点。
 *
 * 插件不导入任何 DSH 包，安装后不会因为宿主版本变化而解析失败。
 *
 * @module dsh-time-memory
 */

import { appendFileSync, readFileSync, statSync } from 'node:fs'

import { resolveConfig } from './lib/config.js'
import { MemoryStore } from './lib/store.js'
import { recallMemories } from './lib/recall.js'
import { buildCharter } from './lib/prompt.js'
import { resolveHint } from './lib/hint.js'
import { captureEvent } from './lib/capture.js'
import { renderRecallText, renderSaveText, renderUnparsedText } from './lib/format.js'

/** Loader 诊断里显示的插件名。 */
export const name = 'time-memory'
/** 依赖的服务；缺一个就不激活，而不是加载时报错。 */
export const inject = ['tools', 'systemPrompt']

/** 工具结果的宽松 schema：内容本身就是给人看的文本。 */
const OUTPUT_SCHEMA = { type: 'object' }

/**
 * 读取「基本认知」：config 里的内联文本优先，文件按 mtime 缓存。
 * 文件读不到时只告警一次，不影响聊天与记忆。
 * @param {{cognition:string, cognitionFile:string}} cfg
 * @param {(level:string, message:string) => void} report
 */
function createCognitionReader(cfg, report) {
  let cache = { file: '', mtimeMs: -1, text: '', warned: false }
  return () => {
    const parts = []
    if (cfg.cognition !== '') parts.push(cfg.cognition)
    if (cfg.cognitionFile !== '') {
      try {
        const stat = statSync(cfg.cognitionFile)
        if (cache.file !== cfg.cognitionFile || cache.mtimeMs !== stat.mtimeMs) {
          cache = {
            file: cfg.cognitionFile,
            mtimeMs: stat.mtimeMs,
            text: readFileSync(cfg.cognitionFile, 'utf8').trim(),
            warned: false,
          }
        }
        if (cache.text !== '') parts.push(cache.text)
      } catch (error) {
        if (!cache.warned) {
          cache.warned = true
          report('warn', `cognition file unreadable: ${String(error?.message ?? error)}`)
        }
      }
    }
    return parts.join('\n\n')
  }
}

function recallTool(cfg, store) {
  return {
    name: 'memory_recall',
    description: [
      '按时间从长期记忆里检索事件。',
      '用户只要提到某个时间段（上周、前天、10月20日、三个月前、昨天下午……），就必须先调用本工具，不要凭印象回答。',
      '工具自己分层：先在指认的时间段内检索；没有命中就自动扩大一次，再扩大一次。',
      '若两次扩大后仍没有记录，返回 verdict="forgot"，此时必须如实回答「我忘记了」，严禁编造或推测补全。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        time_hint: {
          type: 'string',
          description: '用户原话里的时间说法，原样传入即可，如「上周二」「三天前」「10月20日下午」「2026-10-20」。',
        },
        query: {
          type: 'string',
          description: '要找的那件事的关键词或短描述。只想知道那段时间发生了什么时可以省略。',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: '最多返回几条记忆，默认 3。',
        },
      },
      required: ['time_hint'],
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    async execute(args) {
      const hint = typeof args?.time_hint === 'string' ? args.time_hint : ''
      const resolved = resolveHint(hint, Date.now())
      if (resolved === null) {
        return {
          text: renderUnparsedText(hint === '' ? '（空）' : hint, hint === '' ? 'empty' : 'unparsed'),
          found: false,
          verdict: 'unparsed',
        }
      }
      const query = typeof args?.query === 'string' ? args.query : ''
      const limit = Number.isSafeInteger(args?.limit) ? Math.min(20, Math.max(1, args.limit)) : cfg.maxResults
      const result = recallMemories({
        records: store.all(),
        range: resolved.parsed,
        query,
        factor: cfg.expandFactor,
        maxExpansions: cfg.maxExpansions,
        limit,
        minScore: cfg.minScore,
      })
      return {
        text: renderRecallText(result, { hint, query, parsed: resolved.parsed, lineChars: cfg.lineChars }),
        found: result.found,
        verdict: result.verdict,
        level: result.level,
      }
    },
  }
}

function saveTool(cfg, store) {
  return {
    name: 'memory_save',
    description: [
      '把一件值得记住的事归档到它在现实中发生的时间点。',
      '普通对话已经自动入库，只有用户特意讲出的、以后可能被问起的事件才需要调用。',
      'happened_at 用口语时间即可（「上周二下午」「2026-10-20」）；summary 一句话；details 补充细节。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        happened_at: {
          type: 'string',
          description: '事情发生的时间，口语或 ISO 日期均可。省略表示现在。',
        },
        summary: {
          type: 'string',
          description: '一句话概括这件事，会被将来检索命中。',
        },
        details: {
          type: 'string',
          description: '补充细节：人物、地点、感受等。',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '若干关键词标签，便于以后检索。',
        },
      },
      required: ['summary'],
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    async execute(args) {
      const summary = String(args?.summary ?? '').trim()
      if (summary === '') throw new Error('memory_save 需要非空的 summary')
      const details = String(args?.details ?? '').trim()
      const now = Date.now()
      let happenedAt = now
      let parsed = null
      if (typeof args?.happened_at === 'string' && args.happened_at.trim() !== '') {
        const resolved = resolveHint(args.happened_at, now)
        if (resolved !== null) {
          parsed = resolved.parsed
          happenedAt = Math.round((resolved.parsed.start + resolved.parsed.end) / 2)
        }
      }
      const tags = Array.isArray(args?.tags) ? args.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '') : []
      const record = store.add({
        t: happenedAt,
        kind: 'note',
        text: details === '' ? summary : `${summary}\n${details}`,
        tags,
        source: 'manual',
      })
      return { text: renderSaveText(record, parsed), id: record.id, t: record.t }
    },
  }
}

/**
 * @param {any} ctx 插件上下文
 * @param {unknown} config cordis.patch.yml 中的 config
 */
export function apply(ctx, config) {
  const cfg = resolveConfig(config)
  const store = new MemoryStore({ file: cfg.dataFile, maxTextChars: cfg.maxTextChars })
  const report = (level, message) => {
    try {
      ctx.logger?.[level]?.(`[time-memory] ${message}`)
    } catch {
      // 日志失败不影响功能
    }
  }

  const readCognition = createCognitionReader(cfg, report)

  // 1) 自动归档
  if (cfg.capture) {
    ctx.on('session/event', (session, event) => {
      try {
        // 专属 bot 的会话有自己的记忆库与实例，不再写进主库
        const preset = session?.header?.agentPreset
        if (cfg.excludePresets.length > 0 && typeof preset === 'string' && cfg.excludePresets.includes(preset)) return
        captureEvent({ store, session, event })
      } catch (error) {
        report('warn', `archive failed: ${String(error?.message ?? error)}`)
      }
    })
  }

  // 2) 人格与记忆协议。文本保持静态（不含"现在/条数"），整段可命中前缀缓存；
  //    认知文件按 mtime 读取，只有用户改动文件时才会变。
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'time-memory/charter',
    order: 120,
    interpolate: false,
    text: () => buildCharter({
      persona: cfg.persona,
      includePersona: cfg.includePersona,
      cognition: readCognition(),
      includeProtocol: cfg.includeProtocol,
    }),
  }), 'time-memory: charter')

  // 2b) 靠近工具清单再提醒一次，避免长提示词里规则被淹没
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'time-memory/reminder',
    order: 980,
    interpolate: false,
    text: '[记忆工具] 用户提到任何时间段，先调用 memory_recall(time_hint=…)，不要凭印象回答；'
      + '它返回 verdict="forgot" 时只能回答「我忘记了」，不得编造。值得长期记住的事件用 memory_save 归档。',
  }), 'time-memory: reminder')

  // 3) 工具
  ctx.effect(() => ctx.tools.register(recallTool(cfg, store)), 'time-memory: memory_recall')
  ctx.effect(() => ctx.tools.register(saveTool(cfg, store)), 'time-memory: memory_save')

  report('info', `ready with ${store.stats().count} memories at ${cfg.dataFile}`)

  // 安装自检：设置 DSH_TIME_MEMORY_PROBE 指向一个文件时，激活成功后写一行回执
  if (typeof process.env.DSH_TIME_MEMORY_PROBE === 'string' && process.env.DSH_TIME_MEMORY_PROBE !== '') {
    try {
      appendFileSync(
        process.env.DSH_TIME_MEMORY_PROBE,
        `[time-memory] apply ok ${new Date().toISOString()} dataFile=${cfg.dataFile} memories=${store.stats().count}\n`,
        'utf8',
      )
    } catch {
      // 探针失败不影响插件
    }
  }
}
