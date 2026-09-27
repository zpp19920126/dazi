import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateClassDto } from './dto/create-class.dto.js';

@Injectable()
export class ClassesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 教师只看自己的班级，admin 看全部 */
  async listClasses(user: { id: number; role: string }) {
    const where = user.role === 'admin' ? {} : { teacherId: user.id };
    const list = await this.prisma.class.findMany({
      where,
      orderBy: { id: 'desc' },
      include: { _count: { select: { students: true } } },
    });
    return {
      list: list.map((k) => ({
        id: k.id,
        name: k.name,
        teacherId: k.teacherId,
        createdAt: k.createdAt,
        studentCount: k._count.students,
      })),
      total: list.length,
    };
  }

  async createClass(dto: CreateClassDto, user: { id: number }) {
    const klass = await this.prisma.class.create({
      data: { name: dto.name, teacherId: user.id },
      include: { _count: { select: { students: true } } },
    });
    return {
      id: klass.id,
      name: klass.name,
      teacherId: klass.teacherId,
      createdAt: klass.createdAt,
      studentCount: klass._count.students,
    };
  }

  /** 归属校验：教师只能操作自己的班级，admin 放行 */
  private async assertOwnership(classId: number, user: { id: number; role: string }) {
    const klass = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!klass) throw new NotFoundException('班级不存在');
    if (user.role !== 'admin' && klass.teacherId !== user.id) {
      throw new ForbiddenException('无权操作该班级');
    }
    return klass;
  }

  async renameClass(classId: number, dto: CreateClassDto, user: { id: number; role: string }) {
    await this.assertOwnership(classId, user);
    const klass = await this.prisma.class.update({
      where: { id: classId },
      data: { name: dto.name },
    });
    return { id: klass.id, name: klass.name };
  }

  async deleteClass(classId: number, user: { id: number; role: string }) {
    await this.assertOwnership(classId, user);
    const studentCount = await this.prisma.user.count({ where: { classId } });
    if (studentCount > 0) throw new ConflictException('班级内尚有学生');
    const taskCount = await this.prisma.task.count({ where: { classId } });
    if (taskCount > 0) throw new ConflictException('班级内尚有任务');
    await this.prisma.class.delete({ where: { id: classId } });
    return { id: classId };
  }
}
