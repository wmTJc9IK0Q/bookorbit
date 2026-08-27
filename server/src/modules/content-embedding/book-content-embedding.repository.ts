import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookContentChunks, bookFiles, bookMetadata, books, libraries } from '../../db/schema';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { LIBRARY_BOOK_STATUS_PRESENT } from '../library/library.constants';

type Db = NodePgDatabase<typeof schema>;

export interface PrimaryFileFlag {
  absolutePath: string;
  format: string | null;
  embedContent: boolean;
}

export interface ContentChunkRow {
  chunkIndex: number;
  content: string;
  embedding: number[];
}

export interface AnnChunkRow {
  bookId: number;
  chunkIndex: number;
  content: string;
  title: string | null;
  cosineSim: number;
}

@Injectable()
export class BookContentEmbeddingRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findPrimaryFileAndFlag(bookId: number): Promise<PrimaryFileFlag | null> {
    const [row] = await this.db
      .select({
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        embedContent: libraries.embedContent,
      })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .where(eq(books.id, bookId))
      .limit(1);

    return row ?? null;
  }

  async findBookIdsForLibrary(libraryId: number): Promise<number[]> {
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.libraryId, libraryId), eq(books.status, LIBRARY_BOOK_STATUS_PRESENT)));
    return rows.map((r) => r.id);
  }

  async replaceChunks(bookId: number, rows: ContentChunkRow[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(bookContentChunks).where(eq(bookContentChunks.bookId, bookId));
      if (rows.length === 0) return;
      const values = rows.map((r) => ({
        bookId,
        chunkIndex: r.chunkIndex,
        content: r.content,
        embedding: r.embedding,
      }));
      const INSERT_BATCH = 200;
      for (let i = 0; i < values.length; i += INSERT_BATCH) {
        await tx.insert(bookContentChunks).values(values.slice(i, i + INSERT_BATCH));
      }
    });
  }

  async deleteByBookId(bookId: number): Promise<void> {
    await this.db.delete(bookContentChunks).where(eq(bookContentChunks.bookId, bookId));
  }

  async findAnnChunks(
    embedding: number[],
    libraryIds: number[],
    contentFilters: ContentFilterRules | undefined,
    limit: number,
  ): Promise<AnnChunkRow[]> {
    if (libraryIds.length === 0 || embedding.length === 0 || embedding.some((v) => !Number.isFinite(v))) return [];

    const vecStr = `[${embedding.join(',')}]`;
    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    return this.db
      .select({
        bookId: bookContentChunks.bookId,
        chunkIndex: bookContentChunks.chunkIndex,
        content: bookContentChunks.content,
        title: bookMetadata.title,
        cosineSim: sql<number>`(1 - (${bookContentChunks.embedding} <=> ${vecStr}::vector))::float`,
      })
      .from(bookContentChunks)
      .innerJoin(books, eq(books.id, bookContentChunks.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookContentChunks.bookId))
      .where(and(inArray(books.libraryId, libraryIds), ...filterClauses))
      .orderBy(sql`${bookContentChunks.embedding} <=> ${vecStr}::vector`)
      .limit(limit);
  }

  async findAuthorNamesForBooks(bookIds: number[]): Promise<Map<number, string[]>> {
    const byBook = new Map<number, string[]>();
    if (bookIds.length === 0) return byBook;

    const rows = await this.db
      .select({ bookId: bookAuthors.bookId, name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(inArray(bookAuthors.bookId, bookIds));

    for (const row of rows) {
      if (!row.name) continue;
      const list = byBook.get(row.bookId) ?? [];
      list.push(row.name);
      byBook.set(row.bookId, list);
    }
    return byBook;
  }
}
