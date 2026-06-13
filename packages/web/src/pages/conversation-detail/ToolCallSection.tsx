import { useTranslation } from 'react-i18next';
import { Wrench } from 'lucide-react';

import type { ToolCall, ToolCallSectionProps } from './types';

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

/**
 * Renders a collapsible "Tool Calls" section using native HTML `<details>` /
 * `<summary>` elements.
 *
 * When expanded the component pretty-prints the parsed tool-call JSON array
 * inside a `<pre>` block.
 */
export function ToolCallSection({ toolCallsRaw }: ToolCallSectionProps) {
  const { t } = useTranslation('conversations');
  const toolCalls = parseToolCalls(toolCallsRaw);

  if (!toolCalls) return null;

  return (
    <details className="mt-2 group">
      <summary className="flex items-center gap-1 text-xs cursor-pointer opacity-70 hover:opacity-100 select-none">
        <Wrench size={12} />
        <span>{t('toolCall')} ({toolCalls.length})</span>
      </summary>

      <pre className="mt-1.5 p-2 bg-background rounded-md text-xs overflow-x-auto border">
        {JSON.stringify(toolCalls, null, 2)}
      </pre>
    </details>
  );
}
