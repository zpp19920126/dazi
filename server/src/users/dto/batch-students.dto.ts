import { ArrayNotEmpty, IsArray, IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class BatchStudentsDto {
  @IsInt()
  classId: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(50, { each: true })
  names: string[];
}
