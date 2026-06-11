# 事实核查回路（Fact-Checking Loop）

## 功能概述

在 LLM 生成回答后，使用 Neo4j 图谱作为真理来源进行事实核查，检测并纠正幻觉。

## 工作流程

1. **提取事实**：从 LLM 生成的回答中提取关系型事实陈述
2. **图谱核查**：在 Neo4j 图谱中验证事实是否成立
3. **纠正幻觉**：如果发现幻觉，添加警告信息并建议修正

## 实现细节

### 1. 事实提取 (`FactChecker.extractFacts`)

基于正则表达式模式匹配提取事实：

- **收购关系**：`A 收购了 B` → `(A, ACQUIRED, B)`
- **子公司关系**：`A 是 B 的子公司` → `(A, SUBSIDIARY_OF, B)`
- **投资关系**：`A 投资了 B` → `(A, INVESTED_IN, B)`
- **成立时间**：`A 成立于 2020 年` → `(A, FOUNDED_IN, 2020)`

### 2. 图谱核查 (`FactChecker.checkFact`)

对每个提取的事实，执行以下查询：

```cypher
// 检查正向关系
MATCH (s:Entity {name: $subject})-[r:REL_TYPE]->(o:Entity {name: $object})
RETURN s, r, o

// 检查反向关系
MATCH (s:Entity {name: $subject})<-[r:REL_TYPE]-(o:Entity {name: $object})
RETURN s, r, o
```

核查结果：
- ✅ **通过**：关系存在且方向正确
- ❌ **失败**：关系不存在或方向相反
- ⚠️ **相似关系**：发现相似但不完全匹配的关系

### 3. 纠正幻觉

如果检测到幻觉，在回答末尾添加警告：

```
⚠️ 核查警告："A 公司收购了 B 公司" - 图谱中未找到该关系
⚠️ 核查警告："X 是 Y 的子公司" - 关系方向相反 (可能应为：Y 是 X 的子公司)
```

## 集成到 ChatService

```typescript
// 在流式响应生成后
const factCheckResult = await this.factChecker.checkResponse(assistantText, userId)

if (factCheckResult.hasHallucination) {
  // 添加警告信息
  finalResponse = assistantText + warnings
}

// 返回包含核查结果的 meta 信息
yield {
  type: 'done',
  meta: {
    factCheck: {
      factsExtracted: 3,
      hasHallucination: true,
      failedCount: 1,
      durationMs: 150,
    },
  },
}
```

## 测试方法

### 1. 单元测试

```typescript
const factChecker = new FactChecker(neo4jClient)

// 测试事实提取
const facts = await factChecker.extractFacts('腾讯收购了 Riot Games')
console.log(facts) 
// [{ statement: '腾讯收购了 Riot Games', subject: '腾讯', predicate: 'ACQUIRED', object: 'Riot Games' }]

// 测试事实核查
const result = await factChecker.checkFact(facts[0], userId)
console.log(result)
// { passed: true, reason: '图谱验证通过', evidence: {...} }
```

### 2. API 测试

通过对话 API 测试完整流程：

```bash
curl -X POST "http://localhost:3001/api/chat/stream" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "sessionId": "test-session",
    "message": "腾讯收购了哪些公司？"
  }'
```

观察返回的 `meta.factCheck` 字段。

## 性能影响

- **事实提取**：< 10ms（正则匹配）
- **图谱核查**：50-200ms（取决于图谱大小和查询复杂度）
- **总体延迟**：平均增加 100-300ms

## 局限性

1. **模式有限**：目前仅支持预定义的关系模式
2. **依赖图谱质量**：如果图谱本身不完整，可能导致误判
3. **语言限制**：主要针对中文优化
4. **实体消歧**：暂不支持同名实体的消歧

## 未来改进

1. **LLM 辅助提取**：使用小模型进行更灵活的事实提取
2. **多跳核查**：支持复杂关系的核查（如 A→B→C）
3. **概率判断**：返回置信度分数而非二元判断
4. **自动修正**：直接修正幻觉后重新生成回答

## 相关文件

- [`fact-checker.service.ts`](file:///d:/职业/code/cursor/assistant/chat/end/src/chat/services/fact-checker.service.ts) - 事实核查核心服务
- [`chat.service.ts`](file:///d:/职业/code/cursor/assistant/chat/end/src/chat/chat.service.ts) - 集成事实核查的对话服务
- [`graph.retriever.ts`](file:///d:/职业/code/cursor/assistant/chat/end/src/knowledge/retrieval/graph.retriever.ts) - 图谱检索器
