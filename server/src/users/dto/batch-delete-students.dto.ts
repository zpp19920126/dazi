import { ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';

export class BatchDeleteStudentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true, message: '学生 id 非法' })
  ids: number[];
}
