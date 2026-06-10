import { Injectable } from '@nestjs/common'
import { HybridSearchService } from '../retrieval/hybrid-search.service'
import type { EvaluationCase } from './dataset'

export interface EvaluationMetrics {
  /** 召回率：找到的相关文档数 / 总相关文档数 */
  recall: number
  /** 精确率：找到的相关文档数 / 总返回文档数 */
  precision: number
  /** MRR：第一个相关结果的排名倒数 */
  mrr: number
  /** NDCG@K：归一化折扣累积增益 */
  ndcg: number
  /** 检索渠道命中分布 */
  channelHits: Record<string, number>
}

export interface CaseResult {
  caseId: string
  query: string
  expectedDocIds: string[]
  /** 实际返回的 docId 列表 */
  retrievedDocIds: string[]
  /** 实际返回的 chunkId 列表（去重） */
  retrievedChunkIds: string[]
  metrics: EvaluationMetrics
  difficulty?: string
  queryType?: string
}

export interface EvaluationReport {
  totalCases: number
  overallMetrics: {
    avgRecall: number
    avgPrecision: number
    avgMrr: number
    avgNdcg: number
  }
  byDifficulty: Record<string, { count: number; avgRecall: number; avgPrecision: number }>
  byQueryType: Record<string, { count: number; avgRecall: number; avgPrecision: number }>
  caseResults: CaseResult[]
}

@Injectable()
export class EvaluationService {
  constructor(private readonly search: HybridSearchService) {}

  /** 计算单个用例的指标 */
  private calcMetrics(
    expectedDocIds: string[],
    retrievedDocIds: string[],
    hits: Array<{ docId: string; channel: string }>,
  ): EvaluationMetrics {
    const expectedSet = new Set(expectedDocIds)
    const uniqueRetrievedDocIds = [...new Set(retrievedDocIds)]

    // 找出命中的文档
    const hitDocs = uniqueRetrievedDocIds.filter((id) => expectedSet.has(id))
    const hitCount = hitDocs.length

    // Recall
    const recall = expectedDocIds.length > 0 ? hitCount / expectedDocIds.length : 1

    // Precision
    const precision = uniqueRetrievedDocIds.length > 0 ? hitCount / uniqueRetrievedDocIds.length : 0

    // MRR (Mean Reciprocal Rank) — 第一个命中的排名倒数
    let mrr = 0
    for (let rank = 0; rank < uniqueRetrievedDocIds.length; rank++) {
      if (expectedSet.has(uniqueRetrievedDocIds[rank])) {
        mrr = 1 / (rank + 1)
        break
      }
    }

    // NDCG@K
    const k = Math.max(uniqueRetrievedDocIds.length, expectedDocIds.length)
    let dcg = 0
    let idcg = 0
    for (let i = 0; i < k; i++) {
      const isRelevant =
        i < uniqueRetrievedDocIds.length ? expectedSet.has(uniqueRetrievedDocIds[i]) : false
      dcg += isRelevant ? 1 / Math.log2(i + 2) : 0
      if (i < expectedDocIds.length) {
        idcg += 1 / Math.log2(i + 2)
      }
    }
    const ndcg = idcg > 0 ? dcg / idcg : 0

    // 渠道命中分布
    const channelHits: Record<string, number> = {}
    const seenChannels = new Set<string>()
    for (const hit of hits) {
      if (expectedSet.has(hit.docId) && !seenChannels.has(`${hit.docId}:${hit.channel}`)) {
        seenChannels.add(`${hit.docId}:${hit.channel}`)
        channelHits[hit.channel] = (channelHits[hit.channel] || 0) + 1
      }
    }

    return { recall, precision, mrr, ndcg, channelHits }
  }

  /** 运行单个用例评估 */
  async evaluateCase(
    testCase: EvaluationCase,
    userId: string,
    topK = 5,
  ): Promise<CaseResult> {
    const result = await this.search.search(testCase.query, {
      userId,
      topK,
    })

    // 按检索顺序去重提取 docId
    const retrievedDocIds: string[] = []
    const retrievedChunkIds: string[] = []
    const seenDocs = new Set<string>()
    const seenChunks = new Set<string>()

    for (const hit of result.hits) {
      if (!seenDocs.has(hit.docId)) {
        retrievedDocIds.push(hit.docId)
        seenDocs.add(hit.docId)
      }
      if (!seenChunks.has(hit.chunkId)) {
        retrievedChunkIds.push(hit.chunkId)
        seenChunks.add(hit.chunkId)
      }
      if (retrievedDocIds.length >= topK && retrievedChunkIds.length >= topK) break
    }

    const metrics = this.calcMetrics(
      testCase.expectedDocIds,
      retrievedDocIds,
      result.hits.map((h) => ({ docId: h.docId, channel: h.channel })),
    )

    return {
      caseId: testCase.id,
      query: testCase.query,
      expectedDocIds: testCase.expectedDocIds,
      retrievedDocIds: retrievedDocIds.slice(0, topK),
      retrievedChunkIds: retrievedChunkIds.slice(0, topK),
      metrics,
      difficulty: testCase.difficulty,
      queryType: testCase.queryType,
    }
  }

  /** 运行完整评估集 */
  async runEvaluation(
    cases: EvaluationCase[],
    userId: string,
    topK = 5,
  ): Promise<EvaluationReport> {
    const caseResults = await Promise.all(
      cases.map((c) => this.evaluateCase(c, userId, topK)),
    )

    // Overall metrics
    const avgRecall =
      caseResults.reduce((s, r) => s + r.metrics.recall, 0) / caseResults.length
    const avgPrecision =
      caseResults.reduce((s, r) => s + r.metrics.precision, 0) / caseResults.length
    const avgMrr =
      caseResults.reduce((s, r) => s + r.metrics.mrr, 0) / caseResults.length
    const avgNdcg =
      caseResults.reduce((s, r) => s + r.metrics.ndcg, 0) / caseResults.length

    // Group by difficulty
    const byDifficulty: Record<string, { count: number; avgRecall: number; avgPrecision: number }> = {}
    for (const r of caseResults) {
      const key = r.difficulty || 'unknown'
      if (!byDifficulty[key]) {
        byDifficulty[key] = { count: 0, avgRecall: 0, avgPrecision: 0 }
      }
      const group = byDifficulty[key]
      group.count++
      group.avgRecall += r.metrics.recall
      group.avgPrecision += r.metrics.precision
    }
    for (const g of Object.values(byDifficulty)) {
      g.avgRecall /= g.count
      g.avgPrecision /= g.count
    }

    // Group by query type
    const byQueryType: Record<string, { count: number; avgRecall: number; avgPrecision: number }> = {}
    for (const r of caseResults) {
      const key = r.queryType || 'unknown'
      if (!byQueryType[key]) {
        byQueryType[key] = { count: 0, avgRecall: 0, avgPrecision: 0 }
      }
      const group = byQueryType[key]
      group.count++
      group.avgRecall += r.metrics.recall
      group.avgPrecision += r.metrics.precision
    }
    for (const g of Object.values(byQueryType)) {
      g.avgRecall /= g.count
      g.avgPrecision /= g.count
    }

    return {
      totalCases: caseResults.length,
      overallMetrics: { avgRecall, avgPrecision, avgMrr, avgNdcg },
      byDifficulty,
      byQueryType,
      caseResults,
    }
  }
}
