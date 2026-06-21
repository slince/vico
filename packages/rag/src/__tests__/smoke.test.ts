// @vico/rag — Smoke tests for core modules
import { describe, it, expect } from 'vitest';
import { RecursiveChunker } from '../chunking/recursive.js';
import { SentenceChunker } from '../chunking/sentence.js';
import { MarkdownChunker } from '../chunking/markdown.js';
import { CodeChunker } from '../chunking/code.js';
import { InMemoryVectorStore } from '../vector-store/in-memory.js';
import { dedup } from '../retrieval/dedup.js';
import { formatResults, joinResults } from '../retrieval/formatter.js';
import { DefaultQueryRewriter } from '../retrieval/query-rewrite.js';
import { DEFAULT_RAG_CONFIG } from '../types/config.js';
import { DefaultParserRegistry } from '../parsing/registry.js';
import { TextParser } from '../parsing/text-parser.js';
import { MarkdownParser } from '../parsing/markdown-parser.js';

describe('RecursiveChunker', () => {
  it('chunks text into pieces', async () => {
    const chunker = new RecursiveChunker();
    const text = 'Hello world.\n\nThis is a test.\n\nMore content here.';
    const chunks = await chunker.chunk(text, { strategy: 'recursive', size: 20, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text).toBeDefined();
    expect(chunks[0].index).toBe(0);
  });

  it('applies overlap between chunks', async () => {
    const chunker = new RecursiveChunker();
    const text = 'A long text that should be split across multiple chunks due to the small chunk size limit.';
    const chunks = await chunker.chunk(text, { strategy: 'recursive', size: 30, overlap: 10 });
    if (chunks.length > 1) {
      const lastOfFirst = chunks[0].text.slice(-10);
      const firstOfSecond = chunks[1].text.slice(0, 10);
      expect(firstOfSecond).toBe(lastOfFirst);
    }
  });
});

describe('SentenceChunker', () => {
  it('splits by sentences', async () => {
    const chunker = new SentenceChunker();
    const text = 'First sentence。Second sentence！Third question？Fourth statement.';
    const chunks = await chunker.chunk(text, { strategy: 'sentence', size: 100, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('InMemoryVectorStore', () => {
  it('creates index and upserts vectors', async () => {
    const store = new InMemoryVectorStore();
    await store.createIndex({ indexName: 'test', dimension: 3, metric: 'cosine' });
    await store.upsert({
      indexName: 'test',
      vectors: [[1, 0, 0], [0, 1, 0]],
      ids: ['a', 'b'],
      metadata: [{ content: 'hello' }, { content: 'world' }],
    });
    const results = await store.query({ indexName: 'test', queryVector: [1, 0, 0], topK: 2 });
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('a');
    expect(results[0].score).toBeGreaterThan(0.9);
  });

  it('filters by metadata', async () => {
    const store = new InMemoryVectorStore();
    await store.createIndex({ indexName: 'test', dimension: 2, metric: 'cosine' });
    await store.upsert({
      indexName: 'test',
      vectors: [[1, 0], [1, 1]],
      ids: ['a', 'b'],
      metadata: [{ type: 'doc' }, { type: 'code' }],
    });
    const results = await store.query({
      indexName: 'test', queryVector: [1, 0], topK: 10,
      filter: { type: 'code' },
    });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('b');
  });

  it('deletes vectors', async () => {
    const store = new InMemoryVectorStore();
    await store.createIndex({ indexName: 'test', dimension: 2, metric: 'cosine' });
    await store.upsert({
      indexName: 'test',
      vectors: [[1, 0]],
      ids: ['a'],
      metadata: [{}],
    });
    await store.deleteVectors({ indexName: 'test', ids: ['a'] });
    const results = await store.query({ indexName: 'test', queryVector: [1, 0], topK: 10 });
    expect(results.length).toBe(0);
  });

  it('drops index', async () => {
    const store = new InMemoryVectorStore();
    await store.createIndex({ indexName: 'test', dimension: 2, metric: 'cosine' });
    await store.dropIndex('test');
    const results = await store.query({ indexName: 'test', queryVector: [1, 0], topK: 10 });
    expect(results.length).toBe(0);
  });
});

describe('dedup', () => {
  it('removes duplicate ids keeping highest score', () => {
    const results = [
      { id: 'a', score: 0.9, metadata: {} },
      { id: 'a', score: 0.8, metadata: {} },
      { id: 'b', score: 0.7, metadata: {} },
    ];
    const unique = dedup(results);
    expect(unique).toHaveLength(2);
    expect(unique.find((r) => r.id === 'a')!.score).toBe(0.9);
  });
});

describe('formatResults', () => {
  it('formats results with source marker', () => {
    const formatted = formatResults([{
      id: 'a',
      content: 'hello world',
      score: 0.9,
      metadata: { filename: 'test.md', chunk_index: 3 },
    }]);
    expect(formatted[0]).toContain('[source: test.md#chunk3]');
    expect(formatted[0]).toContain('hello world');
  });

  it('joins results', () => {
    const joined = joinResults(['[source: a.md#chunk0] text1', '[source: a.md#chunk1] text2']);
    expect(joined).toContain('\n\n');
  });
});

describe('DefaultQueryRewriter', () => {
  it('returns original query by default', async () => {
    const rewriter = new DefaultQueryRewriter();
    const rewrites = await rewriter.rewrite('test query');
    expect(rewrites).toEqual(['test query']);
  });

  it('caches results', async () => {
    const rewriter = new DefaultQueryRewriter();
    await rewriter.rewrite('test');
    const rewrites = await rewriter.rewrite('test');
    expect(rewrites).toEqual(['test']);
  });

  it('uses LLM rewriter when injected', async () => {
    const rewriter = new DefaultQueryRewriter(async (q) => [q, `${q} variant`]);
    const rewrites = await rewriter.rewrite('hello');
    expect(rewrites).toHaveLength(2);
    expect(rewrites[1]).toBe('hello variant');
  });
});

describe('DEFAULT_RAG_CONFIG', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_RAG_CONFIG.chunk.size).toBe(512);
    expect(DEFAULT_RAG_CONFIG.chunk.overlap).toBe(64);
    expect(DEFAULT_RAG_CONFIG.retrieval.topK).toBe(5);
    expect(DEFAULT_RAG_CONFIG.retrieval.similarityThreshold).toBe(0.7);
  });
});

describe('DefaultParserRegistry', () => {
  it('MarkdownChunker splits by headings', async () => {
    const chunker = new MarkdownChunker();
    const text = '# Intro\n\nThis is the intro.\n\n## Section 1\n\nContent of section 1.\n\n### Sub 1.1\n\nDeeper content.\n\n## Section 2\n\nFinal section.';
    const chunks = await chunker.chunk(text, { strategy: 'markdown', size: 200, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // 应该包含标题路径
    const hasSection2 = chunks.some((c) => c.text.includes('Section 2'));
    expect(hasSection2).toBe(true);
  });

  it('MarkdownChunker preserves heading path in metadata', async () => {
    const chunker = new MarkdownChunker();
    const text = '# Top\n\nIntro text.\n\n## Child\n\nChild content that is quite long and detailed here.';
    const chunks = await chunker.chunk(text, { strategy: 'markdown', size: 100, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.headingPath).toBeDefined();
  });

  it('CodeChunker splits by function/class boundaries', async () => {
    const chunker = new CodeChunker();
    const code = [
      'import { foo } from "bar";',
      '',
      'export function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
      '',
      'export function multiply(a: number, b: number): number {',
      '  return a * b;',
      '}',
      '',
      'export class Calculator {',
      '  private value = 0;',
      '  add(n: number) { this.value += n; }',
      '  get() { return this.value; }',
      '}',
    ].join('\n');
    const chunks = await chunker.chunk(code, { strategy: 'code', size: 60, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // 应该包含 preamble block 和至少一个函数/类 block
    const hasImport = chunks.some((c) => c.text.includes('import'));
    const hasAdd = chunks.some((c) => c.text.includes('function add'));
    expect(hasImport).toBe(true);
    expect(hasAdd).toBe(true);
  });

  it('CodeChunker handles large blocks', async () => {
    const chunker = new CodeChunker();
    // 构造一个超长函数
    const lines = ['function compute() {'];
    for (let i = 0; i < 100; i++) {
      lines.push(`  const x${i} = ${i} * 2;`);
    }
    lines.push('  return x0;');
    lines.push('}');
    const code = lines.join('\n');
    const chunks = await chunker.chunk(code, { strategy: 'code', size: 200, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('registers and finds parser by extension', () => {
    const registry = new DefaultParserRegistry();
    registry.register(new MarkdownParser());
    registry.register(new TextParser());

    const md = registry.findParser('doc.md');
    expect(md?.name).toBe('markdown');

    const txt = registry.findParser('script.py');
    expect(txt?.name).toBe('text');
  });
});
