// 1. Third-party
import { useQuery } from '@tanstack/react-query';

// 2. API / Hooks
import { api } from '@/api/client';
import { useChat } from '@/providers/chat-provider';

// 3. UI / 子组件
import {
  ModelSelector,
  type ModelOption,
} from './elements/model-selector.aui';

// 4. 类型
import type { LlmCatalog } from '@/pages/settings/providers';

/**
 * 将 catalog 中厂商的对话模型映射为 ModelSelector 可用的选项。
 *
 * 仅取具体模型（kind === 'model'）且无 model_type 的条目（chat 模型），
 * 并根据 reasoning 标记是否展示 reasoning effort 档位。
 */
function toModelOptions(catalog: LlmCatalog, providerId: string): ModelOption[] {
  const provider = catalog.providers.find((p) => p.id === providerId);
  if (!provider) return [];
  return (provider.models ?? [])
    .filter((m) => m.kind === 'model' && !m.model_type)
    .map((m) => ({
      id: m.id ?? m.name,
      name: m.name,
      efforts: m.reasoning ? (true as const) : undefined,
    }));
}

/**
 * Composer 中的模型选择器。
 *
 * 下拉模型不再写死，而是根据当前选中 Agent 的 LLM 提供商（`llm.provider`，
 * 由 `/api/v1/agents` 列表接口返回）从 catalog 接口读取该厂商支持的对话模型；
 * 默认选中 Agent 绑定的模型名（`llm.model`）。切换 Agent 时通过 key 强制重建以刷新默认值。
 */
export function ModelSelectorAction() {
  const { selectedAgent, isChatRoute } = useChat();

  const { data: catalog } = useQuery<LlmCatalog>({
    queryKey: ['llm-providers'],
    queryFn: () => api('/llm-providers'),
    enabled: isChatRoute,
  });

  const providerId = selectedAgent?.llm?.provider;
  const models = catalog && providerId ? toModelOptions(catalog, providerId) : [];

  if (!isChatRoute || !providerId || models.length === 0) return null;

  return (
    <ModelSelector
      key={selectedAgent?.id}
      models={models}
      defaultValue={selectedAgent?.llm?.model}
      size="sm"
    />
  );
}
