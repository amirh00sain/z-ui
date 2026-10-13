import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Clock3, RefreshCcw, Trash2 } from 'lucide-react'
import { logApi } from '@/lib/api'
import type { SyncLog } from '@/types'
import { Table, Pagination } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Btn } from '@/components/ui/Form'
import { PageShell, SurfaceCard } from '@/components/ui/Page'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { pushToast } from '@/lib/notify'

const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const CLEANUP_PRESETS = [1, 3, 7, 30, 90, 180]
// Actor prefix filter, matching the actor format used by the backend entity.SyncLog
const ACTOR_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'admin:', label: 'Admin actions' },
  { value: 'system:scheduler:', label: 'Background scheduler' },
  { value: 'system:install-token:', label: 'Node provisioning' },
  { value: 'system:feishu-webhook', label: 'Feishu callback' },
]

export default function Logs() {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [cleanupMode, setCleanupMode] = useState<string>('7')
  const [cleanupDays, setCleanupDays] = useState('7')
  const [actorFilter, setActorFilter] = useState('')

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['logs', page, pageSize, actorFilter],
    queryFn: () => logApi.list({ page, page_size: pageSize, actor: actorFilter || undefined }).then((r) => r.data.data!),
    refetchInterval: 10_000,
  })

  const cleanup = useMutation({
    mutationFn: (days: number) => logApi.cleanup(days),
    onSuccess: (res, days) => {
      const summary = res.data.data
      pushToast({
        title: 'Log cleanup finished',
        description: `Removed ${summary?.deleted ?? 0} log entries older than ${days} days.`,
        variant: 'success',
      })
      void qc.invalidateQueries({ queryKey: ['logs'] })
      void refetch()
    },
  })

  const effectiveCleanupDays = cleanupMode === 'custom' ? Number(cleanupDays) : Number(cleanupMode)

  const handleCleanup = async () => {
    if (!Number.isFinite(effectiveCleanupDays) || effectiveCleanupDays < 1 || effectiveCleanupDays > 3650) {
      pushToast({
        title: 'Invalid cleanup range',
        description: 'Enter a number between 1 and 3650.',
        variant: 'warning',
      })
      return
    }

    const ok = await confirm({
      title: `Delete logs older than ${effectiveCleanupDays} days?`,
      description: 'This only deletes historical activity logs. Nodes, users and protocol configs are untouched.',
      confirmText: 'Confirm cleanup',
      cancelText: 'Cancel',
      tone: 'danger',
    })
    if (!ok) return
    cleanup.mutate(effectiveCleanupDays)
  }

  const columns = [
    {
      key: 'created_at',
      label: 'Time',
      render: (l: SyncLog) => <span className="whitespace-nowrap font-mono text-xs tabular-nums text-soft">{new Date(l.created_at).toLocaleString('en-US')}</span>,
    },
    { key: 'action', label: 'Actions', render: (l: SyncLog) => <span className="font-mono text-xs">{l.action}</span> },
    { key: 'actor', label: 'Source', render: (l: SyncLog) => <ActorCell actor={l.actor} /> },
    { key: 'target', label: 'Target', render: (l: SyncLog) => <span className="text-xs text-soft">{l.target}</span> },
    { key: 'success', label: 'Result', render: (l: SyncLog) => <Badge label={l.success ? 'Success' : classifyFailureReason(l.message)} variant={l.success ? 'green' : 'red'} /> },
    { key: 'duration_ms', label: 'Duration', render: (l: SyncLog) => <span className="text-xs text-soft">{l.duration_ms ? `${l.duration_ms}ms` : '—'}</span> },
    {
      key: 'message',
      label: 'Message',
      render: (l: SyncLog) => (
        <div className="min-w-[24rem] max-w-xl space-y-1 text-xs">
          {!l.success && <span className="font-medium text-[var(--text)]">{classifyFailureReason(l.message)}</span>}
          <span className="block whitespace-normal break-all text-soft">{l.message || '—'}</span>
        </div>
      ),
    },
  ]

  return (
    <PageShell>
      <div className="flex flex-wrap items-center gap-2">
        {ACTOR_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              setActorFilter(f.value)
              setPage(1)
            }}
            className={
              actorFilter === f.value
                ? 'inline-flex h-8 items-center rounded-md bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)]'
                : 'inline-flex h-8 items-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-xs font-medium text-soft transition hover:text-[var(--text)]'
            }
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <Table columns={columns} data={data?.list ?? []} loading={isLoading} />
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <label className="inline-flex items-center gap-2 text-sm text-soft">Pagination<select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(1)
                }}
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
            </label>
            <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onChange={setPage} />
          </div>
        </div>

        <SurfaceCard className="p-5 xl:sticky xl:top-0 xl:self-start">
          <div className="space-y-4">
            <div className="border-t border-[var(--border)] pt-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Activity className="h-4 w-4 text-[var(--accent)]" />What to watch</div>
              <p className="mt-2 text-sm leading-6 text-soft">Start with failures, unusually long durations, and node or action names that keep reappearing — they usually point at the deployment problem fastest.</p>
            </div>
            <div className="border-t border-[var(--border)] pt-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Clock3 className="h-4 w-4 text-[var(--accent)]" />Auto refresh</div>
              <p className="mt-2 text-sm leading-6 text-soft">The page pulls fresh logs every 10 seconds, which is handy while syncing nodes, testing SSH or debugging subscriptions.</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-2.5 py-1 text-xs font-medium text-soft">Refresh: 10s</div>
                <Btn variant="secondary" loading={isFetching} onClick={() => void refetch()}>
                  <RefreshCcw className="h-4 w-4" />Refresh now</Btn>
              </div>
            </div>
            <div className="border-t border-[var(--border)] pt-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Trash2 className="h-4 w-4 text-[var(--accent)]" />Clean up logs</div>
              <p className="mt-2 text-sm leading-6 text-soft">Keep the last 7 to 30 days of logs for troubleshooting, and clear older history regularly so the log table does not keep growing.</p>
              <div className="mt-3 space-y-3">
                <select
                  value={cleanupMode}
                  onChange={(e) => {
                    setCleanupMode(e.target.value)
                    if (e.target.value !== 'custom') setCleanupDays(e.target.value)
                  }}
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                >
                  {CLEANUP_PRESETS.map((days) => (
                    <option key={days} value={String(days)}>Delete logs older than {days} days</option>
                  ))}
                  <option value="custom">Custom range</option>
                </select>
                {cleanupMode === 'custom' && (
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={cleanupDays}
                    onChange={(e) => setCleanupDays(e.target.value)}
                    placeholder="Enter 1 - 3650"
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                )}
                <Btn variant="secondary" loading={cleanup.isPending} onClick={() => void handleCleanup()}>
                  <Trash2 className="h-4 w-4" />Delete historical logs</Btn>
              </div>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </PageShell>
  )
}

