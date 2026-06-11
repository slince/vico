import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Wrench } from 'lucide-react';
import { Fragment, useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of a single tool-call entry stored as a JSON string on the message.
 * Each entry records the tool name, its arguments, and the invocation result.
 */
interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

/** Shape of a message returned inside the conversation detail payload */
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: string; // JSON-serialised ToolCall[]
  created_at: string;
}

/** Shape returned by GET /conversations/:id */
interface ConversationDetail {
  id: string;
  agent_id: string;
  agent_name?: string;
  model_name: string;
  message_count: number;
  messages: Message[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely parses the `tool_calls` JSON string on a message into an array of
 * `ToolCall` objects. Returns `null` for any unparseable / empty value.
 *
 * @param raw - the raw `tool_calls` string from the API
 * @returns parsed array, or `null` if parsing fails
 */
function parseToolCalls(raw?: string): ToolCall[] | null {
  if (!raw || raw === '[]' || raw === 'null') return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Returns a human-readable Chinese label for the given message role.
 *
 * @param role - the message role from the API
 * @returns localised role name
 */
function getRoleLabel(role: Message['role']): string {
  switch (role) {
    case 'user':
      return '用户';
    case 'assistant':
      return 'AI';
    case 'system':
      return '系统';
  }
}

/**
 * Returns the Badge variant that best visually represents the message role.
 *
 * - `user`     → `default`  (primary / prominent)
 * - `assistant` → `secondary` (accent)
 * - `system`    → `outline`   (muted / border)
 *
 * @param role - the message role
 * @returns Badge variant string
 */
function getRoleBadgeVariant(
  role: Message['role'],
): 'default' | 'secondary' | 'outline' {
  switch (role) {
    case 'user':
      return 'default';
    case 'assistant':
      return 'secondary';
    case 'system':
      return 'outline';
  }
}

/**
 * Determines the flexbox justification class for the message bubble wrapper.
 *
 * - user messages are right-aligned
 * - assistant messages are left-aligned
 * - system messages are centered
 *
 * @param role - the message role
 * @returns Tailwind flex justify class
 */
function getJustifyClass(role: Message['role']): string {
  switch (role) {
    case 'user':
      return 'justify-end';
    case 'assistant':
      return 'justify-start';
    case 'system':
      return 'justify-center';
  }
}

/**
 * Determines the background / border style class for the message bubble.
 *
 * - user      → primary bg + primary foreground text
 * - assistant → accent bg
 * - system    → muted bg + border
 *
 * @param role - the message role
 * @returns Tailwind classes for the bubble container
 */
function getBubbleStyle(role: Message['role']): string {
  switch (role) {
    case 'user':
      return 'bg-primary text-primary-foreground';
    case 'assistant':
      return 'bg-accent text-accent-foreground';
    case 'system':
      return 'bg-muted border text-muted-foreground';
  }
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

/**
 * Renders a skeleton placeholder for the conversation detail page.
 *
 * Mimics the structure of the loaded page: a header bar and a list of message
 * bubble skeletons of varying widths to suggest different message lengths.
 */
function ConversationDetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-9 w-9 rounded-md" />
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      {/* Message list skeleton – simulated bubbles of varying widths */}
      <div className="max-w-3xl space-y-4">
        {/* Right-aligned skeleton (user) */}
        <div className="flex justify-end">
          <Skeleton className="h-20 w-3/5 rounded-lg" />
        </div>
        {/* Left-aligned skeleton (assistant) */}
        <div className="flex justify-start">
          <Skeleton className="h-28 w-4/5 rounded-lg" />
        </div>
        {/* Right-aligned skeleton (user) */}
        <div className="flex justify-end">
          <Skeleton className="h-14 w-2/5 rounded-lg" />
        </div>
        {/* Left-aligned skeleton (assistant) */}
        <div className="flex justify-start">
          <Skeleton className="h-24 w-3/4 rounded-lg" />
        </div>
        {/* Centered skeleton (system) */}
        <div className="flex justify-center">
          <Skeleton className="h-10 w-1/2 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Props for the {@link ToolCallSection} component.
 */
interface ToolCallSectionProps {
  /** Raw JSON string containing the serialised tool calls */
  toolCallsRaw: string;
}

/**
 * Renders a collapsible "Tool Calls" section using native HTML `<details>` /
 * `<summary>` elements.
 *
 * When expanded the component pretty-prints the parsed tool-call JSON array
 * inside a `<pre>` block.
 *
 * @param props - component props
 */
function ToolCallSection({ toolCallsRaw }: ToolCallSectionProps) {
  const toolCalls = parseToolCalls(toolCallsRaw);

  // Do not render anything if the JSON was empty or unparseable
  if (!toolCalls) return null;

  return (
    <details className="mt-2 group">
      {/* Collapsible summary row with wrench icon and call count */}
      <summary className="flex items-center gap-1 text-xs cursor-pointer opacity-70 hover:opacity-100 select-none">
        <Wrench size={12} />
        <span>工具调用 ({toolCalls.length})</span>
      </summary>

      {/* Pretty-printed JSON body */}
      <pre className="mt-1.5 p-2 bg-background rounded-md text-xs overflow-x-auto border">
        {JSON.stringify(toolCalls, null, 2)}
      </pre>
    </details>
  );
}

/**
 * Props for the {@link MessageBubble} component.
 */
interface MessageBubbleProps {
  /** The message object to render */
  message: Message;
}

/**
 * Renders a single chat message as a styled bubble.
 *
 * Layout behaviour per role:
 * - `user`      – right-aligned, primary colour
 * - `assistant` – left-aligned, accent colour
 * - `system`    – centered, muted / bordered
 *
 * Each bubble displays a role Badge, a timestamp, the message content, and
 * (when applicable) a collapsible tool-call expander.
 *
 * @param props - component props
 */
function MessageBubble({ message }: MessageBubbleProps) {
  const roleLabel = getRoleLabel(message.role);
  const badgeVariant = getRoleBadgeVariant(message.role);
  const justifyClass = getJustifyClass(message.role);
  const bubbleStyle = getBubbleStyle(message.role);

  return (
    <div className={`flex ${justifyClass}`}>
      {/* Bubble container constrained to 85 % of the parent width */}
      <div className={`max-w-[85%] rounded-lg px-4 py-3 ${bubbleStyle}`}>
        {/* Meta row: role badge + timestamp */}
        <div className="flex items-center gap-2 mb-1.5">
          <Badge variant={badgeVariant} className="text-xs">
            {roleLabel}
          </Badge>
          <span className="text-xs opacity-50">
            {new Date(message.created_at).toLocaleTimeString('zh-CN')}
          </span>
        </div>

        {/* Message text – preserve whitespace and line breaks */}
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>

        {/* Tool calls section (only rendered when tool_calls is non-trivial) */}
        {message.tool_calls && <ToolCallSection toolCallsRaw={message.tool_calls} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Conversation detail page.
 *
 * Displays the full message history for a single conversation identified by
 * the `:id` route param. Each message is rendered as a role-aware bubble with
 * optional tool-call disclosure.
 *
 * States handled:
 * - **loading**  – skeleton layout
 * - **not found** – fallback text when the API returns falsy data
 * - **data**      – message list inside a ScrollArea
 *
 * Navigation: a back button returns the user to `/conversations`.
 */
export default function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ---- query -------------------------------------------------------------

  /** Fetch the full conversation payload; only runs when `id` is available */
  const {
    data: conversation,
    isLoading,
  } = useQuery<ConversationDetail>({
    queryKey: ['conversation', id],
    queryFn: () => api(`/conversations/${id}`),
    enabled: !!id, // prevent the query from firing with an undefined id
  });

  // ---- navigation callback -----------------------------------------------

  /**
   * Navigates back to the conversations list. Uses `useCallback` to keep a
   * stable reference for the button `onClick` handler.
   */
  const handleBack = useCallback(() => {
    navigate('/conversations');
  }, [navigate]);

  // ---- loading state -----------------------------------------------------
  if (isLoading) {
    return <ConversationDetailSkeleton />;
  }

  // ---- not-found guard ---------------------------------------------------
  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        对话未找到
      </div>
    );
  }

  // ---- derived values ----------------------------------------------------

  /** Message list – default to empty array if not present */
  const messages: Message[] = conversation.messages ?? [];

  // ---- render ------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header bar: back button + metadata */}
      <div className="flex items-center gap-4">
        {/* Back navigation button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label="返回对话列表"
        >
          <ArrowLeft size={20} />
        </Button>

        <div>
          <h2 className="text-2xl font-bold tracking-tight">对话详情</h2>

          {/* Metadata line: agent name, model, message count */}
          <p className="text-sm text-muted-foreground">
            Agent: {conversation.agent_name ?? conversation.agent_id}
            <Separator
              orientation="vertical"
              className="mx-2 inline-flex h-3 align-middle"
            />
            模型: {conversation.model_name}
            <Separator
              orientation="vertical"
              className="mx-2 inline-flex h-3 align-middle"
            />
            {conversation.message_count} 条消息
          </p>
        </div>
      </div>

      {/* Message list – scrollable area with constrained width */}
      <ScrollArea className="h-[calc(100vh-200px)] rounded-lg border">
        <div className="max-w-3xl mx-auto space-y-4 p-6">
          {messages.length === 0 ? (
            /* Edge case: conversation exists but has zero messages */
            <div className="text-center py-16 text-muted-foreground text-sm">
              暂无消息
            </div>
          ) : (
            messages.map((msg) => (
              <Fragment key={msg.id}>
                <MessageBubble message={msg} />
              </Fragment>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
