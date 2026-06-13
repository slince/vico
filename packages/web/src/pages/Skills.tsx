// 1. React
import { useCallback, useState } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Puzzle, Download, Trash2, Power, PowerOff } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

/** Skill 参数定义 */
interface SkillParameter {
  label: string;
  default: string;
  [key: string]: unknown;
}

/** Skill 数据结构（来自 API） */
interface Skill {
  name: string;
  displayName: string;
  description: string;
  version: string;
  category: string;
  installed: boolean;
  installed_enabled: boolean;
  parameters: Record<string, SkillParameter> | null;
}

/**
 * 根据 Skill 的安装/启用状态返回对应的状态键
 */
function getSkillStatus(skill: Skill): 'enabled' | 'disabled' | 'uninstalled' {
  if (!skill.installed) return 'uninstalled';
  return skill.installed_enabled ? 'enabled' : 'disabled';
}

/**
 * Skill 管理页面
 * 以卡片网格展示所有 Skill，支持安装、卸载、启用、禁用操作
 */
export default function Skills() {
  const { t } = useTranslation('skills');
  const queryClient = useQueryClient();

  /** Skill 状态标签文字与样式映射 */
  const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
    enabled: { label: t('statusEnabled'), variant: 'default' },
    disabled: { label: t('statusDisabled'), variant: 'secondary' },
    uninstalled: { label: t('statusNotInstalled'), variant: 'outline' },
  };

  const [uninstallTarget, setUninstallTarget] = useState<string | null>(null);
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [togglingName, setTogglingName] = useState<string | null>(null);

  const { data: skills, isLoading } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: () => api('/skills'),
  });

  const installMutation = useMutation({
    mutationFn: (data: { skill_name: string }) =>
      api('/skills/install', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
    onSettled: () => setInstallingName(null),
  });

  const uninstallMutation = useMutation({
    mutationFn: (name: string) =>
      api(`/skills/${name}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setUninstallTarget(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api(`/skills/${name}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
    onSettled: () => setTogglingName(null),
  });

  const handleInstall = useCallback(
    (skillName: string) => {
      setInstallingName(skillName);
      installMutation.mutate({ skill_name: skillName });
    },
    [installMutation],
  );

  const handleUninstallConfirm = useCallback(() => {
    if (uninstallTarget) {
      uninstallMutation.mutate(uninstallTarget);
    }
  }, [uninstallTarget, uninstallMutation]);

  const handleToggle = useCallback(
    (name: string, currentEnabled: boolean) => {
      setTogglingName(name);
      toggleMutation.mutate({ name, enabled: !currentEnabled });
    },
    [toggleMutation],
  );

  const skillsList = skills || [];

  // ---------- 加载态 ----------
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3 mt-2" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-8 w-16" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ---------- 渲染 ----------
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('pageDescription')}
          </p>
        </div>
      </div>

      {skillsList.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <Puzzle className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>
              {t('emptyDescription')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {skillsList.map((skill) => {
            const status = getSkillStatus(skill);
            const statusConfig = STATUS_MAP[status];
            const isThisInstalling = installingName === skill.name;
            const isThisToggling = togglingName === skill.name;
            const isThisUninstalling = uninstallTarget === skill.name && uninstallMutation.isPending;

            return (
              <Card
                key={skill.name}
                className={!skill.installed ? 'opacity-70' : ''}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Puzzle className="size-4" />
                      </div>
                      <CardTitle className="text-base">{skill.displayName}</CardTitle>
                    </div>
                    <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                  </div>
                  <CardDescription>{skill.description}</CardDescription>
                </CardHeader>

                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    v{skill.version} · {skill.category}
                  </p>
                </CardContent>

                {skill.parameters && Object.keys(skill.parameters).length > 0 && (
                  <>
                    <Separator className="mx-(--card-spacing) w-auto" />
                    <CardContent>
                      <p className="text-xs font-medium mb-1">{t('paramConfig')}</p>
                      {Object.entries(skill.parameters).map(([key, param]) => (
                        <p key={key} className="text-xs text-muted-foreground">
                          {param.label}: {param.default}
                        </p>
                      ))}
                    </CardContent>
                  </>
                )}

                <CardFooter className="border-t gap-2">
                  {!skill.installed ? (
                    <Button
                      size="sm"
                      onClick={() => handleInstall(skill.name)}
                      disabled={isThisInstalling}
                    >
                      <Download className="size-3.5" />
                      {t('installButton')}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant={skill.installed_enabled ? 'outline' : 'default'}
                        size="sm"
                        onClick={() => handleToggle(skill.name, skill.installed_enabled)}
                        disabled={isThisToggling}
                      >
                        {skill.installed_enabled ? (
                          <PowerOff className="size-3.5" />
                        ) : (
                          <Power className="size-3.5" />
                        )}
                        {skill.installed_enabled ? t('disableButton') : t('enableButton')}
                      </Button>
                      <AlertDialog
                        open={uninstallTarget === skill.name}
                        onOpenChange={(open) => {
                          if (!open) setUninstallTarget(null);
                        }}
                      >
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setUninstallTarget(skill.name)}
                            disabled={isThisUninstalling}
                          >
                            <Trash2 className="size-3.5" />
                            {t('uninstallButton')}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('confirmUninstallTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('confirmUninstallDesc', { name: skill.displayName })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <Button
                              variant="outline"
                              onClick={() => setUninstallTarget(null)}
                            >
                              {t('common:cancel')}
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={handleUninstallConfirm}
                              disabled={uninstallMutation.isPending}
                            >
                              {uninstallMutation.isPending ? t('common:uninstalling') : t('common:confirmDelete')}
                            </Button>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
