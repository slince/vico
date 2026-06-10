import { config } from '../config.js';

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  dimension(): number;
}

class LocalEmbedder implements Embedder {
  private pipeline: any = null;
  private dim = 384;

  async load() {
    try {
      const { pipeline } = await import('@xenova/transformers');
      this.pipeline = await pipeline('feature-extraction', config.rag.embedder_model);
      console.log(`[Embedder] Local model loaded: ${config.rag.embedder_model}`);
    } catch (err) {
      console.warn('[Embedder] Failed to load local model, using fallback hash embeddings:', err);
    }
  }

  async embed(text: string): Promise<Float32Array> {
    if (this.pipeline) {
      const result = await this.pipeline(text, { pooling: 'mean', normalize: true });
      return new Float32Array(result.data);
    }
    return this.fallbackEmbed(text);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (this.pipeline) {
      const results = await Promise.all(texts.map((t) => this.embed(t)));
      return results;
    }
    return texts.map((t) => this.fallbackEmbed(t));
  }

  dimension(): number {
    return this.dim;
  }

  private fallbackEmbed(text: string): Float32Array {
    // Simple hash-based embedding when no model available
    const tokens = text.toLowerCase().split(/\s+/).slice(0, 100);
    const vec = new Float32Array(this.dim);
    for (let i = 0; i < tokens.length; i++) {
      let hash = 0;
      for (let j = 0; j < tokens[i].length; j++) {
        hash = ((hash << 5) - hash + tokens[i].charCodeAt(j)) | 0;
      }
      const idx = ((hash % this.dim) + this.dim) % this.dim;
      vec[idx] += 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < this.dim; i++) vec[i] /= norm;
    }
    return vec;
  }
}

class APIEmbedder implements Embedder {
  private apiKey: string;
  private baseURL: string;
  private dim = 1536;

  constructor() {
    const openaiModel = config.llm.models.find((m) => m.provider === 'openai');
    this.apiKey = openaiModel?.api_key || '';
    this.baseURL = 'https://api.openai.com/v1';
  }

  async embed(text: string): Promise<Float32Array> {
    const res = await fetch(`${this.baseURL}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });
    const json = await res.json() as any;
    return new Float32Array(json.data[0].embedding);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const res = await fetch(`${this.baseURL}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    });
    const json = await res.json() as any;
    return json.data.map((d: any) => new Float32Array(d.embedding));
  }

  dimension(): number {
    return this.dim;
  }
}

let embedderInstance: Embedder;

export async function getEmbedder(): Promise<Embedder> {
  if (!embedderInstance) {
    if (config.rag.embedder === 'api') {
      embedderInstance = new APIEmbedder();
    } else {
      const local = new LocalEmbedder();
      await local.load();
      embedderInstance = local;
    }
  }
  return embedderInstance;
}

export function float32ToBlob(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer);
}

export function blobToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
