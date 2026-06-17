import { RetrievalRouter, RetrievalStrategy, QueryType } from './retrieval-router.service'

describe('RetrievalRouter', () => {
  let router: RetrievalRouter

  beforeEach(() => {
    router = new RetrievalRouter()
  })

  describe('route - 开放性问题', () => {
    const testCases = [
      { query: '如何准备技术面试', expectedStrategy: RetrievalStrategy.VECTOR, expectedType: QueryType.OPEN_ENDED },
      { query: '怎么学习 TypeScript', expectedStrategy: RetrievalStrategy.VECTOR, expectedType: QueryType.OPEN_ENDED },
      { query: '为什么 Redis 这么快', expectedStrategy: RetrievalStrategy.VECTOR, expectedType: QueryType.OPEN_ENDED },
      { query: 'Vue3 怎么样', expectedStrategy: RetrievalStrategy.VECTOR, expectedType: QueryType.OPEN_ENDED },
    ]

    testCases.forEach(({ query, expectedStrategy, expectedType }) => {
      it(`"${query}" -> ${expectedStrategy}`, () => {
        const decision = router.route(query)
        expect(decision.strategy).toBe(expectedStrategy)
        expect(decision.queryType).toBe(expectedType)
        expect(decision.confidence).toBeGreaterThan(0.7)
      })
    })
  })

  describe('route - 事实性问题', () => {
    const testCases = [
      { query: 'Vue3 的生命周期是什么', expectedStrategy: RetrievalStrategy.BM25, expectedType: QueryType.FACTUAL },
      { query: 'Redis 有多少种数据类型', expectedStrategy: RetrievalStrategy.BM25_GRAPH, expectedType: QueryType.FACTUAL },
      { query: 'JavaScript 是什么时候发布的', expectedStrategy: RetrievalStrategy.BM25, expectedType: QueryType.FACTUAL },
      { query: 'React 组件卸载在哪里', expectedStrategy: RetrievalStrategy.BM25, expectedType: QueryType.FACTUAL },
    ]

    testCases.forEach(({ query, expectedStrategy, expectedType }) => {
      it(`"${query}" -> ${expectedStrategy}`, () => {
        const decision = router.route(query)
        expect(decision.strategy).toBe(expectedStrategy)
        expect(decision.queryType).toBe(expectedType)
      })
    })
  })

  describe('route - 实体关系问题', () => {
    const testCases = [
      { query: 'React 和 Vue 的区别', expectedStrategy: RetrievalStrategy.GRAPH, expectedType: QueryType.ENTITY_RELATION },
      { query: 'TypeScript 与 JavaScript 的关联', expectedStrategy: RetrievalStrategy.GRAPH, expectedType: QueryType.ENTITY_RELATION },
      { query: 'Redis 和 Memcached 差异', expectedStrategy: RetrievalStrategy.GRAPH, expectedType: QueryType.ENTITY_RELATION },
    ]

    testCases.forEach(({ query, expectedStrategy, expectedType }) => {
      it(`"${query}" -> ${expectedStrategy}`, () => {
        const decision = router.route(query)
        expect(decision.strategy).toBe(expectedStrategy)
        expect(decision.queryType).toBe(expectedType)
      })
    })
  })

  describe('route - 技术原理问题', () => {
    const testCases = [
      { query: '虚拟 DOM 的实现原理', expectedStrategy: RetrievalStrategy.VECTOR_BM25, expectedType: QueryType.TECHNICAL },
      { query: 'JavaScript 事件循环机制', expectedStrategy: RetrievalStrategy.VECTOR_BM25, expectedType: QueryType.TECHNICAL },
      { query: 'Promise 底层实现', expectedStrategy: RetrievalStrategy.VECTOR_BM25, expectedType: QueryType.TECHNICAL },
    ]

    testCases.forEach(({ query, expectedStrategy, expectedType }) => {
      it(`"${query}" -> ${expectedStrategy}`, () => {
        const decision = router.route(query)
        expect(decision.strategy).toBe(expectedStrategy)
        expect(decision.queryType).toBe(expectedType)
      })
    })
  })

  describe('route - 特殊规则', () => {
    it('精确术语 + 关系查询 -> BM25_GRAPH', () => {
      const query = 'Composition API 和 Options API 的关联'
      const decision = router.route(query)
      expect(decision.strategy).toBe(RetrievalStrategy.BM25_GRAPH)
      expect(decision.confidence).toBe(0.9)
    })

    it('数量查询 -> BM25_GRAPH', () => {
      const query = '有多少种前端框架'
      const decision = router.route(query)
      expect(decision.strategy).toBe(RetrievalStrategy.BM25_GRAPH)
    })

    it('技术原理 + 关联应用 -> HYBRID', () => {
      const query = '虚拟 DOM 的原理及应用场景'
      const decision = router.route(query)
      expect(decision.strategy).toBe(RetrievalStrategy.HYBRID)
    })
  })

  describe('getChannelsForStrategy', () => {
    const channelTests = [
      { strategy: RetrievalStrategy.VECTOR, expected: ['vector'] },
      { strategy: RetrievalStrategy.BM25, expected: ['bm25'] },
      { strategy: RetrievalStrategy.GRAPH, expected: ['graph'] },
      { strategy: RetrievalStrategy.VECTOR_BM25, expected: ['vector', 'bm25'] },
      { strategy: RetrievalStrategy.VECTOR_GRAPH, expected: ['vector', 'graph'] },
      { strategy: RetrievalStrategy.BM25_GRAPH, expected: ['bm25', 'graph'] },
      { strategy: RetrievalStrategy.HYBRID, expected: ['vector', 'bm25', 'graph'] },
    ]

    channelTests.forEach(({ strategy, expected }) => {
      it(`${strategy} -> ${JSON.stringify(expected)}`, () => {
        const channels = router.getChannelsForStrategy(strategy)
        expect(channels).toEqual(expected)
      })
    })
  })

  describe('route - 默认行为', () => {
    it('无法识别时默认使用向量检索', () => {
      const decision = router.route('随便问问')
      expect(decision.strategy).toBe(RetrievalStrategy.VECTOR)
      expect(decision.queryType).toBe(QueryType.OPEN_ENDED)
    })
  })

  describe('决策一致性', () => {
    it('相同查询多次调用应返回一致结果', () => {
      const query = '如何学习 TypeScript'
      const decision1 = router.route(query)
      const decision2 = router.route(query)
      const decision3 = router.route(query)

      expect(decision1.strategy).toBe(decision2.strategy)
      expect(decision2.strategy).toBe(decision3.strategy)
      expect(decision1.confidence).toBe(decision2.confidence)
    })

    it('决策应包含 reasoning', () => {
      const decision = router.route('如何准备面试')
      expect(decision.reasoning).toBeTruthy()
      expect(typeof decision.reasoning).toBe('string')
    })
  })
})
