import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('records 模块 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  const createdUsernames: string[] = [];
  const suffix = String(Date.now()).slice(-6);

  let teacherToken = '';
  let teacherBToken = '';
  let s1Token = '';
  let s2Token = '';
  let s3Token = '';
  let s4Token = '';
  let s1Id = 0;
  let classAId = 0;
  let textAId = 0;
  let taskId = 0;

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

    // 教师A：建班级 + 文章 + 发布任务
    const tA = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `成绩教师A${suffix}` });
    const teacherUser = tA.body.data.user;
    createdUsernames.push(teacherUser.username);
    const tAInit = tA.body.data.initialPassword as string;
    const tALogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: teacherUser.username, password: tAInit });
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${tALogin.body.data.token}`)
      .send({ oldPassword: tAInit, newPassword: `${teacherUser.username}New123` });
    teacherToken = tALogin.body.data.token as string;

    const classA = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ name: `成绩班A${suffix}` });
    classAId = classA.body.data.id;

    const textA = await request(app.getHttpServer())
      .post('/api/texts')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        title: `成绩文章A${suffix}`,
        language: 'zh',
        difficulty: 1,
        content: '成绩文章A内容',
      });
    textAId = textA.body.data.id;

    const task = await request(app.getHttpServer())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        classId: classAId,
        textId: textAId,
        title: `成绩任务${suffix}`,
        mode: 'article',
        minSpeed: 20,
        minAccuracy: 95,
        deadline: new Date(Date.now() + 86400_000).toISOString(),
      });
    taskId = task.body.data.id;

    // 教师B（他人教师，用于 grades 403 用例）
    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `成绩教师B${suffix}` });
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

    // 三名本班学生 + 一名无班学生（免改密）
    const hash = bcrypt.hashSync('studPass12', 10);
    const defs = [
      { username: `rec${suffix}a`, realName: `成绩学生一${suffix}`, classId: classAId },
      { username: `rec${suffix}b`, realName: `成绩学生二${suffix}`, classId: classAId },
      { username: `rec${suffix}c`, realName: `成绩学生三${suffix}`, classId: classAId },
      { username: `rec${suffix}d`, realName: `无班学生${suffix}`, classId: null },
    ];
    const tokens: string[] = [];
    for (const def of defs) {
      const created = await prisma.user.create({
        data: {
          username: def.username,
          passwordHash: hash,
          realName: def.realName,
          role: 'student',
          classId: def.classId,
          mustChangePassword: false,
        },
      });
      createdUsernames.push(def.username);
      if (def.username === `rec${suffix}a`) s1Id = created.id;
      const sLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: def.username, password: 'studPass12' });
      tokens.push(sLogin.body.data.token);
    }
    [s1Token, s2Token, s3Token, s4Token] = tokens;
  });

  afterAll(async () => {
    await prisma.user.update({
      where: { username: 'admin' },
      data: { mustChangePassword: true },
    });
    // 清理顺序：心跳/成绩 → 任务 → 文章 → 断开学生班级 → 班级 → 用户（外键 Restrict）
    await prisma.heartbeat.deleteMany({ where: { user: { username: { in: createdUsernames } } } });
    await prisma.record.deleteMany({ where: { user: { username: { in: createdUsernames } } } });
    await prisma.task.deleteMany({ where: { id: taskId } });
    await prisma.text.deleteMany({ where: { id: textAId } });
    await prisma.user.updateMany({
      where: { username: { in: createdUsernames } },
      data: { classId: null },
    });
    await prisma.class.deleteMany({ where: { id: classAId } });
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
    await prisma.$disconnect();
    await app.close();
  });

  const submit = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/records').set('Authorization', `Bearer ${token}`).send(body);

  // 注意：必须用函数延迟求值——对象字面量会在 describe 收集阶段捕获 taskId 的初始值 0
  const baseBody = () => ({
    taskId,
    mode: 'article',
    totalChars: 300,
    correctChars: 294,
    backspaceCount: 5,
    durationSeconds: 300,
  });

  it('1. 交卷双达标 → isPassed=true；事务内清空心跳', async () => {
    await prisma.heartbeat.create({
      data: {
        userId: s1Id,
        taskId,
        status: 'typing',
        speed: 60,
        accuracy: 98,
        progress: 50,
        elapsedSeconds: 150,
        charIndex: 150,
      },
    });
    const res = await submit(s1Token, { ...baseBody(), speed: 60, accuracy: 98 });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.isPassed).toBe(true);
    expect(res.body.data.isSuspicious).toBe(false);

    const hb = await prisma.heartbeat.findUnique({ where: { userId: s1Id } });
    expect(hb).toBeNull();
  });

  it('2. 速度不足达标线 → isPassed=false', async () => {
    const res = await submit(s2Token, { ...baseBody(), speed: 10, accuracy: 98 });
    expect(res.status).toBe(200);
    expect(res.body.data.isPassed).toBe(false);
    expect(res.body.data.isSuspicious).toBe(false);
  });

  it('3. speed=650 → isSuspicious=true 且 isPassed=true', async () => {
    const res = await submit(s3Token, { ...baseBody(), speed: 650, accuracy: 98 });
    expect(res.status).toBe(200);
    expect(res.body.data.isPassed).toBe(true);
    expect(res.body.data.isSuspicious).toBe(true);
  });

  it('4. 无班学生交班级任务 → 403', async () => {
    const res = await submit(s4Token, { ...baseBody(), speed: 60, accuracy: 98 });
    expect(res.status).toBe(403);
  });

  it('5. 同任务重复交卷 → 409', async () => {
    const res = await submit(s1Token, { ...baseBody(), speed: 60, accuracy: 98 });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('该任务已提交过');
  });

  it('6. GET /records/mine → 含任务标题', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/records/mine')
      .set('Authorization', `Bearer ${s1Token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    const item = res.body.data.list[0];
    expect(item.task.title).toBe(`成绩任务${suffix}`);
    expect(Number(item.speed)).toBe(60);
    expect(item.isPassed).toBe(true);
  });

  it('7. grades JSON → stats 平均分与达标率', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/tasks/${taskId}/grades`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.stats.avgSpeed).toBe(240);
    expect(res.body.data.stats.avgAccuracy).toBe(98);
    expect(res.body.data.stats.passedRate).toBeCloseTo(66.67, 2);
    expect(res.body.data.list).toHaveLength(3);
    expect(res.body.data.list[0].user.realName).toContain('成绩学生');
  });

  it('8. grades CSV → BOM + 指定表头 + 行数据', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/tasks/${taskId}/grades?export=csv`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.startsWith('\uFEFF姓名,用户名,速度(字/分),准确率(%),用时(秒),是否达标,可疑,交卷时间')).toBe(true);
    expect(res.text).toContain('60.00');
    expect(res.text).toContain('650.00');
    expect(res.text).toContain(',是,');
  });

  it('9. 学生查 grades → 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/tasks/${taskId}/grades`)
      .set('Authorization', `Bearer ${s1Token}`);
    expect(res.status).toBe(403);
  });

  it('10. 他人教师查 grades → 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/tasks/${taskId}/grades`)
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(res.status).toBe(403);
  });
});
