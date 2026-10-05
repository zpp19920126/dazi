# 课堂管理 P2（作业管理）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付通用作业系统：教师布置/编辑/截止作业，学生文本+附件提交（截止前可重交覆盖、截止后补交标记），教师批改打分点评，cron 每分钟自动截止并发放按时提交 +2 积分，成绩 CSV 导出；同时偿还 P1 终审遗留三笔技术债。

**Architecture:** 方案 A 单体扩模块：server 新增 `homework` NestJS 模块（作业 CRUD、multipart 提交 staging→事务→rename、下载鉴权流式、批改、CSV、@nestjs/schedule cron）；web 教师端新增「作业管理」列表页+批改页，学生端新增「我的作业」+提交页。P1 迁移已建好 homework/homework_submission/homework_file 三表，**本期零迁移**。

**Tech Stack:** NestJS 12 (ESM) + Prisma 6 + MySQL 8 + vitest/supertest；Vue 3 + Element Plus + axios + @vue/test-utils；新增依赖仅 `@nestjs/schedule`（上传用 platform-express 自带 FilesInterceptor，零新上传依赖）。

**Spec:** `docs/superpowers/specs/2026-10-05-classroom-management-design.md`（§4.3–4.5、§5.2、§5.5、§6 homework、§7.2–7.3、§8、§9、§10-P2）

## Global Constraints

- 校内局域网单机、无外网依赖；不引入 WebSocket（规格 §1.4）。唯一新增后端依赖：`@nestjs/schedule`（规格 §2）。
- NestJS ESM：`server/src` 内所有相对 import 必须带 `.js` 后缀。
- 沿用全局链：JwtAuthGuard → RolesGuard → MustChangePasswordGuard；TransformInterceptor `{code,message,data}`；归属校验全部在 Service 层（非归属教师 403，admin 仅读）。
- 仓库约定：**所有 POST 端点 `@HttpCode(HttpStatus.OK)` 返回 200**（非 201）。
- 上传（规格 §5.2/§8）：单文件 ≤10MB、每次 ≤3 个；扩展名白名单 `jpg jpeg png pdf doc docx zip`（按原始名扩展判定，`mimeType` 仅记录不信任）；UUID 重命名存储于 `UPLOAD_DIR`（env，默认 `uploads/`）下 `homework/<yyyy-mm>/`；流程 staging 落盘 → DB 事务 → rename，任何失败清理 staging/补偿删行，绝不产生"有记录无文件"；`uploads` 不在 Nginx 静态目录，仅经鉴权接口流式下载。
- 截止与结算：cron（每分钟）与教师手动截止**都先幂等结算按时提交 +2（`POINT_HOMEWORK_ONTIME`，source=`auto_homework`，refId=homeworkId）再置 closed**（结算失败则作业保持 published 等重跑——与 P1 结课重入同构）。closed 后学生仍可补交并标 `is_late=1`（不加分）；批改不受 status 限制。
- 常量沿用 `server/src/points/points.constants.ts`：`POINT_HOMEWORK_ONTIME = 2` 已存在，无需新增。
- 输入上限（规格 §8）：`textContent` ≤50000 字符；作业正文 ≤10000；点评 ≤500；标题 ≤200。
- CSV：UTF-8 BOM 前置 + CRLF，沿用 `server/src/records/records.service.ts:136-158` `toCsv` 模式与 `server/src/records/records.controller.ts:41-59` `@Res()` 双格式模式。
- e2e：共享本机 dev MySQL，`fileParallelism:false` 串行；新文件必须 afterAll 按外键序清理（homeworkFile → homeworkSubmission → homework → pointRecord → 考勤/心跳 → 断班 → 班级 → 用户）；上传相关 e2e 在 `app.init()` 前设 `process.env.UPLOAD_DIR = mkdtempSync(...)`，afterAll `rmSync` 清理。
- 范围裁决（本期不做）：打字达标 +5（auto_typing）按分期属 P3 积分交付；学生端公告、积分页属 P3；报表属 P4。
- 裁决：教师提前手动截止时即结算，此刻已交且 `submittedAt ≤ dueAt` 者得 +2；截止后、原定 dueAt 前补交（is_late=0）不再追溯加分（结算已跑，避免 cron 每分钟永久重扫历史作业）。
- **P1 终审遗留（Task 1 强制偿还）**：sessions.close() 结算重入（先结算后翻状态）；GET /sessions page/pageSize NaN → 400（DefaultValuePipe+ParseIntPipe，同 `records.controller.ts:32-33`）；heartbeat 钩子加 try/catch 且与登录钩子统一用 Nest `Logger`（现在心跳裸调、登录用 console.error）。

**提交信息风格**：沿用仓库中文 conventional commits（`feat(homework): ...`、`fix(sessions): ...`）。每个 Task 末尾按其步骤提交。

---

### Task 1: P1 终审遗留修复（结课重入 / page NaN / Logger 对齐 / 超长开课提醒）

**Files:**
- Modify: `server/src/sessions/sessions.service.ts:49-77`（close 重排）
- Modify: `server/src/sessions/sessions.controller.ts:25-34`（list 参数管道）
- Modify: `server/src/heartbeats/heartbeats.service.ts:18-20`（try/catch + Logger）
- Modify: `server/src/auth/auth.service.ts:24-31`（console.error → Logger）
- Modify: `web/src/views/teacher/SessionAttendance.vue:130-136`（已上时长 + >4h 标记，规格 §5.5-2）
- Test: Create `server/src/sessions/__tests__/sessions.service.spec.ts`；Modify `server/test/sessions.e2e-spec.ts`（追加 page 非法用例）；Modify `web/src/views/__tests__/SessionAttendance.spec.ts`

**Interfaces:**
- Consumes: 现网 `PointsService.award(p: AwardParams)`（P2002→false 幂等）、`SessionsService.close(sessionId, teacher)` 签名不变。
- Produces: `close()` 新语义——先结算全勤、最后翻 closed；中途抛错课次保持 open 可重跑。Task 2/3 的手动/cron 截止沿用同构模式。

- [ ] **Step 1: 写失败单测（close 结算顺序与重入）**

创建 `server/src/sessions/__tests__/sessions.service.spec.ts`：

```ts
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
  return { svc: new SessionsService(prisma as never, points as never), prisma };
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/sessions/__tests__/sessions.service.spec.ts`
Expected: 两用例 FAIL（当前实现先翻状态：calls 为 `['update','award:11','award:12']`；用例 2 update 已被调用）。

- [ ] **Step 3: 重排 close()（先结算后翻状态）**

`sessions.service.ts` 的 `close` 方法整体替换为（守卫与错误语义不变，仅移动结算块，注释同步）：

```ts
  /** 结课：先幂等结算全勤，最后置 closed —— 中途崩溃课次仍 open，重跑结课可补发遗漏奖励 */
  async close(sessionId: number, teacher: Actor) {
    const session = await this.prisma.classSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('课次不存在');
    if (teacher.role !== 'admin' && session.teacherId !== teacher.id) {
      throw new ForbiddenException('无权操作该课次');
    }
    if (session.status === 'closed') throw new ConflictException('课次已结束');

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
    return this.prisma.classSession.update({
      where: { id: sessionId },
      data: { status: 'closed', endedAt: new Date() },
    });
  }
```

Run: `cd server && npx vitest run src/sessions/__tests__/sessions.service.spec.ts` → Expected: 2 PASS。

- [ ] **Step 4: page 参数 NaN → 400（controller 管道，对齐 records）**

`sessions.controller.ts`：import 行补 `DefaultValuePipe`；`list` 改为：

```ts
  @Get('sessions')
  @Roles('teacher', 'admin')
  list(
    @Query('classId', ParseIntPipe) classId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.sessionsService.list(classId, page, pageSize, user);
  }
```

`sessions.service.ts` 的 `list` 首行加防御夹取：

```ts
  async list(classId: number, page: number, pageSize: number, teacher: Actor) {
    const p = Math.max(1, Math.floor(page));
    const ps = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const klass = await this.prisma.class.findUnique({ where: { id: classId } });
```

（方法体内 `$transaction` 改 `skip: (p - 1) * ps, take: ps`，返回 `{ list, total, page: p, pageSize: ps }`，其余不动。）

`server/test/sessions.e2e-spec.ts` 在最后一个用例后追加：

```ts
  it('10. page 非法字符串 → 400（ParseIntPipe，NaN 防护）', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/sessions?classId=${classAId}&page=abc`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 5: 心跳钩子 try/catch + 两处 Logger 统一**

`heartbeats.service.ts`：`@nestjs/common` import 补 `Logger`；类内加字段并包裹钩子：

```ts
  private readonly logger = new Logger(HeartbeatsService.name);

  /** 学生实时状态上报（UPSERT：每人仅一行，新值覆盖） */
  async upsert(dto: HeartbeatDto, user: { id: number }) {
    // 考勤自动打卡：失败绝不影响心跳上报（记日志吞掉，与登录钩子同构）
    try {
      await this.sessions.tryClockIn(user.id);
    } catch (e) {
      this.logger.warn(`考勤补打卡失败 user=${user.id}: ${String(e)}`);
    }
```

（原 `await this.sessions.tryClockIn(user.id);` 裸调行删除，upsert 其余逻辑不动。）

`auth.service.ts`：`@nestjs/common` import 补 `Logger`；类内加 `private readonly logger = new Logger(AuthService.name);`；catch 内 `console.error('[tryClockIn]', e)` 改为：

```ts
        this.logger.warn(`登录打卡失败 user=${user.id}: ${String(e)}`);
```

- [ ] **Step 6: 考勤页已上时长 + >4h 提醒（规格 §5.5-2，不自动结课）**

`web/src/views/teacher/SessionAttendance.vue` script 增加：

```ts
// 已上时长；超 4 小时仅提醒不自动结课（机房拖堂常见，规格 §5.5）
function elapsed(s: Session): { text: string; over: boolean } {
  const ms = Date.now() - new Date(s.startedAt).getTime()
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return { text: `已上 ${h} 小时 ${m} 分`, over: ms > 4 * 3_600_000 }
}
```

template 中状态条 `<span class="info">…</span>`（现含"● 正在上课/开课于"）替换为：

```html
        <span class="info">
          ● 正在上课 {{ openSession.period ?? '' }} · 开课于 {{ fmtTime(openSession.startedAt) }} ·
          {{ elapsed(openSession).text }}
        </span>
        <el-tag v-if="elapsed(openSession).over" type="warning" size="small">已超4小时</el-tag>
```

`web/src/views/__tests__/SessionAttendance.spec.ts` describe 内追加：

```ts
  it('开课超过4小时显示已上时长与超4小时提醒', async () => {
    const longAgo = new Date(Date.now() - 5 * 3_600_000).toISOString()
    mocks.get
      .mockResolvedValueOnce(classesPayload)
      .mockResolvedValueOnce({
        list: [{ id: 7, classId: 3, status: 'open', period: '第一节', startedAt: longAgo, endedAt: null }],
        total: 1,
      })
      .mockResolvedValueOnce([])
    const wrapper = mount(SessionAttendance, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).toContain('已上 5 小时')
    expect(wrapper.text()).toContain('已超4小时')
    wrapper.unmount()
  })
```

- [ ] **Step 7: 全量回归**

Run: `cd server && npx vitest run && npx vitest run --config vitest.config.e2e.ts test/sessions.e2e-spec.ts test/attendance.e2e-spec.ts test/sessions-clockin.e2e-spec.ts test/heartbeats.e2e-spec.ts && npm run lint`
Run: `cd web && npx vitest run`
Expected: 全部 PASS（sessions.e2e 用例 4/5 的 HTTP 断言与结算顺序无关，重排后仍 PASS）。

