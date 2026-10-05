import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('homework 模块 (e2e)', () => {
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
  let classBId = 0;

  const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

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
      .send({ realName: `作业教师A${suffix}` });
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
      .send({ name: `作业班${suffix}` });
    classAId = classA.body.data.id;

    // 教师B（他人教师，用于 403 用例）
    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `作业教师B${suffix}` });
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

    const classB = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${teacherBToken}`)
      .send({ name: `他班${suffix}` });
    classBId = classB.body.data.id;

    // 一名学生（免改密）
    const created = await prisma.user.create({
      data: {
        username: `sm${suffix}a`,
        passwordHash: bcrypt.hashSync('studPass12', 10),
        realName: `作业学生${suffix}`,
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
    // 清理顺序：作业文件 → 提交 → 作业 → 积分 → 考勤 → 课次 → 心跳 → 断开学生班级 → 班级 → 用户（外键 Restrict）
    await prisma.homeworkFile.deleteMany({ where: { submission: { homework: { classId: { in: [classAId, classBId] } } } } });
    await prisma.homeworkSubmission.deleteMany({ where: { homework: { classId: { in: [classAId, classBId] } } } });
    await prisma.homework.deleteMany({ where: { classId: { in: [classAId, classBId] } } });
    await prisma.pointRecord.deleteMany({ where: { user: { username: { in: createdUsernames } } } });
    await prisma.attendance.deleteMany({ where: { user: { username: { in: createdUsernames } } } });
    await prisma.classSession.deleteMany({ where: { classId: { in: [classAId, classBId] } } });
    await prisma.heartbeat.deleteMany({ where: { user: { username: { in: createdUsernames } } } });
    await prisma.user.updateMany({
      where: { username: { in: createdUsernames } },
      data: { classId: null },
    });
    await prisma.class.deleteMany({ where: { id: { in: [classAId, classBId] } } });
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
    await prisma.$disconnect();
    await app.close();
  });

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
});
