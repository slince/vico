/**
 * 知识库搜索工具 UI — 将 search_knowledge_base 工具调用渲染为检索结果卡片。
 *
 * 生命周期状态机（error/rejected/running/approval）统一由 ToolCard 承载，
 * 本渲染器只提供审批文案与完成态的结果列表。
 */
import type {ToolCallMessagePartComponent} from '@assistant-ui/react';
import {useTranslation} from 'react-i18next';
import {Search, FileText} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {ToolCard} from './tool-card';
import type {KnowledgeSearchArgs, KnowledgeSearchResult} from '../knowledge-search.tool';

/** 解析 [source: filename#chunkN] content 格式 */
function parseSourceLine(line: string) {
  const match = line.match(/^\[source:\s*([^\]]+)\]\s*(.*)$/);
  if (!match) return null;
  const source = match[1].split('#');
  return {filename: source[0] || 'unknown', chunkIndex: source[1] || '', content: match[2]};
}

/** 完成态结果视图 — 查询头 + 结果列表 */
function SearchResult({result, fallbackQuery}: {result: KnowledgeSearchResult; fallbackQuery: string}) {
  const {t} = useTranslation('assistant');
  const {results, total, message} = result;
  const displayQuery = result.query ?? fallbackQuery;

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
            {t('tool.knowledgeSearch.resultCount', {count: total})}
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

export const KnowledgeSearchToolRenderer: ToolCallMessagePartComponent<KnowledgeSearchArgs, KnowledgeSearchResult> = ({status, args, result, isError, approval, interrupt, resume, addResult, respondToApproval}) => {
  const {t} = useTranslation('assistant');
  const fallbackQuery = String(args?.query ?? '');

  return (
    <ToolCard
      title={t('tool.knowledgeSearch.name')}
      icon={Search}
      status={status}
      result={result}
      isError={isError}
      approval={approval}
      interrupt={interrupt}
      resume={resume}
      addResult={addResult}
      respondToApproval={respondToApproval}
      approvalTitle={t('tool.knowledgeSearch.approvalTitle')}
      approvalDescription={t('tool.knowledgeSearch.query', {query: fallbackQuery})}
      errorLabel={t('tool.knowledgeSearch.failed')}
      runningLabel={t('tool.knowledgeSearch.searching')}
      rejectedLabel={t('tool.knowledgeSearch.rejected')}
      completeMode="bare"
    >
      {result && <SearchResult result={result} fallbackQuery={fallbackQuery} />}
    </ToolCard>
  );
};
