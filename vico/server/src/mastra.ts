/**
 * 兼容入口 — 原 Mastra 入口已替换为 Vico Agent 框架。
 * 所有 Mastra 依赖已移除，Agent 管理迁移至 chat/chat.ts。
 */
export { vico, app, initVico } from './vico.js';
