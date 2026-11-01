/**
 * 插件配置：全部字段都有默认值，写错的字段忽略而不是让插件挂掉。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PERSONA } from './prompt.js'

function text(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

function number(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function integer(value, fallback, min, max) {
  return Math.round(number(value, fallback, min, max))
}

function stringList(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
}

export function defaultDataFile() {
  const home = text(process.env.DSH_HOME, join(homedir(), '.dsh'))
  return join(home, 'time-memory', 'events.jsonl')
}

/**
 * @param {unknown} raw cordis.patch.yml 里这一行的 config
 */
export function resolveConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    dataFile: text(config.dataFile, defaultDataFile()),
    capture: config.capture !== false,
    expandFactor: number(config.expandFactor, 3, 1.5, 10),
    maxExpansions: integer(config.maxExpansions, 2, 0, 4),
    maxResults: integer(config.maxResults, 3, 1, 20),
    minScore: number(config.minScore, 2, 1, 10),
    maxTextChars: integer(config.maxTextChars, 300, 80, 4000),
    lineChars: integer(config.lineChars, 90, 40, 400),
    recentLimit: integer(config.recentLimit, 40, 1, 200),
    persona: text(config.persona, DEFAULT_PERSONA),
    includePersona: config.includePersona !== false,
    cognition: text(config.cognition, '').trim(),
    cognitionFile: text(config.cognitionFile, ''),
    excludePresets: stringList(config.excludePresets),
    includeProtocol: config.includeProtocol !== false,
  }
}
