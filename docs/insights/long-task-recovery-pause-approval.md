# 长任务恢复、会话暂停与工具审批机制分析

> 本文档对 Vico Agent 引擎的三个核心控制流机制进行逐行剖析，并直言其设计缺陷。
> 分析基于 `packages/agent/src/agent-loop/agent-loop.ts`（773 行，整个引擎的心脏）。

---

## 一、架构概览

三个机制并非独立模块，而是盘踞在同一块代码中的共生体：

```
用户消息 → startLoop()
  ├─ 无未完成 turn → startTurn() → runTurnLoop() → executeModelStep() × N
  ├─ 有 pauseInfo   → resumeTurn() → applyPauseInfoRecovery() → runTurnLoop()
  └─ 无 pauseInfo   → resumeTurn() → healTurnMessages() → runTurnLoop()
```

`executeModelStep()`（L423-498）是核心决策点：模型输出 toolCalls → `resolveToolApprovals()` 分类 → 有需审批的则暂停，否则执行。整个"暂停-恢复"机制本质上是一个**单 turn 内的断点续传**，而非真正的会话级暂停。

---

## 二、长任务恢复机制

### 2.1 两条恢复路径

**路径 A — 标准暂停恢复（有 pauseInfo）**

`PauseInfo`（loop-agent-options.ts L78-91）序列化在 `turn.metadata` 中，包含：
- `pendingToolCalls`：等待用户审批的调用
- `autoApprovedCalls`：暂停时已自动批准的调用（恢复时直接执行）
- `autoDeniedResults`：暂停时已自动拒绝的结果（恢复时直接追加）
- `pausedAtStep`：从哪个 step 继续

恢复时 `applyPauseInfoRecovery()`（L237-274）按三步回放：执行 autoApproved → 追加 autoDenied → 根据客户端传入的 `approvalDecisions` 处理 pending。

**路径 B — 崩溃愈合模式（无 pauseInfo）**

当进程崩溃导致 turn 处于 `running`/`failed` 状态但无 `pauseInfo` 时，`healTurnMessages()`（L290-329）介入：
1. 从消息数组末尾向前扫描，找到最后一条 assistant 消息中未配对的 toolCalls
2. 重新跑审批分类
3. 有需审批的 → 重新构造 PauseInfo 并暂停；否则直接执行

### 2.2 问题

**TOCTOU 竞态是明知故犯。** L115-116 的注释坦白了 `getLatestTurn` → `createTurn` 之间的检查-执行窗口，然后两手一摊，把锅甩给 "threadStore 实现侧的并发控制"。而 `InMemoryThreadStore` 和 `FileThreadStore` 都没有任何锁或 CAS。两个并发请求同时打到同一 threadId —— 要么双双进入恢复路径互相踩踏，要么双双创建新 turn。这不是"待实现"，这是埋雷。

**愈合模式只看最后一条 assistant 消息。** `findUnresolvedToolCalls()`（L753-771）从消息数组末尾向前扫描，找到第一条 assistant 就停。如果一个 turn 在第二轮的 tool-call 执行中途崩溃（即第一轮的 tool_result 已有，第二轮的 assistant(toolCalls) 是最新消息），这没问题。但如果消息顺序因为某种原因不是严格交错的（比如先发了多条 assistant 再批量执行工具），愈合就只缝合了最后一层伤口，前面的口子还在。注释说"消息链是严格顺序的，因此只需检查最后一条"——这取决于所有代码路径、所有自定义 tool、所有子 agent 都遵守这个约定。没有防御性校验，只有一个乐观假设。

**`messageCount` 字段是废的。** PauseInfo 里存了 `messageCount`，注释写着"完整性校验"（L89-90），但整个代码库里没有任何地方读取这个字段做校验。恢复时既不比对消息数量，也不检查消息内容是否被篡改。存了个寂寞。

