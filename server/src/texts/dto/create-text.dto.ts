import { IsIn, IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class CreateTextDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsIn(['zh', 'en'])
  language: 'zh' | 'en';

  @IsInt()
  @Min(1)
  difficulty: number;

  @IsString()
  @IsNotEmpty()
  content: string;
}
