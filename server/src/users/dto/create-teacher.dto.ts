import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateTeacherDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  realName: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,50}$/, { message: '用户名需为 3-50 位字母、数字或下划线' })
  username?: string;
}
