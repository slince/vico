/**
 * Mastra Observability 配置
 *
 * 提供 getObservabilityConfig() 单例，配置 MastraStorageExporter（LibSQL 持久化）
 * 和 ConsoleExporter（开发调试），返回 ObservabilityEntrypoint 注入到 Mastra 构造函数。
 */
import {
  MastraStorageExporter,
  ConsoleExporter,
  SamplingStrategyType,
  Observability,
} from '@mastra/observability';
import { SpanType } from '@mastra/core/observability';

let _observability: Observability | undefined;

export function getObservabilityConfig(): Observability {
  if (!_observability) {
    _observability = new Observability({
      configs: {
        vico: {
          serviceName: 'vico',
          sampling: { type: SamplingStrategyType.ALWAYS },
          exporters: [
            new MastraStorageExporter(),
            new ConsoleExporter(),
          ],
          requestContextKeys: ['tenantId', 'userId', 'agentId'],
          excludeSpanTypes: [SpanType.MODEL_CHUNK],
        },
      },
    });
  }
  return _observability;
}
