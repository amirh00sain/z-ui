import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, PencilLine, Plus, Sparkles } from 'lucide-react'
import { nodeApi, profileApi } from '@/lib/api'
import { generateShortIds } from '@/lib/keygen'
import { PROTOCOL_OPTIONS, protocolBadgeVariant, protocolLabel } from '@/lib/protocol'
import type { InboundProfile, NodeKey, Protocol } from '@/types'
import { Table, Pagination } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Field, SelectField, Btn, FieldGroup, Switch } from '@/components/ui/Form'
import { PageShell, SurfaceCard } from '@/components/ui/Page'
import { Drawer } from '@/components/ui/Drawer'
import { ActionMenu } from '@/components/ui/ActionMenu'
import { BulkBar, FilterChip, ListToolbar } from '@/components/ui/ListToolbar'
import { useConfirm } from '@/components/ui/ConfirmProvider'

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const protocolOptions = PROTOCOL_OPTIONS

const defaultSettings: Record<Protocol, string> = {
  'vless-reality': JSON.stringify({ sni: 'www.microsoft.com', fingerprint: 'chrome', private_key: '', public_key: '', short_ids: [] }, null, 2),
  'vless-ws-tls': JSON.stringify({ host: 'cdn.example.com', path: '/ws' }, null, 2),
  trojan: JSON.stringify({ sni: 'example.com' }, null, 2),
  hysteria2: JSON.stringify({ sni: 'example.com', up_mbps: 100, down_mbps: 100 }, null, 2),
  // http/socks: set at least one of allowed_ips or accounts, otherwise the backend refuses to generate (guards against an open proxy);
  // allow_private = true lets allowlisted sources reach internal targets through the proxy (blocked by default)
  http: JSON.stringify({ allowed_ips: ['101.42.9.109', '113.108.128.120/29'], accounts: [], allow_private: false }, null, 2),
  socks: JSON.stringify({ allowed_ips: ['101.42.9.109', '113.108.128.120/29'], accounts: [], allow_private: false }, null, 2),
}

// Default listen port filled in on protocol switch; http/socks avoids common scanner ports
const defaultPort: Record<Protocol, string> = {
  'vless-reality': '443',
  'vless-ws-tls': '443',
  trojan: '443',
  hysteria2: '2096',
  http: '18080',
  socks: '11080',
}

