/**
 * StorageManager — 知识库文件持久化存储。
 *
 * 基于 files-sdk 提供统一的文件存储接口，支持本地文件系统和 S3 兼容存储（Aliyun OSS / MinIO / AWS S3）。
 * 文件按 {kbName}/YYYY/MM/DD/{uuid}-{filename} 路径组织。
 */
import { Files } from 'files-sdk';
import { fs } from 'files-sdk/fs';
import { s3 } from 'files-sdk/s3';
import { v4 as uuid } from 'uuid';
import { readFileSync } from 'node:fs';
import { config, type AppConfig } from '../../config.js';

class StorageManager {
  private filesInstance: Files | null = null;

  /** 懒加载获取 Files 实例 */
  getFiles(): Files {
    if (this.filesInstance) return this.filesInstance;
    const cfg: AppConfig['storage'] = config.storage;
    if (cfg.type === 's3') {
      this.filesInstance = new Files({
        adapter: s3({
          bucket: cfg.bucket || 'vico-storage',
          region: cfg.region || 'us-east-1',
          endpoint: cfg.endpoint,
          forcePathStyle: true,
          credentials: cfg.access_key_id ? {
            accessKeyId: cfg.access_key_id,
            secretAccessKey: cfg.secret_access_key || '',
          } : undefined,
        }),
        prefix: cfg.root || 'knowledge-bases',
      });
    } else {
      this.filesInstance = new Files({
        adapter: fs({ root: cfg.root || './data/storage' }),
      });
    }
    return this.filesInstance;
  }

  /** 生成存储 key：{kbName}/YYYY/MM/DD/{uuid}-{filename} */
  generateKey(kbName: string, filename: string): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const safeKbName = kbName.replace(/[/\\:\0\x00-\x1f]/g, '_');
    return `${safeKbName}/${y}/${m}/${d}/${uuid()}-${filename}`;
  }

  /** 上传本地文件到存储 */
  async put(localPath: string, key: string): Promise<void> {
    const files = this.getFiles();
    const buf = readFileSync(localPath);
    await files.upload(key, new Uint8Array(buf));
  }

  /** 下载文件为可读流 */
  async getStream(key: string): Promise<ReadableStream<Uint8Array>> {
    const files = this.getFiles();
    const stored = await files.download(key);
    return stored.stream();
  }

  /** 删除存储文件 */
  async delete(key: string): Promise<void> {
    const files = this.getFiles();
    await files.delete(key);
  }

  /** 检查文件是否存在 */
  async exists(key: string): Promise<boolean> {
    const files = this.getFiles();
    return files.exists(key);
  }
}

/** 存储管理器单例 */
export const storageManager = new StorageManager();
