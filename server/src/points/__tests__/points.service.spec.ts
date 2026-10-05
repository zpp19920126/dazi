import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PointsService } from '../points.service.js';

const dup = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: '6.0.0',
});

function makeService(pointRecord: Record<string, unknown>) {
  return new PointsService({ pointRecord } as never);
}

describe('PointsService.award', () => {
  it('首次发放写入返回 true', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    const svc = makeService({ create });
    const ok = await svc.award({
      userId: 7, delta: 5, source: 'auto_attendance', refId: 9, reason: '全勤 · 10-05 第三节',
    });
    expect(ok).toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: { userId: 7, delta: 5, reason: '全勤 · 10-05 第三节', source: 'auto_attendance', refId: 9, createdBy: null },
    });
  });

  it('唯一键冲突静默跳过返回 false（幂等）', async () => {
    const create = vi.fn().mockRejectedValue(dup);
    const svc = makeService({ create });
    const ok = await svc.award({
      userId: 7, delta: 5, source: 'auto_attendance', refId: 9, reason: '全勤',
    });
    expect(ok).toBe(false);
  });

  it('非重复键异常原样抛出', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    const svc = makeService({ create });
    await expect(
      svc.award({ userId: 1, delta: 1, source: 'manual', reason: 'x' }),
    ).rejects.toThrow('db down');
  });
});
