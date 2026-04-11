interface Props {
  width?: string
  height?: string
  rounded?: string
  className?: string
}

export default function Skeleton({
  width = '100%',
  height = '1rem',
  rounded = '0.375rem',
  className = '',
}: Props) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius: rounded }}
    />
  )
}
