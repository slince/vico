import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain } from 'lucide-react';
import type { ContentPart } from '@vico/core';
import type { MessageContent } from './types';

interface ContentRendererProps {
  content: MessageContent;
  role: string;
}

/**
 * Renders the native content of a message.
 *
 * Supports both old flat-string format and new native parts array format:
 * - `reasoning` parts are rendered as a collapsible "thinking process" block
 * - `text` parts are rendered as Markdown (assistant) or plain text (user/system)
 * - Unknown parts are rendered as JSON for debugging
 */
export function ContentRenderer({ content, role }: ContentRendererProps) {
  const { t } = useTranslation('conversations');

  // Old format: plain string
  if (typeof content === 'string') {
    return role === 'assistant' ? (
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    ) : (
      <div className="whitespace-pre-wrap">{content}</div>
    );
  }

  // New format: native parts array
  return (
    <div className="space-y-3">
      {content.map((part, i) => {
        if (part.type === 'reasoning' && 'text' in part) {
          return (
            <details key={`r-${i}`} className="group">
              <summary className="flex items-center gap-1.5 text-xs cursor-pointer opacity-60 hover:opacity-100 select-none">
                <Brain size={13} />
                <span>{t('reasoningProcess')}</span>
              </summary>
              <div className="mt-2 p-3 bg-muted/50 rounded-md text-sm whitespace-pre-wrap text-muted-foreground border-l-2 border-muted-foreground/30">
                {part.text as string}
              </div>
            </details>
          );
        }

        if (part.type === 'text' && 'text' in part) {
          return role === 'assistant' ? (
            <Markdown key={`t-${i}`} remarkPlugins={[remarkGfm]}>{part.text as string}</Markdown>
          ) : (
            <div key={`t-${i}`} className="whitespace-pre-wrap">{part.text as string}</div>
          );
        }

        // Fallback for unknown parts (skip empty strings)
        return null;
      })}
    </div>
  );
}
