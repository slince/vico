/**
 * 模型厂商目录（catalog）类型与辅助函数。
 *
 * 数据来自 GET /api/v1/llm-providers（服务端按厂商拆分的 llm/providers/*.json）。
 * 提供模型类型常量、按类型筛选厂商、Base URL 推断、模型名建议等纯函数。
 */

/** 模型类型标识（与 catalog 的 provider.model_types 小写值一致） */
export type ModelType = 'chat' | 'embedding' | 'rerank' | 'vllm' | 'asr';

/** 设置页模型类型 tab 定义（i18nKey 指向 settings.json 的 llm.types.*） */
export const MODEL_TYPES: { value: ModelType; i18nKey: string }[] = [
  { value: 'chat', i18nKey: 'llm.types.chat' },
  { value: 'embedding', i18nKey: 'llm.types.embedding' },
  { value: 'rerank', i18nKey: 'llm.types.rerank' },
  { value: 'vllm', i18nKey: 'llm.types.vllm' },
  { value: 'asr', i18nKey: 'llm.types.asr' },
];

/** 非对话类型 → catalog 模型条目 model_type 的英文映射 */
const NON_CHAT_MODEL_TYPE: Record<string, string> = {
  embedding: 'Embedding',
  rerank: 'Rerank',
  asr: 'ASR',
};

/** catalog 中的单个模型条目（model 为具体模型，pattern 为通配符） */
export interface CatalogModel {
  kind: 'model' | 'pattern';
  id?: string;
  match?: string;
  name: string;
  /** 仅 embedding/rerank/asr 模型携带；chat/vllm 模型缺省 */
  model_type?: string;
}

/** 单个厂商条目 */
export interface ProviderEntry {
  id: string;
  name: string;
  name_en?: string;
  order?: number;
  /** 按类型 key 的 Base URL（chat/embedding/rerank/vllm/asr 等） */
  base_urls?: Record<string, string>;
  /** 该厂商支持的模型类型（小写） */
  model_types?: string[];
  model_type_labels?: string[];
  models?: CatalogModel[];
}

/** /api/v1/llm-providers 返回结构 */
export interface LlmCatalog {
  meta: unknown;
  providers: ProviderEntry[];
}

/**
 * 筛选支持指定模型类型的厂商。
 * `generic`（自定义 OpenAI 兼容）恒保留，供用户手动填写。
 */
export function filterProvidersByType(providers: ProviderEntry[], type: ModelType): ProviderEntry[] {
  return providers.filter((p) => p.id === 'generic' || (p.model_types ?? []).includes(type));
}

/**
 * 推断厂商在指定类型下的默认 Base URL。
 * 优先取该类型的 base_urls[type]，无则回退 chat，再回退空串。
 */
export function getProviderBaseUrl(provider: ProviderEntry | undefined, type: ModelType): string {
  if (!provider) return '';
  return provider.base_urls?.[type] ?? provider.base_urls?.chat ?? '';
}

/**
 * 获取指定厂商 + 类型下的模型名建议列表。
 * - embedding/rerank/asr：按条目 model_type 精确匹配
 * - chat/vllm：取无 model_type 的具体模型（kind === 'model'）
 */
export function getModelSuggestions(provider: ProviderEntry | undefined, type: ModelType): string[] {
  if (!provider) return [];
  const models = provider.models ?? [];
  if (type === 'embedding' || type === 'rerank' || type === 'asr') {
    const target = NON_CHAT_MODEL_TYPE[type];
    return models
      .filter((m) => m.model_type === target)
      .map((m) => m.id ?? m.match ?? m.name);
  }
  return models
    .filter((m) => m.kind === 'model' && !m.model_type)
    .map((m) => m.id ?? m.name);
}
