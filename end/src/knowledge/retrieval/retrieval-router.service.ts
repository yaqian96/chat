import { Injectable, Logger } from '@nestjs/common'

export enum RetrievalStrategy {
  /** 仅向量检索 - 适合语义理解、开放性问题 */
  VECTOR = 'vector',
  /** 仅 BM25 - 适合精确匹配、关键词查询 */
  BM25 = 'bm25',
  /** 仅图谱检索 - 适合实体关系、知识图谱查询 */
  GRAPH = 'graph',
  /** 向量 + BM25 - 适合技术原理、概念解释 */
  VECTOR_BM25 = 'vector_bm25',
  /** 向量 + 图谱 - 适合概念关联、知识探索 */
  VECTOR_GRAPH = 'vector_graph',
  /** BM25 + 图谱 - 适合精确数据 + 关系查询 */
  BM25_GRAPH = 'bm25_graph',
  /** 三路混合 - 适合复杂问题、综合查询 */
  HYBRID = 'hybrid',
}

export interface RoutingDecision {
  strategy: RetrievalStrategy
  confidence: number
  reasoning: string
  queryType: QueryType
}

export enum QueryType {
  /** 开放性问题（如何、为什么、怎么样） */
  OPEN_ENDED = 'open_ended',
  /** 事实性问题（是什么、多少、何时） */
  FACTUAL = 'factual',
  /** 实体关系查询（关联、区别、对比） */
  ENTITY_RELATION = 'entity_relation',
  /** 技术原理（底层原理、实现机制） */
  TECHNICAL = 'technical',
  /** 精确匹配（具体术语、API、方法名） */
  EXACT_MATCH = 'exact_match',
  /** 综合问题（涉及多个方面） */
  COMPREHENSIVE = 'comprehensive',
}

@Injectable()
export class RetrievalRouter {
  private readonly logger = new Logger(RetrievalRouter.name)

  /**
   * 根据查询内容自动判断检索策略
   */
  route(query: string): RoutingDecision {
    const queryType = this.classifyQueryType(query)
    const { strategy, confidence, reasoning } = this.determineStrategy(query, queryType)

    this.logger.debug(
      `Routing decision for "${query.slice(0, 50)}": ${strategy} (${queryType}, confidence: ${confidence})`,
    )

    return {
      strategy,
      confidence,
      reasoning,
      queryType,
    }
  }

