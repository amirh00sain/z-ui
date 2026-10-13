import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { nodeApi } from '@/lib/api'
import { pushToast } from '@/lib/notify'
import type { SyncSummary } from '@/types'
import { cn } from '@/lib/utils'

function buildSummaryText(summary: SyncSummary) {
  const parts: string[] = []
  if (summary.drifted_count > 0) parts.push(`${summary.drifted_count} drifted`)
  if (summary.failed_count > 0) parts.push(`${summary.failed_count} failed`)
  if (summary.pending_count > 0) parts.push(`${summary.pending_count} pending`)
  return parts.join('，')
}

// Header "pending sync" pill: always present but out of the content area; click to expand details and quick actions.
// Pending sync is a continuous state rather than a one-off event, so neither a disappearing toast nor a content-pushing banner fits.
export function SyncStatusPill({ summary, compact }: { summary: SyncSummary; compact?: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const syncMutation = useMutation({
    mutationFn: () => nodeApi.syncDrifted(),
    onSuccess: (res) => {
      const payload = res.data.data
      pushToast({
        title: 'Pending nodes started syncing',
        description: payload
          ? `${payload.total} nodes total, ${payload.success} succeeded, ${payload.failed} failed.`
          : 'Node sync finished.',
        variant: payload?.failed ? 'warning' : 'success',
      })
      qc.invalidateQueries({ queryKey: ['sync-summary'] })
      qc.invalidateQueries({ queryKey: ['nodes'] })
      qc.invalidateQueries({ queryKey: ['recent-logs'] })
      qc.invalidateQueries({ queryKey: ['nodes-stats'] })
    },
  })

  if (!summary.needs_sync) return null

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title="Nodes pending sync"
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--warning-border)] bg-[var(--warning-soft)] text-xs font-semibold text-[var(--warning)] transition hover:brightness-110',
            compact ? 'px-2' : 'px-2.5'
          )}
        >
          <AlertTriangle className="h-4 w-4" />
          {compact ? summary.total_affected : `${summary.total_affected} pending`}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] p-3 shadow-[var(--shadow-card)]"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--warning-soft)] text-[var(--warning)]">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-semibold">Config changed — some nodes need to resync</div>
              <p className="text-xs leading-5 text-soft">
                {summary.total_affected} nodes pending.
                {buildSummaryText(summary) && <span> Currently includes {buildSummaryText(summary)}.</span>}
              </p>
            </div>
          </div>
          <DropdownMenu.Separator className="my-3 h-px bg-[var(--border)]" />
          <div className="flex items-center justify-end gap-2">
            <DropdownMenu.Item
              onSelect={() => navigate('/nodes')}
              className="inline-flex h-9 cursor-pointer select-none items-center gap-1 rounded-md px-3 text-sm text-soft outline-none transition hover:bg-[var(--panel-muted)] hover:text-[var(--text)]"
            >Go to nodes<ArrowRight className="h-4 w-4" />
            </DropdownMenu.Item>
            <DropdownMenu.Item
              disabled={syncMutation.isPending}
              onSelect={() => syncMutation.mutate()}
              className="inline-flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-md border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 text-sm font-medium text-[var(--warning)] outline-none transition hover:brightness-110 data-[disabled]:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', syncMutation.isPending && 'animate-spin')} />Sync all</DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
