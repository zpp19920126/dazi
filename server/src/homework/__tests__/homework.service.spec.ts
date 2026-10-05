import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HomeworkService, type GradeRow } from '../homework.service.js';

const teacher = { id: 1, role: 'teacher' };

function hwRow(over: Record<string, unknown> = {}) {
  return { id: 7, classId: 3, title: '第三课作业', status: 'published', klass: { teacherId: 1 }, ...over };
}

function makeService(tables: Record<string, Record<string, unknown>> = {}) {
  const prisma = {
    class: { findUnique: vi.fn().mockResolvedValue({ id: 3, teacherId: 1 }) },
    homework: {
      findUnique: vi.fn().mockResolvedValue(hwRow()),
      update: vi.fn().mockResolvedValue({ id: 7 }),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 7, ...data })),
    },
    homeworkSubmission: { findMany: vi.fn().mockResolvedValue([]) },
    ...tables,
  };
  const award = vi.fn().mockResolvedValue(true);
  const svc = new HomeworkService(prisma as never, { award } as never);
  return { svc, prisma, award };
}

describe('HomeworkService.create', () => {
  const dto = { classId: 3, title: 'T', content: 'C', dueAt: '2026-10-08T18:00:00', allowAttachment: false };

  it('他人班级布置 → 403', async () => {
    const { svc, prisma } = makeService();
    prisma.class.findUnique.mockResolvedValue({ id: 3, teacherId: 99 });
    await expect(svc.create(dto, teacher)).rejects.toThrow(ForbiddenException);
  });

  it('班级不存在 → 404', async () => {
    const { svc, prisma } = makeService();
    prisma.class.findUnique.mockResolvedValue(null);
    await expect(svc.create(dto, teacher)).rejects.toThrow(NotFoundException);
  });

  it('dueAt 转 Date 落库，createdBy 记教师', async () => {
    const { svc, prisma } = makeService();
    await svc.create(dto, teacher);
    const data = prisma.homework.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({ classId: 3, title: 'T', createdBy: 1, allowAttachment: false });
    expect(data.dueAt).toBeInstanceOf(Date);
  });
});

describe('HomeworkService.update / settle', () => {
  it('手动截止：先幂等结算按时提交 +2，最后才置 closed', async () => {
    const calls: string[] = [];
    const prisma = {
      homework: {
        findUnique: vi.fn().mockResolvedValue(hwRow()),
        update: vi.fn().mockImplementation(() => {
          calls.push('close');
          return Promise.resolve({ id: 7, status: 'closed' });
        }),
      },
      homeworkSubmission: {
        findMany: vi.fn().mockImplementation(() => {
          calls.push('scan');
          return Promise.resolve([{ userId: 11 }, { userId: 12 }]);
        }),
      },
    };
    const svc = new HomeworkService(prisma as never, {
      award: (p: { userId: number }) => {
        calls.push(`award:${p.userId}`);
        return Promise.resolve(true);
      },
    } as never);
    await svc.update(7, { status: 'closed' }, teacher);
    expect(calls).toEqual(['scan', 'award:11', 'award:12', 'close']);
  });

  it('结算参数：+2 / auto_homework / refId=homeworkId / reason 含标题', async () => {
    const { svc, award, prisma } = makeService();
    prisma.homeworkSubmission.findMany.mockResolvedValue([{ userId: 11 }]);
    await svc.update(7, { status: 'closed' }, teacher);
    expect(award).toHaveBeenCalledWith({
      userId: 11,
      delta: 2,
      source: 'auto_homework',
      refId: 7,
      reason: '按时提交作业 · 第三课作业',
    });
  });

  it('已截止再截止 → 409；已截止改字段 → 409；均不触发结算', async () => {
    const { svc, prisma } = makeService();
    prisma.homework.findUnique.mockResolvedValue(hwRow({ status: 'closed' }));
    await expect(svc.update(7, { status: 'closed' }, teacher)).rejects.toThrow(ConflictException);
    await expect(svc.update(7, { title: '改标题' }, teacher)).rejects.toThrow(ConflictException);
    expect(prisma.homeworkSubmission.findMany).not.toHaveBeenCalled();
  });

  it('他人教师作业 → 403；作业不存在 → 404', async () => {
    const { svc, prisma } = makeService();
    prisma.homework.findUnique.mockResolvedValue(hwRow({ klass: { teacherId: 99 } }));
    await expect(svc.update(7, { status: 'closed' }, teacher)).rejects.toThrow(ForbiddenException);
    prisma.homework.findUnique.mockResolvedValue(null);
    await expect(svc.update(8, { status: 'closed' }, teacher)).rejects.toThrow(NotFoundException);
  });

  it('published 下编辑字段：dueAt 转 Date，不触发结算', async () => {
    const { svc, prisma } = makeService();
    await svc.update(7, { title: '新题', dueAt: '2026-10-09T10:00:00' }, teacher);
    const data = prisma.homework.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.dueAt).toBeInstanceOf(Date);
    expect(data.title).toBe('新题');
    expect(prisma.homeworkSubmission.findMany).not.toHaveBeenCalled();
  });

  it('空 body PATCH：{} 走 Prisma 空 data no-op（prisma≥4.5 允许，原样返回行）→ 200，行为锁定', async () => {
    const { svc, prisma } = makeService();
    prisma.homework.update.mockResolvedValue(hwRow({ klass: undefined }));
    const res = await svc.update(7, {}, teacher);
    const arg = prisma.homework.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    // 所有字段均为 undefined：Prisma 视作空 data，不发 UPDATE 语句、直接回行
    expect(Object.values(arg.data).every((v) => v === undefined)).toBe(true);
    expect(arg.where).toEqual({ id: 7 });
    expect(res).toMatchObject({ id: 7, title: '第三课作业' });
    expect(prisma.homeworkSubmission.findMany).not.toHaveBeenCalled();
  });
});

