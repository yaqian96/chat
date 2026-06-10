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
    return { total: EVALUATION_DATASET.length, cases: EVALUATION_DATASET }
  }

  @Post('run')
  async runEvaluation(
    @CurrentUser() user: AuthUser,
    @Query('topK') topK?: string,
  ) {
    return this.evaluator.runEvaluation(
      EVALUATION_DATASET,
      user.id,
      topK ? Number(topK) : 5,
    )
  }

  @Post('run/custom')
  async runCustomEvaluation(
    @Body() body: { cases: EvaluationCase[]; topK?: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.evaluator.runEvaluation(
      body.cases,
      user.id,
      body.topK ?? 5,
    )
  }
}
