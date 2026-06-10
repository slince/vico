export interface SkillParameter {
  type: 'string' | 'number' | 'boolean';
  label: string;
  default: string | number | boolean;
  required?: boolean;
  options?: { label: string; value: string }[];
}

export interface SkillManifest {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author?: string;
  category: string;
  parameters: Record<string, SkillParameter>;
  required_tools?: string[];
  dependencies?: string[];
  enabled: boolean;
}

export interface SkillToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolContext {
  tenantId: string;
  agentId: string;
  skillConfig: Record<string, any>;
  userId: string;
}

export interface SkillTool {
  definition: SkillToolDef;
  handler: (args: any, context: ToolContext) => Promise<any>;
}

export interface LoadedSkill {
  manifest: SkillManifest;
  prompt: string;
  tools: SkillTool[];
}

export interface SkillInstaller {
  (params: Record<string, any>): Promise<LoadedSkill>;
}