  /**
   * 判断查询类型
   */
  private classifyQueryType(query: string): QueryType {
    const q = query.toLowerCase()

    // 开放性问题特征词
    const openEndedPatterns = [
      /如何\b/,
      /怎么\b/,
      /为什么\b/,
      /怎么样\b/,
      /怎样\b/,
      /what\s+to\s+do\b/,
      /how\s+to\b/,
      /why\b/,
    ]

    // 事实性问题特征词
    const factualPatterns = [
      /是什么\b/,
      /多少\b/,
      /何时\b/,
      /哪里\b/,
      /哪个\b/,
      /what\s+is\b/,
      /how\s+many\b/,
      /when\b/,
      /where\b/,
    ]

    // 实体关系特征词
    const relationPatterns = [
      /关联\b/,
      /关系\b/,
      /区别\b/,
      /对比\b/,
      /差异\b/,
      /vs\b/,
      / versus\b/,
      /和.*有什么不同\b/,
      /与.*的关系\b/,
    ]

    // 技术原理特征词
    const technicalPatterns = [
      /原理\b/,
      /机制\b/,
      /底层\b/,
      /实现\b/,
      /核心\b/,
      /本质\b/,
      /underlying\b/,
      /mechanism\b/,
      /how\s+.*\s+work\b/,
    ]

    // 精确匹配特征（包含具体术语、API、方法名等）
    const exactMatchPatterns = [
      /\b[A-Z][a-zA-Z]+\.[a-z]+\b/, // CamelCase.method
      /\b[A-Z]{2,}\b/, // 大写字母缩写
      /['"`][^'"`]+['"`]/, // 引号包裹的术语
      /\b\w+\s*\(\s*\)/, // 方法调用
      /\bv\d+\.\d+\b/, // 版本号
    ]

    // 综合问题特征（包含多个问号或连接词）
    const comprehensivePatterns = [
      /.*[?？].*[?？].*/, // 多个问号
      /并且\b/,
      /以及\b/,
      /还有\b/,
      /同时\b/,
      /.*[,.].*[,.].*/, // 多个逗号分隔
    ]

    // 计算各类型匹配得分
    const scores = {
      [QueryType.OPEN_ENDED]: this.countMatches(q, openEndedPatterns),
      [QueryType.FACTUAL]: this.countMatches(q, factualPatterns),
      [QueryType.ENTITY_RELATION]: this.countMatches(q, relationPatterns),
      [QueryType.TECHNICAL]: this.countMatches(q, technicalPatterns),
      [QueryType.EXACT_MATCH]: this.countMatches(q, exactMatchPatterns),
      [QueryType.COMPREHENSIVE]: this.countMatches(q, comprehensivePatterns),
    }

    // 找出得分最高的类型
    let maxScore = 0
    let bestType = QueryType.OPEN_ENDED

    for (const [type, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score
        bestType = type as QueryType
      }
    }

    // 如果没有明显特征，默认为开放性问题
    return maxScore > 0 ? bestType : QueryType.OPEN_ENDED
  }

  /**
   * 根据查询类型确定检索策略
   */
  private determineStrategy(
    query: string,
    queryType: QueryType,
  ): { strategy: RetrievalStrategy; confidence: number; reasoning: string } {
    const q = query.toLowerCase()

    // 特殊规则优先
    // 1. 包含精确术语 + 关系查询 -> BM25 + Graph
    if (
      this.countMatches(q, [/\b[A-Z][a-zA-Z]+\b/, /['"`][^'"`]+['"`]/]) > 0 &&
      this.countMatches(q, [/关联\b/, /关系\b/, /对比\b/]) > 0
    ) {
      return {
        strategy: RetrievalStrategy.BM25_GRAPH,
        confidence: 0.9,
        reasoning: '包含精确术语和关系查询，需要 BM25 精确匹配 + Graph 关系检索',
      }
    }

    // 2. 包含数字/数据查询 -> BM25 + Graph
    if (this.countMatches(q, [/\d+\s*(个 | 项 | 种 | 多少 | 数量)/, /how\s+many/]) > 0) {
      return {
        strategy: RetrievalStrategy.BM25_GRAPH,
        confidence: 0.85,
        reasoning: '数量查询，需要 BM25 精确数字匹配 + Graph 结构化数据',
      }
    }

    // 3. 技术原理 + 关联应用 -> 全开
    if (
      this.countMatches(q, [/原理\b/, /底层\b/, /机制\b/]) > 0 &&
      this.countMatches(q, [/关联\b/, /应用\b/, /场景\b/]) > 0
    ) {
      return {
        strategy: RetrievalStrategy.HYBRID,
        confidence: 0.8,
        reasoning: '技术原理 + 关联应用，需要三路混合检索',
      }
    }

    // 根据查询类型选择策略
    switch (queryType) {
      case QueryType.OPEN_ENDED:
        return {
          strategy: RetrievalStrategy.VECTOR,
          confidence: 0.85,
          reasoning: '开放性问题，主要依赖语义理解',
        }

      case QueryType.FACTUAL:
        return {
          strategy: RetrievalStrategy.BM25,
          confidence: 0.8,
          reasoning: '事实性问题，需要精确关键词匹配',
        }

      case QueryType.ENTITY_RELATION:
        return {
          strategy: RetrievalStrategy.GRAPH,
          confidence: 0.85,
          reasoning: '实体关系查询，图谱检索最优',
        }

      case QueryType.TECHNICAL:
        return {
          strategy: RetrievalStrategy.VECTOR_BM25,
          confidence: 0.8,
          reasoning: '技术原理问题，需要语义理解 + 精确术语匹配',
        }

      case QueryType.EXACT_MATCH:
        return {
          strategy: RetrievalStrategy.BM25,
          confidence: 0.9,
          reasoning: '精确匹配查询，BM25 最适合',
        }

      case QueryType.COMPREHENSIVE:
        return {
          strategy: RetrievalStrategy.HYBRID,
          confidence: 0.75,
          reasoning: '综合问题，需要三路混合检索',
        }

      default:
        return {
          strategy: RetrievalStrategy.VECTOR,
          confidence: 0.7,
          reasoning: '默认使用向量检索',
        }
    }
  }

  /**
   * 统计匹配的模式数量
   */
  private countMatches(query: string, patterns: RegExp[]): number {
    return patterns.filter((pattern) => pattern.test(query)).length
  }

  /**
   * 获取检索渠道列表
   */
  getChannelsForStrategy(strategy: RetrievalStrategy): string[] {
    switch (strategy) {
      case RetrievalStrategy.VECTOR:
        return ['vector']
      case RetrievalStrategy.BM25:
        return ['bm25']
      case RetrievalStrategy.GRAPH:
        return ['graph']
      case RetrievalStrategy.VECTOR_BM25:
        return ['vector', 'bm25']
      case RetrievalStrategy.VECTOR_GRAPH:
        return ['vector', 'graph']
      case RetrievalStrategy.BM25_GRAPH:
        return ['bm25', 'graph']
      case RetrievalStrategy.HYBRID:
        return ['vector', 'bm25', 'graph']
      default:
        return ['vector']
    }
  }
}
