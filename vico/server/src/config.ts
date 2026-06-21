import {existsSync, readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OpenAICompatibleConfig} from "@mastra/core/llm";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface AppConfig {
  server: {
    port: number;
    deploy_mode: 'private' | 'saas';
  };
  auth: {
    session_expiry_days: number;
  };
  database: {
    url: string;
    duckdb_url: string;
  };
  skills: {
    scan_paths: string[];
  };
  memory: {
    stm_window: number;
    ltm_auto_extract: boolean;
    ltm_max_entries: number;
  };
  rag: {
    chunk_size: number;
    chunk_overlap: number;
    retrieval_top_k: number;
    embedder: 'fastembed' | string | OpenAICompatibleConfig;
  };
  /** 文件存储后端配置 */
  storage: {
    type: 'local' | 's3';
    root: string;
    endpoint?: string;
    region?: string;
    access_key_id?: string;
    secret_access_key?: string;
    bucket?: string;
  };
  /** 工具执行超时配置 */
  tool: {
    timeout_ms: number;
  };
  /** 文件上传配置 */
  upload: {
    max_size_bytes: number;
    allowed_mime_types: string[];
  };
  /** Workspace 基础工具配置（文件读写、命令执行等） */
  workspace: {
    base_path: string;
    contained: boolean;
    allowed_paths: string[];
    timeout_ms: number;
    isolation: 'none' | 'seatbelt' | 'bwrap';
  };
}

/** RAG 全局配置类型 */
interface RagConfig {
  chunk: { size: number; overlap: number; strategy: 'recursive' | 'semantic' | 'heading' };
  retrieval: { top_k: number; similarity_threshold: number };
  rerank: { enabled: boolean; model: string };
  no_match: { strategy: 'free_answer' | 'fallback' | 'reject'; fallback_message: string };
  query_rewrite: { enabled: boolean };
}

function loadConfig(): AppConfig {
  const configPath = process.env.CONFIG_PATH || resolve(__dirname, '../server.config.yaml');
  const defaultConfig: AppConfig = {
    server: { port: 3001, deploy_mode: 'private' },
    auth: { session_expiry_days: 7 },
    database: { url: 'file:./data/vico.db', duckdb_url: './data/mastra.duckdb' },
    skills: { scan_paths: [resolve(__dirname, '../../skills'), resolve(__dirname, '../db/custom-skills')] },
    memory: { stm_window: 20, ltm_auto_extract: true, ltm_max_entries: 10000 },
    rag: { chunk_size: 512, chunk_overlap: 64, retrieval_top_k: 5, embedder: 'openai/text-embedding-3-small' },
    tool: { timeout_ms: 30000 },
    upload: { max_size_bytes: 50 * 1024 * 1024, allowed_mime_types: ['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'text/x-python', 'text/javascript', 'application/json'] },
    storage: { type: 'local', root: './data/storage' },
    workspace: { base_path: resolve(__dirname, '../../workspace'), contained: true, allowed_paths: [], timeout_ms: 30000, isolation: 'none' },
  };

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parse(raw) as Partial<AppConfig>;
    const merged: AppConfig = {
      ...defaultConfig,
      ...parsed,
      server: { ...defaultConfig.server, ...parsed.server },
      auth: { ...defaultConfig.auth, ...parsed.auth },
      database: { ...defaultConfig.database, ...parsed.database },
      skills: { ...defaultConfig.skills, ...parsed.skills },
      memory: { ...defaultConfig.memory, ...parsed.memory },
      rag: { ...defaultConfig.rag, ...parsed.rag },
      tool: { ...defaultConfig.tool, ...parsed.tool },
      upload: { ...defaultConfig.upload, ...parsed.upload },
      storage: { ...defaultConfig.storage, ...parsed.storage },
      workspace: { ...defaultConfig.workspace, ...parsed.workspace },
    };
    return merged;
  }

  return defaultConfig;
}

export const config = loadConfig();

/** RAG 全局默认配置（从 config.rag 读取，可通过 server.config.yaml 覆盖） */
export const DEFAULT_RAG_CONFIG: RagConfig = {
  chunk: {
    size: config.rag.chunk_size,
    overlap: config.rag.chunk_overlap,
    strategy: 'recursive',
  },
  retrieval: {
    top_k: config.rag.retrieval_top_k,
    similarity_threshold: 0.7,
  },
  rerank: {
    enabled: false,
    model: 'Xenova/bge-reranker-base',
  },
  no_match: {
    strategy: 'free_answer',
    fallback_message: '抱歉，未找到相关知识。',
  },
  query_rewrite: { enabled: false },
};

export type { AppConfig, RagConfig };
