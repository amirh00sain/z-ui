import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Copy, FileCode, Filter, Lock, PencilLine, Plus, RefreshCw, Search, Sparkles, Terminal, Wifi } from 'lucide-react'
import { OneClickInstallDialog } from '@/components/OneClickInstallDialog'
import { nodeApi, profileApi } from '@/lib/api'
import { generateShortIds } from '@/lib/keygen'
import { copyText } from '@/lib/clipboard'
import { protocolBadgeVariant, protocolLabel } from '@/lib/protocol'
import type { InboundProfile, Node, NodeKey, SyncStatus } from '@/types'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Field, Btn, FieldGroup, SelectField, Switch } from '@/components/ui/Form'
import { HintTip } from '@/components/ui/HintTip'
import { PageShell, SurfaceCard } from '@/components/ui/Page'
import { Drawer } from '@/components/ui/Drawer'
import { ActionMenu } from '@/components/ui/ActionMenu'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { Tooltip } from '@/components/ui/Tooltip'
import { pushToast } from '@/lib/notify'

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// Node-level log level options; blank means inherit the system setting (xray.log_level in Settings)
const NODE_LOG_LEVEL_OPTIONS = [
  { value: '', label: 'Inherit system settings' },
  { value: 'debug', label: 'debug (verbose, troubleshooting)' },
  { value: 'info', label: 'info' },
  { value: 'warning', label: 'warning' },
  { value: 'error', label: 'error' },
  { value: 'none', label: 'none (disabled)' },
]

const statusMeta: Record<SyncStatus, { label: string; variant: 'green' | 'yellow' | 'red' | 'gray'; tip: string }> = {
  synced: { label: 'Synced', variant: 'green', tip: 'Config is already up to date' },
  drifted: { label: 'Pending', variant: 'yellow', tip: 'Config changed or the remote copy differs — resync recommended' },
  failed: { label: 'Sync failed', variant: 'red', tip: 'Sync failed — test SSH connectivity first' },
  pending: { label: 'Pending', variant: 'gray', tip: 'Node has not synced yet — press the sync button' },
}

const unconfiguredStatusMeta = {
  label: 'No protocol configured',
  variant: 'gray' as const,
  tip: 'This node has no protocol bound, so no usable proxy config can be generated. Bind at least one protocol first.',
}

interface FormState {
  name: string
  region: string
  owner: string
  ip: string
  domain: string
  ssh_port: string
  ssh_user: string
  ssh_key_path: string
  log_level: string
  remark: string
}

const emptyForm = (): FormState => ({
  name: '',
  region: '',
  owner: '',
  ip: '',
  domain: '',
  ssh_port: '22',
  ssh_user: 'root',
  ssh_key_path: '',
  log_level: '',
  remark: '',
})


