import { z } from 'zod';

/** agent_teams 表行类型 */
export interface TeamRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  routing_strategy: string;
  supervisor_agent_id: string | null;
  created_at: number;
  updated_at: number;
}

/** agent_team_members 表行类型 */
export interface TeamMemberRow {
  id: string;
  team_id: string;
  agent_id: string;
  role: string;
  created_at: number;
}

/** 列表返回的 Team（含 member_count） */
export interface TeamWithMembers extends TeamRow {
  member_count: number;
}

/** 详情返回的 Team member（含 agent_name） */
export interface TeamMemberDetail {
  id: string;
  agent_id: string;
  role: string;
  agent_name: string | null;
}

/** 详情返回的 Team（含完整 members 列表） */
export interface TeamDetail extends TeamRow {
  members: TeamMemberDetail[];
}

// ── Zod 输入校验 ──

export const createTeamSchema = z.object({
  name: z.string().min(1, 'Team 名称不能为空'),
  description: z.string().optional().default(''),
  routing_strategy: z.string().optional().default('supervisor'),
  supervisor_agent_id: z.string().nullable().optional().default(null),
  member_ids: z.array(z.string()).optional(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  routing_strategy: z.string().optional(),
  supervisor_agent_id: z.string().nullable().optional(),
});

export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const replaceMembersSchema = z.object({
  members: z.array(z.object({
    agent_id: z.string().min(1),
    role: z.string().optional().default('member'),
  })).optional().default([]),
});

export type ReplaceMembersInput = z.infer<typeof replaceMembersSchema>;
