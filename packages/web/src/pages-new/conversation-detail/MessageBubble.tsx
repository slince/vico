import { Badge } from '@/components/ui/badge';

import { ToolCallSection } from './ToolCallSection';
import type { Message, MessageBubbleProps } from './types';

/**
 * Returns a human-readable Chinese label for the given message role.
 *
 * @param role - the message role from the API
 * @returns localised role name
 */
function getRoleLabel(role: Message['role']): string {
  switch (role) {
    case 'user':
      return '用户';
    case 'assistant':
      return 'AI';
    case 'system':
      return '系统';
  }
}

/**
 * Returns the Badge variant that best visually represents the message role.
 *
 * - `user`     → `default`  (primary / prominent)
 * - `assistant` → `secondary` (accent)
 * - `system`    → `outline`   (muted / border)
 *
 * @param role - the message role
 * @returns Badge variant string
 */
function getRoleBadgeVariant(
  role: Message['role'],
): 'default' | 'secondary' | 'outline' {
  switch (role) {
    case 'user':
      return 'default';
    case 'assistant':
      return 'secondary';
    case 'system':
      return 'outline';
  }
}

/**
 * Determines the flexbox justification class for the message bubble wrapper.
 *
 * - user messages are right-aligned
 * - assistant messages are left-aligned
 * - system messages are centered
 *
 * @param role - the message role
 * @returns Tailwind flex justify class
 */
function getJustifyClass(role: Message['role']): string {
  switch (role) {
    case 'user':
      return 'justify-end';
    case 'assistant':
      return 'justify-start';
    case 'system':
      return 'justify-center';
  }
}

/**
 * Determines the background / border style class for the message bubble.
 *
 * - user      → primary bg + primary foreground text
 * - assistant → accent bg
 * - system    → muted bg + border
 *
 * @param role - the message role
 * @returns Tailwind classes for the bubble container
 */
function getBubbleStyle(role: Message['role']): string {
  switch (role) {
    case 'user':
      return 'bg-primary text-primary-foreground';
    case 'assistant':
      return 'bg-accent text-accent-foreground';
    case 'system':
      return 'bg-muted border text-muted-foreground';
  }
}

/**
 * Renders a single chat message as a styled bubble.
 *
 * Layout behaviour per role:
 * - `user`      – right-aligned, primary colour
 * - `assistant` – left-aligned, accent colour
 * - `system`    – centered, muted / bordered
 *
 * Each bubble displays a role Badge, a timestamp, the message content, and
 * (when applicable) a collapsible tool-call expander.
 *
 * @param props - component props
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const roleLabel = getRoleLabel(message.role);
  const badgeVariant = getRoleBadgeVariant(message.role);
  const justifyClass = getJustifyClass(message.role);
  const bubbleStyle = getBubbleStyle(message.role);

  return (
    <div className={`flex ${justifyClass}`}>
      {/* Bubble container constrained to 85 % of the parent width */}
      <div className={`max-w-[85%] rounded-lg px-4 py-3 ${bubbleStyle}`}>
        {/* Meta row: role badge + timestamp */}
        <div className="flex items-center gap-2 mb-1.5">
          <Badge variant={badgeVariant} className="text-xs">
            {roleLabel}
          </Badge>
          <span className="text-xs opacity-50">
            {new Date(message.created_at).toLocaleTimeString('zh-CN')}
          </span>
        </div>

        {/* Message text – preserve whitespace and line breaks */}
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>

        {/* Tool calls section (only rendered when tool_calls is non-trivial) */}
        {message.tool_calls && <ToolCallSection toolCallsRaw={message.tool_calls} />}
      </div>
    </div>
  );
}
