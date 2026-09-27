# 在线打字练习系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建校内 BS 架构在线打字练习网站（中英文打字、教师发布任务、实时看板、成绩统计导出）。

**Architecture:** 单仓库 monorepo（`server/` NestJS 单体 + `web/` Vue 3 SPA），MySQL 8.0 六表，JWT 无状态认证；实时方案为「学生端 20s 心跳 UPSERT + 教师端 30s 轮询」，无 WebSocket。部署：Nginx 托管 dist + 反代 /api，PM2 守护。

**Tech Stack:** Vue 3 + Vite + TypeScript + Vue Router + Pinia + Element Plus + axios + Vitest；NestJS + Prisma + MySQL8 + Jest；Nginx + PM2。

**Spec:** `docs/superpowers/specs/2026-09-26-online-typing-system-design.md`（本计划的唯一需求依据，执行者两份都要读）

## Global Constraints

- Node ≥ 20，包管理器 npm；仓库根 = `/Users/Admin/Documents/trae_projects/mobile_project`
- monorepo 目录：`server/`（NestJS）、`web/`（Vue3）；数据库 `typing_system`，utf8mb4
- API 基础前缀 `/api`；统一响应 `{ code, message, data }`，`code = 0` 成功；非 0 由异常过滤器转换
- 错误语义：401 未认证 / 403 越权或归属不符 / 409 冲突（用户名重复、班级非空等）
- JWT 有效期 7 天，密钥来自 `.env` 的 `JWT_SECRET`；密码一律 bcrypt（10 轮）
- 分页统一 `?page=1&pageSize=20`，返回 `{ list, total }`
- 心跳间隔 20s；离线判定 = `updated_at` 距今 > 60s；教师看板轮询 30s；学生本地界面刷新 500ms
- 达标判定：`is_passed = (speed ≥ min_speed) && (accuracy ≥ min_accuracy)`；速度 > 600 字/分 → `is_suspicious = 1`
- 中文统计：仅 `compositionend` 上屏的字符计入（拼音字母不污染统计）
- 下架 = `text.status = 'offline'` 软删除；被任务引用的文章不可物理 DELETE
- 有关联班级/学生的教师只能停用不能物理删除
- 所有界面文案、注释用中文；提交信息用 conventional commits（feat/fix/chore）
- 每个任务完成必须跑通该任务测试并提交一次

---

## Phase 0 · 基础设施（Task 1–5）

### Task 1: 仓库初始化与后端脚手架

**Files:**
- Create: `server/`（NestJS 脚手架）、`.gitignore`、`server/.env`、`server/.env.example`
- Create: `server/src/common/interceptors/transform.interceptor.ts`、`server/src/common/filters/http-exception.filter.ts`
- Modify: `server/src/app.controller.ts`（health 端点）、`server/src/main.ts`（全局前缀 /api）

**Interfaces:**
- Produces: 统一响应格式；`GET /api/health` 返回 `{ code: 0, message: 'ok', data: { status: 'up' } }`；PrismaClient 全局可用（`PrismaService`）

- [ ] **Step 1: 初始化仓库与后端项目**

```bash
cd /Users/Admin/Documents/trae_projects/mobile_project
git init
mkdir -p docs/superpowers/plans   # 已有则跳过
npx @nestjs/cli new server --package-manager npm --strict
```

`.gitignore` 追加：`node_modules/`、`dist/`、`server/.env`、`web/dist/`、`*.log`

- [ ] **Step 2: 接入 Prisma + MySQL**

```bash
cd server && npm i prisma @prisma/client && npx prisma init
```

`server/.env`：

```
DATABASE_URL="mysql://root:你的密码@localhost:3306/typing_system"
JWT_SECRET="change-me-in-production"
JWT_EXPIRES_IN="7d"
```

先在 MySQL 执行：`CREATE DATABASE typing_system DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`

- [ ] **Step 3: 写失败测试（health + 统一响应）**

`server/test/app.e2e-spec.ts` 替换为：

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('健康检查 (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('GET /api/health 返回统一响应格式', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ code: 0, message: 'ok', data: { status: 'up' } });
  });
});
```

- [ ] **Step 4: 运行确认失败**

Run: `cd server && npx jest test/app.e2e-spec.ts`
Expected: FAIL（响应体不是统一格式或端点不存在）

- [ ] **Step 5: 实现统一响应拦截器、异常过滤器、全局前缀**

`server/src/common/interceptors/transform.interceptor.ts`：

```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => ({ code: 0, message: 'ok', data: data ?? null })));
  }
}
```

`server/src/common/filters/http-exception.filter.ts`：

```typescript
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      return res.status(status).json({
        code: status,
        message: typeof body === 'string' ? body : body.message ?? '请求失败',
        data: null,
      });
    }
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 500, message: '服务器内部错误', data: null });
  }
}
```

`server/src/main.ts`：`app.setGlobalPrefix('api')`、注册全局 Pipe（`ValidationPipe({ whitelist: true })`）与上述 Filter/Interceptor；`app.controller.ts` 的 health 返回 `{ status: 'up' }`。

- [ ] **Step 6: 运行测试通过并提交**

Run: `cd server && npx jest test/app.e2e-spec.ts` → PASS

```bash
git add . && git commit -m "chore: NestJS 脚手架 + Prisma + 统一响应格式"
```

---

### Task 2: Prisma schema（6 表）+ 迁移 + 种子数据

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/seed.ts`、`server/prisma/articles/*.txt`（内置文章源文本，5 篇中文 + 3 篇英文）

