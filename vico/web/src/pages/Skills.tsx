// 1. React
import { useTranslation } from 'react-i18next';

// 2. Third-party
import { useQuery } from '@tanstack/react-query';
import { PackageOpen, Puzzle, BookOpen, Code, Paperclip, Sparkles } from 'lucide-react';

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
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';

/** Skill 数据形状（来自 GET /api/v1/skills，SKILL.md 扫描结果） */
interface Skill {
  name: string;
  description: string;
  source: 'local' | 'external' | 'managed';
  license?: string;
  compatibility?: string;
  userInvocable: boolean;
  references: string[];
  scripts: string[];
  assets: string[];
  metadata?: Record<string, string>;
}

/**
 * Skill 管理页面（只读）
 *
 * 以卡片网格展示 Vico 从文件系统扫描到的全部 Skill（SKILL.md 格式）。
 * 仅展示元数据与 references/scripts/assets 资源计数，无安装/卸载/启停操作。
 */
export default function Skills() {
  const { t } = useTranslation('skills');

  const { data: skills, isLoading } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: () => api('/skills'),
  });

  const skillList: Skill[] = skills || [];

  // ====================== 加载态 ======================
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h2>
          <Skeleton className="h-6 w-20 rounded-md" />
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
                <Skeleton className="h-4 w-full" />
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
          <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
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
          <Card key={skill.name} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Puzzle size={16} className="text-primary shrink-0" />
                    <CardTitle className="text-base truncate">{skill.name}</CardTitle>
                  </div>
                  <CardDescription className="mt-1">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {skill.source}
                    </Badge>
                    {skill.license && (
                      <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0">
                        {skill.license}
                      </Badge>
                    )}
                    {skill.compatibility && (
                      <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0">
                        {skill.compatibility}
                      </Badge>
                    )}
                  </CardDescription>
                </div>
                {skill.userInvocable && (
                  <Badge variant="secondary" className="shrink-0">
                    <Sparkles size={12} className="mr-1" />
                    {t('userInvocable')}
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="pb-2">
              <p className="text-xs text-muted-foreground line-clamp-3">
                {skill.description || t('common:noDescription')}
              </p>
            </CardContent>

            <Separator />

            <CardFooter className="pt-3 pb-3 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <BookOpen size={14} />
                {t('references', { count: skill.references.length })}
              </span>
              <span className="flex items-center gap-1.5">
                <Code size={14} />
                {t('scripts', { count: skill.scripts.length })}
              </span>
              <span className="flex items-center gap-1.5">
                <Paperclip size={14} />
                {t('assets', { count: skill.assets.length })}
              </span>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