**工具执行没有检查点。** `executeToolCalls()` 批量执行多个工具（readonly 并行 + 其余串行），如果进程在执行到一半时崩溃，已执行的工具结果没有持久化到消息链中。愈合模式会把**所有**未配对的 toolCalls 重新执行一遍。对于 `kind: 'mutation'` 的工具（写文件、发请求、改数据库），这意味着**重复执行**。没有幂等性保证，没有执行状态标记，崩溃=重放。

**StormBreaker 状态是内存级的。** `ToolBroker` 里的 `StormBreaker`（tool-broker.ts L8）是个 `Map`，崩溃即失忆。如果一个恶意或 buggy 的模型在同一个 turn 里反复调用同一个工具，每次崩溃-愈合循环都会重置风暴计数器。攻击面不大但确实存在。

**没有卡死 turn 的超时机制。** 一个 turn 暂停后可以永远停在那。没有 TTL，没有自动清理，没有僵尸检测。如果客户端断连且永不重连，turn 就是数据库里一条永恒的半死记录。

---

## 三、会话暂停机制

### 3.1 实现方式

系统不存在独立于 turn 的"会话暂停"概念。暂停以 turn 为粒度：

1. `executeModelStep()` 检测到需审批的工具 → 从内存 messages 中 `pop()` 掉 assistant 消息（但 DB 中保留） → 构造 PauseInfo → `updateTurn({status: 'paused', metadata: {pauseInfo}})` → step loop 返回 `{finalStatus: 'paused'}`
2. `startTurnLoop()` 收到 paused → `pipeline.leave()` **不调用**（保留 context processor 状态） → trace span 以 `status: 'paused'` 结束
3. SSE 流通过 `turn-stream.ts` 发出 `data-turn-paused` 自定义 chunk → `controller.close()`

### 3.2 问题

**SSE 连接在暂停时关闭。** 这不是"暂停"，这是"断开"。客户端收到 `data-turn-paused` 后连接就断了，恢复时必须重新建连。所谓"暂停-恢复"在传输层就是一断一连，中间状态全靠 DB 里的序列化数据撑着。如果客户端想在暂停期间保持长连接展示"等待审批中…"的 UI 状态——抱歉，做不到，除非你自己开个 polling。

**并发消息处理是未定义的。** 如果一个 turn 处于 paused 状态，用户又发了一条消息，`startLoop()` 会看到 `latestTurn.status !== 'completed'`，直接进入 `resumeTurn()`。新消息被当作"恢复后的追加消息"拼到消息链末尾（L224）。如果用户本意是想说"算了别等审批了，换个问题"——对不起，你的新消息变成了上一个未完成对话的补充说明。没有消息队列、没有意图区分。

**Abort 不持久化。** 用户调用 `TurnOutput.abort()` 只是触发内存中的 `AbortController`。如果 turn 已暂停、连接已断开，abort 信号根本传不到服务端。崩溃后愈合模式看到一个 `running` 的 turn，乐呵呵地帮你恢复执行。用户明明想取消，系统却说"我帮你继续"。

**没有暂停次数/时间上限。** 一个 turn 可以暂停-恢复无限次。每次恢复都重新创建 `toolApprovalState`，每次 `on-request` 工具出现都会再次暂停。理论上一个恶意或设计不当的工具集可以让 turn 永久颠簸在暂停-恢复之间。

---

## 四、工具审批机制

### 4.1 审批流水线

**策略层：**

| 策略 | `resolvePolicy()` 返回值 | 实际行为 |
|------|--------------------------|----------|
| `auto` | `{approved: true}` | 静默执行 |
| `suggest` | `{approved: true}` | 与 auto 完全相同（建议了个寂寞） |
| `never` | `{approved: false}` | 直接拒绝 |
| `on-request` | `{approved: false}` | 首次使用暂停（但永远都是"首次"，见下文） |

**执行层（`resolveToolApprovals()` L503-565）：**

对每个 toolCall：
1. 未注册工具 → 直接拒绝
2. 调用 `approvalResolver` → 若 approved → 标记 `toolApprovalState`，加入 approvedCalls
3. 若 not approved + `policy === 'on-request'` + 首次使用 → 暂停等用户审批
4. 其他 → 拒绝

