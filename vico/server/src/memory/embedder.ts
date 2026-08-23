import { createEmbedder } from '@vico/rag';
import type { Embedder } from '@vico/rag';
import { config } from '../config.js';

let _embedder: Embedder | undefined;
let _embedderResolved = false;

/**
 * 从 server.config.yaml 的 rag.embedder 配置构建 Embedder。
 * 配置为 "none" 时禁用嵌入（返回 undefined，语义记忆与 RAG 索引随之停用）。
 * RAG 索引与语义记忆共用此单例，避免重复创建 embedder 实例。
 *
 * @returns Embedder 实例；配置为 "none" 时返回 undefined
 */
export function createConfiguredEmbedder(): Embedder | undefined {
  if (_embedderResolved) return _embedder;
  _embedderResolved = true;
  if (config.rag.embedder === 'none') return undefined;
  _embedder = createEmbedder(config.rag.embedder);
  return _embedder;
}
