import { IsBoolean, IsDateString, IsInt, IsString, MaxLength, Min } from 'class-validator';

export class CreateHomeworkDto {
  @IsInt()
  @Min(1)
  classId!: number;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(10000)
  content!: string;

  @IsDateString()
  dueAt!: string;

  @IsBoolean()
  allowAttachment!: boolean;
}
