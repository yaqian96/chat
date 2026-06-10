# Split Requirements — Examples

## Example 1: Add reranker to hybrid search

**Input:** 「混合检索后加一层 rerank，提升 Top5 精度」

**Output (abbreviated):**

| Unit | Title | Type | Depends |
|------|-------|------|---------|
| 1 | 调研 rerank API（OpenRouter Cohere/Jina）并 spike 单次调用 | spike | — |
| 2 | 新增 `rerank.service.ts` + 接口类型 | infra | 1 |
| 3 | `HybridSearchService` RRF 后接 rerank，env 开关默认关 | api | 2 |
| 4 | `POST /search` 返回 rerank 前后分数（debug 字段） | api | 3 |
| 5 | `chat.service` 接入 rerank 开关 | integration | 3 |
| 6 | 用 5 条 eval query 手测对比（文档记录） | observability | 4,5 |

**Not in scope:** 改 RRF 权重、改 embedding 模型。

---

## Example 2: RedisInsight cannot access

**Input:** 「Redis 可视化工具访问不了」

| Unit | Title | Type | Depends |
|------|-------|------|---------|
| 1 | 确认容器端口映射 `docker ps` | spike | — |
| 2 | `docker compose up -d redisinsight --force-recreate` | infra | 1 |
| 3 | README 补充 RedisInsight 连接说明 | docs | 2 |

---

## Example 3: Search observability (debug mode)

**Input:** 「检索结果不知道准不准，加可观测性，不动配置」

| Unit | Title | Type | Depends |
|------|-------|------|---------|
| 1 | 扩展 `HybridSearchResult` 类型（分路分数、排名、latency） | infra | — |
| 2 | 各 retriever 返回原始 score + rank | api | 1 |
| 3 | `fuseRrf` 记录每路 RRF 贡献 | api | 2 |
| 4 | `search?debug=true` 返回 `channelHits` 明细 | api | 3 |
| 5 | 流式 `meta` 事件带 `retrieval` 摘要 | integration | 4 |

---

## Example 4: Requirement too small

**Input:** 「bm25 retriever 的 hit 类型报错」

**Output:** 单单元即可：

- **单元 1：修复 bm25 SearchHit 类型**
  - 改动：`bm25.retriever.ts`
  - 验收：tsc 无错误；`POST /search` 返回 bm25 结果
  - 验证：`npx tsc --noEmit` + curl search

No further split needed.
