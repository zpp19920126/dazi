import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateClassDto } from './dto/create-class.dto.js';
import { ClassesService } from './classes.service.js';

@Controller('classes')
@Roles('admin', 'teacher')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get()
  listClasses(@CurrentUser() user: { id: number; role: string }) {
    return this.classesService.listClasses(user);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  createClass(@Body() dto: CreateClassDto, @CurrentUser() user: { id: number }) {
    return this.classesService.createClass(dto, user);
  }

  @Patch(':id')
  renameClass(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateClassDto,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.classesService.renameClass(id, dto, user);
  }

  @Delete(':id')
  deleteClass(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.classesService.deleteClass(id, user);
  }
}
