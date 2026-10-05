import { Body, Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateHomeworkDto } from './dto/create-homework.dto.js';
import { UpdateHomeworkDto } from './dto/update-homework.dto.js';
import { HomeworkService } from './homework.service.js';

@Controller()
export class HomeworkController {
  constructor(private readonly homeworkService: HomeworkService) {}

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
}
