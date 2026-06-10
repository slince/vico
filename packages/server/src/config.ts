import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LLMModelConfig {
  provider: 'openai' | 'anthropic' | 'deepseek' | 'qwen' | 'custom';
  model_name: string;
  api_key: string;
  base_url?: string;
}

interface AppConfig {
  server: {
    port: number;
    deploy_mode: 'private' | 'saas';
  };
  auth: {
    jwt_secret: string;
    token_expiry: string;
  };
  database: {
    path: string;
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
    embedder: 'local' | 'api';
    embedder_model: string;
  };
  llm: {
    models: LLMModelConfig[];
  };
}

function resolveEnv(value: string): string {
  if (value.startsWith('${') && value.endsWith('}')) {
    const envKey = value.slice(2, -1);
    return process.env[envKey] || value;
  }
  return value;
}

function loadConfig(): AppConfig {
  const configPath = process.env.CONFIG_PATH || resolve(__dirname, '../server.config.yaml');
  const defaultConfig: AppConfig = {
    server: { port: 3001, deploy_mode: 'private' },
    auth: { jwt_secret: 'dev-secret-change-me', token_expiry: '7d' },
    database: { path: resolve(__dirname, '../data/vico.db') },
    skills: { scan_paths: [resolve(__dirname, '../../skills'), resolve(__dirname, '../data/custom-skills')] },
    memory: { stm_window: 20, ltm_auto_extract: true, ltm_max_entries: 10000 },
    rag: { chunk_size: 512, chunk_overlap: 64, retrieval_top_k: 5, embedder: 'local', embedder_model: 'Xenova/all-MiniLM-L6-v2' },
    llm: { models: [] },
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
      llm: { ...defaultConfig.llm, ...parsed.llm },
    };
    if (merged.llm.models) {
      merged.llm.models = merged.llm.models.map((m) => ({
        ...m,
        api_key: resolveEnv(m.api_key),
      }));
    }
    return merged;
  }

  return defaultConfig;
}

export const config = loadConfig();
export type { AppConfig, LLMModelConfig };
