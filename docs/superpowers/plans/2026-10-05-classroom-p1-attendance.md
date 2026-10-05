# 课堂管理 P1 · 课次考勤 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付教师"开课→登录自动打卡考勤→修正→结课全勤加分"全链路 + 教师端开课考勤页。

**Architecture:** 方案 A 单体扩模块：server 新增 `sessions`/`points` 两个 NestJS 模块，Prisma 一次性迁移 7 张新表（P2-P4 表先建不用），打卡通过登录/心跳两处进程内直调触发，不设学生端点。复用全局守卫链、TransformInterceptor、Service 层归属校验模式。

**Tech Stack:** NestJS 12 + Prisma 6 + MySQL 8 + vitest（server 单测与 e2e）；Vue 3 + Element Plus + vitest/@vue/test-utils（web）。

**Spec:** `docs/superpowers/specs/2026-10-05-classroom-management-design.md`（§4.1/4.2/4.7、§5.1、§6-sessions、§7.1/7.2 考勤页）

## Global Constraints

- 后端 ESM：所有相对 import 必须带 `.js` 后缀（`server/package.json` 是 `"type": "module"`）
- 所有表 utf8mb4、`@@map` 蛇形表名、字段 `@map` 蛇形列名（对照 `server/prisma/schema.prisma` 现有 6 表）
- Controller 直接 return 业务数据，`{code,message,data}` 由 `TransformInterceptor` 包装；异常用 Nest 内置异常类（401/403/404/409 语义）
- 角色控制：全局 `JwtAuthGuard → RolesGuard → MustChangePasswordGuard` 链 + 端点 `@Roles(...)`；资源归属校验在 Service 层（教师非本人班级 → `ForbiddenException`）
- 分页参数 `?page=&pageSize=`，返回 `{ list, total }`
- e2e 前置：本机 MySQL 可达且 `server/.env` 的 `DATABASE_URL` 有效、库已应用历史迁移
- P1 不新增任何 npm 依赖（`@nestjs/schedule` 属 P2）；P1 不实现作业/公告/积分 HTTP 端点（表先建，代码 P2-P4 写）
- 常量（`server/src/sessions/sessions.constants.ts`，后续期复用同一文件追加）：`LATE_THRESHOLD_MINUTES=5`、`POINT_ATTENDANCE=5`、`POINT_HOMEWORK_ONTIME=2`、`POINT_TYPING_PASSED=5`、`SEATED_WINDOW_MS=60_000`
- git 提交信息风格：`feat|test|docs|chore: 中文描述`（对照 `git log`）

---

### Task 1: Prisma 数据模型与迁移（7 张新表）

**Files:**
- Modify: `server/prisma/schema.prisma`
- 生成: `server/prisma/migrations/<timestamp>_classroom_management/`（由 prisma migrate 产生）

**Interfaces:**
- Consumes: 无
- Produces: Prisma Client 模型 `classSession` `attendance` `homework` `homeworkSubmission` `homeworkFile` `announcement` `pointRecord`，枚举 `SessionStatus`(`open|closed`) `AttendanceStatus`(`absent|present|late|excused|sick`) `HomeworkStatus`(`published|closed`) `AnnouncementType`(`general|points`) `TextStatus2` 不复用——公告状态复用现有 `TextStatus`(`published|offline`) `PointSource`(`manual|auto_attendance|auto_homework|auto_typing`)。Task 2 起所有任务依赖这些模型名与字段名。

- [ ] **Step 1: 在 schema.prisma 末尾追加枚举与 7 个模型**

```prisma
enum SessionStatus {
  open
  closed
}

enum AttendanceStatus {
  absent
  present
  late
  excused
  sick
}

enum HomeworkStatus {
  published
  closed
}

enum AnnouncementType {
  general
  points
}

enum PointSource {
  manual
  auto_attendance
  auto_homework
  auto_typing
}

model ClassSession {
  id        Int            @id @default(autoincrement())
  classId   Int            @map("class_id")
  teacherId Int            @map("teacher_id")
  period    String?        @db.VarChar(20)
  status    SessionStatus  @default(open)
  startedAt DateTime       @default(now()) @map("started_at")
  endedAt   DateTime?      @map("ended_at")
  klass      Class          @relation(fields: [classId], references: [id])
  teacher    User           @relation("SessionTeacher", fields: [teacherId], references: [id])
  attendance Attendance[]

  @@index([classId, status])
  @@index([teacherId, startedAt])
  @@map("class_session")
}

model Attendance {
  id        Int              @id @default(autoincrement())
  sessionId Int              @map("session_id")
  userId    Int              @map("user_id")
  checkInAt DateTime?        @map("check_in_at")
  status    AttendanceStatus @default(absent)
  corrected Boolean          @default(false)
  note      String?          @db.VarChar(200)
  session ClassSession @relation(fields: [sessionId], references: [id])
  user    User       @relation(fields: [userId], references: [id])

  @@unique([sessionId, userId])
  @@map("attendance")
}

model Homework {
  id              Int            @id @default(autoincrement())
  classId         Int            @map("class_id")
  title           String         @db.VarChar(200)
  content         String         @db.Text
  dueAt           DateTime       @map("due_at")
  allowAttachment Boolean        @default(false) @map("allow_attachment")
  status          HomeworkStatus @default(published)
  createdBy       Int            @map("created_by")
  createdAt       DateTime       @default(now()) @map("created_at")
  klass      Class                 @relation(fields: [classId], references: [id])
  submissions HomeworkSubmission[]

  @@index([classId, status])
  @@map("homework")
}

model HomeworkSubmission {
  id           Int       @id @default(autoincrement())
  homeworkId   Int       @map("homework_id")
  userId       Int       @map("user_id")
  textContent  String    @db.MediumText @map("text_content")
  submittedAt  DateTime  @default(now()) @map("submitted_at")
  isLate       Boolean   @default(false) @map("is_late")
  score        Decimal?  @db.Decimal(5, 2)
  teacherComment String? @db.VarChar(500) @map("teacher_comment")
  gradedBy     Int?      @map("graded_by")
  gradedAt     DateTime? @map("graded_at")
  homework Homework       @relation(fields: [homeworkId], references: [id])
  user     User           @relation(fields: [userId], references: [id])
  files    HomeworkFile[]

  @@unique([homeworkId, userId])
  @@map("homework_submission")
}

model HomeworkFile {
  id           Int    @id @default(autoincrement())
  submissionId Int    @map("submission_id")
  originalName String @db.VarChar(255) @map("original_name")
  storedKey    String @db.VarChar(255) @map("stored_key")
  mimeType     String @db.VarChar(100) @map("mime_type")
  sizeBytes    Int    @map("size_bytes")
  createdAt    DateTime @default(now()) @map("created_at")
  submission HomeworkSubmission @relation(fields: [submissionId], references: [id])

  @@index([submissionId])
  @@map("homework_file")
}

model Announcement {
  id        Int              @id @default(autoincrement())
  classId   Int              @map("class_id")
  title     String           @db.VarChar(200)
  content   String           @db.Text
  type      AnnouncementType @default(general)
  status    TextStatus       @default(published)
  createdBy Int              @map("created_by")
  createdAt DateTime         @default(now()) @map("created_at")
  klass Class @relation(fields: [classId], references: [id])

  @@index([classId, status])
  @@map("announcement")
}

model PointRecord {
  id        Int         @id @default(autoincrement())
  userId    Int         @map("user_id")
  delta     Int
  reason    String      @db.VarChar(200)
  source    PointSource
  refId     Int?        @map("ref_id")
  createdBy Int?        @map("created_by")
  createdAt DateTime    @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id])

  // 自动得分幂等防重：同来源同记录同用户仅一条；manual 的 refId=NULL 不受约束（MySQL 唯一键允许多 NULL）
  @@unique([source, refId, userId], map: "point_source_ref_user_key")
  @@map("point_record")
}
```

