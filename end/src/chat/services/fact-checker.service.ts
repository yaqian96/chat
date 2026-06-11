import { Injectable, Logger } from '@nestjs/common'
import { Neo4jClient } from '../../knowledge/retrieval/clients/neo4j.client'
import neo4j from 'neo4j-driver'

export interface FactCheckResult {
  /** 原始陈述 */
  statement: string
  /** 是否通过核查 */
  passed: boolean
  /** 核查结果说明 */
  reason: string
  /** 图谱中的证据（如果有） */
  evidence?: {
    sourceNode: string
    targetNode: string
    relationship: string
    direction: 'correct' | 'reversed' | 'missing'
  }
  /** 建议的修正（如果有） */
  correction?: string
}

export interface ExtractedFact {
  /** 事实陈述 */
  statement: string
  /** 事实类型 */
  type: 'relationship' | 'attribute' | 'event'
  /** 提取的实体（主语） */
  subject?: string
  /** 提取的关系/属性 */
  predicate?: string
  /** 提取的客体（宾语） */
  object?: string
  /** 置信度 */
  confidence: number
}

@Injectable()
export class FactChecker {
  private readonly logger = new Logger(FactChecker.name)

  constructor(private readonly neo4j: Neo4jClient) {}

  /**
   * 从回答中提取事实陈述
   */
  async extractFacts(text: string): Promise<ExtractedFact[]> {
    // 简单实现：基于规则提取关系型陈述
    // 实际应用中可以使用 LLM 进行更精确的提取
    const facts: ExtractedFact[] = []

    // 匹配 "A 收购了 B"、"A 是 B 的子公司" 等模式
    const relationshipPatterns = [
      {
        regex: /([^\s,]+)\s*(收购 | 并购 | 合并)\s*了?\s*([^\s,.]+)/g,
        type: 'relationship' as const,
        predicate: 'ACQUIRED',
      },
      {
        regex: /([^\s,]+)\s*是\s*([^\s,]+)\s*的 (子公司 | 母公司 | 部门 | 产品)/g,
        type: 'relationship' as const,
        predicate: 'SUBSIDIARY_OF',
      },
      {
        regex: /([^\s,]+)\s*(投资 | 持股)\s*了?\s*([^\s,.]+)/g,
        type: 'relationship' as const,
        predicate: 'INVESTED_IN',
      },
      {
        regex: /([^\s,]+)\s*成立 | 创建于\s*(\d{4})\s*年/g,
        type: 'event' as const,
        predicate: 'FOUNDED_IN',
      },
    ]

    for (const pattern of relationshipPatterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.regex.exec(text)) !== null) {
        const subject = match[1]?.trim()
        const object = match[3]?.trim() || match[2]?.trim()

        if (subject && object) {
          facts.push({
            statement: match[0],
            type: pattern.type,
            subject,
            predicate: pattern.predicate,
            object,
            confidence: 0.8,
          })
        }
      }
    }

    return facts
  }

  /**
   * 核查单个事实
   */
  async checkFact(fact: ExtractedFact, userId: string): Promise<FactCheckResult> {
    if (!this.neo4j.isAvailable()) {
      return {
        statement: fact.statement,
        passed: false,
        reason: '图谱服务不可用',
      }
    }

    if (!fact.subject || !fact.object || !fact.predicate) {
      return {
        statement: fact.statement,
        passed: false,
        reason: '无法提取完整的三元组',
      }
    }

    const driver = this.neo4j.getDriver()
    const session = driver.session()

    try {
      // 查询图谱中是否存在该关系
      const query = `
        OPTIONAL MATCH (s:Entity {name: $subject})-[r:${fact.predicate}]->(o:Entity {name: $object})
        WHERE s.userId = $userId OR s.userId IS NULL
        RETURN s, r, o, 'correct' as direction
        UNION
        OPTIONAL MATCH (s:Entity {name: $subject})<-[r:${fact.predicate}]-(o:Entity {name: $object})
        WHERE s.userId = $userId OR s.userId IS NULL
        RETURN s, r, o, 'reversed' as direction
      `

      const result = await session.run(query, {
        subject: fact.subject,
        object: fact.object,
        userId,
      })

      if (result.records.length === 0) {
        // 关系不存在，尝试查找相似关系
        const similarQuery = `
          MATCH (s:Entity)-[r]-(o:Entity)
          WHERE (s.name CONTAINS $subject OR $subject CONTAINS s.name)
            AND (o.name CONTAINS $object OR $object CONTAINS o.name)
          RETURN s.name as sName, o.name as oName, type(r) as relType, 
                 CASE WHEN s.name CONTAINS $subject THEN 'reversed' ELSE 'correct' END as direction
          LIMIT 1
        `

        const similarResult = await session.run(similarQuery, {
          subject: fact.subject,
          object: fact.object,
        })

        if (similarResult.records.length > 0) {
          const record = similarResult.records[0]
          const sName = record.get('sName') as string
          const oName = record.get('oName') as string
          const relType = record.get('relType') as string
          const direction = record.get('direction') as 'correct' | 'reversed'

          return {
            statement: fact.statement,
            passed: false,
            reason: `关系不存在，但发现相似关系：${sName}-[${relType}]->${oName}`,
            evidence: {
              sourceNode: sName,
              targetNode: oName,
              relationship: relType,
              direction,
            },
            correction: `${sName} ${this.relTypeToChinese(relType)} ${oName}`,
          }
        }

        return {
          statement: fact.statement,
          passed: false,
          reason: '图谱中未找到该关系',
        }
      }

      // 检查第一条匹配的记录
      const record = result.records[0]
      const direction = record.get('direction') as 'correct' | 'reversed'

      if (direction === 'reversed') {
        const s = record.get('s').properties as Record<string, unknown>
        const o = record.get('o').properties as Record<string, unknown>

        return {
          statement: fact.statement,
          passed: false,
          reason: '关系方向相反',
          evidence: {
            sourceNode: String(o.name ?? ''),
            targetNode: String(s.name ?? ''),
            relationship: fact.predicate,
            direction: 'reversed',
          },
          correction: `${o.name} ${this.relTypeToChinese(fact.predicate)} ${s.name}`,
        }
      }

      return {
        statement: fact.statement,
        passed: true,
        reason: '图谱验证通过',
        evidence: {
          sourceNode: fact.subject,
          targetNode: fact.object,
          relationship: fact.predicate,
          direction: 'correct',
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger.error(`Fact check failed: ${errorMessage}`)

      return {
        statement: fact.statement,
        passed: false,
        reason: `核查失败：${errorMessage}`,
      }
    } finally {
      await session.close()
    }
  }

  /**
   * 核查整个回答
   */
  async checkResponse(
    responseText: string,
    userId: string,
  ): Promise<{
    facts: ExtractedFact[]
    results: FactCheckResult[]
    hasHallucination: boolean
    failedFacts: FactCheckResult[]
  }> {
    const facts = await this.extractFacts(responseText)

    if (facts.length === 0) {
      return {
        facts: [],
        results: [],
        hasHallucination: false,
        failedFacts: [],
      }
    }

    const results = await Promise.all(
      facts.map((fact) => this.checkFact(fact, userId)),
    )

    const failedFacts = results.filter((r) => !r.passed)

    return {
      facts,
      results,
      hasHallucination: failedFacts.length > 0,
      failedFacts,
    }
  }

  /**
   * 将关系类型转换为中文描述
   */
  private relTypeToChinese(relType: string): string {
    const mapping: Record<string, string> = {
      ACQUIRED: '收购了',
      SUBSIDIARY_OF: '是',
      INVESTED_IN: '投资了',
      FOUNDED_IN: '成立于',
      PART_OF: '属于',
      PRODUCES: '生产',
      LOCATED_IN: '位于',
    }
    return mapping[relType] || relType
  }
}
