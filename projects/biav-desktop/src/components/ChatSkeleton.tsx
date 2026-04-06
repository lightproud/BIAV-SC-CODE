import Skeleton from './Skeleton'

/**
 * Loading placeholder that mimics the ChatMessage layout
 * with 4 alternating user/assistant message bubbles.
 */
export default function ChatSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-4">
      {/* Assistant message */}
      <div className="flex gap-3">
        <Skeleton width="1.75rem" height="1.75rem" rounded="9999px" />
        <div className="flex flex-col gap-2 flex-1 max-w-[70%]">
          <Skeleton width="90%" height="0.875rem" />
          <Skeleton width="75%" height="0.875rem" />
          <Skeleton width="40%" height="0.875rem" />
        </div>
      </div>

      {/* User message */}
      <div className="flex justify-end">
        <div className="max-w-[60%]">
          <Skeleton width="100%" height="2.5rem" rounded="1rem" />
        </div>
      </div>

      {/* Assistant message */}
      <div className="flex gap-3">
        <Skeleton width="1.75rem" height="1.75rem" rounded="9999px" />
        <div className="flex flex-col gap-2 flex-1 max-w-[70%]">
          <Skeleton width="85%" height="0.875rem" />
          <Skeleton width="95%" height="0.875rem" />
          <Skeleton width="60%" height="0.875rem" />
          <Skeleton width="30%" height="0.875rem" />
        </div>
      </div>

      {/* User message */}
      <div className="flex justify-end">
        <div className="max-w-[60%]">
          <Skeleton width="100%" height="2.5rem" rounded="1rem" />
        </div>
      </div>
    </div>
  )
}
