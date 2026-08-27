import { Body, Controller, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ContentSearchService } from './content-search.service';
import { ContentSearchDto } from './dto/content-search.dto';

@Controller('content-search')
export class ContentSearchController {
  constructor(private readonly contentSearchService: ContentSearchService) {}

  @Post()
  search(@Body() dto: ContentSearchDto, @CurrentUser() user: RequestUser) {
    return this.contentSearchService.search(user, dto);
  }
}
