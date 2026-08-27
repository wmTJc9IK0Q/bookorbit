import { Module } from '@nestjs/common';

import { ContentEmbeddingModule } from '../content-embedding/content-embedding.module';
import { LibraryModule } from '../library/library.module';
import { ContentSearchController } from './content-search.controller';
import { ContentSearchService } from './content-search.service';

@Module({
  imports: [ContentEmbeddingModule, LibraryModule],
  controllers: [ContentSearchController],
  providers: [ContentSearchService],
  exports: [ContentSearchService],
})
export class ContentSearchModule {}
