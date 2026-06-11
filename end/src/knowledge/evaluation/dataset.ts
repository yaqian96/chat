/**
 * RAG 检索评估数据集
 *
 * 每个测试用例包含查询和期望返回的文档 ID 列表。
 * 评估指标包括：Recall / Precision / MRR / NDCG / Channel Hits
 *
 * 添加更多测试用例时，请遵循相同格式。
 * 建议覆盖：语义相似、关键词匹配、图谱关系、混合查询等场景。
 */
export interface EvaluationCase {
  id: string
  query: string
  /** 期望返回的文档 ID 列表（需要在知识库中存在） */
  expectedDocIds: string[]
  /** 难度标签 */
  difficulty?: 'easy' | 'medium' | 'hard'
  /** 查询类型 */
  queryType?: 'semantic' | 'keyword' | 'relationship' | 'mixed'
}

export const EVALUATION_DATASET: EvaluationCase[] = [
  // === 语义相似类（测试向量检索）===
  {
    id: 'eval_001',
    query: '面试自我介绍应该怎么说',
    expectedDocIds: [], // 需要实际导入知识库后填充文档 ID
    difficulty: 'easy',
    queryType: 'semantic',
  },
  {
    id: 'eval_002',
    query: '怎么准备技术面试',
    expectedDocIds: [],
    difficulty: 'medium',
    queryType: 'semantic',
  },

  // === 关键词匹配类（测试 BM25 检索）===
  {
    id: 'eval_003',
    query: 'Vue3 的 Composition API 怎么用',
    expectedDocIds: [],
    difficulty: 'easy',
    queryType: 'keyword',
  },
  {
    id: 'eval_004',
    query: 'TypeScript 基本使用',
    expectedDocIds: [],
    difficulty: 'easy',
    queryType: 'keyword',
  },

  // === 图谱关系类（测试 Neo4j 检索）===
  {
    id: 'eval_005',
    query: '前端框架有哪些主流选择',
    expectedDocIds: [],
    difficulty: 'medium',
    queryType: 'relationship',
  },

  // === 混合查询类（测试 RRF 融合效果）===
  {
    id: 'eval_006',
    query: '前端性能优化有哪些方法',
    expectedDocIds: [],
    difficulty: 'medium',
    queryType: 'mixed',
  },
  {
    id: 'eval_007',
    query: '微前端架构方案对比',
    expectedDocIds: [],
    difficulty: 'hard',
    queryType: 'mixed',
  },
]

export const DEFAULT_USER_ID = 'demo_user_001'
