import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class SubmitRecordDto {
  /** 任务成绩必传；自由练习不传 → isPassed 为 null */
  @IsOptional()
  @IsInt()
  taskId?: number;

  @IsIn(['article', 'time'])
  mode!: 'article' | 'time';

  @IsNumber()
  @Min(0)
  speed!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  accuracy!: number;

  @IsInt()
  @Min(0)
  totalChars!: number;

  @IsInt()
  @Min(0)
  correctChars!: number;

  @IsInt()
  @Min(0)
  backspaceCount!: number;

  @IsInt()
  @Min(1)
  durationSeconds!: number;
}