**Interfaces:**
- Produces: 6 个模型 `User / Class / Text / Task / Record / Heartbeat`（与设计文档 4.1–4.6 完全一致）；seed 产出超管 `admin / admin123 / must_change_password=1` + 内置文章（created_by=null, status=published）

- [ ] **Step 1: 编写 schema.prisma（完整）**

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "mysql"; url = env("DATABASE_URL") }

enum Role { admin teacher student }
enum AccountStatus { active disabled }
enum TextLanguage { zh en }
enum TextStatus { published offline }
enum TaskMode { article time }
enum TaskStatus { published closed }
enum HeartbeatStatus { typing paused finished }

model User {
  id                  Int           @id @default(autoincrement())
  username            String        @unique @db.VarChar(50)
  passwordHash        String        @map("password_hash") @db.VarChar(100)
  realName            String        @map("real_name") @db.VarChar(50)
  role                Role
  classId             Int?          @map("class_id")
  status              AccountStatus @default(active)
  mustChangePassword  Boolean       @default(true) @map("must_change_password")
  createdBy           Int?          @map("created_by")
  lastLoginAt         DateTime?     @map("last_login_at")
  createdAt           DateTime      @default(now()) @map("created_at")
  class    Class?    @relation(fields: [classId], references: [id])
  records  Record[]
  heartbeat Heartbeat?
  @@map("users")
}

model Class {
  id        Int      @id @default(autoincrement())
  name      String   @db.VarChar(100)
  teacherId Int      @map("teacher_id")
  createdAt DateTime @default(now()) @map("created_at")
  teacher   User     @relation("ClassTeacher", fields: [teacherId], references: [id])
  students  User[]
  tasks     Task[]
  @@map("class")
}

model Text {
  id         Int         @id @default(autoincrement())
  title      String      @db.VarChar(200)
  language   TextLanguage
  difficulty Int
  content    String      @db.Text
  charCount  Int         @map("char_count")
  createdBy  Int?        @map("created_by")
  status     TextStatus  @default(published)
  createdAt  DateTime    @default(now()) @map("created_at")
  tasks      Task[]
  @@map("text")
}

model Task {
  id              Int        @id @default(autoincrement())
  classId         Int        @map("class_id")
  textId          Int        @map("text_id")
  title           String     @db.VarChar(200)
  mode            TaskMode
  durationSeconds Int?       @map("duration_seconds")
  minSpeed        Int        @map("min_speed")
  minAccuracy     Int        @map("min_accuracy")
  deadline        DateTime
  status          TaskStatus @default(published)
  createdBy       Int        @map("created_by")
  createdAt       DateTime   @default(now()) @map("created_at")
  klass  Class  @relation(fields: [classId], references: [id])
  text   Text   @relation(fields: [textId], references: [id])
  records Record[]
  @@map("task")
}

model Record {
  id              Int       @id @default(autoincrement())
  userId          Int       @map("user_id")
  taskId          Int?      @map("task_id")
  mode            TaskMode
  speed           Decimal   @db.Decimal(6, 2)
  accuracy        Decimal   @db.Decimal(5, 2)
  totalChars      Int       @map("total_chars")
  correctChars    Int       @map("correct_chars")
  backspaceCount  Int       @map("backspace_count")
  durationSeconds Int       @map("duration_seconds")
  isPassed        Boolean?  @map("is_passed")
  isSuspicious    Boolean   @default(false) @map("is_suspicious")
  createdAt       DateTime  @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id])
  task Task? @relation(fields: [taskId], references: [id])
  @@map("record")
}