- [ ] **Step 8: Commit**

```bash
git add server/src/sessions server/src/heartbeats server/src/auth server/test/sessions.e2e-spec.ts web/src/views/teacher/SessionAttendance.vue web/src/views/__tests__/SessionAttendance.spec.ts
git commit -m "fix(sessions): 结课结算重入化+page参数NaN防护；心跳/登录打卡钩子Logger统一；考勤页超4h提醒"
```

---

### Task 2: @nestjs/schedule 接入 + HomeworkModule 骨架（布置/编辑/手动截止 + 按时结算）

**Files:**
- Modify: `server/package.json` / `package-lock.json`（`npm i @nestjs/schedule`）
- Modify: `server/src/app.module.ts`（ScheduleModule.forRoot + HomeworkModule）
- Create: `server/src/homework/homework.module.ts`
- Create: `server/src/homework/dto/create-homework.dto.ts`、`server/src/homework/dto/update-homework.dto.ts`
- Create: `server/src/homework/homework.service.ts`（本任务含 create/update/settle）
- Create: `server/src/homework/homework.controller.ts`（本任务含 POST /homeworks、PATCH /homeworks/:id）
- Test: Create `server/src/homework/__tests__/homework.service.spec.ts`

**Interfaces:**
- Consumes: `PointsService.award(p: AwardParams)`（`source:'auto_homework'`、`refId:number`、P2002→false 幂等）；`POINT_HOMEWORK_ONTIME = 2`（`../points/points.constants.js`）。
- Produces:
  - `HomeworkService(prisma: PrismaService, points: PointsService)`（构造参数顺序固定，单测按此注入）
  - `create(dto: CreateHomeworkDto, teacher: { id: number; role: string })`
  - `update(id: number, dto: UpdateHomeworkDto, teacher)`（`dto.status==='closed'` → 先 settle 后翻状态；已截止编辑/重复截止 → 409）
  - `settle(homeworkId: number): Promise<void>`（Task 3 cron 复用）
  - `CreateHomeworkDto { classId:number; title:string; content:string; dueAt:string(ISO); allowAttachment:boolean }`；`UpdateHomeworkDto { title?; content?; dueAt?; allowAttachment?; status?: 'closed' }`

- [ ] **Step 1: 安装唯一新依赖并接线**

```bash
cd server && npm i @nestjs/schedule
```

`app.module.ts` 补 import：

```ts
import { ScheduleModule } from '@nestjs/schedule';
import { HomeworkModule } from './homework/homework.module.js';
```

`imports` 数组在 `ConfigModule.forRoot({ isGlobal: true }),` 后加一行 `ScheduleModule.forRoot(),`；`SessionsModule,` 后加 `HomeworkModule,`。

- [ ] **Step 2: 写失败单测**

创建 `server/src/homework/__tests__/homework.service.spec.ts`：

```ts
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HomeworkService } from '../homework.service.js';

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
});
```

Run: `cd server && npx vitest run src/homework` → Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 DTO**

`server/src/homework/dto/create-homework.dto.ts`：

```ts
import { IsBoolean, IsDateString, IsInt, IsString, MaxLength, Min } from 'class-validator';

export class CreateHomeworkDto {
  @IsInt()
  @Min(1)
  classId!: number;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(10000)
  content!: string;

  @IsDateString()
  dueAt!: string;

  @IsBoolean()
  allowAttachment!: boolean;
}
```

`server/src/homework/dto/update-homework.dto.ts`：

```ts
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateHomeworkDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsBoolean()
  allowAttachment?: boolean;

  @IsOptional()
  @IsIn(['closed'])
  status?: 'closed';
}
```

- [ ] **Step 4: 实现 service / controller / module**

`server/src/homework/homework.service.ts`：

```ts
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PointsService } from '../points/points.service.js';
import { POINT_HOMEWORK_ONTIME } from '../points/points.constants.js';
import { CreateHomeworkDto } from './dto/create-homework.dto.js';
import { UpdateHomeworkDto } from './dto/update-homework.dto.js';

interface Actor {
  id: number;
  role: string;
}

@Injectable()
export class HomeworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
  ) {}

  /** 布置作业：仅本人班级（教师） */
  async create(dto: CreateHomeworkDto, teacher: Actor) {
    const klass = await this.prisma.class.findUnique({ where: { id: dto.classId } });
    if (!klass) throw new NotFoundException('班级不存在');
    if (klass.teacherId !== teacher.id) throw new ForbiddenException('无权在该班布置作业');
    return this.prisma.homework.create({
      data: {
        classId: dto.classId,
        title: dto.title,
        content: dto.content,
        dueAt: new Date(dto.dueAt),
        allowAttachment: dto.allowAttachment,
        createdBy: teacher.id,
      },
    });
  }

  /** 编辑（published 限定）与手动截止；截止与 cron 同构：先幂等结算，最后翻状态（结课重入模式） */
  async update(id: number, dto: UpdateHomeworkDto, teacher: Actor) {
    const hw = await this.prisma.homework.findUnique({
      where: { id },
      include: { klass: { select: { teacherId: true } } },
    });
    if (!hw) throw new NotFoundException('作业不存在');
    if (hw.klass.teacherId !== teacher.id) throw new ForbiddenException('无权操作该作业');

    if (dto.status === 'closed') {
      if (hw.status === 'closed') throw new ConflictException('作业已截止');
      await this.settle(id);
      return this.prisma.homework.update({ where: { id }, data: { status: 'closed' } });
    }
    if (hw.status === 'closed') throw new ConflictException('作业已截止，不可编辑');
    return this.prisma.homework.update({
      where: { id },
      data: {
        title: dto.title,
        content: dto.content,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        allowAttachment: dto.allowAttachment,
      },
    });
  }

  /** 按时提交 +2：唯一键幂等，可安全重跑（规格 §5.3/§5.5） */
  async settle(homeworkId: number): Promise<void> {
    const hw = await this.prisma.homework.findUnique({
      where: { id: homeworkId },
      select: { id: true, title: true },
    });
    if (!hw) return;
    const onTime = await this.prisma.homeworkSubmission.findMany({
      where: { homeworkId, isLate: false },
      select: { userId: true },
    });
    for (const row of onTime) {
      await this.points.award({
        userId: row.userId,
        delta: POINT_HOMEWORK_ONTIME,
        source: 'auto_homework',
        refId: homeworkId,
        reason: `按时提交作业 · ${hw.title}`,
      });
    }
  }
}
```

`server/src/homework/homework.controller.ts`：

```ts
import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateHomeworkDto } from './dto/create-homework.dto.js';
import { UpdateHomeworkDto } from './dto/update-homework.dto.js';
import { HomeworkService } from './homework.service.js';

@Controller()
export class HomeworkController {
  constructor(private readonly homeworkService: HomeworkService) {}

  @Post('homeworks')
  @HttpCode(HttpStatus.OK)
  @Roles('teacher')
  create(@Body() dto: CreateHomeworkDto, @CurrentUser() user: { id: number; role: string }) {
    return this.homeworkService.create(dto, user);
  }

  @Patch('homeworks/:id')
  @Roles('teacher')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHomeworkDto,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.homeworkService.update(id, dto, user);
  }
}
```

`server/src/homework/homework.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { PointsModule } from '../points/points.module.js';
import { HomeworkController } from './homework.controller.js';
import { HomeworkService } from './homework.service.js';

@Module({
  imports: [PointsModule],
  controllers: [HomeworkController],
  providers: [HomeworkService],
  exports: [HomeworkService],
})
export class HomeworkModule {}
```

- [ ] **Step 5: 运行验证**

Run: `cd server && npx vitest run src/homework && npm run build && npm run lint`
Expected: PASS / 编译成功 / lint 干净。

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/src/app.module.ts server/src/homework
git commit -m "feat(homework): 作业布置/编辑/手动截止与按时提交幂等结算(+2)，接入@nestjs/schedule"
```

---

### Task 3: cron 每分钟自动截止结算（HomeworkScheduler）

**Files:**
- Create: `server/src/homework/homework.scheduler.ts`
- Modify: `server/src/homework/homework.module.ts`（providers 加 scheduler）
- Test: Create `server/src/homework/__tests__/homework.scheduler.spec.ts`

**Interfaces:**
- Consumes: `HomeworkService.settle(homeworkId: number): Promise<void>`（Task 2 产出）；`Cron`/`CronExpression` from `@nestjs/schedule`。
- Produces: `HomeworkScheduler(prisma, homework)`，方法 `settleDue(): Promise<void>` —— e2e/验收可直接 `app.get(HomeworkScheduler).settleDue()` 触发（不真实等分钟）。

- [ ] **Step 1: 写失败单测**

创建 `server/src/homework/__tests__/homework.scheduler.spec.ts`：

```ts
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
```

Run: `cd server && npx vitest run src/homework/__tests__/homework.scheduler.spec.ts` → Expected: FAIL（文件不存在）。

- [ ] **Step 2: 实现 scheduler**

`server/src/homework/homework.scheduler.ts`：

```ts
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
```

`homework.module.ts`：补 `import { HomeworkScheduler } from './homework.scheduler.js';`，providers 改 `providers: [HomeworkService, HomeworkScheduler]`。

- [ ] **Step 3: 运行验证**

Run: `cd server && npx vitest run src/homework && npm run build && npm run lint`
Expected: 全 PASS。确认 `npx prisma migrate status` 无待应用迁移（P2 零迁移）。

- [ ] **Step 4: Commit**

```bash
git add server/src/homework
git commit -m "feat(homework): 每分钟cron自动截止到期作业并幂等发放按时提交+2"
```

---

### Task 4: 作业查询（分角色 list + detail）与 e2e 基线

**Files:**
- Modify: `server/src/homework/homework.service.ts`（加 list/detail）
- Modify: `server/src/homework/homework.controller.ts`（加 GET 两端点）
- Test: Create `server/test/homework.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 的 create/update；全局守卫链。
- Produces:
  - `list(actor, opts: { classId?: number; status?: string; page: number; pageSize: number })`
    - teacher/admin 行：`{ id, classId, className, studentCount, title, content, dueAt, allowAttachment, status, createdAt, submissionCount, gradedCount }`
    - student 行：作业字段 + `klass:{name}` + `mySubmission`（`{ id, submittedAt, isLate, score, teacherComment, files:[{id,originalName,sizeBytes}] } | null`）
  - `detail(id, actor)`：teacher/admin → `{ homework(含 klass:{id,name,teacherId}), studentCount, unsubmittedCount, submissions:[{ id, userId, realName, username, textContent, submittedAt, isLate, score, teacherComment, files:[{id,originalName,sizeBytes,mimeType}] }] }`；student → `{ homework, mySubmission | null }`
  - HTTP：`GET /api/homeworks?classId=&status=&page=&pageSize=`（teacher/admin/student）、`GET /api/homeworks/:id`（同三角色）

- [ ] **Step 1: 写失败 e2e（完整脚手架，供 Task 5/6/7 复制模式）**

创建 `server/test/homework.e2e-spec.ts`。脚手架**逐段复用 `server/test/sessions.e2e-spec.ts:1-140`** 的全部既有约定：dotenv import、模块编译、`listen(0,'127.0.0.1')` 预热防 supertest 竞态、admin 凭据重置与 mustChangePassword 还原、教师A（建号+改密+登录+建班 classA，realName 前缀"作业教师A"）、教师B（建号+改密+登录）、本班学生直插（`sm{suffix}a`，realName `作业学生${suffix}`，密码 `studPass12`，mustChangePassword:false）+登录取 token、afterAll 清理。新增两处：

