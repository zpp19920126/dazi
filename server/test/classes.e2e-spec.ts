import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('classes 模块 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  const createdUsernames: string[] = [];
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
      .send({ realName: `班级教师A${suffix}` });
    expect(tA.status).toBe(200);
    teacherAUser = tA.body.data.user;
    teacherAInitPw = tA.body.data.initialPassword as string;
    createdUsernames.push(teacherAUser.username);

    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `班级教师B${suffix}` });
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
    // 清理顺序：任务/学生先于班级，班级先于教师（外键 Restrict）
    await prisma.task.deleteMany({ where: { classId: { in: createdClassIds } } });
    await prisma.text.deleteMany({ where: { title: { startsWith: `班任务文章${suffix}` } } });
    await prisma.user.deleteMany({ where: { classId: { in: createdClassIds } } });
    await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('1. 教师创建班级 → studentCount=0，GET 列表含该班级', async () => {
    const token = await getTeacherToken(teacherAUser, teacherAInitPw);
    const create = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `三(1)班${suffix}` });
    expect(create.status).toBe(200);
    expect(create.body.code).toBe(0);
    const klass = create.body.data;
    expect(klass.name).toBe(`三(1)班${suffix}`);
    expect(klass.studentCount).toBe(0);
    createdClassIds.push(klass.id);

    const list = await request(app.getHttpServer())
      .get('/api/classes')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const found = list.body.data.list.find((c: { id: number }) => c.id === klass.id);
    expect(found).toBeTruthy();
    expect(found.studentCount).toBe(0);
  });

  it('2. PATCH 重命名班级 → 列表中名称更新', async () => {
    const token = await getTeacherToken(teacherAUser, teacherAInitPw);
    const classId = createdClassIds[0];
    const rename = await request(app.getHttpServer())
      .patch(`/api/classes/${classId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `三(2)班${suffix}` });
    expect(rename.status).toBe(200);
    expect(rename.body.data.name).toBe(`三(2)班${suffix}`);

    const list = await request(app.getHttpServer())
      .get('/api/classes')
      .set('Authorization', `Bearer ${token}`);
    const found = list.body.data.list.find((c: { id: number }) => c.id === classId);
    expect(found.name).toBe(`三(2)班${suffix}`);
  });

  it('3. 班内有学生 → DELETE 409 班级内尚有学生；移除学生后删除成功', async () => {
    const token = await getTeacherToken(teacherAUser, teacherAInitPw);
    const classId = createdClassIds[0];
    const student = await prisma.user.create({
      data: {
        username: `cls${suffix}`,
        passwordHash: 'x'.repeat(60),
        realName: `班级学生${suffix}`,
        role: 'student',
        classId,
      },
    });
    createdUsernames.push(student.username);

    const del = await request(app.getHttpServer())
      .delete(`/api/classes/${classId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(409);
    expect(del.body.message).toBe('班级内尚有学生');

    await prisma.user.delete({ where: { id: student.id } });
    createdUsernames.pop();
    const delAgain = await request(app.getHttpServer())
      .delete(`/api/classes/${classId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delAgain.status).toBe(200);
    const idx = createdClassIds.indexOf(classId);
    if (idx >= 0) createdClassIds.splice(idx, 1);
    const gone = await prisma.class.findUnique({ where: { id: classId } });
    expect(gone).toBeNull();
  });

  it('4. 教师B 删除教师A 的班级 → 403', async () => {
    const tokenA = await getTeacherToken(teacherAUser, teacherAInitPw);
    const tokenB = await getTeacherToken(teacherBUser, teacherBInitPw);
    const create = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: `A的班${suffix}` });
    expect(create.status).toBe(200);
    const classId = create.body.data.id as number;
    createdClassIds.push(classId);

    const del = await request(app.getHttpServer())
      .delete(`/api/classes/${classId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(del.status).toBe(403);
  });

  it('5. 班级含任务 → DELETE 409 班级内尚有任务', async () => {
    const token = await getTeacherToken(teacherAUser, teacherAInitPw);
    const create = await request(app.getHttpServer())
      .post('/api/classes')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `带任务的班${suffix}` });
    expect(create.status).toBe(200);
    const classId = create.body.data.id as number;
    createdClassIds.push(classId);

    const text = await prisma.text.create({
      data: {
        title: `班任务文章${suffix}`,
        language: 'zh',
        difficulty: 1,
        content: '春眠不觉晓',
        charCount: 6,
        createdBy: null,
      },
    });
    await prisma.task.create({
      data: {
        classId,
        textId: text.id,
        title: `班级任务${suffix}`,
        mode: 'article',
        minSpeed: 10,
        minAccuracy: 90,
        deadline: new Date(Date.now() + 86400_000),
        createdBy: teacherAUser.id,
      },
    });

    const del = await request(app.getHttpServer())
      .delete(`/api/classes/${classId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(409);
    expect(del.body.message).toBe('班级内尚有任务');
  });
});
