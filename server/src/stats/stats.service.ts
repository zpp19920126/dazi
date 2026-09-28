import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 教师工作台汇总：班级数 / 学生数 / 进行中任务数 / 任务平均速度 */
  async teacherDashboard(teacherId: number) {
    const [classCount, studentCount, activeTaskCount, agg] = await Promise.all([
      this.prisma.class.count({ where: { teacherId } }),
      this.prisma.user.count({ where: { role: 'student', class: { teacherId } } }),
      this.prisma.task.count({ where: { createdBy: teacherId, status: 'published' } }),
      this.prisma.record.aggregate({
        where: { task: { createdBy: teacherId } },
        _avg: { speed: true },
      }),
    ]);
    return {
      classCount,
      studentCount,
      activeTaskCount,
      avgSpeed: agg._avg.speed,
    };
  }

  /** 系统概览：教师 / 学生 / 班级 / 累计练习 / 今日活跃（今日交卷或有心跳的去重人数） */
  async adminOverview() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [teacherCount, studentCount, classCount, recordCount, todayRecordUsers, todayHbUsers] =
      await Promise.all([
        this.prisma.user.count({ where: { role: 'teacher' } }),
        this.prisma.user.count({ where: { role: 'student' } }),
        this.prisma.class.count(),
        this.prisma.record.count(),
        this.prisma.record.findMany({
          where: { createdAt: { gte: startOfToday } },
          distinct: ['userId'],
          select: { userId: true },
        }),
        this.prisma.heartbeat.findMany({
          where: { updatedAt: { gte: startOfToday } },
          select: { userId: true },
        }),
      ]);
    const todayActive = new Set([...todayRecordUsers, ...todayHbUsers].map((u) => u.userId)).size;
    return { teacherCount, studentCount, classCount, recordCount, todayActive };
  }
}
