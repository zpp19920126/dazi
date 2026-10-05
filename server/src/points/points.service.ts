import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AwardParams {
  userId: number;
  delta: number;
  source: 'manual' | 'auto_attendance' | 'auto_homework' | 'auto_typing';
  refId?: number | null;
  reason: string;
  createdBy?: number | null;
}

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 发放积分；自动来源依赖唯一键 (source, refId, userId) 幂等：重复发放返回 false */
  async award(p: AwardParams): Promise<boolean> {
    try {
      await this.prisma.pointRecord.create({
        data: {
          userId: p.userId,
          delta: p.delta,
          reason: p.reason,
          source: p.source,
          refId: p.refId ?? null,
          createdBy: p.createdBy ?? null,
        },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
      throw e;
    }
  }

  async sumByUser(userId: number): Promise<number> {
    const agg = await this.prisma.pointRecord.aggregate({
      where: { userId },
      _sum: { delta: true },
    });
    return agg._sum.delta ?? 0;
  }

  /** 班级学生总分（降序），供积分页/积分通报快照（P3）使用 */
  async classTotals(classId: number): Promise<Array<{ userId: number; realName: string; total: number }>> {
    const students = await this.prisma.user.findMany({
      where: { classId, role: 'student' },
      select: { id: true, realName: true },
      orderBy: { id: 'asc' },
    });
    const rows = await this.prisma.pointRecord.groupBy({
      by: ['userId'],
      where: { userId: { in: students.map((s) => s.id) } },
      _sum: { delta: true },
    });
    const map = new Map(rows.map((r) => [r.userId, r._sum.delta ?? 0]));
    return students
      .map((s) => ({ userId: s.id, realName: s.realName, total: map.get(s.id) ?? 0 }))
      .sort((a, b) => b.total - a.total || a.userId - b.userId);
  }
}
