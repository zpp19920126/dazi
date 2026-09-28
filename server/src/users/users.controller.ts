import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
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
import { BatchDeleteStudentsDto } from './dto/batch-delete-students.dto.js';
import { BatchStudentsDto } from './dto/batch-students.dto.js';
import { CreateTeacherDto } from './dto/create-teacher.dto.js';
import { PatchUserDto } from './dto/patch-user.dto.js';
import { UpdateStudentDto } from './dto/update-student.dto.js';
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

  // 注意：students/:id 与 students/batch-delete 必须声明在下方 @Patch(':id') 之前，避免被通配路由捕获
  @Patch('students/:id')
  @Roles('admin', 'teacher')
  updateStudent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.usersService.updateStudent(id, dto, user);
  }

  @Post('students/batch-delete')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'teacher')
  batchDeleteStudents(
    @Body() dto: BatchDeleteStudentsDto,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.usersService.batchDeleteStudents(dto, user);
  }

  @Delete('students/:id')
  @Roles('admin', 'teacher')
  deleteStudent(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.usersService.deleteStudent(id, user);
  }

  @Patch(':id')
  @Roles('admin')
  patchUser(@Param('id', ParseIntPipe) id: number, @Body() dto: PatchUserDto) {
    return this.usersService.patchUser(id, dto);
  }
}
