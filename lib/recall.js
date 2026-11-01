/**
 * 分层记忆检索：先在用户说的那个时间段里找，找不到就等比扩大一次、再扩大一次。
 * 两次扩大后仍无命中，判定为「忘记了」。
 */

import { expandRange } from './time.js'

const SPLIT = /[\s，,。、；;：:？！!?~～\-—–()（）[\]【】"'“”‘’…·]+/
const CJK = /[\u3400-\u9fff]/

/**
 * 把查询拆成词与中文二元组；中文没有空格，二元组是最便宜的模糊匹配。
 * @param {string} query
 * @returns {string[]}
 */
export function tokenize(query) {
  const normalized = String(query ?? '').trim().toLowerCase()
  if (normalized === '') return []
  const tokens = new Set()
  for (const part of normalized.split(SPLIT)) {
    const piece = part.trim()
    if (piece === '') continue
    tokens.add(piece)
    if (CJK.test(piece) && piece.length > 2) {
      for (let i = 0; i < piece.length - 1; i += 1) tokens.add(piece.slice(i, i + 2))
    }
  }
  return [...tokens]
}

function haystackOf(record) {
  const tags = Array.isArray(record.tags) ? record.tags.join(' ') : ''
  return `${record.text ?? ''} ${tags}`.toLowerCase()
}

/**
 * 给一条记忆打分：命中一个 2 字以上的词得 2 分，单字得 1 分。
 * @param {string} haystack
 * @param {string[]} tokens
 */
export function scoreText(haystack, tokens) {
  let score = 0
  for (const token of tokens) {
    if (token === '') continue
    if (haystack.includes(token)) score += token.length >= 2 ? 2 : 1
  }
  return score
}

/**
 * 在给定窗口内排名。
 * @returns {Array<{record: object, score: number}>}
 */
function rank(records, tokens) {
  return records
    .map((record) => ({ record, score: scoreText(haystackOf(record), tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.record.t - a.record.t)
}

/**
 * 分层检索。
 * @param {object} options
 * @param {Array<object>} options.records 全部记忆
 * @param {{start:number,end:number}} options.range 用户指认的时间段
 * @param {string} [options.query] 要找的"某事"关键词
 * @param {number} [options.factor] 每次扩大的倍数
 * @param {number} [options.maxExpansions] 最多扩大几次（默认 2）
 * @param {number} [options.limit] 最多返回几条
 * @param {number} [options.minScore] 命中阈值
 */
export function recallMemories(options) {
  const {
    records,
    range,
    query = '',
    factor = 3,
    maxExpansions = 2,
    limit = 6,
    minScore = 2,
  } = options
  const tokens = tokenize(query)
  // 全是单字时降低门槛，否则两字以上的词至少要命中一个
  const effectiveMin = tokens.length === 0 ? 0 : tokens.every((token) => token.length < 2) ? 1 : minScore
  const center = (range.start + range.end) / 2
  const attempts = []
  let widest = { start: range.start, end: range.end }

  for (let level = 0; level <= maxExpansions; level += 1) {
    const window = level === 0 ? { start: range.start, end: range.end } : expandRange(range, factor, level)
    widest = window
    const inWindow = records.filter((r) => r.t >= window.start && r.t < window.end)
    let hits
    if (tokens.length === 0) {
      // 只给时间、不给线索：把该时段的事件按时间倒序全部当作命中
      hits = inWindow
        .slice()
        .sort((a, b) => b.t - a.t)
        .slice(0, limit)
        .map((record) => ({ record, score: 1 }))
    } else {
      hits = rank(inWindow, tokens)
        .filter((entry) => entry.score >= effectiveMin)
        .slice(0, limit)
    }
    attempts.push({
      level,
      start: window.start,
      end: window.end,
      scanned: inWindow.length,
      hits: hits.length,
      matched: tokens.length > 0,
    })
    if (hits.length > 0) {
      return {
        found: true,
        level,
        expansions: level,
        verdict: level === 0 ? 'exact' : 'expanded',
        window,
        attempts,
        memories: hits.map((entry) => ({ ...entry.record, score: entry.score })),
        scanned: inWindow.length,
      }
    }
  }

  return {
    found: false,
    level: maxExpansions,
    expansions: maxExpansions,
    verdict: 'forgot',
    window: widest,
    attempts,
    memories: [],
    scanned: records.filter((r) => r.t >= widest.start && r.t < widest.end).length,
  }
}
