import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('自动打卡 登录+心跳双钩子 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  const createdUsernames: string[] = [];
  const suffix = String(Date.now()).slice(-6);

  let teacherToken = '';
  let sToken = '';
  let sId = 0;
  let classAId = 0;

  // 样板辅助：以教师身份为 classA 开课，返回新建课次行
  const openSessionAndGetId = async () => {
    const res = await request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ classId: classAId });
    expect(res.status).toBe(200);
    return res.body.data;
  };

  // 样板辅助：PATCH close 结掉 classA 当前 open 课次（无则跳过）
  const closeOpenSession = async () => {
    const open = await prisma.classSession.findFirst({
      where: { classId: classAId, status: 'open' },
    });
    if (!open) return;
    const res = await request(app.getHttpServer())
      .patch(`/api/sessions/${open.id}/close`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
  };

  // 样板辅助：classA 当前 open 课次 id（不存在则抛错）
  const openSessionSid = async () =>
    (await prisma.classSession.findFirstOrThrow({ where: { classId: classAId, status: 'open' } })).id;

  // 样板辅助：结掉所有 open 课次（仅本班，避免影响其它并行套件）
  const closeAllOpenSessions = async () => {
    const opens = await prisma.classSession.findMany({
      where: { classId: classAId, status: 'open' },
    });
    for (const s of opens) {
      await request(app.getHttpServer())
        .patch(`/api/sessions/${s.id}/close`)
        .set('Authorization', `Bearer ${teacherToken}`);
    }
  };

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

    // 教师：建班级
    const tA = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `打卡教师${suffix}` });
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
      .send({ name: `打卡班${suffix}` });
    classAId = classA.body.data.id;

    // 一名学生（免改密）
    const created = await prisma.user.create({
      data: {
        username: `ck${suffix}a`,
        passwordHash: bcrypt.hashSync('studPass12', 10),
        realName: `打卡学生${suffix}`,
        role: 'student',
        classId: classAId,
        mustChangePassword: false,
      },
    });
    createdUsernames.push(`ck${suffix}a`);
    sId = created.id;
    const sLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: `ck${suffix}a`, password: 'studPass12' });
    sToken = sLogin.body.data.token as string;
  });

  afterAll(async () => {
    await prisma.user.update({
      where: { username: 'admin' },
      data: { mustChangePassword: true },
    });
    // 清理顺序：积分 → 考勤 → 课次 → 心跳 → 断开学生班级 → 班级 → 用户（外键 Restrict）
    await prisma.pointRecord.deleteMany({ where: { user: { username: { in: createdUsernames } } } });
    await prisma.attendance.deleteMany({ where: { user: { username: { in: createdUsernames } } } });
    await prisma.classSession.deleteMany({ where: { classId: classAId } });
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

  it('1. 开课后学生登录 → 自动打卡 present', async () => {
    const sid = (await openSessionAndGetId()).id;
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: `ck${suffix}a`, password: 'studPass12' });
    expect(login.status).toBe(200); // auth.controller 有 @HttpCode(HttpStatus.OK)
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
    await closeOpenSession();
    await prisma.attendance.updateMany({ where: { userId: sId }, data: { corrected: false } });
    const sid = (await openSessionAndGetId()).id;
    await prisma.classSession.update({ where: { id: sid }, data: { startedAt: new Date(Date.now() - 6 * 60_000) } });
    await request(app.getHttpServer()).post('/api/auth/login').send({ username: `ck${suffix}a`, password: 'studPass12' });
    const row = await prisma.attendance.findUnique({ where: { sessionId_userId: { sessionId: sid, userId: sId } } });
    expect(row!.status).toBe('late');
  });

  it('4. 已登录学生经心跳补打卡（开课瞬间在线者）', async () => {
    await closeOpenSession();
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
      data: { corrected: true, status: 'sick', checkInAt: null }, // 显式置回未打卡，保证用例自洽
    });
    await prisma.classSession.update({ where: { id: await openSessionSid() }, data: { startedAt: new Date(Date.now() - 10 * 60_000) } });
    await request(app.getHttpServer()).post('/api/auth/login').send({ username: `ck${suffix}a`, password: 'studPass12' });
    const row = await prisma.attendance.findUnique({ where: { sessionId_userId: { sessionId: await openSessionSid(), userId: sId } } });
    expect(row!.status).toBe('sick');
    expect(row!.checkInAt).toBeNull();
  });

  it('6. 无 open 课次时登录正常返回 token 且零副作用', async () => {
    await closeAllOpenSessions();
    const before = await prisma.attendance.count();
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ username: `ck${suffix}a`, password: 'studPass12' });
    expect(login.body.data.token).toBeTruthy();
    expect(await prisma.attendance.count()).toBe(before);
  });
});
