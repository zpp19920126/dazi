import 'dotenv/config';
import type { Server } from 'http';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('homework-upload 作业提交附件 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  const createdUsernames: string[] = [];
  const suffix = 'hwup';

  let teacherToken = '';
  let teacherBToken = '';
  let sCToken = '';
  let sCId = 0;
  let classAId = 0;
  let classBId = 0;
  let hwId = 0;
  let fileAId = 0;
  const firstRoundKeys: string[] = [];

  const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

  const pdf = (name: string, bytes = 1024) => ({
    name,
    payload: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes, 7)]),
    contentType: 'application/pdf',
  });

  type Attachment = ReturnType<typeof pdf>;

  const submitReq = (
    token: string,
    homeworkId: number,
    textContent: string,
    files: Attachment[] = [],
  ) => {
    let req = request(app.getHttpServer())
      .post(`/api/homeworks/${homeworkId}/submissions`)
      .set('Authorization', `Bearer ${token}`)
      .field('textContent', textContent);
    for (const f of files) {
      req = req.attach('files', f.payload, { filename: f.name, contentType: f.contentType });
    }
    return req;
  };

  const stagingFiles = () => readdirSync(join(process.env.UPLOAD_DIR!, 'staging'));

  beforeAll(async () => {
    process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'hw-up-'));
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
      .send({ realName: `附件作业教师A${suffix}` });
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
      .send({ name: `附件作业班${suffix}` });
    classAId = classA.body.data.id;

    // 教师B（他人班级，供用例 7 的非本班学生 sD 挂载）
    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `附件作业教师B${suffix}` });
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
      .send({ name: `附件他班${suffix}` });
    classBId = classB.body.data.id;

    // 学生 sC（免改密）
    const sCUsername = `sm${suffix}c`;
    const created = await prisma.user.create({
      data: {
        username: sCUsername,
        passwordHash: bcrypt.hashSync('studPass12', 10),
        realName: `附件作业学生${suffix}`,
        role: 'student',
        classId: classAId,
        mustChangePassword: false,
      },
    });
    createdUsernames.push(sCUsername);
    sCId = created.id;
    const sLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: sCUsername, password: 'studPass12' });
    sCToken = sLogin.body.data.token as string;

    // 教师 A 创建允许附件的作业（未来 3 小时截止）
    const hw = await request(app.getHttpServer())
      .post('/api/homeworks')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        classId: classAId,
        title: '附件作业',
        content: '提交文本与附件',
        dueAt: future(3),
        allowAttachment: true,
      });
    hwId = hw.body.data.id;
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
    rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true });
  });

  it('1. 学生首次提交（文本+2个PDF附件）→ 200，isLate=false，正式目录落盘且 staging 无残留', async () => {
    const f1 = pdf('answer1.pdf');
    const f2 = pdf('answer2.pdf');
    const res = await submitReq(sCToken, hwId, '我的答案', [f1, f2]);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.id).toBeDefined();
    expect(data.homeworkId).toBe(hwId);
    expect(data.submittedAt).toBeDefined();
    expect(data.isLate).toBe(false);

    const files = await prisma.homeworkFile.findMany({ where: { submissionId: data.id } });
    expect(files).toHaveLength(2);
    const sub = await prisma.homeworkSubmission.findUnique({ where: { id: data.id } });
    expect(sub?.userId).toBe(sCId);
    for (const f of files) {
      expect(f.storedKey).toMatch(/^homework\/\d{4}-\d{2}\/[0-9a-f-]+\.pdf$/);
      expect(existsSync(join(process.env.UPLOAD_DIR!, f.storedKey))).toBe(true);
    }
    firstRoundKeys.push(...files.map((f) => f.storedKey));
    expect(stagingFiles()).toEqual([]);
  });

  it('2. 重交覆盖：提交新文本+1个附件 → 200；提交仍 1 条、附件仅剩 1；旧附件磁盘文件已删除', async () => {
    const f = pdf('redo.pdf');
    const res = await submitReq(sCToken, hwId, '覆盖答案', [f]);
    expect(res.status).toBe(200);
    expect(await prisma.homeworkSubmission.count({ where: { homeworkId: hwId } })).toBe(1);
    const files = await prisma.homeworkFile.findMany({ where: { submissionId: res.body.data.id } });
    expect(files).toHaveLength(1);
    for (const key of firstRoundKeys) {
      expect(existsSync(join(process.env.UPLOAD_DIR!, key))).toBe(false);
    }
    expect(stagingFiles()).toEqual([]);
  });

  it('3. 类型白名单：.exe 附件 → 415「不支持的文件类型」；提交行数不变，staging 无残留', async () => {
    const bad = { name: 'tool.exe', payload: Buffer.alloc(1024, 1), contentType: 'application/octet-stream' };
    const res = await submitReq(sCToken, hwId, '恶意附件', [bad]);
    expect(res.status).toBe(415);
    expect(res.body.message).toContain('不支持的文件类型');
    expect(await prisma.homeworkSubmission.count({ where: { homeworkId: hwId } })).toBe(1);
    expect(stagingFiles()).toEqual([]);
  });

  it('4. 大小限制：11MB 合法扩展名附件 → 413「单文件不能超过 10MB」', async () => {
    const big = pdf('big.pdf', 11 * 1024 * 1024);
    const res = await submitReq(sCToken, hwId, '超大附件', [big]);
    expect(res.status).toBe(413);
    expect(res.body.message).toContain('单文件不能超过 10MB');
    expect(stagingFiles()).toEqual([]);
  });

  it('5. 数量：10 个附件 → 200（多图上限）；11 个 → 400「最多上传 10 个附件」，无新增落库残留、staging 清空', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => pdf(`f${i + 1}.pdf`));
    const ok = await submitReq(sCToken, hwId, '十个附件', ten);
    expect(ok.status).toBe(200);
    expect(await prisma.homeworkFile.count({ where: { submission: { homeworkId: hwId } } })).toBe(10);

    const eleven = Array.from({ length: 11 }, (_, i) => pdf(`g${i + 1}.pdf`));
    const res = await submitReq(sCToken, hwId, '十一个附件', eleven);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('最多上传 10 个附件');
    // 失败提交不落库：仍是刚才那 10 个附件的那一条提交
    expect(await prisma.homeworkSubmission.count({ where: { homeworkId: hwId } })).toBe(1);
    expect(await prisma.homeworkFile.count({ where: { submission: { homeworkId: hwId } } })).toBe(10);
    expect(stagingFiles()).toEqual([]);
  });

  it('6. 纯文本提交 → 200；textContent 空字符串 → 400', async () => {
    const res = await submitReq(sCToken, hwId, '只交文字');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBeDefined();
    const bad = await submitReq(sCToken, hwId, '');
    expect(bad.status).toBe(400);
  });

  it('7. 非本班学生提交 → 403；不允许附件的作业 attach → 400', async () => {
    // 他班学生 sD（教师 B 的 classB）
    const sDUsername = `sm${suffix}d`;
    await prisma.user.create({
      data: {
        username: sDUsername,
        passwordHash: bcrypt.hashSync('studPass12', 10),
        realName: `附件他班学生${suffix}`,
        role: 'student',
        classId: classBId,
        mustChangePassword: false,
      },
    });
    createdUsernames.push(sDUsername);
    const dLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: sDUsername, password: 'studPass12' });
    const dToken = dLogin.body.data.token as string;

    const foreign = await submitReq(dToken, hwId, '外班学生提交');
    expect(foreign.status).toBe(403);

    // 不允许附件的作业
    const noAtt = await request(app.getHttpServer())
      .post('/api/homeworks')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        classId: classAId,
        title: '纯文本作业',
        content: '仅文本',
        dueAt: future(3),
        allowAttachment: false,
      });
    const noAttId = noAtt.body.data.id;
    const res = await submitReq(sCToken, noAttId, '带附件', [pdf('shot.pdf')]);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('该作业不允许提交附件');
    expect(stagingFiles()).toEqual([]);
  });

  it('8. 已过截止：dueAt 改为 1 小时前后再提交 → 200 且 isLate=true', async () => {
    await prisma.homework.update({ where: { id: hwId }, data: { dueAt: new Date(Date.now() - 3_600_000) } });
    const res = await submitReq(sCToken, hwId, '迟交答案', [pdf('late.pdf')]);
    expect(res.status).toBe(200);
    expect(res.body.data.isLate).toBe(true);
    expect(stagingFiles()).toEqual([]);
  });

  it('9. 教师列表 submissionCount 统计：该作业为 1', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/homeworks?classId=${classAId}&page=1&pageSize=20`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(200);
    const row = res.body.data.list.find((x: { id: number }) => x.id === hwId);
    expect(row).toBeDefined();
    expect(row.submissionCount).toBe(1);
  });

  it('10. 本人下载附件 → 200：Content-Disposition 含 UTF-8 中文文件名，响应体字节数与 sizeBytes 一致', async () => {
    const res = await submitReq(sCToken, hwId, '下载用提交', [pdf('答案.pdf')]);
    expect(res.status).toBe(200);
    const file = await prisma.homeworkFile.findFirst({
      where: { submissionId: res.body.data.id },
      orderBy: { id: 'asc' },
    });
    expect(file).not.toBeNull();
    fileAId = file!.id;
    const dl = await request(app.getHttpServer())
      .get(`/api/files/${fileAId}/download`)
      .set('Authorization', `Bearer ${sCToken}`)
      .buffer();
    expect(dl.status).toBe(200);
    const disposition = dl.headers['content-disposition'] ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('答案.pdf')}`);
    // ASCII 回退名：中文逐字符降级为 '_'，结果是不含引号/反斜杠的良构 token
    expect(disposition).toContain('filename="__.pdf"');
    expect(dl.body.length).toBe(file!.sizeBytes);
  });

  it('11. 布置教师与管理员下载同一文件 → 200', async () => {
    const t = await request(app.getHttpServer())
      .get(`/api/files/${fileAId}/download`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .buffer();
    expect(t.status).toBe(200);
    expect(t.headers['content-disposition']).toContain('filename*=UTF-8\'\'');
    const a = await request(app.getHttpServer())
      .get(`/api/files/${fileAId}/download`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer();
    expect(a.status).toBe(200);
  });

  it('12. 越权下载 → 403；不存在的文件 id → 404', async () => {
    // sD 为用例 7 创建的他班学生（classB），非提交者亦非布置者
    const dLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: `sm${suffix}d`, password: 'studPass12' });
    const dToken = dLogin.body.data.token as string;
    const forbidden = await request(app.getHttpServer())
      .get(`/api/files/${fileAId}/download`)
      .set('Authorization', `Bearer ${dToken}`)
      .buffer();
    expect(forbidden.status).toBe(403);
    const missing = await request(app.getHttpServer())
      .get('/api/files/99999999/download')
      .set('Authorization', `Bearer ${sCToken}`)
      .buffer();
    expect(missing.status).toBe(404);
  });
});
