import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('texts 模块 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  const createdUsernames: string[] = [];
  const createdTextIds: number[] = [];
  const createdClassIds: number[] = [];
  const suffix = String(Date.now()).slice(-6);

  let teacherAUser: { id: number; username: string };
  let teacherAInitPw = '';
  let teacherBUser: { id: number; username: string };
  let teacherBInitPw = '';
  const tokenCache = new Map<string, string>();

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

    // 经 API 创建两名教师（拿真实初始密码）
    const tA = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `文章教师A${suffix}` });
    expect(tA.status).toBe(200);
    teacherAUser = tA.body.data.user;
    teacherAInitPw = tA.body.data.initialPassword as string;
    createdUsernames.push(teacherAUser.username);

    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `文章教师B${suffix}` });
    expect(tB.status).toBe(200);
    teacherBUser = tB.body.data.user;
    teacherBInitPw = tB.body.data.initialPassword as string;
    createdUsernames.push(teacherBUser.username);
  });

  afterAll(async () => {
    await prisma.user.update({
      where: { username: 'admin' },
      data: { mustChangePassword: true },
    });
    // 清理顺序：任务 → 班级 → 文章 → 用户（外键 Restrict）
    await prisma.task.deleteMany({ where: { textId: { in: createdTextIds } } });
    await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    await prisma.text.deleteMany({ where: { id: { in: createdTextIds } } });
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('1. 教师创建文章 → charCount 按 Unicode 码点计算（emoji/全角算 1）', async () => {
    const token = await getTeacherToken(teacherAUser, teacherAInitPw);
    // 你(1)好(1)🌍(1)，(1)世(1)界(1)！(1) = 7 个码点；若错用 .length 会得 8
    const content = '你好🌍，世界！';
    const res = await request(app.getHttpServer())
      .post('/api/texts')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: `自建文章${suffix}`, language: 'zh', difficulty: 2, content });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    const text = res.body.data;
    expect(text.charCount).toBe(7);
    expect(text.status).toBe('published');
    expect(text.createdBy).toBe(teacherAUser.id);
    createdTextIds.push(text.id);
  });

  it('2. 列表可见性：教师B 不含他人自建；admin 含全部', async () => {
    const tokenB = await getTeacherToken(teacherBUser, teacherBInitPw);
    const listB = await request(app.getHttpServer())
      .get('/api/texts')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(listB.status).toBe(200);
    const bIds = listB.body.data.list.map((t: { id: number }) => t.id);
    expect(bIds).not.toContain(createdTextIds[0]);

    const listAdmin = await request(app.getHttpServer())
      .get('/api/texts')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAdmin.status).toBe(200);
    const adminIds = listAdmin.body.data.list.map((t: { id: number }) => t.id);
    expect(adminIds).toContain(createdTextIds[0]);
  });

  it('3. admin 下架后教师 GET 详情 → 403；恢复后可见', async () => {
    const tokenA = await getTeacherToken(teacherAUser, teacherAInitPw);
    const textId = createdTextIds[0];
    const offline = await request(app.getHttpServer())
      .patch(`/api/texts/${textId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'offline' });
    expect(offline.status).toBe(200);
    expect(offline.body.data.status).toBe('offline');

    const denied = await request(app.getHttpServer())
      .get(`/api/texts/${textId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(denied.status).toBe(403);

    // admin 自己仍可见 offline 文章
    const adminView = await request(app.getHttpServer())
      .get(`/api/texts/${textId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminView.status).toBe(200);

    // 恢复上架后教师可见
    const publish = await request(app.getHttpServer())
      .patch(`/api/texts/${textId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'published' });
    expect(publish.status).toBe(200);
    const ok = await request(app.getHttpServer())
      .get(`/api/texts/${textId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(ok.status).toBe(200);
  });

  it('4. 教师编辑自己的文章 → 内容与 charCount 更新', async () => {
    const tokenA = await getTeacherToken(teacherAUser, teacherAInitPw);
    const textId = createdTextIds[0];
    const res = await request(app.getHttpServer())
      .patch(`/api/texts/${textId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: `自建文章改${suffix}`, content: 'ab👍cd' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe(`自建文章改${suffix}`);
    expect(res.body.data.charCount).toBe(5);
  });

  it('5. status 端点教师调用 → 403', async () => {
    const tokenA = await getTeacherToken(teacherAUser, teacherAInitPw);
    const res = await request(app.getHttpServer())
      .patch(`/api/texts/${createdTextIds[0]}/status`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'offline' });
    expect(res.status).toBe(403);
  });

  it('6. 被任务引用的文章 DELETE → 409；移除任务后删除成功', async () => {
    const tokenA = await getTeacherToken(teacherAUser, teacherAInitPw);
    const textId = createdTextIds[0];
    const klass = await prisma.class.create({
      data: { name: `文章班${suffix}`, teacherId: teacherAUser.id },
    });
    createdClassIds.push(klass.id);
    await prisma.task.create({
      data: {
        classId: klass.id,
        textId,
        title: `引用任务${suffix}`,
        mode: 'article',
        minSpeed: 10,
        minAccuracy: 90,
        deadline: new Date(Date.now() + 86400_000),
        createdBy: teacherAUser.id,
      },
    });

    const del = await request(app.getHttpServer())
      .delete(`/api/texts/${textId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(del.status).toBe(409);
    expect(del.body.message).toBe('该文章已被任务使用，请使用下架');

    await prisma.task.deleteMany({ where: { textId } });
    const delAgain = await request(app.getHttpServer())
      .delete(`/api/texts/${textId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(delAgain.status).toBe(200);
    const idx = createdTextIds.indexOf(textId);
    if (idx >= 0) createdTextIds.splice(idx, 1);
    const gone = await prisma.text.findUnique({ where: { id: textId } });
    expect(gone).toBeNull();
  });
});
