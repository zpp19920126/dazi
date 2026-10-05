import { IsInt, IsOptional, MaxLength, Min } from 'class-validator';

export class OpenSessionDto {
  @IsInt()
  @Min(1)
  classId!: number;

  @IsOptional()
  @MaxLength(20)
  period?: string;
}
