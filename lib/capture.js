/**
 * 自动归档：把每条真实的用户消息与助手回复按发生时间写进记忆库。
 * 只观察，不改写会话；写盘失败也不影响聊天。
 */

/**
 * 取出消息里可读的文本块。
 * @param {{content?: unknown}} message
 * @returns {string}
 */
export function messageText(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

/**
 * @param {object} options
 * @param {import('./store.js').MemoryStore} options.store
 * @param {any} options.session
 * @param {any} options.event
 * @returns {object|null} 写入的记录，或 null 表示这条事件不需要归档
 */
export function captureEvent({ store, session, event }) {
  const type = event?.type
  if (type !== 'user/message' && type !== 'assistant/message') return null

  const header = session?.header
  // 子代理的会话不进长期记忆，避免把内部推理当成人生的经历
  if (header?.origin === 'subagent') return null

  const sessionId = session?.id ?? header?.id
  if (typeof sessionId !== 'string') return null
  const seq = event?.seq
  if (!Number.isSafeInteger(seq)) return null
  if (store.hasKey(sessionId, seq)) return null

  let text = ''
  let kind = 'user'
  if (type === 'user/message') {
    const data = event.data
    if (data?.role !== 'user') return null
    // 只记用户亲手发的内容；注入的上下文与工具回填不算
    if (data?.source?.kind !== 'user') return null
    text = messageText(data)
  } else {
    const message = event?.data?.message
    if (message?.role !== 'assistant') return null
    kind = 'assistant'
    text = messageText(message)
  }
  if (text === '') return null

  return store.add({
    t: typeof event.time === 'number' ? event.time : Date.now(),
    text,
    kind,
    session: sessionId,
    seq,
    source: 'auto',
  })
}
