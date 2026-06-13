import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../db/db.js';
import { encryptApiKey, decryptApiKey } from '../lib/crypto.js';

const { model_configs } = schema;

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

export async function listModels(tenantId: string): Promise<ModelConfigRow[]> {
  const db = getDb();
  const rows = await db.select().from(model_configs)
    .where(eq(model_configs.tenant_id, tenantId))
    .all();
  return rows.map((r) => ({ ...r, api_key_encrypted: decryptApiKey(r.api_key_encrypted) })) as ModelConfigRow[];
}

export async function getDefaultModel(tenantId: string): Promise<ModelConfigRow | null> {
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

export async function getModelById(tenantId: string, id: string): Promise<ModelConfigRow | null> {
  const db = getDb();
  const row = await db.select().from(model_configs)
    .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, id)))
    .get();
  if (!row) return null;
  return { ...row, api_key_encrypted: decryptApiKey(row.api_key_encrypted) } as ModelConfigRow;
}

export async function addModel(tenantId: string, data: Omit<ModelConfigRow, 'id' | 'created_at'>): Promise<ModelConfigRow> {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  await db.insert(model_configs).values({
    id, tenant_id: tenantId, provider: data.provider, model_name: data.model_name,
    api_key_encrypted: encryptApiKey(data.api_key_encrypted), base_url: data.base_url || null,
    is_default: data.is_default || 0, created_at: now,
  }).run();
  return (await getModelById(tenantId, id))!;
}

export async function updateModel(tenantId: string, id: string, data: Partial<ModelConfigRow>) {
  const db = getDb();
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

export async function deleteModel(tenantId: string, id: string) {
  await getDb().delete(model_configs)
    .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, id)))
    .run();
}
