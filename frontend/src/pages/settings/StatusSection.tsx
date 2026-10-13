import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, Database, ServerCog, ShieldCheck, Wrench, XCircle } from 'lucide-react'
import { systemApi } from '@/lib/api'
import { Btn } from '@/components/ui/Form'
import { SurfaceCard } from '@/components/ui/Page'
import { Badge } from '@/components/ui/Badge'
import type { DiagnosticItem } from '@/types'
import { Section } from './shared'

// Status: read-only information, deployment diagnostics and advice — not part of the save flow.
// Layout is one level of cards: the three items on top are their own cards, diagnostics use a divided list inside the section — no cards inside cards.
export default function StatusSection() {
  const { data: info } = useQuery({
    queryKey: ['system-info'],
    queryFn: () => systemApi.getInfo().then((r) => r.data.data!),
  })
  const { data: diagnostics, refetch, isFetching } = useQuery({
    queryKey: ['system-diagnostics'],
    queryFn: () => systemApi.getDiagnostics().then((r) => r.data.data!),
  })

  const summary = diagnostics?.summary

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard icon={<ServerCog className="h-4 w-4" />} label="Service port" value={String(info?.server.port ?? '—')} />
        <InfoCard icon={<ShieldCheck className="h-4 w-4" />} label="Run mode" value={String(info?.server.mode ?? '—')} />
        <InfoCard icon={<Database className="h-4 w-4" />} label="Database" value={String(info?.database.driver ?? '—')} />
      </div>

      <Section
        title="Deployment diagnostics"
        description="Verify that the service path, database directory, default SSH path and subscription base URL are all ready."
        actions={
          <Btn variant="secondary" loading={isFetching} onClick={() => void refetch()}>Re-run diagnostics</Btn>
        }
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <SummaryStat icon={<CheckCircle2 className="h-4 w-4 text-[var(--success)]" />} label="Normal" value={summary?.ok ?? 0} />
          <SummaryStat icon={<CircleAlert className="h-4 w-4 text-[var(--warning)]" />} label="Warning" value={summary?.warning ?? 0} />
          <SummaryStat icon={<XCircle className="h-4 w-4 text-[var(--danger)]" />} label="Error" value={summary?.error ?? 0} />
        </div>
        <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {diagnostics?.items.map((item) => <DiagnosticRow key={item.key} item={item} />)}
        </ul>
      </Section>

      <SurfaceCard className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Wrench className="h-4 w-4 text-[var(--accent)]" />Deployment advice</div>
        <div className="mt-4 space-y-3 text-sm leading-6 text-soft">
          <p>For a systemd deployment use `/etc/xray-pilot/ssh/id_ed25519` as the default key path, and set a public HTTPS domain as the subscription base URL under Settings → Subscription and notifications.</p>
          <p>Keep `known_hosts` at `/var/lib/xray-pilot/known_hosts` so its permissions line up with the service user.</p>
          <p>If settings do not behave as expected after saving, check the diagnostics above first, then work through the activity log.</p>
        </div>
      </SurfaceCard>
    </>
  )
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <SurfaceCard className="p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
        <span className="text-[var(--accent)]">{icon}</span>
        {label}
      </div>
      <div className="mt-2 font-mono text-sm">{value}</div>
    </SurfaceCard>
  )
}

function SummaryStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-soft">
      {icon}
      {label}
      <span className="font-semibold text-[var(--text)]">{value}</span>
    </span>
  )
}

function DiagnosticRow({ item }: { item: DiagnosticItem }) {
  const icon = item.status === 'ok'
    ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
    : item.status === 'warning'
      ? <CircleAlert className="h-4 w-4 text-[var(--warning)]" />
      : <XCircle className="h-4 w-4 text-[var(--danger)]" />
  const badgeVariant = item.status === 'ok' ? 'green' : item.status === 'warning' ? 'yellow' : 'red'
  const badgeLabel = item.status === 'ok' ? 'Normal' : item.status === 'warning' ? 'Warning' : 'Error'

  return (
    <li className="flex flex-col gap-2 py-4 md:flex-row md:items-start md:justify-between md:gap-4">
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          {icon}
          <div className="text-sm font-semibold">{item.label}</div>
        </div>
        {item.value && <div className="break-all font-mono text-xs text-soft">{item.value}</div>}
        <p className="text-sm leading-6 text-soft">{item.detail}</p>
        {item.suggestion && <p className="text-xs leading-5 text-faint">Advice: {item.suggestion}</p>}
      </div>
      <Badge label={badgeLabel} variant={badgeVariant} />
    </li>
  )
}
