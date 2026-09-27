import { IsIn } from 'class-validator';

export class TextStatusDto {
  @IsIn(['offline', 'published'])
  status: 'offline' | 'published';
}
