export default function ProgressBar({ value = 0, max = 100, color = 'blue', size = 'md', showLabel = true }) {
  const percentage = Math.min(Math.round((value / max) * 100), 100)

  const colors = {
    blue:   'bg-blue-500',
    green:  'bg-green-500',
    yellow: 'bg-yellow-500',
    red:    'bg-red-500',
    purple: 'bg-purple-500',
    indigo: 'bg-indigo-500',
  }

  const sizes = {
    sm:  'h-1.5',
    md:  'h-2.5',
    lg:  'h-4',
  }

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-gray-500">Progress</span>
          <span className="text-xs font-semibold text-gray-700">{percentage}%</span>
        </div>
      )}
      <div className={`w-full bg-gray-100 rounded-full overflow-hidden ${sizes[size] || sizes.md}`}>
        <div
          className={`${colors[color] || colors.blue} ${sizes[size] || sizes.md} rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