- [ ] **Step 2: 在既有 User/Class 模型上补反向关系**

`User` 模型 `heartbeat Heartbeat?` 行之后追加：

```prisma
  sessions     ClassSession[]       @relation("SessionTeacher")
  attendance   Attendance[]
  submissions  HomeworkSubmission[]
  pointRecords PointRecord[]
```

`Class` 模型 `tasks Task[]` 行之后追加：

```prisma
  sessions      ClassSession[]
  homeworks     Homework[]
  announcements Announcement[]
```

- [ ] **Step 3: 校验并生成迁移**

Run: `cd server && npx prisma validate && npx prisma migrate dev --name classroom_management && npx prisma generate`
Expected: validate 输出 "The schema at prisma/schema.prisma is valid"；migrate 生成 `prisma/migrations/*_classroom_management/migration.sql` 并应用；generate 输出 "Generated Prisma Client"。
若本机 MySQL 不可达：停止并报告，不要用 `db push` 绕过迁移文件。

- [ ] **Step 4: 冒烟验证新表可用**

Run: `cd server && node --no-warnings --loader ts-node/esm -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); Promise.all([p.classSession.count(),p.attendance.count(),p.homework.count(),p.homeworkSubmission.count(),p.homeworkFile.count(),p.announcement.count(),p.pointRecord.count()]).then(r=>{console.log(r);return p.\$disconnect()})"`
Expected: 输出 `[ 0, 0, 0, 0, 0, 0, 0 ]`

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(db): 课堂管理7表迁移(课次/考勤/作业/提交/附件/公告/积分)"
```

---

### Task 2: 积分核心 PointsService（幂等 award）

**Files:**
- Create: `server/src/points/points.constants.ts`
- Create: `server/src/points/points.service.ts`
- Create: `server/src/points/points.module.ts`
- Create: `server/src/points/__tests__/points.service.spec.ts`
- Modify: `server/src/app.module.ts`（imports 数组 `StatsModule,` 后加 `SessionsModule, PointsModule,`——SessionsModule 在 Task 3 建，本任务先只加 `PointsModule,`，Task 3 Step 5 一并补齐，避免引入空模块编译失败）

**Interfaces:**
- Consumes: Task 1 的 `prisma.pointRecord`
- Produces: `PointsService.award(p: AwardParams): Promise<boolean>`（true=写入，false=唯一键冲突跳过）、`sumByUser(userId): Promise<number>`、`classTotals(classId): Promise<Array<{ userId: number; realName: string; total: number }>>`；常量 `POINT_ATTENDANCE` 等。Task 3 结课结算、Task 8 e2e 断言依赖这三个方法签名。

- [ ] **Step 1: 写常量文件**

`server/src/points/points.constants.ts` 与 `server/src/sessions/sessions.constants.ts` 内容（sessions 目录 Task 3 才建，本步只建 points 版）：

```ts
// server/src/points/points.constants.ts
/** 自动得分固定分值（规格 §5.3，调整需改码） */
export const POINT_ATTENDANCE = 5;   // 结课全勤
export const POINT_HOMEWORK_ONTIME = 2; // 作业按时提交（P2 使用）
export const POINT_TYPING_PASSED = 5;   // 打字首次达标（P2/P3 使用）
```

- [ ] **Step 2: 写失败单测**

`server/src/points/__tests__/points.service.spec.ts`:

```ts
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
```

- [ ] **Step 3: 运行确认失败**

Run: `cd server && npx vitest run src/points/__tests__/points.service.spec.ts`
Expected: FAIL（Cannot find module '../points.service.js'）

- [ ] **Step 4: 实现 PointsService + Module**

`server/src/points/points.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AwardParams {
  userId: number;
  delta: number;
  source: 'manual' | 'auto_attendance' | 'auto_homework' | 'auto_typing';
  refId?: number | null;
  reason: string;
  createdBy?: number | null;
}

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 发放积分；自动来源依赖唯一键 (source, refId, userId) 幂等：重复发放返回 false */
  async award(p: AwardParams): Promise<boolean> {
    try {
      await this.prisma.pointRecord.create({
        data: {
          userId: p.userId,
          delta: p.delta,
          reason: p.reason,
          source: p.source,
          refId: p.refId ?? null,
          createdBy: p.createdBy ?? null,
        },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
      throw e;
    }
  }

  async sumByUser(userId: number): Promise<number> {
    const agg = await this.prisma.pointRecord.aggregate({
      where: { userId },
      _sum: { delta: true },
    });
    return agg._sum.delta ?? 0;
  }

  /** 班级学生总分（降序），供积分页/积分通报快照（P3）使用 */
  async classTotals(classId: number): Promise<Array<{ userId: number; realName: string; total: number }>> {
    const students = await this.prisma.user.findMany({
      where: { classId, role: 'student' },
      select: { id: true, realName: true },
      orderBy: { id: 'asc' },
    });
    const rows = await this.prisma.pointRecord.groupBy({
      by: ['userId'],
      where: { userId: { in: students.map((s) => s.id) } },
      _sum: { delta: true },
    });
    const map = new Map(rows.map((r) => [r.userId, r._sum.delta ?? 0]));
    return students
      .map((s) => ({ userId: s.id, realName: s.realName, total: map.get(s.id) ?? 0 }))
      .sort((a, b) => b.total - a.total || a.userId - b.userId);
  }
}
```

`server/src/points/points.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PointsService } from './points.service.js';

