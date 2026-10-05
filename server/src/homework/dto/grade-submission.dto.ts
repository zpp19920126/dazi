import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GradeSubmissionDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
