// @vico/stream-ag-ui - ag-ui ContentPart ↔ ModelMessage content part 双向转换。
//
// ag-ui 消息 content 用「part 判别联合」（text/image/audio/video/document，媒体经 source 三态：
// data=base64 / url / file=provider 句柄）；AI SDK 用 TextPart / ImagePart(已弃用) / FilePart，
// FilePart.data 经 data/url/reference/text 四态。本模块提供两者的完整映射，供 user / tool 消息复用。
import {Buffer} from 'node:buffer';
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

// ── ag-ui → ModelMessage ──────────────────────────────────────────────────

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

// ── ModelMessage → ag-ui ──────────────────────────────────────────────────

/** 顶层媒体类型 → ag-ui 媒体 part 种类（file 按 mediaType 判定，text/application 等归 document） */
function filePartKind(mediaType: string): 'image' | 'audio' | 'video' | 'document' {
  const top = mediaType.split('/')[0]?.toLowerCase();
  switch (top) {
    case 'image': return 'image';
    case 'audio': return 'audio';
    case 'video': return 'video';
    default: return 'document';
  }
}

/** 二进制/字符串统一转 base64 字符串 */
function toBase64(data: Uint8Array | string): string {
  return typeof data === 'string' ? data : Buffer.from(data).toString('base64');
}

/** AI SDK 媒体数据（image / file.data）→ ag-ui PartSource；无法映射时返回 undefined */
function modelMediaToSource(data: ModelFileData, mediaType: string): PartSource | undefined {
  // 裸值：base64 字符串 / URL 对象 / 二进制
  if (typeof data === 'string') return { type: 'data', value: data, mimeType: mediaType };
  if (data instanceof URL) return { type: 'url', value: data.toString(), mimeType: mediaType };
  if (data instanceof Uint8Array) {
    return { type: 'data', value: Buffer.from(data).toString('base64'), mimeType: mediaType };
  }
  if (data instanceof ArrayBuffer) {
    return { type: 'data', value: Buffer.from(data).toString('base64'), mimeType: mediaType };
  }

  // 打 tag 的 FileData 与裸 ProviderReference
  switch ((data as { type?: string }).type) {
    case 'data': {
      const d = data as { data: Uint8Array | string };
      return { type: 'data', value: toBase64(d.data), mimeType: mediaType };
    }
    case 'url': {
      const u = data as { url: URL; originalUrl?: string };
      return { type: 'url', value: u.originalUrl ?? u.url.toString(), mimeType: mediaType };
    }
    case 'reference': {
      const [provider, value] = Object.entries((data as { reference: Record<string, string> }).reference)[0] ?? [];
      return value ? { type: 'file', value, ...(provider ? { provider } : {}) } : undefined;
    }
    case 'text':
      return { type: 'data', value: Buffer.from((data as { text: string }).text).toString('base64'), mimeType: 'text/plain' };
    default: {
      // 裸 ProviderReference（Record<string,string>，无 type 判别）
      const [provider, value] = Object.entries(data as Record<string, string>)[0] ?? [];
      return value ? { type: 'file', value, ...(provider ? { provider } : {}) } : undefined;
    }
  }
}

/** AI SDK user content part → ag-ui ContentPart；不支持时返回 undefined */
function modelContentPartToAguiPart(part: ModelUserContentPart): AgUiContentPart | undefined {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image': {
      const source = modelMediaToSource(part.image as ModelFileData, part.mediaType ?? 'image');
      return source ? { type: 'image', source } : undefined;
    }
    case 'file': {
      const source = modelMediaToSource(part.data, part.mediaType);
      return source ? { type: filePartKind(part.mediaType), source } : undefined;
    }
  }
}

/**
 * ModelMessage user content → ag-ui 消息 content。
 * string 原样透传；parts 逐个映射（text → text，image/file → 对应媒体 part），无法映射的 part 丢弃。
 *
 * @param content - ModelMessage user content（string 或 TextPart/ImagePart/FilePart[]）
 * @returns ag-ui 消息 content（string 或 ContentPart[]）
 */
export function modelContentToAguiContent(
  content: string | ModelUserContentParts,
): string | AgUiContentPart[] {
  if (typeof content === 'string') return content;
  const parts: AgUiContentPart[] = [];
  for (const part of content) {
    const mapped = modelContentPartToAguiPart(part);
    if (mapped) parts.push(mapped);
  }
  return parts;
}
