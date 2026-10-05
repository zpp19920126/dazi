import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PointsService } from '../points/points.service.js';
import { POINT_ATTENDANCE } from '../points/points.constants.js';
import { OpenSessionDto } from './dto/open-session.dto.js';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto.js';
import { LATE_THRESHOLD_MINUTES, SEATED_WINDOW_MS } from './sessions.constants.js';

interface Actor { id: number; role: string }

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
  ) {}

  /** 开课：仅本人班级；全班学生批量生成 absent 考勤行 */
  async open(dto: OpenSessionDto, teacher: Actor) {
    const klass = await this.prisma.class.findUnique({ where: { id: dto.classId } });
    if (!klass) throw new NotFoundException('班级不存在');
    if (teacher.role !== 'admin' && klass.teacherId !== teacher.id) {
      throw new ForbiddenException('无权操作该班级');
    }
    const existing = await this.prisma.classSession.findFirst({
      where: { classId: dto.classId, status: 'open' },
    });
    if (existing) throw new ConflictException('该班级已有进行中的课次，请先结课');

    const students = await this.prisma.user.findMany({
      where: { classId: dto.classId, role: 'student' },
      select: { id: true },
    });
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.classSession.create({
        data: { classId: dto.classId, teacherId: teacher.id, period: dto.period ?? null },
      });
      if (students.length) {
        await tx.attendance.createMany({
          data: students.map((s) => ({ sessionId: session.id, userId: s.id })),
        });
      }
      return session;
    });
  }

  /** 结课：置 closed 并结算全勤（幂等） */
  async close(sessionId: number, teacher: Actor) {
    const session = await this.prisma.classSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('课次不存在');
    if (teacher.role !== 'admin' && session.teacherId !== teacher.id) {
      throw new ForbiddenException('无权操作该课次');
    }
    if (session.status === 'closed') throw new ConflictException('课次已结束');

    const updated = await this.prisma.classSession.update({
      where: { id: sessionId },
      data: { status: 'closed', endedAt: new Date() },
    });

    const present = await this.prisma.attendance.findMany({
      where: { sessionId, status: 'present' },
      select: { userId: true },
    });
    const day = new Date(session.startedAt).toISOString().slice(0, 10);
    for (const row of present) {
      await this.points.award({
        userId: row.userId,
        delta: POINT_ATTENDANCE,
        source: 'auto_attendance',
        refId: sessionId,
        reason: `全勤 · ${day} ${session.period ?? ''}`.trim(),
      });
    }
    return updated;
  }

  /** 班级课次分页（新→旧） */
  async list(classId: number, page: number, pageSize: number, teacher: Actor) {
    const klass = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!klass) throw new NotFoundException('班级不存在');
    if (teacher.role !== 'admin' && klass.teacherId !== teacher.id) {
      throw new ForbiddenException('无权查看该班级');
    }
    const where: Prisma.ClassSessionWhereInput = { classId };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.classSession.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.classSession.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  /** 自动打卡：学生登录/心跳时机的进程内直调；幂等、永不抛业务异常以外的错 */
  async tryClockIn(userId: number): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, classId: true },
    });
    if (!user || user.role !== 'student' || !user.classId) return;
    const session = await this.prisma.classSession.findFirst({
      where: { classId: user.classId, status: 'open' },
    });
    if (!session) return;
    const now = new Date();
    const status = now.getTime() - session.startedAt.getTime() <= LATE_THRESHOLD_MINUTES * 60_000
      ? 'present'
      : 'late';
    // 条件里带 session:{status:'open'}：与结课并发时以结课为准（结课先行则此更新 0 行）
    await this.prisma.attendance.updateMany({
      where: {
        sessionId: session.id,
        userId,
        corrected: false,
        checkInAt: null,
        session: { status: 'open' },
      },
      data: { checkInAt: now, status },
    });
  }

  /** 考勤名单（含 heartbeat 在座辅助，只读不改考勤） */
  async getAttendance(sessionId: number, teacher: Actor) {
    const session = await this.prisma.classSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('课次不存在');
    if (teacher.role !== 'admin' && session.teacherId !== teacher.id) {
      throw new ForbiddenException('无权查看该课次');
    }
    const rows = await this.prisma.attendance.findMany({
      where: { sessionId },
      include: { user: { select: { realName: true, username: true } } },
      orderBy: { id: 'asc' },
    });
    const hbIds = rows.map((r) => r.userId);
    const hbs = await this.prisma.heartbeat.findMany({ where: { userId: { in: hbIds } } });
    const hbMap = new Map(hbs.map((h) => [h.userId, h]));
    const now = Date.now();
    return rows.map((r) => {
      const hb = hbMap.get(r.userId);
      return {
        id: r.id,
        userId: r.userId,
        realName: r.user.realName,
        username: r.user.username,
        checkInAt: r.checkInAt,
        status: r.status,
        corrected: r.corrected,
        note: r.note,
        seated: !!hb && now - hb.updatedAt.getTime() < SEATED_WINDOW_MS,
      };
    });
  }

  /** 教师修正考勤：置 corrected 防自动打卡覆盖；结课课次锁定不可修正 */
  async correct(attendanceId: number, dto: CorrectAttendanceDto, teacher: Actor) {
    const row = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: { session: { select: { teacherId: true, status: true } } },
    });
    if (!row) throw new NotFoundException('考勤记录不存在');
    if (teacher.role !== 'admin' && row.session.teacherId !== teacher.id) {
      throw new ForbiddenException('无权修正该考勤');
    }
    if (row.session.status === 'closed') throw new ConflictException('课次已结束，不可修正');
    return this.prisma.attendance.update({
      where: { id: attendanceId },
      data: { status: dto.status, note: dto.note ?? null, corrected: true },
    });
  }
}
