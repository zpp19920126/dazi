// server/src/homework/dto/create-submission.dto.ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateSubmissionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  textContent!: string;
}
