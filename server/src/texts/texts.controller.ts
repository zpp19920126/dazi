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
import { CreateTextDto } from './dto/create-text.dto.js';
import { UpdateTextDto } from './dto/update-text.dto.js';
import { TextStatusDto } from './dto/text-status.dto.js';
import { TextsService } from './texts.service.js';

@Controller('texts')
export class TextsController {
  constructor(private readonly textsService: TextsService) {}

  @Get()
  @Roles('admin', 'teacher', 'student')
  listTexts(
    @CurrentUser() user: { id: number; role: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
    @Query('language') language?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
  ) {
    return this.textsService.listTexts(user, { language, status, source, page, pageSize });
  }

  @Get(':id')
  @Roles('admin', 'teacher', 'student')
  getText(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.textsService.getText(id, user);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'teacher')
  createText(@Body() dto: CreateTextDto, @CurrentUser() user: { id: number }) {
    return this.textsService.createText(dto, user);
  }

  @Patch(':id')
  @Roles('admin', 'teacher')
  updateText(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTextDto,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.textsService.updateText(id, dto, user);
  }

  @Patch(':id/status')
  @Roles('admin')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: TextStatusDto) {
    return this.textsService.updateStatus(id, dto.status);
  }

  @Delete(':id')
  @Roles('admin', 'teacher')
  deleteText(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.textsService.deleteText(id, user);
  }
}
