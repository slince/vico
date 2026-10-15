import { describe, expect, it, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { ensureTables } from './migrate.js';
import { LibSqlThreadStore } from './libsql-thread-store.js';

describe('LibSqlThreadStore archiveMessages / includeArchived', () => {
  let store: LibSqlThreadStore;
  beforeAll(async () => {
    const client = createClient({ url: ':memory:' });
    const db = drizzle(client, { schema });
    await ensureTables(db as never);
    store = new LibSqlThreadStore({ db: db as never });
  });

  it('archiveMessages 软标记；includeArchived:false 排除', async () => {
    await store.createThread('a', 't', 'thread-1');
    const [m1, m2] = await store.appendEntries([
      { threadId: 'thread-1', turnId: 'turn-1', role: 'user', content: '"hi"' },
      { threadId: 'thread-1', turnId: 'turn-1', role: 'assistant', content: '"yo"' },
    ]);
    await store.archiveMessages('thread-1', [m1.id]);
    const active = await store.getEntries('thread-1', { includeArchived: false });
    expect(active.map((m) => m.id)).toEqual([m2.id]);
    const byTurn = await store.getEntriesByTurns(['turn-1'], { includeArchived: false });
    expect(byTurn.map((m) => m.id)).toEqual([m2.id]);
  });
});
