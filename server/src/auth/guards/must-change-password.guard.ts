import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_MUST_CHANGE_PASSWORD_KEY } from '../decorators/skip-must-change-password.decorator.js';

/** 强改密拦截：初始密码未修改的用户仅放行带 SkipMustChangePassword 标记的接口 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_MUST_CHANGE_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    const { user } = context.switchToHttp().getRequest();
    // @Public 路由（如登录）无 user，直接放行
    if (!user || !user.mustChangePassword) return true;
    throw new ForbiddenException('请先修改初始密码');
  }
}
