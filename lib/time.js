/**
 * 时间锚点解析：把聊天里出现的时间段说法（"上周二""三天前""10月20日下午"…）
 * 解析成半开区间 [start, end)，单位是 epoch 毫秒。
 *
 * 这个模块是纯函数、零依赖的，便于脱离 DSH 单独测试。
 * 所有计算都走宿主本地时区，与 DSH 的 time-context 一致。
 */

const MINUTE = 60_000
const DAY = 86_400_000

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const WEEKDAYS_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const WEEKDAY_CHARS = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6, 七: 6 }

/** 时段词 -> 当天内的小时区间（左闭右开）。 */
const DAY_PARTS = [
  ['凌晨', 0, 6],
  ['清晨', 5, 8],
  ['早上', 6, 12],
  ['上午', 6, 12],
  ['中午', 11, 14],
  ['下午', 12, 18],
  ['傍晚', 17, 20],
  ['晚上', 18, 24],
  ['夜里', 20, 24],
  ['深夜', 22, 24],
  ['半夜', 0, 4],
]

/**
 * 解析中文数字或阿拉伯数字，失败返回 NaN。
 * @param {string} text
 * @returns {number}
 */
export function parseCnNumber(text) {
  if (typeof text !== 'string') return Number.NaN
  const s = text.trim()
  if (s === '') return Number.NaN
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  if (/^十[一二三四五六七八九]$/.test(s)) return 10 + CN_DIGITS[s[1]]
  if (/^[一二三四五六七八九]十$/.test(s)) return CN_DIGITS[s[0]] * 10
  if (/^[一二三四五六七八九]十[一二三四五六七八九]$/.test(s)) return CN_DIGITS[s[0]] * 10 + CN_DIGITS[s[2]]
  if (s.length === 1 && Object.hasOwn(CN_DIGITS, s)) return CN_DIGITS[s]
  return Number.NaN
}

/** 归一化：全角数字与标点转半角，去掉首尾空白。 */
function normalize(text) {
  return String(text ?? '')
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[〜～]/g, '~')
    .replace(/[－—–]/g, '-')
    .trim()
}

function startOfDay(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function shiftDays(ms, n) {
  const d = new Date(ms)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

function shiftMonths(ms, n) {
  const d = new Date(ms)
  d.setMonth(d.getMonth() + n)
  return d.getTime()
}

function startOfWeek(ms) {
  const d = new Date(startOfDay(ms))
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return d.getTime()
}

function startOfMonth(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  return d.getTime()
}

function startOfYear(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  d.setMonth(0, 1)
  return d.getTime()
}

/** 找出说法里的时段词；没有就返回 null。 */
export function detectDayPart(hint) {
  for (const [word, from, to] of DAY_PARTS) {
    if (hint.includes(word)) return { word, from, to }
  }
  return null
}

/** 把「某一天」收窄到说法里的上午/下午/晚上。 */
function applyDayPart(range, part) {
  if (!part || range.granularity !== 'day') return range
  const base = startOfDay(range.start)
  const start = base + part.from * 3_600_000
  const end = part.from + part.to >= 24 ? shiftDays(base, 1) : base + part.to * 3_600_000
  return { ...range, start, end, granularity: 'part', part: part.word }
}

function dayRange(ms, extra = {}) {
  const start = startOfDay(ms)
  return { start, end: shiftDays(start, 1), granularity: 'day', ...extra }
}

/**
 * 解析单个日期片段（供区间两端复用）。
 * @param {string} token
 * @param {number} now
 * @returns {{start:number,end:number,granularity:string}|null}
 */
function parseDateToken(token, now) {
  const s = normalize(token).replace(/\s+/g, '')
  if (s === '') return null

  // 2026-10-20 / 2026/10/20 / 2026.10.20
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2]) - 1
    const d = Number(m[3])
    const start = new Date(y, mo, d).getTime()
    if (Number.isNaN(start)) return null
    return dayRange(start)
  }

  // 2026年10月20日 / 10月20日 / 10月20号（可带 去年/今年/前年 前缀）
  m = /^(?:(\d{4})年)?(去年|今年|前年)?(\d{1,2})月(\d{1,2})[日号]?$/.exec(s)
  if (m) {
    const explicitYear = m[1] === undefined ? undefined : Number(m[1])
    const yearHint = m[2]
    const mo = Number(m[3]) - 1
    const d = Number(m[4])
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null
    const nowYear = new Date(now).getFullYear()
    let year = explicitYear ?? (yearHint === '去年' ? nowYear - 1 : yearHint === '前年' ? nowYear - 2 : nowYear)
    let start = new Date(year, mo, d).getTime()
    // 未写年份且日期还在未来：视为去年同一时间，更符合"提到过去"的语境
    if (explicitYear === undefined && !yearHint && start > now + DAY) start = new Date(year - 1, mo, d).getTime()
    return dayRange(start)
  }

  return null
}

