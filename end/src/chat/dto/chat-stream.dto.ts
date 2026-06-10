import { IsString, MinLength } from 'class-validator'

export class ChatStreamDto {
  @IsString()
  @MinLength(1)
  message!: string
}
