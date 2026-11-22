// 1. React
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// 2. Third-party
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, RefreshCw, SquareArrowOutUpRight } from 'lucide-react';

// 3. API / Hooks / Utils
import { api } from '@/api/client';

// 4. UI components
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription, EmptyTitle, EmptyMedia } from '@/components/ui/empty';

// 5. Types
import type { LightAppSummary } from '@/types/apps';

/**
 * 轻应用运行时页面（`/apps/:appId`）。
 *
 * 应用前端通过 iframe 加载：默认走 vico 静态托管 `/app-static/<id>/`；
 * 若应用尚未构建但声明了 `dev.url`（应用自己的 vite dev server），回退到该地址，
 * 方便应用本地开发时热更新。
 */
export default function LightApp() {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('apps');
  const [reloadKey, setReloadKey] = useState(0);

  const { data: app, isLoading, isError } = useQuery<LightAppSummary>({
    queryKey: ['apps', appId],
    queryFn: () => api(`/apps/${appId}`),
    enabled: Boolean(appId),
  });

  const backButton = (
    <Button variant="ghost" size="sm" onClick={() => navigate('/apps')}>
      <ArrowLeft size={15} className="mr-1" />
      {t('backToCenter')}
    </Button>
  );

  // ====================== 加载态 ======================
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-[calc(100vh-8rem)] w-full rounded-xl" />
      </div>
    );
  }

  // ====================== 加载失败 / 未安装 / 已禁用 ======================
  if (isError || !app || !app.installed || !app.enabled) {
    return (
      <div className="space-y-4">
        {backButton}
        <Empty>
          <EmptyMedia variant="icon"><SquareArrowOutUpRight size={32} /></EmptyMedia>
          <EmptyTitle>{t('notAvailableTitle')}</EmptyTitle>
          <EmptyDescription>{t('notAvailableDescription')}</EmptyDescription>
          <Button variant="outline" size="sm" onClick={() => navigate('/apps')}>
            {t('backToCenter')}
          </Button>
        </Empty>
      </div>
    );
  }

  // 静态托管优先；未构建时回退到应用自己的 dev server
  const src = !app.frontendBuilt && app.devUrl ? app.devUrl : `/app-static/${app.id}/`;
  const iconIsImage = /\.(svg|png|jpg|jpeg|webp|gif|ico)$/i.test(app.icon);
  const iconSrc = /^(https?:)?\/\//.test(app.icon) ? app.icon : `/app-static/${app.id}/${app.icon.replace(/^\.?\//, '')}`;

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-3rem)]">
      {/* 应用栏：返回、图标、标题、状态、刷新/新窗口 */}
      <div className="flex flex-wrap items-center gap-2">
        {backButton}
        <div className="flex items-center gap-2 min-w-0">
          {iconIsImage ? (
            <img src={iconSrc} alt="" className="h-5 w-5 rounded object-cover shrink-0" />
          ) : (
            <span className="text-xl shrink-0" aria-hidden>{app.icon}</span>
          )}
          <h2 className="text-lg font-semibold truncate">{app.name}</h2>
          <Badge variant="outline" className="text-[10px]">v{app.version}</Badge>
          {!app.frontendBuilt && (
            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/40">
              {t('buildMissing')}
            </Badge>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw size={14} className="mr-1.5" />
            {t('reload')}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={src} target="_blank" rel="noreferrer">
              <ExternalLink size={14} className="mr-1.5" />
              {t('openInNewWindow')}
            </a>
          </Button>
        </div>
      </div>

      {/* 应用内容：独立 iframe，与应用自身的路由/样式隔离 */}
      <iframe
        key={reloadKey}
        title={app.name}
        src={src}
        className="flex-1 w-full rounded-xl border bg-[#0b0f17] shadow-sm"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
