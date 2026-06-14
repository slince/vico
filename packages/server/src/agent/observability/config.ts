/**
 * Mastra Observability 配置
 *
 * 提供 getObservabilityConfig() 单例，配置 MastraStorageExporter（LibSQL 持久化）
 * 和 ConsoleExporter（开发调试），注入到 Mastra 构造函数的 observability 字段。
 */
import {
  MastraStorageExporter,
  ConsoleExporter,
  SamplingStrategyType,
} from '@mastra/observability';
import type { ObservabilityRegistryConfig } from '@mastra/observability';
import { SpanType } from '@mastra/core/observability';
import { getStorage } from '../../agent/memory-setup.js';

let _config: ObservabilityRegistryConfig | undefined;

export function getObservabilityConfig(): ObservabilityRegistryConfig {
  _config ??= {
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
  };
  return _config;
}
