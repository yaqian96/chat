import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../../auth/current-user.decorator'
import { JwtAuthGuard } from '../../auth/jwt-auth.guard'
import type { AuthUser } from '../../auth/types'
import type { EvaluationCase } from './dataset'
import { EVALUATION_DATASET } from './dataset'
import { EvaluationService } from './evaluation.service'

@Controller('knowledge/evaluation')
@UseGuards(JwtAuthGuard)
export class EvaluationController {
  constructor(private readonly evaluator: EvaluationService) {}

  @Get('cases')
  getCases() {
    return { 
      total: EVALUATION_DATASET.length, 
      cases: EVALUATION_DATASET,
      format: 'retrieval',
      metrics: ['Recall', 'Precision', 'MRR', 'NDCG', 'Channel Hits'],
    }
  }

  @Post('run')
  async runEvaluation(
    @Query('topK') topK?: string,
  ) {
    return this.evaluator.runEvaluation(
      undefined, // 使用预置数据集
      topK ? Number(topK) : 5,
    )
  }

  @Post('run/custom')
  async runCustomEvaluation(
    @Body() body: { cases: EvaluationCase[]; topK?: number },
  ) {
    return this.evaluator.runEvaluation(
      body.cases,
      body.topK ?? 5,
    )
  }
}