model Heartbeat {
  userId         Int             @id @map("user_id")
  taskId         Int?            @map("task_id")
  status         HeartbeatStatus
  speed          Decimal         @db.Decimal(6, 2)
  accuracy       Decimal         @db.Decimal(5, 2)
  progress       Decimal         @db.Decimal(5, 2)
  elapsedSeconds Int             @map("elapsed_seconds")
  charIndex      Int             @map("char_index")
  updatedAt      DateTime        @updatedAt @map("updated_at")
  user User @relation(fields: [userId], references: [id])
  @@map("heartbeat")
}
```

- [ ] **Step 2: 编写 seed.ts**

要点：`bcrypt.hash('admin123', 10)` 生成超管；内置文章数组（中英各≥3篇，含 title/language/difficulty/content），`charCount` 用 `[...content].length` 计算（中文按码点）；`prisma seed` 配置写入 `package.json`（`"prisma": { "seed": "ts-node prisma/seed.ts" }`）。

- [ ] **Step 3: 迁移 + 种子 + 验证**

```bash
cd server && npx prisma migrate dev --name init && npx prisma db seed
npx prisma studio   # 人工抽查 users 有 admin、text 表 ≥6 行
```

- [ ] **Step 4: 提交**

```bash
git add server/prisma && git commit -m "feat: 数据库 schema 六表 + 迁移 + 种子(超管+内置文章)"
```

---

### Task 3: 认证模块（login / change-password / JWT / 角色 Guard）

**Files:**
- Create: `server/src/auth/`（auth.module.ts、auth.service.ts、auth.controller.ts、dto/login.dto.ts、dto/change-password.dto.ts、strategies/jwt.strategy.ts、guards/jwt-auth.guard.ts、guards/roles.guard.ts、decorators/roles.decorator.ts、decorators/current-user.decorator.ts）
- Modify: `server/src/app.module.ts`（AuthModule + JwtModule + PassportModule）

**Interfaces:**
- Produces:
  - `POST /api/auth/login` body `{ username, password }` → data `{ token, user: { id, username, realName, role, classId, mustChangePassword } }`；密码错/停用均返回 401（message 区分「账号或密码错误」「账号已停用」）
  - `POST /api/auth/change-password` body `{ oldPassword, newPassword }` → 成功后清除 mustChangePassword
  - `@Roles('admin','teacher','student')` 装饰器 + `RolesGuard`；`@CurrentUser()` 注入 JWT payload `{ id, role }`
  - JWT payload: `{ sub: user.id, role: string }`

- [ ] **Step 1: 写失败测试** `server/test/auth.e2e-spec.ts`

用例（全部实际编写）：
1. `admin/admin123` 登录成功，断言 `data.token` 存在、`data.user.role === 'admin'`、`mustChangePassword === true`
2. 密码错误 → 401，`message === '账号或密码错误'`
3. 停用账号（seed 临时建一个 disabled 用户）→ 401「账号已停用」
4. 不带 token 访问 `GET /api/stats/admin-overview` → 401
5. 学生 token 访问 admin-only 端点 → 403
6. `change-password`：旧密码错 → 400；成功后再用旧密码登录 → 401，新密码登录 → 200，且 `mustChangePassword === false`

- [ ] **Step 2: 运行确认失败** → `npx jest test/auth.e2e-spec.ts` FAIL（404）

- [ ] **Step 3: 实现**

关键点（auth.service.ts）：

```typescript
async login(dto: LoginDto) {
  const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
  if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
    throw new UnauthorizedException('账号或密码错误');
  }
  if (user.status === 'disabled') throw new UnauthorizedException('账号已停用');
  await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return {
    token: this.jwt.sign({ sub: user.id, role: user.role }),
    user: { id: user.id, username: user.username, realName: user.realName, role: user.role, classId: user.classId, mustChangePassword: user.mustChangePassword },
  };
}
```

`JwtStrategy` 校验用户存在且 active；`RolesGuard` 读 `@Roles()` 元数据与 `req.user.role` 比对，不匹配抛 `ForbiddenException`。

- [ ] **Step 4: 测试通过** → `npx jest test/auth.e2e-spec.ts` PASS

- [ ] **Step 5: 提交** `git commit -m "feat: 认证模块(JWT/角色守卫/强制改密标记)"`

---

### Task 4: 前端脚手架（web/）+ axios 封装 + 三端布局壳

**Files:**
- Create: `web/`（Vite 脚手架）、`web/src/utils/request.ts`、`web/src/stores/auth.ts`、`web/src/router/index.ts`、`web/src/layouts/StudentLayout.vue / TeacherLayout.vue / AdminLayout.vue`、`web/src/views/Placeholder.vue`

**Interfaces:**
- Produces:
  - `request.ts`: axios 实例，baseURL `/api`，请求拦截带 `Authorization: Bearer token`；响应拦截解包 `{ code, message, data }`——`code !== 0` 时 `ElMessage.error(message)` 并 reject；HTTP 401 清 token 跳 `/login`
  - `stores/auth`: `{ token, user, login(), logout() }`，token/user 持久化 localStorage
  - 路由：`/login`、`/change-password`、`/student/*`、`/teacher/*`、`/admin/*`，meta.roles 数组

- [ ] **Step 1: 脚手架命令**

```bash
npm create vite@latest web -- --template vue-ts
cd web && npm i && npm i element-plus axios pinia vue-router && npm i -D vitest @vue/test-utils jsdom
```

`vite.config.ts` 加代理：`server.proxy['/api'] = 'http://localhost:3000'`；`vitest` 配置 `environment: 'jsdom'`。

- [ ] **Step 2: 实现 request.ts / auth store / 路由 / 三个布局壳**

布局壳 = 侧边栏（按角色固定菜单项，路由留占位）+ 顶栏（姓名 + 退出）。菜单项即第 7 节页面清单，全部指向 Placeholder。

- [ ] **Step 3: 冒烟测试** `web/src/router/__tests__/guard.spec.ts`：未登录访问 `/teacher/dashboard` 被重定向 `/login`（实际编写 router 导航测试）

- [ ] **Step 4: `npx vitest run` PASS 后提交** `git commit -m "chore: Vue3 脚手架 + axios 统一封装 + 三端布局壳"`

---

### Task 5: 登录页 + 修改密码页 + 守卫完善

**Files:**
- Create: `web/src/views/Login.vue`、`web/src/views/ChangePassword.vue`
- Modify: `web/src/router/index.ts`（全局守卫：无 token → /login；`mustChangePassword && 目标非改密页` → /change-password；meta.roles 不含当前角色 → 跳对应首页）

**Interfaces:**
- Consumes: `POST /auth/login`、`POST /auth/change-password`、Task 4 的 store/request

- [ ] **Step 1: 组件测试先行**（`Login.spec.ts`）：填错表单不提交；提交成功后按 role 断言 `router.push` 的目标（admin → `/admin/overview`，teacher → `/teacher/dashboard`，student → `/student/tasks`）

- [ ] **Step 2: 实现**——Element Plus 表单校验；登录成功写 store；改密页提交成功后 `store.user.mustChangePassword = false` 并跳对应首页

- [ ] **Step 3: 手动验证**：起 `npm run dev` + 后端，admin/admin123 登录 → 被强制改密 → 改完进入概览页

- [ ] **Step 4: 提交** `git commit -m "feat: 登录/强制改密/路由守卫"`

---

## Phase 1 · 账号与组织（Task 6–8）

> 【P0 审查遗留】mustChangePassword 目前仅前端路由守卫强制；服务端 `JwtStrategy.validate()` 已透传 `mustChangePassword` 字段，本阶段实现业务接口时需在受保护业务接口统一拦截"未完成强制改密的请求"（仅放行改密接口）。

### Task 6: users 模块（教师管理 / 学生批量生成 / 统一 PATCH）

**Files:**
- Create: `server/src/users/`（module/controller/service、dto/create-teacher.dto.ts、dto/batch-students.dto.ts、dto/patch-user.dto.ts）
- Modify: `app.module.ts`

**Interfaces:**
- Produces:
  - `GET /api/users/teachers?page=&pageSize=&keyword=` → `{ list, total }`（含班级数）
  - `POST /api/users/teachers` body `{ realName, username? }` → data `{ user, initialPassword }`（username 空则自动衔接 t001/t002…；initialPassword 8位随机含大小写数字符号，bcrypt 后落库，明文仅此一次返回）
  - `GET /api/users/students?classId=` → 教师 403 限定本班；admin 可传任意 classId
  - `POST /api/users/students/batch` body `{ classId, names: string[] }` → data `{ created: [{ username, realName, initialPassword }], usernameStart }`
  - `PATCH /api/users/:id` body `{ action: 'reset-password'|'disable'|'enable'|'delete', initialPassword? }`；delete 有 class/students 关联（教师）→ 409「请先处理其班级与学生」

- [ ] **Step 1: 失败测试**（`test/users.e2e-spec.ts`，admin token 为例）：
  1. POST teachers → `initialPassword` 长度 8；连续创建 username 为 t001、t002
  2. 手动指定已存在 username → 409
  3. batch 3 个学生 → created 长度 3、classId 正确、每行密码独立
  4. 教师查 students 携带他人 classId → 403
  5. PATCH disable 后该用户登录 → 401
  6. delete 有关联班级的教师 → 409；无关联 → 200 且记录消失

- [ ] **Step 2: 实现**——密码生成器 `generatePassword()`（crypto 随机，保证四类字符至少一）；批量生成用 `prisma.$transaction`；删除教师前 count class(teacherId) 与 student(classId in 其班级) 判 409

- [ ] **Step 3: 测试通过** → `npx jest test/users.e2e-spec.ts`

- [ ] **Step 4: 提交** `git commit -m "feat: users模块(教师管理/学生批量生成/账号操作)"`

---

### Task 7: classes 模块

**Files:** `server/src/classes/`（module/controller/service、dto/create-class.dto.ts）

**Interfaces:**
- Produces: `GET /api/classes`（教师=自己的班级，含 studentCount）；`POST /api/classes { name }`；`PATCH /api/classes/:id`；`DELETE /api/classes/:id`（非空 → 409「班级内尚有学生」；含任务 → 409）

- [ ] **Step 1: 失败测试**（教师 token）：创建→列表含 studentCount=0；重命名；班内加 1 学生后删除 → 409；教师 A 删教师 B 的班级 → 403
- [ ] **Step 2: 实现**（service 层归属校验：`klass.teacherId !== currentUser.id → 403`）
- [ ] **Step 3: 测试通过** → **Step 4: 提交** `git commit -m "feat: 班级模块(CRUD+空班级删除保护)"`

---

### Task 8: texts 模块

**Files:** `server/src/texts/`（module/controller/service、dto/create-text.dto.ts）

**Interfaces:**
- Produces:
  - `GET /api/texts?language=&status=&source=&page=`：教师/学生 → 内置(published) + 自建(published)；admin → 全部（含 offline 与他人自建，`source=builtin|custom` 筛选）
  - `GET /api/texts/:id`：练习加载全文
  - `POST /api/texts { title, language, difficulty, content }`：charCount 服务端 `[...content].length` 计算
  - `PATCH /api/texts/:id`：作者本人或 admin
  - `DELETE /api/texts/:id`：被任务引用 → 409「该文章已被任务使用，请使用下架」
  - `PATCH /api/texts/:id/status { status: 'offline'|'published' }`：仅 admin

- [ ] **Step 1: 失败测试**：教师建文章 charCount 正确（含 emoji/全角）；教师列表不含他人自建、admin 含；下架后教师 GET 详情 → 403；被任务引用删除 → 409；学生端不受 offline 影响（本来就不返回）；status 端点教师 → 403
- [ ] **Step 2: 实现**（可见性 where：`OR: [{ createdBy: null }, { createdBy: me.id }]`，admin 跳过）
- [ ] **Step 3: 测试通过** → **Step 4: 提交** `git commit -m "feat: 文章模块(可见性规则/下架恢复/引用删除保护)"`

---

## Phase 2 · 任务与成绩（Task 9–11）

### Task 9: tasks 模块

**Files:** `server/src/tasks/`（module/controller/service、dto/create-task.dto.ts、dto/patch-task.dto.ts）

**Interfaces:**
- Produces:
  - `GET /api/tasks?page=`：教师 → 自己发布的全部（含 per-task `submittedCount/classSize`）；学生 → 本班 `published && deadline > now` 列表 + 已结束历史（含我的成绩 speed/accuracy/isPassed）
  - `POST /api/tasks { classId, textId, title, mode, durationSeconds?, minSpeed, minAccuracy, deadline }`：校验班级归属、text 可用（published，内置或自建）
  - `PATCH /api/tasks/:id`：编辑字段；`{ action: 'close' }` 提前截止

- [ ] **Step 1: 失败测试**：time 模式缺 durationSeconds → 400；教师用他人自建文章发布 → 403；学生只见本班任务；close 后学生列表移入历史；deadline 过去式发布 → 400
- [ ] **Step 2: 实现**（学生查询拆两段：active/history，历史 join 自己的 record）
- [ ] **Step 3: 测试通过** → **Step 4: 提交** `git commit -m "feat: 任务模块(发布/校验/提前截止/学生视图)"`

---

### Task 10: records 模块（交卷 / mine / grades / CSV）

**Files:** `server/src/records/`（module/controller/service、dto/submit-record.dto.ts）

**Interfaces:**
- Produces:
  - `POST /api/records` body `{ taskId, mode, speed, accuracy, totalChars, correctChars, backspaceCount, durationSeconds }`：服务端重算 `isPassed`（taskId 存在时）与 `isSuspicious`（speed>600）；事务内 `DELETE heartbeat WHERE user_id=me`；同任务重复交卷 → 409「该任务已提交过」（教师可在 PATCH users 重置时清除，见注）——实现为 `findUnique({ userId_taskId })` 判重
  - `GET /api/records/mine?page=` → 我的成绩（含任务标题）
  - `GET /api/tasks/:id/grades?export=csv&page=`：教师归属校验；json 返回 `{ list, total, stats: { avgSpeed, avgAccuracy, passedRate } }`；`export=csv` 时返回 `text/csv; charset=utf-8`，内容前置 BOM `\uFEFF`，表头 `姓名,用户名,速度(字/分),准确率(%),用时(秒),是否达标,可疑,交卷时间`

- [ ] **Step 1: 失败测试**：交卷后 isPassed 符合双线判定（两条用例：双达标 true / 单项不足 false）；speed=650 → isSuspicious=true；交卷后 heartbeat 行消失；重复交卷 409；CSV 响应以 `\uFEFF姓名,` 开头；学生 A 交学生 B 的班级任务 → 403；学生查 grades → 403
- [ ] **Step 2: 实现**（CSV 用数组 join，数字保留 2 位小数）
- [ ] **Step 3: 测试通过** → **Step 4: 提交** `git commit -m "feat: 成绩模块(交卷判定/防作弊标记/CSV导出)"`

> 注：教师重置学生密码时顺带删除该学生本任务记录的需求，v1 不做（成绩不可篡改原则），教师可用任务编辑让截止时间顺延实现重做。

### Task 11: heartbeats 模块

**Files:** `server/src/heartbeats/`（module/controller/service、dto/heartbeat.dto.ts）

**Interfaces:**
- Produces:
  - `POST /api/heartbeats` body `{ taskId?, status, speed, accuracy, progress, elapsedSeconds, charIndex }` → `prisma.heartbeat.upsert({ where: { userId }, ... })`
  - `GET /api/classes/:id/live`：教师归属校验；返回班级内学生数组 `{ id, realName, username, online, hb: { status, speed, accuracy, progress, elapsedSeconds, updatedAt } | null }`；`online = updated_at > now-60s`

- [ ] **Step 1: 失败测试**：两次心跳后仍只有 1 行且值覆盖；学生上报 61 秒前的 updatedAt（直接改库模拟）→ live 中 online=false；DELETE heartbeat 后 live 中 hb=null；教师查他人班级 → 403
- [ ] **Step 2: 实现**
- [ ] **Step 3: 测试通过** → **Step 4: 提交** `git commit -m "feat: 心跳模块(UPSERT/实时看板/离线判定)"`

---

## Phase 3 · 打字核心（Task 12–13）

### Task 12: useTypingEngine 打字引擎 composable（核心算法，纯前端）

**Files:**
- Create: `web/src/composables/useTypingEngine.ts`
- Test: `web/src/composables/__tests__/useTypingEngine.spec.ts`

**Interfaces:**
- Produces（后续页面依赖的精确签名）:

```typescript
interface TypingEngineOptions {
  target: Ref<string>;              // 练习文本
  mode: 'article' | 'time';
  durationSeconds?: number;         // time 模式
  onTimeout?: () => void;
}
interface TypingStats {
  charIndex: number;      // 已提交输入长度
  correctChars: number;   // 与 target 前缀比对正确的字符数
  accuracy: number;       // correctChars / charIndex * 100，除零为 100
  speed: number;          // correctChars / (elapsedMs/60000)，中文汉字英文同口径
  elapsedMs: number;      // 从第一个有效按键起计时
  backspaceCount: number;
  progress: number;       // charIndex / target.length * 100（article）
  finished: boolean;      // article 打满 或 time 倒计时归零
}
export function useTypingEngine(opts: TypingEngineOptions): {
  stats: Ref<TypingStats>;
  handleCompositionEnd: (e: CompositionEvent) => void;  // 中文上屏入口
  handleKeydown: (e: KeyboardEvent) => void;            // 英文直输 + Backspace + composing 期间忽略
  reset: () => void;
}
```

- [x] **Step 1: 写失败测试（Vitest，完整用例）**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useTypingEngine } from '../useTypingEngine';

function setup(target: string, mode: 'article' | 'time' = 'article', duration = 60) {
  const onTimeout = vi.fn();
  const engine = useTypingEngine({ target: ref(target), mode, durationSeconds: duration, onTimeout });
  return { ...engine, onTimeout };
}

describe('useTypingEngine', () => {
  it('英文逐字输入统计正确数与速度', () => {
    vi.useFakeTimers();
    const e = setup('hello');
    const t0 = Date.now();
    vi.setSystemTime(t0 + 1000);
    for (const ch of 'hello') {
      e.handleKeydown(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      vi.setSystemTime(Date.now() + 1000);
    }
    expect(e.stats.value.charIndex).toBe(5);
    expect(e.stats.value.correctChars).toBe(5);
    expect(e.stats.value.speed).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it('错字符计入 charIndex 但不计入 correctChars，准确率下降', () => {
    const e = setup('abc');
    e.handleKeydown(new KeyboardEvent('keydown', { key: 'a' }));
    e.handleKeydown(new KeyboardEvent('keydown', { key: 'x' }));
    expect(e.stats.value.correctChars).toBe(1);
    expect(e.stats.value.accuracy).toBeCloseTo(50);
  });

  it('退格回退 charIndex 并计数', () => {
    const e = setup('abc');
    e.handleKeydown(new KeyboardEvent('keydown', { key: 'a' }));
    e.handleKeydown(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(e.stats.value.charIndex).toBe(0);
    expect(e.stats.value.backspaceCount).toBe(1);
  });

  it('composition 上屏的中文整体计入，拼音过程不计', () => {
    const e = setup('你好');
    e.handleCompositionEnd(new CompositionEvent('compositionend', { data: 'ni' }));
    expect(e.stats.value.charIndex).toBe(0);          // 直接 compositionend 前无中文
    e.handleCompositionEnd(new CompositionEvent('compositionend', { data: '你好' }));
    expect(e.stats.value.charIndex).toBe(2);
    expect(e.stats.value.correctChars).toBe(2);
  });

  it('time 模式倒计时归零触发 onTimeout 且 finished=true', () => {
    vi.useFakeTimers();
    const e = setup('abc', 'time', 2);
    vi.advanceTimersByTime(2001);
    expect(e.stats.value.finished).toBe(true);
    expect(e.onTimeout).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('article 模式打满自动 finished', () => {
    const e = setup('ab');
    for (const ch of 'ab') e.handleKeydown(new KeyboardEvent('keydown', { key: ch }));
    expect(e.stats.value.finished).toBe(true);
    expect(e.stats.value.progress).toBe(100);
  });
});
```

- [x] **Step 2: `npx vitest run` 确认 FAIL**

- [x] **Step 3: 最小实现**

要点：内部维护 `typed: string`；`handleKeydown` 中 `e.key === 'Backspace'` 回退并 `backspaceCount++`；`composing` 标志在 keydown 时直接 return（IME 拼音期间）；`handleCompositionEnd` 追加 `e.data`；每次变更重算 correctChars（逐字符与 target 比对）、speed（elapsedMs 起点为首字符时刻，用 `Date.now()`，可被 fake timers 控制）、accuracy；`setInterval(100)` 驱动 elapsedMs 与 time 模式倒计时；`finished` 后忽略后续输入。

- [x] **Step 4: `npx vitest run` PASS** → **Step 5: 提交** `git commit -m "feat: 打字引擎composable(中英文统计/倒计时/达标口径)"`

---

### Task 13: 学生端四页（任务列表 / 打字练习 / 我的成绩 / 个人中心）

**Files:**
- Create: `web/src/views/student/MyTasks.vue`、`Typing.vue`、`MyRecords.vue`、`Profile.vue`、`web/src/components/PinyinBar.vue`、`web/src/composables/useHeartbeat.ts`
- Modify: `web/src/router/index.ts`（替换学生占位路由）

**Interfaces:**
- Consumes: `GET /api/tasks`、`GET /api/texts/:id`、`POST /api/records`、`GET /api/records/mine`、`POST /api/heartbeats`、Task 12 引擎签名

- [x] **Step 1: useHeartbeat 失败测试**：`useHeartbeat(payloadRef)` 每 20s 调一次 POST（fake timers 验证 2 次调用）；`stop()` 清除；`document.visibilityState === 'hidden'` 时 payload.status 变 `paused`（导出 `onTick` 供测试触发）
- [x] **Step 2: 实现 useHeartbeat**（setInterval 20000 + onBeforeUnmount 清理）
- [x] **Step 3: 打字练习页实现（关键逻辑）**

```
进入 → GET /api/texts/:id 取全文 → 初始化引擎
文章区：target 逐字符渲染 span，i < charIndex 已提交（correct → 绿 / 错 → 红）、i === charIndex 光标、未到灰
输入：隐藏 input 承接焦点；英文 keydown → engine.handleKeydown；中文 compositionend → engine.handleCompositionEnd
PinyinBar：自定义拼音候选条组件（输入字母序列显示候选汉字，回车/数字键选字后触发 handleCompositionEnd）——v1 允许降级为依赖系统输入法的 transparent input（compositionend 事件系统输入法同样触发），PinyinBar 仅作提示条显示当前拼音
状态条：速度/准确率/进度/用时 每 500ms 从 stats 同步；time 模式显示倒计时
心跳：useHeartbeat(computed(() => ({ taskId, status: finished ? 'finished' : typing, ...stats })))
交卷：article 打满或点「交卷」→ ElMessageBox 确认 → POST /api/records → 成功后展示成绩卡片（速度/准确率/是否达标），心跳 stop
防作弊：@paste.prevent、input 上 autocomplete=off；页面 blur → status=paused
```

- [x] **Step 4: 页面冒烟测试**：Typing.vue 挂载后渲染文章字符 span 数量 === target 长度；MyTasks.vue mock GET /api/tasks 后渲染卡片数 === list.length（实际编写）
- [x] **Step 5: 手动联调**：学生账号完成一次英文任务交卷，教师端 grades 出现记录
- [x] **Step 6: 提交** `git commit -m "feat: 学生端四页(任务/打字练习/成绩/个人中心)"`

---

## Phase 4 · 教师端与超管端页面（Task 14–16）

### Task 14: 教师端工作台 + 班级管理 + 学生账号管理

**Files:**
- Create: `web/src/views/teacher/Dashboard.vue`、`ClassList.vue`、`StudentList.vue`
- Modify: 路由替换占位

**Interfaces:** Consumes: `GET /api/stats/teacher-dashboard`、classes 四端点、users 的 students 端点、`POST /api/users/students/batch`、`PATCH /api/users/:id`

- [x] **Step 1: 实现**——Dashboard 四张统计卡；ClassList 表格 + 新建/重命名弹窗 + 删除（409 时 ElMessage 提示文案）；StudentList 核心为**批量生成弹窗**：textarea 每行一个姓名 → POST batch → 结果表格（用户名/姓名/初始密码）+「一键复制全部」按钮（navigator.clipboard）（补实现后端 `stats` 模块：teacher-dashboard 端点）
- [x] **Step 2: 冒烟测试**：StudentList 批量弹窗提交后表格渲染行数 === created.length（mock axios）
- [x] **Step 3: 提交** `git commit -m "feat: 教师端(工作台/班级/学生批量生成)"`

### Task 15: 教师端自建文章库 + 任务管理

**Files:** `web/src/views/teacher/MyTexts.vue`、`TaskList.vue`、`TaskCreate.vue`（或弹窗）

**Interfaces:** Consumes: texts 模块（教师视角）、tasks 三端点

- [x] **Step 1: 实现**——MyTexts：仅本人文章列表（`source=custom`）+ 新建/编辑弹窗（title/language/difficulty/content，实时字符数）；TaskList：发布弹窗（选文章下拉=GET texts、模式切换显隐时长、达标线数字输入、截止日期时间选择器）+ 列表含完成率进度条 + 提前截止按钮；time 模式必填时长前端校验
- [x] **Step 2: 冒烟测试**：TaskCreate 表单 time 模式未填时长时提交被拦截（实际编写）
- [x] **Step 3: 提交** `git commit -m "feat: 教师端(自建文章/任务发布与管理)"`

### Task 16: 教师端实时看板 + 成绩查询 + 超管端三页

**Files:**
- Create: `web/src/views/teacher/LiveBoard.vue`、`Grades.vue`
- Create: `web/src/views/admin/TeacherAccounts.vue`、`AllTexts.vue`、`Overview.vue`
- Modify: 路由替换占位

**Interfaces:** Consumes: `GET /api/classes/:id/live`、`GET /api/tasks/:id/grades`、users/texts/stats admin 端点

- [ ] **Step 1: 实现**——LiveBoard：30s `setInterval` 轮询 live 端点 + 组件卸载清理；学生卡片网格：姓名 + 状态徽章（typing→打字中/绿、paused→暂停/橙、finished→已完成/灰、`online=false`→离线/灰）+ 实时速度、准确率、进度条；Grades：选择任务 → 成绩表（含可疑行 danger 高亮）+ 达标/可疑筛选 + `导出CSV` 按钮直接 `window.open('/api/tasks/:id/grades?export=csv')`（带 token 不可用 open → 改为 axios blob 下载，代码给出：`const blob = await request.get(url, { responseType: 'blob' })` + URL.createObjectURL 触发下载）
- [ ] **Step 2: Admin 三页**——TeacherAccounts（列表/新建弹窗展示初始密码+「复制」/重置/停用/删除含 409 处理）；AllTexts（tabs 全部/中文/英文/内置/教师自建 + 下架/恢复按钮仅 status 切换）；Overview（GET admin-overview 渲染统计卡 + 服务状态块）
- [ ] **Step 3: 手动全流程验收**：admin 建教师 → 教师登录建班批量生成学生 → 学生登录做任务 → 教师看板看到实时状态 → 交卷后成绩单/CSV 可导出
- [ ] **Step 4: 提交** `git commit -m "feat: 实时看板/成绩导出/超管三页"`

---

## Phase 5 · 部署（Task 17）

### Task 17: 生产部署产物

**Files:**
- Create: `deploy/nginx.conf`、`deploy/ecosystem.config.js`、`deploy/backup.sh`、`deploy/README.md`（部署步骤手册）

**Interfaces:** Produces: 可直接使用的三份配置 + 备份 cron 说明

- [ ] **Step 1: 编写配置（完整）**

`deploy/nginx.conf`：

```nginx
server {
    listen 80;
    server_name _;
    root /var/www/typing/web-dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

`deploy/ecosystem.config.js`：

```javascript
module.exports = {
  apps: [{
    name: 'typing-api',
    cwd: '/var/www/typing/server',
    script: 'dist/main.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    out_date_format: 'YYYY-MM-DD_HH:mm:ss',
    error_file: '/var/log/typing/err.log',
    out_file: '/var/log/typing/out.log',
  }],
};
```

`deploy/backup.sh`：`mysqldump -u root -p"$MYSQL_PWD" typing_system | gzip > /var/backups/typing/$(date +%F).sql.gz` + `find ... -mtime +7 -delete`（保留 7 份）；crontab 行：`0 2 * * * /var/www/typing/deploy/backup.sh`

- [ ] **Step 2: 部署手册 README**（按步骤列出：服务器装 Node20/MySQL8/Nginx/PM2 → 建库 → scp dist 与 server → npm ci && prisma migrate deploy && prisma db seed → pm2 start → nginx 配置挂载 → 校验 health 与页面）
- [ ] **Step 3: 本地模拟验证**：`npm run build`（web）+ `npm run build`（server）产物齐全；nginx 代理用本地 docker 或注释说明人工验证步骤
- [ ] **Step 4: 提交** `git commit -m "chore: 部署配置(Nginx/PM2/备份脚本/手册)"`

---

## 自审记录（Self-Review）

1. **Spec 覆盖检查**：6 表（Task 2）、23 端点（Task 3/6–11 全覆盖，对照设计文档 6.2 逐条核过）、17 页（Task 5/13/14/15/16 = 3+4+3+2+5）、防作弊（10/13）、心跳 20s/离线 60s/轮询 30s/本地 500ms（11/12/13/16）、CSV（10/16）、部署（17）——无缺口。
2. **占位符扫描**：所有测试均给出具体用例与断言或完整代码；无 TBD/“类似上文”。
3. **类型一致性**：引擎签名（Task 12）与 Typing.vue（13）一致；`initialPassword`（Task 6）与 TeacherAccounts（16）一致；`online` 判定（11）与 LiveBoard 徽章（16）一致。