describe('HomeworkService.grades 全班名单增补', () => {
  function gradesService() {
    const subRow = {
      id: 21,
      userId: 11,
      textContent: '作答A',
      submittedAt: new Date('2026-10-04T09:00:00Z'),
      isLate: false,
      score: null,
      teacherComment: null,
      files: [{ id: 5, originalName: '作品图.jpg', mimeType: 'image/jpeg', sizeBytes: 123 }],
    };
    return makeService({
      user: { findMany: vi.fn().mockResolvedValue([
        { id: 11, realName: '学A', username: 'sa' },
        { id: 12, realName: '学B', username: 'sb' },
      ]) },
      homeworkSubmission: { findMany: vi.fn().mockResolvedValue([subRow]) },
    });
  }

  it('已交行携带 submissionId/textContent/files；未交行为 null/null/[]', async () => {
    const { svc, prisma } = gradesService();
    prisma.homework.findUnique.mockResolvedValue(hwRow({ klass: { id: 3, name: '一类', teacherId: 1 } }));
    const res = (await svc.grades(7, teacher, { page: 1, pageSize: 100 })) as {
      list: GradeRow[];
      total: number;
    };
    const [rowA, rowB] = res.list;
    expect(rowA).toMatchObject({
      userId: 11,
      state: '按时',
      submissionId: 21,
      textContent: '作答A',
      files: [{ id: 5, originalName: '作品图.jpg', mimeType: 'image/jpeg', sizeBytes: 123 }],
    });
    expect(rowB).toMatchObject({ userId: 12, state: '未交', submissionId: null, textContent: null, files: [] });
    expect(res.total).toBe(2);
  });

  it('CSV 列不受增补字段影响（仍为 姓名,用户名,提交时间,状态,分数,点评）', async () => {
    const { svc, prisma } = gradesService();
    prisma.homework.findUnique.mockResolvedValue(hwRow({ klass: { id: 3, name: '一类', teacherId: 1 } }));
    const csv = (await svc.grades(7, teacher, { exportCsv: 'csv', page: 1, pageSize: 100 })) as string;
    expect(csv).toContain('姓名,用户名,提交时间,状态,分数,点评');
    expect(csv).not.toContain('submissionId');
  });
});
