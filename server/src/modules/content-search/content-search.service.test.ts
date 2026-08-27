import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { BookContentEmbedderService } from '../content-embedding/book-content-embedder.service';
import { AnnChunkRow, BookContentEmbeddingRepository } from '../content-embedding/book-content-embedding.repository';
import { LibraryService } from '../library/library.service';
import { ContentSearchService } from './content-search.service';

const user = { id: 42, isSuperuser: false, contentFilters: undefined } as unknown as RequestUser;

function makeService(over: { embedding?: number[] | null; rows?: AnnChunkRow[]; libraryIds?: number[] }) {
  const embedding = 'embedding' in over ? over.embedding : [0.1, 0.2];
  const embedder = { embedQuery: vi.fn().mockResolvedValue(embedding) } as unknown as BookContentEmbedderService;
  const repo = {
    findAnnChunks: vi.fn().mockResolvedValue(over.rows ?? []),
    findAuthorNamesForBooks: vi.fn().mockResolvedValue(new Map<number, string[]>([[1, ['Ada']]])),
  } as unknown as BookContentEmbeddingRepository;
  const libraryService = {
    findAll: vi.fn().mockResolvedValue((over.libraryIds ?? [10, 20]).map((id) => ({ id }))),
  } as unknown as LibraryService;
  const service = new ContentSearchService(embedder, repo, libraryService);
  return { service, embedder, repo, libraryService };
}

describe('ContentSearchService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('returns empty hits when the query cannot be embedded', async () => {
    const { service, repo } = makeService({ embedding: null });
    expect(await service.search(user, { query: 'x' })).toEqual({ hits: [] });
    expect(repo.findAnnChunks).not.toHaveBeenCalled();
  });

  it('scopes ANN search to accessible libraries intersected with the request', async () => {
    const { service, repo } = makeService({ libraryIds: [10, 20, 30] });
    await service.search(user, { query: 'dragon', libraryIds: [20, 30, 99] });
    const [, libraryIds] = vi.mocked(repo.findAnnChunks).mock.calls[0];
    expect(libraryIds).toEqual([20, 30]);
  });

  it('passes user content filters for non-superusers', async () => {
    const filtered = { id: 1, isSuperuser: false, contentFilters: { some: 'rule' } } as unknown as RequestUser;
    const { service, repo } = makeService({});
    await service.search(filtered, { query: 'q' });
    const [, , contentFilters] = vi.mocked(repo.findAnnChunks).mock.calls[0];
    expect(contentFilters).toEqual({ some: 'rule' });
  });

  it('assembles hits in ANN order with a 300-char snippet and author names', async () => {
    const longContent = 'z'.repeat(500);
    const rows: AnnChunkRow[] = [
      { bookId: 1, chunkIndex: 3, content: longContent, title: 'Keep of the North', cosineSim: 0.91 },
      { bookId: 2, chunkIndex: 0, content: 'short passage', title: null, cosineSim: 0.7 },
    ];
    const { service } = makeService({ rows });
    const result = await service.search(user, { query: 'dragon' });
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toEqual({
      bookId: 1,
      title: 'Keep of the North',
      authors: ['Ada'],
      chunkIndex: 3,
      snippet: 'z'.repeat(300),
      score: 0.91,
    });
    expect(result.hits[1].authors).toEqual([]);
    expect(result.hits[1].snippet).toBe('short passage');
  });
});
