/**
 * 简易时间线记忆库：一行一条 JSON 的 jsonl 文件。
 *
 * 设计取舍：
 * - 纯 append，损坏的行在读取时跳过，不阻塞其它记忆；
 * - 进程内缓存一份数组，写穿到磁盘；
 * - 没有引入 DSH 的 storage 服务，安装/卸载插件不会牵连 profile 的数据迁移。
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

const RECORD_VERSION = 1

function safeParse(line) {
  try {
    const value = JSON.parse(line)
    if (value === null || typeof value !== 'object') return null
    if (typeof value.t !== 'number' || !Number.isFinite(value.t)) return null
    if (typeof value.text !== 'string') return null
    return value
  } catch {
    return null
  }
}

export class MemoryStore {
  /**
   * @param {{file: string, maxTextChars?: number, maxRecords?: number}} options
   */
  constructor(options) {
    this.file = options.file
    this.maxTextChars = options.maxTextChars ?? 300
    this.maxRecords = options.maxRecords ?? 100_000
    /** @type {Array<object>} */
    this.records = []
    this.loaded = false
    this.dirty = false
    this.lastError = null
    /** @type {Set<string>} */
    this.keys = new Set()
  }

  /** 读取整个文件一次；写失败时保留内存副本。 */
  load() {
    if (this.loaded) return this.records
    this.loaded = true
    let raw = ''
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') this.lastError = String(error?.message ?? error)
      return this.records
    }
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      const record = safeParse(line)
      if (record === null) continue
      this.records.push(record)
      this.noteKey(record)
    }
    this.records.sort((a, b) => a.t - b.t)
    return this.records
  }

  noteKey(record) {
    if (record.session !== undefined && record.seq !== undefined) {
      this.keys.add(`${record.session}:${record.seq}`)
    }
    if (record.id !== undefined) this.keys.add(String(record.id))
  }

  /** 同一会话的同一条事件只写入一次。 */
  hasKey(session, seq) {
    return this.keys.has(`${session}:${seq}`)
  }

  /**
   * 追加一条记忆。写盘失败只记录错误，不抛出，聊天不因此中断。
   * @param {{t:number,text:string,kind?:string,session?:string,seq?:number,tags?:string[],source?:string}} input
   * @returns {object} 落库的记录
   */
  add(input) {
    this.load()
    const text = String(input.text ?? '').trim()
    if (text === '') throw new Error('memory text must not be empty')
    const record = {
      v: RECORD_VERSION,
      id: input.id ?? `m_${input.t}_${Math.random().toString(36).slice(2, 8)}`,
      t: Math.round(input.t),
      kind: input.kind ?? 'note',
      text: text.length > this.maxTextChars ? `${text.slice(0, this.maxTextChars)}…` : text,
      ...(input.session === undefined ? {} : { session: String(input.session) }),
      ...(input.seq === undefined ? {} : { seq: Number(input.seq) }),
      ...(Array.isArray(input.tags) && input.tags.length > 0 ? { tags: input.tags.map(String) } : {}),
      ...(input.source === undefined ? {} : { source: String(input.source) }),
      stored: Date.now(),
    }
    this.records.push(record)
    this.records.sort((a, b) => a.t - b.t)
    this.noteKey(record)
    this.persist(record)
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords)
    }
    return record
  }

  persist(record) {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8')
      this.lastError = null
    } catch (error) {
      this.lastError = String(error?.message ?? error)
    }
  }

  /** 时间升序的全部记忆。 */
  all() {
    return this.load()
  }

  /** 最近 n 条（用于人设里的"最近记忆"摘要）。 */
  recent(limit = 20) {
    return [...this.all()].sort((a, b) => b.t - a.t).slice(0, limit)
  }

  /** 区间内的时间升序记忆，含左闭右开。 */
  between(start, end) {
    return this.all().filter((r) => r.t >= start && r.t < end)
  }

  stats() {
    const all = this.all()
    return { count: all.length, file: this.file, lastError: this.lastError }
  }
}
