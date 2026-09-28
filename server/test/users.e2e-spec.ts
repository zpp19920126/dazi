import 'dotenv/config';
import type { Server } from 'http';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module.js';

describe('users 模块 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  const createdUsernames: string[] = [];
  const createdClassIds: number[] = [];
  const suffix = String(Date.now()).slice(-6);

  // 教师 A 经 API 创建（Task 3 中），记录初始密码并缓存完成强改密后的 token
  let teacherAUser: { id: number; username: string };
  let teacherAInitPw = '';
  let teacherAToken = '';

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
  });

  afterAll(async () => {
    await prisma.user.update({
      where: { username: 'admin' },
      data: { mustChangePassword: true },
    });
    // 删除顺序：摘除班级学生 → 删班级（class.teacher 外键 Restrict，须先于教师删除）→ 删其余用户
    await prisma.user.deleteMany({ where: { classId: { in: createdClassIds } } });
    await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
    await prisma.$disconnect();
    await app.close();
  });

  /** admin 经批量接口在指定班级创建 1 名学生并返回落库记录 */
  async function createStudentViaAdmin(classId: number, realName: string) {
    const res = await request(app.getHttpServer())
      .post('/api/users/students/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ classId, names: [realName] });
    expect(res.status).toBe(200);
    const { username } = res.body.data.created[0] as { username: string };
    createdUsernames.push(username);
    const user = await prisma.user.findUnique({ where: { username } });
    expect(user).toBeTruthy();
    return user!;
  }

  /** 教师A 登录并完成强制改密，返回可调用业务接口的 token（结果缓存） */
  async function getTeacherAToken() {
    if (teacherAToken) return teacherAToken;
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: teacherAUser.username, password: teacherAInitPw });
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;
    const change = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: teacherAInitPw, newPassword: 'TeacherNew123' });
    expect(change.status).toBe(200);
    teacherAToken = token;
    return token;
  }

  it('1. POST teachers 自动生成用户名连续递增，initialPassword 长度 8', async () => {
    const res1 = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `教师一${suffix}` });
    expect(res1.status).toBe(200);
    expect(res1.body.code).toBe(0);
    const user1 = res1.body.data.user;
    const pw1 = res1.body.data.initialPassword as string;
    expect(user1.username).toMatch(/^t\d{3}$/);
    expect(pw1).toHaveLength(8);
    expect(user1.role).toBe('teacher');
    expect(user1.mustChangePassword).toBe(true);
    createdUsernames.push(user1.username);

    const res2 = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `教师二${suffix}` });
    expect(res2.status).toBe(200);
    const user2 = res2.body.data.user;
    expect(user2.username).toMatch(/^t\d{3}$/);
    expect(Number(user2.username.slice(1))).toBe(Number(user1.username.slice(1)) + 1);
    createdUsernames.push(user2.username);
  });

  it('2. POST teachers 手动指定已存在 username → 409', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `重复教师${suffix}`, username: createdUsernames[0] });
    expect(res.status).toBe(409);
  });

  it('3. batch 3 个学生 → created 长度 3、classId 正确、每行密码独立、用户名 s 序列递增', async () => {
    // 两名教师走 API 创建（拿到真实初始密码），班级因 Task 7 未实现直接落库
    const tA = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `教师A${suffix}` });
    expect(tA.status).toBe(200);
    teacherAUser = tA.body.data.user;
    teacherAInitPw = tA.body.data.initialPassword as string;
    createdUsernames.push(teacherAUser.username);

    const tB = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `教师B${suffix}` });
    expect(tB.status).toBe(200);
    const teacherBUser = tB.body.data.user;
    createdUsernames.push(teacherBUser.username);

    const classA = await prisma.class.create({
      data: { name: `一班${suffix}`, teacherId: teacherAUser.id },
    });
    const classB = await prisma.class.create({
      data: { name: `二班${suffix}`, teacherId: teacherBUser.id },
    });
    createdClassIds.push(classA.id, classB.id);

    const res = await request(app.getHttpServer())
      .post('/api/users/students/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ classId: classA.id, names: ['张小一', '张小二', '张小三'] });
    expect(res.status).toBe(200);
    const created = res.body.data.created as Array<{
      username: string;
      realName: string;
      initialPassword: string;
    }>;
    expect(created).toHaveLength(3);
    expect(res.body.data.usernameStart).toBe(created[0].username);
    for (const item of created) {
      expect(item.username).toMatch(/^s\d{3}$/);
      expect(item.initialPassword).toHaveLength(8);
      const dbUser = await prisma.user.findUnique({ where: { username: item.username } });
      expect(dbUser?.classId).toBe(classA.id);
      expect(dbUser?.role).toBe('student');
      createdUsernames.push(item.username);
    }
    expect(new Set(created.map((c) => c.initialPassword)).size).toBe(3);
    const seqs = created.map((c) => Number(c.username.slice(1)));
    expect(seqs[1]).toBe(seqs[0] + 1);
    expect(seqs[2]).toBe(seqs[1] + 1);
  });

  it('4. 教师查 students 携带他人 classId → 403', async () => {
    const token = await getTeacherAToken();
    const classB = await prisma.class.findFirst({ where: { name: `二班${suffix}` } });
    const res = await request(app.getHttpServer())
      .get(`/api/users/students?classId=${classB!.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('4b. 教师查自己班学生 → 返回 3 名', async () => {
    const token = await getTeacherAToken();
    const classA = await prisma.class.findFirst({ where: { name: `一班${suffix}` } });
    const res = await request(app.getHttpServer())
      .get(`/api/users/students?classId=${classA!.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.list).toHaveLength(3);
  });

  it('4c. 学生列表下发 initialPassword；重置密码后更新；学生改密后清除为 null', async () => {
    const token = await getTeacherAToken();
    const classA = await prisma.class.findFirst({ where: { name: `一班${suffix}` } });
    const getStudents = async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/users/students?classId=${classA!.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return res.body.data.list as Array<{
        id: number;
        username: string;
        realName: string;
        initialPassword: string | null;
      }>;
    };

    // 1) 批量生成后，列表下发与 batch 响应一致的初始密码
    const rows1 = await getStudents();
    for (const r of rows1) {
      expect(r.initialPassword).toHaveLength(8);
    }

    // 2) 重置密码后，列表下发重置值
    const student = rows1.find((r) => r.realName === '张小三')!;
    const reset = await request(app.getHttpServer())
      .patch(`/api/users/${student.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reset-password', initialPassword: 'studReset99' });
    expect(reset.status).toBe(200);
    const row2 = (await getStudents()).find((r) => r.id === student.id)!;
    expect(row2.initialPassword).toBe('studReset99');

    // 3) 学生完成改密后，初始密码清除为 null
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: student.username, password: 'studReset99' });
    expect(login.status).toBe(200);
    const change = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.data.token}`)
      .send({ oldPassword: 'studReset99', newPassword: 'studNew45678' });
    expect(change.status).toBe(200);
    const row3 = (await getStudents()).find((r) => r.id === student.id)!;
    expect(row3.initialPassword).toBeNull();
  });

  it('5. PATCH disable 后正确密码登录 → 401 账号已停用；enable 恢复登录', async () => {
    const student = await prisma.user.findFirst({
      where: { realName: '张小二', role: 'student' },
      orderBy: { id: 'desc' },
    });
    expect(student).toBeTruthy();
    // 重置为已知密码（重置后 mustChangePassword=true，不影响登录本身）
    const reset = await request(app.getHttpServer())
      .patch(`/api/users/${student!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reset-password', initialPassword: 'studPass12' });
    expect(reset.status).toBe(200);

    const disable = await request(app.getHttpServer())
      .patch(`/api/users/${student!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'disable' });
    expect(disable.status).toBe(200);

    const disabledLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: student!.username, password: 'studPass12' });
    expect(disabledLogin.status).toBe(401);
    expect(disabledLogin.body.message).toBe('账号已停用');

    const enable = await request(app.getHttpServer())
      .patch(`/api/users/${student!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'enable' });
    expect(enable.status).toBe(200);
    const okLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: student!.username, password: 'studPass12' });
    expect(okLogin.status).toBe(200);
  });

  it('6. delete 有关联班级的教师 → 409；无关联 → 200 且记录消失', async () => {
    const delA = await request(app.getHttpServer())
      .patch(`/api/users/${teacherAUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'delete' });
    expect(delA.status).toBe(409);

    const tmp = await request(app.getHttpServer())
      .post('/api/users/teachers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: `无班级教师${suffix}` });
    const tmpUser = tmp.body.data.user;
    createdUsernames.push(tmpUser.username);
    const delB = await request(app.getHttpServer())
      .patch(`/api/users/${tmpUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'delete' });
    expect(delB.status).toBe(200);
    const gone = await prisma.user.findUnique({ where: { id: tmpUser.id } });
    expect(gone).toBeNull();
  });

  it('7. 教师改学生姓名与停用/启用 → 200 且列表生效；admin 同接口可用', async () => {
    const token = await getTeacherAToken();
    const classA = await prisma.class.findFirst({ where: { name: `一班${suffix}` } });
    const listRes = await request(app.getHttpServer())
      .get(`/api/users/students?classId=${classA!.id}`)
      .set('Authorization', `Bearer ${token}`);
    const student = (listRes.body.data.list as Array<{ id: number; realName: string }>).find(
      (r) => r.realName === '张小一',
    )!;

    // 改姓名
    const rename = await request(app.getHttpServer())
      .patch(`/api/users/students/${student.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ realName: '张小一改' });
    expect(rename.status).toBe(200);

    // 停用 → 列表 status 变 disabled
    const disable = await request(app.getHttpServer())
      .patch(`/api/users/students/${student.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'disabled' });
    expect(disable.status).toBe(200);
    const rows = await request(app.getHttpServer())
      .get(`/api/users/students?classId=${classA!.id}`)
      .set('Authorization', `Bearer ${token}`);
    const row = (
      rows.body.data.list as Array<{ id: number; realName: string; status: string }>
    ).find((r) => r.id === student.id)!;
    expect(row.realName).toBe('张小一改');
    expect(row.status).toBe('disabled');

    // 启用恢复
    const enable = await request(app.getHttpServer())
      .patch(`/api/users/students/${student.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });
    expect(enable.status).toBe(200);

    // admin 走同一接口也可修改
    const adminRename = await request(app.getHttpServer())
      .patch(`/api/users/students/${student.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ realName: '张小一' });
    expect(adminRename.status).toBe(200);
  });

  it('8. 教师改/删他人班级学生 → 403；目标不存在 → 404', async () => {
    const token = await getTeacherAToken();
    const classB = await prisma.class.findFirst({ where: { name: `二班${suffix}` } });
    const other = await createStudentViaAdmin(classB!.id, '别班学生');

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/users/students/${other.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ realName: '越权改名' });
    expect(patchRes.status).toBe(403);

    const delRes = await request(app.getHttpServer())
      .delete(`/api/users/students/${other.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(403);

    const patchMissing = await request(app.getHttpServer())
      .patch('/api/users/students/99999999')
      .set('Authorization', `Bearer ${token}`)
      .send({ realName: '不存在' });
    expect(patchMissing.status).toBe(404);

    const delMissing = await request(app.getHttpServer())
      .delete('/api/users/students/99999999')
      .set('Authorization', `Bearer ${token}`);
    expect(delMissing.status).toBe(404);
  });

  it('9. 教师删除有关联数据的学生 → 200 且 user/records/heartbeat 级联清除', async () => {
    const token = await getTeacherAToken();
    const classA = await prisma.class.findFirst({ where: { name: `一班${suffix}` } });
    const student = await createStudentViaAdmin(classA!.id, '删我一');

    // 造关联数据：一条打字记录 + 一条心跳
    await prisma.record.create({
      data: {
        userId: student.id,
        mode: 'article',
        speed: '30.50',
        accuracy: '95.50',
        totalChars: 100,
        correctChars: 95,
        backspaceCount: 5,
        durationSeconds: 60,
      },
    });
    await prisma.heartbeat.create({
      data: {
        userId: student.id,
        status: 'typing',
        speed: '30.50',
        accuracy: '95.50',
        progress: '50.00',
        elapsedSeconds: 30,
        charIndex: 50,
      },
    });

    const del = await request(app.getHttpServer())
      .delete(`/api/users/students/${student.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.code).toBe(0);

    expect(await prisma.user.findUnique({ where: { id: student.id } })).toBeNull();
    expect(await prisma.record.findFirst({ where: { userId: student.id } })).toBeNull();
    expect(await prisma.heartbeat.findUnique({ where: { userId: student.id } })).toBeNull();
  });

  it('10. 教师批量删除本班 2 名学生 → 200 { deleted: 2 } 且记录消失', async () => {
    const token = await getTeacherAToken();
    const classA = await prisma.class.findFirst({ where: { name: `一班${suffix}` } });
    const s1 = await createStudentViaAdmin(classA!.id, '删我二');
    const s2 = await createStudentViaAdmin(classA!.id, '删我三');

    const res = await request(app.getHttpServer())
      .post('/api/users/students/batch-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [s1.id, s2.id] });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.deleted).toBe(2);

    expect(await prisma.user.findUnique({ where: { id: s1.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: s2.id } })).toBeNull();
  });

  it('11. 批量删除混入越权 id → 403 且一个都不删', async () => {
    const token = await getTeacherAToken();
    const classA = await prisma.class.findFirst({ where: { name: `一班${suffix}` } });
    const classB = await prisma.class.findFirst({ where: { name: `二班${suffix}` } });
    const mine = await createStudentViaAdmin(classA!.id, '删我四');
    const others = await createStudentViaAdmin(classB!.id, '别班学生二');

    const res = await request(app.getHttpServer())
      .post('/api/users/students/batch-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [mine.id, others.id] });
    expect(res.status).toBe(403);

    // 原子性：越权时全部保留
    expect(await prisma.user.findUnique({ where: { id: mine.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: others.id } })).not.toBeNull();
  });
});
