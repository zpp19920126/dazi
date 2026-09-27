import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { HeartbeatDto } from './dto/heartbeat.dto.js';
import { HeartbeatsService } from './heartbeats.service.js';

@Controller()
export class HeartbeatsController {
  constructor(private readonly heartbeatsService: HeartbeatsService) {}

  @Post('heartbeats')
  @HttpCode(HttpStatus.OK)
  @Roles('student')
  upsert(@CurrentUser() user: { id: number }, @Body() dto: HeartbeatDto) {
    return this.heartbeatsService.upsert(dto, user);
  }

  @Get('classes/:id/live')
  @Roles('admin', 'teacher')
  live(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number; role: string },
  ) {
    return this.heartbeatsService.getLive(id, user);
  }
}
