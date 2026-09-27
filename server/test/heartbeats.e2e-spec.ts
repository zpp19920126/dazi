import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('heartbeats 模块 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  const createdUsernames: string[] = [];
  const suffix = String(Date.now()).slice(-6);

  let teacherToken = '';
  let teacherBToken = '';
  let sToken = '';
  let sId = 0;
  let classAId = 0;

  const heartbeat = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/heartbeats').set('Authorization', `Bearer ${token}`).send(body);

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

    // 教师A：建班级
    const tA = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `心跳教师A${suffix}` });
    createdUsernames.push(tA.body.data.user.username);
    const tAInit = tA.body.data.initialPassword as string;
    const tALogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: tA.body.data.user.username, password: tAInit });
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${tALogin.body.data.token}`)
      .send({ oldPassword: tAInit, newPassword: `${tA.body.data.user.username}New123` });
    teacherToken = tALogin.body.data.token as string;

    const classA = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ name: `心跳班A${suffix}` });
    classAId = classA.body.data.id;

    // 教师B（他人教师，用于 live 403 用例）
    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `心跳教师B${suffix}` });
    createdUsernames.push(tB.body.data.user.username);
    const tBInit = tB.body.data.initialPassword as string;
    const tBLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: tB.body.data.user.username, password: tBInit });
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${tBLogin.body.data.token}`)
      .send({ oldPassword: tBInit, newPassword: `${tB.body.data.user.username}New123` });
    teacherBToken = tBLogin.body.data.token as string;

    // 一名学生（免改密）
    const created = await prisma.user.create({
      data: {
        username: `hb${suffix}a`,
        passwordHash: bcrypt.hashSync('studPass12', 10),
        realName: `心跳学生${suffix}`,
        role: 'student',
        classId: classAId,
        mustChangePassword: false,
      },
    });
    createdUsernames.push(`hb${suffix}a`);
    sId = created.id;
    const sLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: `hb${suffix}a`, password: 'studPass12' });
    sToken = sLogin.body.data.token as string;
  });

  afterAll(async () => {
    await prisma.user.update({
      where: { username: 'admin' },
      data: { mustChangePassword: true },
    });
    // 清理顺序：心跳 → 断开学生班级 → 班级 → 用户（外键 Restrict）
    await prisma.heartbeat.deleteMany({ where: { user: { username: { in: createdUsernames } } } });
    await prisma.user.updateMany({
      where: { username: { in: createdUsernames } },
      data: { classId: null },
    });
    await prisma.class.deleteMany({ where: { id: classAId } });
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('1. 两次心跳 upsert → 仍 1 行且值覆盖；live 显示 online=true 与最新值', async () => {
    const r1 = await heartbeat(sToken, {
      taskId: null,
      status: 'typing',
      speed: 50,
      accuracy: 95,
      progress: 30,
      elapsedSeconds: 60,
      charIndex: 90,
    });
    expect(r1.status).toBe(200);

    const r2 = await heartbeat(sToken, {
      taskId: null,
      status: 'typing',
      speed: 80,
      accuracy: 97,
      progress: 60,
      elapsedSeconds: 120,
      charIndex: 180,
    });
    expect(r2.status).toBe(200);
    expect(r2.body.code).toBe(0);

    const rows = await prisma.heartbeat.findMany({ where: { userId: sId } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].speed)).toBe(80);
    expect(Number(rows[0].progress)).toBe(60);
    expect(rows[0].charIndex).toBe(180);

    const res = await request(app.getHttpServer())
      .get(`/api/classes/${classAId}/live`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    const list = res.body.data;
    expect(list).toHaveLength(1);
    expect(list[0].username).toBe(`hb${suffix}a`);
    expect(list[0].realName).toBe(`心跳学生${suffix}`);
    expect(list[0].online).toBe(true);
    expect(list[0].hb.status).toBe('typing');
    expect(Number(list[0].hb.speed)).toBe(80);
    expect(list[0].hb.updatedAt).toBeTruthy();
  });

  it('2. 心跳 updatedAt 超过 60 秒 → live 中 online=false', async () => {
    // Prisma 按 UTC 写入 datetime，raw 更新须用 UTC_TIMESTAMP 保持一致
    await prisma.$executeRaw`UPDATE heartbeat SET updated_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE user_id = ${sId}`;
    const res = await request(app.getHttpServer())
      .get(`/api/classes/${classAId}/live`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].online).toBe(false);
    // 心跳数据仍在，仅离线
    expect(res.body.data[0].hb).not.toBeNull();
  });

  it('3. 删除心跳 → live 中 hb=null', async () => {
    await prisma.heartbeat.deleteMany({ where: { userId: sId } });
    const res = await request(app.getHttpServer())
      .get(`/api/classes/${classAId}/live`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].hb).toBeNull();
    expect(res.body.data[0].online).toBe(false);
  });

  it('4. 他人教师查 live → 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/classes/${classAId}/live`)
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(res.status).toBe(403);
  });
});
