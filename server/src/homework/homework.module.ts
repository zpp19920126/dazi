import { Module } from '@nestjs/common';
import { PointsModule } from '../points/points.module.js';
import { FilesController } from './files.controller.js';
import { HomeworkController } from './homework.controller.js';
import { HomeworkScheduler } from './homework.scheduler.js';
import { HomeworkService } from './homework.service.js';
import { SubmissionsService } from './submissions.service.js';

@Module({
  imports: [PointsModule],
  controllers: [HomeworkController, FilesController],
  providers: [HomeworkService, HomeworkScheduler, SubmissionsService],
  exports: [HomeworkService, SubmissionsService],
})
export class HomeworkModule {}
