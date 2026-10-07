import {eq} from 'drizzle-orm';
import {v4 as uuid} from 'uuid';
import {getDb, schema} from '../../db/db.js';
import {decryptApiKey, encryptApiKey} from '../../lib/crypto.js';
import type {ModelConfigRow} from './types.js';

const { model_configs } = schema;

/**
 * 模型管理服务。
 * 封装 LLM 模型配置的 CRUD 和加密/解密逻辑。
 */
class ModelManager {
  /** 获取所有模型配置 */
  async list(): Promise<ModelConfigRow[]> {
    const db = getDb();
    const rows = await db.select().from(model_configs).all();
    return rows.map((r) => ({ ...r, api_key: decryptApiKey(r.api_key) })) as ModelConfigRow[];
  }

  /** 按 ID 获取模型配置 */
  async getById(id: string): Promise<ModelConfigRow | null> {
    const db = getDb();
    const row = await db.select().from(model_configs)
      .where(eq(model_configs.id, id))
      .get();
    if (!row) return null;
    return { ...row, api_key: decryptApiKey(row.api_key) } as ModelConfigRow;
  }

  /** 新增模型配置，若设为默认则先取消同类型下的其他默认 */
  async create(data: Omit<ModelConfigRow, 'id' | 'created_at'>): Promise<ModelConfigRow> {
    const db = getDb();
    const id = uuid();
    const now = Date.now();
    const modelType = data.model_type ?? 'chat';
    const isDefault = data.is_default ? 1 : 0;
    if (isDefault) {
      await db.update(model_configs).set({ is_default: 0 })
        .where(eq(model_configs.model_type, modelType)).run();
    }
    await db.insert(model_configs).values({
      id, provider: data.provider, model_name: data.model_name,
      api_key: encryptApiKey(data.api_key), base_url: data.base_url || null,
      model_type: modelType,
      is_default: isDefault, created_at: now,
    }).run();
    return (await this.getById(id))!;
  }

  /** 更新模型配置，若设为默认则先取消目标类型下的其他默认 */
  async update(id: string, data: Partial<ModelConfigRow>): Promise<void> {
    const db = getDb();
    const existing = await db.select().from(model_configs)
      .where(eq(model_configs.id, id)).get();
    if (!existing) return;
    const targetType = data.model_type ?? existing.model_type;
    if (data.is_default === 1) {
      await db.update(model_configs).set({ is_default: 0 })
        .where(eq(model_configs.model_type, targetType)).run();
    }
    const updateData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && k !== 'id' && k !== 'created_at') {
        updateData[k] = k === 'api_key' ? encryptApiKey(v as string) : v;
      }
    }
    if (Object.keys(updateData).length > 0) {
      await db.update(model_configs).set(updateData)
        .where(eq(model_configs.id, id))
        .run();
    }
  }

  /** 删除模型配置 */
  async remove(id: string): Promise<void> {
    await getDb().delete(model_configs)
      .where(eq(model_configs.id, id))
      .run();
  }
}

/** 模型管理服务单例 */
export const modelManager = new ModelManager();
