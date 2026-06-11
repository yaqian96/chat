import { Injectable, Logger } from '@nestjs/common'
import { HybridSearchService } from '../retrieval/hybrid-search.service'
import type { EvaluationCase } from './dataset'
import { EVALUATION_DATASET, DEFAULT_USER_ID } from './dataset'

export interface CaseResult {
  caseId: string
  query: string
  expectedDocIds: string[]
  retrievedDocIds: string[]
  metrics: {
    recall: number
    precision: number
    mrr: number
    ndcg: number
  }
  channelHits: Record<string, number>
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
  byDifficulty: Record<string, { count: number; avgNdcg: number }>
  byQueryType: Record<string, { count: number; avgNdcg: number }>
  channelDistribution: Record<string, number>
  caseResults: CaseResult[]
}

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name)

  constructor(private readonly search: HybridSearchService) {}

  /** 计算 Recall */
  private calculateRecall(expected: string[], retrieved: string[]): number {
    if (expected.length === 0) return 0
    const relevantRetrieved = expected.filter((id) => retrieved.includes(id))
    return relevantRetrieved.length / expected.length
  }

  /** 计算 Precision */
  private calculatePrecision(expected: string[], retrieved: string[]): number {
    if (retrieved.length === 0) return 0
    const relevantRetrieved = retrieved.filter((id) => expected.includes(id))
    return relevantRetrieved.length / retrieved.length
  }

  /** 计算 MRR (Mean Reciprocal Rank) */
  private calculateMRR(expected: string[], retrieved: string[]): number {
    for (let i = 0; i < retrieved.length; i++) {
      if (expected.includes(retrieved[i])) {
        return 1 / (i + 1)
      }
    }
    return 0
  }

  /** 计算 NDCG@K */
  private calculateNDCG(expected: string[], retrieved: string[], k = 5): number {
    const dcg = retrieved.slice(0, k).reduce((sum, docId, index) => {
      const relevance = expected.includes(docId) ? 1 : 0
      return sum + relevance / Math.log2(index + 2)
    }, 0)

    const idealDcg = expected.slice(0, k).reduce((sum, _, index) => {
      return sum + 1 / Math.log2(index + 2)
    }, 0)

    return idealDcg > 0 ? dcg / idealDcg : 0
  }

  /** 评估单个用例 */
  async evaluateCase(
    testCase: EvaluationCase,
    topK = 5,
  ): Promise<CaseResult> {
    try {
      const result = await this.search.search(testCase.query, {
        userId: DEFAULT_USER_ID,
        topK,
      })

      const retrievedDocIds = result.hits.map((hit) => hit.docId)

      const recall = this.calculateRecall(testCase.expectedDocIds, retrievedDocIds)
      const precision = this.calculatePrecision(testCase.expectedDocIds, retrievedDocIds)
      const mrr = this.calculateMRR(testCase.expectedDocIds, retrievedDocIds)
      const ndcg = this.calculateNDCG(testCase.expectedDocIds, retrievedDocIds, topK)

      // 统计渠道命中
      const channelHits: Record<string, number> = {}
      for (const hit of result.hits) {
        const channel = hit.channel || 'unknown'
        channelHits[channel] = (channelHits[channel] || 0) + 1
      }

      return {
        caseId: testCase.id,
        query: testCase.query,
        expectedDocIds: testCase.expectedDocIds,
        retrievedDocIds,
        metrics: { recall, precision, mrr: mrr, ndcg },
        channelHits,
        difficulty: testCase.difficulty,
        queryType: testCase.queryType,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error(`评估用例 ${testCase.id} 失败：${errorMessage}`)

      return {
        caseId: testCase.id,
        query: testCase.query,
        expectedDocIds: testCase.expectedDocIds,
        retrievedDocIds: [],
        metrics: { recall: 0, precision: 0, mrr: 0, ndcg: 0 },
        channelHits: {},
        difficulty: testCase.difficulty,
        queryType: testCase.queryType,
      }
    }
  }

  /** 运行完整评估集 */
  async runEvaluation(
    cases?: EvaluationCase[],
    topK = 5,
  ): Promise<EvaluationReport> {
    const evalCases = cases ?? EVALUATION_DATASET

    this.logger.log(`开始运行检索评估，共 ${evalCases.length} 个用例`)

    const caseResults = await Promise.all(
      evalCases.map((c) => this.evaluateCase(c, topK)),
    )

    // 计算整体指标
    const avgRecall =
      caseResults.reduce((s, r) => s + r.metrics.recall, 0) / caseResults.length
    const avgPrecision =
      caseResults.reduce((s, r) => s + r.metrics.precision, 0) / caseResults.length
    const avgMrr =
      caseResults.reduce((s, r) => s + r.metrics.mrr, 0) / caseResults.length
    const avgNdcg =
      caseResults.reduce((s, r) => s + r.metrics.ndcg, 0) / caseResults.length

    // 按难度分组
    const byDifficulty: Record<string, { count: number; avgNdcg: number }> = {}
    for (const r of caseResults) {
      const key = r.difficulty || 'unknown'
      if (!byDifficulty[key]) {
        byDifficulty[key] = { count: 0, avgNdcg: 0 }
      }
      const group = byDifficulty[key]
      group.count++
      group.avgNdcg += r.metrics.ndcg
    }
    for (const g of Object.values(byDifficulty)) {
      g.avgNdcg /= g.count
    }

    // 按查询类型分组
    const byQueryType: Record<string, { count: number; avgNdcg: number }> = {}
    for (const r of caseResults) {
      const key = r.queryType || 'unknown'
      if (!byQueryType[key]) {
        byQueryType[key] = { count: 0, avgNdcg: 0 }
      }
      const group = byQueryType[key]
      group.count++
      group.avgNdcg += r.metrics.ndcg
    }
    for (const g of Object.values(byQueryType)) {
      g.avgNdcg /= g.count
    }

    // 渠道分布
    const channelDistribution: Record<string, number> = {}
    for (const r of caseResults) {
      for (const [channel, count] of Object.entries(r.channelHits)) {
        channelDistribution[channel] = (channelDistribution[channel] || 0) + count
      }
    }

    const report: EvaluationReport = {
      totalCases: caseResults.length,
      overallMetrics: { avgRecall, avgPrecision, avgMrr, avgNdcg },
      byDifficulty,
      byQueryType,
      channelDistribution,
      caseResults,
    }

    this.logger.log(
      `评估完成 - avgNDCG: ${avgNdcg.toFixed(3)}, avgRecall: ${avgRecall.toFixed(3)}, avgPrecision: ${avgPrecision.toFixed(3)}, avgMRR: ${avgMrr.toFixed(3)}`,
    )

    return report
  }
}
