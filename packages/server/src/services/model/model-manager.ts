import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../db/db.js';
import { encryptApiKey, decryptApiKey } from '../../lib/crypto.js';
import { resolveModelProvider } from '../../agent/bridges/model-bridge.js';
import type { ModelConfigRow } from './types.js';
import type { MastraModelConfig } from '@mastra/core/llm';

const { model_configs } = schema;

/**
 * 模型管理服务。
 * 封装 LLM 模型配置的 CRUD 和加密/解密逻辑。
 */
class ModelManager {
  /** 获取租户下所有模型配置 */
  async list(tenantId: string): Promise<ModelConfigRow[]> {
    const db = getDb();
    const rows = await db.select().from(model_configs)
      .where(eq(model_configs.tenant_id, tenantId))
      .all();
    return rows.map((r) => ({ ...r, api_key_encrypted: decryptApiKey(r.api_key_encrypted) })) as ModelConfigRow[];
  }

  /** 获取租户的默认模型，若无则返回第一个可用模型 */
  async getDefault(tenantId: string): Promise<ModelConfigRow | null> {
    const db = getDb();
    const row = await db.select().from(model_configs)
      .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.is_default, 1)))
      .limit(1)
      .get();
    const result = row
      ? { ...row, api_key_encrypted: decryptApiKey(row.api_key_encrypted) }
      : (await db.select().from(model_configs)
          .where(eq(model_configs.tenant_id, tenantId))
          .limit(1)
          .get());
    if (result) {
      (result as ModelConfigRow).api_key_encrypted = decryptApiKey((result as ModelConfigRow).api_key_encrypted);
    }
    return result as ModelConfigRow | null;
  }

  /** 按 ID 获取模型配置 */
  async getById(tenantId: string, id: string): Promise<ModelConfigRow | null> {
    const db = getDb();
    const row = await db.select().from(model_configs)
      .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, id)))
      .get();
    if (!row) return null;
    return { ...row, api_key_encrypted: decryptApiKey(row.api_key_encrypted) } as ModelConfigRow;
  }

  /**
   * 根据模型 ID 查询配置并转换为 Mastra 可用的模型实例。
   *
   * 组合 getById + resolveModelProvider，调用方只需传入 model_id 即可获得
   * 可直接注入 Mastra Agent 的模型对象。
   *
   * @returns MastraModelConfig 实例，未找到时返回 null
   */
  async resolveModelConfig(tenantId: string, modelId: string): Promise<MastraModelConfig | null> {
    const config = await this.getById(tenantId, modelId);
    if (!config) return null;
    return resolveModelProvider(config);
  }

  /** 新增模型配置，若设为默认则先取消其他默认 */
  async create(tenantId: string, data: Omit<ModelConfigRow, 'id' | 'created_at'>): Promise<ModelConfigRow> {
    const db = getDb();
    const id = uuid();
    const now = Date.now();
    const isDefault = data.is_default ? 1 : 0;
    if (isDefault) {
      await db.update(model_configs).set({ is_default: 0 })
        .where(eq(model_configs.tenant_id, tenantId))
        .run();
    }
    await db.insert(model_configs).values({
      id, tenant_id: tenantId, provider: data.provider, model_name: data.model_name,
      api_key_encrypted: encryptApiKey(data.api_key_encrypted), base_url: data.base_url || null,
      is_default: isDefault, created_at: now,
    }).run();
    return (await this.getById(tenantId, id))!;
  }

  /** 更新模型配置，若设为默认则先取消其他默认 */
  async update(tenantId: string, id: string, data: Partial<ModelConfigRow>): Promise<void> {
    const db = getDb();
    if (data.is_default === 1) {
      await db.update(model_configs).set({ is_default: 0 })
        .where(eq(model_configs.tenant_id, tenantId))
        .run();
    }
    const updateData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && k !== 'id' && k !== 'tenant_id' && k !== 'created_at') {
        updateData[k] = k === 'api_key_encrypted' ? encryptApiKey(v as string) : v;
      }
    }
    if (Object.keys(updateData).length > 0) {
      await db.update(model_configs).set(updateData)
        .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, id)))
        .run();
    }
  }

  /** 删除模型配置 */
  async remove(tenantId: string, id: string): Promise<void> {
    await getDb().delete(model_configs)
      .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, id)))
      .run();
  }
}

/** 模型管理服务单例 */
export const modelManager = new ModelManager();