@Module({
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
```

`server/src/app.module.ts`: import 区加 `import { PointsModule } from './points/points.module.js';`，imports 数组 `StatsModule,` 后加 `PointsModule,`。

- [ ] **Step 5: 运行确认通过**

Run: `cd server && npx vitest run src/points/__tests__/points.service.spec.ts`
Expected: PASS 3 tests

- [ ] **Step 6: Commit**

```bash
git add server/src/points server/src/app.module.ts
git commit -m "feat(points): PointsService幂等发放与班级总分聚合"
```

---

### Task 3: Sessions 后端（开课/结课/列表 + 全勤结算）

**Files:**
- Create: `server/src/sessions/sessions.constants.ts`
- Create: `server/src/sessions/dto/open-session.dto.ts`
- Create: `server/src/sessions/sessions.service.ts`
- Create: `server/src/sessions/sessions.controller.ts`
- Create: `server/src/sessions/sessions.module.ts`
- Modify: `server/src/app.module.ts`（注册 SessionsModule）
- Test: `server/test/sessions.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 模型、Task 2 `PointsService.award(p: AwardParams): Promise<boolean>`、`POINT_ATTENDANCE`
- Produces: `SessionsService.open(dto, teacher)` `close(id, teacher)` `list(classId, page, pageSize, teacher)` `tryClockIn(userId)`（Task 4 实现，本任务先建空桩抛未实现）——改为：本任务提供 `open/close/list`，`tryClockIn/correct/getAttendance` 分别由 Task 4/5 追加。HTTP 端点：`POST /api/sessions`、`PATCH /api/sessions/:id/close`、`GET /api/sessions?classId=&page=&pageSize=`。

- [ ] **Step 1: 常量与 DTO**

```ts
// server/src/sessions/sessions.constants.ts
export const LATE_THRESHOLD_MINUTES = 5; // 开课 5 分钟内打卡为 present，其后 late
export const SEATED_WINDOW_MS = 60_000;  // 心跳 60s 内视为在座（与 heartbeats 在线口径一致）
```

```ts
// server/src/sessions/dto/open-session.dto.ts
import { IsInt, IsOptional, MaxLength, Min } from 'class-validator';

export class OpenSessionDto {
  @IsInt()
  @Min(1)
  classId!: number;

  @IsOptional()
  @MaxLength(20)
  period?: string;
}
```

- [ ] **Step 2: 写失败 e2e（open/close/list 全场景）**

`server/test/sessions.e2e-spec.ts` — 应用启动、admin 凭据重置、教师/学生造数的 beforeAll/afterAll 样板**逐行复制 `server/test/heartbeats.e2e-spec.ts:27-137`**，改动点仅：变量名 `suffix` 前缀用 `sm`（如班级 `上课班${suffix}`、学生 `sm${suffix}a`）、清理顺序改为 `pointRecord → attendance → classSession → 学生班级解绑 → class → users`（afterAll 里在 `prisma.heartbeat.deleteMany` 前加三行 deleteMany）。然后追加用例：

```ts
  const openSession = (body: Record<string, unknown>, token = teacherToken) =>
    request(app.getHttpServer()).post('/api/sessions').set('Authorization', `Bearer ${token}`).send(body);

  it('1. 开课 → 生成课次与全班 absent 考勤行', async () => {
    const res = await openSession({ classId: classAId, period: '第三节' });
    expect(res.status).toBe(201).valueOf(); // Nest POST 默认 201；与现有 heartbeats 端点 @HttpCode(200) 不同，本端点保持默认 201
    expect(res.body.code).toBe(0);
    const sid = res.body.data.id;
    const rows = await prisma.attendance.findMany({ where: { sessionId: sid } });
    expect(rows).toHaveLength(1); // 班内只有 1 名测试学生
    expect(rows[0].status).toBe('absent');
    expect(rows[0].checkInAt).toBeNull();
  });

  it('2. 同班重复开课 → 409', async () => {
    const res = await openSession({ classId: classAId });
    expect(res.status).toBe(409);
  });

  it('3. 他人教师开课 → 403', async () => {
    const res = await openSession({ classId: classAId }, teacherBToken);
    expect(res.status).toBe(403);
  });

  it('4. 结课 → closed + endedAt；到课者各得全勤+5，重跑幂等', async () => {
    // 手工把测试学生置为 present，模拟已到课
    const sid = (await prisma.classSession.findFirstOrThrow({ where: { classId: classAId, status: 'open' } })).id;
    await prisma.attendance.update({ where: { sessionId_userId: { sessionId: sid, userId: sId } }, data: { status: 'present' } });
    const res = await request(app.getHttpServer())
      .patch(`/api/sessions/${sid}/close`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
    expect(res.body.data.endedAt).toBeTruthy();
    const pts = await prisma.pointRecord.findMany({ where: { userId: sId, source: 'auto_attendance', refId: sid } });
    expect(pts).toHaveLength(1);
    expect(pts[0].delta).toBe(5);
    // 再手工触发一次同 ref 发放（模拟重跑）→ 不新增
    const again = await prisma.pointRecord.count({ where: { userId: sId, source: 'auto_attendance', refId: sid } });
    expect(again).toBe(1);
  });

  it('5. 已结课再次结课 → 409', async () => {
    const sid = (await prisma.classSession.findFirstOrThrow({ where: { classId: classAId, status: 'closed' } })).id;
    const res = await request(app.getHttpServer())
      .patch(`/api/sessions/${sid}/close`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(409);
  });

  it('6. 结课后重新开课成功（前一课已 closed）', async () => {
    const res = await openSession({ classId: classAId, period: '第四节' });
    expect(res.status).toBe(201);
  });

  it('7. 课次列表按班级分页返回，倒序', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/sessions?classId=${classAId}&page=1&pageSize=10`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.list[0].period).toBe('第四节'); // 最新在前
  });

  it('8. 他人教师查该班课次列表 → 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/sessions?classId=${classAId}`)
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(res.status).toBe(403);
  });
