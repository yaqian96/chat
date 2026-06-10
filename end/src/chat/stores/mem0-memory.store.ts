import {
  HumanMessage,
  SystemMessage,
  SystemMessageChunk,
  type BaseMessage,
} from '@langchain/core/messages'
import { MemoryClient, type Memory } from 'mem0ai'
import {
  CLASSIFIER_PROMPT,
  memorySchema,
  type MemoryClassification,
} from '../prompts/memory.prompts'

export interface Mem0SearchResult {
  user: Memory[]
  session: Memory[]
}

const SKIP_CLASSIFIER_PATTERN =
  /^(谢谢|感谢|好的|嗯|哦|好|ok|hi|hello|你好|再见|拜拜|收到|明白了|知道了)[.!。！]?$/i

export class Mem0MemoryStore {
  constructor(
    private readonly client: MemoryClient,
    private readonly topK: number,
    private readonly classifier: {
      invoke: (messages: BaseMessage[]) => Promise<MemoryClassification>
    },
  ) {}

  async search(
    userId: string,
    query: string,
    sessionId: string,
  ): Promise<Mem0SearchResult> {
    const [userRes, sessionRes] = await Promise.all([
      this.client.search(query, {
        filters: { user_id: userId },
        topK: this.topK,
      }),
      this.client.search(query, {
        filters: {
          AND: [{ user_id: userId }, { run_id: sessionId }],
        },
        topK: this.topK,
      }),
    ])
    return {
      user: userRes.results ?? [],
      session: sessionRes.results ?? [],
    }
  }

  buildSystemMessage(mem: Mem0SearchResult): SystemMessage | null {
    const blocks: string[] = []
    if (mem.user.length) {
      blocks.push(
        `【用户长期记忆】\n${mem.user.map((m) => `- ${m.memory}`).join('\n')}`,
      )
    }
    if (mem.session.length) {
      blocks.push(
        `【当前会话记忆】\n${mem.session.map((m) => `- ${m.memory}`).join('\n')}`,
      )
    }
    if (!blocks.length) return null
    return new SystemMessage(
      `${blocks.join('\n\n')}\n\n请结合以上记忆回答，勿编造。`,
    )
  }

  async classifyAndPersist(
    userId: string,
    sessionId: string,
    userText: string,
    assistantText: string,
  ): Promise<{ written: string[]; reason: string }> {
    const skipReason = getClassifierSkipReason(userText)
    if (skipReason) {
      return { written: [], reason: skipReason }
    }

    const turn = [
      { role: 'user' as const, content: userText },
      { role: 'assistant' as const, content: assistantText },
    ]

    const { write_user, write_session, reason } = await this.classifier.invoke([
      new SystemMessage(CLASSIFIER_PROMPT),
      new HumanMessage(`用户：${userText}\n助手：${assistantText}`),
    ])

    const written: string[] = []
    if (write_user) {
      await this.client.add(turn, { userId })
      written.push('user')
    }
    if (write_session) {
      await this.client.add(turn, { userId, runId: sessionId })
      written.push('session')
    }
    return { written, reason }
  }
}

function getClassifierSkipReason(userText: string): string | null {
  const trimmed = userText.trim()
  if (trimmed.length <= 3) return '消息过短，跳过记忆分类'
  if (SKIP_CLASSIFIER_PATTERN.test(trimmed)) return '寒暄无需写入记忆'
  return null
}

export function messagesForRedis(messages: BaseMessage[]): BaseMessage[] {
  return messages.filter(
    (m) =>
      !SystemMessage.isInstance(m) && !SystemMessageChunk.isInstance(m),
  )
}
