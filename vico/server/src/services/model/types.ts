/** 模型配置表行类型 */
export interface ModelConfigRow {
  id: string;
  provider: string;
  model_name: string;
  api_key: string;
  base_url?: string;
  /** 模型类型：chat / embedding / rerank / vllm / asr */
  model_type: string;
  is_default: number;
  created_at: number;
}
