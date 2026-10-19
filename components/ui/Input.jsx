import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/** Shared look for every text-like control. Use on native <input>/<select>/<textarea> when you can't use the components. */
export const inputClass = cn(
  'flex h-9 w-full min-w-0 rounded-lg border border-input bg-white px-3 py-1 text-sm text-gray-900 shadow-xs',
  'transition-[color,box-shadow,border-color] outline-none placeholder:text-gray-400',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus:border-ring focus:ring-[3px] focus:ring-ring/30',
  'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60',
  'aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-500/15',
  'file:border-0 file:bg-transparent file:text-sm file:font-medium'
)

export const textareaClass = cn(inputClass, 'h-auto min-h-[80px] py-2 leading-relaxed')

/** Native <select>: keeps the forms-plugin chevron, so leave room on the right. */
export const selectClass = cn(inputClass, 'pr-9 cursor-pointer bg-[length:1.1em] bg-[right_0.6rem_center]')

export const Input = forwardRef(function Input({ className, invalid, ...props }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputClass, className)} {...props} />
})

export const Textarea = forwardRef(function Textarea({ className, invalid, ...props }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(textareaClass, className)} {...props} />
})

/** Styled native <select>. For the Radix dropdown use components/ui/Select. */
export const NativeSelect = forwardRef(function NativeSelect({ className, invalid, children, ...props }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={cn(selectClass, className)} {...props}>
      {children}
    </select>
  )
})

export function Label({ className, required, children, ...props }) {
  return (
    <label className={cn('mb-2 block text-sm font-medium leading-none text-gray-900', className)} {...props}>
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  )
}

/** Label + control + one line of hint or error. */
export function Field({ label, htmlFor, required, hint, error, className, children }) {
  return (
    <div className={className}>
      {label && <Label htmlFor={htmlFor} required={required}>{label}</Label>}
      {children}
      {error
        ? <p className="mt-1.5 text-xs text-red-600">{error}</p>
        : hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export default Input
