import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { PatchTaskDto } from './dto/patch-task.dto.js';
import { TasksService } from './tasks.service.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @Roles('admin', 'teacher', 'student')
  listTasks(
    @CurrentUser() user: { id: number; role: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
  ) {
    return this.tasksService.listTasks(user, page, pageSize);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'teacher')
  createTask(@Body() dto: CreateTaskDto, @CurrentUser() user: { id: number; role: string }) {
    return this.tasksService.createTask(dto, user);
  }

  @Patch(':id')
  @Roles('admin', 'teacher')
  updateTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchTaskDto,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.tasksService.updateTask(id, dto, user);
  }
}