// ActorCell renders an actor string as a type badge plus the subject; empty means a record from before v0.5.0
function ActorCell({ actor }: { actor: string }) {
  if (!actor) return <span className="text-xs text-faint">—</span>
  if (actor.startsWith('admin:')) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <Badge label="Admin" variant="blue" />
        <span className="font-mono">{actor.slice('admin:'.length)}</span>
      </span>
    )
  }
  if (actor.startsWith('system:scheduler:')) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <Badge label="Scheduler" variant="gray" />
        <span className="font-mono text-soft">{actor.slice('system:scheduler:'.length)}</span>
      </span>
    )
  }
  if (actor.startsWith('system:install-token:')) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <Badge label="Provision" variant="gray" />
        <span className="font-mono text-soft">{actor.slice('system:install-token:'.length)}</span>
      </span>
    )
  }
  if (actor === 'system:feishu-webhook') {
    return <Badge label="Feishu" variant="gray" />
  }
  return <span className="font-mono text-xs text-soft">{actor}</span>
}

function classifyFailureReason(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('ssh')) return 'SSH failed'
  if (normalized.includes('timeout')) return 'Timeout'
  if (normalized.includes('config') || normalized.includes('private_key') || normalized.includes('profile') || normalized.includes('parse')) return 'Config error'
  if (normalized.includes('drift')) return 'Config drift'
  return 'Failed'
}