1. 教师B 建第二个班级（在教师B 登录后）：

```ts
    const classB = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${teacherBToken}`)
      .send({ name: `他班${suffix}` });
    classBId = classB.body.data.id;
```

2. afterAll 在 `pointRecord.deleteMany` 之前追加三表清理（外键序），并把 `class.deleteMany` 条件改为 `{ id: { in: [classAId, classBId] } }`：

```ts
    await prisma.homeworkFile.deleteMany({ where: { submission: { homework: { classId: { in: [classAId, classBId] } } } } });
    await prisma.homeworkSubmission.deleteMany({ where: { homework: { classId: { in: [classAId, classBId] } } } });
    await prisma.homework.deleteMany({ where: { classId: { in: [classAId, classBId] } } });
```

用例主体：

```ts
  const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

  it('1. 教师布置作业 → 200；他人班级 → 403；缺 title → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/homeworks')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ classId: classAId, title: '第七课抄写', content: '抄写课文并写感想', dueAt: future(24), allowAttachment: true });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBeDefined();
    const foreign = await request(app.getHttpServer())
      .post('/api/homeworks')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ classId: classBId, title: 'x', content: 'y', dueAt: future(24), allowAttachment: false });
    expect(foreign.status).toBe(403);
    const bad = await request(app.getHttpServer())
      .post('/api/homeworks')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ classId: classAId, content: 'y', dueAt: future(24), allowAttachment: false });
    expect(bad.status).toBe(400);
  });

  it('2. 学生调布置 → 403（角色门禁）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/homeworks')
      .set('Authorization', `Bearer ${sToken}`)
      .send({ classId: classAId, title: 'x', content: 'y', dueAt: future(1), allowAttachment: false });
    expect(res.status).toBe(403);
  });

  it('3. 教师列表仅本人班，含 submissionCount/gradedCount/studentCount', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/homeworks?page=1&pageSize=20')
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    const row = res.body.data.list[0];
    expect(row.className).toContain(suffix);
    expect(row.submissionCount).toBe(0);
    expect(row.gradedCount).toBe(0);
    expect(row.studentCount).toBe(1);
  });

  it('4. 显式 classId 指他人班 → 403；admin 查全部 → 含本班作业', async () => {
    const tB = await request(app.getHttpServer())
      .get(`/api/homeworks?classId=${classAId}`)
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(tB.status).toBe(403);
    const adm = await request(app.getHttpServer())
      .get('/api/homeworks')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adm.body.data.total).toBeGreaterThanOrEqual(1);
  });

  it('5. 学生列表仅本班；带 mySubmission:null', async () => {
    await request(app.getHttpServer())
      .post('/api/homeworks')
      .set('Authorization', `Bearer ${teacherBToken}`)
      .send({ classId: classBId, title: '他班作业', content: 'z', dueAt: future(24), allowAttachment: false });
    const res = await request(app.getHttpServer())
      .get('/api/homeworks')
      .set('Authorization', `Bearer ${sToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.list[0].mySubmission).toBeNull();
  });

  it('6. 手动截止：先结算按时分再 closed；重复截止 → 409 不重复加分', async () => {
    const hwId = (await prisma.homework.findFirstOrThrow({ where: { classId: classAId } })).id;
    await prisma.homeworkSubmission.create({
      data: { homeworkId: hwId, userId: sId, textContent: '已完成', submittedAt: new Date(), isLate: false },
    });
    const res = await request(app.getHttpServer())
      .patch(`/api/homeworks/${hwId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ status: 'closed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');
    const pts = await prisma.pointRecord.findMany({ where: { userId: sId, source: 'auto_homework', refId: hwId } });
    expect(pts).toHaveLength(1);
    expect(pts[0].delta).toBe(2);
    const again = await request(app.getHttpServer())
      .patch(`/api/homeworks/${hwId}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ status: 'closed' });
    expect(again.status).toBe(409);
    expect(await prisma.pointRecord.count({ where: { userId: sId, source: 'auto_homework', refId: hwId } })).toBe(1);
  });

  it('7. 教师 detail：submissions 含学生字段，unsubmittedCount=0', async () => {
    const hwId = (await prisma.homework.findFirstOrThrow({ where: { classId: classAId } })).id;
    const res = await request(app.getHttpServer())
      .get(`/api/homeworks/${hwId}`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.studentCount).toBe(1);
    expect(res.body.data.unsubmittedCount).toBe(0);
    expect(res.body.data.submissions[0].realName).toContain('作业学生');
  });

  it('8. 学生 detail：仅本人 mySubmission；他人教师 detail → 403', async () => {
    const hwId = (await prisma.homework.findFirstOrThrow({ where: { classId: classAId } })).id;
    const res = await request(app.getHttpServer())
      .get(`/api/homeworks/${hwId}`)
      .set('Authorization', `Bearer ${sToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.mySubmission.textContent).toBe('已完成');
    const tB = await request(app.getHttpServer())
      .get(`/api/homeworks/${hwId}`)
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(tB.status).toBe(403);
  });
```

Run: `cd server && npx vitest run --config vitest.config.e2e.ts test/homework.e2e-spec.ts` → Expected: 用例 3/4/5/7/8 FAIL（GET /homeworks 路由 404）。

- [ ] **Step 2: 实现 list**

`homework.service.ts` 补 `import { Prisma } from '@prisma/client';`，追加方法：

```ts
  /** 分角色作业列表：teacher=本人班；admin=全部(可按班过滤)；student=本班全部状态+本人提交（规格 §6） */
  async list(actor: Actor, opts: { classId?: number; status?: string; page: number; pageSize: number }) {
    const page = Math.max(1, Math.floor(opts.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize) || 20));

    if (actor.role === 'student') {
      const me = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { classId: true } });
      if (!me?.classId) return { list: [], total: 0, page, pageSize };
      const where: Prisma.HomeworkWhereInput = { classId: me.classId };
      if (opts.status === 'published' || opts.status === 'closed') where.status = opts.status;
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.homework.findMany({
          where,
          orderBy: { dueAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { klass: { select: { name: true } } },
        }),
        this.prisma.homework.count({ where }),
      ]);
      const mine = await this.prisma.homeworkSubmission.findMany({
        where: { userId: actor.id, homeworkId: { in: rows.map((r) => r.id) } },
        include: { files: { select: { id: true, originalName: true, sizeBytes: true } } },
      });
      const map = new Map(mine.map((s) => [s.homeworkId, s]));
      return { list: rows.map((r) => ({ ...r, mySubmission: map.get(r.id) ?? null })), total, page, pageSize };
    }

    const where: Prisma.HomeworkWhereInput = {};
    if (actor.role === 'teacher') where.klass = { teacherId: actor.id };
    if (opts.classId) {
      const klass = await this.prisma.class.findUnique({ where: { id: opts.classId } });
      if (!klass) throw new NotFoundException('班级不存在');
      if (actor.role === 'teacher' && klass.teacherId !== actor.id) {
        throw new ForbiddenException('无权查看该班级作业');
      }
      where.classId = opts.classId;
    }
    if (opts.status === 'published' || opts.status === 'closed') where.status = opts.status;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.homework.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          klass: { select: { name: true, _count: { select: { students: true } } } },
          _count: { select: { submissions: true } },
        },
      }),
      this.prisma.homework.count({ where }),
    ]);
    const graded = await this.prisma.homeworkSubmission.groupBy({
      by: ['homeworkId'],
      where: { homeworkId: { in: rows.map((r) => r.id) }, score: { not: null } },
      _count: { _all: true },
    });
    const gmap = new Map(graded.map((g) => [g.homeworkId, g._count._all]));
    return {
      list: rows.map((r) => ({
        id: r.id,
        classId: r.classId,
        className: r.klass.name,
        studentCount: r.klass._count.students,
        title: r.title,
        content: r.content,
        dueAt: r.dueAt,
        allowAttachment: r.allowAttachment,
        status: r.status,
        createdAt: r.createdAt,
        submissionCount: r._count.submissions,
        gradedCount: gmap.get(r.id) ?? 0,
      })),
      total,
      page,
      pageSize,
    };
  }
```

- [ ] **Step 3: 实现 detail + 两端点**

```ts
  /** 作业详情：教师/admin=提交全集（批改视图数据源），学生=本人提交 */
  async detail(id: number, actor: Actor) {
    const hw = await this.prisma.homework.findUnique({
      where: { id },
      include: { klass: { select: { id: true, name: true, teacherId: true } } },
    });
    if (!hw) throw new NotFoundException('作业不存在');

    if (actor.role === 'student') {
      const me = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { classId: true } });
      if (!me?.classId || me.classId !== hw.classId) throw new ForbiddenException('无权查看该作业');
      const mine = await this.prisma.homeworkSubmission.findUnique({
        where: { homeworkId_userId: { homeworkId: id, userId: actor.id } },
        include: { files: { select: { id: true, originalName: true, sizeBytes: true } } },
      });
      return { homework: hw, mySubmission: mine };
    }
    if (actor.role === 'teacher' && hw.klass.teacherId !== actor.id) {
      throw new ForbiddenException('无权查看该作业');
    }
    const [submissions, studentCount] = await Promise.all([
      this.prisma.homeworkSubmission.findMany({
        where: { homeworkId: id },
        orderBy: { id: 'asc' },
        include: {
          user: { select: { id: true, realName: true, username: true } },
          files: { select: { id: true, originalName: true, sizeBytes: true, mimeType: true } },
        },
      }),
      this.prisma.user.count({ where: { classId: hw.classId, role: 'student' } }),
    ]);
    return {
      homework: hw,
      studentCount,
      unsubmittedCount: studentCount - submissions.length,
      submissions: submissions.map((s) => ({
        id: s.id,
        userId: s.userId,
        realName: s.user.realName,
        username: s.user.username,
        textContent: s.textContent,
        submittedAt: s.submittedAt,
        isLate: s.isLate,
        score: s.score,
        teacherComment: s.teacherComment,
        files: s.files,
      })),
    };
  }
```

`homework.controller.ts` import 补 `Get, Query, DefaultValuePipe`；新增端点：

```ts
  @Get('homeworks')
  @Roles('teacher', 'admin', 'student')
  list(
    @CurrentUser() user: { id: number; role: string },
    @Query('classId') classId?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
  ) {
    return this.homeworkService.list(user, {
      classId: classId ? Number(classId) : undefined,
      status,
      page,
      pageSize,
    });
  }

  @Get('homeworks/:id')
  @Roles('teacher', 'admin', 'student')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number; role: string }) {
    return this.homeworkService.detail(id, user);
  }
```

- [ ] **Step 4: e2e 通过 + 回归**

Run: `cd server && npx vitest run --config vitest.config.e2e.ts test/homework.e2e-spec.ts && npx vitest run src/homework && npm run lint`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/homework server/test/homework.e2e-spec.ts
git commit -m "feat(homework): 分角色作业列表与详情查询（教师统计/学生本人提交视图）+ e2e 基线"
```

---

### Task 5: 作业提交（multipart 附件，staging→事务→rename，失败补偿清理）

