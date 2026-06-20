// 1. React
import { useState, useCallback } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PackageOpen, Download, Trash2, Puzzle } from 'lucide-react';

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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/** Skill 参数定义 */
interface SkillParameter {
  name: string;
  type: string;
  label?: string;
  default?: string;
  options?: string[];
}

/** Skill 数据形状（来自 API 返回，合并 manifest + 安装状态） */
interface Skill {
  name: string;
  displayName: string;
  version: string;
  description: string;
  category?: string;
  parameters?: SkillParameter[];
  installed: boolean;
  installed_config: Record<string, any>;
  installed_enabled: boolean;
  installed_version: string | null;
}

/**
 * Skill 管理页面
 *
 * 以卡片网格展示所有可用 Skill，支持安装、卸载、启用/禁用操作。
 * 加载时展示 Skeleton 骨架屏，无数据时展示 Empty 空状态。
 */
export default function Skills() {
  const { t } = useTranslation('skills');
  const queryClient = useQueryClient();

  const [uninstallTarget, setUninstallTarget] = useState<Skill | null>(null);

  const { data: skills, isLoading } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: () => api('/skills'),
  });

  const installMutation = useMutation({
    mutationFn: (skillName: string) =>
      api('/skills/install', { method: 'POST', body: JSON.stringify({ skill_name: skillName }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  const uninstallMutation = useMutation({
    mutationFn: (skillName: string) =>
      api(`/skills/${encodeURIComponent(skillName)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ skillName, enabled }: { skillName: string; enabled: boolean }) =>
      api(`/skills/${encodeURIComponent(skillName)}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  const handleUninstallConfirm = useCallback(() => {
    if (uninstallTarget) {
      uninstallMutation.mutate(uninstallTarget.name, {
        onSettled: () => setUninstallTarget(null),
      });
    }
  }, [uninstallTarget, uninstallMutation]);

  const skillList: Skill[] = skills || [];

  // ====================== 加载态 ======================
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h2>
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-20 mt-1" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4 mt-2" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-8 w-full rounded-md" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ====================== 空状态 ======================
  if (skillList.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h2>
        </div>
        <Empty>
          <EmptyMedia variant="icon">
            <PackageOpen size={32} />
          </EmptyMedia>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>
            {t('emptyDescription')}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // ====================== 正常数据态 ======================
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h2>
        <Badge variant="secondary" className="text-sm">
          {t('totalCount', { count: skillList.length })}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {skillList.map((skill) => (
          <Card
            key={skill.name}
            className="hover:shadow-md transition-shadow group/card"
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Puzzle size={16} className="text-primary shrink-0" />
                    <CardTitle className="text-base truncate">
                      {skill.displayName}
                    </CardTitle>
                  </div>
                  <CardDescription className="mt-1">
                    v{skill.version}
                    {skill.category && (
                      <>
                        {' '}&middot;{' '}
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {skill.category}
                        </Badge>
                      </>
                    )}
                  </CardDescription>
                </div>
                {skill.installed && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch
                      size="sm"
                      checked={skill.installed_enabled}
                      onCheckedChange={() =>
                        toggleMutation.mutate({
                          skillName: skill.name,
                          enabled: !skill.installed_enabled,
                        })
                      }
                    />
                    <span className="text-xs text-muted-foreground">
                      {skill.installed_enabled ? t('statusEnabled') : t('statusDisabled')}
                    </span>
                  </div>
                )}
              </div>
            </CardHeader>

            <CardContent className="pb-2">
              <p className="text-xs text-muted-foreground line-clamp-3">
                {skill.description || t('common:noDescription')}
              </p>
              {skill.parameters && skill.parameters.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {skill.parameters.slice(0, 4).map((p) => (
                    <Tooltip key={p.name}>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" className="text-[10px] cursor-default">
                          {p.label || p.name}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{p.type}</TooltipContent>
                    </Tooltip>
                  ))}
                  {skill.parameters.length > 4 && (
                    <Badge variant="secondary" className="text-[10px]">
                      +{skill.parameters.length - 4}
                    </Badge>
                  )}
                </div>
              )}
            </CardContent>

            <Separator />

            <CardFooter className="pt-3 pb-3">
              {skill.installed ? (
                <AlertDialog
                  open={uninstallTarget?.name === skill.name}
                  onOpenChange={(open) => {
                    if (!open) setUninstallTarget(null);
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground hover:text-destructive"
                      onClick={() => setUninstallTarget(skill)}
                    >
                      <Trash2 size={14} className="mr-1.5" />
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
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => installMutation.mutate(skill.name)}
                  disabled={installMutation.isPending}
                >
                  <Download size={14} className="mr-1.5" />
                  {t('installButton')}
                </Button>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
