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
  /** 上下文窗口（token），可空；未设置时沿用全局默认 */
  context_window: number | null;
  /** 单次回复最大输出 tokens，可空 */
  max_output_tokens: number | null;
  created_at: number;
}
