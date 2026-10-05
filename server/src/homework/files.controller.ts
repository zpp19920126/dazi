// server/src/homework/files.controller.ts
import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { SubmissionsService } from './submissions.service.js';

@Controller()
export class FilesController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get('files/:id/download')
  @Roles('admin', 'teacher', 'student')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
    @Res() res: Response,
  ) {
    const { absolutePath, originalName } = await this.submissions.getForDownload(id, user);
    const fallback = basename(originalName).replace(/[^\x20-\x7e]/g, '_') || 'file';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
    );
    createReadStream(absolutePath).pipe(res);
  }
}
