import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookModule } from '../book/book.module';
import { McpAuthGuard } from './mcp-auth.guard';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [AuthModule, BookModule],
  controllers: [McpController],
  providers: [McpService, McpAuthGuard],
})
export class McpModule {}