/**
 * 解析一个时间说法。
 * @param {string} rawHint 用户原话里的时间片段。
 * @param {number} [now] 参照时刻（epoch 毫秒）。
 * @returns {{ok:true,start:number,end:number,granularity:string,label:string,part?:string}|{ok:false,reason:string}}
 */
export function parseTimeHint(rawHint, now = Date.now()) {
  const hint = normalize(rawHint)
  if (hint === '') return { ok: false, reason: 'empty' }

  const flat = hint.replace(/\s+/g, '')
  const part = detectDayPart(flat)

  const finish = (range) => {
    const narrowed = applyDayPart(range, part)
    return {
      ok: true,
      start: narrowed.start,
      end: narrowed.end,
      granularity: narrowed.granularity,
      part: narrowed.part,
      label: describeRange(narrowed.start, narrowed.end, narrowed.granularity),
    }
  }

  // 1) 显式区间：A~B / A到B / A至B / A-B
  const rangeMatch = /^(.+?)(?:~|到|至)\s*(.+)$/.exec(flat)
  if (rangeMatch) {
    const left = parseExplicitSide(rangeMatch[1], now)
    const right = parseExplicitSide(rangeMatch[2], now)
    if (left && right && right.start >= left.start) {
      const end = Math.max(right.end, right.start + MINUTE)
      return finish({ start: left.start, end, granularity: 'range' })
    }
  }

  // 2) 具体到分钟的日期时间：2026-10-20 14:30
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T\s](\d{1,2}):(\d{2})$/.exec(hint.replace(/\s+/g, ' '))
  if (m) {
    const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime()
    if (!Number.isNaN(start)) {
      return finish({ start, end: start + 3_600_000, granularity: 'hour' })
    }
  }

  // 3) 单独的日期片段
  const single = parseDateToken(flat, now)
  if (single) return finish(single)

  // 4) N 天前 / N 周前 / N 个月前（含"大前天"这类固定词）
  m = /^(\d+|[一二三四五六七八九十两]+)\s*(天|日|周|个?星期|个?礼拜|个?月)前$/.exec(flat)
  if (m) {
    const n = parseCnNumber(m[1])
    const unit = m[2]
    if (!Number.isNaN(n) && n >= 0) {
      if (unit === '天' || unit === '日') return finish(dayRange(shiftDays(startOfDay(now), -n)))
      if (unit.includes('周') || unit.includes('星期') || unit.includes('礼拜')) {
        const weekStart = shiftDays(startOfWeek(now), -7 * n)
        return finish({ start: weekStart, end: shiftDays(weekStart, 7), granularity: 'week' })
      }
      const monthStart = shiftMonths(startOfMonth(now), -n)
      return finish({ start: monthStart, end: shiftMonths(monthStart, 1), granularity: 'month' })
    }
  }

  // 5) 今天/昨天/前天/大前天/明天/后天
  const fixedDays = { 今天: 0, 今日: 0, 昨天: -1, 昨日: -1, 前天: -2, 大前天: -3, 明天: 1, 后天: 2 }
  if (Object.hasOwn(fixedDays, flat)) {
    return finish(dayRange(shiftDays(startOfDay(now), fixedDays[flat])))
  }
  // 昨天下午 / 今天上午 …
  m = /^(今天|今日|昨天|昨日|前天|大前天|明天|后天)(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|深夜|半夜)$/.exec(flat)
  if (m) {
    const base = dayRange(shiftDays(startOfDay(now), fixedDays[m[1]]))
    const inner = detectDayPart(m[2])
    return {
      ok: true,
      start: applyDayPart({ ...base, granularity: 'day' }, inner).start,
      end: applyDayPart({ ...base, granularity: 'day' }, inner).end,
      granularity: 'part',
      part: m[2],
      label: describeRange(
        applyDayPart({ ...base, granularity: 'day' }, inner).start,
        applyDayPart({ ...base, granularity: 'day' }, inner).end,
        'part',
      ),
    }
  }

  // 6) 周：上周三 / 上星期三 / 本周五 / 周一 / 上上周 / 下个星期
  const weekOffsetOf = (prefix) => {
    if (prefix === '上上') return -2
    if (prefix === '上') return -1
    if (prefix === '下') return 1
    if (prefix === '下下') return 2
    return 0
  }
  m = /^(上上|上|这|本|下|下下)?个?(?:周|星期|礼拜)([一二三四五六日天])$/.exec(flat)
  if (m) {
    const weekday = WEEKDAY_CHARS[m[2]]
    if (weekday !== undefined) {
      const weekStart = shiftDays(startOfWeek(now), 7 * weekOffsetOf(m[1]))
      return finish(dayRange(shiftDays(weekStart, weekday)))
    }
  }
  m = /^(上上|上|这|本|下|下下)?个?(?:周|星期|礼拜)$/.exec(flat)
  if (m) {
    const weekStart = shiftDays(startOfWeek(now), 7 * weekOffsetOf(m[1]))
    return finish({ start: weekStart, end: shiftDays(weekStart, 7), granularity: 'week' })
  }

  // 7) 月：上个月 / 上上个月 / 本月 / 这个月 / 下个月
  m = /^(上上个月|上个月|上月|本月|这个月|下个月|下月)$/.exec(flat)
  if (m) {
    const offset = m[1] === '上个月' || m[1] === '上月' ? -1
      : m[1] === '上上个月' ? -2
        : m[1] === '下个月' || m[1] === '下月' ? 1
          : 0
    const monthStart = shiftMonths(startOfMonth(now), offset)
    return finish({ start: monthStart, end: shiftMonths(monthStart, 1), granularity: 'month' })
  }

  // 8) 单说月份：8月 / 8月份 / 12月
  m = /^(\d{1,2})月份?$/.exec(flat)
  if (m) {
    const mo = Number(m[1]) - 1
    if (mo >= 0 && mo <= 11) {
      const nowYear = new Date(now).getFullYear()
      let monthStart = new Date(nowYear, mo, 1).getTime()
      if (monthStart > now + DAY) monthStart = new Date(nowYear - 1, mo, 1).getTime()
      return finish({ start: monthStart, end: shiftMonths(monthStart, 1), granularity: 'month' })
    }
  }

  // 9) 年：去年 / 今年 / 前年
  m = /^(去年|今年|前年)$/.exec(flat)
  if (m) {
    const offset = m[1] === '去年' ? -1 : m[1] === '前年' ? -2 : 0
    const yearStart = shiftMonths(startOfYear(now), offset * 12)
    return finish({ start: yearStart, end: shiftMonths(yearStart, 12), granularity: 'year' })
  }

  // 9) 刚才 / 这几天 / 最近 N 天
  if (flat === '刚才' || flat === '刚刚' || flat === '方才') {
    return finish({ start: now - 3_600_000, end: now, granularity: 'hour' })
  }
  if (flat === '最近' || flat === '这几天' || flat === '这阵子' || flat === '近期') {
    return finish({ start: shiftDays(startOfDay(now), -6), end: shiftDays(startOfDay(now), 1), granularity: 'range' })
  }
  m = /^最近(\d+|[一二三四五六七八九十两]+)(天|日|周)$/.exec(flat)
  if (m) {
    const n = parseCnNumber(m[1])
    if (!Number.isNaN(n) && n > 0) {
      const span = m[2] === '周' ? n * 7 : n
      return finish({ start: shiftDays(startOfDay(now), -(span - 1)), end: shiftDays(startOfDay(now), 1), granularity: 'range' })
    }
  }

  // 10) 当天时段词单独出现（"下午三点左右"里的"下午"）
  if (part) {
    return finish(dayRange(now))
  }

  return { ok: false, reason: 'unparsed' }
}