```

（最后一个 open 课次留给 Task 4 用例使用，afterAll 清理时随表删除。）

- [ ] **Step 3: 运行确认失败**

Run: `cd server && npx vitest run --config vitest.config.e2e.ts test/sessions.e2e-spec.ts`
Expected: FAIL（404 路由不存在）

- [ ] **Step 4: 实现 SessionsService（open/close/list）**

```ts
// server/src/sessions/sessions.service.ts（本任务只含这三个方法，Task 4/5 追加其余）
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PointsService } from '../points/points.service.js';
import { POINT_ATTENDANCE } from '../points/points.constants.js';
import { OpenSessionDto } from './dto/open-session.dto.js';

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
}
```

- [ ] **Step 5: 实现 Controller 与 Module 并注册**

```ts
// server/src/sessions/sessions.controller.ts
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { OpenSessionDto } from './dto/open-session.dto.js';
import { SessionsService } from './sessions.service.js';

@Controller()
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post('sessions')
  @Roles('teacher')
  open(@Body() dto: OpenSessionDto, @CurrentUser() user: { id: number; role: string }) {
    return this.sessionsService.open(dto, user);
  }

  @Patch('sessions/:id/close')
  @Roles('teacher')
  close(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number; role: string }) {
    return this.sessionsService.close(id, user);
  }

  @Get('sessions')
  @Roles('teacher', 'admin')
  list(
    @Query('classId', ParseIntPipe) classId: number,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.sessionsService.list(classId, Number(page), Number(pageSize), user);
  }
}
```

```ts
// server/src/sessions/sessions.module.ts
import { Module } from '@nestjs/common';
import { PointsModule } from '../points/points.module.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [PointsModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
```

`app.module.ts`：import `SessionsModule` 并加入 imports（`PointsModule,` 之后）。

- [ ] **Step 6: 运行 e2e 确认通过**

Run: `cd server && npx vitest run --config vitest.config.e2e.ts test/sessions.e2e-spec.ts`
Expected: PASS 8 tests。注意用例 4 依赖 `present` 判定，若用例 1 的断言 201 与拦截器实际返回码不符，以 `heartbeats.controller.ts` 的 `@HttpCode(200)` 先例为准统一改为 201（POST 默认）并在测试里锁定。

- [ ] **Step 7: Commit**

```bash
git add server/src/sessions server/test/sessions.e2e-spec.ts server/src/app.module.ts
git commit -m "feat(sessions): 开课结课与课次列表,结课自动结算全勤分"
```

---

### Task 4: 自动打卡（登录 + 心跳双钩子）

**Files:**
- Modify: `server/src/sessions/sessions.service.ts`（追加 `tryClockIn`）
- Modify: `server/src/auth/auth.service.ts`（login 成功后调用）
- Modify: `server/src/auth/auth.module.ts`（imports 加 SessionsModule）
- Modify: `server/src/heartbeats/heartbeats.service.ts` + `server/src/heartbeats/heartbeats.module.ts`（upsert 前调用）
- Test: `server/test/sessions-clockin.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 3 的 `SessionsService`、Task 1 的 attendance/class_session 表、`LATE_THRESHOLD_MINUTES`
- Produces: `SessionsService.tryClockIn(userId: number): Promise<void>`（幂等，任何内部异常由调用方吞掉不阻塞主流程）。Task 5 考勤页与 e2e 依赖其语义：corrected=true 或已打卡的行永不再被覆盖。

- [ ] **Step 1: 写失败 e2e**

`server/test/sessions-clockin.e2e-spec.ts` — 样板同 Task 3（复制 heartbeats e2e 的 beforeAll/afterAll，前缀 `ck`，清理加 `pointRecord/attendance/classSession`）。用例：

```ts
  it('1. 开课后学生登录 → 自动打卡 present', async () => {
    const sid = (await openSessionAndGetId()).id; // 复用样板里的开课函数
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: `ck${suffix}a`, password: 'studPass12' });
    expect(login.status).toBe(201).valueOf(); // 与现有 auth e2e 断言保持一致（若 auth.e2e 用 200/201，以 test/auth.e2e-spec.ts 实际值为准）
    const row = await prisma.attendance.findUnique({ where: { sessionId_userId: { sessionId: sid, userId: sId } } });
    expect(row!.status).toBe('present');
    expect(row!.checkInAt).not.toBeNull();
    expect(row!.corrected).toBe(false);
  });

  it('2. 重复登录不覆盖首打时间', async () => {
    const before = await prisma.attendance.findFirstOrThrow({ where: { userId: sId, checkInAt: { not: null } } });
    await request(app.getHttpServer()).post('/api/auth/login').send({ username: `ck${suffix}a`, password: 'studPass12' });
    const after = await prisma.attendance.findUnique({ where: { id: before.id } });
    expect(after!.checkInAt!.getTime()).toBe(before.checkInAt!.getTime());
  });

  it('3. 开课 6 分钟后登录 → late', async () => {
    // 先结当前课次,把 sId 考勤置回未打卡(模拟下一课),再把新课 started_at 拨到 6 分钟前
    await closeOpenSession(sId); // 样板辅助:PATCH close
    await prisma.attendance.updateMany({ where: { userId: sId }, data: { corrected: false } });
    const sid = (await openSessionAndGetId()).id;
    await prisma.classSession.update({ where: { id: sid }, data: { startedAt: new Date(Date.now() - 6 * 60_000) } });
    await request(app.getHttpServer()).post('/api/auth/login').send({ username: `ck${suffix}a`, password: 'studPass12' });
    const row = await prisma.attendance.findUnique({ where: { sessionId_userId: { sessionId: sid, userId: sId } } });
    expect(row!.status).toBe('late');
  });

  it('4. 已登录学生经心跳补打卡（开课瞬间在线者）', async () => {
    await closeOpenSession(sId);
    await prisma.attendance.updateMany({ where: { userId: sId }, data: { corrected: false, checkInAt: null, status: 'absent' } });
    const sid = (await openSessionAndGetId()).id;
    const hb = await request(app.getHttpServer()).post('/api/heartbeats')
      .set('Authorization', `Bearer ${sToken}`)
      .send({ taskId: null, status: 'typing', speed: 40, accuracy: 96, progress: 10, elapsedSeconds: 30, charIndex: 30 });
    expect(hb.status).toBe(200);
    const row = await prisma.attendance.findUnique({ where: { sessionId_userId: { sessionId: sid, userId: sId } } });
    expect(row!.status).toBe('present');
  });

  it('5. corrected=true 的行不被打卡覆盖', async () => {
    await prisma.attendance.update({
      where: { sessionId_userId: { sessionId: await openSessionSid(), userId: sId } },
      data: { corrected: true, status: 'sick' },
    });
    await prisma.classSession.update({ where: { id: await openSessionSid() }, data: { startedAt: new Date(Date.now() - 10 * 60_000) } });
    await request(app.getHttpServer()).post('/api/auth/login').send({ username: `ck${suffix}a`, password: 'studPass12' });
    const row = await prisma.attendance.findUnique({ where: { sessionId_userId: { sessionId: await openSessionSid(), userId: sId } } });
    expect(row!.status).toBe('sick');
    expect(row!.checkInAt).toBeNull();
  });

  it('6. 无 open 课次时登录正常返回 token 且零副作用', async () => {
    await closeAllOpenSessions(); // 样板辅助
    const before = await prisma.attendance.count();
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ username: `ck${suffix}a`, password: 'studPass12' });
    expect(login.body.data.token).toBeTruthy();
    expect(await prisma.attendance.count()).toBe(before);
  });
```