### 4.2 问题

**`suggest` 策略形同虚设。** 看 `resolvePolicy()`（tool/utils.ts L31-32）：`case 'suggest': return { approved: true }`。和 `auto` 一模一样。"建议"的意义应该是通知用户但不强制暂停，但目前的实现连通知都没有——没有任何事件发出，没有任何 UI 提示。这个策略的存在纯粹是为了凑齐四种 policy 类型。

**`on-request` 是一个永远循环的审批地狱。** 这是整个审批系统最讽刺的设计缺陷，需要仔细展开：

`resolvePolicy()` 里 `on-request` 的处理（L26-30）：
```typescript
case 'on-request':
  // if (!ctx.firstUse && ctx.previousApproved) {
  //   return { approved: true };
  // }
  return { approved: false, reason: `...首次使用需要用户审批` };
```

注意：真正能让 `on-request` 在第二次使用时自动放行的逻辑被**注释掉了**。所以 `resolvePolicy()` 永远对 `on-request` 返回 `approved: false`。

那首次使用时的暂停是怎么触发的？靠的是 `resolveToolApprovals()` 里的特殊判断（L537-553）：当 `policy === 'on-request' && isFirstUse && !wasApproved` 时，不直接拒绝，而是推入暂停队列。这里的关键变量是 `isFirstUse`，它检查的是 `context.toolApprovalState.has(call.name)`。

但 `toolApprovalState` 只在 `decision.approved === true` 时被设置（L530-531）。而 `resolvePolicy()` 对 `on-request` 永不返回 `approved: true`。所以 `toolApprovalState` 里永远不会记录 `on-request` 工具的审批状态。

结果：
- **Step 1**：模型调用 `on-request` 工具 X → `isFirstUse=true` → 暂停 → 用户批准 → 执行
- **Step 2**（同一 turn 恢复后）：`toolApprovalState` 是全新的空 Map（resumeTurn L193）→ 模型再次调用工具 X → `isFirstUse=true` → **再次暂停**

同一个 turn 内、同一个工具、每一次 step 都要审批一次。这不是"首次使用需要审批"，这是"每次使用都需要审批"。那段被注释掉的代码说明**原作者知道这个问题**，但不知道为什么关掉了。

**恢复时 toolApprovalState 丢失。** 上一条的延伸。`resumeTurn()` L193 每次都 `new Map<string, boolean>()`。暂停前已经批准过的 auto 工具标记全部清空。虽然 auto 工具每次都会被 `resolvePolicy()` 放行，但 `PolicyContext.previousApproved` 永远为 false，自定义 `ApprovalResolver` 无法利用这个信息做更智能的决策。

**没有审批超时。** 服务端发出 `tool-approval-request` 后无限等待。如果审批方（客户端或上层网关）永远不回应，turn 永久卡在 paused。没有服务端超时自动拒绝的兜底。

**`PauseInfo.reason` 的 `'error'` 分支从未被使用。** 类型定义了 `reason: 'tool-approval' | 'error'`，但全代码库搜索，只有 `'tool-approval'` 被实际赋值。`'error'` 分支是为"工具执行出错后暂停等用户决定"准备的，但从未实现。`applyPauseInfoRecovery()` L238 甚至硬编码了 `if (pauseInfo.reason !== 'tool-approval') return`，直接把 error 分支短路掉。

**客户端审批 UI 不在本仓库。** SSE 协议发了 `tool-approval-request`（含 approvalId、toolCallId、toolName、input），期望客户端在下次 `run()` 时通过 `approvalDecisions` 数组传回决策。但 `packages/web/` 下没有对应的审批对话框组件。这意味着对接方需要自己理解这个协议并实现 UI。协议本身没有版本号，没有 capability 协商，字段变更=静默 break。

---

## 五、跨机制的系统性问题

**一切状态靠 turn.metadata 扛。** 恢复、审批、愈合所需的所有信息全部塞在 `turn.metadata` 这个 `Record<string, unknown>` 字段里。没有 schema 版本号，没有迁移策略。如果 PauseInfo 结构变更，老数据直接变成垃圾，愈合模式无法处理。

