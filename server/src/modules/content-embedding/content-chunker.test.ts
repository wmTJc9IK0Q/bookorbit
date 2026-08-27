import { describe, expect, it } from 'vitest';

import { CHUNK_CHARS, MAX_CHUNKS_PER_BOOK, MIN_CHUNK_CHARS, OVERLAP_CHARS, chunkSegments } from './content-chunker';

describe('chunkSegments', () => {
  it('returns no chunks for empty or whitespace-only input', () => {
    expect(chunkSegments([])).toEqual([]);
    expect(chunkSegments(['   ', '\n\t'])).toEqual([]);
  });

  it('emits a single chunk when a segment fits in one window', () => {
    const text = 'a'.repeat(CHUNK_CHARS - 100);
    const chunks = chunkSegments([text]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ chunkIndex: 0, content: text });
  });

  it('slides windows with the configured overlap stride', () => {
    const stride = CHUNK_CHARS - OVERLAP_CHARS;
    const text = 'x'.repeat(CHUNK_CHARS + stride + 200);
    const chunks = chunkSegments([text]);
    expect(chunks.length).toBe(3);
    expect(chunks[0].content.length).toBe(CHUNK_CHARS);
    expect(chunks[1].content.length).toBe(CHUNK_CHARS);
    // Third window starts at 2*stride and runs to end.
    expect(chunks[2].content.length).toBe(text.length - 2 * stride);
  });

  it('drops a whole segment shorter than MIN_CHUNK_CHARS but keeps one at the threshold', () => {
    expect(chunkSegments(['a'.repeat(MIN_CHUNK_CHARS - 1)])).toEqual([]);
    const kept = chunkSegments(['b'.repeat(MIN_CHUNK_CHARS)]);
    expect(kept).toHaveLength(1);
    expect(kept[0].content.length).toBe(MIN_CHUNK_CHARS);
  });

  it('assigns contiguous global chunk indices across segments', () => {
    const seg = 'z'.repeat(CHUNK_CHARS - 100);
    const chunks = chunkSegments([seg, seg, seg]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it('caps output at MAX_CHUNKS_PER_BOOK', () => {
    const stride = CHUNK_CHARS - OVERLAP_CHARS;
    const huge = 'q'.repeat(stride * (MAX_CHUNKS_PER_BOOK + 50) + CHUNK_CHARS);
    const chunks = chunkSegments([huge]);
    expect(chunks).toHaveLength(MAX_CHUNKS_PER_BOOK);
  });
});
