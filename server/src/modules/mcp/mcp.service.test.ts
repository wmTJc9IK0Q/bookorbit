import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { McpService } from './mcp.service';

const fakeUser = { id: 2, username: 'demo', active: true } as never;

function makeService() {
  const bookService = {
    globalQuery: vi.fn().mockResolvedValue({
      items: [
        {
          id: 7,
          title: 'The Last Wish',
          authors: ['Andrzej Sapkowski'],
          seriesName: 'The Witcher',
          seriesIndex: { display: '1' },
          publishedYear: 1993,
          language: 'en',
        },
      ],
      total: 1,
      page: 0,
      size: 10,
    }),
  };

  const service = new McpService(bookService as never, { version: 'test' } as never);
  return { service, bookService };
}

async function connect(service: McpService) {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = service.createServer(fakeUser);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0' });
  await client.connect(clientTransport);
  return { server, client };
}

describe('McpService', () => {
  it('exposes the search_books tool', async () => {
    const { service } = makeService();
    const { server, client } = await connect(service);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('search_books');

    await client.close();
    await server.close();
  });

  it('runs search_books against BookService.globalQuery and returns mapped books', async () => {
    const { service, bookService } = makeService();
    const { server, client } = await connect(service);

    const result = await client.callTool({ name: 'search_books', arguments: { query: 'witcher', size: 5 } });
    const content = result.content as Array<{ type: string; text: string }>;
    const payload = JSON.parse(content[0].text);

    expect(payload).toEqual({
      total: 1,
      page: 0,
      size: 10,
      books: [
        {
          id: 7,
          title: 'The Last Wish',
          authors: ['Andrzej Sapkowski'],
          seriesName: 'The Witcher',
          seriesIndex: { display: '1' },
          publishedYear: 1993,
          language: 'en',
        },
      ],
    });

    expect(bookService.globalQuery).toHaveBeenCalledWith(fakeUser, {
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 0, size: 5 },
      q: 'witcher',
      collapseSeries: false,
    });

    await client.close();
    await server.close();
  });
});
