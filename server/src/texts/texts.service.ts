import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTextDto } from './dto/create-text.dto.js';
import { UpdateTextDto } from './dto/update-text.dto.js';

interface ListFilters {
  language?: string;
  status?: string;
  source?: string;
  page: number;
  pageSize: number;
}

/** Unicode 码点计数：emoji/全角按 1 计 */
const charCountOf = (content: string) => [...content].length;

@Injectable()
export class TextsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 教师/学生 → 内置 published + 自建 published；admin → 全部 */
  async listTexts(user: { id: number; role: string }, filters: ListFilters) {
    const { language, status, source, page, pageSize } = filters;
    const where: Prisma.TextWhereInput = {};

    if (user.role === 'admin') {
      if (status) where.status = status as Prisma.EnumTextStatusFilter['equals'];
    } else {
      where.status = 'published';
      where.OR = [{ createdBy: null }, { createdBy: user.id }];
    }
    if (language) where.language = language as Prisma.EnumTextLanguageFilter['equals'];
    if (source === 'builtin') where.createdBy = null;
    else if (source === 'custom') where.createdBy = { not: null };

    const [list, total] = await this.prisma.$transaction([
      this.prisma.text.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.text.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async getText(id: number, user: { id: number; role: string }) {
    const text = await this.prisma.text.findUnique({ where: { id } });
    if (!text) throw new NotFoundException('文章不存在');
    const visible =
      user.role === 'admin' ||
      (text.status === 'published' && (text.createdBy === null || text.createdBy === user.id));
    if (!visible) throw new ForbiddenException('无权查看该文章');
    return text;
  }

  async createText(dto: CreateTextDto, user: { id: number }) {
    return this.prisma.text.create({
      data: { ...dto, charCount: charCountOf(dto.content), createdBy: user.id },
    });
  }

  /** 作者本人或 admin 可编辑；内置文章（createdBy=null）仅 admin */
  async updateText(id: number, dto: UpdateTextDto, user: { id: number; role: string }) {
    const text = await this.prisma.text.findUnique({ where: { id } });
    if (!text) throw new NotFoundException('文章不存在');
    if (user.role !== 'admin' && text.createdBy !== user.id) {
      throw new ForbiddenException('无权编辑该文章');
    }
    return this.prisma.text.update({
      where: { id },
      data: { ...dto, ...(dto.content ? { charCount: charCountOf(dto.content) } : {}) },
    });
  }

  async updateStatus(id: number, status: 'offline' | 'published') {
    const text = await this.prisma.text.findUnique({ where: { id } });
    if (!text) throw new NotFoundException('文章不存在');
    return this.prisma.text.update({ where: { id }, data: { status } });
  }

  async deleteText(id: number, user: { id: number; role: string }) {
    const text = await this.prisma.text.findUnique({ where: { id } });
    if (!text) throw new NotFoundException('文章不存在');
    if (user.role !== 'admin' && text.createdBy !== user.id) {
      throw new ForbiddenException('无权删除该文章');
    }
    const taskCount = await this.prisma.task.count({ where: { textId: id } });
    if (taskCount > 0) throw new ConflictException('该文章已被任务使用，请使用下架');
    await this.prisma.text.delete({ where: { id } });
    return { id };
  }
}
