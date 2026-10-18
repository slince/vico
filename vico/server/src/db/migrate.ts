import pino from 'pino';
import { runMigrations } from './run-migrations.js';

// Standalone CLI execution — pnpm db:migrate（独立于 boot 容器，自建 logger）
await runMigrations(pino());
