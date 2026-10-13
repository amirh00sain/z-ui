import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Link2, RefreshCcw, Server, Users } from 'lucide-react'
import { logApi, nodeApi, profileApi, trafficApi, userApi } from '@/lib/api'
import type { InboundProfile, Node, NodeKey, SyncLog } from '@/types'
import { Btn } from '@/components/ui/Form'
import { Badge } from '@/components/ui/Badge'
import { PageShell, SurfaceCard } from '@/components/ui/Page'
import { formatBytes } from '@/lib/utils'

function StatCard({
  title,
  value,
  change,
  changeTone = 'positive',
  icon: Icon,
}: {
  title: string
  value: string | number
  change?: string
  changeTone?: 'positive' | 'negative' | 'neutral'
  icon: typeof Server
}) {
  return (
    <SurfaceCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-soft">{title}</div>
          <div className="mt-3 text-4xl font-semibold tracking-[-0.05em]">{value}</div>
          {change && (
            <div
              className={`mt-3 text-sm ${
                changeTone === 'negative' ? 'text-[var(--danger)]' : 'text-soft'
              }`}
            >
              {change}
            </div>
          )}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </SurfaceCard>
  )
}

function logIcon(log: SyncLog) {
  if (log.success) return <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]"><Activity className="h-4 w-4" /></div>
  return <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]"><AlertTriangle className="h-4 w-4" /></div>
}

function syncBadge(node: Node) {
  switch (node.sync_status) {
    case 'synced':
      return <Badge label="Synced" variant="green" />
    case 'failed':
      return <Badge label="Sync failed" variant="red" />
    case 'drifted':
    case 'pending':
    default:
      return <Badge label="Pending" variant="yellow" />
  }
}