**测试覆盖几乎可以忽略。** `packages/agent/src/` 下没有针对恢复路径、愈合模式、审批超时、并发场景的测试文件。AgentLoop 773 行核心代码，其中的 resumeTurn、healTurnMessages、applyPauseInfoRecovery 三个关键方法承载了最复杂的容错逻辑，但没有隔离测试。每次改审批逻辑，恢复路径是否正确只能靠"跑一下看看"。

**并发模型不清晰。** Agent 实例和 ThreadStore 之间没有明确的所有权模型。多实例共享同一个 DB 下的同一个 thread —— 谁会赢？文档没说，代码没处理。

**单点故障域过大。** `agent-loop.ts` 一个文件承担了：模型调用、工具审批、消息持久化、上下文压缩、token 经济、暂停恢复、崩溃愈合、事件发射、SSE 流控制。773 行看似不多，但职责密度极高。任何一个机制的修改都可能波及其他机制。

---

## 六、P0 问题修复方案（已实施）

### 6.1 P0-1：修复 `on-request` 每次 step 都重复审批

**根因分析：**

两个协同缺陷导致了这个问题：

1. **`resolvePolicy()` 中长期记忆逻辑被注释掉**（`tool/utils.ts` L27-29）。该函数对 `on-request` 永远返回 `approved: false`，永远不会自发地将已审批工具标记为放行。
2. **`toolApprovalState` 在 resume 时被重置为空 Map**（`agent-loop.ts` L193）。即使用户在上一轮暂停中批准了工具 X，恢复后该记录完全丢失。
3. **用户批准后未回填 `toolApprovalState`**。`applyPauseInfoRecovery()` 执行了用户批准的工具调用，但从未将批准结果写入 `context.toolApprovalState`。

三者合力：`toolApprovalState` 为空 → `isFirstUse=true` → `wasApproved=false` → 暂停条件命中 → 再次暂停。用户每 step 都要面对同一个工具的审批弹窗。

**修复（3 处改动）：**

**改动 1 — `packages/agent/src/tool/utils.ts`：取消注释 `resolvePolicy()` 中的已审批放行逻辑**

```typescript
// Before (lines 26-30):
case 'on-request':
  // if (!ctx.firstUse && ctx.previousApproved) {
  //   return { approved: true };
  // }
  return { approved: false, reason: `工具 ${call.name} 首次使用需要用户审批` };

// After:
case 'on-request':
  // 同一 turn 内已审批通过的工具，后续调用自动放行，避免每次 step 都重复审批
  if (!ctx.firstUse && ctx.previousApproved) {
    return { approved: true };
  }
  return { approved: false, reason: `工具 ${call.name} 首次使用需要用户审批` };
```

**改动 2 — `packages/agent/src/agent-loop/agent-loop.ts`：`applyPauseInfoRecovery()` 中回填审批状态**

在遍历 `pauseInfo.pendingToolCalls` 时，对用户批准的工具调用写入 `toolApprovalState`：

```typescript
for (const pendingCall of pauseInfo.pendingToolCalls) {
  const approved = decisionMap.get(pendingCall.id) ?? false;
  if (approved) {
    approvedCalls.push(pendingCall);
    // 追踪到 toolApprovalState，确保同一 turn 后续 step 中该工具自动放行
    context.toolApprovalState.set(pendingCall.name, true);
  } else {
    deniedResults.push({ ... });
  }
}
```

**为什么两处都要改、而不是只改一处？**

- 只改 `resolvePolicy()` 不动 `toolApprovalState`：`PolicyContext.previousApproved` 来自 `toolApprovalState`，它永远为 false，所以 `resolvePolicy()` 的逻辑永远不会被触发。
- 只回填 `toolApprovalState` 不动 `resolvePolicy()`：`resolvePolicy()` 对 `on-request` 永远返回 `approved: false`，即使 `toolApprovalState` 中已有记录。`approved: false` 会跳过 L530 的 `decision.approved` 分支，但 L537 的暂停条件 `isFirstUse && !wasApproved` 此时 `wasApproved=true`，条件为 false，不会进入暂停，**但会落入 L557 的拒绝分支**——工具被静默拒绝，而不是自动放行。

