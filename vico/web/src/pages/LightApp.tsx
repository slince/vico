// 1. React
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// 2. Third-party
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Maximize2, Minimize2, RefreshCw, SquareArrowOutUpRight } from 'lucide-react';

// 3. API / Hooks / Utils
import { api } from '@/api/client';
import { cn } from '@/lib/utils';

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  /** 浏览器原生全屏被拒时，仍用 CSS 覆盖层保证「只展示应用」的效果 */
  const exitFullscreen = () => {
    setIsFullscreen(false);
    if (document.fullscreenElement === stageRef.current) {
      void document.exitFullscreen();
    }
  };

  const enterFullscreen = () => {
    setIsFullscreen(true);
    // 原生全屏是增强项：失败不影响覆盖层展示（例如被 iframe 权限策略拦截）
    void stageRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  /** 用户按 Esc 或浏览器退出原生全屏时，同步关闭覆盖层；离开页面时确保退出全屏 */
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeyDown);
      if (document.fullscreenElement === stageRef.current) {
        void document.exitFullscreen();
      }
    };
  }, []);

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
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={enterFullscreen}
            aria-label={t('fullscreen')}
            title={t('fullscreen')}
          >
            <Maximize2 size={15} />
          </Button>
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

      {/* 应用内容：独立 iframe，与应用自身的路由/样式隔离；全屏时仅保留该容器 */}
      <div
        ref={stageRef}
        className={cn(
          'relative flex min-h-0 flex-1',
          isFullscreen && 'fixed inset-0 z-50 bg-[#0b0f17]',
        )}
      >
        <iframe
          key={reloadKey}
          title={app.name}
          src={src}
          className={cn(
            'w-full flex-1 rounded-xl border bg-[#0b0f17] shadow-sm',
            isFullscreen && 'h-full rounded-none border-0',
          )}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
        {isFullscreen && (
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-3 top-3 z-10 h-9 w-9 shadow-lg"
            onClick={exitFullscreen}
            aria-label={t('exitFullscreen')}
            title={t('exitFullscreen')}
          >
            <Minimize2 size={15} />
          </Button>
        )}
      </div>
    </div>
  );
}
