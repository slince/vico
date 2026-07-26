/**
 * 知识库搜索工具 UI — 将 search_knowledge_base 工具调用渲染为检索结果卡片。
 *
 * 状态机：requires-action → running → complete（展示结果列表）
 * approval.approved === false → 审批拒绝 → 展示已拒绝状态
 * isError / incomplete → 错误提示
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import { Search, FileText, Loader2, Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ToolApprovalCard } from '@/components/assistant-ui/tool-approval-card';
import type { KnowledgeSearchArgs, KnowledgeSearchResult } from '../knowledge-search.tool';

/** 解析 [source: filename#chunkN] content 格式 */
function parseSourceLine(line: string) {
  const match = line.match(/^\[source:\s*([^\]]+)\]\s*(.*)$/);
  if (!match) return null;
  const source = match[1].split('#');
  return { filename: source[0] || 'unknown', chunkIndex: source[1] || '', content: match[2] };
}

export const KnowledgeSearchToolRenderer: ToolCallMessagePartComponent<KnowledgeSearchArgs, KnowledgeSearchResult> = ({ status, args, result, isError, approval, respondToApproval }) => {
  const { t } = useTranslation('assistant');

  // 审批已裁决（被拒绝或已批准且有结果）
  if (approval?.approved !== undefined || result !== undefined) {
    const isApproved = approval?.approved ?? true;

    // 审批拒绝
    if (!isApproved) {
      return (
        <div className="border border-destructive/30 rounded-lg p-3 my-2 bg-destructive/5">
          <div className="flex items-center gap-2">
            <X size={16} className="text-destructive" />
            <span className="text-sm text-destructive">{t('tool.knowledgeSearch.rejected')}</span>
          </div>
        </div>
      );
    }

    // 审批通过 → 展示检索结果
    const data = result as KnowledgeSearchResult | undefined;
    if (data) {
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
    }
  }

  // 需要审批
  if (status.type === 'requires-action') {
    return (
      <ToolApprovalCard
        toolName="知识库检索"
        title="知识库检索需要确认"
        description={`查询内容：${String(args?.query ?? '')}`}
        respondToApproval={respondToApproval}
      />
    );
  }

  // 执行中
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

  // 错误
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

  return null;
};
