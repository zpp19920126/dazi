import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('tasks 模块 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  const createdUsernames: string[] = [];
  const createdClassIds: number[] = [];
  const createdTextIds: number[] = [];
  const suffix = String(Date.now()).slice(-6);

  let teacherAUser: { id: number; username: string };
  let teacherAInitPw = '';
  let teacherBUser: { id: number; username: string };
  let teacherBInitPw = '';
  const tokenCache = new Map<string, string>();
  let student1Token = '';
  let student2Token = '';
  let classAId = 0;
  let classBId = 0;
  let textAId = 0;
  let textBId = 0;

  /** 教师登录并完成强制改密，返回可调用业务接口的 token（按用户名缓存） */
  async function getTeacherToken(user: { username: string }, initPw: string) {
    const cached = tokenCache.get(user.username);
    if (cached) return cached;
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: user.username, password: initPw });
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;
    const change = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: initPw, newPassword: `${user.username}New123` });
    expect(change.status).toBe(200);
    tokenCache.set(user.username, token);
    return token;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    // supertest 7 对未监听的 server 会自动 listen 并在请求后自动 close，
    // close 与下一请求 re-listen 之间存在竞态（偶发 ECONNREFUSED）。
    // 显式监听一次，让 supertest 走"已监听"路径，全程复用同一端口。
    await new Promise<void>((resolve, reject) => {
      const server = app.getHttpServer() as Server;
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve();
      });
    });

    // e2e 自恢复：admin 凭据强制重置为已知值（外部环境可能改动过）；
    // 业务接口需过强改密守卫，临时置 false，afterAll 还原
    await prisma.user.update({
      where: { username: 'admin' },
      data: {
        passwordHash: bcrypt.hashSync('admin123', 10),
        status: 'active',
        mustChangePassword: false,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    adminToken = login.body.data.token as string;

    // 两名教师（API 创建，真实初始密码）
    const tA = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `任务教师A${suffix}` });
    teacherAUser = tA.body.data.user;
    teacherAInitPw = tA.body.data.initialPassword as string;
    createdUsernames.push(teacherAUser.username);
    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `任务教师B${suffix}` });
    teacherBUser = tB.body.data.user;
    teacherBInitPw = tB.body.data.initialPassword as string;
    createdUsernames.push(teacherBUser.username);

    // 班级A（教师A，API 创建）；班级B（教师B，直建）
    const tokenA = await getTeacherToken(teacherAUser, teacherAInitPw);
    const classA = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: `任务班A${suffix}` });
    classAId = classA.body.data.id;
    createdClassIds.push(classAId);
    const classB = await prisma.class.create({
      data: { name: `任务班B${suffix}`, teacherId: teacherBUser.id },
    });
    classBId = classB.id;
    createdClassIds.push(classBId);

    // 班级A 两名学生（直建、免改密），student1 登录
    const hash = bcrypt.hashSync('studPass12', 10);
    await prisma.user.createMany({
      data: [
        {
          username: `task${suffix}a`,
          passwordHash: hash,
          realName: `任务学生一${suffix}`,
          role: 'student',
          classId: classAId,
          mustChangePassword: false,
        },
        {
          username: `task${suffix}b`,
          passwordHash: hash,
          realName: `任务学生二${suffix}`,
          role: 'student',
          classId: classAId,
          mustChangePassword: false,
        },
      ],
    });
    createdUsernames.push(`task${suffix}a`, `task${suffix}b`);
    const s1 = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: `task${suffix}a`, password: 'studPass12' });
    student1Token = s1.body.data.token;

    // 无班学生 student2（登录但无班级）
    await prisma.user.create({
      data: {
        username: `task${suffix}c`,
        passwordHash: hash,
        realName: `无班学生${suffix}`,
        role: 'student',
        mustChangePassword: false,
      },
    });
    createdUsernames.push(`task${suffix}c`);
    const s2 = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: `task${suffix}c`, password: 'studPass12' });
    student2Token = s2.body.data.token;

    // 教师A/B 各自建一篇文章
    const textA = await request(app.getHttpServer())
      .post('/api/texts')
      .set('Authorization', `Bearer ${await getTeacherToken(teacherAUser, teacherAInitPw)}`)
      .send({ title: `任务文章A${suffix}`, language: 'zh', difficulty: 1, content: '任务文章A内容' });
    textAId = textA.body.data.id;
    createdTextIds.push(textAId);
    const textB = await request(app.getHttpServer())
      .post('/api/texts')
      .set('Authorization', `Bearer ${await getTeacherToken(teacherBUser, teacherBInitPw)}`)
      .send({ title: `任务文章B${suffix}`, language: 'zh', difficulty: 1, content: '任务文章B内容' });
    textBId = textB.body.data.id;
    createdTextIds.push(textBId);
  });

  afterAll(async () => {
    await prisma.user.update({
      where: { username: 'admin' },
      data: { mustChangePassword: true },
    });
    // 清理顺序：任务 → 文章 → 班级 → 用户（外键 Restrict）
    await prisma.task.deleteMany({ where: { classId: { in: createdClassIds } } });
    await prisma.text.deleteMany({ where: { id: { in: createdTextIds } } });
    await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
    await prisma.$disconnect();
    await app.close();
  });

  const futureDeadline = () => new Date(Date.now() + 86400_000).toISOString();

  it('1. POST tasks：time 模式缺 durationSeconds → 400', async () => {
    const token = await getTeacherToken(teacherAUser, teacherAInitPw);
    const res = await request(app.getHttpServer())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        classId: classAId,
        textId: textAId,
        title: `计时任务${suffix}`,
        mode: 'time',
        minSpeed: 20,
        minAccuracy: 95,
        deadline: futureDeadline(),
      });
    expect(res.status).toBe(400);
  });

  it('2. POST tasks：deadline 为过去时间 → 400', async () => {
    const token = await getTeacherToken(teacherAUser, teacherAInitPw);
    const res = await request(app.getHttpServer())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        classId: classAId,
        textId: textAId,
        title: `过期任务${suffix}`,
        mode: 'article',
        minSpeed: 20,
        minAccuracy: 95,
        deadline: new Date(Date.now() - 3600_000).toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it('3. 教师用他人自建文章发布 → 403', async () => {
    const token = await getTeacherToken(teacherAUser, teacherAInitPw);
    const res = await request(app.getHttpServer())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        classId: classAId,
        textId: textBId,
        title: `越权文章任务${suffix}`,
        mode: 'article',
        minSpeed: 20,
        minAccuracy: 95,
        deadline: futureDeadline(),
      });
    expect(res.status).toBe(403);
  });

  it('4. 教师给他人班级发布 → 403', async () => {
    const token = await getTeacherToken(teacherAUser, teacherAInitPw);
    const res = await request(app.getHttpServer())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        classId: classBId,
        textId: textAId,
        title: `越权班级任务${suffix}`,
        mode: 'article',
        minSpeed: 20,
        minAccuracy: 95,
        deadline: futureDeadline(),
      });
    expect(res.status).toBe(403);
  });

  it('5. 正常发布 → 200；教师列表含 submittedCount/classSize', async () => {
    const token = await getTeacherToken(teacherAUser, teacherAInitPw);
    const res = await request(app.getHttpServer())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        classId: classAId,
        textId: textAId,
        title: `正常任务${suffix}`,
        mode: 'article',
        minSpeed: 20,
        minAccuracy: 95,
        deadline: futureDeadline(),
      });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.status).toBe('published');

    const list = await request(app.getHttpServer())
      .get('/api/tasks')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const found = list.body.data.list.find((t: { id: number }) => t.id === res.body.data.id);
    expect(found).toBeTruthy();
    expect(found.title).toBe(`正常任务${suffix}`);
    expect(found.submittedCount).toBe(0);
    expect(found.classSize).toBe(2);
  });

  it('6. 学生只见本班任务：本班学生在 active；无班学生 active 为空', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/tasks')
      .set('Authorization', `Bearer ${student1Token}`);
    expect(res.status).toBe(200);
    const activeTitles = res.body.data.active.map((t: { title: string }) => t.title);
    expect(activeTitles).toContain(`正常任务${suffix}`);
    expect(res.body.data.history).toHaveLength(0);

    const res2 = await request(app.getHttpServer())
      .get('/api/tasks')
      .set('Authorization', `Bearer ${student2Token}`);
    expect(res2.status).toBe(200);
    expect(res2.body.data.active).toHaveLength(0);
  });

  it('7. close 提前截止 → 学生移入 history；他人教师 PATCH → 403', async () => {
    const tokenA = await getTeacherToken(teacherAUser, teacherAInitPw);
    const tokenB = await getTeacherToken(teacherBUser, teacherBInitPw);
    const list = await request(app.getHttpServer())
      .get('/api/tasks')
      .set('Authorization', `Bearer ${tokenA}`);
    const target = list.body.data.list.find((t: { title: string }) => t.title === `正常任务${suffix}`);
    expect(target).toBeTruthy();

    // 教师B 无权关闭教师A 的任务
    const denied = await request(app.getHttpServer())
      .patch(`/api/tasks/${target.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ action: 'close' });
    expect(denied.status).toBe(403);

    const close = await request(app.getHttpServer())
      .patch(`/api/tasks/${target.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ action: 'close' });
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe('closed');

    const res = await request(app.getHttpServer())
      .get('/api/tasks')
      .set('Authorization', `Bearer ${student1Token}`);
    const activeIds = res.body.data.active.map((t: { id: number }) => t.id);
    const historyIds = res.body.data.history.map((t: { id: number }) => t.id);
    expect(activeIds).not.toContain(target.id);
    expect(historyIds).toContain(target.id);
    const histItem = res.body.data.history.find((t: { id: number }) => t.id === target.id);
    expect(histItem.myRecord).toBeNull();
  });
});
