import { writeFileSync } from 'node:fs'
import { buildCharter, DEFAULT_PERSONA } from '../lib/prompt.js'
import { renderRecallText } from '../lib/format.js'
import { recallMemories } from '../lib/recall.js'
import { parseTimeHint } from '../lib/time.js'

const charter = buildCharter({ persona: DEFAULT_PERSONA })

// 从 index.js 里抄一份同款工具描述，量它的长度
const recallDesc = [
  '按时间从长期记忆里检索事件。',
  '用户只要提到某个时间段（上周、前天、10月20日、三个月前、昨天下午……），就必须先调用本工具，不要凭印象回答。',
  '工具自己分层：先在指认的时间段内检索；没有命中就自动扩大一次，再扩大一次。',
  '若两次扩大后仍没有记录，返回 verdict="forgot"，此时必须如实回答「我忘记了」，严禁编造或推测补全。',
].join('')
const saveDesc = [
  '把一件值得记住的事归档到它在现实中发生的时间点。',
  '普通对话已经自动入库，只有用户特意讲出的、以后可能被问起的事件才需要调用。',
  'happened_at 用口语时间即可（「上周二下午」「2026-10-20」）；summary 一句话；details 补充细节。',
].join('')
const reminder = '[记忆工具] 用户提到任何时间段，先调用 memory_recall(time_hint=…)，不要凭印象回答；'
  + '它返回 verdict="forgot" 时只能回答「我忘记了」，不得编造。值得长期记住的事件用 memory_save 归档。'

// 一次典型检索输出：命中 3 条、每条 120 字
const records = Array.from({ length: 3 }, (_, i) => ({
  t: parseTimeHint('2026-10-20', Date.now()).start + i * 3_600_000,
  kind: i === 0 ? 'user' : 'assistant',
  text: '我'.repeat(120),
}))
const result = recallMemories({
  records,
  range: parseTimeHint('2026-10-20', Date.now()),
  query: '',
  factor: 3,
  maxExpansions: 2,
  limit: 6,
  minScore: 2,
})
const recallText = renderRecallText(result, { hint: '上周二', query: '', parsed: parseTimeHint('2026-10-20', Date.now()) })

// 整卷塞入的对照：1000 条 × 150 字
const bankChars = 1000 * 150

const report = {
  chars: {
    charter: charter.length,
    persona: DEFAULT_PERSONA.length,
    reminder: reminder.length,
    recallDescription: recallDesc.length,
    saveDescription: saveDesc.length,
    toolSchemaRough: recallDesc.length + saveDesc.length + 700, // + JSON 结构/参数说明
    recallOutput: recallText.length,
    fullBank1000x150: bankChars,
  },
  sample: { charterHead: charter.slice(0, 60), recallText },
}
writeFileSync(new URL('./measure.json', import.meta.url), JSON.stringify(report, null, 2), 'utf8')