export default function Nodes() {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [drawer, setDrawer] = useState<{ open: boolean; node?: Node }>({ open: false })
  const [form, setForm] = useState<FormState>(emptyForm())
  const [initialForm, setInitialForm] = useState<FormState>(emptyForm())
  const [err, setErr] = useState('')
  const [previewNode, setPreviewNode] = useState<Node | null>(null)
  const [protocolNode, setProtocolNode] = useState<Node | null>(null)
  const [search, setSearch] = useState('')
  // Debounced search term — filtering is a server query across all pages, so typing does not fire a request per keystroke
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'synced' | 'drifted' | 'failed' | 'pending'>('all')
  const [healthFilter, setHealthFilter] = useState<'all' | 'healthy' | 'unhealthy' | 'unchecked'>('all')
  const [regionFilter, setRegionFilter] = useState<string>('all')
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [installOpen, setInstallOpen] = useState(false)
  // Target node for replace-server; when set the provisioning dialog opens in replace mode
  const [replaceNode, setReplaceNode] = useState<Node | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Return to page 1 when filters change, otherwise you can be stranded on an empty page beyond the result set
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter, healthFilter, regionFilter, ownerFilter])

  const { data, isLoading } = useQuery({
    queryKey: ['nodes', page, pageSize, debouncedSearch, statusFilter, healthFilter, regionFilter, ownerFilter],
    queryFn: () =>
      nodeApi
        .list({
          page,
          page_size: pageSize,
          keyword: debouncedSearch || undefined,
          sync_status: statusFilter === 'all' ? undefined : statusFilter,
          health: healthFilter === 'all' ? undefined : healthFilter,
          region: regionFilter === 'all' ? undefined : regionFilter,
          owner: ownerFilter === 'all' ? undefined : ownerFilter,
        })
        .then((r) => r.data.data!),
  })
  const { data: profilesData } = useQuery({
    queryKey: ['profiles-for-nodes'],
    queryFn: () => profileApi.list({ page: 1, page_size: 100 }).then((r) => r.data.data!),
  })
  const { data: nodeKeysByNodeId = {} } = useQuery({
    queryKey: ['node-keys-for-list', data?.list?.map((node) => node.id).join(',') ?? ''],
    queryFn: async () => {
      const nodes = data?.list ?? []
      const entries = await Promise.all(
        nodes.map(async (node) => {
          const res = await nodeApi.getKeys(node.id)
          return [node.id, res.data.data ?? []] as const
        }),
      )
      return Object.fromEntries(entries) as Record<number, NodeKey[]>
    },
    enabled: (data?.list?.length ?? 0) > 0,
  })

  // Dropdown options come from a dedicated endpoint (full set) and are never derived from the current page, otherwise paging leaves gaps
  const { data: filterOptions } = useQuery({
    queryKey: ['node-filter-options'],
    queryFn: () => nodeApi.filterOptions().then((r) => r.data.data!),
  })
  const regions = filterOptions?.regions ?? []
  const owners = filterOptions?.owners ?? []

  const invalidate = () => qc.invalidateQueries({ queryKey: ['nodes'] })

  const save = useMutation({
    mutationFn: () => {
      // Trim every text field: a space in a domain or IP produces a broken subscription URL,
      // and clients cannot connect to that node after a subscription update (this bit us in production with " tw03.xxx")
      const payload = {
        name: form.name.trim(),
        region: form.region.trim(),
        owner: form.owner.trim(),
        ip: form.ip.trim(),
        domain: form.domain.trim(),
        ssh_user: form.ssh_user.trim(),
        ssh_key_path: form.ssh_key_path.trim(),
        log_level: form.log_level,
        remark: form.remark.trim(),
        ssh_port: Number(form.ssh_port) || 22,
      }
      return drawer.node ? nodeApi.update(drawer.node.id, payload) : nodeApi.create(payload)
    },
    onSuccess: () => {
      invalidate()
      closeDrawer()
    },
    onError: (e: Error) => setErr(e.message),
  })

  const toggle = useMutation({ mutationFn: (id: number) => nodeApi.toggle(id), onSuccess: invalidate })
  const remove = useMutation({
    mutationFn: (id: number) => nodeApi.remove(id),
    onSuccess: invalidate,
  })
  const sync = useMutation({
    mutationFn: (id: number) => nodeApi.sync(id),
    onSuccess: (res) => {
      pushToast({
        title: 'Node synced',
        description: res.data.data?.message ?? 'The node config was pushed to the remote host.',
        variant: 'success',
      })
      invalidate()
    },
  })
  const syncDrifted = useMutation({
    mutationFn: () => nodeApi.syncDrifted(),
    onSuccess: (res) => {
      const summary = res.data.data
      pushToast({
        title: 'Bulk sync finished',
        description: summary
          ? `${summary.total} nodes total, ${summary.success} succeeded, ${summary.failed} failed.`
          : 'Pending nodes finished syncing.',
        variant: summary?.failed ? 'warning' : 'success',
      })
      invalidate()
    },
  })
  const testSSH = useMutation({
    mutationFn: (id: number) => nodeApi.testSSH(id),
    onSuccess: (res, id) => {
      invalidate()
      const result = res.data.data
      if (result?.ok) {
        pushToast({
          title: 'SSH connection is healthy',
          description: `Node #${id} latency ${result.latency_ms}ms`,
          variant: 'success',
        })
        return
      }
      pushToast({
        title: 'SSH test failed',
        description: result?.error || 'Connection failed — check the key, port and known_hosts settings.',
        variant: 'warning',
      })
    },
    onError: (e: Error) => {
      pushToast({
        title: 'SSH test failed',
        description: e.message,
        variant: 'error',
      })
    },
  })

  const openCreate = () => {
    const next = emptyForm()
    setForm(next)
    setInitialForm(next)
    setErr('')
    setDrawer({ open: true })
  }

  const openEdit = (n: Node) => {
    const next = {
      name: n.name,
      region: n.region,
      owner: n.owner,
      ip: n.ip,
      domain: n.domain,
      ssh_port: String(n.ssh_port),
      ssh_user: n.ssh_user,
      ssh_key_path: n.ssh_key_path,
      log_level: n.log_level ?? '',
      remark: n.remark,
    }
    setForm(next)
    setInitialForm(next)
    setErr('')
    setDrawer({ open: true, node: n })
  }

  const closeDrawer = () => setDrawer({ open: false })
  const confirmCloseDrawer = async () => {
    if (!dirty) return true
    return confirm({
      title: 'Discard unsaved node changes?',
      description: 'Changes to the address and SSH parameters are unsaved and will be lost.',
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
      tone: 'danger',
    })
  }

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

  // Filtering already happened server-side; this only sorts the current page by name
  const filteredNodes = useMemo(() => {
    return [...(data?.list ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, 'en-US', { numeric: true, sensitivity: 'base' }),
    )
  }, [data?.list])

  const allVisibleSelected = filteredNodes.length > 0 && filteredNodes.every((n) => selectedIds.includes(n.id))
  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm) && drawer.open

  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))

  const toggleSelectVisible = () =>
    setSelectedIds((prev) => {
      if (allVisibleSelected) return prev.filter((id) => !filteredNodes.some((n) => n.id === id))
      return Array.from(new Set([...prev, ...filteredNodes.map((n) => n.id)]))
    })

  const selectedNodes = filteredNodes.filter((n) => selectedIds.includes(n.id))
  const activeProfiles = (profilesData?.list ?? []).filter((item) => item.active)
  const activeProfileMap = new Map(activeProfiles.map((profile) => [profile.id, profile]))

  const renderGroupCell = (groupNames?: string[]) => {
    if (!groupNames || groupNames.length === 0) return <span className="text-soft">—</span>

    const visible = groupNames.slice(0, 2)
    const hiddenCount = groupNames.length - visible.length

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map((groupName) => (
          <Badge key={groupName} label={groupName} variant="blue" />
        ))}
        {hiddenCount > 0 && (
          <Tooltip
            content={
              <div className="space-y-1">
                {groupNames.map((groupName) => (
                  <div key={groupName}>{groupName}</div>
                ))}
              </div>
            }
            className="max-w-[240px] whitespace-normal"
          >
            <span tabIndex={0} className="inline-flex">
              <Badge label={`+${hiddenCount}`} variant="gray" />
            </span>
          </Tooltip>
        )}
      </div>
    )
  }

  const getNodeKeys = (nodeId: number) => nodeKeysByNodeId[nodeId] ?? []
  const getConfiguredProfiles = (nodeId: number) =>
    getNodeKeys(nodeId)
      .map((key) => activeProfileMap.get(key.profile_id))
      .filter((item): item is InboundProfile => Boolean(item))

  const renderProtocolCell = (node: Node) => {
    const matchedProfiles = getConfiguredProfiles(node.id)

    if (matchedProfiles.length === 0) {
      return (
        <button
          type="button"
          onClick={() => setProtocolNode(node)}
          className="inline-flex h-7 items-center rounded-md border border-[var(--border)] bg-[var(--panel-muted)] px-2.5 text-xs font-medium text-soft transition hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
        >Not configured</button>
      )
    }

    const [firstProfile, ...restProfiles] = matchedProfiles

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setProtocolNode(node)}
          title="Click to manage the protocols of this node"
          className="inline-flex rounded-full transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Badge label={firstProfile.name} variant={protocolBadgeVariant(firstProfile.protocol)} />
        </button>
        {restProfiles.length > 0 && (
          <Tooltip
            side="right"
            content={
              <div className="space-y-1">
                {matchedProfiles.map((profile) => (
                  <div key={profile.id}>
                    {profile.name} <span className="text-faint">· {protocolLabel(profile.protocol)}</span>
                  </div>
                ))}
              </div>
            }
            className="max-w-[260px] whitespace-normal"
          >
            <button
              type="button"
              onClick={() => setProtocolNode(node)}
              className="inline-flex h-6 items-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-2 text-xs font-medium text-soft transition hover:bg-[var(--panel-muted)] hover:text-[var(--text)]"
            >
              +{restProfiles.length}
            </button>
          </Tooltip>
        )}
      </div>
    )
  }

  return (
    <PageShell className="space-y-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-col gap-3 md:flex-row">
          <label className="relative min-w-0 flex-1 md:max-w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search node name, address…"
              className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--panel-strong)] pl-10 pr-3 text-sm text-[var(--text)] placeholder:text-faint focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-ring)]"
            />
          </label>
          <label className="flex h-11 min-w-[130px] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-sm">
            <Filter className="h-4 w-4 text-faint" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="w-full bg-transparent text-sm outline-none"
            >
              <option value="all">All statuses</option>
              <option value="synced">Synced</option>
              <option value="drifted">Pending</option>
              <option value="failed">Sync failed</option>
              <option value="pending">Pending</option>
            </select>
          </label>
          <label className="flex h-11 min-w-[130px] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-sm">
            <Filter className="h-4 w-4 text-faint" />
            <select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value as typeof healthFilter)}
              className="w-full bg-transparent text-sm outline-none"
            >
              <option value="all">All health states</option>
              <option value="healthy">Healthy</option>
              <option value="unhealthy">Check failed</option>
              <option value="unchecked">Not checked</option>
            </select>
          </label>
          <label className="flex h-11 min-w-[130px] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-sm">
            <Filter className="h-4 w-4 text-faint" />
            <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="w-full bg-transparent text-sm outline-none">
              <option value="all">All regions</option>
              {regions.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-11 min-w-[130px] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-sm">
            <Filter className="h-4 w-4 text-faint" />
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="w-full bg-transparent text-sm outline-none">
              <option value="all">All owners</option>
              {owners.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <HintTip content="Only protocols saved under 'Configure node keys' take part in config generation; saving an empty object {} means inheriting the protocol defaults." />
          <Btn variant="secondary" loading={syncDrifted.isPending} onClick={() => syncDrifted.mutate()}>
            <RefreshCw className="h-4 w-4" />Sync pending nodes</Btn>
          <Btn variant="accent" onClick={() => setInstallOpen(true)}>
            <Terminal className="h-4 w-4" />One-click provision</Btn>
          <Btn onClick={openCreate}>
            <Plus className="h-4 w-4" />New node</Btn>
        </div>
      </div>

      {selectedNodes.length > 0 && (
        <SurfaceCard className="p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-soft">Selected<span className="font-semibold text-[var(--text)]">{selectedNodes.length}</span> nodes</div>
            <div className="flex flex-wrap gap-2">
              <Btn variant="secondary" onClick={async () => {
                await Promise.all(selectedNodes.map((n) => nodeApi.sync(n.id)))
                setSelectedIds([])
                invalidate()
              }}>Bulk sync</Btn>
              <Btn variant="secondary" onClick={async () => {
                await Promise.all(selectedNodes.map((n) => nodeApi.testSSH(n.id)))
                setSelectedIds([])
                invalidate()
              }}>Bulk SSH test</Btn>
              <Btn variant="secondary" onClick={async () => {
                await Promise.all(selectedNodes.map((n) => nodeApi.toggle(n.id)))
                setSelectedIds([])
                invalidate()
              }}>Bulk enable/disable</Btn>
              <Btn
                variant="danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete ${selectedNodes.length} selected nodes?`,
                    description: 'This cannot be undone.',
                    confirmText: 'Bulk delete',
                    cancelText: 'Cancel',
                    tone: 'danger',
                  })
                  if (!ok) return
                  // Delete serially: concurrent writes trip SQLite lock conflicts, and running one by one is the only way to tally failures
                  let success = 0
                  const failures: string[] = []
                  for (const n of selectedNodes) {
                    try {
                      await nodeApi.remove(n.id)
                      success += 1
                    } catch (e) {
                      failures.push(`${n.name}: ${(e as Error).message}`)
                    }
                  }
                  pushToast(
                    failures.length === 0
                      ? { title: `Deleted ${success} nodes`, variant: 'success' }
                      : {
                          title: `Bulk delete finished: ${success} succeeded, ${failures.length} failed`,
                          description: failures.join('；'),
                          variant: 'warning',
                        },
                  )
                  setSelectedIds([])
                  invalidate()
                }}
              >Bulk delete</Btn>
            </div>
          </div>
        </SurfaceCard>
      )}

      <SurfaceCard className="overflow-visible">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full min-w-[1480px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--panel-muted)]">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectVisible}
                    className="h-4 w-4 rounded border-[var(--border-strong)]"
                    aria-label="Select nodes on this page"
                  />
                </th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Node name</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Address</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Status</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Groups</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Owner</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Users / Xray</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Profile</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Status</th>
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Last sync</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-faint">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-soft">Loading…</td>
                </tr>
              ) : filteredNodes.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-soft">No nodes yet</td>
                </tr>
              ) : (
                filteredNodes.map((n) => (
                  <tr key={n.id} className="transition hover:bg-[var(--panel-muted)]">
                    <td className="px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(n.id)}
                        onChange={() => toggleSelect(n.id)}
                        className="h-4 w-4 rounded border-[var(--border-strong)]"
                        aria-label={`Select node ${n.name}`}
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <HealthDot node={n} />
                        <span className="font-semibold">{n.name}</span>
                        <span className="text-xs text-faint">#{n.id}</span>
                      </div>
                      <div className="text-xs text-soft">
                        {n.region || '--'}
                        {n.last_check_at && !n.last_check_ok && (
                          <span className="ml-1.5 text-[var(--danger)]"> · health check failed</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <CopyableAddress value={n.ip} strong />
                      <CopyableAddress value={n.domain} />
                    </td>
                    <td className="px-4 py-3.5">
                      <Tooltip
                        content={(getConfiguredProfiles(n.id).length === 0 ? unconfiguredStatusMeta : (statusMeta[n.sync_status] ?? statusMeta.pending)).tip}
                        side="right"
                        className="max-w-[220px] whitespace-normal"
                      >
                        <span tabIndex={0} className="inline-flex">
                          <Badge
                            label={(getConfiguredProfiles(n.id).length === 0 ? unconfiguredStatusMeta : (statusMeta[n.sync_status] ?? statusMeta.pending)).label}
                            variant={(getConfiguredProfiles(n.id).length === 0 ? unconfiguredStatusMeta : (statusMeta[n.sync_status] ?? statusMeta.pending)).variant}
                          />
                        </span>
                      </Tooltip>
                    </td>
                    <td className="px-4 py-3.5">
                      {renderGroupCell(n.group_names)}
                    </td>
                    <td className="px-4 py-3.5">
                      {n.owner ? (
                        <Badge label={n.owner} variant="gray" />
                      ) : (
                        <span className="text-soft">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-[var(--text)]">{n.online_user_count} online</div>
                      <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-soft">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            n.xray_version ? 'bg-[var(--success)]' : 'bg-[var(--border-strong)]'
                          }`}
                        />
                        <span>{n.xray_version ? `Xray ${n.xray_version}` : 'Xray —'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {renderProtocolCell(n)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Switch checked={n.active} onChange={() => toggle.mutate(n.id)} />
                    </td>
                    <td className="px-4 py-3.5 text-soft">{n.last_sync_at ? new Date(n.last_sync_at).toLocaleString('en-US') : '—'}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => sync.mutate(n.id)}
                            disabled={getConfiguredProfiles(n.id).length === 0}
                            className={`inline-flex h-9 items-center gap-1 rounded-md border px-3 text-xs font-medium transition ${
                              n.sync_status === 'failed'
                                ? 'border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning)] hover:bg-[var(--warning-soft)]'
                                : 'border-[var(--border)] bg-[var(--panel-strong)] text-[var(--accent)] hover:bg-[var(--panel-muted)]'
                            } ${getConfiguredProfiles(n.id).length === 0 ? 'cursor-not-allowed opacity-45 hover:bg-inherit' : ''}`}
                          >
                            <RefreshCw className={`h-3.5 w-3.5${sync.isPending && sync.variables === n.id ? ' animate-spin' : ''}`} />Sync</button>
                          <button
                            onClick={() => openEdit(n)}
                            className="inline-flex h-9 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-xs font-medium text-soft transition hover:bg-[var(--panel-muted)] hover:text-[var(--text)]"
                          >
                            <PencilLine className="h-3.5 w-3.5" />Edit</button>
                          <ActionMenu
                            items={[
                              {
                                label: 'Test SSH',
                                onSelect: () => testSSH.mutate(n.id),
                                disabled: testSSH.isPending && testSSH.variables === n.id,
                              },
                              {
                                label: 'Replace server',
                                onSelect: () => {
                                  setReplaceNode(n)
                                  setInstallOpen(true)
                                },
                              },
                              {
                                label: 'Preview generated config',
                                onSelect: () => setPreviewNode(n),
                              },
                              {
                                label: 'Delete node',
                                danger: true,
                                onSelect: async () => {
                                  const ok = await confirm({
                                    title: `Delete node "${n.name}"?`,
                                    description: 'This cannot be undone.',
                                    confirmText: 'Delete node',
                                    cancelText: 'Cancel',
                                    tone: 'danger',
                                  })
                                  if (ok) remove.mutate(n.id)
                                },
                              },
                            ]}
                          />
                        </div>
                        {n.sync_status === 'failed' && (
                          <div className="inline-flex items-center gap-1 text-[11px] text-[var(--warning)]">
                            <AlertTriangle className="h-3.5 w-3.5" />Test SSH first</div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <div className="flex items-center justify-between text-sm text-soft">
        <span>{data?.total ?? 0} total</span>
        <div className="flex items-center gap-2">
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
          <Btn variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
          <span>{page}</span>
          <Btn
            variant="secondary"
            disabled={page >= Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))}
            onClick={() => setPage((p) => p + 1)}
          >Next</Btn>
        </div>
      </div>

      <Drawer
        open={drawer.open}
        onClose={closeDrawer}
        title={drawer.node ? `Edit node · ${drawer.node.name}` : 'New node'}
        description="Connection details and SSH parameters live in the drawer on the right so the list stays readable."
        width="lg"
        dirty={dirty}
        saving={save.isPending}
        onBeforeClose={confirmCloseDrawer}
        footer={
          <>
            <Btn variant="secondary" onClick={closeDrawer}>Cancel</Btn>
            <Btn loading={save.isPending} onClick={() => save.mutate()}>Save</Btn>
          </>
        }
      >
        <div className="space-y-4">
          <FieldGroup title="Node identity" description="Basic details used in the list and to identify the node.">
            <Field label="Node name *" value={form.name} onChange={f('name')} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Region" value={form.region} onChange={f('region')} placeholder="e.g. Hong Kong" />
              <Field label="Owner" value={form.owner} onChange={f('owner')} placeholder="Where the node comes from, e.g. Provider A" />
            </div>
            <Field label="Notes" value={form.remark} onChange={f('remark')} placeholder="e.g. High-availability entry node" />
          </FieldGroup>

          <FieldGroup title="Connection address" description="Uses a direct IP connection when no domain is set.">
            <Field label="IP *" value={form.ip} onChange={f('ip')} placeholder="Server IP" />
            <Field label="Connection domain" value={form.domain} onChange={f('domain')} placeholder="CDN / relay domain (blank to use the IP)" />
          </FieldGroup>

          <FieldGroup title="SSH parameters" description="Used for sync, health checks and config delivery. Leave the key path empty to fall back to the system default.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="SSH port" value={form.ssh_port} onChange={f('ssh_port')} type="number" />
              <Field label="SSH user" value={form.ssh_user} onChange={f('ssh_user')} />
            </div>
            <Field
              label="SSH key path (optional override)"
              value={form.ssh_key_path}
              onChange={f('ssh_key_path')}
              placeholder="Leave blank to use the system default (/etc/xray-pilot/ssh/id_ed25519)"
            />
          </FieldGroup>

          <FieldGroup title="Xray runtime settings" description="Node-level override applied only to this node; blank inherits the system settings.">
            <SelectField
              label="Log level"
              value={form.log_level}
              onChange={(v) => setForm((prev) => ({ ...prev, log_level: v }))}
              options={NODE_LOG_LEVEL_OPTIONS}
            />
          </FieldGroup>

          {drawer.node && (
            <FieldGroup title="Quick actions" description="Run connectivity and config checks straight from the drawer.">
              <div className="flex flex-wrap gap-2">
                <Btn
                  variant="secondary"
                  loading={testSSH.isPending && testSSH.variables === drawer.node.id}
                  onClick={() => testSSH.mutate(drawer.node!.id)}
                >
                  <Wifi className="h-4 w-4" />Test SSH</Btn>
                <Btn variant="secondary" onClick={() => setPreviewNode(drawer.node!)}><FileCode className="h-4 w-4" />Preview config</Btn>
              </div>
            </FieldGroup>
          )}

          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        </div>
      </Drawer>

      {previewNode && (
        <PreviewConfigModal
          node={previewNode}
          activeProfiles={activeProfiles}
          onClose={() => setPreviewNode(null)}
        />
      )}
      {protocolNode && (
        <NodeProtocolsDrawer
          node={protocolNode}
          profiles={profilesData?.list ?? []}
          onPreview={() => {
            setPreviewNode(protocolNode)
            setProtocolNode(null)
          }}
          onClose={() => setProtocolNode(null)}
        />
      )}
      <OneClickInstallDialog
        open={installOpen}
        onClose={() => {
          setInstallOpen(false)
          setReplaceNode(null)
        }}
        onRegistered={() => invalidate()}
        replaceNode={replaceNode}
      />
    </PageShell>
  )
}

function PreviewConfigModal({ node, activeProfiles, onClose }: { node: Node; activeProfiles: InboundProfile[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['previewConfig', node.id],
    queryFn: () => nodeApi.previewConfig(node.id).then((r) => r.data.data!),
    retry: false,
  })
  const { data: nodeKeys } = useQuery({
    queryKey: ['nodeKeys', node.id],
    queryFn: () => nodeApi.getKeys(node.id).then((r) => r.data.data ?? []),
    retry: false,
  })

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    if (!data?.config) return
    const ok = await copyText(data.config)
    if (ok) {
      setCopied(true)
    } else {
      pushToast({
        title: 'Copy failed',
        description: 'Select the preview text and press Ctrl+C to copy',
        variant: 'warning',
      })
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Preview generated config · ${node.name}`}
      size="xl"
      footer={<Btn variant="secondary" onClick={onClose}>Close</Btn>}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs text-soft">Preview only — nothing is pushed to the node; `private_key` is redacted.</p>
            <ProtocolSummary nodeKeys={nodeKeys ?? []} activeProfiles={activeProfiles} />
          </div>
          <Btn variant="secondary" onClick={() => void handleCopy()} disabled={!data?.config}>
            <Copy className="h-4 w-4" />
            {copied ? 'Copied' : 'Quick copy'}
          </Btn>
        </div>
        {isLoading && <p className="py-8 text-center text-sm text-soft">Generating…</p>}
        {error && (
          <div className="rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-4">
            <p className="text-sm font-medium text-[var(--danger)]">Generation failed</p>
            <p className="mt-1 text-xs text-[var(--danger)]">{(error as Error).message}</p>
          </div>
        )}
        {data && (
          <>
            {(data.warnings ?? []).length > 0 && (
              <div className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-soft)] p-4">
                <p className="mb-2 text-xs font-medium text-[var(--warning)]">Some profiles failed to generate; the others are unaffected:</p>
                {data.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-[var(--warning)]">{w}</p>
                ))}
              </div>
            )}
            <pre className="max-h-[68vh] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--code-bg)] p-4 font-mono text-xs leading-5 text-[var(--code-text)] whitespace-pre">
              {data.config}
            </pre>
          </>
        )}
      </div>
    </Modal>
  )
}

