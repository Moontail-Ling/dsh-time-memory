/**
 * 工具结果的可读渲染。这些文本会直接进入聊天记录，
 * 也就是用户看到的"自我调试输出"。
 */

import { describeRange, formatDateTime } from './time.js'

const MAX_LINE = 160

function clip(text, max = MAX_LINE) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function attemptLine(attempt) {
  const window = describeRange(attempt.start, attempt.end, '')
  const label = attempt.level === 0 ? '第 0 层（原始时段）' : `第 ${attempt.level} 层（扩大 ${attempt.level} 次）`
  const verdict = attempt.hits > 0 ? `命中 ${attempt.hits} 条` : '命中 0 条 → 扩大'
  return `[记忆检索] ${label}：${window} · 库内 ${attempt.scanned} 条 · ${verdict}`
}

/**
 * 检索工具的输出文本。
 * @param {object} result recallMemories 的返回值
 * @param {{hint:string, query?:string, parsed?:object, lineChars?:number}} meta
 */
export function renderRecallText(result, meta) {
  const lineChars = Number.isFinite(meta.lineChars) ? meta.lineChars : MAX_LINE
  const lines = []
  const anchor = meta.parsed ? `"${meta.hint}" → ${meta.parsed.label}` : `"${meta.hint}"`
  lines.push(`[记忆检索] 时间锚点：${anchor}`)
  if (meta.query) lines.push(`[记忆检索] 线索：${clip(meta.query, 80)}`)
  for (const attempt of result.attempts) lines.push(attemptLine(attempt))

  if (!result.found) {
    lines.push('[记忆检索] 判定：忘记了 —— 两次扩大后仍没有这段时间的记录。')
    lines.push('[记忆检索] 请如实回答「我忘记了」，不要编造细节，也不要用推测补全。')
    return lines.join('\n')
  }

  if (result.level > 0) {
    lines.push(`[记忆检索] 说明：原始时段没有命中，扩大 ${result.level} 次后才找到，引用时要说明大致范围。`)
  }
  for (const memory of result.memories) {
    const who = memory.kind === 'user' ? '用户' : memory.kind === 'assistant' ? '你' : '记录'
    const tags = Array.isArray(memory.tags) && memory.tags.length > 0 ? ` #${memory.tags.join(' #')}` : ''
    lines.push(`[记忆] ${formatDateTime(memory.t)} · ${who}${tags}：${clip(memory.text, lineChars)}`)
  }
  return lines.join('\n')
}

/** 归档工具的输出文本。 */
export function renderSaveText(record, parsed) {
  const when = parsed?.ok ? parsed.label : formatDateTime(record.t)
  const tags = Array.isArray(record.tags) && record.tags.length > 0 ? ` · 标签：${record.tags.join('、')}` : ''
  return [
    `[记忆已归档] ${when} · ${record.kind}${tags}`,
    clip(record.text, 400),
  ].join('\n')
}

/** 时间说法解析失败时的输出。 */
export function renderUnparsedText(hint, reason) {
  const why = reason === 'empty' ? '没有给出时间' : '无法解析'
  return [
    `[记忆检索] ${why}："${clip(hint, 60)}"`,
    '[记忆检索] 请把时间换成明确说法（如「上周二」「三天前」「2026-10-20」「昨天下午」）后重试一次。',
  ].join('\n')
}