**Files:**
- Create: `server/src/homework/homework.constants.ts`
- Create: `server/src/homework/dto/create-submission.dto.ts`
- Create: `server/src/homework/submissions.service.ts`
- Modify: `server/src/homework/homework.controller.ts`（加 POST submissions 端点）
- Modify: `server/src/homework/homework.module.ts`（providers/exports 加 SubmissionsService）
- Test: `server/test/homework-upload.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 4 的 Homework 查询口径；`PrismaClient`（`prisma.homeworkSubmission` / `prisma.homeworkFile`）。
- Produces:
  - `uploadRoot(): string`（惰性读 `process.env.UPLOAD_DIR`，默认 `process.cwd()` 下 `uploads`，e2e 用 `process.env.UPLOAD_DIR = mkdtempSync(...)` 注入）
  - `stagingDir(): string` = `join(uploadRoot(), 'staging')`
  - `MAX_FILE_BYTES = 10 * 1024 * 1024`、`MAX_FILES = 3`、`ALLOWED_EXT = ['jpg','jpeg','png','pdf','doc','docx','zip']`
  - `interface MulterFileInfo { fieldname: string; originalname: string; mimetype: string; size: number; buffer: Buffer }`（不引入 `@types/multer`，本文件自定义）
  - `SubmissionsService.submit(homeworkId: number, dto: CreateSubmissionDto, files: MulterFileInfo[], actor: { id: number; role: string }): Promise<{ id: number; homeworkId: number; submittedAt: Date; isLate: boolean }>`
  - 正式存储相对路径 `storedKey` 形如 `homework/<yyyy-mm>/<uuid>.<ext>`（相对 `uploadRoot()`）

- [ ] **Step 1: 写 constants**

```ts
// server/src/homework/homework.constants.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** 惰性读取，便于 e2e 用 mkdtempSync 注入 UPLOAD_DIR */
export function uploadRoot(): string {
  return process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
}

export function stagingDir(): string {
  return join(uploadRoot(), 'staging');
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 单文件 10MB（业务限制，413）
export const MAX_FILES = 3; // 每次提交最多 3 个附件（400）
export const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx', 'zip'];

export function ensureDirs(): void {
  mkdirSync(stagingDir(), { recursive: true });
}

/** 取小写扩展名（不含点）；无扩展名返回空串 */
export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i < 0 ? '' : filename.slice(i + 1).toLowerCase();
}

export interface MulterFileInfo {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
```

- [ ] **Step 2: 写 CreateSubmissionDto**

```ts
// server/src/homework/dto/create-submission.dto.ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateSubmissionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  textContent!: string;
}
```

- [ ] **Step 3: 写 SubmissionsService（完整代码）**

设计要点（规格 §5.2/§8/§9）：multer 拦截器 limits 放宽（50MB、maxCount=10），**业务限制在 service 内校验**以获得确定的 413/415/400；流程 = 缓冲写 staging → `$transaction`（删旧行+旧文件记录、插新）→ rename 到正式目录；任一步失败做补偿删除（staging、正式、已提交事务产物）。busboy 的 `originalname` 是 latin1，需转 utf8。

```ts
// server/src/homework/submissions.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ALLOWED_EXT,
  MAX_FILE_BYTES,
  MAX_FILES,
  MulterFileInfo,
  ensureDirs,
  extOf,
  stagingDir,
  uploadRoot,
} from './homework.constants.js';
import type { CreateSubmissionDto } from './dto/create-submission.dto.js';

interface Staged {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  stagingPath: string;
  finalRel: string; // 相对 uploadRoot 的正式路径
}

@Injectable()
export class SubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

  private validateFiles(files: MulterFileInfo[], allowAttachment: boolean): void {
    if (files.length === 0) return;
    if (!allowAttachment) {
      throw new BadRequestException('该作业不允许提交附件');
    }
    if (files.length > MAX_FILES) {
      throw new BadRequestException(`最多上传 ${MAX_FILES} 个附件`);
    }
    for (const f of files) {
      const ext = extOf(f.originalname);
      if (!ALLOWED_EXT.includes(ext)) {
        throw new UnsupportedMediaTypeException(`不支持的文件类型：${f.originalname}`);
      }
      if (f.size > MAX_FILE_BYTES) {
        throw new PayloadTooLargeException(`单文件不能超过 10MB：${f.originalname}`);
      }
    }
  }

  async submit(
    homeworkId: number,
    dto: CreateSubmissionDto,
    files: MulterFileInfo[],
    actor: { id: number; role: string },
  ): Promise<{ id: number; homeworkId: number; submittedAt: Date; isLate: boolean }> {
    if (actor.role !== 'student') throw new ForbiddenException('仅学生可提交作业');
    const student = await this.prisma.user.findUnique({ where: { id: actor.id } });
    const hw = await this.prisma.homework.findUnique({ where: { id: homeworkId } });
    if (!hw) throw new NotFoundException('作业不存在');
    if (!student || student.classId !== hw.classId) {
      throw new ForbiddenException('无权提交该作业的班级作业');
    }
    this.validateFiles(files, hw.allowAttachment);

    ensureDirs();
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 1) 缓冲 → staging 落盘
    const staged: Staged[] = [];
    for (const f of files) {
      const originalName = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const ext = extOf(originalName) || 'bin';
      const finalRel = join('homework', month, `${randomUUID()}.${ext}`);
      const stagingPath = join(stagingDir(), `${randomUUID()}.${ext}`);
      await writeFile(stagingPath, f.buffer);
      staged.push({
        originalName,
        mimeType: f.mimetype,
        sizeBytes: f.size,
        stagingPath,
        finalRel,
      });
    }

    // 2) DB 事务：覆盖旧提交（删旧附件行 + 删旧提交行 → 插新）
    let committedId = 0;
    let oldFileKeys: string[] = [];
    try {
      const submission = await this.prisma.$transaction(async (tx) => {
        const old = await tx.homeworkSubmission.findUnique({
          where: { homeworkId_userId: { homeworkId, userId: student.id } },
          include: { files: { select: { storedKey: true } } },
        });
        if (old) {
          oldFileKeys = old.files.map((x) => x.storedKey);
          await tx.homeworkFile.deleteMany({ where: { submissionId: old.id } });
          await tx.homeworkSubmission.delete({ where: { id: old.id } });
        }
        const created = await tx.homeworkSubmission.create({
          data: {
            homeworkId,
            userId: student.id,
            textContent: dto.textContent,
            submittedAt: now,
            isLate: now > hw.dueAt,
          },
        });
        if (staged.length) {
          await tx.homeworkFile.createMany({
            data: staged.map((s) => ({
              submissionId: created.id,
              originalName: s.originalName,
              storedKey: s.finalRel,
              mimeType: s.mimeType,
              sizeBytes: s.sizeBytes,
            })),
          });
        }
        return created;
      });
      committedId = submission.id;

      // 3) staging → 正式目录 rename；旧文件尽力删除
      for (const s of staged) {
        const absFinal = join(uploadRoot(), s.finalRel);
        await mkdir(dirname(absFinal), { recursive: true });
        await rename(s.stagingPath, absFinal);
      }
      for (const key of oldFileKeys) {
        await unlink(join(uploadRoot(), key)).catch(() => undefined);
      }
      return {
        id: submission.id,
        homeworkId,
        submittedAt: submission.submittedAt,
        isLate: submission.isLate,
      };
    } catch (e) {
      // 补偿：删 DB 行 + 清 staging/正式残留，再原样抛出
      if (committedId) {
        await this.prisma.homeworkFile
          .deleteMany({ where: { submissionId: committedId } })
          .catch(() => undefined);
        await this.prisma.homeworkSubmission
          .delete({ where: { id: committedId } })
          .catch(() => undefined);
      }
      for (const s of staged) {
        await unlink(s.stagingPath).catch(() => undefined);
        await unlink(join(uploadRoot(), s.finalRel)).catch(() => undefined);
      }
      throw e;
    }
  }
}
```

- [ ] **Step 4: controller 加端点 + module 注册**

`homework.controller.ts` 增加（并 `import { Body, UploadedFiles, UseInterceptors }`、`FilesInterceptor` 从 `@nestjs/platform-express`）：

```ts
  @Post('homeworks/:id/submissions')
  @HttpCode(HttpStatus.OK)
  @Roles('student')
  submit(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
    @Body() dto: CreateSubmissionDto,
    @UploadedFiles() files?: MulterFileInfo[],
  ) {
    return this.submissions.submit(id, dto, files ?? [], user);
  }
```

拦截器参数（放宽防止内存滥用上限，业务限制在 service）：

```ts
@UseInterceptors(
  FilesInterceptor('files', MAX_FILES + 7, { limits: { fileSize: 50 * 1024 * 1024 } }),
)
```

`homework.module.ts`：providers 与 exports 均加 `SubmissionsService`。

- [ ] **Step 5: 写 e2e `server/test/homework-upload.e2e-spec.ts`**

脚手架完全复用 `server/test/homework.e2e-spec.ts`（Task 4 产物：dotenv、Test module、`setGlobalPrefix('api')`、ValidationPipe whitelist、`listen(0,'127.0.0.1')`、admin 密码重置、教师 A/B 与学生创建流程）。差异：
- `beforeAll` 第一行：`process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'hw-up-'));`（`import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';`）
- `afterAll` 末尾（close 后）：`rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true });`
- 班级/用户命名后缀用 `hwup`，学生记为 sC（`sCId`/`sCUsername`）；额外创建教师 B 的 classC 不需要——仅教师 A 班级即可。
- beforeAll 尾部由教师 A 创建 `allowAttachment: true` 的作业，title `附件作业`，dueAt 取未来 3 小时，记录 `hwId`。

用例（multipart 用 supertest 的 `.attach(name, buffer, { contentType })` 发送）：

```ts
const pdf = (name: string, bytes = 1024) => ({
  name,
  payload: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes, 7)]),
  contentType: 'application/pdf',
});

// 1. 学生A首次提交（文本+2个PDF附件）→ 200，isLate=false
//    expect body.data.submittedAt、data.id 存在；
//    prisma.homeworkFile.findMany({where:{submissionId:data.id}}) 两条，
//    storedKey 匹配 /^homework\/\d{4}-\d{2}\/[0-9a-f-]+\.pdf$/
//    磁盘断言：existsSync(join(UPLOAD_DIR, storedKey)) === true；
//    readdirSync(join(UPLOAD_DIR,'staging')) 为空数组
// 2. 重交覆盖：再次 .attach 1 个 pdf 提交新文本 → 200；
//    prisma.homeworkSubmission.count({where:{homeworkId:hwId}})===1；
//    files 只剩 1 条；旧 storedKey 的磁盘文件 existsSync === false
// 3. 类型白名单：attach .exe 文件名 → 415，消息含「不支持的文件类型」；
//    DB 提交行数不变（仍覆盖前的 1 条），staging 无残留（readdir 为空）
// 4. 大小限制：attach 11MB 合法扩展名文件 → 413，消息含「单文件不能超过 10MB」
// 5. 数量限制：attach 4 个 1KB pdf → 400「最多上传 3 个附件」，无落库无残留
// 6. 纯文本提交（不 attach）→ 200；textContent 为空字符串 → 400
// 7. 非本班学生（教师 B 直接 prisma 插入 sD 到 classB）提交 → 403；
//    对 allowAttachment:false 的作业（教师 A 再建一条 noAttId）attach → 400「该作业不允许提交附件」
// 8. 已过截止（prisma 把 hw.dueAt 改为 1 小时前）学生A再提交 → 200 且 data.isLate === true
// 9. 教师列表 submissionCount 统计：GET /homeworks?classId=classAId → 该作业 submissionCount===1
```

- [ ] **Step 6: 运行验证**

