export interface ContentSearchHit {
  bookId: number;
  title: string | null;
  authors: string[];
  chunkIndex: number;
  snippet: string;
  score: number;
}

export interface ContentSearchResponse {
  hits: ContentSearchHit[];
}
