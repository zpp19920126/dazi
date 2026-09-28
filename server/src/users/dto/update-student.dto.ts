import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  @MaxLength(50)
  realName?: string;

  @IsOptional()
  @IsIn(['active', 'disabled'], { message: '状态仅支持 active/disabled' })
  status?: 'active' | 'disabled';
}
