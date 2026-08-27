import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { embeddingConfig } from '../../config/config';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { EMBEDDING_DIMENSIONS } from './book-embedding-vectorizer.service';

const EVENT = 'embedding.openai';

@Injectable()
export class OpenAiEmbeddingClient {
  private readonly logger = new Logger(OpenAiEmbeddingClient.name);

  constructor(@Inject(embeddingConfig.KEY) private readonly config: ConfigType<typeof embeddingConfig>) {}

  isEnabled(): boolean {
    return Boolean(this.config.apiBaseUrl && this.config.model);
  }

  async embed(input: string, dimensions: number = EMBEDDING_DIMENSIONS): Promise<number[]> {
    const [vector] = await this.request([input], dimensions, this.config.model);
    return vector;
  }

  async embedMany(inputs: string[], dimensions: number, model?: string): Promise<number[][]> {
    if (inputs.length === 0) return [];
    return this.request(inputs, dimensions, model ?? this.config.model);
  }

  private async request(inputs: string[], dimensions: number, model: string | undefined): Promise<number[][]> {
    const { apiBaseUrl, apiKey, timeoutMs } = this.config;
    const url = `${apiBaseUrl!.replace(/\/+$/, '')}/embeddings`;
    const startedAt = Date.now();
    const inputChars = inputs.reduce((sum, s) => sum + s.length, 0);
    this.logger.debug(
      `[${EVENT}] [start] model=${sanitizeLogValue(model)} inputCount=${inputs.length} inputChars=${inputChars} - openai embedding started`,
    );

    let res: Response;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input: inputs, dimensions, encoding_format: 'float' }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${EVENT}] [fail] model=${sanitizeLogValue(model)} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(
          error instanceof Error ? error.message : String(error),
        )}" - openai embedding failed`,
      );
      throw error;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(
        `[${EVENT}] [fail] model=${sanitizeLogValue(model)} durationMs=${Date.now() - startedAt} status=${res.status} errorClass=EmbeddingHttpError error="${sanitizeLogValue(
          body,
        )}" - openai embedding failed`,
      );
      throw new Error(`embedding request failed status=${res.status}`);
    }

    const json = (await res.json()) as { data?: Array<{ embedding?: unknown }> };
    const data = json?.data;
    if (!Array.isArray(data) || data.length !== inputs.length) {
      const count = Array.isArray(data) ? data.length : 'none';
      this.logger.warn(
        `[${EVENT}] [fail] model=${sanitizeLogValue(model)} durationMs=${Date.now() - startedAt} errorClass=EmbeddingShapeError error="unexpected embedding count=${count} expected=${inputs.length}" - openai embedding failed`,
      );
      throw new Error(`unexpected embedding count=${count}`);
    }

    const vectors = data.map((entry) => {
      const raw = entry?.embedding;
      if (!Array.isArray(raw) || raw.length < dimensions || raw.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        const dims = Array.isArray(raw) ? raw.length : 'none';
        this.logger.warn(
          `[${EVENT}] [fail] model=${sanitizeLogValue(model)} durationMs=${Date.now() - startedAt} errorClass=EmbeddingShapeError error="unexpected embedding response dims=${dims}" - openai embedding failed`,
        );
        throw new Error(`unexpected embedding response dims=${dims}`);
      }
      return (raw as number[]).slice(0, dimensions);
    });

    this.logger.debug(
      `[${EVENT}] [end] model=${sanitizeLogValue(model)} durationMs=${Date.now() - startedAt} count=${vectors.length} usedDims=${dimensions} - openai embedding completed`,
    );
    return vectors;
  }
}
