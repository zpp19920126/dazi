import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { StatsService } from './stats.service.js';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('teacher-dashboard')
  @Roles('teacher')
  teacherDashboard(@CurrentUser() user: { id: number }) {
    return this.statsService.teacherDashboard(user.id);
  }

  @Get('admin-overview')
  @Roles('admin')
  adminOverview() {
    return this.statsService.adminOverview();
  }
}
