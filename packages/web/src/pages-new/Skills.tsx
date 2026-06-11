import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useCallback, useState } from 'react';
import { Puzzle, Download, Trash2, Power, PowerOff } from 'lucide-react';
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
  /** 是否已安装 */
  installed: boolean;
  /** 安装后是否启用 */
  installed_enabled: boolean;
  /** 可配置的参数 */
  parameters: Record<string, SkillParameter> | null;
}

/** Skill 状态标签文字与样式映射 */
const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  enabled: { label: '已启用', variant: 'default' },
  disabled: { label: '已禁用', variant: 'secondary' },
  uninstalled: { label: '未安装', variant: 'outline' },
};

/**
 * 根据 Skill 的安装/启用状态返回对应的状态键
 * @param skill - Skill 对象
 * @returns 状态键字符串
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
  const queryClient = useQueryClient();

  /** 待卸载的 Skill 名称（为空表示未确认卸载） */
  const [uninstallTarget, setUninstallTarget] = useState<string | null>(null);

  // ---------- 数据获取 ----------
  const { data: skills, isLoading } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: () => api('/skills'),
  });

  // ---------- 变更操作 ----------

  /**
   * 安装 Skill 变更
   * 成功后刷新 Skill 列表
   */
  const installMutation = useMutation({
    mutationFn: (data: { skill_name: string }) =>
      api('/skills/install', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  /**
   * 卸载 Skill 变更
   * 成功后刷新列表并清空待卸载目标
   */
  const uninstallMutation = useMutation({
    mutationFn: (name: string) =>
      api(`/skills/${name}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setUninstallTarget(null);
    },
  });

  /**
   * 切换 Skill 启用/禁用状态变更
   * 成功后刷新列表
   */
  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api(`/skills/${name}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  // ---------- 事件处理 ----------

  /**
   * 安装指定的 Skill
   * @param skillName - Skill 的名称
   */
  const handleInstall = useCallback(
    (skillName: string) => {
      installMutation.mutate({ skill_name: skillName });
    },
    [installMutation],
  );

  /**
   * 确认卸载指定的 Skill
   */
  const handleUninstallConfirm = useCallback(() => {
    if (uninstallTarget) {
      uninstallMutation.mutate(uninstallTarget);
    }
  }, [uninstallTarget, uninstallMutation]);

  /**
   * 切换 Skill 的启用状态
   * @param name - Skill 名称
   * @param currentEnabled - 当前的启用状态
   */
  const handleToggle = useCallback(
    (name: string, currentEnabled: boolean) => {
      toggleMutation.mutate({ name, enabled: !currentEnabled });
    },
    [toggleMutation],
  );

  // ---------- 派生数据 ----------
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
      {/* 页面标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Skill 管理</h2>
          <p className="text-sm text-muted-foreground mt-1">
            管理平台中的 Skill 插件，按需安装并启用
          </p>
        </div>
      </div>

      {/* 空状态 */}
      {skillsList.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <Puzzle className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>暂无 Skill</EmptyTitle>
            <EmptyDescription>
              请确保 skills 目录下有可用的 Skill 包，它们将自动出现在此处
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        /* Skill 卡片网格 */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {skillsList.map((skill) => {
            const status = getSkillStatus(skill);
            const statusConfig = STATUS_MAP[status];
            const isPending = installMutation.isPending || uninstallMutation.isPending || toggleMutation.isPending;

            return (
              <Card
                key={skill.name}
                className={!skill.installed ? 'opacity-70' : ''}
              >
                <CardHeader>
                  {/* 图标 + 名称 + 状态标签 */}
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
                  {/* 版本与分类信息 */}
                  <p className="text-xs text-muted-foreground">
                    v{skill.version} · {skill.category}
                  </p>
                </CardContent>

                {/* 参数配置区块 */}
                {skill.parameters && Object.keys(skill.parameters).length > 0 && (
                  <>
                    <Separator className="mx-(--card-spacing) w-auto" />
                    <CardContent>
                      <p className="text-xs font-medium mb-1">参数配置:</p>
                      {Object.entries(skill.parameters).map(([key, param]) => (
                        <p key={key} className="text-xs text-muted-foreground">
                          {param.label}: {param.default}
                        </p>
                      ))}
                    </CardContent>
                  </>
                )}

                {/* 操作按钮 */}
                <CardFooter className="border-t gap-2">
                  {!skill.installed ? (
                    /* 未安装：显示安装按钮 */
                    <Button
                      size="sm"
                      onClick={() => handleInstall(skill.name)}
                      disabled={isPending}
                    >
                      <Download className="size-3.5" />
                      安装
                    </Button>
                  ) : (
                    <>
                      {/* 已安装：显示启用/禁用按钮 */}
                      <Button
                        variant={skill.installed_enabled ? 'outline' : 'default'}
                        size="sm"
                        onClick={() => handleToggle(skill.name, skill.installed_enabled)}
                        disabled={isPending}
                      >
                        {skill.installed_enabled ? (
                          <PowerOff className="size-3.5" />
                        ) : (
                          <Power className="size-3.5" />
                        )}
                        {skill.installed_enabled ? '禁用' : '启用'}
                      </Button>
                      {/* 卸载按钮 --- 使用 AlertDialog 确认 */}
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
                            disabled={isPending}
                          >
                            <Trash2 className="size-3.5" />
                            卸载
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认卸载</AlertDialogTitle>
                            <AlertDialogDescription>
                              确定要卸载 Skill「{skill.displayName}」吗？此操作会移除该 Skill 的配置和关联数据。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <Button
                              variant="outline"
                              onClick={() => setUninstallTarget(null)}
                            >
                              取消
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={handleUninstallConfirm}
                              disabled={uninstallMutation.isPending}
                            >
                              {uninstallMutation.isPending ? '卸载中...' : '确认卸载'}
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
