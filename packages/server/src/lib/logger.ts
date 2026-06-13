/**
 * 结构化日志 — 基于 pino
 *
 * 每条日志自动携带 timestamp、level、component 等字段。
 * 在生产环境中可配置输出到文件或日志聚合服务。
 */
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // 开发环境使用 pino-pretty 友好的输出格式
  transport: process.env.NODE_ENV === 'production' ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss' },
  },
});

export default logger;

/**
 * 为给定模块创建子 logger，自动注入 component 标识。
 *
 * @param component - 模块名称（如 'rag', 'agent-factory', 'chat'）
 */
export function createLogger(component: string) {
  return logger.child({ component });
}
