// @vico/bash - 命令解析/分析/策略/执行抽象（barrel）

export { parseCommand } from './parse.js';
export { analyzeCommand, COMMAND_REGISTRY } from './analyze.js';
export { permissivePolicy, withPolicy } from './policy.js';
export { LocalCommandExecutor, localCommandExecutor } from './local-executor.js';

export type { ParseOptions } from './parse.js';
export type { CommandOperator, Redirect, CommandSegment, Command, CommandResult } from './command.js';
export type { CommandCategory, CommandDescriptor, Finding, CommandAnalysis, PathPolicy, AnalyzeOptions } from './analyze.js';
export type { PolicyDecision, InterceptionPolicy } from './policy.js';
export type { CommandExecutor } from './executor.js';
export type { LocalExecutorOptions } from './local-executor.js';
