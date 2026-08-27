import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { embeddingConfig } from '../../config/config';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { OpenAiEmbeddingClient } from '../embedding/openai-embedding.client';
import { BookEmbeddingVectorizerService } from '../embedding/book-embedding-vectorizer.service';
import { BookContentEmbeddingRepository, ContentChunkRow } from './book-content-embedding.repository';
import { chunkSegments } from './content-chunker';
import { ContentExtractionService } from './content-extraction.service';

export const CONTENT_EMBEDDING_DIMENSIONS = 1536;
const EMBED_BATCH = 64;
const MAX_CONCURRENT = 3;

@Injectable()
export class BookContentEmbedderService {
  private readonly logger = new Logger(BookContentEmbedderService.name);
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private libraryRun: Promise<void> | null = null;

  constructor(
    @Inject(embeddingConfig.KEY) private readonly config: ConfigType<typeof embeddingConfig>,
    private readonly repo: BookContentEmbeddingRepository,
    private readonly extraction: ContentExtractionService,
    private readonly openAiClient: OpenAiEmbeddingClient,
    private readonly vectorizer: BookEmbeddingVectorizerService,
  ) {}

  private async acquire(): Promise<void> {
    if (this.active < MAX_CONCURRENT) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  async embedBookContent(bookId: number): Promise<number | null> {
    await this.acquire();
    try {
      return await this.runEmbed(bookId);
    } finally {
      this.release();
    }
  }

  private async runEmbed(bookId: number): Promise<number | null> {
    const event = 'content.embed';
    const startedAt = Date.now();

    const target = await this.repo.findPrimaryFileAndFlag(bookId);
    if (!target || !target.embedContent || !this.extraction.supports(target.format)) {
      const reason = !target ? 'no_file' : !target.embedContent ? 'disabled' : 'unsupported_format';
      this.logger.debug(
        `[${event}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} outcome=skipped reason=${reason} - content embed skipped`,
      );
      return null;
    }

    this.logger.log(`[${event}] [start] bookId=${bookId} format=${sanitizeLogValue(target.format)} - content embed started`);
    try {
      const segments = await this.extraction.extractSegments(target.absolutePath, target.format);
      const chunks = chunkSegments(segments);
      if (chunks.length === 0) {
        await this.repo.deleteByBookId(bookId);
        this.logger.log(
          `[${event}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} chunkCount=0 outcome=empty - content embed completed`,
        );
        return 0;
      }

      const useApi = this.openAiClient.isEnabled();
      const rows: ContentChunkRow[] = [];
      if (useApi) {
        const model = this.config.contentModel ?? this.config.model;
        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
          const batch = chunks.slice(i, i + EMBED_BATCH);
          const vectors = await this.openAiClient.embedMany(
            batch.map((c) => c.content),
            CONTENT_EMBEDDING_DIMENSIONS,
            model,
          );
          for (let j = 0; j < batch.length; j += 1) {
            rows.push({ chunkIndex: batch[j].chunkIndex, content: batch[j].content, embedding: vectors[j] });
          }
        }
      } else {
        for (const chunk of chunks) {
          rows.push({
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            embedding: this.vectorizer.buildTextVector(chunk.content, CONTENT_EMBEDDING_DIMENSIONS),
          });
        }
      }

      await this.repo.replaceChunks(bookId, rows);
      this.logger.log(
        `[${event}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} chunkCount=${rows.length} source=${useApi ? 'api' : 'local'} outcome=embedded - content embed completed`,
      );
      return rows.length;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(
          error instanceof Error ? error.message : String(error),
        )}" - content embed failed`,
      );
      throw error;
    }
  }

  async embedQuery(text: string): Promise<number[] | null> {
    const query = text.trim();
    if (query.length === 0) return null;
    if (this.openAiClient.isEnabled()) return this.openAiClient.embed(query, CONTENT_EMBEDDING_DIMENSIONS);
    return this.vectorizer.buildTextVector(query, CONTENT_EMBEDDING_DIMENSIONS);
  }

  async embedLibraryContent(libraryId: number): Promise<{ queued: number }> {
    const event = 'content.embed_library';
    const startedAt = Date.now();
    if (this.libraryRun) {
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} queued=0 runStarted=false alreadyRunning=true - embed library completed`,
      );
      return { queued: 0 };
    }

    const bookIds = await this.repo.findBookIdsForLibrary(libraryId);
    this.libraryRun = this.runLibrary(libraryId, bookIds).finally(() => {
      this.libraryRun = null;
    });
    this.logger.log(
      `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} queued=${bookIds.length} runStarted=true - embed library completed`,
    );
    return { queued: bookIds.length };
  }

  private async runLibrary(libraryId: number, bookIds: number[]): Promise<void> {
    const event = 'content.embed_library_run';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} totalBooks=${bookIds.length} - embed library run started`);
    const results = await Promise.allSettled(bookIds.map((id) => this.embedBookContent(id)));
    let processed = 0;
    let failed = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') processed += 1;
      else failed += 1;
    }
    this.logger.log(
      `[${event}] [end] libraryId=${libraryId} totalBooks=${bookIds.length} durationMs=${Date.now() - startedAt} processed=${processed} failed=${failed} - embed library run completed`,
    );
  }
}
