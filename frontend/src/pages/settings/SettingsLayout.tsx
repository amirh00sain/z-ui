import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { systemApi } from '@/lib/api'
import { useSettingsDraft } from '@/store/settingsDraft'
import { Btn } from '@/components/ui/Form'
import { PageShell, SurfaceCard } from '@/components/ui/Page'
import { Badge } from '@/components/ui/Badge'
import { SETTINGS_SECTIONS, type SettingsFormContext, type SettingsMap, type SettingsSectionKey } from './context'

// Settings shell: the section entries live in the sidebar submenu (Layout); this only owns the shared KV form and the bottom save bar.
// Form-based sections (Nodes and sync / Subscription and notifications / Backups) share one form object.
export default function SettingsLayout() {
  const qc = useQueryClient()
  const location = useLocation()
  const setDirty = useSettingsDraft((s) => s.setDirty)
  const setDiscard = useSettingsDraft((s) => s.setDiscard)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemApi.getSettings().then((r) => r.data.data!),
  })

  // draft = null means "not edited": the form shows the server values directly; save and revert both just set draft back to null
  const [draft, setDraft] = useState<SettingsMap | null>(null)
  const [saved, setSaved] = useState(false)
  const base = useMemo<SettingsMap>(() => settings ?? {}, [settings])
  const form = draft ?? base
  const setForm: React.Dispatch<React.SetStateAction<SettingsMap>> = (next) =>
    setDraft((prev) => (typeof next === 'function' ? next(prev ?? base) : next))

  const update = useMutation({
    mutationFn: () => systemApi.updateSettings(form),
    onSuccess: (res) => {
      qc.setQueryData(['system-settings'], res.data.data)
      void qc.invalidateQueries({ queryKey: ['system-diagnostics'] })
      void qc.invalidateQueries({ queryKey: ['system-feishu-status'] })
      setDraft(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(base)

  // Hand the dirty flag and discard action to the sidebar so it can intercept before switching sections; cleared when leaving settings
  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])
  useEffect(() => {
    setDiscard(() => setDraft(null))
    return () => {
      setDiscard(() => {})
      setDirty(false)
    }
  }, [setDiscard, setDirty])

  const currentKey = (location.pathname.split('/')[2] || 'status') as SettingsSectionKey
  const current = SETTINGS_SECTIONS.find((s) => s.key === currentKey) ?? SETTINGS_SECTIONS[0]

  const ctx: SettingsFormContext = {
    form,
    setForm,
    f: (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value })),
    set: (key, value) => setForm((p) => ({ ...p, [key]: value })),
  }

  if (isLoading) return <div className="p-6 text-soft">Loading…</div>

  return (
    <PageShell>
      <h1 className="sr-only">Settings · {current.label}</h1>
      <div className="space-y-6">
        <Outlet context={ctx} />

        {current.form && (
          <SurfaceCard className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 text-sm text-soft">
              <Badge label={saved ? 'Saved' : dirty ? 'Pending save' : 'Unchanged'} variant={saved ? 'green' : dirty ? 'yellow' : 'gray'} />
              <span>
                {saved ? 'The latest update was written to the system settings.' : dirty ? 'You have unsaved changes — save them before switching sections.' : 'There are no new configuration changes.'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Btn variant="secondary" disabled={!dirty || update.isPending} onClick={() => setDraft(null)}>Revert</Btn>
              <Btn loading={update.isPending} disabled={!dirty} onClick={() => update.mutate()}>Save settings</Btn>
            </div>
          </SurfaceCard>
        )}
      </div>
    </PageShell>
  )
}
