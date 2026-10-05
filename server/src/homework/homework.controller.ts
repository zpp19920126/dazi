import { Body, Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateHomeworkDto } from './dto/create-homework.dto.js';
import { CreateSubmissionDto } from './dto/create-submission.dto.js';
import { GradeSubmissionDto } from './dto/grade-submission.dto.js';
import { UpdateHomeworkDto } from './dto/update-homework.dto.js';
import { HomeworkService } from './homework.service.js';
import { MAX_FILES, MulterFileInfo } from './homework.constants.js';
import { SubmissionsService } from './submissions.service.js';

@Controller()
export class HomeworkController {
  constructor(
    private readonly homeworkService: HomeworkService,
    private readonly submissions: SubmissionsService,
  ) {}

  @Post('homeworks')
  @HttpCode(HttpStatus.OK)
  @Roles('teacher')
  create(@Body() dto: CreateHomeworkDto, @CurrentUser() user: { id: number; role: string }) {
    return this.homeworkService.create(dto, user);
  }

  @Patch('homeworks/:id')
  @Roles('teacher')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHomeworkDto,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.homeworkService.update(id, dto, user);
  }

  @Get('homeworks')
  @Roles('teacher', 'admin', 'student')
  list(
    @CurrentUser() user: { id: number; role: string },
    @Query('classId') classId?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize = 20,
  ) {
    return this.homeworkService.list(user, {
      classId: classId ? Number(classId) : undefined,
      status,
      page,
      pageSize,
    });
  }

  @Get('homeworks/:id')
  @Roles('teacher', 'admin', 'student')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number; role: string }) {
    return this.homeworkService.detail(id, user);
  }

  @Post('homeworks/:id/submissions')
  @HttpCode(HttpStatus.OK)
  @Roles('student')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES + 7, { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  submit(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
    @Body() dto: CreateSubmissionDto,
    @UploadedFiles() files?: MulterFileInfo[],
  ) {
    return this.submissions.submit(id, dto, files ?? [], user);
  }

  @Patch('homework/submissions/:id/grade')
  @HttpCode(HttpStatus.OK)
  @Roles('teacher')
  grade(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
    @Body() dto: GradeSubmissionDto,
  ) {
    return this.homeworkService.grade(id, dto, user);
  }

  @Get('homeworks/:id/grades')
  @Roles('admin', 'teacher')
  async grades(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
    @Query('export') exportCsv: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Res() res: Response,
  ) {
    const result = await this.homeworkService.grades(id, user, { exportCsv, page, pageSize });
    // @Res() 接管后 TransformInterceptor 不生效，需手动保持统一响应格式
    if (typeof result === 'string') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(result);
      return;
    }
    res.json({ code: 0, message: 'ok', data: result });
  }
}
