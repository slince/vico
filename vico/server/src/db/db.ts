// Re-export from new libsql init
// Legacy better-sqlite3 exports removed — use getDb() and getClient() instead
export { getDb, getClient, getDatabaseUrl, schema } from './init-libsql.js';
