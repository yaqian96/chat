import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { EVALUATION_DATASET } from '../src/knowledge/evaluation/dataset'
import { EvaluationService } from '../src/knowledge/evaluation/evaluation.service'

/**
 * 独立运行 RAG 评估脚本
 *
 * 使用方式:
 *   cd end
 *   npx --yes ts-node scripts/run-evaluation.ts
 */
async function bootstrap() {
  console.log(' 启动评估应用...')

  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const evaluator = app.get(EvaluationService)

    console.log(` 开始评估 ${EVALUATION_DATASET.length} 个测试用例...\n`)

    // Run cases one by one to avoid parallel ES timeouts
    const caseResults: Awaited<ReturnType<typeof evaluator['evaluateCase']>>[] = []

    for (const testCase of EVALUATION_DATASET) {
      process.stdout.write(`  评估 [${testCase.id}] ${testCase.query}... `)
      try {
        const result = await evaluator.evaluateCase(testCase, 'demo_user_001', 5)
        caseResults.push(result)
        const status = result.metrics.recall >= 0.5 ? '' : ''
        console.log(`Recall=${(result.metrics.recall * 100).toFixed(0)}% Prec=${(result.metrics.precision * 100).toFixed(0)}% ${status}`)
      } catch (error) {
        console.log(' FAILED')
        console.log(`    Error: ${error instanceof Error ? error.message : String(error)}`)
        caseResults.push({
          caseId: testCase.id,
          query: testCase.query,
          expectedDocIds: testCase.expectedDocIds,
          retrievedDocIds: [],
          retrievedChunkIds: [],
          metrics: { recall: 0, precision: 0, mrr: 0, ndcg: 0, channelHits: {} },
          difficulty: testCase.difficulty,
          queryType: testCase.queryType,
        })
      }
    }

    // Calculate overall metrics
    const avgRecall = caseResults.reduce((s, r) => s + r.metrics.recall, 0) / caseResults.length
    const avgPrecision = caseResults.reduce((s, r) => s + r.metrics.precision, 0) / caseResults.length
    const avgMrr = caseResults.reduce((s, r) => s + r.metrics.mrr, 0) / caseResults.length
    const avgNdcg = caseResults.reduce((s, r) => s + r.metrics.ndcg, 0) / caseResults.length

    // By difficulty
    const byDifficulty: Record<string, { count: number; avgRecall: number; avgPrecision: number }> = {}
    for (const r of caseResults) {
      const key = r.difficulty || 'unknown'
      if (!byDifficulty[key]) byDifficulty[key] = { count: 0, avgRecall: 0, avgPrecision: 0 }
      byDifficulty[key].count++
      byDifficulty[key].avgRecall += r.metrics.recall
      byDifficulty[key].avgPrecision += r.metrics.precision
    }
    for (const g of Object.values(byDifficulty)) {
      g.avgRecall /= g.count
      g.avgPrecision /= g.count
    }

    // By query type
    const byQueryType: Record<string, { count: number; avgRecall: number; avgPrecision: number }> = {}
    for (const r of caseResults) {
      const key = r.queryType || 'unknown'
      if (!byQueryType[key]) byQueryType[key] = { count: 0, avgRecall: 0, avgPrecision: 0 }
      byQueryType[key].count++
      byQueryType[key].avgRecall += r.metrics.recall
      byQueryType[key].avgPrecision += r.metrics.precision
    }
    for (const g of Object.values(byQueryType)) {
      g.avgRecall /= g.count
      g.avgPrecision /= g.count
    }

    console.log('\n' + '='.repeat(63))
    console.log(' RAG 评估报告')
    console.log('='.repeat(63))
    console.log(`总用例数: ${caseResults.length}`)
    console.log('')
    console.log(' 整体指标:')
    console.log(`  平均召回率 (Recall):     ${(avgRecall * 100).toFixed(1)}%`)
    console.log(`  平均精确率 (Precision):  ${(avgPrecision * 100).toFixed(1)}%`)
    console.log(`  平均 MRR:                ${avgMrr.toFixed(3)}`)
    console.log(`  平均 NDCG:               ${avgNdcg.toFixed(3)}`)
    console.log('')

    console.log('📊 按难度分类:')
    for (const [key, val] of Object.entries(byDifficulty)) {
      console.log(`  ${key}: ${val.count} 用例, 召回率 ${(val.avgRecall * 100).toFixed(1)}%, 精确率 ${(val.avgPrecision * 100).toFixed(1)}%`)
    }
    console.log('')

    console.log('📊 按查询类型分类:')
    for (const [key, val] of Object.entries(byQueryType)) {
      console.log(`  ${key}: ${val.count} 用例, 召回率 ${(val.avgRecall * 100).toFixed(1)}%, 精确率 ${(val.avgPrecision * 100).toFixed(1)}%`)
    }
    console.log('')

    console.log('═'.repeat(63))
    console.log('📋 逐用例详情')
    console.log('═'.repeat(63))
    for (const r of caseResults) {
      const status = r.metrics.recall >= 0.5 ? '' : ''
      console.log(`\n${status} [${r.caseId}] ${r.query}`)
      console.log(`   召回率: ${(r.metrics.recall * 100).toFixed(1)}%  |  精确率: ${(r.metrics.precision * 100).toFixed(1)}%  |  MRR: ${r.metrics.mrr.toFixed(3)}`)
      console.log(`   预期: [${r.expectedDocIds.map(id => id.slice(0, 8)).join(', ')}...]`)
      if (r.retrievedDocIds.length > 0) {
        console.log(`   召回: [${r.retrievedDocIds.map(id => id.slice(0, 8)).join(', ')}...]`)
      } else {
        console.log(`   召回: (无结果)`)
      }
      if (Object.keys(r.metrics.channelHits).length > 0) {
        console.log(`   渠道命中: ${JSON.stringify(r.metrics.channelHits)}`)
      }
    }

    console.log('\n' + '='.repeat(63))
    console.log(' 评估完成')
    console.log('='.repeat(63))
  } catch (error) {
    console.error(' 评估失败:', error)
  } finally {
    await app.close()
  }
}

bootstrap().catch((e) => {
  console.error(e)
  process.exit(1)
})
