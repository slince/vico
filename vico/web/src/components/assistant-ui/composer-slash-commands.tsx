"use client";

// 1. React
import {type FC, useMemo} from "react";

// 2. Third-party
import {useQuery} from "@tanstack/react-query";
import {
  ComposerPrimitive,
  type Unstable_SlashCommand,
  unstable_useComposerInput,
  unstable_useSlashCommandAdapter,
} from "@assistant-ui/react";
import {PuzzleIcon, ScissorsIcon} from "lucide-react";

// 3. API
import {api} from "@/api/client";

// 4. UI 组件

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

/**
 * 聊天输入框 slash command 弹层 — 集成 assistant-ui 的 composer slash commands。
 *
 * 输入 `/` 弹出菜单，列出内置的「压缩上下文」命令与所有 userInvocable 的 skill；
 * 选中后把对应指令文本写入输入框，用户补全需求后再发送。
 */
export function ComposerSlashCommands() {
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

  const slash = unstable_useSlashCommandAdapter({
    commands,
    removeOnExecute: true,
    iconMap: ICON_MAP,
    fallbackIcon: PuzzleIcon,
  });

  return <ComposerPrimitive.TriggerPopover char="/" adapter={slash.adapter} />;
}
