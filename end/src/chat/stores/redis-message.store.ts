import type Redis from 'ioredis'
import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
} from '@langchain/core/messages'

export class RedisMessageStore {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string,
    private readonly ttlSeconds: number,
  ) {}

  private messagesKey(sessionId: string): string {
    return `${this.keyPrefix}:${sessionId}:messages`
  }

  async loadMessages(sessionId: string): Promise<BaseMessage[]> {
    const raw = await this.redis.get(this.messagesKey(sessionId))
    if (!raw) return []
    return mapStoredMessagesToChatMessages(JSON.parse(raw))
  }

  async saveMessages(sessionId: string, messages: BaseMessage[]): Promise<void> {
    const payload = JSON.stringify(mapChatMessagesToStoredMessages(messages))
    await this.redis.set(
      this.messagesKey(sessionId),
      payload,
      'EX',
      this.ttlSeconds,
    )
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(this.messagesKey(sessionId))
  }
}
