import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { BatchStudentsDto } from './dto/batch-students.dto.js';
import { CreateTeacherDto } from './dto/create-teacher.dto.js';
import { PatchUserDto } from './dto/patch-user.dto.js';
import { generatePassword } from './utils/password.js';

const USERNAME_SEQ = { t: /^t(\d+)$/, s: /^s(\d+)$/ } as const;
type UsernamePrefix = keyof typeof USERNAME_SEQ;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** 教师分页列表（含班级数，支持用户名/姓名关键字） */
  async listTeachers(page: number, pageSize: number, keyword?: string) {
    const where: Prisma.UserWhereInput = {
      role: 'teacher',
      ...(keyword
        ? { OR: [{ username: { contains: keyword } }, { realName: { contains: keyword } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          realName: true,
          status: true,
          mustChangePassword: true,
          createdAt: true,
          _count: { select: { classes: true } },
        },
        orderBy: { id: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { list: rows.map(({ _count, ...u }) => ({ ...u, classCount: _count.classes })), total };
  }

  /** 新建教师：未指定用户名则按 t 序列自动生成；初始密码明文仅此一次返回 */
  async createTeacher(dto: CreateTeacherDto, createdBy: number) {
    if (dto.username) {
      const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
      if (exists) throw new ConflictException('用户名已存在');
    }
    const username = dto.username ?? (await this.nextUsername('t'));
    const initialPassword = generatePassword();
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          username,
          passwordHash: await bcrypt.hash(initialPassword, 10),
          realName: dto.realName,
          role: 'teacher',
          mustChangePassword: true,
          createdBy,
        },
      });
    } catch (e) {
      // 并发场景下自动生成用户名可能撞唯一约束
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('用户名已存在');
      }
      throw e;
    }
    return { user: this.toVo(user), initialPassword };
  }

  /** 班级学生列表；教师仅限本人班级 */
  async listStudents(classId: number, currentUser: { id: number; role: string }) {
    const klass = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!klass) throw new NotFoundException('班级不存在');
    if (currentUser.role === 'teacher' && klass.teacherId !== currentUser.id) {
      throw new ForbiddenException('无权访问该班级学生');
    }
    const list = await this.prisma.user.findMany({
      where: { role: 'student', classId },
      select: {
        id: true,
        username: true,
        realName: true,
        status: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { username: 'asc' },
    });
    return { list };
  }

  /** 批量生成学生账号：s 序列自动衔接，事务保证同批原子性 */
  async batchStudents(dto: BatchStudentsDto, currentUser: { id: number; role: string }) {
    const klass = await this.prisma.class.findUnique({ where: { id: dto.classId } });
    if (!klass) throw new NotFoundException('班级不存在');
    if (currentUser.role === 'teacher' && klass.teacherId !== currentUser.id) {
      throw new ForbiddenException('无权访问该班级');
    }

    const usernameStart = await this.nextUsername('s');
    let created: Array<{ username: string; realName: string; initialPassword: string }>;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const out: Array<{ username: string; realName: string; initialPassword: string }> = [];
        for (let i = 0; i < dto.names.length; i++) {
          const username = `s${String(Number(usernameStart.slice(1)) + i).padStart(3, '0')}`;
          const initialPassword = generatePassword();
          await tx.user.create({
            data: {
              username,
              passwordHash: await bcrypt.hash(initialPassword, 10),
              realName: dto.names[i],
              role: 'student',
              classId: dto.classId,
              mustChangePassword: true,
              createdBy: currentUser.id,
            },
          });
          out.push({ username, realName: dto.names[i], initialPassword });
        }
        return out;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('学生用户名生成冲突，请重试');
      }
      throw e;
    }
    return { created, usernameStart };
  }

  /** 统一账号操作：重置密码 / 停用 / 启用 / 删除 */
  async patchUser(id: number, dto: PatchUserDto) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('用户不存在');

    switch (dto.action) {
      case 'reset-password': {
        // 未指定则自动生成；重置后强制下次登录改密
        const initialPassword = dto.initialPassword ?? generatePassword();
        await this.prisma.user.update({
          where: { id },
          data: {
            passwordHash: await bcrypt.hash(initialPassword, 10),
            mustChangePassword: true,
          },
        });
        return { initialPassword };
      }
      case 'disable': {
        if (target.role === 'admin') throw new ForbiddenException('不能停用管理员账号');
        await this.prisma.user.update({ where: { id }, data: { status: 'disabled' } });
        return null;
      }
      case 'enable': {
        await this.prisma.user.update({ where: { id }, data: { status: 'active' } });
        return null;
      }
      case 'delete': {
        if (target.role === 'admin') throw new ForbiddenException('不能删除管理员账号');
        if (target.role === 'teacher') {
          const classCount = await this.prisma.class.count({ where: { teacherId: id } });
          if (classCount > 0) throw new ConflictException('请先处理其班级与学生');
        }
        try {
          await this.prisma.user.delete({ where: { id } });
        } catch (e) {
          // 学生已有打字记录/心跳等关联数据时外键拒绝删除
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
            throw new ConflictException('该账号存在关联数据，无法删除');
          }
          throw e;
        }
        return null;
      }
    }
  }

  /** t/s 前缀序列：扫描现有用户名取最大序号 +1，补零到 3 位 */
  private async nextUsername(prefix: UsernamePrefix) {
    const rows = await this.prisma.user.findMany({
      where: { username: { startsWith: prefix } },
      select: { username: true },
    });
    let max = 0;
    for (const row of rows) {
      const m = USERNAME_SEQ[prefix].exec(row.username);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }

  /** 输出视图对象，剥离 passwordHash */
  private toVo(user: User) {
    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
