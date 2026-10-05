import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { HeartbeatsController } from './heartbeats.controller.js';
import { HeartbeatsService } from './heartbeats.service.js';

@Module({
  imports: [SessionsModule],
  controllers: [HeartbeatsController],
  providers: [HeartbeatsService],
})
export class HeartbeatsModule {}