Run: `cd server && npx vitest run --config vitest.config.e2e.ts test/homework-upload.e2e-spec.ts && npm run lint`
Expected: 全 PASS，lint 干净。

- [ ] **Step 7: Commit**

```bash
git add server/src/homework server/test/homework-upload.e2e-spec.ts
git commit -m "feat(homework): 学生作业提交（multipart附件，staging事务落盘与失败补偿）"
```

---

### Task 6: 附件下载（鉴权 + 流式响应 + 中文文件名）

**Files:**
- Create: `server/src/homework/files.controller.ts`
- Modify: `server/src/homework/submissions.service.ts`（加 `getForDownload`）
- Modify: `server/src/homework/homework.module.ts`（controllers 加 FilesController）
- Test: `server/test/homework-upload.e2e-spec.ts`（追加用例 10–12）

**Interfaces:**
- Consumes: Task 5 的 `uploadRoot()`、`HomeworkFile.storedKey`。
- Produces:
  - `SubmissionsService.getForDownload(fileId: number, actor: { id: number; role: string }): Promise<{ absolutePath: string; originalName: string }>`
  - `GET /files/:id/download`（@Res 流式，不套 TransformInterceptor 响应体）

- [ ] **Step 1: service 加 getForDownload（完整代码）**

追加到 `submissions.service.ts`（并在文件头补 `import { existsSync } from 'node:fs';` 与 `ForbiddenException` 已有）：

```ts
  async getForDownload(
    fileId: number,
    actor: { id: number; role: string },
  ): Promise<{ absolutePath: string; originalName: string }> {
    const file = await this.prisma.homeworkFile.findUnique({
      where: { id: fileId },
      include: {
        submission: {
          include: { homework: { select: { createdBy: true } } },
        },
      },
    });
    if (!file) throw new NotFoundException('文件不存在');
    const owner = actor.role === 'admin'
      || file.submission.userId === actor.id
      || file.submission.homework.createdBy === actor.id;
    if (!owner) throw new ForbiddenException('无权下载该附件');
    const abs = join(uploadRoot(), file.storedKey);
    // 防穿越：resolve 后必须仍在 uploadRoot 内
    if (!resolve(abs).startsWith(resolve(uploadRoot()) + sep)) {
      throw new ForbiddenException('非法文件路径');
    }
    if (!existsSync(abs)) throw new NotFoundException('文件已丢失');
    return { absolutePath: abs, originalName: file.originalName };
  }
```

import 处补 `resolve, sep`（来自 `node:path`）。

- [ ] **Step 2: 写 FilesController（完整代码）**

```ts
// server/src/homework/files.controller.ts
import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { SubmissionsService } from './submissions.service.js';

@Controller()
export class FilesController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get('files/:id/download')
  @Roles('admin', 'teacher', 'student')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
    @Res() res: Response,
  ) {
    const { absolutePath, originalName } = await this.submissions.getForDownload(id, user);
    const fallback = basename(originalName).replace(/[^\x20-\x7e]/g, '_') || 'file';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
    );
    createReadStream(absolutePath).pipe(res);
  }
}
```

- [ ] **Step 3: module 注册**

`homework.module.ts`（Task 2 已建 `controllers: [HomeworkController]`）：import `FilesController`，controllers 改为 `[HomeworkController, FilesController]`。

- [ ] **Step 4: e2e 追加用例（homework-upload.e2e-spec.ts，接在原 9 条后）**

```
10. 本人下载：先提交拿到 fileA（取 prisma 该提交第一条 homeworkFile.id），
    以学生身份 GET /api/files/{fileA}/download .buffer() → 200；
    headers['content-disposition'] 含 filename*=UTF-8'' 且 res.body.length === sizeBytes
11. 教师（布置者）下载同一文件 → 200；管理员 → 200
12. 越权：另一班学生 sD（Task 5 用例 7 所建）下载 → 403；
    GET /api/files/99999999/download（认证学生）→ 404
```

- [ ] **Step 5: 运行验证**

Run: `cd server && npx vitest run --config vitest.config.e2e.ts test/homework-upload.e2e-spec.ts && npm run lint`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add server/src/homework server/test/homework-upload.e2e-spec.ts
git commit -m "feat(homework): 作业附件下载（本人/布置教师/管理员鉴权与中文文件名）"
```

---

### Task 7: 批改（评分+点评）与成绩名册/CSV 导出

**Files:**
- Create: `server/src/homework/dto/grade-submission.dto.ts`
- Modify: `server/src/homework/homework.service.ts`（加 `grade`、`grades`、私有 `gradesCsv`）
- Modify: `server/src/homework/homework.controller.ts`（PATCH grade + GET grades @Res）
- Test: `server/test/homework-grades.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 4 `HomeworkService` 构造与 prisma 口径；`records.service.ts:136-158` 的 BOM/CRLF CSV 模式。
- Produces:
  - `HomeworkService.grade(submissionId: number, dto: GradeSubmissionDto, actor: { id: number; role: string }): Promise<{ id: number; score: Prisma.Decimal | null }>`
  - `HomeworkService.grades(homeworkId: number, actor: { id: number; role: string }, opts: { exportCsv?: string; page: number; pageSize: number }): Promise<string | { list: GradeRow[]; total: number; stats: { submitted: number; graded: number; late: number; unsubmitted: number } }>`
  - `GradeRow = { userId: number; realName: string; username: string; submittedAt: string | null; state: '未交' | '迟交' | '按时'; score: number | null; teacherComment: string | null }`

- [ ] **Step 1: 写 GradeSubmissionDto**

```ts
// server/src/homework/dto/grade-submission.dto.ts
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GradeSubmissionDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
```

- [ ] **Step 2: 写失败 e2e（先建 `server/test/homework-grades.e2e-spec.ts`）**

脚手架复用 `homework.e2e-spec.ts`（Task 4），后缀 `hwgr`；beforeAll 尾部：教师 A 布置作业（title `批改作业`，dueAt 过去 1 小时，allowAttachment false），学生 A 直接 prisma 插入 submission（isLate false），学生 B（`sm{suffix}b`，同班，另建用户名 `sB`）插入 isLate true；用例：

```
1. 教师 PATCH /api/homework/submissions/{subA}/grade body {score:92.5, comment:'很好'} → 200；
   prisma 断言 score 到 92.5、teacherComment '很好'、gradedBy=教师A id、gradedAt 非空
2. 重复 PATCH {score:88}（不传 comment）→ 200 且 teacherComment 被清空为 null
   （与考勤 note 同口径：comment ?? null）
3. 他人教师 B PATCH → 403；学生 PATCH → 403；score:101 → 400
4. 学生 GET /api/homeworks/{hwId}（detail）→ data.mySubmission.score 字符串含 '88'、teacherComment null
5. GET /api/homeworks/{hwId}/grades → 200 data：total 2；
   rows 中学 A state '按时' score 88，学 B state '迟交' score null；
   stats {submitted:2, graded:1, late:1, unsubmitted:0}
6. GET /api/homeworks/{hwId}/grades?export=csv → 200 text/csv；
   首字符 charCodeAt(0)===0xfeff（BOM）；行含 `按时,88.00,` 与 `迟交,,`（CRLF 分隔）
7. 非本班教师 B GET grades（对 classA 的作业）→ 403；管理员 → 200（只读）
```

Run 先确认 FAIL（端点 404）。

- [ ] **Step 3: HomeworkService 实现 grade / grades / gradesCsv（完整代码）**

```ts
  async grade(
    submissionId: number,
    dto: GradeSubmissionDto,
    actor: { id: number; role: string },
  ) {
    const sub = await this.prisma.homeworkSubmission.findUnique({
      where: { id: submissionId },
      include: { homework: { select: { createdBy: true } } },
    });
    if (!sub) throw new NotFoundException('提交不存在');
    if (sub.homework.createdBy !== actor.id) throw new ForbiddenException('仅布置教师可批改');
    return this.prisma.homeworkSubmission.update({
      where: { id: submissionId },
      data: {
        score: dto.score,
        teacherComment: dto.comment ?? null, // 留空即清空点评，与考勤 note 同口径
        gradedBy: actor.id,
        gradedAt: new Date(),
      },
      select: { id: true, score: true },
    });
  }

  async grades(
    homeworkId: number,
    actor: { id: number; role: string },
    opts: { exportCsv?: string; page: number; pageSize: number },
  ) {
    const hw = await this.prisma.homework.findUnique({
      where: { id: homeworkId },
      include: { klass: { select: { id: true, name: true, teacherId: true } } },
    });
    if (!hw) throw new NotFoundException('作业不存在');
    if (actor.role === 'teacher' && hw.klass.teacherId !== actor.id) {
      throw new ForbiddenException('无权查看该作业成绩');
    }
    const students = await this.prisma.user.findMany({
      where: { classId: hw.classId, role: 'student' },
      orderBy: { id: 'asc' },
      select: { id: true, realName: true, username: true },
    });
    const subs = await this.prisma.homeworkSubmission.findMany({
      where: { homeworkId },
      select: { userId: true, submittedAt: true, isLate: true, score: true, teacherComment: true },
    });
    const byUser = new Map(subs.map((s) => [s.userId, s]));
    const rows: GradeRow[] = students.map((st) => {
      const s = byUser.get(st.id);
      return {
        userId: st.id,
        realName: st.realName,
        username: st.username,
        submittedAt: s ? s.submittedAt.toISOString() : null,
        state: !s ? '未交' : s.isLate ? '迟交' : '按时',
        score: s?.score != null ? Number(s.score) : null,
        teacherComment: s?.teacherComment ?? null,
      };
    });
    if (opts.exportCsv === 'csv') {
      return this.gradesCsv(hw.title, rows);
    }
    const stats = {
      submitted: rows.filter((r) => r.state !== '未交').length,
      graded: rows.filter((r) => r.score != null).length,
      late: rows.filter((r) => r.state === '迟交').length,
      unsubmitted: rows.filter((r) => r.state === '未交').length,
    };
    const p = Math.max(1, Math.floor(opts.page));
    const ps = Math.min(100, Math.max(1, Math.floor(opts.pageSize)));
    return { list: rows.slice((p - 1) * ps, p * ps), total: rows.length, stats };
  }

  private gradesCsv(title: string, rows: GradeRow[]): string {
    const esc = (v: string | number | null): string => {
      const s = v == null ? '' : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = '姓名,用户名,提交时间,状态,分数,点评';
    const lines = [header, ...rows.map((r) =>
      [
        r.realName,
        r.username,
        r.submittedAt ? new Date(r.submittedAt).toLocaleString('zh-CN', { hour12: false }) : '',
        r.state,
        r.score != null ? r.score.toFixed(2) : '',
        r.teacherComment ?? '',
      ].map(esc).join(','),
    )];
    return `\uFEFF作业：${esc(title)}\r\n` + `${lines.join('\r\n')}\r\n`;
  }
```

（`GradeRow` 接口定义在 `homework.service.ts` 顶部并 `export`；补 import `GradeSubmissionDto`。）

- [ ] **Step 4: controller 两端点**

```ts
  @Patch('homework/submissions/:id/grade')
  @HttpCode(HttpStatus.OK)
  @Roles('teacher')
  grade(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
    @Body() dto: GradeSubmissionDto,
  ) {
    return this.homeworkService.grade(id, dto, user);
  }

  @Get('homeworks/:id/grades')
  @Roles('admin', 'teacher')
  async grades(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
    @Query('export') exportCsv: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Res() res: Response,
  ) {
    const result = await this.homeworkService.grades(id, user, { exportCsv, page, pageSize });
    // @Res() 接管后 TransformInterceptor 不生效，需手动保持统一响应格式
    if (typeof result === 'string') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(result);
      return;
    }
    res.json({ code: 0, message: 'ok', data: result });
  }
```

