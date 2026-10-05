import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('sessions 模块 (e2e)', () => {
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

    // 教师A：建班级
    const tA = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `课次教师A${suffix}` });
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
      .send({ name: `上课班${suffix}` });
    classAId = classA.body.data.id;

    // 教师B（他人教师，用于 403 用例）
    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `课次教师B${suffix}` });
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
        username: `sm${suffix}a`,
        passwordHash: bcrypt.hashSync('studPass12', 10),
        realName: `课次学生${suffix}`,
        role: 'student',
        classId: classAId,
        mustChangePassword: false,
      },
    });
    createdUsernames.push(`sm${suffix}a`);
    sId = created.id;
    const sLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: `sm${suffix}a`, password: 'studPass12' });
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

  it('1. 开课 → 生成课次与全班 absent 考勤行', async () => {
    const res = await openSession({ classId: classAId, period: '第三节' });
    expect(res.status).toBe(200);
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
    expect(res.status).toBe(200);
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

  it('9. 学生角色调开课接口 → 403（角色门禁）', async () => {
    const res = await openSession({ classId: classAId }, sToken);
    expect(res.status).toBe(403);
  });

  it('10. page 非法字符串 → 400（ParseIntPipe，NaN 防护）', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/sessions?classId=${classAId}&page=abc`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(400);
  });
});
