import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { OpenSessionDto } from './dto/open-session.dto.js';
import { SessionsService } from './sessions.service.js';

@Controller()
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  @Roles('teacher')
  open(@Body() dto: OpenSessionDto, @CurrentUser() user: { id: number; role: string }) {
    return this.sessionsService.open(dto, user);
  }

  @Patch('sessions/:id/close')
  @Roles('teacher')
  close(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number; role: string }) {
    return this.sessionsService.close(id, user);
  }

  @Get('sessions')
  @Roles('teacher', 'admin')
  list(
    @Query('classId', ParseIntPipe) classId: number,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.sessionsService.list(classId, Number(page), Number(pageSize), user);
  }
}
