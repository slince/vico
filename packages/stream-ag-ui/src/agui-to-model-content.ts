// @vico/stream-ag-ui - ag-ui ContentPart → ModelMessage content part 转换。
//
// ag-ui 消息 content 用「part 判别联合」（text/image/audio/video/document，媒体经 source 三态：
// data=base64 / url / file=provider 句柄）；本模块将其映射为 AI SDK 的 TextPart / ImagePart(已弃用) / FilePart。
import type {
  AudioPart as AgUiAudioPart,
  ContentPart as AgUiContentPart,
  DocumentPart as AgUiDocumentPart,
  ImagePart as AgUiImagePart,
  PartSource,
  VideoPart as AgUiVideoPart,
} from '@ag-ui/core';
import type {ModelMessage} from '@vico/model';

/** ModelMessage user 消息的 content parts 数组（AI SDK TextPart | ImagePart | FilePart） */
export type ModelUserContentParts = Extract<Extract<ModelMessage, { role: 'user' }>['content'], unknown[]>;
/** 单个 user content part */
type ModelUserContentPart = ModelUserContentParts[number];
/** AI SDK FilePart 的 data 字段联合（FileData | DataContent | URL | ProviderReference） */
type ModelFileData = Extract<ModelUserContentPart, { type: 'file' }>['data'];

/** 媒体 part 无 mimeType 时的顶层媒体类型兜底（document 归 application） */
const FALLBACK_MEDIA_TYPE: Record<'image' | 'audio' | 'video' | 'document', string> = {
  image: 'image',
  audio: 'audio',
  video: 'video',
  document: 'application',
};

/** ag-ui PartSource → AI SDK FileData；file source 无 provider 时无法映射，返回 undefined */
function aguiSourceToFileData(source: PartSource): ModelFileData | undefined {
  switch (source.type) {
    case 'data':
      // base64 字符串直接作为 data
      return { type: 'data', data: source.value };
    case 'url':
      return { type: 'url', url: new URL(source.value), originalUrl: source.value };
    case 'file':
      // opaque handle 需 provider 才能映射为 provider reference；无 provider 则丢弃
      return source.provider
        ? { type: 'reference', reference: { [source.provider]: source.value } }
        : undefined;
  }
}

/** ag-ui 媒体 part（image/audio/video/document）→ AI SDK FilePart */
function aguiMediaPartToFilePart(
  part: AgUiImagePart | AgUiAudioPart | AgUiVideoPart | AgUiDocumentPart,
): ModelUserContentPart | undefined {
  const data = aguiSourceToFileData(part.source);
  if (!data) return undefined;
  return {
    type: 'file',
    mediaType: part.source.mimeType ?? FALLBACK_MEDIA_TYPE[part.type],
    data,
  };
}

/** ag-ui ContentPart → AI SDK user content part；不支持时返回 undefined */
function aguiContentPartToModelPart(part: AgUiContentPart): ModelUserContentPart | undefined {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
      return aguiMediaPartToFilePart(part);
  }
}

/**
 * ag-ui 消息 content → ModelMessage user content。
 * string 原样透传；parts 逐个映射（text → text，媒体 → FilePart），无法映射的 part 丢弃。
 *
 * @param content - ag-ui 消息 content（string 或 ContentPart[]）
 * @returns ModelMessage user content（string 或 TextPart/ImagePart/FilePart[]）
 */
export function aguiContentToModelContent(
  content: string | AgUiContentPart[],
): string | ModelUserContentParts {
  if (typeof content === 'string') return content;
  const parts: ModelUserContentParts = [];
  for (const part of content) {
    const mapped = aguiContentPartToModelPart(part);
    if (mapped) parts.push(mapped);
  }
  return parts;
}

/** ag-ui 消息 content → 纯文本（拼接 text part，媒体 part 忽略） */
export function aguiContentToText(content: string | AgUiContentPart[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<AgUiContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