/** 区间端点：先按完整说法解析，再退化成一个日期。 */
function parseExplicitSide(text, now) {
  const direct = parseTimeHint(text, now)
  if (direct.ok) return direct
  return parseDateToken(text, now)
}

/**
 * 围绕原始窗口做等比扩大。level 0 返回原窗口。
 * @param {{start:number,end:number}} range
 * @param {number} factor 每次扩大的倍数
 * @param {number} level 扩大次数
 */
export function expandRange(range, factor = 3, level = 0) {
  if (level <= 0) return { start: range.start, end: range.end }
  const width = Math.max(range.end - range.start, MINUTE)
  const widened = Math.min(width * Math.pow(factor, level), DAY * 365 * 50)
  const center = (range.start + range.end) / 2
  const start = Math.round((center - widened / 2) / MINUTE) * MINUTE
  return { start, end: Math.round(start + widened) }
}

export function formatDate(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function formatClock(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatDateTime(ms) {
  return `${formatDate(ms)} ${formatClock(ms)}`
}

export function weekdayOf(ms) {
  return WEEKDAYS_CN[(new Date(ms).getDay() + 6) % 7]
}

/** 把窗口渲染成一句人话，用于检索日志与记忆卡片。 */
export function describeRange(start, end, granularity) {
  if (granularity === 'hour') return `${formatDateTime(start)} 前后一小时`
  if (granularity === 'part') return `${formatDate(start)} ${formatClock(start)}–${formatClock(end)}`
  const aligned = startOfDay(start) === start && startOfDay(end) === end
  if (aligned) {
    const days = Math.max(1, Math.round((end - start) / DAY))
    if (days <= 1) return `${formatDate(start)}（${weekdayOf(start)}）全天`
    return `${formatDate(start)} 至 ${formatDate(shiftDays(end, -1))}（${days} 天）`
  }
  if (startOfDay(start) === startOfDay(end)) {
    return `${formatDate(start)} ${formatClock(start)}–${formatClock(end)}`
  }
  return `${formatDateTime(start)} 至 ${formatDateTime(end)}`
}

/** 供提示词使用的"现在"。 */
export function describeNow(now = Date.now()) {
  return `${formatDateTime(now)}（${weekdayOf(now)}）`
}

export const TIME_CONSTANTS = { MINUTE, DAY }
