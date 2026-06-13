/** 模型配置表行类型 */
export interface ModelConfigRow {
  id: string;
  tenant_id: string;
  provider: string;
  model_name: string;
  api_key_encrypted: string;
  base_url: string | null;
  is_default: number;
  created_at: number;
}
