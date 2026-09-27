import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { PatchTaskDto } from './dto/patch-task.dto.js';

interface CurrentUser {
  id: number;
  role: string;
}

const taskInclude = {
  klass: {
    select: { id: true, name: true, _count: { select: { students: true } } },
  },
  text: {
    select: {
      id: true,
      title: true,
      language: true,
      difficulty: true,
      charCount: true,
      content: true,
    },
  },
  _count: { select: { records: true } },
} satisfies Prisma.TaskInclude;

type TaskWithRefs = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

function toDto(task: TaskWithRefs) {
  return {
    id: task.id,
    classId: task.classId,
    className: task.klass.name,
    classSize: task.klass._count.students,
    textId: task.textId,
    text: task.text,
    title: task.title,
    mode: task.mode,
    durationSeconds: task.durationSeconds,
    minSpeed: task.minSpeed,
    minAccuracy: task.minAccuracy,
    deadline: task.deadline,
    status: task.status,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    submittedCount: task._count.records,
  };
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  /** 学生 → { active, history }（按班级）；教师 → 本人所管班级；admin → 全部 */
  async listTasks(user: CurrentUser, page: number, pageSize: number) {
    const now = new Date();

    if (user.role === 'student') {
      const me = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { classId: true },
      });
      const classId = me?.classId ?? null;
      if (!classId) return { active: [], history: [] };

      const [active, history] = await this.prisma.$transaction([
        this.prisma.task.findMany({
          where: { classId, status: 'published', deadline: { gt: now } },
          orderBy: { deadline: 'asc' },
          include: taskInclude,
        }),
        this.prisma.task.findMany({
          where: {
            classId,
            OR: [{ status: 'closed' }, { deadline: { lte: now } }],
          },
          orderBy: { deadline: 'desc' },
          include: { ...taskInclude, records: { where: { userId: user.id } } },
        }),
      ]);

      return {
        active: active.map(toDto),
        history: history.map((task) => ({
          ...toDto(task),
          myRecord: task.records[0] ?? null,
        })),
      };
    }

    const where: Prisma.TaskWhereInput =
      user.role === 'teacher' ? { klass: { teacherId: user.id } } : {};

    const [list, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: taskInclude,
      }),
      this.prisma.task.count({ where }),
    ]);
    return { list: list.map(toDto), total, page, pageSize };
  }

  async createTask(dto: CreateTaskDto, user: CurrentUser) {
    const klass = await this.prisma.class.findUnique({ where: { id: dto.classId } });
    if (!klass) throw new NotFoundException('班级不存在');
    if (user.role !== 'admin' && klass.teacherId !== user.id) {
      throw new ForbiddenException('无权操作该班级');
    }

    await this.assertTextUsable(dto.textId, user);

    if (new Date(dto.deadline).getTime() <= Date.now()) {
      throw new BadRequestException('截止时间必须晚于当前时间');
    }

    const task = await this.prisma.task.create({
      data: {
        classId: dto.classId,
        textId: dto.textId,
        title: dto.title,
        mode: dto.mode,
        durationSeconds: dto.durationSeconds ?? null,
        minSpeed: dto.minSpeed,
        minAccuracy: dto.minAccuracy,
        deadline: new Date(dto.deadline),
        createdBy: user.id,
      },
      include: taskInclude,
    });
    return toDto(task);
  }

  /** action=close 提前截止；其余为字段编辑 */
  async updateTask(id: number, dto: PatchTaskDto, user: CurrentUser) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在');
    if (user.role !== 'admin' && task.createdBy !== user.id) {
      throw new ForbiddenException('无权操作该任务');
    }

    if (dto.action === 'close') {
      const closed = await this.prisma.task.update({
        where: { id },
        data: { status: 'closed' },
        include: taskInclude,
      });
      return toDto(closed);
    }

    const data: Prisma.TaskUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.deadline !== undefined) {
      if (new Date(dto.deadline).getTime() <= Date.now()) {
        throw new BadRequestException('截止时间必须晚于当前时间');
      }
      data.deadline = new Date(dto.deadline);
    }
    if (dto.durationSeconds !== undefined) data.durationSeconds = dto.durationSeconds;
    if (dto.minSpeed !== undefined) data.minSpeed = dto.minSpeed;
    if (dto.minAccuracy !== undefined) data.minAccuracy = dto.minAccuracy;
    if (dto.textId !== undefined && dto.textId !== task.textId) {
      await this.assertTextUsable(dto.textId, user);
      data.text = { connect: { id: dto.textId } };
    }

    const updated = await this.prisma.task.update({
      where: { id },
      data,
      include: taskInclude,
    });
    return toDto(updated);
  }

  /** 文章必须 published，且 admin 可用全部，教师可用内置/本人自建 */
  private async assertTextUsable(textId: number, user: CurrentUser) {
    const text = await this.prisma.text.findUnique({ where: { id: textId } });
    if (!text) throw new NotFoundException('文章不存在');
    const usable =
      text.status === 'published' &&
      (user.role === 'admin' || text.createdBy === null || text.createdBy === user.id);
    if (!usable) throw new ForbiddenException('无权使用该文章');
  }
}
