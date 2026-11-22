/**
 * 贪吃蛇应用后端 — 由 vico 以子 app 形式注入到 `/api/apps/snake-demo/`。
 *
 * 这是轻应用后端契约的完整示例：
 * - 默认导出 `setup(app, ctx)`；`app` 是 vico 提供的 Hono 子实例
 * - `ctx.dataDir` 是应用私有持久目录，应用自行在里面创建/管理 SQLite
 * - 不需要依赖 vico 内部包，只使用 Node 内置能力
 */
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * 挂载应用路由。
 * @param {import('hono').Hono} app vico 注入的子 app
 * @param {{ appId: string, dataDir: string, logger: import('pino').Logger }} ctx 应用上下文
 */
export default async function setup(app, ctx) {
  const db = new DatabaseSync(join(ctx.dataDir, 'scores.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  const selectTop = db.prepare(
    'SELECT id, name, score, created_at FROM scores ORDER BY score DESC, created_at ASC LIMIT 20',
  );
  const insertScore = db.prepare('INSERT INTO scores (name, score, created_at) VALUES (?, ?, ?)');

  /** 健康检查：用于确认应用后端已挂载 */
  app.get('/health', (c) => c.json({ ok: true, app: ctx.appId }));

  /** 排行榜（按分数倒序，最多 20 条） */
  app.get('/scores', (c) => c.json(selectTop.all()));

  /** 提交分数 */
  app.post('/scores', async (c) => {
    const body = await c.req.json().catch(() => null);
    const rawScore = Number(body?.score);
    if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1000000) {
      return c.json({ error: 'score 必须是 0 - 1000000 之间的数字' }, 400);
    }

    // 名字只保留安全字符，空值回退匿名
    const name = String(body?.name ?? '')
      .replace(/[\u0000-\u001f<>]/g, '')
      .trim()
      .slice(0, 16) || '匿名玩家';

    insertScore.run(name, Math.floor(rawScore), Date.now());
    ctx.logger.info({ name, score: rawScore }, 'snake score submitted');
    return c.json(selectTop.all());
  });
}
