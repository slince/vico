/**
 * 知识库搜索工具 UI — 将 search_knowledge_base 工具调用渲染为检索结果卡片。
 *
 * 对应服务端 createRagSearchTool (toolId: 'search_knowledge_base')，
 * status === 'running' 时显示骨架；status === 'complete' 时展示检索结果列表；
 * isError 时显示错误态。
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import { Search, FileText, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface KnowledgeSearchResult {
  results?: string[];
  total?: number;
  query?: string;
  message?: string;
}

/** 解析 [source: filename#chunkN] content 格式 */
function parseSourceLine(line: string) {
  const match = line.match(/^\[source:\s*([^\]]+)\]\s*(.*)$/);
  if (!match) return null;
  const source = match[1].split('#');
  return { filename: source[0] || 'unknown', chunkIndex: source[1] || '', content: match[2] };
}

export const KnowledgeSearchToolRenderer: ToolCallMessagePartComponent<
  { query?: string },
  KnowledgeSearchResult
> = ({ status, args, result, isError }) => {
  const { t } = useTranslation('assistant');
  if (status.type === 'running') {
    return (
      <div className="border rounded-lg p-3 my-2 bg-muted/30 animate-pulse">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="text-muted-foreground animate-spin" />
          <span className="text-sm text-muted-foreground">
            {t('tool.knowledgeSearch.searching')}
          </span>
        </div>
      </div>
    );
  }

  if (isError || status.type === 'incomplete') {
    return (
      <div className="border border-destructive/30 rounded-lg p-3 my-2 bg-destructive/5">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-destructive" />
          <span className="text-sm text-destructive">{t('tool.knowledgeSearch.failed')}</span>
        </div>
      </div>
    );
  }

  const data = result as KnowledgeSearchResult | undefined;
  if (!data) return null;

  const { results, total, query, message } = data;
  const displayQuery = query ?? args?.query ?? '';

  return (
    <div className="border rounded-lg my-2 bg-muted/30 overflow-hidden">
      {/* 头部：查询内容 + 结果数量 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50">
        <Search size={13} className="text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">
          {displayQuery}
        </span>
        {total !== undefined && (
          <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">
            {t('tool.knowledgeSearch.resultCount', { count: total })}
          </Badge>
        )}
      </div>

      {/* 结果列表 */}
      {results && results.length > 0 ? (
        <div className="divide-y divide-border/50">
          {results.map((line, i) => {
            const parsed = parseSourceLine(line);
            return (
              <div key={i} className="px-3 py-2 text-xs">
                {/* 来源文件名 + chunk 序号 */}
                <div className="flex items-center gap-1 mb-1 text-muted-foreground">
                  <FileText size={10} />
                  <span className="font-mono text-[11px]">
                    {parsed?.filename ?? 'unknown'}
                  </span>
                  {parsed?.chunkIndex && (
                    <span className="text-[10px] opacity-60">
                      #{parsed.chunkIndex}
                    </span>
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
          {message || t('tool.knowledgeSearch.noResults')}
        </div>
      )}
    </div>
  );
};
