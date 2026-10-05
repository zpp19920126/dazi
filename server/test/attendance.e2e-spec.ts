import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('attendance 考勤名单与教师修正 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  const createdUsernames: string[] = [];
  const suffix = String(Date.now()).slice(-6);

  let teacherToken = '';
  let teacherBToken = '';
  let sId = 0;
  let classAId = 0;

  const openSession = (body: Record<string, unknown>, token = teacherToken) =>
    request(app.getHttpServer()).post('/api/sessions').set('Authorization', `Bearer ${token}`).send(body);

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

    // 教师A（本人班级，正常流程）
    const tA = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `名单教师A${suffix}` });
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
      .send({ name: `名单班${suffix}` });
    classAId = classA.body.data.id;

    // 教师B（他人教师，用于 403 用例）
    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `名单教师B${suffix}` });
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

    // 一名学生（免改密；不走 API 登录，避免触发自动打卡钩子）
    const created = await prisma.user.create({
      data: {
        username: `at${suffix}s`,
        passwordHash: bcrypt.hashSync('studPass12', 10),
        realName: `名单学生${suffix}`,
        role: 'student',
        classId: classAId,
        mustChangePassword: false,
      },
    });
    createdUsernames.push(`at${suffix}s`);
    sId = created.id;
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

  it('1. 考勤名单含姓名/打卡时间/状态/seated,学生心跳后 seated=true', async () => {
    const sid = (await openSession({ classId: classAId })).body.data.id;
    // 心跳直写 prisma，绕过 HeartbeatsService.upsert 的 tryClockIn 钩子（Task 4 语义：
    // 只有 POST /api/heartbeats / 登录才补打卡）。因此考勤行保持 absent，
    // 心跳仅影响 seated 辅助位——absent 断言与判定3的"直写心跳"读法一致。
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
    expect(row.checkInAt).toBeNull();
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
    const att = await prisma.attendance.findFirst({ where: { userId: sId } });
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
});
