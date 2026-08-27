import { Module } from '@nestjs/common';

import { EmbeddingModule } from '../embedding/embedding.module';
import { BookContentEmbedderService } from './book-content-embedder.service';
import { BookContentEmbeddingRepository } from './book-content-embedding.repository';
import { ContentExtractionService } from './content-extraction.service';

@Module({
  imports: [EmbeddingModule],
  providers: [BookContentEmbedderService, BookContentEmbeddingRepository, ContentExtractionService],
  exports: [BookContentEmbedderService, BookContentEmbeddingRepository],
})
export class ContentEmbeddingModule {}