controller 补 import：`Patch, Body, DefaultValuePipe, Query, Res`、`type { Response } from 'express'`、`GradeSubmissionDto`。

- [ ] **Step 5: e2e 通过 + 回归**

Run: `cd server && npx vitest run --config vitest.config.e2e.ts test/homework-grades.e2e-spec.ts && npx vitest run src/homework && npm run lint`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add server/src/homework server/test/homework-grades.e2e-spec.ts
git commit -m "feat(homework): 批改评分点评与成绩名册（JSON分页+CSV BOM导出）"
```

---

### Task 8: 教师作业管理页（列表 + 布置弹窗 + 截止/导出入口）与菜单路由

**Files:**
- Create: `web/src/views/teacher/HomeworkList.vue`
- Create: `web/src/views/__tests__/HomeworkList.spec.ts`
- Modify: `web/src/layouts/menus.ts`（teacherMenus 课堂管理 children 追加）
- Modify: `web/src/router/index.ts`（teacher children 追加）

**Interfaces:**
- Consumes: Task 4 `GET /homeworks` 返回 `{ list, total }`，行形状（教师分支）`{ id, classId, className, title, content, dueAt, allowAttachment, status, createdAt, submissionCount, studentCount, gradedCount }`；Task 7 `GET /homeworks/:id/grades?export=csv`；`PATCH /homeworks/:id` body `{ status:'closed' }`；`POST /homeworks` body `{ classId, title, content, dueAt, allowAttachment }`。
- Produces: 路由 `/teacher/homeworks`；批改页跳转 `/teacher/homeworks/{id}/grading`（Task 9 实现）。

- [ ] **Step 1: 写组件测试（先失败）**

`web/src/views/__tests__/HomeworkList.spec.ts`，风格完全对齐 `SessionAttendance.spec.ts`（vi.hoisted mocks + `vi.mock('@/utils/request')` + mount ElementPlus + flushPromises + unmount）：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
vi.mock('@/utils/request', () => ({ default: mocks }))

import HomeworkList from '../teacher/HomeworkList.vue'

const classesPayload = { list: [{ id: 3, name: '三年2班', studentCount: 2 }], total: 1 }
const homeworksPayload = {
  list: [
    {
      id: 7,
      title: '第三课作业',
      classId: 3,
      className: '三年2班',
      dueAt: '2026-10-06T10:00:00.000Z',
      status: 'published',
      allowAttachment: true,
      submissionCount: 1,
      studentCount: 2,
      gradedCount: 0,
    },
  ],
  total: 1,
}

describe('教师作业管理页', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
  })

  it('加载班级与作业列表并渲染统计', async () => {
    mocks.get.mockResolvedValueOnce(classesPayload).mockResolvedValueOnce(homeworksPayload)
    const wrapper = mount(HomeworkList, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.find('[data-testid="homework-table"]').text()).toContain('第三课作业')
    expect(wrapper.find('[data-testid="homework-table"]').text()).toContain('1/2')
    expect(wrapper.find('[data-testid="homework-table"]').text()).toContain('待批改 1')
    wrapper.unmount()
  })

  it('布置作业提交 POST /homeworks', async () => {
    mocks.get.mockResolvedValueOnce(classesPayload).mockResolvedValueOnce(homeworksPayload)
    mocks.post.mockResolvedValueOnce({ id: 8 })
    const wrapper = mount(HomeworkList, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.find('[data-testid="open-create"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-testid="form-title"] input').setValue('新作业')
    const due = new Date(Date.now() + 3600_000).toISOString()
    ;(wrapper.vm as unknown as { create: { dueAt: string } }).create.dueAt = due
    await wrapper.find('[data-testid="form-submit"]').trigger('click')
    await flushPromises()
    expect(mocks.post).toHaveBeenCalledWith(
      '/homeworks',
      expect.objectContaining({ classId: 3, title: '新作业' }),
    )
    wrapper.unmount()
  })

  it('截止按钮二次确认后 PATCH closed', async () => {
    mocks.get.mockResolvedValueOnce(classesPayload).mockResolvedValueOnce(homeworksPayload)
    mocks.patch.mockResolvedValueOnce({ id: 7, status: 'closed' })
    const wrapper = mount(HomeworkList, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    const { ElMessageBox } = await import('element-plus')
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm')
    await wrapper.find('[data-testid="close-hw-7"]').trigger('click')
    await flushPromises()
    expect(mocks.patch).toHaveBeenCalledWith('/homeworks/7', { status: 'closed' })
    wrapper.unmount()
  })

  it('状态筛选透传 classId/status 参数', async () => {
    mocks.get.mockResolvedValueOnce(classesPayload).mockResolvedValueOnce(homeworksPayload)
    const wrapper = mount(HomeworkList, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    ;(wrapper.vm as unknown as { filterStatus: string }).filterStatus = 'closed'
    const refresh = (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh
    await refresh()
    expect(mocks.get).toHaveBeenLastCalledWith('/homeworks', {
      params: { page: 1, pageSize: 20, classId: undefined, status: 'closed' },
    })
    wrapper.unmount()
  })
})
```

Run: `cd web && npx vitest run src/views/__tests__/HomeworkList.spec.ts` → FAIL（组件不存在）。

- [ ] **Step 2: 写 HomeworkList.vue（完整代码）**

```vue
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'

interface Klass {
  id: number
  name: string
  studentCount: number
}
interface HwRow {
  id: number
  title: string
  classId: number
  className: string
  dueAt: string
  status: 'published' | 'closed'
  allowAttachment: boolean
  submissionCount: number
  studentCount: number
  gradedCount: number
}

const classes = ref<Klass[]>([])
const rows = ref<HwRow[]>([])
const total = ref(0)
const page = ref(1)
const filterClass = ref<number | undefined>(undefined)
const filterStatus = ref('')
const loading = ref(false)

const create = reactive({
  visible: false,
  classId: undefined as number | undefined,
  title: '',
  content: '',
  dueAt: '',
  allowAttachment: false,
})

async function refresh() {
  loading.value = true
  try {
    const data = await request.get<{ list: HwRow[]; total: number }>('/homeworks', {
      params: {
        page: page.value,
        pageSize: 20,
        classId: filterClass.value ?? undefined,
        status: filterStatus.value || undefined,
      },
    })
    rows.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function openCreate() {
  create.visible = true
  create.classId = filterClass.value ?? classes.value[0]?.id
}

async function submitCreate() {
  if (!create.classId || !create.title.trim() || !create.dueAt) {
    ElMessage.warning('班级、标题、截止时间必填')
    return
  }
  await request.post('/homeworks', {
    classId: create.classId,
    title: create.title.trim(),
    content: create.content,
    dueAt: create.dueAt,
    allowAttachment: create.allowAttachment,
  })
  ElMessage.success('已布置')
  create.visible = false
  create.title = ''
  create.content = ''
  create.dueAt = ''
  await refresh()
}

async function closeHw(row: HwRow) {
  try {
    await ElMessageBox.confirm(
      '截止后学生只能补交（计为迟交），并自动发放按时提交积分。确认截止？',
      '截止作业',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await request.patch(`/homeworks/${row.id}`, { status: 'closed' })
  ElMessage.success('已截止')
  await refresh()
}

async function exportCsv(row: HwRow) {
  const blob = await request.get<Blob>(`/homeworks/${row.id}/grades`, {
    params: { export: 'csv' },
    responseType: 'blob',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${row.title}-成绩.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

onMounted(async () => {
  const data = await request.get<{ list: Klass[] }>('/classes')
  classes.value = data.list
  await refresh()
})

defineExpose({ create, filterStatus, refresh })
</script>

<template>
  <div v-loading="loading">
    <h3>作业管理</h3>
    <div class="bar">
      <el-select v-model="filterClass" clearable placeholder="全部班级" style="width: 200px" @change="refresh">
        <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="filterStatus" clearable placeholder="全部状态" style="width: 140px" @change="refresh">
        <el-option label="进行中" value="published" />
        <el-option label="已截止" value="closed" />
      </el-select>
      <el-button type="primary" data-testid="open-create" @click="openCreate">布置作业</el-button>
    </div>

    <el-table :data="rows" data-testid="homework-table" border>
      <el-table-column prop="title" label="标题" min-width="180" />
      <el-table-column label="班级" width="140">
        <template #default="{ row }">{{ row.className }}</template>
      </el-table-column>
      <el-table-column label="截止" width="180">
        <template #default="{ row }">{{ fmt(row.dueAt) }}</template>
      </el-table-column>
      <el-table-column label="提交" width="90">
        <template #default="{ row }">{{ row.submissionCount }}/{{ row.studentCount }}</template>
      </el-table-column>
      <el-table-column label="待批改" width="90">
        <template #default="{ row }">待批改 {{ row.submissionCount - row.gradedCount }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'published' ? 'success' : 'info'" size="small">
            {{ row.status === 'published' ? '进行中' : '已截止' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="230">
        <template #default="{ row }">
          <router-link :to="`/teacher/homeworks/${row.id}/grading`">
            <el-button link type="primary" size="small" :data-testid="`grade-link-${row.id}`">
              批改
            </el-button>
          </router-link>
          <el-button
            link
            type="success"
            size="small"
            :data-testid="`export-csv-${row.id}`"
            @click="exportCsv(row)"
          >
            导出
          </el-button>
          <el-button
            v-if="row.status === 'published'"
            link
            type="warning"
            size="small"
            :data-testid="`close-hw-${row.id}`"
            @click="closeHw(row)"
          >
            截止
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px"
      layout="prev, pager, next"
      :total="total"
      :page-size="20"
      v-model:current-page="page"
      @current-change="refresh"
    />

    <el-dialog v-model="create.visible" title="布置作业" width="520px">
      <el-form label-width="80px">
        <el-form-item label="班级">
          <el-select v-model="create.classId" style="width: 100%">
            <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="create.title" data-testid="form-title" maxlength="200" />
        </el-form-item>
        <el-form-item label="要求">
          <el-input
            v-model="create.content"
            type="textarea"
            :rows="4"
            data-testid="form-content"
            maxlength="10000"
          />
        </el-form-item>
        <el-form-item label="截止">
          <el-date-picker
            data-testid="form-due"
            type="datetime"
            :model-value="create.dueAt"
            @update:model-value="(v: unknown) => (create.dueAt = v instanceof Date ? v.toISOString() : '')"
          />
        </el-form-item>
        <el-form-item label="允许附件">
          <el-switch v-model="create.allowAttachment" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="create.visible = false">取消</el-button>
        <el-button type="primary" data-testid="form-submit" @click="submitCreate">发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
</style>
```

- [ ] **Step 3: 菜单与路由**

`web/src/layouts/menus.ts` teacherMenus 课堂管理 children（考勤之后）追加：

```ts
      { path: '/teacher/homeworks', label: '作业管理' },
```

`web/src/router/index.ts` teacher children 追加：

```ts
        {
          path: 'homeworks',
          name: 'teacher-homeworks',
          component: () => import('@/views/teacher/HomeworkList.vue'),
          meta: { title: '作业管理', roles: ['teacher', 'admin'] },
        },
```

- [ ] **Step 4: 组件测试通过**

Run: `cd web && npx vitest run src/views/__tests__/HomeworkList.spec.ts && npm run build`
Expected: 4 用例 PASS，build 成功。

