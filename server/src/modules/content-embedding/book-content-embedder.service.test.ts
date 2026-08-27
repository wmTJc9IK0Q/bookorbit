import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { embeddingConfig } from '../../config/config';
import { OpenAiEmbeddingClient } from '../embedding/openai-embedding.client';
import { BookEmbeddingVectorizerService } from '../embedding/book-embedding-vectorizer.service';
import { BookContentEmbedderService, CONTENT_EMBEDDING_DIMENSIONS } from './book-content-embedder.service';
import { BookContentEmbeddingRepository, PrimaryFileFlag } from './book-content-embedding.repository';
import { ContentExtractionService } from './content-extraction.service';

type Repo = Pick<BookContentEmbeddingRepository, 'findPrimaryFileAndFlag' | 'replaceChunks' | 'deleteByBookId' | 'findBookIdsForLibrary'>;

function makeConfig(): ConfigType<typeof embeddingConfig> {
  return { apiBaseUrl: 'https://x/v1', apiKey: 'k', model: 'm', contentModel: undefined, timeoutMs: 30000 };
}

function makeService(over: { flag?: PrimaryFileFlag | null; enabled?: boolean; supports?: boolean; segments?: string[] }) {
  const repo: Repo = {
    findPrimaryFileAndFlag: vi.fn().mockResolvedValue(over.flag ?? null),
    replaceChunks: vi.fn().mockResolvedValue(undefined),
    deleteByBookId: vi.fn().mockResolvedValue(undefined),
    findBookIdsForLibrary: vi.fn().mockResolvedValue([]),
  };
  const extraction = {
    supports: vi.fn().mockReturnValue(over.supports ?? true),
    extractSegments: vi.fn().mockResolvedValue(over.segments ?? []),
  } as unknown as ContentExtractionService;
  const client = {
    isEnabled: vi.fn().mockReturnValue(over.enabled ?? true),
    embed: vi.fn(),
    embedMany: vi.fn().mockImplementation((inputs: string[]) => Promise.resolve(inputs.map(() => Array(CONTENT_EMBEDDING_DIMENSIONS).fill(0.01)))),
  } as unknown as OpenAiEmbeddingClient;
  const vectorizer = {
    buildTextVector: vi.fn().mockReturnValue(Array(CONTENT_EMBEDDING_DIMENSIONS).fill(0.03)),
  } as unknown as BookEmbeddingVectorizerService;
  const service = new BookContentEmbedderService(makeConfig(), repo as unknown as BookContentEmbeddingRepository, extraction, client, vectorizer);
  return { service, repo, extraction, client, vectorizer };
}

describe('BookContentEmbedderService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  const goodFlag: PrimaryFileFlag = { absolutePath: '/b.epub', format: 'epub', embedContent: true };

  it('skips when book/file not found', async () => {
    const { service, extraction } = makeService({ flag: null });
    expect(await service.embedBookContent(1)).toBeNull();
    expect(extraction.extractSegments).not.toHaveBeenCalled();
  });

  it('skips when the library flag is disabled', async () => {
    const { service, extraction } = makeService({ flag: { ...goodFlag, embedContent: false } });
    expect(await service.embedBookContent(1)).toBeNull();
    expect(extraction.extractSegments).not.toHaveBeenCalled();
  });

  it('skips when the format is unsupported', async () => {
    const { service, extraction } = makeService({ flag: { ...goodFlag, format: 'mobi' }, supports: false });
    expect(await service.embedBookContent(1)).toBeNull();
    expect(extraction.extractSegments).not.toHaveBeenCalled();
  });

  it('embeds locally when the embedding API is disabled', async () => {
    const { service, repo, client, vectorizer } = makeService({
      flag: goodFlag,
      enabled: false,
      segments: ['this chapter passage is definitely longer than the fifty character minimum threshold'],
    });
    const written = await service.embedBookContent(3);
    expect(written).toBe(1);
    expect(client.embedMany).not.toHaveBeenCalled();
    expect(vectorizer.buildTextVector).toHaveBeenCalledWith(expect.any(String), CONTENT_EMBEDDING_DIMENSIONS);
    expect(repo.replaceChunks).toHaveBeenCalledTimes(1);
    const [, rows] = vi.mocked(repo.replaceChunks).mock.calls[0];
    expect(rows[0].embedding).toHaveLength(CONTENT_EMBEDDING_DIMENSIONS);
  });

  it('clears stale chunks and returns 0 when extraction is empty', async () => {
    const { service, repo } = makeService({ flag: goodFlag, segments: [] });
    expect(await service.embedBookContent(7)).toBe(0);
    expect(repo.deleteByBookId).toHaveBeenCalledWith(7);
    expect(repo.replaceChunks).not.toHaveBeenCalled();
  });

  it('embeds chunks and persists them via replaceChunks', async () => {
    const { service, repo, client } = makeService({
      flag: goodFlag,
      segments: ['this chapter passage is definitely longer than the fifty character minimum threshold'],
    });
    const written = await service.embedBookContent(9);
    expect(written).toBe(1);
    expect(client.embedMany).toHaveBeenCalledWith(expect.any(Array), CONTENT_EMBEDDING_DIMENSIONS, 'm');
    expect(repo.replaceChunks).toHaveBeenCalledTimes(1);
    const [bookId, rows] = vi.mocked(repo.replaceChunks).mock.calls[0];
    expect(bookId).toBe(9);
    expect(rows).toHaveLength(1);
    expect(rows[0].embedding).toHaveLength(CONTENT_EMBEDDING_DIMENSIONS);
  });

  it('embedQuery uses the API when enabled and the local vectorizer otherwise', async () => {
    const disabled = makeService({ enabled: false });
    const localVec = await disabled.service.embedQuery('dragon in the north');
    expect(localVec).toHaveLength(CONTENT_EMBEDDING_DIMENSIONS);
    expect(disabled.vectorizer.buildTextVector).toHaveBeenCalledWith('dragon in the north', CONTENT_EMBEDDING_DIMENSIONS);
    expect(disabled.client.embed).not.toHaveBeenCalled();

    const enabled = makeService({ enabled: true });
    vi.mocked(enabled.client.embed).mockResolvedValue(Array(CONTENT_EMBEDDING_DIMENSIONS).fill(0.02));
    const apiVec = await enabled.service.embedQuery('dragon in the north');
    expect(apiVec).toHaveLength(CONTENT_EMBEDDING_DIMENSIONS);
    expect(enabled.client.embed).toHaveBeenCalledWith('dragon in the north', CONTENT_EMBEDDING_DIMENSIONS);
  });

  it('embedQuery returns null for an empty query regardless of API state', async () => {
    const { service } = makeService({ enabled: false });
    expect(await service.embedQuery('   ')).toBeNull();
  });
});
