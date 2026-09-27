import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateTaskDto {
  @IsInt()
  classId!: number;

  @IsInt()
  textId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsIn(['article', 'time'])
  mode!: 'article' | 'time';

  /** time 模式必填；article 模式不传 */
  @ValidateIf((o) => o.mode === 'time')
  @IsInt()
  @Min(10)
  durationSeconds?: number;

  @IsInt()
  @Min(0)
  minSpeed!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  minAccuracy!: number;

  @IsISO8601()
  deadline!: string;
}
