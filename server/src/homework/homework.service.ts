import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PointsService } from '../points/points.service.js';
import { POINT_HOMEWORK_ONTIME } from '../points/points.constants.js';
import { CreateHomeworkDto } from './dto/create-homework.dto.js';
import { UpdateHomeworkDto } from './dto/update-homework.dto.js';

interface Actor {
  id: number;
  role: string;
}

@Injectable()
export class HomeworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
  ) {}

  /** 布置作业：仅本人班级（教师） */
  async create(dto: CreateHomeworkDto, teacher: Actor) {
    const klass = await this.prisma.class.findUnique({ where: { id: dto.classId } });
    if (!klass) throw new NotFoundException('班级不存在');
    if (klass.teacherId !== teacher.id) throw new ForbiddenException('无权在该班布置作业');
    return this.prisma.homework.create({
      data: {
        classId: dto.classId,
        title: dto.title,
        content: dto.content,
        dueAt: new Date(dto.dueAt),
        allowAttachment: dto.allowAttachment,
        createdBy: teacher.id,
      },
    });
  }

  /** 编辑（published 限定）与手动截止；截止与 cron 同构：先幂等结算，最后翻状态（结课重入模式） */
  async update(id: number, dto: UpdateHomeworkDto, teacher: Actor) {
    const hw = await this.prisma.homework.findUnique({
      where: { id },
      include: { klass: { select: { teacherId: true } } },
    });
    if (!hw) throw new NotFoundException('作业不存在');
    if (hw.klass.teacherId !== teacher.id) throw new ForbiddenException('无权操作该作业');

    if (dto.status === 'closed') {
      if (hw.status === 'closed') throw new ConflictException('作业已截止');
      await this.settle(id);
      return this.prisma.homework.update({ where: { id }, data: { status: 'closed' } });
    }
    if (hw.status === 'closed') throw new ConflictException('作业已截止，不可编辑');
    return this.prisma.homework.update({
      where: { id },
      data: {
        title: dto.title,
        content: dto.content,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        allowAttachment: dto.allowAttachment,
      },
    });
  }

  /** 按时提交 +2：唯一键幂等，可安全重跑（规格 §5.3/§5.5） */
  async settle(homeworkId: number): Promise<void> {
    const hw = await this.prisma.homework.findUnique({
      where: { id: homeworkId },
      select: { id: true, title: true },
    });
    if (!hw) return;
    const onTime = await this.prisma.homeworkSubmission.findMany({
      where: { homeworkId, isLate: false },
      select: { userId: true },
    });
    for (const row of onTime) {
      await this.points.award({
        userId: row.userId,
        delta: POINT_HOMEWORK_ONTIME,
        source: 'auto_homework',
        refId: homeworkId,
        reason: `按时提交作业 · ${hw.title}`,
      });
    }
  }
}
