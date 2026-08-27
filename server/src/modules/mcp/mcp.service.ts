import { IncomingMessage, ServerResponse } from 'node:http';

import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import type { RequestUser } from '../../common/types/request-user';
import { appConfig } from '../../config/config';
import { BookService } from '../book/book.service';

@Injectable()
export class McpService {
  constructor(
    private readonly bookService: BookService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  createServer(user: RequestUser): McpServer {
    const server = new McpServer({ name: 'bookorbit', version: this.config.version });

    server.registerTool(
      'search_books',
      {
        title: 'Search books',
        description: 'Search the BookOrbit library by title, author, series, or narrator. Returns books the caller can access.',
        inputSchema: {
          query: z.string().min(1).describe('Text to match against title, author, series, or narrator'),
          page: z.number().int().min(0).max(1000).optional().describe('Zero-based page index (default 0)'),
          size: z.number().int().min(1).max(50).optional().describe('Results per page, 1-50 (default 10)'),
        },
      },
      async ({ query, page, size }) => {
        const result = await this.bookService.globalQuery(user, {
          sort: [{ field: 'title', dir: 'asc' }],
          pagination: { page: page ?? 0, size: size ?? 10 },
          q: query,
          collapseSeries: false,
        });

        const books = result.items.map((book) => ({
          id: book.id,
          title: book.title,
          authors: book.authors,
          seriesName: book.seriesName,
          seriesIndex: book.seriesIndex,
          publishedYear: book.publishedYear,
          language: book.language,
        }));

        const payload = { total: result.total, page: result.page, size: result.size, books };
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
      },
    );

    return server;
  }

  async handleHttpRequest(req: IncomingMessage, res: ServerResponse, body: unknown, user: RequestUser): Promise<void> {
    const server = this.createServer(user);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}
