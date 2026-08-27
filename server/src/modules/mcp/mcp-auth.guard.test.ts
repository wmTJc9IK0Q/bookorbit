import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { McpAuthGuard } from './mcp-auth.guard';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('McpAuthGuard', () => {
  const fakeUser = { id: 2, username: 'demo', active: true };

  it('rejects when the Authorization header is missing', async () => {
    const magicLinkService = { authenticate: vi.fn() };
    const guard = new McpAuthGuard(magicLinkService as never);
    const request = { headers: {} };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
    expect(magicLinkService.authenticate).not.toHaveBeenCalled();
  });

  it('rejects when the header is not a Bearer token', async () => {
    const magicLinkService = { authenticate: vi.fn() };
    const guard = new McpAuthGuard(magicLinkService as never);
    const request = { headers: { authorization: 'Basic abc' } };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
    expect(magicLinkService.authenticate).not.toHaveBeenCalled();
  });

  it('authenticates a Bearer token and attaches the user to the request', async () => {
    const magicLinkService = { authenticate: vi.fn().mockResolvedValue({ user: fakeUser, token: {} }) };
    const guard = new McpAuthGuard(magicLinkService as never);
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer abc' } };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(magicLinkService.authenticate).toHaveBeenCalledWith('abc');
    expect(request.user).toBe(fakeUser);
  });

  it('propagates authentication failures', async () => {
    const magicLinkService = { authenticate: vi.fn().mockRejectedValue(new UnauthorizedException('nope')) };
    const guard = new McpAuthGuard(magicLinkService as never);
    const request = { headers: { authorization: 'Bearer bad' } };

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
  });
});
