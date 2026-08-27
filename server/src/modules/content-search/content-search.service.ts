import { Injectable, Logger } from '@nestjs/common';

import type { ContentSearchHit, ContentSearchResponse } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookContentEmbedderService } from '../content-embedding/book-content-embedder.service';
import { BookContentEmbeddingRepository } from '../content-embedding/book-content-embedding.repository';
import { LibraryService } from '../library/library.service';
import { ContentSearchDto } from './dto/content-search.dto';

const EVENT = 'content.search';
const DEFAULT_LIMIT = 10;
const SNIPPET_CHARS = 300;

@Injectable()
export class ContentSearchService {
  private readonly logger = new Logger(ContentSearchService.name);

  constructor(
    private readonly embedder: BookContentEmbedderService,
    private readonly repo: BookContentEmbeddingRepository,
    private readonly libraryService: LibraryService,
  ) {}

  async search(user: RequestUser, dto: ContentSearchDto): Promise<ContentSearchResponse> {
    const startedAt = Date.now();
    this.logger.log(`[${EVENT}] [start] userId=${user.id} queryChars=${dto.query.length} - content search started`);

    const embedding = await this.embedder.embedQuery(dto.query);
    if (!embedding) {
      this.logger.log(
        `[${EVENT}] [end] userId=${user.id} durationMs=${Date.now() - startedAt} resultCount=0 reason=no_embedding - content search completed`,
      );
      return { hits: [] };
    }

    const accessibleLibraries = await this.libraryService.findAll(user);
    let libraryIds = accessibleLibraries.map((library) => library.id);
    if (dto.libraryIds && dto.libraryIds.length > 0) {
      const requested = new Set(dto.libraryIds);
      libraryIds = libraryIds.filter((id) => requested.has(id));
    }

    const rows = await this.repo.findAnnChunks(embedding, libraryIds, user.isSuperuser ? undefined : user.contentFilters, dto.limit ?? DEFAULT_LIMIT);

    const authorsByBook = await this.repo.findAuthorNamesForBooks([...new Set(rows.map((r) => r.bookId))]);
    const hits: ContentSearchHit[] = rows.map((row) => ({
      bookId: row.bookId,
      title: row.title,
      authors: authorsByBook.get(row.bookId) ?? [],
      chunkIndex: row.chunkIndex,
      snippet: row.content.slice(0, SNIPPET_CHARS),
      score: row.cosineSim,
    }));

    this.logger.log(
      `[${EVENT}] [end] userId=${user.id} durationMs=${Date.now() - startedAt} libraryCount=${libraryIds.length} resultCount=${hits.length} - content search completed`,
    );
    return { hits };
  }
}
