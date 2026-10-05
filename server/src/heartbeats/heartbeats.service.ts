import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { HeartbeatDto } from './dto/heartbeat.dto.js';

/** 在线判定窗口：心跳更新时间在 60 秒内视为在线 */
const ONLINE_WINDOW_MS = 60_000;

@Injectable()
export class HeartbeatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  /** 学生实时状态上报（UPSERT：每人仅一行，新值覆盖） */
  async upsert(dto: HeartbeatDto, user: { id: number }) {
    // 考勤自动打卡：开课瞬间已在线的学生经心跳补打卡（幂等）
    await this.sessions.tryClockIn(user.id);
    const data = {
      taskId: dto.taskId ?? null,
      status: dto.status,
      speed: dto.speed,
      accuracy: dto.accuracy,
      progress: dto.progress,
      elapsedSeconds: dto.elapsedSeconds,
      charIndex: dto.charIndex,
    };
    return this.prisma.heartbeat.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
  }

  /** 班级实时看板：学生列表 + 在线状态 + 最新心跳 */
  async getLive(classId: number, user: { id: number; role: string }) {
    const klass = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true },
    });
    if (!klass) throw new NotFoundException('班级不存在');
    if (user.role !== 'admin' && klass.teacherId !== user.id) {
      throw new ForbiddenException('无权查看该班级');
    }

    const students = await this.prisma.user.findMany({
      where: { classId, role: 'student' },
      select: {
        id: true,
        realName: true,
        username: true,
        heartbeat: true,
      },
      orderBy: { id: 'asc' },
    });

    const now = Date.now();
    return students.map((s) => ({
      id: s.id,
      realName: s.realName,
      username: s.username,
      online: !!s.heartbeat && now - s.heartbeat.updatedAt.getTime() < ONLINE_WINDOW_MS,
      hb: s.heartbeat
        ? {
            status: s.heartbeat.status,
            speed: s.heartbeat.speed,
            accuracy: s.heartbeat.accuracy,
            progress: s.heartbeat.progress,
            elapsedSeconds: s.heartbeat.elapsedSeconds,
            updatedAt: s.heartbeat.updatedAt,
          }
        : null,
    }));
  }
}
