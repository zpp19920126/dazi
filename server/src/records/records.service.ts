import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubmitRecordDto } from './dto/submit-record.dto.js';

/** 可疑速度阈值（字/分） */
const SUSPICIOUS_SPEED = 600;

interface GradesOptions {
  page: number;
  pageSize: number;
  exportCsv?: string;
}

@Injectable()
export class RecordsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 交卷：服务端重算 isPassed/isSuspicious，事务内清空心跳；同任务重复交卷 409 */
  async submit(dto: SubmitRecordDto, user: { id: number }) {
    let isPassed: boolean | null = null;

    if (dto.taskId) {
      const task = await this.prisma.task.findUnique({ where: { id: dto.taskId } });
      if (!task) throw new NotFoundException('任务不存在');

      const me = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { classId: true },
      });
      if (!me?.classId || me.classId !== task.classId) {
        throw new ForbiddenException('无权提交该任务');
      }

      const existed = await this.prisma.record.findFirst({
        where: { userId: user.id, taskId: dto.taskId },
      });
      if (existed) throw new ConflictException('该任务已提交过');

      isPassed = Number(dto.speed) >= task.minSpeed && Number(dto.accuracy) >= task.minAccuracy;
    }

    const isSuspicious = Number(dto.speed) > SUSPICIOUS_SPEED;

    const [record] = await this.prisma.$transaction([
      this.prisma.record.create({
        data: {
          userId: user.id,
          taskId: dto.taskId ?? null,
          mode: dto.mode,
          speed: dto.speed,
          accuracy: dto.accuracy,
          totalChars: dto.totalChars,
          correctChars: dto.correctChars,
          backspaceCount: dto.backspaceCount,
          durationSeconds: dto.durationSeconds,
          isPassed,
          isSuspicious,
        },
      }),
      this.prisma.heartbeat.deleteMany({ where: { userId: user.id } }),
    ]);
    return record;
  }

  /** 我的成绩（含任务标题） */
  async listMine(userId: number, page: number, pageSize: number) {
    const where: Prisma.RecordWhereInput = { userId };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.record.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { task: { select: { id: true, title: true, mode: true } } },
      }),
      this.prisma.record.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  /** 任务成绩单：JSON 分页 + 全量统计；export=csv 时返回原始 CSV 文本 */
  async getGrades(taskId: number, user: { id: number; role: string }, opts: GradesOptions) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { klass: { select: { teacherId: true } } },
    });
    if (!task) throw new NotFoundException('任务不存在');
    if (user.role !== 'admin' && task.klass.teacherId !== user.id) {
      throw new ForbiddenException('无权查看该任务成绩');
    }

    const where: Prisma.RecordWhereInput = { taskId };

    if (opts.exportCsv) {
      const rows = await this.prisma.record.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { realName: true, username: true } } },
      });
      return this.toCsv(rows);
    }

    const [list, total, agg, passed] = await this.prisma.$transaction([
      this.prisma.record.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: { user: { select: { id: true, realName: true, username: true } } },
      }),
      this.prisma.record.count({ where }),
      this.prisma.record.aggregate({ where, _avg: { speed: true, accuracy: true } }),
      this.prisma.record.count({ where: { taskId, isPassed: true } }),
    ]);

    return {
      list,
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      stats: {
        avgSpeed: agg._avg.speed ? Number(agg._avg.speed.toFixed(2)) : 0,
        avgAccuracy: agg._avg.accuracy ? Number(agg._avg.accuracy.toFixed(2)) : 0,
        passedRate: total > 0 ? Number(((passed / total) * 100).toFixed(2)) : 0,
      },
    };
  }

  /** Excel 兼容：UTF-8 BOM 前置，数字保留 2 位小数 */
  private toCsv(
    rows: Array<
      Prisma.RecordGetPayload<{ include: { user: { select: { realName: true; username: true } } } }>
    >,
  ) {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = ['姓名,用户名,速度(字/分),准确率(%),用时(秒),是否达标,可疑,交卷时间'];
    for (const r of rows) {
      lines.push(
        [
          esc(r.user.realName),
          esc(r.user.username),
          Number(r.speed).toFixed(2),
          Number(r.accuracy).toFixed(2),
          r.durationSeconds,
          r.isPassed ? '是' : '否',
          r.isSuspicious ? '是' : '否',
          new Date(r.createdAt).toISOString().slice(0, 19).replace('T', ' '),
        ].join(','),
      );
    }
    return `\uFEFF${lines.join('\r\n')}`;
  }
}
