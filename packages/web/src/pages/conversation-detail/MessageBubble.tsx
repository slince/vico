import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { formatTimeOnly } from '@/lib/date-format';

import { ToolCallSection } from './ToolCallSection';
import type { Message, MessageBubbleProps } from './types';

/**
 * Renders a single chat message as a styled bubble.
 *
 * Layout behaviour per role:
 * - user      – right-aligned, primary colour
 * - assistant – left-aligned, accent colour
 * - system    – centered, muted / bordered
 *
 * Each bubble displays a role Badge, a timestamp, the message content, and
 * (when applicable) a collapsible tool-call expander.
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const { t } = useTranslation('conversations');

  const roleLabelMap: Record<Message['role'], string> = {
    user: t('roleUser'),
    assistant: t('roleAssistant'),
    system: t('roleSystem'),
  };

  const badgeVariantMap: Record<Message['role'], 'default' | 'secondary' | 'outline'> = {
    user: 'default',
    assistant: 'secondary',
    system: 'outline',
  };

  const justifyMap: Record<Message['role'], string> = {
    user: 'justify-end',
    assistant: 'justify-start',
    system: 'justify-center',
  };

  const styleMap: Record<Message['role'], string> = {
    user: 'bg-primary text-primary-foreground',
    assistant: 'bg-accent text-accent-foreground',
    system: 'bg-muted border text-muted-foreground',
  };

  const roleLabel = roleLabelMap[message.role];
  const badgeVariant = badgeVariantMap[message.role];
  const justifyClass = justifyMap[message.role];
  const bubbleStyle = styleMap[message.role];

  return (
    <div className={`flex ${justifyClass}`}>
      <div className={`max-w-[85%] rounded-lg px-4 py-3 ${bubbleStyle}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <Badge variant={badgeVariant} className="text-xs">
            {roleLabel}
          </Badge>
          <span className="text-xs opacity-50">
            {formatTimeOnly(message.created_at)}
          </span>
        </div>

        <div className="text-sm whitespace-pre-wrap">{message.content}</div>

        {message.tool_calls && <ToolCallSection toolCallsRaw={message.tool_calls} />}
      </div>
    </div>
  );
}
