import { Module } from '@nestjs/common';
import { TextsController } from './texts.controller.js';
import { TextsService } from './texts.service.js';

@Module({
  controllers: [TextsController],
  providers: [TextsService],
})
export class TextsModule {}
