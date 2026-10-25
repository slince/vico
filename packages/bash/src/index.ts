// @vico/bash - 命令解析/分析/执行抽象层

export {
  type Command,
  type CommandOperator,
  type CommandResult,
  type CommandSegment,
  type Redirect,
} from './command.js';

export { parseCommand, type ParseOptions } from './parse.js';
