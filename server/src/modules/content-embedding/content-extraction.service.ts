import { execFile } from 'child_process';
import { Injectable, Logger } from '@nestjs/common';
import { promisify } from 'util';
import * as unzipper from 'unzipper';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizeForSearch } from '../position-converter/chapter-text-index';
import { loadChapterFromZip, readEpubSpine } from '../position-converter/epub-dom.service';

const execFileAsync = promisify(execFile);
const EVENT = 'content.extract';
const PDFTOTEXT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

const EPUB_FORMATS: Record<string, true> = { epub: true, kepub: true };
const PDF_FORMATS: Record<string, true> = { pdf: true };

@Injectable()
export class ContentExtractionService {
  private readonly logger = new Logger(ContentExtractionService.name);

  supports(format: string | null | undefined): boolean {
    const f = format?.toLowerCase() ?? '';
    return EPUB_FORMATS[f] === true || PDF_FORMATS[f] === true;
  }

  async extractSegments(absolutePath: string, format: string | null | undefined): Promise<string[]> {
    const f = format?.toLowerCase() ?? '';
    if (EPUB_FORMATS[f]) return this.extractEpub(absolutePath);
    if (PDF_FORMATS[f]) return this.extractPdf(absolutePath);
    return [];
  }

  private async extractEpub(absolutePath: string): Promise<string[]> {
    const zip = await unzipper.Open.file(absolutePath);
    const spine = await readEpubSpine(zip as unknown as unzipper.CentralDirectory);
    const segments: string[] = [];
    for (const href of spine.hrefs) {
      const doc = await loadChapterFromZip(zip as unknown as unzipper.CentralDirectory, href);
      const text = doc?.index.collapsed?.trim();
      if (text) segments.push(text);
    }
    return segments;
  }

  private async extractPdf(absolutePath: string): Promise<string[]> {
    const startedAt = Date.now();
    try {
      const { stdout } = await execFileAsync('pdftotext', ['-enc', 'UTF-8', absolutePath, '-'], {
        maxBuffer: PDFTOTEXT_MAX_BUFFER_BYTES,
      });
      const text = normalizeForSearch(stdout);
      return text ? [text] : [];
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${EVENT}] [fail] format=pdf durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(
          error instanceof Error ? error.message : String(error),
        )}" - pdftotext extraction failed`,
      );
      return [];
    }
  }
}
