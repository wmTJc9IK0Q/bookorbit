export const CHUNK_CHARS = 4000;
export const OVERLAP_CHARS = 600;
export const MIN_CHUNK_CHARS = 50;
export const MAX_CHUNKS_PER_BOOK = 400;

export interface ContentChunk {
  chunkIndex: number;
  content: string;
}

/**
 * Splits ordered text segments (e.g. epub chapters) into fixed-size overlapping
 * character windows. Windows never span segment boundaries so chapter context stays
 * intact. Chunk indices increment globally across all segments.
 */
export function chunkSegments(segments: string[]): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  const stride = CHUNK_CHARS - OVERLAP_CHARS;

  for (const segment of segments) {
    const text = segment.trim();
    if (text.length === 0) continue;

    for (let start = 0; start < text.length; start += stride) {
      const piece = text.slice(start, start + CHUNK_CHARS).trim();
      if (piece.length >= MIN_CHUNK_CHARS) {
        chunks.push({ chunkIndex: chunks.length, content: piece });
        if (chunks.length >= MAX_CHUNKS_PER_BOOK) return chunks;
      }
      if (start + CHUNK_CHARS >= text.length) break;
    }
  }

  return chunks;
}
