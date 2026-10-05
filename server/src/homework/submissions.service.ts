// server/src/homework/submissions.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ALLOWED_EXT,
  MAX_FILE_BYTES,
  MAX_FILES,
  MulterFileInfo,
  ensureDirs,
  extOf,
  stagingDir,
  uploadRoot,
} from './homework.constants.js';
import type { CreateSubmissionDto } from './dto/create-submission.dto.js';

interface Staged {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  stagingPath: string;
  finalRel: string; // 相对 uploadRoot 的正式路径
}

@Injectable()
export class SubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

  private validateFiles(files: MulterFileInfo[], allowAttachment: boolean): void {
    if (files.length === 0) return;
    if (!allowAttachment) {
      throw new BadRequestException('该作业不允许提交附件');
    }
    if (files.length > MAX_FILES) {
      throw new BadRequestException(`最多上传 ${MAX_FILES} 个附件`);
    }
    for (const f of files) {
      const ext = extOf(f.originalname);
      if (!ALLOWED_EXT.includes(ext)) {
        throw new UnsupportedMediaTypeException(`不支持的文件类型：${f.originalname}`);
      }
      if (f.size > MAX_FILE_BYTES) {
        throw new PayloadTooLargeException(`单文件不能超过 10MB：${f.originalname}`);
      }
    }
  }

  async submit(
    homeworkId: number,
    dto: CreateSubmissionDto,
    files: MulterFileInfo[],
    actor: { id: number; role: string },
  ): Promise<{ id: number; homeworkId: number; submittedAt: Date; isLate: boolean }> {
    if (actor.role !== 'student') throw new ForbiddenException('仅学生可提交作业');
    const student = await this.prisma.user.findUnique({ where: { id: actor.id } });
    const hw = await this.prisma.homework.findUnique({ where: { id: homeworkId } });
    if (!hw) throw new NotFoundException('作业不存在');
    if (!student || student.classId !== hw.classId) {
      throw new ForbiddenException('无权提交该作业的班级作业');
    }
    this.validateFiles(files, hw.allowAttachment);

    ensureDirs();
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 1) 缓冲 → staging 落盘
    const staged: Staged[] = [];
    for (const f of files) {
      const originalName = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const ext = extOf(originalName) || 'bin';
      const finalRel = join('homework', month, `${randomUUID()}.${ext}`);
      const stagingPath = join(stagingDir(), `${randomUUID()}.${ext}`);
      await writeFile(stagingPath, f.buffer);
      staged.push({
        originalName,
        mimeType: f.mimetype,
        sizeBytes: f.size,
        stagingPath,
        finalRel,
      });
    }

    // 2) DB 事务：覆盖旧提交（删旧附件行 + 删旧提交行 → 插新）
    let committedId = 0;
    let oldFileKeys: string[] = [];
    try {
      const submission = await this.prisma.$transaction(async (tx) => {
        const old = await tx.homeworkSubmission.findUnique({
          where: { homeworkId_userId: { homeworkId, userId: student.id } },
          include: { files: { select: { storedKey: true } } },
        });
        if (old) {
          oldFileKeys = old.files.map((x) => x.storedKey);
          await tx.homeworkFile.deleteMany({ where: { submissionId: old.id } });
          await tx.homeworkSubmission.delete({ where: { id: old.id } });
        }
        const created = await tx.homeworkSubmission.create({
          data: {
            homeworkId,
            userId: student.id,
            textContent: dto.textContent,
            submittedAt: now,
            isLate: now > hw.dueAt,
          },
        });
        if (staged.length) {
          await tx.homeworkFile.createMany({
            data: staged.map((s) => ({
              submissionId: created.id,
              originalName: s.originalName,
              storedKey: s.finalRel,
              mimeType: s.mimeType,
              sizeBytes: s.sizeBytes,
            })),
          });
        }
        return created;
      });
      committedId = submission.id;

      // 3) staging → 正式目录 rename；旧文件尽力删除
      for (const s of staged) {
        const absFinal = join(uploadRoot(), s.finalRel);
        await mkdir(dirname(absFinal), { recursive: true });
        await rename(s.stagingPath, absFinal);
      }
      for (const key of oldFileKeys) {
        await unlink(join(uploadRoot(), key)).catch(() => undefined);
      }
      return {
        id: submission.id,
        homeworkId,
        submittedAt: submission.submittedAt,
        isLate: submission.isLate,
      };
    } catch (e) {
      // 补偿：删 DB 行 + 清 staging/正式残留，再原样抛出
      if (committedId) {
        await this.prisma.homeworkFile
          .deleteMany({ where: { submissionId: committedId } })
          .catch(() => undefined);
        await this.prisma.homeworkSubmission
          .delete({ where: { id: committedId } })
          .catch(() => undefined);
      }
      for (const s of staged) {
        await unlink(s.stagingPath).catch(() => undefined);
        await unlink(join(uploadRoot(), s.finalRel)).catch(() => undefined);
      }
      throw e;
    }
  }

  async getForDownload(
    fileId: number,
    actor: { id: number; role: string },
  ): Promise<{ absolutePath: string; originalName: string }> {
    const file = await this.prisma.homeworkFile.findUnique({
      where: { id: fileId },
      include: {
        submission: {
          include: { homework: { select: { createdBy: true } } },
        },
      },
    });
    if (!file) throw new NotFoundException('文件不存在');
    const owner = actor.role === 'admin'
      || file.submission.userId === actor.id
      || file.submission.homework.createdBy === actor.id;
    if (!owner) throw new ForbiddenException('无权下载该附件');
    const abs = join(uploadRoot(), file.storedKey);
    // 防穿越：resolve 后必须仍在 uploadRoot 内
    if (!resolve(abs).startsWith(resolve(uploadRoot()) + sep)) {
      throw new ForbiddenException('非法文件路径');
    }
    if (!existsSync(abs)) throw new NotFoundException('文件已丢失');
    return { absolutePath: abs, originalName: file.originalName };
  }
}
