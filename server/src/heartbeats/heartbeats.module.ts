import { Module } from '@nestjs/common';
import { HeartbeatsController } from './heartbeats.controller.js';
import { HeartbeatsService } from './heartbeats.service.js';

@Module({
  controllers: [HeartbeatsController],
  providers: [HeartbeatsService],
})
export class HeartbeatsModule {}
