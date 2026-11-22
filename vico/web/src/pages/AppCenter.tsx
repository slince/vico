// 1. React
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// 2. Third-party
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Boxes, LayoutGrid, Loader2, RefreshCw, Server, SquareArrowOutUpRight, Trash2 } from 'lucide-react';

// 3. API / Hooks / Utils
import { api } from '@/api/client';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

// 4. UI components
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// 5. Types
import type { LightAppSummary } from '@/types/apps';

/** 应用操作类型 */
type AppAction = 'install' | 'uninstall' | 'enable' | 'disable';

/** 判断图标字段是否指向图片文件（否则按 emoji 文本渲染） */
function isImageIcon(icon: string): boolean {
  return /^(https?:)?\/\//.test(icon) || /\.(svg|png|jpg|jpeg|webp|gif|ico)$/i.test(icon);
}

/**
 * 应用图标 — emoji 直接渲染；相对路径图片走 vico 静态托管。
 * @param app 应用摘要
 * @param className 额外样式（尺寸）
 */
function AppIcon({ app, className }: { app: LightAppSummary; className?: string }) {
  if (isImageIcon(app.icon)) {
    const src = /^(https?:)?\/\//.test(app.icon) ? app.icon : `/app-static/${app.id}/${app.icon.replace(/^\.?\//, '')}`;
    return <img src={src} alt="" className={cn('rounded-xl object-cover', className)} />;
  }
  return (
    <div className={cn(
      'grid place-items-center rounded-xl bg-gradient-to-br from-emerald-500/15 to-sky-500/15 border border-emerald-500/20 text-2xl',
      className,
    )}>
      <span aria-hidden>{app.icon || '🧩'}</span>
    </div>
  );
}

/**
 * 应用中心页面。
 *
 * 展示 `~/vico/apps` 下扫描到的全部轻应用，支持安装、卸载、启用、禁用；
 * 仅「已安装且已启用」的应用可点击打开（路由 `/apps/:id` 内嵌 iframe 运行）。
 */
export default function AppCenter() {
  const { t } = useTranslation('apps');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  /** 写操作仅管理员可用（安装状态是服务端全局状态） */
  const canManage = (user as { role?: string } | null)?.role === 'admin';

  const { data, isLoading, isError, refetch } = useQuery<LightAppSummary[]>({
    queryKey: ['apps'],
    queryFn: () => api('/apps'),
  });

  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: AppAction }) =>
      api(`/apps/${id}/${action}`, { method: 'POST' }),
    onSuccess: (_res, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['apps'] });
      const app = data?.find((item) => item.id === variables.id);
      const name = app?.name ?? variables.id;
      const messageKey: Record<AppAction, string> = {
        install: 'installSuccess',
        uninstall: 'uninstallSuccess',
        enable: 'enableSuccess',
        disable: 'disableSuccess',
      };
      toast.success(t(messageKey[variables.action], { name }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /** 刷新列表（保持一点最短动画时长，避免请求过快没有反馈） */
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([refetch(), new Promise((resolve) => setTimeout(resolve, 400))]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, refetch]);

  const apps = data ?? [];

  // ====================== 加载态 ======================
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-bold tracking-tight">{t('title')}</h3>
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-12 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-8 w-24" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ====================== 错误态 ======================
  if (isError) {
    return (
      <div className="space-y-6">
        <h3 className="text-2xl font-bold tracking-tight">{t('title')}</h3>
        <Empty>
          <EmptyMedia variant="icon"><Boxes size={32} /></EmptyMedia>
          <EmptyTitle>{t('loadError')}</EmptyTitle>
          <EmptyDescription>{t('subtitle')}</EmptyDescription>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw size={14} className="mr-1.5" />
            {t('refresh')}
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-bold tracking-tight">{t('title')}</h3>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm">{t('count', { count: apps.length })}</Badge>
          <Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing} aria-label={t('refresh')}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {/* ====================== 空状态 ====================== */}
      {apps.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon"><LayoutGrid size={32} /></EmptyMedia>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {apps.map((app) => {
            const openable = app.installed && app.enabled && !app.error;
            const busy = mutation.isPending && mutation.variables?.id === app.id;

            return (
              <Card
                key={app.id}
                className={cn(
                  'flex flex-col transition-shadow',
                  openable && 'cursor-pointer hover:shadow-md',
                  !openable && 'opacity-95',
                )}
                onClick={() => {
                  if (openable) navigate(`/apps/${app.id}`);
                }}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    <AppIcon app={app} className="h-12 w-12 shrink-0 text-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base truncate">{app.name}</CardTitle>
                        <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">v{app.version}</Badge>
                      </div>
                      <CardDescription className="mt-1 line-clamp-2 text-xs">
                        {app.description || app.id}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex-1 pb-2 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {app.error ? (
                      <Badge variant="destructive" className="text-[10px]">{t('invalid')}</Badge>
                    ) : app.installed ? (
                      <>
                        <Badge variant="secondary" className="text-[10px]">{t('installed')}</Badge>
                        <Badge variant={app.enabled ? 'default' : 'outline'} className="text-[10px]">
                          {app.enabled ? t('enabled') : t('disabled')}
                        </Badge>
                      </>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">{t('notInstalled')}</Badge>
                    )}
                    {app.hasServer && (
                      <Badge variant="outline" className="text-[10px]">
                        <Server size={10} className="mr-1" />
                        {t('hasServer')}
                      </Badge>
                    )}
                    {!app.frontendBuilt && (
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/40">
                        {t('buildMissing')}
                      </Badge>
                    )}
                  </div>
                  {app.error && (
                    <p className="text-[11px] leading-relaxed text-destructive/90 line-clamp-2">{app.error}</p>
                  )}
                </CardContent>

                <CardFooter className="pt-0 flex items-center justify-between gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground/80 truncate max-w-[45%] text-left"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {app.id}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[320px] break-all">{app.dir}</TooltipContent>
                  </Tooltip>

                  {/* 操作区：阻止冒泡，避免点按钮时触发卡片跳转 */}
                  <div className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                    {app.installed && app.enabled && (
                      <Button size="sm" className="h-8" onClick={() => navigate(`/apps/${app.id}`)}>
                        <SquareArrowOutUpRight size={13} className="mr-1" />
                        {t('open')}
                      </Button>
                    )}

                    {!app.installed && canManage && (
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={busy || Boolean(app.error)}
                        onClick={() => mutation.mutate({ id: app.id, action: 'install' })}
                      >
                        {busy ? <Loader2 size={13} className="mr-1 animate-spin" /> : null}
                        {t('install')}
                      </Button>
                    )}

                    {app.installed && canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={busy}
                        onClick={() => mutation.mutate({ id: app.id, action: app.enabled ? 'disable' : 'enable' })}
                      >
                        {busy ? <Loader2 size={13} className="mr-1 animate-spin" /> : null}
                        {app.enabled ? t('disable') : t('enable')}
                      </Button>
                    )}

                    {app.installed && canManage && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy} aria-label={t('uninstall')}>
                            <Trash2 size={14} />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('uninstallTitle', { name: app.name })}</AlertDialogTitle>
                            <AlertDialogDescription>{t('uninstallDescription')}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => mutation.mutate({ id: app.id, action: 'uninstall' })}>
                              {t('confirmUninstall')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
