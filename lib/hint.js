/**
 * 从用户原话里抠出时间片段。
 *
 * 模型经常把整句丢进来（"你还记得上周二我们去海边吗"），
 * 先整体解析，失败再按已知的时间词形态扫描一遍。
 */

import { parseTimeHint } from './time.js'

const CANDIDATES = [
  /\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*[日号]?(?:\s*\d{1,2}:\d{2})?/,
  /(?:上上|上|这|本|下|下下)?个?(?:周|星期|礼拜)[一二三四五六日天]?/,
  /(?:上上|上|这|本|下|下下)个?月/,
  /(?:去年|今年|前年|今天|今日|昨天|昨日|前天|大前天|明天|后天|刚才|刚刚|方才|前几天|这几天|这阵子|最近)/,
  /(?:\d+|[一二三四五六七八九十两]+)\s*(?:天|日|周|个?星期|个?礼拜|个?月)前/,
  /\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/,
]

/**
 * @param {string} text 用户原话或模型给的时间说法
 * @param {number} [now]
 * @returns {{parsed: object, matched: string}|null}
 */
export function resolveHint(text, now = Date.now()) {
  const raw = String(text ?? '').trim()
  if (raw === '') return null
  const direct = parseTimeHint(raw, now)
  if (direct.ok) return { parsed: direct, matched: raw }
  for (const pattern of CANDIDATES) {
    const match = raw.match(pattern)
    if (match === null) continue
    const parsed = parseTimeHint(match[0], now)
    if (parsed.ok) return { parsed, matched: match[0] }
  }
  return null
}
