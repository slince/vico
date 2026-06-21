/** src/thread/file-thread-store.ts */
import type { ThreadStore, Thread, Turn, Message } from './types.js';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** FileThreadStore 配置 */
export interface FileThreadStoreOptions {
  /** 数据存储目录 */
  dir: string;
}

/** 文件版 ThreadStore — 每个实体存储为独立 JSON 文件 */
export class FileThreadStore implements ThreadStore {
  private threadsDir: string;
  private turnsDir: string;
  private messagesDir: string;

  constructor(private readonly options: FileThreadStoreOptions) {
    this.threadsDir = join(options.dir, 'threads');
    this.turnsDir = join(options.dir, 'turns');
    this.messagesDir = join(options.dir, 'messages');
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.threadsDir, { recursive: true });
    await mkdir(this.turnsDir, { recursive: true });
    await mkdir(this.messagesDir, { recursive: true });
  }

  private async readJSON<T>(filePath: string): Promise<T | undefined> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  private async writeJSON(filePath: string, data: unknown): Promise<void> {
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async listJSON<T>(dir: string, filter?: (item: T) => boolean): Promise<T[]> {
    await this.ensureDirs();
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    const result: T[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const item = await this.readJSON<T>(join(dir, file));
      if (item && (!filter || filter(item))) {
        result.push(item);
      }
    }
    return result;
  }

  // Thread 操作

  async createThread(agentId: string, title: string, id: string): Promise<Thread> {
    await this.ensureDirs();
    const now = Date.now();
    const thread: Thread = {
      id,
      agentId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    await this.writeJSON(join(this.threadsDir, `${thread.id}.json`), thread);
    return thread;
  }

  async getThread(threadId: string): Promise<Thread | undefined> {
    return this.readJSON<Thread>(join(this.threadsDir, `${threadId}.json`));
  }

  async listThreads(agentId?: string): Promise<Thread[]> {
    return this.listJSON<Thread>(
      this.threadsDir,
      agentId ? (t) => t.agentId === agentId : undefined,
    );
  }

  // Turn 操作

  async createTurn(threadId: string): Promise<Turn> {
    await this.ensureDirs();
    const turn: Turn = {
      id: crypto.randomUUID(),
      threadId,
      status: 'running',
      steps: 0,
      createdAt: Date.now(),
    };
    await this.writeJSON(join(this.turnsDir, `${turn.id}.json`), turn);
    return turn;
  }

  async updateTurn(turnId: string, patch: Partial<Turn>): Promise<void> {
    const turn = await this.readJSON<Turn>(join(this.turnsDir, `${turnId}.json`));
    if (turn) {
      Object.assign(turn, patch);
      await this.writeJSON(join(this.turnsDir, `${turnId}.json`), turn);
    }
  }

  async getTurn(turnId: string): Promise<Turn | undefined> {
    return this.readJSON<Turn>(join(this.turnsDir, `${turnId}.json`));
  }

  // Message 操作

  async appendEntry(entry: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    await this.ensureDirs();
    const msg: Message = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    const msgFile = join(this.messagesDir, `${msg.id}.json`);
    await this.writeJSON(msgFile, msg);
    return msg;
  }

  async getEntries(threadId: string, options?: { limit?: number; start?: number }): Promise<Message[]> {
    const all = await this.listJSON<Message>(
      this.messagesDir,
      (m) => m.threadId === threadId,
    );
    all.sort((a, b) => a.createdAt - b.createdAt);
    const start = options?.start ?? 0;
    const end = options?.limit ? start + options.limit : undefined;
    return all.slice(start, end);
  }

  async getRecentEntries(threadId: string, limit: number): Promise<Message[]> {
    const all = await this.listJSON<Message>(
      this.messagesDir,
      (m) => m.threadId === threadId,
    );
    all.sort((a, b) => a.createdAt - b.createdAt);
    return all.length > limit ? all.slice(all.length - limit) : all;
  }
}
