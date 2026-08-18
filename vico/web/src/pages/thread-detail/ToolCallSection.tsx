import { useTranslation } from 'react-i18next';
import { Wrench } from 'lucide-react';

import type { ToolCall, ToolCallSectionProps } from './types';
import { KnowledgeSearchSection } from './KnowledgeSearchSection';

/**
 * Safely parses the `tool_calls` JSON string on a message into an array of
 * `ToolCall` objects. Returns `null` for any unparseable / empty value.
 */
function parseToolCalls(raw?: string): ToolCall[] | null {
  if (!raw || raw === '[]' || raw === 'null') return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Tool names that have dedicated rendering components. */
const knowledgeSearchToolName = 'search_knowledge_base';

/**
 * Renders a collapsible "Tool Calls" section.
 *
 * Tool calls of type `search_knowledge_base` are rendered with a dedicated
 * {@link KnowledgeSearchSection} component; all others fall back to a generic
 * JSON pretty-print inside a `<pre>` block.
 */
export function ToolCallSection({ toolCallsRaw }: ToolCallSectionProps) {
  const { t } = useTranslation('threads');
  const toolCalls = parseToolCalls(toolCallsRaw);

  if (!toolCalls || toolCalls.length === 0) return null;

  const knowledgeCalls = toolCalls.filter(
    (tc) => tc.name === knowledgeSearchToolName,
  );
  const otherCalls = toolCalls.filter(
    (tc) => tc.name !== knowledgeSearchToolName,
  );

  return (
    <>
      {/* 知识库搜索工具调用 — 使用专用组件直接展开 */}
      {knowledgeCalls.map((tc, i) => (
        <KnowledgeSearchSection key={`ks-${i}`} toolCall={tc} />
      ))}

      {/* 其他工具调用 — 使用折叠面板 + JSON 展示 */}
      {otherCalls.length > 0 && (
        <details className="mt-2 group">
          <summary className="flex items-center gap-1 text-xs cursor-pointer opacity-70 hover:opacity-100 select-none">
            <Wrench size={12} />
            <span>
              {t('toolCall')} ({otherCalls.length})
            </span>
          </summary>

          <pre className="mt-1.5 p-2 bg-background rounded-md text-xs overflow-x-auto border">
            {JSON.stringify(otherCalls, null, 2)}
          </pre>
        </details>
      )}
    </>
  );
}
