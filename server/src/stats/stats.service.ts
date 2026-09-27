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
}
