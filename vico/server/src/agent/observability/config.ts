/**
 * Observability 配置 — 不再依赖 Mastra Observability。
 *
 * 使用 @vico/agent 的 EventRecorder + SpanTracker 进行观测。
 * 导出空配置以保持 API 兼容性。
 */
export function getObservabilityConfig(): null {
  return null;
}
