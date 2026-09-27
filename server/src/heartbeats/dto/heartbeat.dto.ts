import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class HeartbeatDto {
  @IsOptional()
  @IsInt()
  taskId?: number | null;

  @IsIn(['typing', 'paused', 'finished'])
  status!: 'typing' | 'paused' | 'finished';

  @IsNumber()
  @Min(0)
  speed!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  accuracy!: number;

  @IsNumber()
  @Min(0)
  progress!: number;

  @IsInt()
  @Min(0)
  elapsedSeconds!: number;

  @IsInt()
  @Min(0)
  charIndex!: number;
}
