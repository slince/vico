// @vico/bash - 命令执行抽象层：CommandExecutor 接口

import type { Command, CommandResult } from './command.js';

/**
 * 命令执行器：接收解析后的 {@link Command}，产出执行结果。
 *
 * 具体实现负责真正的进程派发（后续任务提供），策略层（{@link withPolicy}）
 * 与业务层只依赖此接口，从而可在真实执行与拦截/模拟之间无缝替换。
 */
export interface CommandExecutor {
  /**
   * 执行一条命令。
   *
   * @param command 待执行的命令（来自 {@link parseCommand}）
   * @returns 命令执行结果（stdout / stderr / exitCode / durationMs 等）
   */
  execute(command: Command): Promise<CommandResult>;
}
