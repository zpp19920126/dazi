import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateTextDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(['zh', 'en'])
  language?: 'zh' | 'en';

  @IsOptional()
  @IsInt()
  @Min(1)
  difficulty?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  content?: string;
}
