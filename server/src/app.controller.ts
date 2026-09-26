import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { Roles } from './auth/decorators/roles.decorator.js';
import { CurrentUser } from './auth/decorators/current-user.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  health(): { status: string } {
    return { status: 'up' };
  }

  // 【临时端点】仅用于 Task 3 e2e 验证 JWT 认证与角色守卫，后续任务实现 stats 后移除
  @Get('admin-only')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  adminOnly(@CurrentUser() user: { id: number; username: string; realName: string; role: string }) {
    return user;
  }
}