- [ ] **Step 5: Commit**

```bash
git add web/src/views/teacher/HomeworkList.vue web/src/views/__tests__/HomeworkList.spec.ts web/src/layouts/menus.ts web/src/router/index.ts
git commit -m "feat(web): 教师作业管理页（列表/布置弹窗/截止/导出入口）与菜单路由"
```

---

### Task 9: 教师批改页（左提交列表 + 右正文/附件/评分点评）

**Files:**
- Create: `web/src/views/teacher/HomeworkGrading.vue`
- Create: `web/src/views/__tests__/HomeworkGrading.spec.ts`
- Modify: `web/src/router/index.ts`（teacher children 追加子路由，不进菜单）

**Interfaces:**
- Consumes: Task 4 `GET /homeworks/:id`（教师分支）返回 `{ homework: { id, title, content, dueAt, status }, studentCount, unsubmittedCount, submissions: [{ id, userId, realName, username, textContent, submittedAt, isLate, score, teacherComment, files: [{ id, originalName, sizeBytes, mimeType }] }] }`（与 Task 4 Interfaces 完全一致）；Task 7 `PATCH /homework/submissions/:id/grade`；Task 6 `GET /files/:id/download`（blob）。
- Produces: 路由 `/teacher/homeworks/:id/grading`。

- [ ] **Step 1: 写组件测试（先失败）**

`web/src/views/__tests__/HomeworkGrading.spec.ts`，同风格；额外 mock vue-router：

```ts
const routeMock = vi.hoisted(() => ({ params: { id: '7' } }))
vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({ push: vi.fn() }),
}))
```

payload：

```ts
const detailPayload = {
  homework: {
    id: 7,
    title: '第三课作业',
    content: '完成第三课录入练习并保存截图',
    dueAt: '2026-10-05T10:00:00.000Z',
    status: 'closed',
  },
  studentCount: 2,
  submissions: [
    {
      id: 21,
      userId: 9,
      realName: '张三',
      username: 's009',
      textContent: '第一版正文',
      submittedAt: '2026-10-05T09:00:00.000Z',
      isLate: false,
      score: '92.50',
      teacherComment: '很好',
      files: [{ id: 31, originalName: '截图.pdf', sizeBytes: 1024 }],
    },
    {
      id: 22,
      userId: 10,
      realName: '李四',
      username: 's010',
      textContent: '迟交正文',
      submittedAt: '2026-10-05T11:00:00.000Z',
      isLate: true,
      score: null,
      teacherComment: null,
      files: [],
    },
  ],
  mySubmission: null,
}
```

用例 3 条：

```
1. 挂载后 GET /homeworks/7；列表含 张三/李四，头部含 '第三课作业 · 2 人 · 已交 2 · 未交 0'
2. 点击 [data-testid="pick-22"]（迟交未批改）→ 右侧正文区显示所选提交；
   设分数（data-testid="grade-score" 的 find('input') setValue 88）、点评留空 →
   点击 [data-testid="grade-save"] → PATCH '/homework/submissions/22/grade' 第二参
   { score: 88, comment: undefined }；随后组件重新 GET detail
3. 点击 [data-testid="pick-21"] → 分数回显 92.5、点评回显 '很好'；
   附件区存在 [data-testid="file-dl-31"]
```

Run: `cd web && npx vitest run src/views/__tests__/HomeworkGrading.spec.ts` → FAIL。

- [ ] **Step 2: 写 HomeworkGrading.vue（完整代码）**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

interface FileItem {
  id: number
  originalName: string
  sizeBytes: number
}
interface Sub {
  id: number
  userId: number
  realName: string
  username: string
  textContent: string
  submittedAt: string
  isLate: boolean
  score: string | null
  teacherComment: string | null
  files: FileItem[]
}
interface Detail {
  homework: {
    id: number
    title: string
    content: string
    dueAt: string
    status: string
  }
  studentCount: number
  submissions: Sub[]
}

const route = useRoute()
const hwId = Number(route.params.id)

const detail = ref<Detail | null>(null)
const picked = ref<Sub | null>(null)
const score = ref<number | undefined>(undefined)
const comment = ref('')
const loading = ref(false)

const header = computed(() => {
  const d = detail.value
  if (!d) return ''
  const submitted = d.submissions.length
  return `${d.homework.title} · ${d.studentCount} 人 · 已交 ${submitted} · 未交 ${d.studentCount - submitted}`
})

async function load() {
  loading.value = true
  try {
    detail.value = await request.get<Detail>(`/homeworks/${hwId}`)
    if (picked.value) {
      const again = detail.value.submissions.find((s) => s.id === picked.value?.id)
      if (again) pick(again)
      else picked.value = null
    }
  } finally {
    loading.value = false
  }
}

function pick(s: Sub) {
  picked.value = s
  score.value = s.score != null ? Number(s.score) : undefined
  comment.value = s.teacherComment ?? ''
}

async function save() {
  if (!picked.value || score.value == null) {
    ElMessage.warning('请先选择提交并填写分数')
    return
  }
  await request.patch(`/homework/submissions/${picked.value.id}/grade`, {
    score: score.value,
    comment: comment.value || undefined,
  })
  ElMessage.success('已保存批改')
  await load()
}