function ProtocolSummary({ nodeKeys, activeProfiles }: { nodeKeys: NodeKey[]; activeProfiles: InboundProfile[] }) {
  const profileMap = new Map(activeProfiles.map((profile) => [profile.id, profile]))
  const matchedProfiles = nodeKeys
    .map((key) => profileMap.get(key.profile_id))
    .filter((item): item is InboundProfile => Boolean(item))

  if (matchedProfiles.length === 0) {
    return <p className="text-xs text-soft">This node has no profile bound, so the preview only contains the system default inbound.</p>
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-soft">
      <span>{matchedProfiles.length} profiles bound:</span>
      {matchedProfiles.map((profile) => (
        <Badge key={profile.id} label={profile.name} variant="blue" />
      ))}
    </div>
  )
}

function NodeProtocolsDrawer({
  node,
  profiles,
  onPreview,
  onClose,
}: {
  node: Node
  profiles: InboundProfile[]
  onPreview: () => void
  onClose: () => void
}) {
  const confirm = useConfirm()
  const qc = useQueryClient()
  // explicitActiveId is the profile the user activated by clicking; the derived activeProfileId below is then
  // overridden by the "exactly 1 profile checked" rule so both selection styles behave the same.
  const [explicitActiveId, setExplicitActiveId] = useState<number | null>(null)
  const [selectedProfileIds, setSelectedProfileIds] = useState<number[]>([])
  const [loadedByProfile, setLoadedByProfile] = useState<Record<number, { settings: string; port: number }>>({})
  const [draftByProfile, setDraftByProfile] = useState<Record<number, { settings: string; port: number }>>({})
  const [filter, setFilter] = useState('')
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok')

  // More than one checked = bulk; exactly one checked = treat it as activating that profile (so "1 checkbox selected" and
  // "click an entry to activate" merge, avoiding a dead zone where an entry is checked but not shown in the editor)
  const isBatchMode = selectedProfileIds.length > 1
  const activeProfileId =
    isBatchMode
      ? null
      : selectedProfileIds.length === 1
        ? selectedProfileIds[0]
        : explicitActiveId

  const { data: nodeKeys } = useQuery({
    queryKey: ['nodeKeys', node.id],
    queryFn: () => nodeApi.getKeys(node.id).then((r) => r.data.data ?? []),
  })

  const keyByProfileId = useMemo(() => {
    const m = new Map<number, NodeKey>()
    ;(nodeKeys ?? []).forEach((k) => m.set(k.profile_id, k))
    return m
  }, [nodeKeys])

  // Refresh loaded data for bound profiles
  useEffect(() => {
    if (!nodeKeys) return
    nodeKeys.forEach((k) => {
      if (loadedByProfile[k.profile_id] !== undefined) return
      setLoadedByProfile((prev) => ({
        ...prev,
        [k.profile_id]: {
          settings: stringifyNodeKeySettings(k.settings),
          port: k.port,
        },
      }))
    })
  }, [nodeKeys, loadedByProfile])

  const activeProfiles = profiles.filter((p) => p.active)
  const filteredProfiles = activeProfiles.filter((p) => {
    const kw = filter.trim().toLowerCase()
    if (!kw) return true
    return p.name.toLowerCase().includes(kw) || p.protocol.toLowerCase().includes(kw)
  })

  const activateProfile = (id: number) => {
    // When activating an unbound profile, seed a default draft so it can be edited
    if (loadedByProfile[id] === undefined && draftByProfile[id] === undefined) {
      setDraftByProfile((prev) => ({ ...prev, [id]: { settings: '{}', port: 0 } }))
    }
    setExplicitActiveId(id)
  }

  const updateDraft = (profileId: number, patch: Partial<{ settings: string; port: number }>) => {
    const base = draftByProfile[profileId] ?? loadedByProfile[profileId] ?? { settings: '{}', port: 0 }
    setDraftByProfile((prev) => ({ ...prev, [profileId]: { ...base, ...patch } }))
  }

  const dirtyProfileIds = Object.keys(draftByProfile)
    .map(Number)
    .filter((id) => {
      const d = draftByProfile[id]
      const l = loadedByProfile[id]
      return !l || d.settings !== l.settings || d.port !== l.port
    })

  const toggleProfileSelect = (id: number) => {
    setSelectedProfileIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const activeProfile = activeProfileId !== null ? activeProfiles.find((p) => p.id === activeProfileId) : undefined
  const activeKey = activeProfileId !== null ? keyByProfileId.get(activeProfileId) : undefined
  const activeLocked = activeKey?.locked ?? false
  // Exactly one checked but no draft yet means draft and loaded are both undefined — seed a placeholder so
  // the port and settings editor can render (the first keystroke is then written into state by updateDraft)
  const activeDraft = activeProfileId !== null
    ? (draftByProfile[activeProfileId] ?? loadedByProfile[activeProfileId] ?? { settings: '{}', port: 0 })
    : undefined

  // Port conflicts are detected in the UI in real time (the backend still validates as a backstop)
  const portConflict = useMemo(() => {
    if (!activeProfile || !activeDraft) return null
    const effPort = activeDraft.port > 0 ? activeDraft.port : activeProfile.port
    const transport = activeProfile.protocol === 'hysteria2' ? 'udp' : 'tcp'
    for (const k of nodeKeys ?? []) {
      if (k.profile_id === activeProfile.id) continue
      const other = profiles.find((p) => p.id === k.profile_id)
      if (!other) continue
      const otherTransport = other.protocol === 'hysteria2' ? 'udp' : 'tcp'
      const otherEffPort = k.port > 0 ? k.port : other.port
      if (otherTransport === transport && otherEffPort === effPort) {
        return `${transport.toUpperCase()} port ${effPort} is already used by profile [${other.name}]`
      }
    }
    return null
  }, [activeProfile, activeDraft, nodeKeys, profiles])

  const batchSave = useMutation({
    mutationFn: async () => {
      const targets = selectedProfileIds.length > 0 ? selectedProfileIds : activeProfileId !== null ? [activeProfileId] : []
      if (targets.length === 0) throw new Error('Select a target profile first')
      const results: Array<{ id: number; ok: boolean; msg: string }> = []
      for (const id of targets) {
        const draft = draftByProfile[id] ?? loadedByProfile[id] ?? { settings: '{}', port: 0 }
        const settings = draft.settings || '{}'
        try {
          await nodeApi.upsertKey(node.id, id, settings, draft.port)
          results.push({ id, ok: true, msg: 'Saved' })
        } catch (e) {
          results.push({ id, ok: false, msg: (e as Error).message })
        }
      }
      return results
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length
      const failed = results.length - ok
      results.filter((r) => r.ok).forEach((r) => {
        const d = draftByProfile[r.id] ?? loadedByProfile[r.id] ?? { settings: '{}', port: 0 }
        setLoadedByProfile((prev) => ({ ...prev, [r.id]: d }))
        setDraftByProfile((prev) => {
          const n = { ...prev }
          delete n[r.id]
          return n
        })
      })
      setMsg(
        failed === 0
          ? `Saved ${ok} profiles`
          : `${ok} succeeded, ${failed} failed. ${results.filter((r) => !r.ok).map((r) => `#${r.id} ${r.msg}`).join('; ')}`,
      )
      setMsgType(failed === 0 ? 'ok' : 'err')
      qc.invalidateQueries({ queryKey: ['nodes'] })
      qc.invalidateQueries({ queryKey: ['nodeKeys', node.id] })
      qc.invalidateQueries({ queryKey: ['node-keys-for-list'] })
    },
    onError: (e: Error) => {
      setMsg(`Save failed: ${e.message}`)
      setMsgType('err')
    },
  })

  const keygen = useMutation({
    mutationFn: async () => {
      if (activeProfileId === null) throw new Error('Select a profile first')
      if (activeProfile?.protocol !== 'vless-reality') throw new Error('Only VLESS + Reality supports one-click generation')
      const res = await nodeApi.keygen()
      const keys = res.data.data
      if (!keys) throw new Error('Key generation failed')
      // Seed the template's SNI / fingerprint as an editable node-level value (blank falls back to the template default)
      const tpl = (activeProfile?.settings ?? {}) as { sni?: string; fingerprint?: string }
      return JSON.stringify(
        {
          private_key: keys.private_key,
          public_key: keys.public_key,
          short_ids: generateShortIds(6),
          sni: tpl.sni ?? '',
          fingerprint: tpl.fingerprint ?? '',
        },
        null,
        2,
      )
    },
    onSuccess: (settings) => {
      if (activeProfileId !== null) updateDraft(activeProfileId, { settings })
      setMsg('Keys generated as drafts — remember to save')
      setMsgType('ok')
    },
    onError: (e: Error) => {
      setMsg(`Generation failed: ${e.message}`)
      setMsgType('err')
    },
  })

  const fillTemplate = () => {
    if (selectedProfileIds.length > 0) {
      selectedProfileIds.forEach((id) => {
        const p = activeProfiles.find((x) => x.id === id)
        if (p) updateDraft(id, { settings: stringifyNodeKeySettings(p.settings) })
      })
      setMsg(`Filled template config into ${selectedProfileIds.length} profiles`)
      setMsgType('ok')
      return
    }
    if (activeProfileId === null || !activeProfile) return
    updateDraft(activeProfileId, { settings: stringifyNodeKeySettings(activeProfile.settings) })
    setMsg('Filled the protocol defaults')
    setMsgType('ok')
  }

  const lockToggle = useMutation({
    mutationFn: (locked: boolean) => {
      if (activeProfileId === null) throw new Error('Select a profile first')
      return nodeApi.setKeyLock(node.id, activeProfileId, locked)
    },
    onSuccess: (_, locked) => {
      setMsg(locked ? 'Profile locked for this node' : 'Lock removed')
      setMsgType('ok')
      qc.invalidateQueries({ queryKey: ['nodeKeys', node.id] })
    },
    onError: (e: Error) => {
      setMsg(`Action failed: ${e.message}`)
      setMsgType('err')
    },
  })

  const remove = useMutation({
    mutationFn: (profileId: number) => nodeApi.deleteKey(node.id, profileId),
    onSuccess: (_, profileId) => {
      setMsg('Profile unbound')
      setMsgType('ok')
      setLoadedByProfile((prev) => {
        const n = { ...prev }
        delete n[profileId]
        return n
      })
      setDraftByProfile((prev) => {
        const n = { ...prev }
        delete n[profileId]
        return n
      })
      qc.invalidateQueries({ queryKey: ['nodes'] })
      qc.invalidateQueries({ queryKey: ['nodeKeys', node.id] })
      qc.invalidateQueries({ queryKey: ['node-keys-for-list'] })
    },
    onError: (e: Error) => {
      setMsg(`Unbind failed: ${e.message}`)
      setMsgType('err')
    },
  })

  const targets = selectedProfileIds.length > 0 ? selectedProfileIds : activeProfileId !== null ? [activeProfileId] : []
  const unboundSelected = selectedProfileIds.filter((id) => !keyByProfileId.has(id))
  const saveLabel = isBatchMode
    ? unboundSelected.length === selectedProfileIds.length
      ? `Bind all (${selectedProfileIds.length})`
      : `Save all (${selectedProfileIds.length})`
    : keyByProfileId.has(activeProfileId ?? -1) ? 'Save profile' : 'Bind profile'

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Node profiles · ${node.name}`}
      description="Pick one or more profiles on the left; edit settings and ports on the right. Saving an unbound profile binds it."
      width="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Close</Btn>
          <Btn variant="secondary" onClick={onPreview}>
            <FileCode className="h-4 w-4" />View full config</Btn>
          <Btn
            loading={batchSave.isPending}
            onClick={() => batchSave.mutate()}
            disabled={targets.length === 0 || (!isBatchMode && activeLocked) || portConflict !== null}
          >
            {saveLabel}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        {/* Left: profile list */}
        <div className="space-y-3">
          <div className="border-l-2 border-[var(--accent)] pl-3 text-xs text-soft">
            <div className="font-medium text-[var(--text)]">
              <span className="text-faint">#{node.id}</span>
              <span className="mx-2">{node.name}</span>
            </div>
            <div className="mt-1 truncate">
              {[node.ip, node.domain].filter(Boolean).join(' · ')}
            </div>
            <div className="mt-1 truncate">
              <span className="text-faint">Region</span> {node.region || '--'}
              <span className="mx-1.5 text-faint">·</span>
              <span className="text-faint">Owner</span> {node.owner || '--'}
            </div>
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search profile name / type"
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-sm text-[var(--text)] placeholder:text-faint focus:border-[var(--accent)] focus:outline-none"
          />
          <div className="flex items-center justify-between text-xs text-soft">
            <span>{filteredProfiles.length} total</span>
            <button
              type="button"
              onClick={() => {
                const allVis = filteredProfiles.every((p) => selectedProfileIds.includes(p.id))
                setSelectedProfileIds(
                  allVis
                    ? selectedProfileIds.filter((id) => !filteredProfiles.some((p) => p.id === id))
                    : Array.from(new Set([...selectedProfileIds, ...filteredProfiles.map((p) => p.id)])),
                )
              }}
              className="text-[var(--accent)] hover:underline"
            >
              {filteredProfiles.every((p) => selectedProfileIds.includes(p.id)) && filteredProfiles.length > 0 ? 'Clear selection' : 'Select all visible'}
            </button>
          </div>
          <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
            {filteredProfiles.map((p) => {
              const k = keyByProfileId.get(p.id)
              const isActive = activeProfileId === p.id
              const isSelected = selectedProfileIds.includes(p.id)
              const isDirty = dirtyProfileIds.includes(p.id)
              const effPort = k && k.port > 0 ? k.port : p.port
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition ${
                    isActive
                      ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)]'
                      : 'border-[var(--border)] bg-[var(--panel-strong)] hover:bg-[var(--panel-muted)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleProfileSelect(p.id)}
                    className="h-4 w-4 shrink-0 rounded border-[var(--border-strong)]"
                    aria-label={`Select ${p.name}`}
                  />
                  <button type="button" onClick={() => activateProfile(p.id)} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                    <span className="flex items-center gap-1.5">
                      <Badge label={protocolLabel(p.protocol)} variant={protocolBadgeVariant(p.protocol)} />
                      {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" title="Unsaved" />}
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-soft">
                      <span className="truncate font-medium text-[var(--text)]">{p.name}</span>
                      <span className="text-faint">·</span>
                      {k ? (
                        <>
                          <span>{k.port > 0 ? `Port ${effPort}` : `Default ${effPort}`}</span>
                          {k.locked && <Lock className="h-3.5 w-3.5 text-[var(--warning)]" aria-label="Locked" />}
                        </>
                      ) : (
                        <span className="text-faint">Unbound</span>
                      )}
                    </span>
                  </button>
                  {k && <Badge label="Bound" variant="green" />}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: editor */}
        <div className="space-y-4">
          {targets.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-soft">Pick a profile on the left (click to edit, checkbox for bulk actions)</div>
          )}

          {targets.length > 0 && (
            <>
              <FieldGroup
                title={
                  isBatchMode
                    ? `Bulk target · ${selectedProfileIds.length} profiles${unboundSelected.length > 0 ? ` (incl. ${unboundSelected.length} unbound)` : ''}`
                    : `Current profile · ${activeProfile?.name ?? ''}${!keyByProfileId.has(activeProfileId ?? -1) ? ' (unbound)' : ''}`
                }
                description={
                  isBatchMode
                    ? 'Bulk save applies to every checked profile. Unbound ones are bound with the template defaults; fine-tune them afterwards.'
                    : activeProfile
                      ? `Protocol default port ${activeProfile.port} (${activeProfile.protocol === 'hysteria2' ? 'UDP' : 'TCP'}). Leave blank or enter 0 to inherit it.`
                      : ''
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  {!isBatchMode && activeProfile?.protocol === 'vless-reality' && (
                    <Btn variant="secondary" loading={keygen.isPending} onClick={() => keygen.mutate()} disabled={activeLocked}>
                      <Sparkles className="h-4 w-4" />One-click generate</Btn>
                  )}
                  <Btn variant="secondary" onClick={fillTemplate} disabled={!isBatchMode && activeLocked}>Fill template</Btn>
                  {!isBatchMode && activeKey && (
                    <Btn variant="secondary" loading={lockToggle.isPending} onClick={() => lockToggle.mutate(!activeLocked)}>
                      {activeLocked ? 'Unlock' : 'Lock profile'}
                    </Btn>
                  )}
                  {!isBatchMode && activeKey && (
                    <Btn
                      variant="secondary"
                      disabled={activeLocked || remove.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Unbind profile "${activeProfile?.name}"?`,
                          description: 'The profile stops taking part in config generation and the node returns to pending sync.',
                          confirmText: 'Unbind profile',
                          cancelText: 'Cancel',
                          tone: 'danger',
                        })
                        if (ok && activeProfileId !== null) remove.mutate(activeProfileId)
                      }}
                    >Unbind profile</Btn>
                  )}
                </div>
              </FieldGroup>

              {!isBatchMode && activeProfile && activeDraft && (
                <FieldGroup title="Settings and port" description="Saving an empty object `{}` inherits the protocol defaults; port 0 inherits the template port.">
                  <Field
                    label={`Listen port (blank to inherit ${activeProfile.port})`}
                    value={String(activeDraft.port || '')}
                    onChange={(e) => updateDraft(activeProfileId!, { port: Number(e.target.value) || 0 })}
                    placeholder={`${activeProfile.port}`}
                    type="number"
                  />
                  {portConflict && <p className="text-xs text-[var(--danger)]">Port conflict: {portConflict} (the backend will reject the save)</p>}
                  <textarea
                    value={activeDraft.settings}
                    onChange={(e) => updateDraft(activeProfileId!, { settings: e.target.value })}
                    rows={12}
                    disabled={activeLocked}
                    className="min-h-[240px] w-full rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 font-mono text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-ring)]"
                    placeholder='{} inherits the protocol defaults'
                  />
                  {activeLocked && <p className="text-xs text-[var(--warning)]">This profile is locked for the node — unlock it to edit, delete or regenerate keys.</p>}
                </FieldGroup>
              )}

              {isBatchMode && (
                <FieldGroup title="Bulk draft preview" description="Every profile keeps its own draft. Actions such as 'Fill template' apply to all selected profiles.">
                  <div className="space-y-2">
                    {selectedProfileIds.map((id) => {
                      const p = activeProfiles.find((x) => x.id === id)
                      const draft = draftByProfile[id] ?? loadedByProfile[id] ?? { settings: '{}', port: 0 }
                      const hasDraft = !!draftByProfile[id]
                      const bound = keyByProfileId.has(id)
                      return (
                        <div key={id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-xs">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{p?.name ?? `#${id}`}</span>
                            {p && <Badge label={protocolLabel(p.protocol)} variant={protocolBadgeVariant(p.protocol)} />}
                            {!bound && <Badge label="New binding" variant="yellow" />}
                          </div>
                          <div className="flex items-center gap-2 text-soft">
                            <span>{draft.port > 0 ? `Port ${draft.port}` : 'Default port'}</span>
                            <span>{draft.settings && draft.settings !== '{}' ? `${draft.settings.length} chars` : 'Inherit defaults'}</span>
                            {hasDraft && <Badge label="Unsaved" variant="yellow" />}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </FieldGroup>
              )}

              {msg && <p className={`text-sm ${msgType === 'ok' ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{msg}</p>}
            </>
          )}
        </div>
      </div>
    </Drawer>
  )
}

// HealthDot: node health dot, matching the semantics of the dashboard "Node health" card:
// green = last check passed; red = checked but failed; grey = never checked
function HealthDot({ node }: { node: Node }) {
  const meta = !node.last_check_at
    ? { color: 'bg-[var(--border-strong)]', label: 'Not checked', detail: 'No health check yet — press Test SSH to run one' }
    : node.last_check_ok
      ? {
          color: 'bg-[var(--success)]',
          label: 'Healthy',
          detail: `Latency ${node.last_latency_ms > 0 ? `${node.last_latency_ms}ms` : '—'} · last check ${new Date(node.last_check_at).toLocaleString('en-US')}`,
        }
      : {
          color: 'bg-[var(--danger)]',
          label: 'Check failed',
          detail: `Last check at ${new Date(node.last_check_at).toLocaleString('en-US')} failed — run a SSH test to diagnose`,
        }
  return (
    <Tooltip content={`Health check: ${meta.label} · ${meta.detail}`} side="right" className="max-w-[280px] whitespace-normal">
      <span tabIndex={0} className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${meta.color}`} aria-label={`Health check: ${meta.label}`} />
    </Tooltip>
  )
}

// CopyableAddress: one address cell (IP or domain) with a quick copy button
function CopyableAddress({ value, strong }: { value: string; strong?: boolean }) {
  if (!value) return <div className="text-xs text-soft">—</div>
  return (
    <div
      className={`flex items-center gap-1.5 ${
        strong ? 'font-medium text-[var(--text)]' : 'text-xs text-soft'
      }`}
    >
      <span className="truncate">{value}</span>
      <button
        type="button"
        title={`Copy ${value}`}
        aria-label={`Copy ${value}`}
        onClick={async () => {
          const ok = await copyText(value)
          pushToast(
            ok
              ? { title: 'Copied', description: value, variant: 'success' }
              : { title: 'Copy failed', description: 'Select the text and copy it manually', variant: 'warning' },
          )
        }}
        className="shrink-0 text-faint transition hover:text-[var(--accent)]"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function stringifyNodeKeySettings(settings: unknown) {
  if (!settings) return '{}'
  if (typeof settings === 'string') {
    try {
      return JSON.stringify(JSON.parse(settings), null, 2)
    } catch {
      return settings
    }
  }
  return JSON.stringify(settings, null, 2)
}

