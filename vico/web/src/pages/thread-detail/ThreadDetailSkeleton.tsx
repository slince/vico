import { Skeleton } from '@/components/ui/skeleton';

/**
 * Renders a skeleton placeholder for the thread detail page.
 *
 * Mimics the structure of the loaded page: a header bar and a list of message
 * bubble skeletons of varying widths to suggest different message lengths.
 */
export function ThreadDetailSkeleton() {
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
