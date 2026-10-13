"use client";

// 1. React
import {type FC, useMemo} from "react";

// 2. Third-party
import {useQuery} from "@tanstack/react-query";
import {
  type Unstable_SlashCommand,
  unstable_useComposerInput,
  unstable_useSlashCommandAdapter,
} from "@assistant-ui/react";
import {PuzzleIcon, ScissorsIcon} from "lucide-react";

// 3. API
import {api} from "@/api/client";

// 4. UI
import {ComposerTriggerPopover} from "@/components/assistant-ui/elements/composer-trigger-popover.aui";

/** Skill 数据形状（来自 GET /api/v1/skills，仅取本组件所需字段） */
interface Skill {
  name: string;
  description: string;
  userInvocable: boolean;
}

/** slash 命令图标映射：命令定义里的 icon 字符串 → 图标组件 */
const ICON_MAP: Record<string, FC<{ className?: string }>> = {
  compact: ScissorsIcon,
  skill: PuzzleIcon,
};

/** 内置 /compact 命令的 icon 键 */
const COMPACT_ICON = "compact";
/** skill 类命令的 icon 键 */
const SKILL_ICON = "skill";
/** 命令未命中 icon 映射时的默认图标 */
const FALLBACK_ICON = PuzzleIcon;

/**
 * 聊天输入框 slash command 数据 hook。
 *
 * 拉取 userInvocable 的 skill，与内置 /compact 一起构建命令集，
 * 返回 unstable_useSlashCommandAdapter 的结果（adapter/action/iconMap/fallbackIcon）。
 */
export function useComposerCommands() {
  const { setText } = unstable_useComposerInput();

  // 拉取 skill 列表（仅展示 userInvocable 的 skill）
  const { data: skills } = useQuery<Skill[]>({
    queryKey: ["skills"],
    queryFn: () => api("/skills"),
  });

  const commands = useMemo<Unstable_SlashCommand[]>(() => {
    const invocableSkills = (skills ?? []).filter((s) => s.userInvocable);

    return [
      {
        id: "compact",
        label: "压缩上下文",
        description: "总结并压缩当前对话上下文",
        icon: COMPACT_ICON,
        execute: () =>
          setText("请总结并压缩以上对话上下文，保留关键决策、事实与待办事项。"),
      },
      ...invocableSkills.map((skill) => ({
        id: skill.name,
        label: `/${skill.name}`,
        description: skill.description,
        icon: SKILL_ICON,
        execute: () =>
          setText(`请使用 skill「${skill.name}」帮我完成以下需求：`),
      })),
    ];
  }, [skills, setText]);

  return unstable_useSlashCommandAdapter({
    commands,
    removeOnExecute: true,
    iconMap: ICON_MAP,
    fallbackIcon: FALLBACK_ICON,
  });
}

/**
 * 聊天输入框 slash command 弹层。
 *
 * 输入 `/` 弹出菜单，列出内置「压缩上下文」命令与所有 userInvocable 的 skill；
 * 选中后把对应指令文本写入输入框，用户补全需求后再发送。
 */
export function ComposerSlashCommands() {
  const slash = useComposerCommands();

  return (
    <ComposerTriggerPopover
      char="/"
      {...slash}
      backLabel="返回"
      emptyItemsLabel="暂无可用命令"
      loadingLabel="加载中…"
    />
  );
}
