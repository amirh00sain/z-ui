import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'

// How page-level help is collapsed: an info icon that shows the full text on hover.
// Replaces a full paragraph of hint text under the toolbar, which would eat the first screen and look dense.
export function HintTip({ content, side = 'bottom' }: { content: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip content={content} side={side} className="max-w-[360px]">
      <button
        type="button"
        aria-label="Details"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--warning)] transition hover:bg-[var(--warning-soft)]"
      >
        <Info className="h-4 w-4" />
      </button>
    </Tooltip>
  )
}
