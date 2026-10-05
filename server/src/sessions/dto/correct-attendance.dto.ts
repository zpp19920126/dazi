import { IsIn, IsOptional, MaxLength } from 'class-validator';

export class CorrectAttendanceDto {
  @IsIn(['absent', 'present', 'late', 'excused', 'sick'])
  status!: 'absent' | 'present' | 'late' | 'excused' | 'sick';

  @IsOptional()
  @MaxLength(200)
  note?: string;
}
