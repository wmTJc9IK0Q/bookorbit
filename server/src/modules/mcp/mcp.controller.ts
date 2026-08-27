import { All, Controller, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { McpAuthGuard } from './mcp-auth.guard';
import { McpService } from './mcp.service';

@Controller('mcp')
@Public()
@UseGuards(McpAuthGuard)
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @All()
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply, @CurrentUser() user: RequestUser): Promise<void> {
    await this.mcpService.handleHttpRequest(request.raw, reply.raw, request.body, user);
  }
}
