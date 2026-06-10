import { getDb } from '../data/db.js';
import { v4 as uuid } from 'uuid';

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
  return db.prepare('SELECT * FROM model_configs WHERE tenant_id = ?').all(tenantId) as ModelConfigRow[];
}

export function getDefaultModel(tenantId: string): ModelConfigRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM model_configs WHERE tenant_id = ? AND is_default = 1 LIMIT 1').get(tenantId);
  if (row) return row as ModelConfigRow;
  return (db.prepare('SELECT * FROM model_configs WHERE tenant_id = ? LIMIT 1').get(tenantId) as ModelConfigRow) || null;
}

export function getModelById(tenantId: string, id: string): ModelConfigRow | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM model_configs WHERE tenant_id = ? AND id = ?').get(tenantId, id) as ModelConfigRow) || null;
}

export function addModel(tenantId: string, data: Omit<ModelConfigRow, 'id' | 'created_at'>): ModelConfigRow {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.prepare(`INSERT INTO model_configs (id, tenant_id, provider, model_name, api_key_encrypted, base_url, is_default, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, tenantId, data.provider, data.model_name, data.api_key_encrypted, data.base_url || null, data.is_default, now
  );
  return getModelById(tenantId, id)!;
}

export function updateModel(tenantId: string, id: string, data: Partial<ModelConfigRow>) {
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && k !== 'id' && k !== 'tenant_id' && k !== 'created_at') {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length > 0) {
    vals.push(tenantId, id);
    db.prepare(`UPDATE model_configs SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...vals);
  }
}

export function deleteModel(tenantId: string, id: string) {
  getDb().prepare('DELETE FROM model_configs WHERE tenant_id = ? AND id = ?').run(tenantId, id);
}
