import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('认证模块 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  const testUsernames = ['test_disabled_1', 'test_student_1', 'test_cp_1'];

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.user.deleteMany({ where: { username: { in: testUsernames } } });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: testUsernames } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('1. admin/admin123 登录成功，返回 token 与用户信息（含 mustChangePassword）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.length).toBeGreaterThan(0);
    expect(res.body.data.user.role).toBe('admin');
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });

  it('2. 密码错误 → 401 账号或密码错误', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('账号或密码错误');
  });

  it('3. 停用账号登录 → 401 账号已停用', async () => {
    await prisma.user.create({
      data: {
        username: 'test_disabled_1',
        passwordHash: await bcrypt.hash('pass1234', 10),
        realName: '停用用户',
        role: 'student',
        status: 'disabled',
      },
    });
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'test_disabled_1', password: 'pass1234' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('账号已停用');
  });

  it('4. 不带 token 访问 /api/admin-only → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/admin-only');
    expect(res.status).toBe(401);
  });

  it('5. student token 访问 /api/admin-only → 403', async () => {
    await prisma.user.create({
      data: {
        username: 'test_student_1',
        passwordHash: await bcrypt.hash('pass1234', 10),
        realName: '测试学生',
        role: 'student',
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'test_student_1', password: 'pass1234' });
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;
    const res = await request(app.getHttpServer())
      .get('/api/admin-only')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('6. change-password：旧密码错 400；改密后旧密码 401、新密码 200 且 mustChangePassword=false', async () => {
    await prisma.user.create({
      data: {
        username: 'test_cp_1',
        passwordHash: await bcrypt.hash('oldpass123', 10),
        realName: '改密用户',
        role: 'student',
        mustChangePassword: true,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'test_cp_1', password: 'oldpass123' });
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;

    // 旧密码错误 → 400
    const bad = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: 'wrong-old', newPassword: 'newpass456' });
    expect(bad.status).toBe(400);

    // 正确改密 → 200
    const ok = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: 'oldpass123', newPassword: 'newpass456' });
    expect(ok.status).toBe(200);
    expect(ok.body.code).toBe(0);

    // 旧密码登录 → 401
    const oldLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'test_cp_1', password: 'oldpass123' });
    expect(oldLogin.status).toBe(401);

    // 新密码登录 → 200 且 mustChangePassword=false
    const newLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'test_cp_1', password: 'newpass456' });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.data.user.mustChangePassword).toBe(false);
  });
});
