import type {ThreadMessage} from '@assistant-ui/react';
import {describe, expect, it} from 'vitest';
import type {VicoApprovalResume} from '../types.js';
import {collectApprovalResumes, markApprovalsSent} from './resume.js';

/** 用最小结构伪造一条 assistant 消息（只填本模块读到的字段） */
function assistantMessage(parts: unknown[]): ThreadMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    createdAt: new Date(0),
    content: parts,
    status: {type: 'requires-action', reason: 'tool-calls'},
    metadata: {unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {}},
  } as unknown as ThreadMessage;
}

function toolPart(approval: Record<string, unknown> | undefined) {
  return {
    type: 'tool-call',
    toolCallId: 'c1',
    toolName: 'shell',
    args: {},
    argsText: '{}',
    ...(approval && {approval}),
  };
}

describe('collectApprovalResumes', () => {
  it('取已决议且未发送的审批', () => {
    const ongoing = assistantMessage([toolPart({id: 'a1', approved: true, reason: 'ok'})]);
    expect(collectApprovalResumes(ongoing, new Set())).toEqual([
      {approvalId: 'a1', approved: true, reason: 'ok'},
    ]);
  });

  it('未决议（approved 为 undefined）不回传', () => {
    const ongoing = assistantMessage([toolPart({id: 'a1'})]);
    expect(collectApprovalResumes(ongoing, new Set())).toEqual([]);
  });

  it('resolution 标记作废的回传', () => {
    const ongoing = assistantMessage([toolPart({id: 'a1', approved: true, resolution: 'cancelled'})]);
    expect(collectApprovalResumes(ongoing, new Set())).toEqual([]);
  });

  it('已发送过的不重复回传', () => {
    const sent = new Set<string>(['a1']);
    const ongoing = assistantMessage([toolPart({id: 'a1', approved: false})]);
    expect(collectApprovalResumes(ongoing, sent)).toEqual([]);
  });

  it('没有正在续跑的消息时返回空', () => {
    expect(collectApprovalResumes(undefined, new Set())).toEqual([]);
    const user = {
      id: 'u1',
      role: 'user',
      createdAt: new Date(0),
      content: [],
      attachments: [],
      metadata: {custom: {}},
    } as unknown as ThreadMessage;
    expect(collectApprovalResumes(user, new Set())).toEqual([]);
  });

  it('多个审批按出现顺序收集', () => {
    const ongoing = assistantMessage([
      toolPart({id: 'a1', approved: true}),
      {type: 'text', text: '继续'},
      {...toolPart({id: 'a2', approved: false}), toolCallId: 'c2'},
    ]);
    const resumes = collectApprovalResumes(ongoing, new Set());
    expect(resumes.map((r: VicoApprovalResume) => r.approvalId)).toEqual(['a1', 'a2']);
  });

  it('markApprovalsSent 记账后不再重复收集', () => {
    const sent = new Set<string>();
    const ongoing = assistantMessage([toolPart({id: 'a1', approved: true})]);
    const resumes = collectApprovalResumes(ongoing, sent);
    markApprovalsSent(resumes, sent);
    expect(collectApprovalResumes(ongoing, sent)).toEqual([]);
  });
});
