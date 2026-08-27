/**
 * Deterministic smoke test for content embedding + semantic content search.
 *
 * Seeds two libraries with hand-crafted 1536-dim chunk vectors (no external
 * embedding API), then verifies:
 *  - BookContentEmbeddingRepository.findAnnChunks ranks the nearest chunk first
 *    and excludes books in libraries the caller cannot access.
 *  - ContentSearchService assembles hits (title, authors, snippet, score) in ANN
 *    order using a stubbed query embedder.
 *
 * Requires the dev Postgres (with pgvector) migrated. Cleans up all seeded rows.
 *
 * Usage: cd server && npx tsx src/scripts/content-search-smoke.ts
 */
import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadEnvFile } from 'node:process';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { ZipArchive } from 'archiver';
import assert from 'node:assert/strict';

import type { RequestUser } from '../common/types/request-user';
import { createPostgresClientConfig } from '../db/postgres-connection-config';
import * as schema from '../db/schema';
import { authors, bookAuthors, bookContentChunks, bookFiles, bookMetadata, books, libraries, libraryFolders } from '../db/schema';
import { BookContentEmbeddingRepository } from '../modules/content-embedding/book-content-embedding.repository';
import { BookContentEmbedderService, CONTENT_EMBEDDING_DIMENSIONS } from '../modules/content-embedding/book-content-embedder.service';
import { ContentExtractionService } from '../modules/content-embedding/content-extraction.service';
import { ContentSearchService } from '../modules/content-search/content-search.service';
import type { OpenAiEmbeddingClient } from '../modules/embedding/openai-embedding.client';
import { BookEmbeddingVectorizerService } from '../modules/embedding/book-embedding-vectorizer.service';
import type { LibraryService } from '../modules/library/library.service';

if (existsSync('.env')) {
  loadEnvFile('.env');
}