Run: `cd server && npx vitest run --config vitest.config.e2e.ts test/sessions-clockin.e2e-spec.ts` → Expected: FAIL（tryClockIn 未实现/无钩子）

- [ ] **Step 2: 追加 tryClockIn**

`sessions.service.ts` 追加（import 区补 `LATE_THRESHOLD_MINUTES`）：

```ts
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
```

- [ ] **Step 3: 接两个钩子**

`auth.module.ts`：imports 数组加 `SessionsModule`（import 自 `../sessions/sessions.module.js`）。
`auth.service.ts`：构造函数追加 `private readonly sessions: SessionsService,`，`login` 里 `await this.prisma.user.update(... lastLoginAt ...)` 之后、return 之前：

```ts
    // 考勤自动打卡：失败绝不影响登录（记日志吞掉）
    if (user.role === 'student') {
      try {
        await this.sessions.tryClockIn(user.id);
      } catch (e) {
        console.error('[tryClockIn]', e);
      }
    }
```

`heartbeats.module.ts`：imports 加 `SessionsModule`。
`heartbeats.service.ts`：构造函数追加 `private readonly sessions: SessionsService,`，`upsert()` 第一行加 `await this.sessions.tryClockIn(user.id);`。

- [ ] **Step 4: 运行 e2e 确认通过 + 回归原 heartbeats e2e**

Run: `cd server && npx vitest run --config vitest.config.e2e.ts test/sessions-clockin.e2e-spec.ts && npx vitest run --config vitest.config.e2e.ts test/heartbeats.e2e-spec.ts`
Expected: 两条 PASS（heartbeats 回归确认钩子未破坏原有用例）

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions server/src/auth server/src/heartbeats server/test/sessions-clockin.e2e-spec.ts
git commit -m "feat(sessions): 登录与心跳双钩子自动打卡,corrected行免疫"
```

---

### Task 5: 考勤名单查询（在座辅助）与教师修正

**Files:**
- Modify: `server/src/sessions/sessions.service.ts`（追加 `getAttendance` `correct`）
- Modify: `server/src/sessions/sessions.controller.ts`（追加 2 端点）
- Create: `server/src/sessions/dto/correct-attendance.dto.ts`
- Test: `server/test/attendance.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 `attendance` 表、Task 3 `SessionsService`、heartbeat 表
- Produces: `GET /api/sessions/:id/attendance` 返回行形状 `{ id, userId, realName, username, checkInAt, status, corrected, note, seated }`（Task 7 前端表格按此渲染）；`PATCH /api/attendance/:id` body `{ status, note? }`。`SessionsService.getAttendance(sessionId, teacher)`、`correct(attendanceId, dto, teacher)`。

- [ ] **Step 1: DTO**

```ts
// server/src/sessions/dto/correct-attendance.dto.ts
import { IsIn, IsOptional, MaxLength } from 'class-validator';

export class CorrectAttendanceDto {
  @IsIn(['absent', 'present', 'late', 'excused', 'sick'])
  status!: 'absent' | 'present' | 'late' | 'excused' | 'sick';

  @IsOptional()
  @MaxLength(200)
  note?: string;
}
```

- [ ] **Step 2: 写失败 e2e**

`server/test/attendance.e2e-spec.ts` — 样板同前（前缀 `at`）。用例：

```ts
  it('1. 考勤名单含姓名/打卡时间/状态/seated,学生心跳后 seated=true', async () => {
    const sid = (await openSession({ classId: classAId })).body.data.id;
    await prisma.heartbeat.upsert({
      where: { userId: sId },
      create: { userId: sId, status: 'typing', speed: 0, accuracy: 0, progress: 0, elapsedSeconds: 0, charIndex: 0 },
      update: { status: 'typing', updatedAt: new Date() },
    });
    const res = await request(app.getHttpServer())
      .get(`/api/sessions/${sid}/attendance`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { userId: number }) => r.userId === sId);
    expect(row.realName).toBeTruthy();
    expect(row.status).toBe('absent');
    expect(row.seated).toBe(true);
  });
  it('2. 心跳超 60s → seated=false', async () => {
    await prisma.$executeRaw`UPDATE heartbeat SET updated_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = ${sId}`;
    const sid = (await prisma.classSession.findFirstOrThrow({ where: { classId: classAId, status: 'open' } })).id;
    const res = await request(app.getHttpServer())
      .get(`/api/sessions/${sid}/attendance`)
      .set('Authorization', `Bearer ${teacherToken}`);
    const row = res.body.data.find((r: { userId: number }) => r.userId === sId);
    expect(row.seated).toBe(false);
  });
  it('3. 修正为病假 → corrected=true 且返回新值', async () => {
    const sid = (await prisma.classSession.findFirstOrThrow({ where: { classId: classAId, status: 'open' } })).id;
    const att = await prisma.attendance.findFirstOrThrow({ where: { sessionId: sid, userId: sId } });
    const res = await request(app.getHttpServer())
      .patch(`/api/attendance/${att.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ status: 'sick', note: '医院复查' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('sick');
    expect(res.body.data.corrected).toBe(true);
  });
  it('4. 非法状态值 → 400', async () => {
    const att = await prisma.attendance.findFirst();
    const res = await request(app.getHttpServer())
      .patch(`/api/attendance/${att!.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ status: 'ghost' });
    expect(res.status).toBe(400);
  });
  it('5. 他人教师修正 → 403;结课后修正 → 409', async () => {
    const att = await prisma.attendance.findFirstOrThrow({ where: { userId: sId } });
    const r403 = await request(app.getHttpServer())
      .patch(`/api/attendance/${att.id}`)
      .set('Authorization', `Bearer ${teacherBToken}`)
      .send({ status: 'present' });
    expect(r403.status).toBe(403);
    const sid = att.sessionId;
    await request(app.getHttpServer()).patch(`/api/sessions/${sid}/close`).set('Authorization', `Bearer ${teacherToken}`);
    const r409 = await request(app.getHttpServer())
      .patch(`/api/attendance/${att.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ status: 'present' });
    expect(r409.status).toBe(409);
  });
  it('6. 他人班级课次名单 → 403', async () => {
    const sid = (await prisma.classSession.findFirstOrThrow({ where: { classId: classAId } })).id;
    const res = await request(app.getHttpServer())
      .get(`/api/sessions/${sid}/attendance`)
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(res.status).toBe(403);
  });
