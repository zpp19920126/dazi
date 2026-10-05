import { Module } from '@nestjs/common';
import { PointsService } from './points.service.js';

@Module({
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
