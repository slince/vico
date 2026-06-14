/**
 * 数据迁移：memory_entries -> Mastra WorkingMemory
 *
 * 将旧的自定义 memory_entries 表中的 working 类型记忆
 * 迁移到 Mastra 原生的 WorkingMemory 存储（mastra_resources 表）。
 *
 * 迁移逻辑：
 * 1. 读取 memory_entries 中 type='working' 的所有条目
 * 2. 按 (tenant_id, user_id) 分组
 * 3. 将每组内容合并为 Markdown 格式的工作记忆
 * 4. 写入 Mastra 的 mastra_resources 表（通过 LibSQLStore）
 *
 * 幂等性：若 resourceId 对应的资源已存在 workingMemory，则跳过该组
 * （避免重复迁移）
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db/init-libsql.js';
import { memory_entries } from '../db/schema.js';
import { getStorage } from '../agent/memory-setup.js';
import logger from '../lib/logger.js';

/** 分批查询的批大小 */
const BATCH_SIZE = 500;

/**
 * 从 memory_entries 表获取指定批次的 working 类型记忆
 */
async function fetchWorkingEntriesBatch(
  offset: number,
): Promise<typeof memory_entries.$inferSelect[]> {
  return getDb()
    .select()
    .from(memory_entries)
    .where(eq(memory_entries.type, 'working'))
    .limit(BATCH_SIZE)
    .offset(offset)
    .all();
}

/**
 * 将同一 (tenant_id, user_id) 下的多条记忆内容合并为 Markdown 格式
 */
function combineToWorkingMemory(
  entries: { content: string; importance: number }[],
): string {
  // 按 importance 降序排列，重要的在前
  const sorted = [...entries].sort((a, b) => b.importance - a.importance);
  return sorted
    .map((entry) => {
      const trimmed = entry.content.trim();
      // 若内容本身已是 Markdown 列表项，保持原样
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return trimmed;
      }
      return `- ${trimmed}`;
    })
    .join('\n');
}

/**
 * 将分组后的记忆数据迁移到 Mastra WorkingMemory 存储
 *
 * @param groups - 按 (tenant_id, user_id) 分组后的记忆条目 Map
 * @returns 成功迁移的资源数
 */
async function migrateGroups(
  groups: Map<string, { tenant_id: string; user_id: string; entries: typeof memory_entries.$inferSelect[] }>,
): Promise<number> {
  const memoryStore = await getStorage().getStore('memory');
  if (!memoryStore) {
    logger.warn('Mastra memory store not available, skipping memory_entries migration');
    return 0;
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const [_key, group] of groups) {
    try {
      // 使用 tenant_id::user_id 作为 resourceId，确保跨租户唯一
      const resourceId = `${group.tenant_id}::${group.user_id}`;

      // 检查是否已存在工作记忆（幂等检查）
      const existing = await memoryStore.getResourceById({ resourceId });
      if (existing?.workingMemory) {
        skipped++;
        continue;
      }

      const workingMemory = combineToWorkingMemory(group.entries);

      await memoryStore.updateResource({
        resourceId,
        workingMemory,
      });

      migrated++;
    } catch (err) {
      errors++;
      logger.warn(
        { err, tenant_id: group.tenant_id, user_id: group.user_id },
        'Failed to migrate memory_entries for user',
      );
    }
  }

  logger.info(
    {
      total_groups: groups.size,
      migrated,
      skipped,
      errors,
    },
    'memory_entries -> Mastra WorkingMemory migration completed',
  );

  return migrated;
}

/**
 * 执行 memory_entries 到 Mastra WorkingMemory 的迁移
 *
 * 非关键路径：失败时记录警告并跳过，不阻塞应用启动
 *
 * @returns 迁移的工作记忆条目数（失败返回 0）
 */
export async function migrateMemoryEntries(): Promise<number> {
  try {
    // 分批读取所有 working 类型的记忆条目
    const allEntries: typeof memory_entries.$inferSelect[] = [];
    let offset = 0;

    while (true) {
      const batch = await fetchWorkingEntriesBatch(offset);
      if (batch.length === 0) break;
      allEntries.push(...batch);
      offset += BATCH_SIZE;
    }

    if (allEntries.length === 0) {
      logger.info('No working memory entries found, skipping migration');
      return 0;
    }

    // 按 (tenant_id, user_id) 分组
    const groups = new Map<
      string,
      { tenant_id: string; user_id: string; entries: typeof memory_entries.$inferSelect[] }
    >();

    for (const entry of allEntries) {
      const key = `${entry.tenant_id}::${entry.user_id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          tenant_id: entry.tenant_id,
          user_id: entry.user_id,
          entries: [],
        });
      }
      groups.get(key)!.entries.push(entry);
    }

    logger.info(
      { total_entries: allEntries.length, total_groups: groups.size },
      'Starting memory_entries -> Mastra WorkingMemory migration',
    );

    return migrateGroups(groups);
  } catch (err) {
    logger.warn({ err }, 'memory_entries migration failed (non-critical)');
    return 0;
  }
}
