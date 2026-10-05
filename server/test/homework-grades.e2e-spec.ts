import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('homework 批改与成绩名册 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  const createdUsernames: string[] = [];
  const suffix = `hwgr${String(Date.now()).slice(-6)}`;

  let teacherToken = '';
  let teacherAId = 0;
  let teacherBToken = '';
  let sToken = '';
  let sIdA = 0;
  let sIdB = 0;
  let classAId = 0;
  let classBId = 0;
  let hwId = 0;
  let subAId = 0;
  let fileAId = 0;

  const past = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

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
      .send({ realName: `批改教师A${suffix}` });
    createdUsernames.push(tA.body.data.user.username);
    const tAInit = tA.body.data.initialPassword as string;
    teacherAId = tA.body.data.user.id;
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
      .send({ name: `批改班${suffix}` });
    classAId = classA.body.data.id;

    // 教师B（他人教师，用于 403 用例）
    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `批改教师B${suffix}` });
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

    // 学生A、学生B（同班，均免改密）：A 按时提交，B 迟交提交
    const sA = await prisma.user.create({
      data: {
        username: `sm${suffix}a`,
        passwordHash: bcrypt.hashSync('studPass12', 10),
        realName: `批改学生A${suffix}`,
        role: 'student',
        classId: classAId,
        mustChangePassword: false,
      },
    });
    createdUsernames.push(`sm${suffix}a`);
    sIdA = sA.id;
    const sLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: `sm${suffix}a`, password: 'studPass12' });
    sToken = sLogin.body.data.token as string;

    const sB = await prisma.user.create({
      data: {
        username: `sm${suffix}b`,
        passwordHash: bcrypt.hashSync('studPass12', 10),
        realName: `批改学生B${suffix}`,
        role: 'student',
        classId: classAId,
        mustChangePassword: false,
      },
    });
    createdUsernames.push(`sm${suffix}b`);
    sIdB = sB.id;

    // 教师A 布置作业（已过期标题固定为 批改作业），直接 prisma 插入两条提交
    const hw = await request(app.getHttpServer())
      .post('/api/homeworks')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        classId: classAId,
        title: '批改作业',
        content: '请完成批改用例内容',
        dueAt: past(1),
        allowAttachment: false,
      });
    hwId = hw.body.data.id;
    const subA = await prisma.homeworkSubmission.create({
      data: { homeworkId: hwId, userId: sIdA, textContent: '按时作答', submittedAt: new Date(), isLate: false },
    });
    subAId = subA.id;
    const fileA = await prisma.homeworkFile.create({
      data: {
        submissionId: subA.id,
        originalName: '作品图.jpg',
        storedKey: `e2e-dummy/${suffix}-作品图.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
      },
    });
    fileAId = fileA.id;
    await prisma.homeworkSubmission.create({
      data: { homeworkId: hwId, userId: sIdB, textContent: '迟交作答', submittedAt: new Date(), isLate: true },
    });
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

  it('1. 布置教师 PATCH grade {score:92.5, comment:很好} → 200；prisma 断言落库', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/homework/submissions/${subAId}/grade`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ score: 92.5, comment: '很好' });
    expect(res.status).toBe(200);
    const sub = await prisma.homeworkSubmission.findUniqueOrThrow({ where: { id: subAId } });
    expect(Number(sub.score)).toBe(92.5);
    expect(sub.teacherComment).toBe('很好');
    expect(sub.gradedBy).toBe(teacherAId);
    expect(sub.gradedAt).not.toBeNull();
  });

  it('2. 重复 PATCH {score:88} 不传 comment → 200 且点评被清空为 null', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/homework/submissions/${subAId}/grade`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ score: 88 });
    expect(res.status).toBe(200);
    const sub = await prisma.homeworkSubmission.findUniqueOrThrow({ where: { id: subAId } });
    expect(Number(sub.score)).toBe(88);
    expect(sub.teacherComment).toBeNull();
  });

  it('3. 他人教师 B PATCH → 403；学生 PATCH → 403；score:101 → 400', async () => {
    const tB = await request(app.getHttpServer())
      .patch(`/api/homework/submissions/${subAId}/grade`)
      .set('Authorization', `Bearer ${teacherBToken}`)
      .send({ score: 60 });
    expect(tB.status).toBe(403);
    const s = await request(app.getHttpServer())
      .patch(`/api/homework/submissions/${subAId}/grade`)
      .set('Authorization', `Bearer ${sToken}`)
      .send({ score: 60 });
    expect(s.status).toBe(403);
    const bad = await request(app.getHttpServer())
      .patch(`/api/homework/submissions/${subAId}/grade`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ score: 101 });
    expect(bad.status).toBe(400);
  });

  it('4. 学生 detail：mySubmission.score 字符串含 88、teacherComment null', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/homeworks/${hwId}`)
      .set('Authorization', `Bearer ${sToken}`);
    expect(res.status).toBe(200);
    expect(String(res.body.data.mySubmission.score)).toContain('88');
    expect(res.body.data.mySubmission.teacherComment).toBeNull();
  });

  it('5. GET grades → total 2；学A 按时 88 + submissionId/textContent/files 增补；学B 迟交 null files 空；stats 口径正确', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/homeworks/${hwId}/grades`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.total).toBe(2);
    const rowA = data.list.find((r: { userId: number }) => r.userId === sIdA);
    const rowB = data.list.find((r: { userId: number }) => r.userId === sIdB);
    expect(rowA.state).toBe('按时');
    expect(rowA.score).toBe(88);
    expect(rowA.submissionId).toBe(subAId);
    expect(rowA.textContent).toBe('按时作答');
    expect(rowA.files).toEqual([
      { id: fileAId, originalName: '作品图.jpg', mimeType: 'image/jpeg', sizeBytes: 1234 },
    ]);
    expect(rowB.state).toBe('迟交');
    expect(rowB.score).toBeNull();
    expect(rowB.submissionId).not.toBeNull();
    expect(rowB.textContent).toBe('迟交作答');
    expect(rowB.files).toEqual([]);
    expect(data.stats).toEqual({ submitted: 2, graded: 1, late: 1, unsubmitted: 0 });
  });

  it('6. GET grades?export=csv → text/csv；BOM 首字符；行含 按时,88.00, 与 迟交,,（CRLF）', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/homeworks/${hwId}/grades?export=csv`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('按时,88.00,');
    expect(res.text).toContain('迟交,,');
    expect(res.text).toContain('\r\n');
  });

  it('7. 非本班教师 B GET grades → 403；管理员 → 200（只读）', async () => {
    const tB = await request(app.getHttpServer())
      .get(`/api/homeworks/${hwId}/grades`)
      .set('Authorization', `Bearer ${teacherBToken}`);
    expect(tB.status).toBe(403);
    const adm = await request(app.getHttpServer())
      .get(`/api/homeworks/${hwId}/grades`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adm.status).toBe(200);
    expect(adm.body.data.total).toBe(2);
  });
});
