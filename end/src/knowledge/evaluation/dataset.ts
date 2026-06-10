/**
 * RAGAS 评估数据集
 *
 * 每个用例包含：
 * - query: 用户问题
 * - expectedDocIds: 预期应该召回的文档 ID（从 PostgreSQL documents 表中查找）
 * - expectedKeyContent: 用于在数据库中匹配的关键内容
 *
 * 添加更多测试用例时，请遵循相同格式。
 * 建议覆盖：语义相似、关键词匹配、图谱关系、混合查询等场景。
 */
export interface EvaluationCase {
  id: string
  query: string
  /** 预期召回的文档 ID 列表 */
  expectedDocIds: string[]
  /** 预期回答中应包含的关键内容（用于忠实度评估） */
  expectedKeyContent?: string[]
  /** 难度标签，用于分类分析 */
  difficulty?: 'easy' | 'medium' | 'hard'
  /** 查询类型 */
  queryType?: 'semantic' | 'keyword' | 'relationship' | 'mixed'
}

export const EVALUATION_DATASET: EvaluationCase[] = [
  // === 语义相似类（测试向量检索）===
  {
    id: 'case_001',
    query: '面试自我介绍应该怎么说',
    expectedDocIds: [
      'c88835e9-c356-4935-84c9-1c47f954b6ab', // 面试常问.note
      '38bab238-2396-4554-825f-71cede07b2da', // 面试.note
      'd8026c73-4b7a-41eb-8ad7-e2e433369358', // 面试常问.note
    ],
    expectedKeyContent: ['自我介绍', '个人背景', '技能'],
    difficulty: 'easy',
    queryType: 'semantic',
  },
  {
    id: 'case_002',
    query: '怎么准备技术面试',
    expectedDocIds: [
      '38bab238-2396-4554-825f-71cede07b2da', // 面试.note
      '9fd6b4da-820c-4fc5-8e92-20466789bf98', // 数据结构.note
      '369d79f9-18b2-45ca-a7bf-4e16c42124c7', // 排序算法.note
      '7bea25d7-31f5-435c-8107-d914cd5e1dc6', // 项目中的问题.note
      '7f71a121-9c1b-48b3-89dc-a82cc49e7ffb', // 数据结构.note
    ],
    expectedKeyContent: ['算法', '数据结构', '项目经验'],
    difficulty: 'medium',
    queryType: 'semantic',
  },

  // === 关键词匹配类（测试 BM25 检索）===
  {
    id: 'case_003',
    query: 'Vue3 的 Composition API 怎么用',
    expectedDocIds: [
      '9cfc612d-0ef4-4ffb-90cb-68df24bdd8ae', // vue常见的问题.note
      'f0dca2c4-aeeb-415e-a52a-07daba6f8fa4', // vue3的diff算法.note
      '06e1319e-2f57-460e-aedf-ff21d89c36ae', // 基础ts.note (contains Vue3 references)
    ],
    expectedKeyContent: ['Composition API', 'ref', 'reactive'],
    difficulty: 'easy',
    queryType: 'keyword',
  },
  {
    id: 'case_004',
    query: 'TypeScript 基本使用',
    expectedDocIds: [
      'd11541f2-6c3f-4cb7-ba17-9d84dfb61ea9', // ts的使用.note
      'e2b9d923-f624-4971-8283-33bd673291b9', // 基础ts.note
      '50c74733-85b8-4c3f-95ec-c90f60ee7510', // 基础ts2.note
      '91daca6f-7156-42a9-aef4-fb1672417c04', // ts的使用.note
      '207f5dfc-22ba-4163-ac79-ac9415873e4b', // 基础ts2.note
    ],
    expectedKeyContent: ['TypeScript', '类型注解', '接口'],
    difficulty: 'easy',
    queryType: 'keyword',
  },

  // === 图谱关系类（测试 Neo4j 检索）===
  {
    id: 'case_005',
    query: '前端框架有哪些主流选择',
    expectedDocIds: [
      '9cfc612d-0ef4-4ffb-90cb-68df24bdd8ae', // vue常见的问题.note
      '2307275e-3b66-47f9-99cf-7585575790dc', // react常见问题.note
      'b484d6c0-a996-4471-8399-3a60acc58d85', // Nuxt4框架实现vue-SSR渲染.note
      '371684aa-bd0f-4f3e-b39c-fe46a249f40b', // Next.js.note
    ],
    expectedKeyContent: ['Vue', 'React', 'Angular'],
    difficulty: 'medium',
    queryType: 'relationship',
  },

  // === 混合查询类（测试 RRF 融合效果）===
  {
    id: 'case_006',
    query: '前端性能优化有哪些方法',
    expectedDocIds: [
      'f0f42ca6-8b4e-489f-95f3-77cd34e19735', // 性能优化.note
      'e104b841-8b05-4a87-81fb-e097efe1e241', // 浏览器缓存.note
      'b8a4ed13-60cf-4eb2-815a-97fa03aedbd3', // 性能优化.note
      '5dd13ecc-9b04-4982-85e6-fe6015ca85d3', // 浏览器缓存.note
    ],
    expectedKeyContent: ['性能优化', '缓存', '懒加载'],
    difficulty: 'medium',
    queryType: 'mixed',
  },
  {
    id: 'case_007',
    query: '微前端架构方案对比',
    expectedDocIds: [
      '2e3e5cbe-a19a-4849-9ccf-4493faf4bce9', // 微前端架构 qiankun.note
      '80be5f56-f165-43eb-b049-f5628ecd7124', // 微前端架构 qiankun.note
    ],
    expectedKeyContent: ['qiankun', '微前端', '子应用'],
    difficulty: 'hard',
    queryType: 'mixed',
  },
]

export const DEFAULT_USER_ID = 'demo_user_001'
