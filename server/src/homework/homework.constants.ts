// server/src/homework/homework.constants.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** 惰性读取，便于 e2e 用 mkdtempSync 注入 UPLOAD_DIR */
export function uploadRoot(): string {
  return process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
}

export function stagingDir(): string {
  return join(uploadRoot(), 'staging');
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 单文件 10MB（业务限制，413）
export const MAX_FILES = 3; // 每次提交最多 3 个附件（400）
export const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx', 'zip'];

export function ensureDirs(): void {
  mkdirSync(stagingDir(), { recursive: true });
}

/** 取小写扩展名（不含点）；无扩展名返回空串 */
export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i < 0 ? '' : filename.slice(i + 1).toLowerCase();
}

export interface MulterFileInfo {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
