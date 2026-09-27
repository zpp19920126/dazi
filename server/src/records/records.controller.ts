import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { SubmitRecordDto } from './dto/submit-record.dto.js';
import { RecordsService } from './records.service.js';

@Controller()
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Post('records')
  @HttpCode(HttpStatus.OK)
  @Roles('student')
  submit(@CurrentUser() user: { id: number }, @Body() dto: SubmitRecordDto) {
    return this.recordsService.submit(dto, user);
  }

  @Get('records/mine')
  @Roles('admin', 'teacher', 'student')
  mine(
    @CurrentUser() user: { id: number },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
  ) {
    return this.recordsService.listMine(user.id, page, pageSize);
  }

  @Get('tasks/:id/grades')
  @Roles('admin', 'teacher')
  async grades(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
    @Query('export') exportCsv: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
    @Res() res: Response,
  ) {
    const result = await this.recordsService.getGrades(id, user, { page, pageSize, exportCsv });
    // @Res() 接管后 TransformInterceptor 不生效，需手动保持统一响应格式
    if (typeof result === 'string') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(result);
      return;
    }
    res.json({ code: 0, message: 'ok', data: result });
  }
}
