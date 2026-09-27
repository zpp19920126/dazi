import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PatchUserDto {
  @IsIn(['reset-password', 'disable', 'enable', 'delete'])
  action: 'reset-password' | 'disable' | 'enable' | 'delete';

  @IsOptional()
  @IsString()
  @MinLength(6, { message: '初始密码至少 6 位' })
  @MaxLength(50)
  initialPassword?: string;
}
