// A box for a headline or words on the video where Enter starts a new line
// (his ask, 2026-11-18: "whenever we enter the headline ourselves ... we can
// press Enter on it so we can do our line breaks ourselves"). The headline is
// drawn with his own line breaks kept (overlay.wrapText), and a line too wide
// still wraps by itself. It grows a line at a time as he types.

import type { FocusEventHandler } from 'react'

export function LinesInput({
  value,
  onChange,
  onBlur,
  maxLength,
  placeholder,
  className,
  autoFocus,
  onFocus,
  ...aria
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: FocusEventHandler<HTMLTextAreaElement>
  onFocus?: FocusEventHandler<HTMLTextAreaElement>
  maxLength?: number
  placeholder?: string
  className?: string
  autoFocus?: boolean
  'aria-label'?: string
}) {
  const lines = Math.min(6, Math.max(1, value.split('\n').length))
  return (
    <textarea
      className={`lines-input${className ? ` ${className}` : ''}`}
      rows={lines}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      autoFocus={autoFocus}
      enterKeyHint="enter"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onFocus={onFocus}
      {...aria}
    />
  )
}
