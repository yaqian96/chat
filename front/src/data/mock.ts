import type { ChatSession, HistoryGroup } from '@/types/chat'

export const DEMO_ASSISTANT_REPLY = `Mem0 是一个为 AI 应用设计的**智能记忆层**，它让大语言模型能够跨会话记住用户信息、偏好和历史上下文。

### 核心能力

- **长期记忆**：自动提取并存储用户偏好、事实和对话要点
- **语义检索**：根据当前问题召回最相关的历史记忆
- **多用户隔离**：通过 user_id 区分不同用户的记忆空间
- **即插即用**：提供 SDK，可快速集成到现有 Agent 框架

### 总结

| 维度 | 说明 |
|------|------|
| 定位 | AI 应用的长期记忆基础设施 |
| 典型场景 | 个性化助手、客服机器人、知识管理 |
| 集成方式 | Python / Node SDK，支持自托管或云服务 |
| 与 Redis 配合 | Redis 管短期会话，Mem0 管长期记忆 |

Mem0 解决了 LLM「每次对话从零开始」的痛点，让助手真正「记住你」。`

export const historyGroups: HistoryGroup[] = [
  {
    label: '今天',
    sessions: [
      { id: '1', title: 'Mem0 智能记忆层介绍' },
      { id: '2', title: 'Redis 会话存储方案' },
    ],
  },
  {
    label: '7 天内',
    sessions: [
      { id: '3', title: '有道云笔记同步方案' },
      { id: '4', title: 'NestJS 项目结构设计' },
    ],
  },
  {
    label: '30 天内',
    sessions: [
      { id: '5', title: '知识库向量检索选型' },
      { id: '6', title: 'Vue 3 聊天界面布局' },
    ],
  },
  {
    label: '2025-04',
    sessions: [
      { id: '7', title: 'Agent 二次确认机制设计' },
      { id: '8', title: '个人助手产品规划' },
    ],
  },
]

export function createDefaultSession(): ChatSession {
  return {
    id: '1',
    title: 'Mem0 智能记忆层介绍',
    updatedAt: new Date(),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: '介绍一下 Mem0 是什么，以及它如何与 Redis 配合使用？',
        createdAt: new Date(),
      },
      {
        id: 'm2',
        role: 'assistant',
        content: DEMO_ASSISTANT_REPLY,
        createdAt: new Date(),
      },
    ],
  }
}
