import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../db/db.js';

const { exec_approvals } = schema;

/** 审批状态 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** 审批结果 */
export interface ApprovalResult {
  status: ApprovalStatus;
}

/**
 * 命令执行审批服务。
 * 提供审批记录的创建和轮询等待能力。
 */
class ApprovalService {
  /**
   * 创建一条 pending 状态的审批记录。
   *
   * @param tenantId - 租户 ID
   * @param command - 待审批的命令
   * @returns 审批记录 ID
   */
  async create(tenantId: string, command: string): Promise<string> {
    const db = getDb();
    const id = uuid();
    await db.insert(exec_approvals).values({
      id,
      tenant_id: tenantId,
      agent_id: '',
      command,
      status: 'pending',
      created_at: Date.now(),
      resolved_at: null,
    }).run();
    return id;
  }

  /**
   * 轮询等待审批结果。
   *
   * @param approvalId - 审批记录 ID
   * @param maxWaitMs - 最长等待时间（毫秒），默认 2 分钟
   * @param pollIntervalMs - 轮询间隔（毫秒），默认 500
   * @returns 审批结果，超时返回 status='pending'
   */
  async waitFor(
    approvalId: string,
    maxWaitMs: number = 2 * 60 * 1000,
    pollIntervalMs: number = 500,
  ): Promise<ApprovalResult> {
    const db = getDb();
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const record = await db.select({ status: exec_approvals.status })
        .from(exec_approvals)
        .where(eq(exec_approvals.id, approvalId))
        .get();

      if (!record) break;
      if (record.status === 'approved' || record.status === 'rejected') {
        return { status: record.status as ApprovalStatus };
      }
    }

    return { status: 'pending' };
  }

  /**
   * 创建审批并等待结果（一步完成）。
   *
   * @param tenantId - 租户 ID
   * @param command - 待审批的命令
   * @returns 审批状态
   */
  async requestAndWait(tenantId: string, command: string): Promise<ApprovalResult> {
    const id = await this.create(tenantId, command);
    return this.waitFor(id);
  }
}

export const approvalService = new ApprovalService();
