// @vico/compaction — 压缩摘要提示词与 framing 常量

/** 结构化 checkpoint 指令（对齐 deepseek COMPACTION_INSTRUCTION 8 节模板） */
export const COMPACTION_INSTRUCTION = `You are maintaining a rolling summary of an ongoing conversation between an AI agent and a user.
Compress the provided conversation content into a structured Markdown checkpoint. Rules:
- Preserve each of the following 8 sections verbatim (use "(none)" for empty sections):
  ## Primary Request and Intent
  ## Key Technical Concepts
  ## Files and Code
  ## Errors and Fixes
  ## Pending Jobs
  ## Current Work
  ## Next Step
  ## Critical Context
- Use concise bullets. Preserve exact paths, commands, error strings, identifiers, numeric values, and function signatures.
- Faithfully record user feedback and corrections. Do not mention this compaction.
- If a previous summary block is present in the input, merge with it rather than copy it verbatim.`;

export const CHECKPOINT_PREAMBLE = 'This is an automatically generated compacted summary of earlier conversation content.';
export const SUMMARY_OPEN_TAG = '<compacted-summary>';
export const SUMMARY_CLOSE_TAG = '</compacted-summary>';
