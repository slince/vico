import { useTranslation } from 'react-i18next';
import { Search, FileText, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import type { ToolCall } from './types';

interface KnowledgeSearchSectionProps {
  toolCall: ToolCall;
}

interface KnowledgeSearchResult {
  results?: string[];
  total?: number;
  query?: string;
  message?: string;
}

/**
 * 解析 source 标记 [source: filename#chunkN] content
 * 返回 { filename, chunkIndex, content }
 */
function parseSourceLine(line: string) {
  const match = line.match(/^\[source:\s*([^\]]+)\]\s*(.*)$/);
  if (!match) return null;
  const source = match[1].split('#');
  return {
    filename: source[0] || 'unknown',
    chunkIndex: source[1] || '',
    content: match[2],
  };
}

/**
 * 知识库检索工具调用展示组件。
 *
 * 将 search_knowledge_base 工具调用结果以卡片形式展示，
 * 每条结果展示源文件名和内容片段，比原始 JSON 更易读。
 */
export function KnowledgeSearchSection({ toolCall }: KnowledgeSearchSectionProps) {
  const { t } = useTranslation('conversations');
  const result = toolCall.result as KnowledgeSearchResult | undefined;

  if (!result) return null;

  const { results, total, query, message } = result;

  return (
    <div className="mt-2 rounded-lg border bg-muted/30">
      {/* 头部：搜索图标 + 查询内容 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50 rounded-t-lg">
        <Search size={14} className="text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground">
          {t('knowledgeSearch')}:
        </span>
        <span className="text-xs font-medium">
          {query ?? (toolCall.arguments?.query as string) ?? '—'}
        </span>
        {total !== undefined && (
          <Badge variant="secondary" className="text-[10px] ml-auto">
            {t('knowledgeResultCount', { count: total })}
          </Badge>
        )}
      </div>

      {/* 结果列表 */}
      {results && results.length > 0 ? (
        <div className="divide-y divide-border/50">
          {results.map((line, i) => {
            const parsed = parseSourceLine(line);
            return (
              <div
                key={i}
                className={cn(
                  'px-3 py-2.5 text-xs',
                  i % 2 === 0 ? 'bg-background/50' : 'bg-background/30',
                )}
              >
                {/* 来源文件名 */}
                <div className="flex items-center gap-1 mb-1 text-muted-foreground">
                  <FileText size={10} />
                  <span className="font-mono text-[11px]">
                    {parsed?.filename ?? 'unknown'}
                  </span>
                  {parsed?.chunkIndex && (
                    <>
                      <ChevronRight size={10} />
                      <span className="text-[10px] opacity-70">
                        chunk {parsed.chunkIndex}
                      </span>
                    </>
                  )}
                </div>
                {/* 内容片段 */}
                <div className="text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
                  {parsed?.content ?? line}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-3 py-3 text-xs text-muted-foreground">
          {message || t('knowledgeNoResults')}
        </div>
      )}
    </div>
  );
}
