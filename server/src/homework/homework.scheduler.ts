import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { HomeworkService } from './homework.service.js';

@Injectable()
export class HomeworkScheduler {
  private readonly logger = new Logger(HomeworkScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly homework: HomeworkService,
  ) {}

  /** 每分钟：到点作业先幂等结算按时分再置 closed；超 4h 的 open 课次不自动关（规格 §5.5） */
  @Cron(CronExpression.EVERY_MINUTE)
  async settleDue(): Promise<void> {
    try {
      const due = await this.prisma.homework.findMany({
        where: { status: 'published', dueAt: { lt: new Date() } },
        select: { id: true },
      });
      for (const h of due) {
        await this.homework.settle(h.id);
        await this.prisma.homework.updateMany({
          where: { id: h.id, status: 'published' },
          data: { status: 'closed' },
        });
      }
    } catch (e) {
      this.logger.error(`作业截止结算失败: ${String(e)}`);
    }
  }
}
