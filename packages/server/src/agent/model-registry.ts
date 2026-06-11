import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../data/db.js';

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

export function listModels(tenantId: string): ModelConfigRow[] {
  const db = getDb();
  return db.select().from(model_configs)
    .where(eq(model_configs.tenant_id, tenantId))
    .all() as ModelConfigRow[];
}

export function getDefaultModel(tenantId: string): ModelConfigRow | null {
  const db = getDb();
  const row = db.select().from(model_configs)
    .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.is_default, 1)))
    .limit(1)
    .get();
  if (row) return row as ModelConfigRow;
  return (db.select().from(model_configs)
    .where(eq(model_configs.tenant_id, tenantId))
    .limit(1)
    .get() as ModelConfigRow) || null;
}

export function getModelById(tenantId: string, id: string): ModelConfigRow | null {
  const db = getDb();
  return (db.select().from(model_configs)
    .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, id)))
    .get() as ModelConfigRow) || null;
}

export function addModel(tenantId: string, data: Omit<ModelConfigRow, 'id' | 'created_at'>): ModelConfigRow {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.insert(model_configs).values({
    id, tenant_id: tenantId, provider: data.provider, model_name: data.model_name,
    api_key_encrypted: data.api_key_encrypted, base_url: data.base_url || null,
    is_default: data.is_default || 0, created_at: now,
  }).run();
  return getModelById(tenantId, id)!;
}

export function updateModel(tenantId: string, id: string, data: Partial<ModelConfigRow>) {
  const db = getDb();
  const updateData: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && k !== 'id' && k !== 'tenant_id' && k !== 'created_at') {
      updateData[k] = v;
    }
  }
  if (Object.keys(updateData).length > 0) {
    db.update(model_configs).set(updateData)
      .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, id)))
      .run();
  }
}

export function deleteModel(tenantId: string, id: string) {
  getDb().delete(model_configs)
    .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, id)))
    .run();
}
