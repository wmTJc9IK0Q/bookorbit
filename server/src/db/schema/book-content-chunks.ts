import { sql } from 'drizzle-orm';
import { customType, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { books } from './books';

const contentEmbedding1536 = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector(1536)',
  toDriver: (v) => `[${v.join(',')}]`,
  fromDriver: (v) => {
    if (typeof v !== 'string' || !v || v === '[]') return [];
    return v
      .slice(1, -1)
      .split(',')
      .map((n) => parseFloat(n));
  },
});

export const bookContentChunks = pgTable(
  'book_content_chunks',
  {
    id: serial('id').primaryKey(),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: contentEmbedding1536('embedding').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('bcc_book_id_chunk_index_uidx').on(t.bookId, t.chunkIndex),
    index('bcc_book_id_idx').on(t.bookId),
    index('bcc_embedding_hnsw_cosine_idx').using('hnsw', sql`${t.embedding} vector_cosine_ops`),
  ],
);

export type BookContentChunk = typeof bookContentChunks.$inferSelect;
export type NewBookContentChunk = typeof bookContentChunks.$inferInsert;
