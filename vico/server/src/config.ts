import {existsSync, readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {getContainer} from './container.js';


const __dirname = dirname(fileURLToPath(import.meta.url));

/** 配置文件路径（应用层与 framework 共用同一份 server.config.yaml） */
export const CONFIG_PATH = process.env.CONFIG_PATH || resolve(__dirname, '../server.config.yaml');

/** 展开路径开头的 `~` 为用户主目录（YAML 里 `~/xxx` 不会自动展开） */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/** 应用层专属配置段（framework 段由 @vico/boot 管理） */
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
  };
  /** 文件存储后端配置（知识库文件持久化） */
  file_storage: {
    type: 'local' | 's3';
    root: string;
    endpoint?: string;
    region?: string;
    access_key_id?: string;
    secret_access_key?: string;
    bucket?: string;
  };
  /** 文件上传配置 */
  upload: {
    max_size_bytes: number;
    allowed_mime_types: string[];
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
  const defaultConfig: AppConfig = {
    server: { port: 3001, deploy_mode: 'private' },
    auth: { session_expiry_days: 7 },
    database: { url: 'file:./data/vico.db' },
    upload: {
      max_size_bytes: 50 * 1024 * 1024,
      allowed_mime_types: ['application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'text/x-python', 'text/javascript', 'application/json'],
    },
    file_storage: { type: 'local', root: './data/storage' },
  };

  if (existsSync(CONFIG_PATH)) {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = parse(raw) as Partial<AppConfig>;
    return {
      ...defaultConfig,
      ...parsed,
      server: { ...defaultConfig.server, ...parsed.server },
      auth: { ...defaultConfig.auth, ...parsed.auth },
      database: { ...defaultConfig.database, ...parsed.database },
      upload: { ...defaultConfig.upload, ...parsed.upload },
      file_storage: { ...defaultConfig.file_storage, ...parsed.file_storage },
    };
  }

  return defaultConfig;
}

/** 应用层配置单例（framework 段不在此，读取时需注意） */
export const config = loadConfig();

/**
 * RAG 全局默认配置：chunk/retrieval 取自 boot 容器的 rag 段，
 * rerank/no_match/query_rewrite 为 server 应用层扩展。
 */
export function getRagConfig(): RagConfig {
  const rag = getContainer().getConfig('rag');
  return {
    chunk: {
      size: rag.chunk_size,
      overlap: rag.chunk_overlap,
      strategy: 'recursive',
    },
    retrieval: {
      top_k: rag.retrieval_top_k,
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
}

export type { AppConfig, RagConfig };