async function downloadFile(f: FileItem) {
  const blob = await request.get<Blob>(`/files/${f.id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = f.originalName
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <h3>{{ header }}</h3>
    <div class="layout">
      <div class="list" data-testid="submission-list">
        <div
          v-for="s in detail?.submissions"
          :key="s.id"
          class="item"
          :class="{ active: picked?.id === s.id }"
          @click="pick(s)"
        >
          <span :data-testid="`pick-${s.id}`">{{ s.realName }}</span>
          <el-tag :type="s.isLate ? 'warning' : 'success'" size="small">
            {{ s.isLate ? '迟交' : '按时' }}
          </el-tag>
          <el-tag v-if="s.score != null" type="success" size="small">{{ s.score }}分</el-tag>
          <el-tag v-else size="small">未批</el-tag>
        </div>
        <el-empty v-if="detail && !detail.submissions.length" description="暂无提交" />
      </div>

      <div class="panel" data-testid="grade-panel">
        <template v-if="picked">
          <h4>
            {{ picked.realName }}（{{ picked.username }}）· 提交于
            {{ new Date(picked.submittedAt).toLocaleString('zh-CN', { hour12: false }) }}
          </h4>
          <pre class="body">{{ picked.textContent ?? '' }}</pre>
          <div v-if="picked.files.length" class="files">
            附件：
            <el-button
              v-for="f in picked.files"
              :key="f.id"
              link
              type="primary"
              size="small"
              :data-testid="`file-dl-${f.id}`"
              @click="downloadFile(f)"
            >
              {{ f.originalName }}（{{ Math.round(f.sizeBytes / 1024) }}KB）
            </el-button>
          </div>
          <el-form label-width="60px" style="margin-top: 16px">
            <el-form-item label="分数">
              <el-input-number v-model="score" :min="0" :max="100" data-testid="grade-score" />
            </el-form-item>
            <el-form-item label="点评">
              <el-input
                v-model="comment"
                type="textarea"
                :rows="3"
                maxlength="500"
                placeholder="点评（可空；留空保存将清空原点评）"
                data-testid="grade-comment"
              />
            </el-form-item>
            <el-button type="primary" data-testid="grade-save" @click="save">保存批改</el-button>
          </el-form>
        </template>
        <el-empty v-else description="选择左侧提交进行批改" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 16px;
}
.list {
  width: 260px;
  border-right: 1px solid #ebeef5;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
.item.active {
  background: #ecf5ff;
}
.panel {
  flex: 1;
}
.body {
  white-space: pre-wrap;
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
}
</style>
```

说明：Task 4 的 detail 教师分支 submissions 已含 `textContent`（见 Task 4 Interfaces），本组件 `Sub` 接口需补 `textContent: string` 字段（上方接口定义已包含则无需改动）。

- [ ] **Step 3: 路由**

`web/src/router/index.ts` teacher children 追加（不进菜单）：

```ts
        {
          path: 'homeworks/:id/grading',
          name: 'teacher-homework-grading',
          component: () => import('@/views/teacher/HomeworkGrading.vue'),
          meta: { title: '作业批改', roles: ['teacher', 'admin'] },
        },
```

- [ ] **Step 4: 测试通过**

Run: `cd web && npx vitest run src/views/__tests__/HomeworkGrading.spec.ts && npm run build`
Expected: 3 用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/views/teacher/HomeworkGrading.vue web/src/views/__tests__/HomeworkGrading.spec.ts web/src/router/index.ts
git commit -m "feat(web): 教师作业批改页（提交列表/正文附件/评分点评）"
```

---

### Task 10: 学生端（我的作业列表 + 提交页）与菜单路由

**Files:**
- Create: `web/src/views/student/MyHomework.vue`
- Create: `web/src/views/student/HomeworkSubmit.vue`
- Create: `web/src/views/__tests__/MyHomework.spec.ts`
- Create: `web/src/views/__tests__/HomeworkSubmit.spec.ts`
- Modify: `web/src/layouts/menus.ts`（studentMenus 追加）
- Modify: `web/src/router/index.ts`（student children 追加两条）

**Interfaces:**
- Consumes: Task 4 学生列表行（作业字段 + `klass:{name}` + `mySubmission | null`）、Task 4 detail 学生分支 `{ homework, mySubmission | null }`、Task 5 `POST /homeworks/:id/submissions`（multipart：字段 `textContent` + 文件字段 `files`）。
- Produces: 路由 `/student/homework`、`/student/homework/:id`。

- [ ] **Step 1: 写两个组件测试（先失败）**

`MyHomework.spec.ts`（同风格，mock `@/utils/request` 与 vue-router 的 useRouter）数据（Task 4 学生行形状）：

```
1. GET /homeworks（学生身份由后端按 token 判定，前端同一路径）返回 3 行：
   - 进行中（mySubmission null，dueAt 未来）→ 卡片文本含 '进行中' 与 '剩余'
   - 已提交待批改（mySubmission 存在，score null）→ 含 '已提交·待批改'
   - 已批改（mySubmission.score '92.50'，teacherComment '很好'）→ 含 '92.5' 与 '很好'
   - 已截止未交（status closed，mySubmission null）→ 含 '已截止·未提交'（danger tag）
   （4 行数据一次断言，test 名可为 '渲染四种状态'）
2. 点击卡片 → router.push('/student/homework/{id}')（useRouter mock 断言 push 参数）
```

`HomeworkSubmit.spec.ts` 数据（detail 学生分支形状）：

```
1. allowAttachment=false 的 detail → [data-testid="file-input"] 不存在；
   pre 区含要求原文；mySubmission null → 无 '最近提交' 区块
2. allowAttachment=true → file-input 存在且 multiple
3. 文本提交：setValue content-input '我的答案' → 点击 [data-testid="send-submit"]；
   断言 mocks.post 第一参 '/homeworks/7/submissions'，第二参为 FormData 且
   fd.get('textContent') === '我的答案'
4. mySubmission 存在 → 页面含 '截止前可重交，以最后一次为准'
```

Run → FAIL。

- [ ] **Step 2: 写 MyHomework.vue（完整代码）**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'

interface MySub {
  id: number
  submittedAt: string
  isLate: boolean
  score: string | null
  teacherComment: string | null
}
interface Row {
  id: number
  title: string
  content: string
  dueAt: string
  status: 'published' | 'closed'
  allowAttachment: boolean
  klass: { name: string }
  mySubmission: MySub | null
}

const router = useRouter()
const rows = ref<Row[]>([])
const loading = ref(false)

type State = { text: string; type: 'success' | 'warning' | 'info' | 'danger' | 'primary' }
function stateOf(r: Row): State {
  const now = Date.now()
  if (r.mySubmission && r.mySubmission.score != null) return { text: '已批改', type: 'primary' }
  if (r.mySubmission) return { text: '已提交·待批改', type: 'success' }
  if (r.status === 'published' && now <= new Date(r.dueAt).getTime()) {
    return { text: '进行中', type: 'warning' }
  }
  return { text: '已截止·未提交', type: 'danger' }
}

function remain(r: Row): string {
  const ms = new Date(r.dueAt).getTime() - Date.now()
  if (ms <= 0) return ''
  const h = Math.floor(ms / 3_600_000)
  const d = Math.ceil(ms / 86_400_000)
  return d >= 1 ? `剩余 ${d} 天` : `剩余 ${h} 小时`
}

async function load() {
  loading.value = true
  try {
    const data = await request.get<{ list: Row[] }>('/homeworks', {
      params: { page: 1, pageSize: 50 },
    })
    rows.value = data.list
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <h3>我的作业</h3>
    <div class="cards">
      <el-card
        v-for="r in rows"
        :key="r.id"
        class="card"
        shadow="hover"
        :data-testid="`hw-card-${r.id}`"
        @click="router.push(`/student/homework/${r.id}`)"
      >
        <div class="row1">
          <strong>{{ r.title }}</strong>
          <el-tag :type="stateOf(r).type" size="small">{{ stateOf(r).text }}</el-tag>
        </div>
        <div class="row2">{{ r.klass.name }} · 截止 {{ new Date(r.dueAt).toLocaleString('zh-CN', { hour12: false }) }}</div>
        <div v-if="stateOf(r).text === '进行中'" class="remain">{{ remain(r) }}</div>
        <div v-if="r.mySubmission && r.mySubmission.score != null" class="grade">
          得分 {{ Number(r.mySubmission.score) }}
          <span v-if="r.mySubmission.teacherComment" class="cmt">{{ r.mySubmission.teacherComment }}</span>
        </div>
      </el-card>
    </div>
    <el-empty v-if="!loading && !rows.length" description="暂无作业" />
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.row1 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.row2 {
  color: #909399;
  font-size: 13px;
}
.remain {
  color: #e6a23c;
  font-size: 13px;
  margin-top: 6px;
}
.grade {
  margin-top: 6px;
  font-weight: 600;
}
.cmt {
  font-weight: 400;
  color: #606266;
  margin-left: 8px;
}
.card {
  cursor: pointer;
}
</style>
```

- [ ] **Step 3: 写 HomeworkSubmit.vue（完整代码）**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

interface MySub {
  id: number
  textContent: string
  submittedAt: string
  isLate: boolean
  score: string | null
  teacherComment: string | null
  files: { id: number; originalName: string; sizeBytes: number }[]
}
interface Detail {
  homework: {
    id: number
    title: string
    content: string
    dueAt: string
    status: 'published' | 'closed'
    allowAttachment: boolean
  }
  mySubmission: MySub | null
}

const route = useRoute()
const router = useRouter()
const hwId = Number(route.params.id)

const detail = ref<Detail | null>(null)
const text = ref('')
const files = ref<File[]>([])
const sending = ref(false)

const pastDue = computed(() => (detail.value ? Date.now() > new Date(detail.value.homework.dueAt).getTime() : false))

async function load() {
  detail.value = await request.get<Detail>(`/homeworks/${hwId}`)
  if (detail.value.mySubmission) {
    text.value = detail.value.mySubmission.textContent ?? text.value
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  files.value = Array.from(input.files ?? [])
}

async function send() {
  if (!text.value.trim()) {
    ElMessage.warning('请填写作业内容')
    return
  }
  sending.value = true
  try {
    const fd = new FormData()
    fd.append('textContent', text.value)
    for (const f of files.value) fd.append('files', f)
    await request.post(`/homeworks/${hwId}/submissions`, fd)
    ElMessage.success('已提交')
    files.value = []
    await load()
  } finally {
    sending.value = false
  }
}

async function downloadFile(id: number, name: string) {
  const blob = await request.get<Blob>(`/files/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<template>
  <div v-if="detail">
    <h3>
      {{ detail.homework.title }}
      <el-tag v-if="pastDue" type="danger" size="small">已截止，补交计为迟交</el-tag>
    </h3>
    <pre class="requirement">{{ detail.homework.content }}</pre>

    <div v-if="detail.mySubmission" class="last" data-testid="last-submission">
      <p>
        最近提交：{{ new Date(detail.mySubmission.submittedAt).toLocaleString('zh-CN', { hour12: false }) }}
        · {{ detail.mySubmission.isLate ? '迟交' : '按时' }}
        <template v-if="detail.mySubmission.score != null">
          · 得分 {{ Number(detail.mySubmission.score) }}（{{ detail.mySubmission.teacherComment }}）
        </template>
      </p>
      <p v-if="!pastDue" class="hint">截止前可重交，以最后一次为准</p>
      <div v-if="detail.mySubmission.files.length">
        <el-button
          v-for="f in detail.mySubmission.files"
          :key="f.id"
          link
          type="primary"
          size="small"
          @click="downloadFile(f.id, f.originalName)"
        >
          {{ f.originalName }}
        </el-button>
      </div>
    </div>

    <el-input v-model="text" type="textarea" :rows="8" maxlength="50000" data-testid="content-input" placeholder="作业内容…" />
    <div v-if="detail.homework.allowAttachment" class="attach">
      <input type="file" multiple data-testid="file-input" @change="onFileChange" />
      <span class="hint">单文件 ≤10MB，最多 3 个（jpg/png/pdf/doc/docx/zip）</span>
    </div>
    <div class="actions">
      <el-button @click="router.push('/student/homework')">返回</el-button>
      <el-button type="primary" :loading="sending" data-testid="send-submit" @click="send">
        {{ detail.mySubmission ? '重新提交' : '提交作业' }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.requirement {
  white-space: pre-wrap;
  background: #f5f7fa;
  padding: 12px;
  border-radius: 4px;
  margin-bottom: 16px;
}
.attach {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.hint {
  color: #909399;
  font-size: 13px;
}
.actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
}
.last {
  margin-bottom: 12px;
}
</style>
```

- [ ] **Step 4: 菜单与路由**

`web/src/layouts/menus.ts` studentMenus 追加（班级公告属 P3，不在此处）：

```ts
    { path: '/student/homework', label: '我的作业' },
```

`web/src/router/index.ts` student children 追加：

```ts
        {
          path: 'homework',
          name: 'student-homework',
          component: () => import('@/views/student/MyHomework.vue'),
          meta: { title: '我的作业', roles: ['student'] },
        },
        {
          path: 'homework/:id',
          name: 'student-homework-submit',
          component: () => import('@/views/student/HomeworkSubmit.vue'),
          meta: { title: '作业提交', roles: ['student'] },
        },
```

- [ ] **Step 5: 测试通过**

Run: `cd web && npx vitest run src/views/__tests__/MyHomework.spec.ts src/views/__tests__/HomeworkSubmit.spec.ts && npm run build`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add web/src/views/student/MyHomework.vue web/src/views/student/HomeworkSubmit.vue web/src/views/__tests__/MyHomework.spec.ts web/src/views/__tests__/HomeworkSubmit.spec.ts web/src/layouts/menus.ts web/src/router/index.ts
git commit -m "feat(web): 学生我的作业与提交页（状态卡片/附件上传/重交提示）"
```

---

### Task 11: 全量回归、部署备忘与备份脚本扩展

**Files:**
- Modify: `deploy/backup.sh`（追加 uploads 打包）
- Modify: `deploy/README.md`（新增 P2 上线步骤章节）

**Interfaces:**
- Consumes: Task 1–10 全部产物。
- Produces: 可执行的上线/回滚步骤；备份覆盖 uploads。

- [ ] **Step 1: 后端全量回归**

```bash
cd server && npm run lint && npx vitest run && npx vitest run --config vitest.config.e2e.ts test/sessions.e2e-spec.ts test/attendance.e2e-spec.ts test/homework.e2e-spec.ts test/homework-upload.e2e-spec.ts test/homework-grades.e2e-spec.ts && npm run build
```
Expected: lint 0 错误、单测全 PASS、e2e 全 PASS、build 成功。

- [ ] **Step 2: 前端全量回归**

```bash
cd web && npx vitest run && npm run build
```
Expected: 全 PASS。

- [ ] **Step 3: backup.sh 追加 uploads 打包（在现有 mysqldump 段之后）**

```bash
# --- uploads（作业附件）备份 ---
UPLOADS_DIR="${UPLOADS_DIR:-/var/www/typing/uploads}"
if [ -d "$UPLOADS_DIR" ]; then
  tar -czf "$BACKUP_DIR/uploads-$(date +%F).tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +7 -delete
fi
```

- [ ] **Step 4: deploy/README.md 追加「## 课堂管理 P2（作业）上线步骤」**

内容要点（沿用 §3 离线整包流程，P2 零数据库迁移——7 张课堂表 P1 迁移已建）：
1. 本机：`cd server && npm i @nestjs/schedule && npm run build`；`server/dist` + `node_modules` 整包上传（同 P1 备忘的 tar 流程）。
2. 服务器 `.env` 追加 `UPLOAD_DIR=/var/www/typing/uploads`；`mkdir -p /var/www/typing/uploads && chown -R <pm2运行用户> /var/www/typing/uploads`。
3. `web/dist` 整包上传替换。
4. `pm2 restart typing-api`（ScheduleModule 随启动生效，无需额外进程）。
5. 验收：教师布置（含附件开关）→ 学生附件提交 → 截止前重交覆盖（旧文件消失）→ 教师批改 → CSV 导出（BOM 打开无乱码）→ 到点 cron 自动截止且按时学生 +2 积分（积分流水 source=auto_homework）。
6. 回滚：还原旧 `dist`（homework 三表旧代码不读取，可保留）；`uploads/` 目录可保留不清理。

- [ ] **Step 5: Commit**

```bash
git add deploy/backup.sh deploy/README.md
git commit -m "docs(deploy): P2作业上线步骤与uploads备份"
```

---

## Self-Review 记录（制定者自检）

- 规格覆盖：§5.2 提交流程→T5/T6；§5.5 cron+4h提醒→T3/T1；§6 8个作业端点→T2(POST/PATCH)/T4(GET×2)/T5(POST submissions)/T6(GET download)/T7(PATCH grade+GET grades)=9 个（超出规格的 submissions 列表并入 detail，无独立端点）；§7.2→T8/T9；§7.3→T10；§8 限制→Global Constraints+T5；§9 验收项→各任务 e2e/组件测试；§10 P2 范围→T1–T11。无缺口。
- 占位符扫描：全部代码步骤含完整代码；"复用脚手架"均点名了源文件与差异行；无 TBD/TODO。
- 类型一致性：`MulterFileInfo`（T5 定义，T5 controller 使用）；list/detail 行形状（T4 定义，T8/T9/T10 消费）字段名一致（submissionCount/studentCount/gradedCount、mySubmission、textContent）；`settle()`（T2 定义）与 scheduler（T3 调用 `settle:hwId` 顺序断言）一致；`uploadRoot()`（T5）与 T6 下载、T5 e2e、T11 UPLOAD_DIR 一致。
