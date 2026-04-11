import Skeleton from './Skeleton'

/**
 * Loading placeholder that mimics the sidebar conversation list
 * with 6 skeleton bars of varying widths.
 */
export default function SidebarSkeleton() {
  const widths = ['85%', '70%', '90%', '60%', '80%', '55%']

  return (
    <div className="flex flex-col gap-1 px-2">
      {widths.map((w, i) => (
        <div key={i} className="px-3 py-2">
          <Skeleton width={w} height="0.875rem" rounded="0.5rem" />
        </div>
      ))}
    </div>
  )
}