function NodeHealthRow({ node }: { node: Node }) {
  const ok = node.last_check_ok
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`} />
          <span className="text-sm font-medium">{node.name}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-soft">
          <span>{node.online_user_count} online</span>
          <span className="text-faint">|</span>
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${node.xray_version ? 'bg-[var(--success)]' : 'bg-[var(--border-strong)]'}`} />
            <span>{node.xray_version ? `Xray ${node.xray_version}` : 'Xray —'}</span>
          </span>
        </div>
      </div>
      <div className="flex min-w-[74px] flex-col items-end gap-2">
        <span className="font-mono text-xs text-soft">{ok && node.last_latency_ms ? `${node.last_latency_ms}ms` : '—'}</span>
        <div className="scale-[0.9] origin-right">
          {syncBadge(node)}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const usersQuery = useQuery({
    queryKey: ['dashboard-users'],
    queryFn: () => userApi.list({ page: 1, page_size: 200 }).then((r) => r.data.data!),
  })

  const nodesQuery = useQuery({
    queryKey: ['dashboard-nodes'],
    queryFn: () => nodeApi.list({ page: 1, page_size: 200 }).then((r) => r.data.data!),
  })
  const { data: profilesData } = useQuery({
    queryKey: ['dashboard-profiles-all'],
    queryFn: () => profileApi.list({ page: 1, page_size: 100 }).then((r) => r.data.data!),
  })
  const { data: nodeKeysByNodeId = {} } = useQuery({
    queryKey: ['dashboard-node-keys', nodesQuery.data?.list?.map((node) => node.id).join(',') ?? ''],
    queryFn: async () => {
      const nodes = nodesQuery.data?.list ?? []
      const entries = await Promise.all(
        nodes.map(async (node) => {
          const res = await nodeApi.getKeys(node.id)
          return [node.id, res.data.data ?? []] as const
        }),
      )
      return Object.fromEntries(entries) as Record<number, NodeKey[]>
    },
    enabled: (nodesQuery.data?.list?.length ?? 0) > 0,
  })

  const logsQuery = useQuery({
    queryKey: ['dashboard-logs'],
    queryFn: () => logApi.list({ page: 1, page_size: 6 }).then((r) => r.data.data!),
  })

  const trafficQuery = useQuery({
    queryKey: ['dashboard-traffic'],
    queryFn: () => trafficApi.summary().then((r) => r.data.data!),
    refetchInterval: 60_000, // refresh every minute; the server polls every 5 minutes
  })

  const users = usersQuery.data?.list ?? []
  const nodes = nodesQuery.data?.list ?? []
  const logs = logsQuery.data?.list ?? []
  const activeProfiles = (profilesData?.list ?? []).filter((profile: InboundProfile) => profile.active)
  const activeProfileIDs = new Set(activeProfiles.map((profile) => profile.id))
  const serviceReadyNodes = useMemo(
    () => nodes.filter((node) => (nodeKeysByNodeId[node.id] ?? []).some((key) => activeProfileIDs.has(key.profile_id))),
    [nodes, nodeKeysByNodeId, activeProfileIDs],
  )
  const sortedServiceReadyNodes = useMemo(
    () => [...serviceReadyNodes].sort((a, b) => a.name.localeCompare(b.name, 'en-US', { numeric: true, sensitivity: 'base' })),
    [serviceReadyNodes],
  )

  const activeUsers = useMemo(() => users.filter((u) => u.active).length, [users])
  const healthyNodes = useMemo(() => serviceReadyNodes.filter((n) => n.last_check_ok).length, [serviceReadyNodes])
  const nodeLinks = useMemo(() => users.filter((u) => !!u.subscribe_url).length, [users])
  const unhealthyNodes = useMemo(() => serviceReadyNodes.filter((n) => n.last_check_at && !n.last_check_ok), [serviceReadyNodes])

  return (
    <PageShell className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total nodes" value={nodes.length} change={serviceReadyNodes.length ? `${healthyNodes}/${serviceReadyNodes.length} healthy` : 'No nodes available'} icon={Server} />
        <StatCard title="Active users" value={activeUsers} change={users.length ? `${users.length} users total` : 'No users yet'} icon={Users} />
        <StatCard title="Subscription links" value={nodeLinks} change={nodeLinks ? 'Subscription links generated' : 'No subscriptions yet'} icon={Link2} />
        <StatCard
          title="Healthy nodes"
          value={serviceReadyNodes.length ? `${healthyNodes}/${serviceReadyNodes.length}` : 0}
          change={unhealthyNodes.length ? `${unhealthyNodes.length} nodes unhealthy` : 'All checked nodes are healthy'}
          changeTone={unhealthyNodes.length ? 'negative' : 'positive'}
          icon={Activity}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Total upload"
          value={formatBytes(trafficQuery.data?.total_up_bytes)}
          change={trafficQuery.data?.last_updated_at ? `Updated ${new Date(trafficQuery.data.last_updated_at).toLocaleString()}` : 'Awaiting first sample'}
          changeTone="neutral"
          icon={ArrowUpFromLine}
        />
        <StatCard
          title="Total download"
          value={formatBytes(trafficQuery.data?.total_down_bytes)}
          change={trafficQuery.data?.last_updated_at ? `Updated ${new Date(trafficQuery.data.last_updated_at).toLocaleString()}` : 'Awaiting first sample'}
          changeTone="neutral"
          icon={ArrowDownToLine}
        />
        <StatCard
          title="Active users, last 7 days"
          value={trafficQuery.data?.active_users_7d ?? 0}
          change={trafficQuery.data?.active_users_7d ? 'Counts any user with traffic' : 'Awaiting first sample'}
          changeTone="neutral"
          icon={Users}
        />
      </div>

      <div className="grid gap-4 xl:min-h-[calc(100vh-24rem)] xl:grid-cols-3">
        <SurfaceCard className="flex h-full min-h-[360px] flex-col overflow-hidden xl:col-span-2">
          <div className="flex h-14 items-center justify-between border-b border-[var(--border)] px-5">
            <h3 className="text-lg font-semibold">Recent activity</h3>
            <a href="/logs" className="text-sm text-[var(--accent)] transition hover:opacity-80">View all</a>
          </div>
          <div className="flex-1 overflow-auto">
            {logs.length === 0 ? (
              <div className="px-5 py-10 text-sm text-soft">No log entries yet</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 last:border-b-0">
                  <div className="min-w-0 flex items-start gap-3">
                    {logIcon(log)}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{log.action}</div>
                      <div className="mt-1 text-sm text-soft">{log.message || log.target || 'System event'}</div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs text-faint">{new Date(log.created_at).toLocaleString('en-US')}</div>
                    <div className="mt-1 text-xs text-faint">{log.target || 'System event'}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard className="flex h-full min-h-[360px] flex-col overflow-hidden">
          <div className="flex h-14 items-center justify-between border-b border-[var(--border)] px-5">
            <h3 className="text-lg font-semibold">Node health</h3>
            <Btn variant="ghost" onClick={() => void nodesQuery.refetch()}>
              <RefreshCcw className="h-4 w-4" />Refresh</Btn>
          </div>
          <div className="flex-1 overflow-auto">
            {sortedServiceReadyNodes.length === 0 ? (
              <div className="px-5 py-10 text-sm text-soft">No node data yet</div>
            ) : (
              sortedServiceReadyNodes.map((node) => <NodeHealthRow key={node.id} node={node} />)
            )}
          </div>
        </SurfaceCard>
      </div>
    </PageShell>
  )
}
