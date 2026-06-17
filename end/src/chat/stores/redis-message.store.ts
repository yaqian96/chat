import type Redis from 'ioredis'
import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
} from '@langchain/core/messages'

export interface InterruptedState {
  content: string // 已生成的内容
  fullMessages: BaseMessage[] // 完整消息历史（用于续传）
}

export class RedisMessageStore {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string,
    private readonly ttlSeconds: number,
  ) {}

  private messagesKey(sessionId: string): string {
    return `${this.keyPrefix}:${sessionId}:messages`
  }

  private interruptedKey(sessionId: string): string {
    return `${this.keyPrefix}:${sessionId}:interrupted`
  }

  async loadMessages(sessionId: string): Promise<BaseMessage[]> {
    const raw = await this.redis.get(this.messagesKey(sessionId))
    if (!raw) return []
    return mapStoredMessagesToChatMessages(JSON.parse(raw))
  }

  async saveMessages(
    sessionId: string,
    messages: BaseMessage[],
    ttlOverride?: number,
  ): Promise<void> {
    const payload = JSON.stringify(mapChatMessagesToStoredMessages(messages))
    await this.redis.set(
      this.messagesKey(sessionId),
      payload,
      'EX',
      ttlOverride ?? this.ttlSeconds,
    )
  }

  async saveInterruptedState(
    sessionId: string,
    state: InterruptedState,
  ): Promise<void> {
    const payload = JSON.stringify({
      content: state.content,
      messages: mapChatMessagesToStoredMessages(state.fullMessages),
    })
    // 中断状态保留 5 分钟
    await this.redis.set(this.interruptedKey(sessionId), payload, 'EX', 300)
  }

  async loadInterruptedState(sessionId: string): Promise<InterruptedState | null> {
    const raw = await this.redis.get(this.interruptedKey(sessionId))
    if (!raw) return null

    const parsed = JSON.parse(raw)
    return {
      content: parsed.content,
      fullMessages: mapStoredMessagesToChatMessages(parsed.messages),
    }
  }

  async clearInterruptedState(sessionId: string): Promise<void> {
    await this.redis.del(this.interruptedKey(sessionId))
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(this.messagesKey(sessionId))
  }
}
