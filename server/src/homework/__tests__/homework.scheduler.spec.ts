import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HomeworkScheduler } from '../homework.scheduler.js';

describe('HomeworkScheduler.settleDue', () => {
  it('到期 published 作业：先结算按时分，再条件置 closed', async () => {
    const calls: string[] = [];
    const prisma = {
      homework: {
        findMany: vi.fn().mockImplementation(() => {
          calls.push('scan');
          return Promise.resolve([{ id: 3 }, { id: 4 }]);
        }),
        updateMany: vi.fn().mockImplementation(() => {
          calls.push('close');
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const settle = vi.fn().mockImplementation((id: number) => {
      calls.push(`settle:${id}`);
      return Promise.resolve();
    });
    const sched = new HomeworkScheduler(prisma as never, { settle } as never);
    await sched.settleDue();
    expect(calls).toEqual(['scan', 'settle:3', 'close', 'settle:4', 'close']);
    expect(prisma.homework.updateMany).toHaveBeenLastCalledWith({
      where: { id: 4, status: 'published' },
      data: { status: 'closed' },
    });
  });

  it('扫描条件：status=published 且 dueAt 早于当前', async () => {
    const prisma = { homework: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() } };
    const sched = new HomeworkScheduler(prisma as never, { settle: vi.fn() } as never);
    await sched.settleDue();
    const where = (prisma.homework.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.status).toBe('published');
    expect(where.dueAt).toEqual({ lt: expect.any(Date) });
    expect(prisma.homework.updateMany).not.toHaveBeenCalled();
  });

  it('结算中途抛错 → 吞掉并记日志（下一分钟重跑幂等）', async () => {
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const prisma = { homework: { findMany: vi.fn().mockResolvedValue([{ id: 3 }]), updateMany: vi.fn() } };
    const sched = new HomeworkScheduler(
      prisma as never,
      { settle: vi.fn().mockRejectedValue(new Error('db down')) } as never,
    );
    await expect(sched.settleDue()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    expect(prisma.homework.updateMany).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
