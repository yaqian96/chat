import { IsIn, IsString } from 'class-validator'
import type { MessageRole } from '../types'

export class CreateMessageDto {
  @IsIn(['user', 'assistant'])
  role!: MessageRole

  @IsString()
  content!: string
}
