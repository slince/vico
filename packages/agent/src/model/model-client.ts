// @vico/agent - ModelClient: thin wrapper over LanguageModelV3.doStream()
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { convertToPrompt } from './prompt-converter.js';
import { convertTools } from './tool-converter.js';
import { processStreamParts } from './stream-processor.js';
import type { ModelCallOptions, ModelStreamResult } from './types.js';

/**
 * Thin wrapper over provider-level language model.
 * Converts Vico types to provider types, calls doStream(), and processes the raw stream.
 */
export class ModelClient {
  constructor(private model: LanguageModelV3) {}

  /**
   * Stream a model response. Converts internal types to provider format,
   * calls the model, and returns a typed async generator of stream chunks.
   */
  async stream(options: ModelCallOptions): Promise<ModelStreamResult> {
    const prompt = convertToPrompt(options.messages, options.system);
    const tools = options.tools?.length ? convertTools(options.tools) : undefined;

    const result = await this.model.doStream({
      prompt,
      tools,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      abortSignal: options.abortSignal,
    });

    return {
      stream: processStreamParts(result.stream),
    };
  }
}
