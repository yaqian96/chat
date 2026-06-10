import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class SearchDto {
  @IsString()
  query!: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number
}
