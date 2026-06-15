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
      workspace: { ...defaultConfig.workspace, ...parsed.workspace },
    };
    return merged;
  }

  return defaultConfig;
}

export const config = loadConfig();
export type { AppConfig };
