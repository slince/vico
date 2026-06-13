import { Wrench } from 'lucide-react';

import type { ToolCall, ToolCallSectionProps } from './types';

/**
 * Safely parses the `tool_calls` JSON string on a message into an array of
 * `ToolCall` objects. Returns `null` for any unparseable / empty value.
 *
 * @param raw - the raw `tool_calls` string from the API
 * @returns parsed array, or `null` if parsing fails
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
 *
 * @param props - component props
 */
export function ToolCallSection({ toolCallsRaw }: ToolCallSectionProps) {
  const toolCalls = parseToolCalls(toolCallsRaw);

  // Do not render anything if the JSON was empty or unparseable
  if (!toolCalls) return null;

  return (
    <details className="mt-2 group">
      {/* Collapsible summary row with wrench icon and call count */}
      <summary className="flex items-center gap-1 text-xs cursor-pointer opacity-70 hover:opacity-100 select-none">
        <Wrench size={12} />
        <span>工具调用 ({toolCalls.length})</span>
      </summary>

      {/* Pretty-printed JSON body */}
      <pre className="mt-1.5 p-2 bg-background rounded-md text-xs overflow-x-auto border">
        {JSON.stringify(toolCalls, null, 2)}
      </pre>
    </details>
  );
}
