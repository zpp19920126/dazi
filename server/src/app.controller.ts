import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Roles } from './auth/decorators/roles.decorator.js';
import { Public } from './auth/decorators/public.decorator.js';
import { CurrentUser } from './auth/decorators/current-user.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @Public()
  health(): { status: string } {
    return { status: 'up' };
  }

  // 【临时端点】仅用于 Task 3 e2e 验证 JWT 认证与角色守卫，后续任务实现 stats 后移除
  // JWT 与角色校验由全局守卫（JwtAuthGuard → RolesGuard）完成
  @Get('admin-only')
  @Roles('admin')
  adminOnly(@CurrentUser() user: { id: number; username: string; realName: string; role: string }) {
    return user;
  }
}
