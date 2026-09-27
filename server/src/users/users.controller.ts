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
import { BatchStudentsDto } from './dto/batch-students.dto.js';
import { CreateTeacherDto } from './dto/create-teacher.dto.js';
import { PatchUserDto } from './dto/patch-user.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('teachers')
  @Roles('admin')
  listTeachers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
    @Query('keyword') keyword?: string,
  ) {
    return this.usersService.listTeachers(page, pageSize, keyword);
  }

  @Post('teachers')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  createTeacher(@Body() dto: CreateTeacherDto, @CurrentUser() user: { id: number }) {
    return this.usersService.createTeacher(dto, user.id);
  }

  @Get('students')
  @Roles('admin', 'teacher')
  listStudents(
    @Query('classId', ParseIntPipe) classId: number,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.usersService.listStudents(classId, user);
  }

  @Post('students/batch')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'teacher')
  batchStudents(@Body() dto: BatchStudentsDto, @CurrentUser() user: { id: number; role: string }) {
    return this.usersService.batchStudents(dto, user);
  }

  @Patch(':id')
  @Roles('admin')
  patchUser(@Param('id', ParseIntPipe) id: number, @Body() dto: PatchUserDto) {
    return this.usersService.patchUser(id, dto);
  }
}