function stringifySettings(settings: unknown) {
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

interface FormState {
  name: string
  protocol: string
  port: string
  settings: string
  active: boolean
  remark: string
}

const emptyForm = (): FormState => ({
  // The profile name defaults to the protocol label — save as-is or rename it
  name: protocolLabel('vless-reality'),
  protocol: 'vless-reality',
  port: '443',
  settings: defaultSettings['vless-reality'],
  active: true,
  remark: '',
})


function NodeKeyDrawer({ profile, onClose }: { profile: InboundProfile; onClose: () => void }) {
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([])
  const [loadedByNode, setLoadedByNode] = useState<Record<number, { settings: string; port: number }>>({})
  const [draftByNode, setDraftByNode] = useState<Record<number, { settings: string; port: number }>>({})
  const [filter, setFilter] = useState('')
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok')
  const qc = useQueryClient()

  const { data: nodes } = useQuery({
    queryKey: ['nodes-all'],
    queryFn: () => nodeApi.list({ page: 1, page_size: 200 }).then((r) => r.data.data?.list ?? []),
  })
  const sortedNodes = [...(nodes ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en-US', { numeric: true, sensitivity: 'base' }))
  const filteredNodes = sortedNodes.filter((n) => {
    const kw = filter.trim().toLowerCase()
    if (!kw) return true
    return n.name.toLowerCase().includes(kw) || n.ip.toLowerCase().includes(kw) || n.region.toLowerCase().includes(kw)
  })

  // Load every node's key overview at once so the "Bound / port / lock" badges can be shown
  const { data: keysByNode } = useQuery({
    queryKey: ['node-keys-overview', profile.id, (nodes ?? []).map((n) => n.id).join(',')],
    queryFn: async () => {
      const result: Record<number, NodeKey | null> = {}
      await Promise.all(
        (nodes ?? []).map(async (n) => {
          const res = await nodeApi.getKeys(n.id)
          const keys = res.data.data ?? []
          result[n.id] = keys.find((k) => k.profile_id === profile.id) ?? null
        }),
      )
      return result
    },
    enabled: (nodes?.length ?? 0) > 0,
  })

  // Switching the active node loads its draft / saved value automatically
  useEffect(() => {
    if (!activeNodeId || !keysByNode) return
    if (loadedByNode[activeNodeId] !== undefined) return
    const k = keysByNode[activeNodeId]
    const next = {
      settings: k ? stringifySettings(k.settings) : '',
      port: k?.port ?? 0,
    }
    setLoadedByNode((prev) => ({ ...prev, [activeNodeId]: next }))
  }, [activeNodeId, keysByNode, loadedByNode])

  const activeDraft = activeNodeId !== null ? (draftByNode[activeNodeId] ?? loadedByNode[activeNodeId]) : undefined
  const activeKey = activeNodeId !== null && keysByNode ? keysByNode[activeNodeId] : null
  const activeLocked = activeKey?.locked ?? false

  const updateDraft = (nodeId: number, patch: Partial<{ settings: string; port: number }>) => {
    const base = draftByNode[nodeId] ?? loadedByNode[nodeId] ?? { settings: '', port: 0 }
    setDraftByNode((prev) => ({ ...prev, [nodeId]: { ...base, ...patch } }))
  }

  const dirtyNodeIds = Object.keys(draftByNode)
    .map(Number)
    .filter((id) => {
      const d = draftByNode[id]
      const l = loadedByNode[id]
      return !l || d.settings !== l.settings || d.port !== l.port
    })

  const toggleNodeSelect = (id: number) => {
    setSelectedNodeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // Bulk save: upsert each selected node and report success or failure per node
  const batchSave = useMutation({
    mutationFn: async () => {
      const targets = selectedNodeIds.length > 0 ? selectedNodeIds : activeNodeId !== null ? [activeNodeId] : []
      if (targets.length === 0) throw new Error('Select a target node first')
      const results: Array<{ id: number; ok: boolean; msg: string }> = []
      for (const id of targets) {
        const draft = draftByNode[id] ?? loadedByNode[id]
        if (!draft || !draft.settings) {
          results.push({ id, ok: false, msg: 'Key settings are empty' })
          continue
        }
        try {
          await nodeApi.upsertKey(id, profile.id, draft.settings, draft.port)
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
      // On success: promote the draft to loaded and clear it
      results.filter((r) => r.ok).forEach((r) => {
        const d = draftByNode[r.id] ?? loadedByNode[r.id]
        if (d) {
          setLoadedByNode((prev) => ({ ...prev, [r.id]: d }))
          setDraftByNode((prev) => {
            const next = { ...prev }
            delete next[r.id]
            return next
          })
        }
      })
      setMsg(failed === 0 ? `Saved ${ok} nodes` : `Save finished: ${ok} succeeded, ${failed} failed. Failures: ${results.filter((r) => !r.ok).map((r) => `#${r.id} ${r.msg}`).join('；')}`)
      setMsgType(failed === 0 ? 'ok' : 'err')
      qc.invalidateQueries({ queryKey: ['nodes'] })
      qc.invalidateQueries({ queryKey: ['node-keys-overview'] })
    },
    onError: (e: Error) => {
      setMsg(`Save failed: ${e.message}`)
      setMsgType('err')
    },
  })

  // Bulk one-click generate (vless-reality only): write a key draft for each selected node
  const batchKeygen = useMutation({
    mutationFn: async () => {
      const targets = selectedNodeIds.length > 0 ? selectedNodeIds : activeNodeId !== null ? [activeNodeId] : []
      if (targets.length === 0) throw new Error('Select a target node first')
      if (profile.protocol !== 'vless-reality') throw new Error('Only VLESS + Reality supports one-click generation')
      const generated: Record<number, string> = {}
      for (const id of targets) {
        const res = await nodeApi.keygen()
        const keys = res.data.data
        if (!keys) throw new Error('Key generation failed')
        generated[id] = JSON.stringify(
          { private_key: keys.private_key, public_key: keys.public_key, short_ids: generateShortIds(6) },
          null,
          2,
        )
      }
      return generated
    },
    onSuccess: (generated) => {
      Object.entries(generated).forEach(([idStr, settings]) => {
        const id = Number(idStr)
        const cur = draftByNode[id] ?? loadedByNode[id] ?? { settings: '', port: 0 }
        setDraftByNode((prev) => ({ ...prev, [id]: { ...cur, settings } }))
      })
      setMsg(`Generated key drafts for ${Object.keys(generated).length} nodes — remember to save`)
      setMsgType('ok')
    },
    onError: (e: Error) => {
      setMsg(`Generation failed: ${e.message}`)
      setMsgType('err')
    },
  })

  const fillTemplate = () => {
    const targets = selectedNodeIds.length > 0 ? selectedNodeIds : activeNodeId !== null ? [activeNodeId] : []
    if (targets.length === 0) {
      setMsg('Select a target node first')
      setMsgType('err')
      return
    }
    const tpl = stringifySettings(profile.settings)
    targets.forEach((id) => updateDraft(id, { settings: tpl }))
    setMsg(`Filled protocol defaults into ${targets.length} nodes`)
    setMsgType('ok')
  }

  const lockToggle = useMutation({
    mutationFn: (locked: boolean) => {
      if (activeNodeId === null) throw new Error('Select a node first')
      return nodeApi.setKeyLock(activeNodeId, profile.id, locked)
    },
    onSuccess: (_, locked) => {
      setMsg(locked ? 'Profile locked for this node' : 'Lock removed')
      setMsgType('ok')
      qc.invalidateQueries({ queryKey: ['node-keys-overview'] })
    },
    onError: (e: Error) => {
      setMsg(`Action failed: ${e.message}`)
      setMsgType('err')
    },
  })

  const targetsCount = selectedNodeIds.length > 0 ? selectedNodeIds : activeNodeId !== null ? [activeNodeId] : []
  const saveLabel = selectedNodeIds.length > 1 ? `Save all (${selectedNodeIds.length})` : 'Save keys'

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Configure node keys · ${profile.name}`}
      description="Pick one or more target nodes on the left; edit settings and ports on the right. Bulk generate and bulk save are supported."
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Close</Btn>
          <Btn
            loading={batchSave.isPending}
            onClick={() => batchSave.mutate()}
            disabled={targetsCount.length === 0 || (selectedNodeIds.length === 0 && activeLocked)}
          >
            {saveLabel}
          </Btn>
        </>
      }
      width="xl"
    >
      <div className="grid h-full gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        {/* Left: node list */}
        <div className="flex h-full min-h-0 flex-col space-y-3">
          <div>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search node name / IP / region"
              className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-sm text-[var(--text)] placeholder:text-faint focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between text-xs text-soft">
            <span>{filteredNodes.length} total</span>
            <button
              type="button"
              onClick={() => {
                const allVis = filteredNodes.every((n) => selectedNodeIds.includes(n.id))
                setSelectedNodeIds(allVis ? selectedNodeIds.filter((id) => !filteredNodes.some((n) => n.id === id)) : Array.from(new Set([...selectedNodeIds, ...filteredNodes.map((n) => n.id)])))
              }}
              className="text-[var(--accent)] hover:underline"
            >
              {filteredNodes.every((n) => selectedNodeIds.includes(n.id)) && filteredNodes.length > 0 ? 'Clear selection' : 'Select all visible'}
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {filteredNodes.map((n) => {
              const k = keysByNode?.[n.id]
              const isActive = activeNodeId === n.id
              const isSelected = selectedNodeIds.includes(n.id)
              const isDirty = dirtyNodeIds.includes(n.id)
              return (
                <div
                  key={n.id}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition ${
                    isActive ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)]' : 'border-[var(--border)] bg-[var(--panel-strong)] hover:bg-[var(--panel-muted)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleNodeSelect(n.id)}
                    className="h-4 w-4 shrink-0 rounded border-[var(--border-strong)]"
                    aria-label={`Select ${n.name}`}
                  />
                  <button type="button" onClick={() => setActiveNodeId(n.id)} className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{n.name}</span>
                      {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" title="Unsaved" />}
                    </span>
                    <span className="flex min-w-0 items-center gap-1 text-xs text-soft">
                      <span className="min-w-0 flex-1 truncate">{n.ip}</span>
                      {k && (
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="text-faint">·</span>
                          <span>{k.port >0 ? `Port ${k.port}` : `Default`}</span>
                          {k.locked && <Lock className="h-3.5 w-3.5 text-[var(--warning)]" aria-label="Locked" />}
                        </span>
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
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          {activeNodeId === null && selectedNodeIds.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-soft">Pick a node on the left (click to edit, checkbox for bulk actions)</div>
          )}

          {(activeNodeId !== null || selectedNodeIds.length > 0) && (
            <>
              <FieldGroup
                title={selectedNodeIds.length > 1 ? `Bulk target · ${selectedNodeIds.length} nodes` : `Current node · ${sortedNodes.find((n) => n.id === activeNodeId)?.name ?? ''}`}
                description={selectedNodeIds.length > 1 ? 'Bulk actions apply to every checked node. Fill and generate write drafts; nothing is committed until you save.' : `Protocol default port ${profile.port} (${profile.protocol === 'hysteria2' ? 'UDP' : 'TCP'}). Leave blank or enter 0 to inherit it.`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {profile.protocol === 'vless-reality' && (
                    <Btn
                      variant="secondary"
                      loading={batchKeygen.isPending}
                      onClick={() => batchKeygen.mutate()}
                      disabled={targetsCount.length === 0 || (selectedNodeIds.length === 0 && activeLocked)}
                    >
                      <Sparkles className="h-4 w-4" />
                      {selectedNodeIds.length > 1 ? `Generate all (${selectedNodeIds.length})` : 'One-click generate'}
                    </Btn>
                  )}
                  <Btn variant="secondary" onClick={fillTemplate} disabled={targetsCount.length === 0 || (selectedNodeIds.length === 0 && activeLocked)}>Fill template</Btn>
                  {selectedNodeIds.length === 0 && activeKey && (
                    <Btn
                      variant="secondary"
                      loading={lockToggle.isPending}
                      onClick={() => lockToggle.mutate(!activeLocked)}
                    >
                      {activeLocked ? 'Unlock' : 'Lock profile'}
                    </Btn>
                  )}
                </div>
              </FieldGroup>

              {selectedNodeIds.length === 0 && activeDraft && (
                <FieldGroup title="Settings and port" description="Saving an empty object `{}` inherits the protocol defaults; port 0 inherits the template port.">
                  <Field
                    label={`Listen port (blank to inherit ${profile.port})`}
                    value={String(activeDraft.port || '')}
                    onChange={(e) => updateDraft(activeNodeId!, { port: Number(e.target.value) || 0 })}
                    placeholder={`${profile.port}`}
                    type="number"
                  />
                  <textarea
                    value={activeDraft.settings}
                    onChange={(e) => updateDraft(activeNodeId!, { settings: e.target.value })}
                    rows={12}
                    disabled={activeLocked}
                    className="min-h-[240px] w-full rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 font-mono text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-ring)]"
                    placeholder='{"private_key": "...", "public_key": "...", "short_ids": ["..."]}'
                  />
                  {activeLocked && <p className="text-xs text-[var(--warning)]">This profile is locked for the node — unlock it to edit, delete or regenerate keys.</p>}
                </FieldGroup>
              )}

              {selectedNodeIds.length > 1 && (
                <FieldGroup title="Bulk draft preview" description="Every node keeps its own draft. The buttons above write into all selected nodes.">
                  <div className="space-y-2">
                    {selectedNodeIds.map((id) => {
                      const node = sortedNodes.find((n) => n.id === id)
                      const draft = draftByNode[id] ?? loadedByNode[id]
                      const hasDraft = !!draftByNode[id]
                      return (
                        <div key={id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2 text-xs">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{node?.name ?? `#${id}`}</span>
                            <span className="text-soft">{node?.ip}</span>
                          </div>
                          <div className="flex items-center gap-2 text-soft">
                            {draft ? (
                              <>
                                <span>{draft.port > 0 ? `Port ${draft.port}` : 'Default port'}</span>
                                <span>{draft.settings ? `${draft.settings.length} chars` : 'Empty'}</span>
                                {hasDraft && <Badge label="Unsaved" variant="yellow" />}
                              </>
                            ) : (
                              <span className="text-faint">Not loaded</span>
                            )}
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

export default function Profiles() {
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [drawer, setDrawer] = useState<{ open: boolean; profile?: InboundProfile }>({ open: false })
  const [keyDrawer, setKeyDrawer] = useState<InboundProfile | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [initialForm, setInitialForm] = useState<FormState>(emptyForm())
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [protocolFilter, setProtocolFilter] = useState<'all' | Protocol>('all')
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const generateProtocolDefaults = useMutation({
    mutationFn: async () => {
      const res = await nodeApi.keygen()
      const keys = res.data.data
      if (!keys) throw new Error('Key generation failed')
      return JSON.stringify(
        {
          sni: 'www.microsoft.com',
          fingerprint: 'chrome',
          private_key: keys.private_key,
          public_key: keys.public_key,
          short_ids: generateShortIds(6),
        },
        null,
        2,
      )
    },
    onSuccess: (settings) => {
      setForm((prev) => ({ ...prev, settings }))
      setErr('')
    },
    onError: (e: Error) => setErr(e.message),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['profiles', page, pageSize],
    queryFn: () => profileApi.list({ page, page_size: pageSize }).then((r) => r.data.data!),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['profiles'] })

  const parseSettings = (s: string) => {
    try {
      return JSON.parse(s)
    } catch {
      return s
    }
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        protocol: form.protocol,
        port: Number(form.port) || 443,
        settings: parseSettings(form.settings),
        active: form.active,
        remark: form.remark,
      }
      return drawer.profile ? profileApi.update(drawer.profile.id, payload) : profileApi.create(payload)
    },
    onSuccess: () => {
      invalidate()
      closeDrawer()
    },
    onError: (e: Error) => setErr(e.message),
  })

  const remove = useMutation({ mutationFn: (id: number) => profileApi.remove(id), onSuccess: invalidate })
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => profileApi.update(id, { active }),
    onSuccess: invalidate,
  })

  const openCreate = () => {
    const next = emptyForm()
    setForm(next)
    setInitialForm(next)
    setErr('')
    setDrawer({ open: true })
  }

  const openEdit = (p: InboundProfile) => {
    const next = {
      name: p.name,
      protocol: p.protocol,
      port: String(p.port),
      settings: p.settings ? (typeof p.settings === 'string' ? p.settings : JSON.stringify(p.settings, null, 2)) : '',
      active: p.active,
      remark: p.remark,
    }
    setForm(next)
    setInitialForm(next)
    setErr('')
    setDrawer({ open: true, profile: p })
  }

  const closeDrawer = () => setDrawer({ open: false })
  const confirmCloseDrawer = async () => {
    if (!dirty) return true
    return confirm({
      title: 'Discard unsaved profile changes?',
      description: 'Changes to the profile settings and port are unsaved and will be lost.',
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
      tone: 'danger',
    })
  }

  const handleProtocolChange = (v: string) => {
    const proto = v as Protocol
    setForm((p) => ({
      ...p,
      protocol: v,
      // Follow the protocol switch only while the name is still auto-filled (blank or equal to the previous label); keep a custom name
      name: p.name === '' || p.name === protocolLabel(p.protocol) ? protocolLabel(proto) : p.name,
      settings: defaultSettings[proto] ?? '',
      port: defaultPort[proto] ?? '443',
    }))
  }

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

  const filteredProfiles = (data?.list ?? []).filter((p) => {
    const keyword = search.trim().toLowerCase()
    const matchesKeyword = keyword === '' || p.name.toLowerCase().includes(keyword) || p.protocol.toLowerCase().includes(keyword)
    const matchesProtocol = protocolFilter === 'all' || p.protocol === protocolFilter
    return matchesKeyword && matchesProtocol
  })
  const allVisibleSelected = filteredProfiles.length > 0 && filteredProfiles.every((p) => selectedIds.includes(p.id))
  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm) && drawer.open

  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))

  const toggleSelectVisible = () =>
    setSelectedIds((prev) => {
      if (allVisibleSelected) return prev.filter((id) => !filteredProfiles.some((p) => p.id === id))
      return Array.from(new Set([...prev, ...filteredProfiles.map((p) => p.id)]))
    })

  const selectedProfiles = filteredProfiles.filter((p) => selectedIds.includes(p.id))

  const columns = [
    {
      key: 'select',
      label: (
        <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectVisible} aria-label="Select profiles on this page" className="h-4 w-4 rounded border-[var(--border-strong)]" />
      ) as unknown as string,
      render: (p: InboundProfile) => (
        <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => toggleSelect(p.id)} aria-label={`Select profile ${p.name}`} className="h-4 w-4 rounded border-[var(--border-strong)]" />
      ),
    },
    {
      key: 'name',
      label: 'Name',
      render: (p: InboundProfile) => (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{p.name}</span>
            <span className="text-xs text-faint">#{p.id}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'meta',
      label: 'Type',
      render: (p: InboundProfile) => (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setKeyDrawer(p)}
            title="Click to configure node keys and ports"
            className="inline-flex rounded-full transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Badge label={protocolLabel(p.protocol)} variant={protocolBadgeVariant(p.protocol)} />
          </button>
          <div className="text-xs text-soft">Listens on {p.port}</div>
        </div>
      ),
    },
    {
      key: 'active',
      label: 'Status',
      render: (p: InboundProfile) => <Switch checked={p.active} onChange={(next) => toggle.mutate({ id: p.id, active: next })} />,
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (p: InboundProfile) => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => openEdit(p)}
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-xs font-semibold text-soft transition hover:bg-[var(--panel-muted)] hover:text-[var(--text)]"
          >
            <PencilLine className="h-3.5 w-3.5" />Edit</button>
          <button
            onClick={() => setKeyDrawer(p)}
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-xs font-semibold text-soft transition hover:bg-[var(--panel-muted)] hover:text-[var(--text)]"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Keys / lock
          </button>
          <ActionMenu
            items={[
              {
                label: 'Delete profile',
                danger: true,
                onSelect: async () => {
                  const ok = await confirm({
                    title: `Delete profile "${p.name}"?`,
                    description: 'The template and every node reference to it will stop working.',
                    confirmText: 'Delete profile',
                    cancelText: 'Cancel',
                    tone: 'danger',
                  })
                  if (ok) remove.mutate(p.id)
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
            <Plus className="h-4 w-4" />New profile</Btn>
        }
        searchValue={search}
        searchPlaceholder="Search profile name or protocol type"
        onSearchChange={setSearch}
        filters={
          <>
            <FilterChip active={protocolFilter === 'all'} onClick={() => setProtocolFilter('all')}>All</FilterChip>
            {protocolOptions.map((option) => (
              <FilterChip key={option.value} active={protocolFilter === option.value} onClick={() => setProtocolFilter(option.value as Protocol)}>
                {option.label}
              </FilterChip>
            ))}
          </>
        }
        bulkBar={
          selectedProfiles.length > 0 ? (
            <BulkBar>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-soft">Selected<span className="font-semibold text-[var(--text)]">{selectedProfiles.length}</span> profiles</div>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    variant="danger"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete ${selectedProfiles.length} selected profiles?`,
                        description: 'Bulk delete also affects the protocol delivery config of the linked nodes.',
                        confirmText: 'Bulk delete',
                        cancelText: 'Cancel',
                        tone: 'danger',
                      })
                      if (!ok) return
                      await Promise.all(selectedProfiles.map((p) => profileApi.remove(p.id)))
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
          <Table columns={columns} data={filteredProfiles} loading={isLoading} />
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
            <div className="text-sm font-semibold">About profiles</div>
            <p className="mt-2 text-sm leading-6 text-soft">Profiles define the template; node keys fill in what makes each machine different. Keeping the two layers apart makes complex Reality or TLS setups far easier to maintain.</p>
          </div>
          <div className="space-y-3">
            <div className="border-t border-[var(--border)] pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Template</div>
              <div className="mt-2 text-sm font-semibold">Manage protocol templates</div>
              <p className="mt-2 text-xs leading-5 text-soft">Keep shared settings such as ports, SNI and transport parameters in one place so they are not retyped per node.</p>
            </div>
            <div className="border-t border-[var(--border)] pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">Node Keys</div>
              <div className="mt-2 text-sm font-semibold">Configure node keys separately</div>
              <p className="mt-2 text-xs leading-5 text-soft">Node-specific keys live in their own drawer, so sensitive values stay out of the big form.</p>
            </div>
          </div>
        </SurfaceCard>
      </div>

      <Drawer
        open={drawer.open}
        onClose={closeDrawer}
        title={drawer.profile ? `Edit profile · ${drawer.profile.name}` : 'New profile'}
        description="The list stays visible on the left while the right side focuses on parameters, ports and notes."
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
          <FieldGroup title="Protocol definition" description="Pick a protocol type first, then fill in the port and parameters from the template.">
            <Field label="Profile name *" value={form.name} onChange={f('name')} placeholder="e.g. Reality primary" />
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="Protocol type *" value={form.protocol} onChange={handleProtocolChange} options={protocolOptions} />
              <Field label="Listen port *" value={form.port} onChange={f('port')} type="number" />
            </div>
          </FieldGroup>

          <FieldGroup title="Protocol settings" description="Keep the JSON formatted while editing. Switching protocols refills the default template.">
            {form.protocol === 'vless-reality' && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-soft">These defaults generate a ready-to-use Reality config for every node without an override.</p>
                <Btn variant="secondary" loading={generateProtocolDefaults.isPending} onClick={() => generateProtocolDefaults.mutate()}>
                  <Sparkles className="h-4 w-4" />One-click generate</Btn>
              </div>
            )}
            <textarea
              value={form.settings}
              onChange={(e) => setForm((p) => ({ ...p, settings: e.target.value }))}
              rows={12}
              className="min-h-[280px] w-full rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 font-mono text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-ring)]"
            />
          </FieldGroup>

          <FieldGroup title="Extra info">
            <Field label="Notes" value={form.remark} onChange={f('remark')} placeholder="Purpose, matching nodes or any special notes" />
          </FieldGroup>

          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        </div>
      </Drawer>

      {keyDrawer && <NodeKeyDrawer profile={keyDrawer} onClose={() => setKeyDrawer(null)} />}
    </PageShell>
  )
}
