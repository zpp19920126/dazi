import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PatchTaskDto {
  /** close = 提前截止 */
  @IsOptional()
  @IsIn(['close'])
  action?: 'close';

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsISO8601()
  deadline?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  durationSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSpeed?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minAccuracy?: number;

  @IsOptional()
  @IsInt()
  textId?: number;
}