两条逻辑必须同时对"已审批"达成共识：`resolvePolicy()` 返回 `approved: true`，且 `toolApprovalState` 中有对应记录。

**验证逻辑链：**

```
用户首次遇到 on-request 工具 X：
  → toolApprovalState 无记录 → isFirstUse=true, wasApproved=false
  → resolvePolicy() 返回 {approved:false}, policy=on-request, isFirstUse && !wasApproved=true
  → 暂停，等待审批

用户批准后，applyPauseInfoRecovery()：
  → toolApprovalState.set('X', true)  ← 改动 2

恢复后模型再次调用工具 X（同一 turn 内）：
  → isFirstUse=false, wasApproved=true
  → resolvePolicy() 返回 {approved:true}  ← 改动 1
  → decision.approved=true → 直接执行，不再暂停 ✓
```

---

### 6.2 P0-2：修复进程崩溃后工具重复执行

**根因分析：**

原有 `executeToolCalls()` 的执行-持久化是分离的：

```
executeBatch() → [Tool A ✓] [Tool B ✓] [Tool C ✗ 崩溃]
                      ↓
              appendToolResults()  ← 永远不会执行
                      ↓
              结果：A、B 实际已执行，但 DB 中无 tool_result
                     愈合模式看到未配对 toolCalls → 全部重放
                     A、B 被重复执行
```

`ToolBroker.executeBatch()` 对 readonly 工具用 `Promise.all` 并行执行，其余串行。所有结果收集完毕后，由调用方（`executeModelStep`、`healTurnMessages`、`applyPauseInfoRecovery`）统一调用 `appendToolResults()` 持久化。如果进程在 `executeBatch` 返回后、`appendToolResults` 完成前崩溃，已执行的 mutation 类工具在 DB 中没有任何痕迹，愈合模式会将其作为"未执行"重新调度。

**修复策略：逐条执行 + 立即持久化**

将执行和持久化合二为一：每完成一个工具调用，立即将其结果写入 `threadStore` 和 `context.messages`。这样：

```
Tool A 执行完成 → appendToolResults([A]) → DB 已有 tool_result_A
Tool B 执行完成 → appendToolResults([B]) → DB 已有 tool_result_B
Tool C 开始执行 → 进程崩溃
                      ↓
愈合模式：findUnresolvedToolCalls() → 看到 tool_result_A 和 tool_result_B
         → 只有 C 是未配对的 → 只重放 C  ← 不再重复执行 A、B
```

**改动（3 处）：**

**改动 1 — `executeToolCalls()` 重构为逐条执行 + 立即持久化：**

```typescript
// Before: 批量执行，批量持久化
private async executeToolCalls(toolCalls: ToolCall[], context: TurnContext): Promise<ToolResult[]> {
    const results = await this.toolBroker.executeBatch(toolCalls, ctx);
    // ... emit events
    return results;
    // 调用方负责 appendToolResults()
}

// After: 逐条执行，每条立即持久化
private async executeToolCalls(toolCalls: ToolCall[], context: TurnContext): Promise<ToolResult[]> {
    // 按 kind 分组保持原有执行策略（readonly 并行，其余串行）
    const readonlyCalls = toolCalls.filter(c => tool?.kind === 'readonly');
    const sequentialCalls = toolCalls.filter(c => tool?.kind !== 'readonly');

    const executeAndPersist = async (call: ToolCall): Promise<ToolResult> => {
      const result = await this.toolBroker.execute(call, ctx);
      await this.appendToolResults([result], context);  // 立即持久化
      this.emit({ type: 'tool-result', ... });
      return result;
    };

    // readonly 并行（各自完成即持久化），其余串行
    const results = await Promise.all(readonlyCalls.map(executeAndPersist));
    for (const call of sequentialCalls) {
      results.push(await executeAndPersist(call));
    }
    return results;  // 调用方无需再 appendToolResults
}
```

