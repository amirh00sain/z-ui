import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers2, PencilLine, Plus } from 'lucide-react'
import { groupApi, nodeApi } from '@/lib/api'
import type { Group } from '@/types'
import { Table, Pagination } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Field, Btn, FieldGroup, Switch } from '@/components/ui/Form'
import { PageShell, SurfaceCard } from '@/components/ui/Page'
import { Drawer } from '@/components/ui/Drawer'
import { ActionMenu } from '@/components/ui/ActionMenu'
import { BulkBar, FilterChip, ListToolbar } from '@/components/ui/ListToolbar'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { Tooltip } from '@/components/ui/Tooltip'

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const DESCRIPTION_PREVIEW_LIMIT = 24

interface FormState {
  name: string
  description: string
  node_ids: number[]
}

const emptyForm = (): FormState => ({ name: '', description: '', node_ids: [] })

function truncateDescription(text: string, limit = DESCRIPTION_PREVIEW_LIMIT) {
  const normalized = text.trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
}

function GroupNodesTooltip({ names }: { names: string[] }) {
  return (
    <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
      {names.map((name) => (
        <div key={name} className="whitespace-nowrap">
          {name}
        </div>
      ))}
    </div>
  )
}


export default function Groups() {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [drawer, setDrawer] = useState<{ open: boolean; group?: Group }>({ open: false })
  const [form, setForm] = useState<FormState>(emptyForm())
  const [initialForm, setInitialForm] = useState<FormState>(emptyForm())
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const { data, isLoading } = useQuery({
    queryKey: ['groups', page, pageSize],
    queryFn: () => groupApi.list({ page, page_size: pageSize }).then((r) => r.data.data!),
  })

  const { data: allNodes } = useQuery({
    queryKey: ['nodes-all'],
    queryFn: () => nodeApi.list({ page: 1, page_size: 200 }).then((r) => r.data.data?.list ?? []),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['groups'] })

  const save = useMutation({
    mutationFn: () => (drawer.group ? groupApi.update(drawer.group.id, form) : groupApi.create(form)),
    onSuccess: () => {
      invalidate()
      closeDrawer()
    },
    onError: (e: Error) => setErr(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: number) => groupApi.remove(id),
    onSuccess: invalidate,
  })
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => groupApi.update(id, { active }),
    onSuccess: invalidate,
  })

  const openCreate = () => {
    const next = emptyForm()
    setForm(next)
    setInitialForm(next)
    setErr('')
    setDrawer({ open: true })
  }

  const openEdit = (g: Group) => {
    const next = { name: g.name, description: g.description, node_ids: g.node_ids ?? [] }
    setForm(next)
    setInitialForm(next)
    setErr('')
    setDrawer({ open: true, group: g })
  }

  const closeDrawer = () => setDrawer({ open: false })
  const confirmCloseDrawer = async () => {
    if (!dirty) return true
    return confirm({
      title: 'Discard unsaved group changes?',
      description: 'Closing now will discard changes to this group\'s name and node links.',
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
      tone: 'danger',
    })
  }

  const f = (k: 'name' | 'description') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

  const toggleNode = (nodeId: number) =>
    setForm((prev) => ({
      ...prev,
      node_ids: prev.node_ids.includes(nodeId) ? prev.node_ids.filter((id) => id !== nodeId) : [...prev.node_ids, nodeId],
    }))

  const filteredGroups = (data?.list ?? []).filter((g) => {
    const keyword = search.trim().toLowerCase()
    const matchesKeyword =
      keyword === '' || g.name.toLowerCase().includes(keyword) || g.description.toLowerCase().includes(keyword)
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' && g.active) || (statusFilter === 'inactive' && !g.active)
    return matchesKeyword && matchesStatus
  })
  const allVisibleSelected = filteredGroups.length > 0 && filteredGroups.every((g) => selectedIds.includes(g.id))
  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm) && drawer.open

  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))

  const toggleSelectVisible = () =>
    setSelectedIds((prev) => {
      if (allVisibleSelected) return prev.filter((id) => !filteredGroups.some((g) => g.id === id))
      return Array.from(new Set([...prev, ...filteredGroups.map((g) => g.id)]))
    })

  const selectedGroups = filteredGroups.filter((g) => selectedIds.includes(g.id))
  const nodeNameMap = new Map((allNodes ?? []).map((node) => [node.id, node.name]))

  const columns = [
    {
      key: 'select',
      label: (
        <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectVisible} aria-label="Select groups on this page" className="h-4 w-4 rounded border-[var(--border-strong)]" />
      ) as unknown as string,
      render: (g: Group) => (
        <input type="checkbox" checked={selectedIds.includes(g.id)} onChange={() => toggleSelect(g.id)} aria-label={`Select group ${g.name}`} className="h-4 w-4 rounded border-[var(--border-strong)]" />
      ),
    },
    {
      key: 'name',
      label: 'Name',
      render: (g: Group) => (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{g.name}</span>
            <span className="text-xs text-faint">#{g.id}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'node_count',
      label: 'Nodes',
      render: (g: Group) => (
        <Tooltip
          content={
            g.node_ids.length > 0
              ? <GroupNodesTooltip names={g.node_ids.map((id) => nodeNameMap.get(id)).filter((name): name is string => Boolean(name))} />
              : 'No nodes linked to this group'
          }
          side="right"
          className="max-w-[320px] whitespace-normal"
        >
          <button
            type="button"
            onClick={() => openEdit(g)}
            title="Click to edit this group"
            className="inline-flex rounded-full transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Badge label={`${g.node_count} nodes`} variant="blue" />
          </button>
        </Tooltip>
      ),
    },
    {
      key: 'active',
      label: 'Status',
      render: (g: Group) => <Switch checked={g.active} onChange={(next) => toggle.mutate({ id: g.id, active: next })} />,
    },
    {
      key: 'description',
      label: 'Description',
      render: (g: Group) => {
        const text = g.description?.trim() || 'No description'
        const preview = truncateDescription(text)
        return (
          <Tooltip content={text} side="right" className="max-w-[320px] whitespace-normal">
            <span className="block max-w-[280px] truncate text-xs text-soft">
              {preview}
            </span>
          </Tooltip>
        )
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (g: Group) => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => openEdit(g)}
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-xs font-semibold text-soft transition hover:bg-[var(--panel-muted)] hover:text-[var(--text)]"
          >
            <PencilLine className="h-3.5 w-3.5" />Edit</button>
          <ActionMenu
            items={[
              {
                label: 'Delete group',
                danger: true,
                onSelect: async () => {
                  const ok = await confirm({
                    title: `Delete group "${g.name}"?`,
                    description: 'Deleting it removes the links between this group and its nodes.',
                    confirmText: 'Delete group',
                    cancelText: 'Cancel',
                    tone: 'danger',
                  })
                  if (ok) remove.mutate(g.id)
                },
              },
            ]}
          />
        </div>
      ),
    },
  ]

  return (
    <PageShell>
      <ListToolbar
        actions={
          <Btn onClick={openCreate}>
            <Plus className="h-4 w-4" />New group</Btn>
        }
        searchValue={search}
        searchPlaceholder="Search group name or description"
        onSearchChange={setSearch}
        filters={
          <>
            <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All</FilterChip>
            <FilterChip active={statusFilter === 'active'} onClick={() => setStatusFilter('active')}>Enabled</FilterChip>
            <FilterChip active={statusFilter === 'inactive'} onClick={() => setStatusFilter('inactive')}>Disabled</FilterChip>
          </>
        }
        bulkBar={
          selectedGroups.length > 0 ? (
            <BulkBar>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-soft">Selected<span className="font-semibold text-[var(--text)]">{selectedGroups.length}</span> groups</div>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    variant="danger"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${selectedGroups.length} selected groups?`,
                        description: 'Bulk delete also removes the links between these groups and their nodes.',
                        confirmText: 'Bulk delete',
                        cancelText: 'Cancel',
                        tone: 'danger',
                      })
                      if (!ok) return
                      await Promise.all(selectedGroups.map((g) => groupApi.remove(g.id)))
                      setSelectedIds([])
                      invalidate()
                    }}
                  >Bulk delete</Btn>
                </div>
              </div>
            </BulkBar>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <Table columns={columns} data={filteredGroups} loading={isLoading} />
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

        <SurfaceCard className="p-5">
          <div className="mb-4">
            <div className="text-sm font-semibold">About groups</div>
            <p className="mt-2 text-sm leading-6 text-soft">Use groups to describe route pools, region pools or delivery policies. Users and subscriptions then stay easy to reason about as the setup grows.</p>
          </div>
          <div className="space-y-3">
            <div className="border-t border-[var(--border)] pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Node Pool</div>
              <div className="mt-2 text-sm font-semibold">Group nodes by role</div>
              <p className="mt-2 text-xs leading-5 text-soft">Overseas relays, HA entry points, experimental routes — no need to scatter that meaning across node notes.</p>
            </div>
            <div className="border-t border-[var(--border)] pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Distribution</div>
              <div className="mt-2 text-sm font-semibold">Prepare for subscription delivery</div>
              <p className="mt-2 text-xs leading-5 text-soft">Once users are bound to groups, subscription generation becomes more natural and incidents are easier to trace.</p>
            </div>
          </div>
        </SurfaceCard>
      </div>

      <Drawer
        open={drawer.open}
        onClose={closeDrawer}
        title={drawer.group ? `Edit group · ${drawer.group.name}` : 'New group'}
        description="Maintain the group name, description and node links on the right."
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
          <FieldGroup title="Group details" description="Used to separate node pools and user delivery policies.">
            <Field label="Group name *" value={form.name} onChange={f('name')} placeholder="e.g. Premium nodes" />
            <Field label="Description" value={form.description} onChange={f('description')} placeholder="e.g. High-priority pool / Overseas pool" />
          </FieldGroup>

          <FieldGroup title="Linked nodes" description={`${form.node_ids.length} nodes selected — toggle them directly in the list.`}>
            {(allNodes ?? []).length === 0 ? (
              <p className="text-xs text-soft">No nodes yet — add one first.</p>
            ) : (
              <div className="grid gap-3">
                {(allNodes ?? []).map((n) => {
                  const checked = form.node_ids.includes(n.id)
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => toggleNode(n.id)}
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        checked
                          ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)]'
                          : 'border-[var(--border)] bg-[var(--panel-strong)] hover:bg-[var(--panel-muted)]'
                      }`}
                    >
                      <div className={`h-2.5 w-2.5 rounded-full ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{n.name}</span>
                          {n.owner && <Badge label={n.owner} variant="gray" />}
                        </div>
                        <div className="mt-1 text-xs text-soft">
                          {[n.region, n.ip, n.domain].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <Layers2 className="h-4 w-4 text-soft" />
                    </button>
                  )
                })}
              </div>
            )}
          </FieldGroup>

          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        </div>
      </Drawer>
    </PageShell>
  )
}
