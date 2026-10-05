import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('账号或密码错误');
    }
    if (user.status === 'disabled') throw new UnauthorizedException('账号已停用');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    // 考勤自动打卡：失败绝不影响登录（记日志吞掉）
    if (user.role === 'student') {
      try {
        await this.sessions.tryClockIn(user.id);
      } catch (e) {
        console.error('[tryClockIn]', e);
      }
    }
    return {
      token: this.jwt.sign({ sub: user.id, role: user.role }),
      user: {
        id: user.id,
        username: user.username,
        realName: user.realName,
        role: user.role,
        classId: user.classId,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(dto.oldPassword, user.passwordHash))) {
      throw new BadRequestException('旧密码不正确');
    }
    if (dto.newPassword === dto.oldPassword) {
      throw new BadRequestException('新密码不能与旧密码相同');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, initialPassword: null },
    });
    return null;
  }
}
