import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { MagicLinkService } from '../auth/magic-link.service';

@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(private readonly magicLinkService: MagicLinkService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const rawToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
    if (!rawToken) throw new UnauthorizedException('Missing bearer token');

    const { user } = await this.magicLinkService.authenticate(rawToken);
    (request as unknown as Record<string, unknown>).user = user;
    return true;
  }
}