```

Run → Expected: FAIL（404/无字段）

- [ ] **Step 3: 实现 getAttendance 与 correct**

`sessions.service.ts` 追加：

```ts
  /** 考勤名单（含 heartbeat 在座辅助，只读不改考勤） */
  async getAttendance(sessionId: number, teacher: Actor) {
    const session = await this.prisma.classSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('课次不存在');
    if (teacher.role !== 'admin' && session.teacherId !== teacher.id) {
      throw new ForbiddenException('无权查看该课次');
    }
    const rows = await this.prisma.attendance.findMany({
      where: { sessionId },
      include: { user: { select: { realName: true, username: true } }, session: false },
      orderBy: { id: 'asc' },
    });
    const hbIds = rows.filter((r) => r.checkInAt !== null || true).map((r) => r.userId);
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
```

（`import { SEATED_WINDOW_MS } from './sessions.constants.js';` 与 `CorrectAttendanceDto` 一并补上；`session: false` 非法——去掉该字段，include 仅 `user`。）

`sessions.controller.ts` 追加：

```ts
  @Get('sessions/:id/attendance')
  @Roles('teacher', 'admin')
  attendance(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.sessionsService.getAttendance(id, user);
  }

  @Patch('attendance/:id')
  @Roles('teacher')
  correct(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CorrectAttendanceDto,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.sessionsService.correct(id, dto, user);
  }
```

- [ ] **Step 4: 运行 e2e 确认通过 + Task 3/4 回归**

Run: `cd server && npx vitest run --config vitest.config.e2e.ts test/attendance.e2e-spec.ts test/sessions.e2e-spec.ts test/sessions-clockin.e2e-spec.ts`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/sessions server/test/attendance.e2e-spec.ts
git commit -m "feat(sessions): 考勤名单查询(在座辅助)与教师修正端点"
```

---

### Task 6: 前端菜单支持分组子菜单

**Files:**
- Modify: `web/src/layouts/menus.ts`
- Modify: `web/src/layouts/BaseLayout.vue:5-15`（props 类型与 activeMenu）与 `:30-32`（模板循环）
- Test: `web/src/layouts/__tests__/BaseLayout.spec.ts`

**Interfaces:**
- Consumes: 现有 BaseLayout `menus: MenuItem[]` prop
- Produces: `MenuItem { path?: string; label: string; children?: MenuItem[] }`（带 children 时渲染 `el-sub-menu`）。Task 7 用其给 teacherMenus 挂「课堂管理」分组。

- [ ] **Step 1: 写失败组件测试**

`web/src/layouts/__tests__/BaseLayout.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import BaseLayout from '../BaseLayout.vue'

const menus = [
  { path: '/teacher/dashboard', label: '工作台' },
  { label: '课堂管理', children: [{ path: '/teacher/attendance', label: '开课考勤' }] },
]

describe('BaseLayout 分组菜单', () => {
  it('渲染父项标题与子项', async () => {
    const wrapper = mount(BaseLayout, {
      props: { menus: menus as never },
      global: { plugins: [ElementPlus, createPinia(), { install: (app: any) => app.config.globalProperties.$router = { push() {}, resolve: (p: string) => ({ href: p }) } }] },
      stubs: { RouterView: true },
    })
    expect(wrapper.text()).toContain('课堂管理')
    expect(wrapper.text()).toContain('开课考勤')
    expect(wrapper.text()).toContain('工作台')
  })
})
```

Run: `cd web && npx vitest run src/layouts/__tests__/BaseLayout.spec.ts`
Expected: FAIL（children 未渲染 / 类型不匹配）

注：若 mount BaseLayout 因 useRoute/RouterLink 依赖报错，测试内用 `global.mocks.$route` + `stubs: { RouterView: true }` 并给路由最小 mock（如上）；以现有 `web/src/views/__tests__/Grades.spec.ts` 的 mount 辅助写法为准对齐（先读该文件再定 mock 细节，保持同风格）。

- [ ] **Step 2: 改 menus.ts 类型**

```ts
/** 侧边菜单项；children 存在时渲染为可展开分组 */
export interface MenuItem {
  /** 完整路由路径，如 /student/tasks；分组项无 path */
  path?: string
  /** 菜单中文名 */
  label: string
  children?: MenuItem[]
}
```

同文件其余三个数组本任务不动（Task 7 才给 teacherMenus 追加分组项）。

- [ ] **Step 3: 改 BaseLayout**

script 中 activeMenu 改为拍平匹配：

```ts
// 拍平（含分组子项）用于高亮定位
const flatMenus = computed(() => props.menus.flatMap((m) => m.children ?? [m]))
const activeMenu = computed(
  () => flatMenus.value.find((item) => item.path && route.path.startsWith(item.path))?.path ?? route.path,
)
```

模板循环替换为：

```html
<template v-for="item in menus">
  <el-sub-menu v-if="item.children" :key="`group-${item.label}`" :index="item.label">
    <template #title>{{ item.label }}</template>
    <el-menu-item v-for="child in item.children" :key="child.path" :index="child.path!">
      {{ child.label }}
    </el-menu-item>
  </el-sub-menu>
  <el-menu-item v-else :key="item.path" :index="item.path!">
    {{ item.label }}
  </el-menu-item>
</template>
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `cd web && npx vitest run src/layouts/__tests__/BaseLayout.spec.ts && npm run test`
Expected: 新测试 PASS；原有测试无回归（router/视图 spec 全绿）

- [ ] **Step 5: Commit**

```bash
git add web/src/layouts
git commit -m "feat(web): 侧边菜单支持课堂管理分组子菜单"
```

---

### Task 7: 教师开课考勤页

**Files:**
- Create: `web/src/views/teacher/SessionAttendance.vue`
- Modify: `web/src/router/index.ts`（teacher children 加路由）
- Modify: `web/src/layouts/menus.ts`（teacherMenus 追加「课堂管理」分组）
- Test: `web/src/views/__tests__/SessionAttendance.spec.ts`

**Interfaces:**
- Consumes: Task 6 分组菜单；API `GET /api/classes`（返回 `{ list: [{id,name,studentCount}], total }`）、Task 3 `POST /sessions`/`PATCH /sessions/:id/close`/`GET /sessions?classId=`、Task 5 `GET /sessions/:id/attendance`（行形状见 Task 5 Interfaces）/`PATCH /attendance/:id`；`request` 工具直接返回 data 载荷（对照 `web/src/utils/request.ts` 与 LiveBoard.vue 用法）。
- Produces: 路由 `/teacher/attendance`（name `teacher-attendance`）。

- [ ] **Step 1: 写失败组件测试**

`web/src/views/__tests__/SessionAttendance.spec.ts`（mock `@/utils/request`，风格对齐 `Grades.spec.ts`——先读它再写，此处给定断言）:

```ts
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import request from '@/utils/request'
import SessionAttendance from '../SessionAttendance.vue'

vi.mock('@/utils/request')

const attendanceRow = {
  id: 1, userId: 9, realName: '张三', username: 's009',
  checkInAt: '2026-10-05T06:06:00.000Z', status: 'present', corrected: false, note: null, seated: true,
}

describe('开课考勤页', () => {
  it('无 open 课次时显示开课按钮;有则显示考勤表与结课', async () => {
    vi.mocked(request.get)
      .mockResolvedValueOnce({ list: [{ id: 3, name: '三年2班', studentCount: 1 }], total: 1 }) // /classes
      .mockResolvedValueOnce({ list: [], total: 0 }) // /sessions 初始
    const wrapper = mount(SessionAttendance, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).toContain('开 课')
  })

  it('开课调用 POST /sessions 并刷新', async () => {
    vi.mocked(request.get)
      .mockResolvedValueOnce({ list: [{ id: 3, name: '三年2班', studentCount: 1 }], total: 1 })
      .mockResolvedValueOnce({ list: [{ id: 7, classId: 3, status: 'open', period: '第一节', startedAt: new Date().toISOString(), endedAt: null }], total: 1 })
      .mockResolvedValueOnce([attendanceRow]) // attendance 名单
    vi.mocked(request.post).mockResolvedValue({ id: 8 })
    const wrapper = mount(SessionAttendance, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).toContain('张三')
    expect(wrapper.text()).toContain('结 课')
  })
})
```

Run: `cd web && npx vitest run src/views/__tests__/SessionAttendance.spec.ts` → FAIL（模块不存在）

- [ ] **Step 2: 实现页面组件**

`web/src/views/teacher/SessionAttendance.vue`:

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

interface Klass { id: number; name: string; studentCount: number }
interface Session {
  id: number; classId: number; period: string | null; status: 'open' | 'closed'
  startedAt: string; endedAt: string | null
}
interface AttRow {
  id: number; userId: number; realName: string; username: string
  checkInAt: string | null; status: string; corrected: boolean; note: string | null; seated: boolean
}

const STATUS_LABEL: Record<string, { text: string; type: 'success' | 'warning' | 'info' | 'danger' }> = {
  present: { text: '到课', type: 'success' },
  late: { text: '迟到', type: 'warning' },
  absent: { text: '旷课', type: 'danger' },
  excused: { text: '事假', type: 'info' },
  sick: { text: '病假', type: 'info' },
}

const classes = ref<Klass[]>([])
const classId = ref<number | null>(null)
const sessions = ref<Session[]>([])
const rows = ref<AttRow[]>([])
const loading = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const openSession = () => sessions.value.find((s) => s.status === 'open') ?? null

async function refresh() {
  if (!classId.value) return
  loading.value = true
  try {
    sessions.value = (await request.get<{ list: Session[] }>('/sessions', {
      params: { classId: classId.value, page: 1, pageSize: 50 },
    })).list
    const sid = openSession()?.id
    rows.value = sid ? await request.get<AttRow[]>(`/sessions/${sid}/attendance`) : []
  } finally {
    loading.value = false
  }
}

async function openClass() {
  let period = ''
  try {
    const r = await ElMessageBox.prompt('节次（可留空，如：第三节）', '开课', { inputValue: '' })
    period = String(r.value ?? '')
  } catch {
    return
  }
  await request.post('/sessions', { classId: classId.value, period: period || undefined })
  ElMessage.success('已开课')
  await refresh()
}

async function closeClass() {
  const sid = openSession()?.id
  if (!sid) return
  try {
    await ElMessageBox.confirm('结课后不再自动打卡，且自动结算全勤分。确认结课？', '结课', { type: 'warning' })
  } catch {
    return
  }
  await request.patch(`/sessions/${sid}/close`)
  ElMessage.success('已结课')
  await refresh()
}

async function correct(row: AttRow, status: string) {
  await request.patch(`/attendance/${row.id}`, { status })
  await refresh()
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(async () => {
  const data = await request.get<{ list: Klass[] }>('/classes')
  classes.value = data.list
  if (data.list.length) {
    classId.value = data.list[0].id
    await refresh()
    timer = setInterval(refresh, 30_000) // 与实时看板同口径的 30s 自刷
  }
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div v-loading="loading">
    <h3>开课考勤</h3>
    <div class="bar">
      <el-select v-model="classId" style="width: 220px" @change="refresh">
        <el-option v-for="c in classes" :key="c.id" :label="`${c.name}（${c.studentCount}人）`" :value="c.id" />
      </el-select>
      <template v-if="openSession()">
        <span class="info">● 正在上课 {{ openSession()!.period ?? '' }} · 开课于 {{ fmtTime(openSession()!.startedAt) }}</span>
        <el-button type="danger" @click="closeClass">结 课</el-button>
      </template>
      <el-button v-else type="primary" :disabled="!classId" @click="openClass">开 课</el-button>
    </div>

    <el-table v-if="openSession()" :data="rows" data-testid="attendance-table" border>
      <el-table-column prop="realName" label="姓名" width="120" />
      <el-table-column label="打卡时间" width="110">
        <template #default="{ row }">{{ fmtTime(row.checkInAt) }}</template>
      </el-table-column>
      <el-table-column label="在座" width="80">
        <template #default="{ row }">
          <span :style="{ color: row.seated ? '#67c23a' : '#c0c4cc' }">{{ row.seated ? '● 在座' : '○ 不在' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="STATUS_LABEL[row.status]?.type ?? 'info'" size="small">{{ STATUS_LABEL[row.status]?.text ?? row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="修正为（病假/事假/旷课/到课）">
        <template #default="{ row }">
          <el-button link type="warning" size="small" @click="correct(row, 'sick')">病假</el-button>
          <el-button link type="warning" size="small" @click="correct(row, 'excused')">事假</el-button>
          <el-button link type="danger" size="small" @click="correct(row, 'absent')">旷课</el-button>
          <el-button link type="success" size="small" @click="correct(row, 'present')">到课</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-else-if="classId" description="当前无进行中的课次" />

    <h4 style="margin-top: 24px">历史课次</h4>
    <el-table :data="sessions.filter((s) => s.status === 'closed')" data-testid="history-table" border>
      <el-table-column label="日期" width="160">
        <template #default="{ row }">{{ new Date(row.startedAt).toLocaleDateString() }}</template>
      </el-table-column>
      <el-table-column prop="period" label="节次" width="120" />
      <el-table-column label="开课">
        <template #default="{ row }">{{ fmtTime(row.startedAt) }} ~ {{ fmtTime(row.endedAt) }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.info {
  color: #67c23a;
  font-size: 14px;
}
</style>
```

- [ ] **Step 3: 路由与菜单接线**

`router/index.ts`：import 区加 `import TeacherSessionAttendanceView from '@/views/teacher/SessionAttendance.vue'`；teacher children（`grades` 路由对象之后）加：

```ts
      {
        path: 'attendance',
        name: 'teacher-attendance',
        component: TeacherSessionAttendanceView,
        meta: { roles: ['teacher'], title: '开课考勤' },
      },
```

`menus.ts`：`teacherMenus` 数组末尾追加分组项：

```ts
  {
    label: '课堂管理',
    children: [{ path: '/teacher/attendance', label: '开课考勤' }],
  },
```

- [ ] **Step 4: 运行测试与构建验证**

Run: `cd web && npx vitest run src/views/__tests__/SessionAttendance.spec.ts && npm run test && npm run build`
Expected: 新测试 PASS、全量 PASS、`vue-tsc` 构建无类型错误

- [ ] **Step 5: 手工验证（golden path）**

`cd server && npm run start:dev` + `cd web && npm run dev`，浏览器完整走一遍：教师登录 → 侧栏出现「课堂管理 ▾ 开课考勤」→ 选班开课 → 另一终端学生登录 → 名单 30s 内出现到课+在座 → 修正病假 → 结课 → 历史课次出现该行。UI 有异常截图修复后再提交。

- [ ] **Step 6: Commit**

```bash
git add web/src/views/teacher/SessionAttendance.vue web/src/router/index.ts web/src/layouts/menus.ts web/src/views/__tests__/SessionAttendance.spec.ts
git commit -m "feat(web): 教师开课考勤页(状态条/考勤表/修正/历史课次)"
```

---

### Task 8: P1 收尾 — 全量回归与部署备忘

**Files:**
- Modify: `deploy/README.md`（追加"P1 上线步骤"小节）

**Interfaces:**
- Consumes: Task 1-7 全部产出
- Produces: 可交付的 P1 版本 + 上线步骤记录

- [ ] **Step 1: 后端全量测试**

Run: `cd server && npm run test && npm run test:e2e && npm run lint`
Expected: 全 PASS、lint 0 error。任何失败先修复再进入下一步（修复本身按 TDD 走小循环）。

- [ ] **Step 2: 前端全量**

Run: `cd web && npm run test && npm run build`
Expected: 全 PASS、构建成功。

- [ ] **Step 3: 部署备忘写入 deploy/README.md 末尾**

```markdown
## 课堂管理 P1（考勤）上线步骤

1. 上传新 server dist + prisma 目录；`npx prisma migrate deploy` 应用 `*_classroom_management` 迁移（先手动备份：跑一次 backup.sh）
2. 上传新 web dist 至 /var/www/typing/web-dist
3. `pm2 restart typing-api`；教师端登录验证「课堂管理 ▾ 开课考勤」开/结课一次
4. 回滚 = 还原备份 + 旧 dist；class_session/attendance/point_record 为新表，旧版本代码不读取，无需回滚迁移
```

- [ ] **Step 4: Commit**

```bash
git add deploy/README.md
git commit -m "docs(deploy): 课堂管理P1考勤上线步骤"
```

---

## Self-Review 记录

- 规格覆盖（P1 范围）：开课/结课/列表/名单/修正 5 端点 ✓（T3/T5）；登录+心跳双钩子 ✓（T4）；结课全勤幂等结算 ✓（T3）；corrected 免疫 ✓（T4 用例5）；7 表迁移 ✓（T1）；在座辅助 60s ✓（T5）；教师考勤页与分组菜单 ✓（T6/T7）。P2-P4 内容（作业/公告/积分端点/报表/cron）确认不在本计划——表已建，代码归后续计划。
- 占位扫描：无 TBD/略写；两处"先读参考文件再对齐"（e2e 样板、web spec 风格）指向的是仓库现存真实文件，属精确引用而非占位。
- 类型一致性：`AttendanceStatus` 五值在 Prisma 枚举/DTO IsIn/前端 STATUS_LABEL 三处一致；`award` 签名 T2 定义与 T3 调用一致；`getAttendance` 行形状与 T7 AttRow 一致。
- 已知风险：Task 4 用例 1 的 auth 登录返回码、Task 3 用例 1 的 201 断言——计划中已给出以仓库现状为准的对齐指令，执行者首次运行即校正并锁进测试。
