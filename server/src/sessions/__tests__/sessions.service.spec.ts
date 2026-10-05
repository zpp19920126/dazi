import { describe, expect, it, vi } from 'vitest';
import { SessionsService } from '../sessions.service.js';

const teacher = { id: 1, role: 'teacher' };

function makeService(awardImpl?: (p: { userId: number }) => Promise<boolean>) {
  const calls: string[] = [];
  const prisma = {
    classSession: {
      findUnique: vi.fn().mockResolvedValue({
        id: 9,
        teacherId: 1,
        status: 'open',
        period: '第一节',
        startedAt: new Date('2026-10-05T02:00:00Z'),
      }),
      update: vi.fn().mockImplementation(() => {
        calls.push('update');
        return Promise.resolve({ id: 9, status: 'closed' });
      }),
    },
    attendance: { findMany: vi.fn().mockResolvedValue([{ userId: 11 }, { userId: 12 }]) },
  };
  const points = {
    award: vi.fn().mockImplementation((p: { userId: number }) => {
      calls.push(`award:${p.userId}`);
      return awardImpl ? awardImpl(p) : Promise.resolve(true);
    }),
  };
  return { calls, svc: new SessionsService(prisma as never, points as never), prisma };
}

describe('SessionsService.close 结算重入（P1 终审 Issue#2）', () => {
  it('先结算全部全勤奖励，最后才翻转 closed', async () => {
    const { svc, calls } = makeService();
    await svc.close(9, teacher);
    expect(calls).toEqual(['award:11', 'award:12', 'update']);
  });

  it('结算中途失败 → 抛错且不翻状态（课次保持 open，重跑结课幂等补发）', async () => {
    const { svc, prisma } = makeService((p) =>
      p.userId === 12 ? Promise.reject(new Error('db down')) : Promise.resolve(true),
    );
    await expect(svc.close(9, teacher)).rejects.toThrow('db down');
    expect(prisma.classSession.update).not.toHaveBeenCalled();
  });
});
