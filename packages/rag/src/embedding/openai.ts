// @vico/rag — OpenAI-compatible embedder

import type { Embedder, EmbedOptions, EmbedResult } from '../types/embedder.js';

export interface OpenAIEmbedderOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * OpenAIEmbedder — 调用 OpenAI-compatible Embedding API。
 *
 * 默认使用 text-embedding-3-small 模型。
 */
export class OpenAIEmbedder implements Embedder {
  private model: string;
  private apiKey?: string;
  private baseUrl: string;

  constructor(options: OpenAIEmbedderOptions = {}) {
    this.model = options.model ?? 'text-embedding-3-small';
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
  }

  async doEmbed(options: EmbedOptions): Promise<EmbedResult> {
    if (!this.apiKey) {
      throw new Error('OpenAIEmbedder requires apiKey (pass directly or set OPENAI_API_KEY env)');
    }

    const model = options.model ?? this.model;
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: options.values,
        encoding_format: 'float',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embedding failed (${response.status}): ${err}`);
    }

    const data = await response.json() as {
      data: { embedding: number[]; index: number }[];
      usage: { total_tokens: number };
    };

    return {
      embeddings: data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding),
      usage: { tokens: data.usage.total_tokens },
    };
  }
}