**改动 2 & 3 — 移除 `executeModelStep()` 和 `healTurnMessages()` 中的重复 `appendToolResults` 调用：**

这两个调用点原本的模式是：
```typescript
const toolResults = await this.executeToolCalls(approvedCalls, context);
toolResults.push(...deniedResults);
await this.appendToolResults(toolResults, context);  // 会重复持久化
```

改为：
```typescript
// 已批准的调用：executeToolCalls 内部已逐条持久化，无需再次 appendToolResults
await this.executeToolCalls(approvedCalls, context);
// 拒绝结果：单独持久化
if (deniedResults.length > 0) {
  await this.appendToolResults(deniedResults, context);
}
```

**改动 4 — `applyPauseInfoRecovery()` 同步修复：**

除了同样的双持久化问题外，该方法还存在一个更隐蔽的 bug：`autoDeniedResults` 被 push 到局部数组 `toolResults`，但该方法返回 `void`，`toolResults` 从未被消费。原代码依赖末尾的 `await this.appendToolResults(toolResults, context)` 来批量持久化，而这个调用恰恰把 autoDenied 和已执行结果混在一起。重构后拆分为独立持久化，修复了 autoDenied 可能丢失的问题。

**关于 readonly 工具的并行性：**

重构后 readonly 工具仍然通过 `Promise.all` 并行执行。唯一的区别是每个工具完成后立即做一次 `appendToolResults`（单条 INSERT），而非等所有完成后批量 INSERT。`appendToolResults` 内部是逐条调用 `threadStore.appendEntry()`，所以并行持久化仅意味着多次 DB 写入而非一次——对 better-sqlite3 的 WAL 模式而言，这不会造成争抢。牺牲可忽略的写入次数换取崩溃安全，值得。

**关于 `executeBatch`：**

重构后 `executeToolCalls` 不再调用 `ToolBroker.executeBatch()`，改为直接调用 `toolBroker.execute()` 单条执行。`executeBatch` 方法保留在 `ToolBroker` 中未删除，供外部直接使用者继续使用。如需，后续可标记为 deprecated。

---

### 6.3 改动文件清单

| 文件 | 改动内容 | 风险 |
|------|---------|------|
| `packages/agent/src/tool/utils.ts` | 取消注释 `on-request` 的 `!firstUse && previousApproved` 放行逻辑 | 低：逻辑等价于原注释代码的行为，仅解除注释 |
| `packages/agent/src/agent-loop/agent-loop.ts` — `applyPauseInfoRecovery()` | 用户批准后回填 `toolApprovalState`；修复 autoDenied 丢失 bug；移除重复持久化 | 中：改变了持久化时序，需验证恢复流程 |
| `packages/agent/src/agent-loop/agent-loop.ts` — `executeToolCalls()` | 重构为逐条执行+立即持久化 | 中：改变了工具执行和持久化的耦合方式 |
| `packages/agent/src/agent-loop/agent-loop.ts` — `executeModelStep()` | 移除 `appendToolResults` 的重复调用 | 低：单纯的调用移除 |
| `packages/agent/src/agent-loop/agent-loop.ts` — `healTurnMessages()` | 同上 | 低：单纯的调用移除 |

### 6.4 剩余待解决问题

| 优先级 | 问题 | 说明 |
|--------|------|------|
| P1 | 无卡死 turn 超时 | paused turn 永久卡死，需 TTL + 自动标记 failed |
| P1 | SSE 断连无优雅处理 | 暂停时 controller.close()，无法保持长连接 |
| P1 | 并发消息未定义 | paused turn 期间收到新消息语义不明 |
| P2 | `messageCount` 字段无效 | 存了但不校验，应删除或补校验 |
| P2 | `suggest` 策略形同虚设 | 与 `auto` 行为完全一致 |
| P2 | `PauseInfo` 无版本号 | 结构变更后旧数据不可恢复 |