function unitVector(hot: number, weight = 1): number[] {
  const v = new Array<number>(CONTENT_EMBEDDING_DIMENSIONS).fill(0);
  v[hot] = weight;
  return v;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title><dc:identifier id="uid">x</dc:identifier></metadata>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`;
const CH1 = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><p>${'The dragon awoke in the northern keep and the mountains trembled. '.repeat(4)}</p></body></html>`;
const CH2 = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>2</title></head><body><p>${'A quiet garden of roses bloomed in the southern valley at dawn. '.repeat(4)}</p></body></html>`;

async function buildEpub(path: string): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 0 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  archive.append('application/epub+zip', { name: 'mimetype', store: true });
  archive.append(CONTAINER_XML, { name: 'META-INF/container.xml' });
  archive.append(CONTENT_OPF, { name: 'OEBPS/content.opf' });
  archive.append(CH1, { name: 'OEBPS/text/ch1.xhtml' });
  archive.append(CH2, { name: 'OEBPS/text/ch2.xhtml' });
  await archive.finalize();
  await done;
  await writeFile(path, Buffer.concat(chunks));
}

async function seedBook(
  db: NodePgDatabase<typeof schema>,
  libraryId: number,
  folderId: number,
  title: string,
  authorName: string,
  chunkText: string,
  embedding: number[],
): Promise<number> {
  const [book] = await db
    .insert(books)
    .values({ libraryId, libraryFolderId: folderId, folderPath: `/smoke/${title}`, status: 'present' })
    .returning({ id: books.id });
  const [file] = await db
    .insert(bookFiles)
    .values({ bookId: book.id, libraryFolderId: folderId, absolutePath: `/smoke/${title}.epub`, ino: BigInt(book.id) as never, format: 'epub' })
    .returning({ id: bookFiles.id });
  await db.update(books).set({ primaryFileId: file.id }).where(eq(books.id, book.id));
  await db.insert(bookMetadata).values({ bookId: book.id, title });
  const [author] = await db
    .insert(authors)
    .values({ name: authorName })
    .onConflictDoUpdate({ target: authors.name, set: { name: authorName } })
    .returning({ id: authors.id });
  await db.insert(bookAuthors).values({ bookId: book.id, authorId: author.id });
  await db.insert(bookContentChunks).values({ bookId: book.id, chunkIndex: 0, content: chunkText, embedding });
  return book.id;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new Pool(createPostgresClientConfig(connectionString));
  const db = drizzle(pool, { schema });

  const suffix = Date.now();
  const [libA] = await db
    .insert(libraries)
    .values({ name: `smoke-A-${suffix}`, icon: 'book', embedContent: true })
    .returning({ id: libraries.id });
  const [libB] = await db
    .insert(libraries)
    .values({ name: `smoke-B-${suffix}`, icon: 'book', embedContent: true })
    .returning({ id: libraries.id });
  const [folderA] = await db
    .insert(libraryFolders)
    .values({ libraryId: libA.id, path: `/smoke/a-${suffix}` })
    .returning({ id: libraryFolders.id });
  const [folderB] = await db
    .insert(libraryFolders)
    .values({ libraryId: libB.id, path: `/smoke/b-${suffix}` })
    .returning({ id: libraryFolders.id });

  try {
    const dragonText = 'The dragon awoke in the northern keep and the mountains trembled.';
    const bookA = await seedBook(db, libA.id, folderA.id, `dragon-${suffix}`, `Ada Lovelace ${suffix}`, dragonText, unitVector(0));
    const bookB = await seedBook(
      db,
      libA.id,
      folderA.id,
      `garden-${suffix}`,
      `Bo Peep ${suffix}`,
      'A quiet garden of roses in the southern valley.',
      unitVector(1),
    );
    const bookC = await seedBook(
      db,
      libB.id,
      folderB.id,
      `other-${suffix}`,
      `Cy Cyan ${suffix}`,
      'Another dragon story in a different library entirely.',
      unitVector(0),
    );

    const repo = new BookContentEmbeddingRepository(db as never);
    const query = unitVector(0, 0.98);
    query[1] = 0.2;

    // 1) ANN ranks nearest chunk first, scoped to accessible libraries only.
    const scopedToA = await repo.findAnnChunks(query, [libA.id], undefined, 10);
    assert.equal(scopedToA[0]?.bookId, bookA, 'nearest chunk (bookA) should rank first');
    assert.ok(!scopedToA.some((r) => r.bookId === bookC), 'bookC lives in libB and must be excluded when only libA is accessible');
    assert.ok(scopedToA[0].cosineSim > (scopedToA[1]?.cosineSim ?? -1), 'cosine similarity must be descending');
    assert.ok(
      scopedToA.some((r) => r.bookId === bookB),
      'bookB (same library, different topic) should still be a candidate, ranked below bookA',
    );
    assert.equal(scopedToA[0].title, `dragon-${suffix}`, 'title should join from bookMetadata');

    // Both libraries accessible -> bookC (also near e0) becomes visible.
    const scopedToBoth = await repo.findAnnChunks(query, [libA.id, libB.id], undefined, 10);
    assert.ok(
      scopedToBoth.some((r) => r.bookId === bookC),
      'bookC visible when libB is accessible',
    );

    // 2) ContentSearchService assembles hits in ANN order with a stubbed embedder.
    const embedderStub = { embedQuery: () => Promise.resolve(query) } as unknown as BookContentEmbedderService;
    const libraryStub = { findAll: () => Promise.resolve([{ id: libA.id }]) } as unknown as LibraryService;
    const service = new ContentSearchService(embedderStub, repo, libraryStub);
    const user = { id: 1, isSuperuser: false, contentFilters: undefined } as unknown as RequestUser;

    const { hits } = await service.search(user, { query: 'dragon in the north' });
    assert.ok(hits.length >= 1, 'expected at least one hit');
    assert.equal(hits[0].bookId, bookA, 'top hit should be bookA');
    assert.equal(hits[0].title, `dragon-${suffix}`);
    assert.deepEqual(hits[0].authors, [`Ada Lovelace ${suffix}`], 'author names must be attached');
    assert.equal(hits[0].snippet, dragonText, 'snippet is the chunk text (< 300 chars)');
    assert.ok(hits[0].score > 0.9, `score should be high, got ${hits[0].score}`);
    assert.ok(!hits.some((h) => h.bookId === bookC), 'bookC excluded (libB not accessible)');

    // 3) Full embed pipeline against a real EPUB with a stubbed embedding client.
    const epubDir = await mkdtemp(join(tmpdir(), 'bookorbit-content-smoke-'));
    try {
      const epubPath = join(epubDir, 'book.epub');
      await buildEpub(epubPath);
      const [pipeBook] = await db
        .insert(books)
        .values({ libraryId: libA.id, libraryFolderId: folderA.id, folderPath: `/smoke/pipe-${suffix}`, status: 'present' })
        .returning({ id: books.id });
      const [pipeFile] = await db
        .insert(bookFiles)
        .values({ bookId: pipeBook.id, libraryFolderId: folderA.id, absolutePath: epubPath, ino: BigInt(pipeBook.id) as never, format: 'epub' })
        .returning({ id: bookFiles.id });
      await db.update(books).set({ primaryFileId: pipeFile.id }).where(eq(books.id, pipeBook.id));

      const clientStub = {
        isEnabled: () => true,
        embed: () => Promise.resolve(unitVector(0)),
        embedMany: (inputs: string[]) => Promise.resolve(inputs.map(() => unitVector(0))),
      } as unknown as OpenAiEmbeddingClient;
      const embedder = new BookContentEmbedderService(
        { apiBaseUrl: 'x', apiKey: 'k', model: 'm', contentModel: undefined, timeoutMs: 1000 } as never,
        repo,
        new ContentExtractionService(),
        clientStub,
        new BookEmbeddingVectorizerService(),
      );
      const written = await embedder.embedBookContent(pipeBook.id);
      assert.equal(written, 2, 'the two-chapter fixture EPUB should yield two chunks');
      const stored = await db.select({ id: bookContentChunks.id }).from(bookContentChunks).where(eq(bookContentChunks.bookId, pipeBook.id));
      assert.equal(stored.length, 2, 'chunks must be persisted to book_content_chunks');
      console.log(`OK embed pipeline smoke: real EPUB -> ${written} chunks persisted for bookId=${pipeBook.id}.`);

      // 4) Local fallback: no API configured -> vectorizer embeds chunks AND queries
      // in the same hashed space, so keyword-overlapping queries still match.
      const [localBook] = await db
        .insert(books)
        .values({ libraryId: libA.id, libraryFolderId: folderA.id, folderPath: `/smoke/local-${suffix}`, status: 'present' })
        .returning({ id: books.id });
      const localEpubPath = join(epubDir, 'book-local.epub');
      await buildEpub(localEpubPath);
      const [localFile] = await db
        .insert(bookFiles)
        .values({
          bookId: localBook.id,
          libraryFolderId: folderA.id,
          absolutePath: localEpubPath,
          ino: BigInt(localBook.id) as never,
          format: 'epub',
        })
        .returning({ id: bookFiles.id });
      await db.update(books).set({ primaryFileId: localFile.id }).where(eq(books.id, localBook.id));
      await db.insert(bookMetadata).values({ bookId: localBook.id, title: `local-${suffix}` });

      const vectorizer = new BookEmbeddingVectorizerService();
      const disabledClient = { isEnabled: () => false } as unknown as OpenAiEmbeddingClient;
      const localEmbedder = new BookContentEmbedderService(
        { apiBaseUrl: undefined, apiKey: undefined, model: undefined, contentModel: undefined, timeoutMs: 1000 } as never,
        repo,
        new ContentExtractionService(),
        disabledClient,
        vectorizer,
      );
      const localWritten = await localEmbedder.embedBookContent(localBook.id);
      assert.equal(localWritten, 2, 'local fallback should embed the two-chapter EPUB into two chunks');

      const localService = new ContentSearchService(localEmbedder, repo, {
        findAll: () => Promise.resolve([{ id: libA.id }]),
      } as unknown as LibraryService);
      const localUser = { id: 2, isSuperuser: false, contentFilters: undefined } as unknown as RequestUser;
      const localHits = (await localService.search(localUser, { query: 'dragon northern keep mountains' })).hits;
      assert.ok(
        localHits.some((h) => h.bookId === localBook.id && h.score > 0),
        'local keyword query should match the dragon chapter via the shared hashed space',
      );
      console.log(
        `OK local fallback smoke: no API -> ${localWritten} local chunks embedded and matched by query (topScore=${localHits[0].score.toFixed(4)}).`,
      );
    } finally {
      await rm(epubDir, { recursive: true, force: true });
    }

    console.log(`OK content-search smoke: ranked bookA first (score=${hits[0].score.toFixed(4)}), scoping + assembly verified.`);
  } finally {
    await db.delete(libraries).where(eq(libraries.id, libA.id));
    await db.delete(libraries).where(eq(libraries.id, libB.id));
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
