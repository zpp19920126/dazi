import { Module } from '@nestjs/common';
import { PointsModule } from '../points/points.module.js';
import { HomeworkController } from './homework.controller.js';
import { HomeworkScheduler } from './homework.scheduler.js';
import { HomeworkService } from './homework.service.js';

@Module({
  imports: [PointsModule],
  controllers: [HomeworkController],
  providers: [HomeworkService, HomeworkScheduler],
  exports: [HomeworkService],
})
export class HomeworkModule {}
