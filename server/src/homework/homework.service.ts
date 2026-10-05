import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  /** 分角色作业列表：teacher=本人班；admin=全部(可按班过滤)；student=本班全部状态+本人提交（规格 §6） */
  async list(actor: Actor, opts: { classId?: number; status?: string; page: number; pageSize: number }) {
    const page = Math.max(1, Math.floor(opts.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize) || 20));

    if (actor.role === 'student') {
      const me = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { classId: true } });
      if (!me?.classId) return { list: [], total: 0, page, pageSize };
      const where: Prisma.HomeworkWhereInput = { classId: me.classId };
      if (opts.status === 'published' || opts.status === 'closed') where.status = opts.status;
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.homework.findMany({
          where,
          orderBy: { dueAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { klass: { select: { name: true } } },
        }),
        this.prisma.homework.count({ where }),
      ]);
      const mine = await this.prisma.homeworkSubmission.findMany({
        where: { userId: actor.id, homeworkId: { in: rows.map((r) => r.id) } },
        include: { files: { select: { id: true, originalName: true, sizeBytes: true } } },
      });
      const map = new Map(mine.map((s) => [s.homeworkId, s]));
      return { list: rows.map((r) => ({ ...r, mySubmission: map.get(r.id) ?? null })), total, page, pageSize };
    }

    const where: Prisma.HomeworkWhereInput = {};
    if (actor.role === 'teacher') where.klass = { teacherId: actor.id };
    if (opts.classId) {
      const klass = await this.prisma.class.findUnique({ where: { id: opts.classId } });
      if (!klass) throw new NotFoundException('班级不存在');
      if (actor.role === 'teacher' && klass.teacherId !== actor.id) {
        throw new ForbiddenException('无权查看该班级作业');
      }
      where.classId = opts.classId;
    }
    if (opts.status === 'published' || opts.status === 'closed') where.status = opts.status;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.homework.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          klass: { select: { name: true, _count: { select: { students: true } } } },
          _count: { select: { submissions: true } },
        },
      }),
      this.prisma.homework.count({ where }),
    ]);
    const graded = await this.prisma.homeworkSubmission.groupBy({
      by: ['homeworkId'],
      where: { homeworkId: { in: rows.map((r) => r.id) }, score: { not: null } },
      _count: { _all: true },
    });
    const gmap = new Map(graded.map((g) => [g.homeworkId, g._count._all]));
    return {
      list: rows.map((r) => ({
        id: r.id,
        classId: r.classId,
        className: r.klass.name,
        studentCount: r.klass._count.students,
        title: r.title,
        content: r.content,
        dueAt: r.dueAt,
        allowAttachment: r.allowAttachment,
        status: r.status,
        createdAt: r.createdAt,
        submissionCount: r._count.submissions,
        gradedCount: gmap.get(r.id) ?? 0,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 作业详情：教师/admin=提交全集（批改视图数据源），学生=本人提交 */
  async detail(id: number, actor: Actor) {
    const hw = await this.prisma.homework.findUnique({
      where: { id },
      include: { klass: { select: { id: true, name: true, teacherId: true } } },
    });
    if (!hw) throw new NotFoundException('作业不存在');

    if (actor.role === 'student') {
      const me = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { classId: true } });
      if (!me?.classId || me.classId !== hw.classId) throw new ForbiddenException('无权查看该作业');
      const mine = await this.prisma.homeworkSubmission.findUnique({
        where: { homeworkId_userId: { homeworkId: id, userId: actor.id } },
        include: { files: { select: { id: true, originalName: true, sizeBytes: true } } },
      });
      return { homework: hw, mySubmission: mine };
    }
    if (actor.role === 'teacher' && hw.klass.teacherId !== actor.id) {
      throw new ForbiddenException('无权查看该作业');
    }
    const [submissions, studentCount] = await Promise.all([
      this.prisma.homeworkSubmission.findMany({
        where: { homeworkId: id },
        orderBy: { id: 'asc' },
        include: {
          user: { select: { id: true, realName: true, username: true } },
          files: { select: { id: true, originalName: true, sizeBytes: true, mimeType: true } },
        },
      }),
      this.prisma.user.count({ where: { classId: hw.classId, role: 'student' } }),
    ]);
    return {
      homework: hw,
      studentCount,
      unsubmittedCount: studentCount - submissions.length,
      submissions: submissions.map((s) => ({
        id: s.id,
        userId: s.userId,
        realName: s.user.realName,
        username: s.user.username,
        textContent: s.textContent,
        submittedAt: s.submittedAt,
        isLate: s.isLate,
        score: s.score,
        teacherComment: s.teacherComment,
        files: s.files,
      })),
    };
  }
}
