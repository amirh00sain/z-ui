import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, HardDriveDownload, Trash2 } from 'lucide-react'
import { backupApi } from '@/lib/api'
import type { BackupFile } from '@/lib/api'
import { Btn, Field } from '@/components/ui/Form'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { pushToast } from '@/lib/notify'
import { formatBytes } from '@/lib/utils'
import { Section } from './shared'
import { useSettingsForm } from './context'

// Backups: interval / directory / retention (saved with the shared form) plus on-demand backups and the snapshot list (immediate actions)
export default function BackupSection() {
  const { form, f } = useSettingsForm()
  const qc = useQueryClient()
  const confirm = useConfirm()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['system-backups'],
    queryFn: () => backupApi.list().then((r) => r.data.data ?? []),
  })

  const run = useMutation({
    mutationFn: () => backupApi.run(),
    onSuccess: (res) => {
      pushToast({
        title: 'Backup finished',
        description: `${res.data.data?.name ?? ''} · ${formatBytes(res.data.data?.size)}`,
        variant: 'success',
      })
      void qc.invalidateQueries({ queryKey: ['system-backups'] })
    },
    onError: (e: Error) => {
      pushToast({ title: 'Backup failed', description: e.message, variant: 'warning' })
    },
  })

  const remove = useMutation({
    mutationFn: (name: string) => backupApi.remove(name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['system-backups'] }),
  })

  const backups = data ?? []

  return (
    <>
      <Section title="Backup policy" description="SQLite VACUUM INTO writes a full snapshot and is safe against a running service. Copy the files off-host yourself to cover total loss.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Auto backup interval (hours, 0 disables)" type="number" value={form['backup.interval_hours'] ?? '24'} onChange={f('backup.interval_hours')} />
          <Field label="Backup directory (relative to the working directory or absolute)" value={form['backup.dir'] ?? 'data/backup'} onChange={f('backup.dir')} placeholder="data/backup" />
          <Field label="Retention in days (older files are removed)" type="number" value={form['backup.retention_days'] ?? '30'} onChange={f('backup.retention_days')} />
        </div>
        <p className="text-xs text-soft">Carry the MasterKey over when restoring to a new machine, otherwise the encrypted Reality private keys and certificates cannot be decrypted.</p>
      </Section>

      <Section
        title="Backup files"
        description="Generate a snapshot on demand, or download and delete existing files. Downloads require a JWT; large files may take a while."
        actions={
          <>
            <Btn variant="ghost" onClick={() => void refetch()}>Refresh</Btn>
            <Btn variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>Back up now</Btn>
          </>
        }
      >
        <div className="border-t border-[var(--border)]">
          <div className="flex items-center gap-2 border-b border-[var(--border)] py-3 text-sm font-semibold">
            <HardDriveDownload className="h-4 w-4 text-[var(--accent)]" />Snapshots<span className="text-faint"> ({backups.length})</span>
          </div>
          {isLoading ? (
            <div className="py-6 text-sm text-soft">Loading…</div>
          ) : backups.length === 0 ? (
            <div className="py-6 text-sm text-soft">No backups yet. Press Back up now to create the first snapshot.</div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {backups.map((b: BackupFile) => (
                <li key={b.name} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[13px]">{b.name}</div>
                    <div className="mt-0.5 text-xs text-soft">
                      {formatBytes(b.size)} · {new Date(b.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Btn
                      variant="ghost"
                      onClick={() => {
                        backupApi.download(b.name).catch((e: Error) => {
                          pushToast({ title: 'Backup download failed', description: e.message, variant: 'error' })
                        })
                      }}
                    >
                      <Download className="h-3.5 w-3.5" />Download</Btn>
                    <Btn
                      variant="ghost"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Delete backup ${b.name}?`,
                          description: 'The file is removed from the backup directory permanently and cannot be recovered.',
                          confirmText: 'Delete',
                          cancelText: 'Cancel',
                          tone: 'danger',
                        })
                        if (ok) remove.mutate(b.name)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />Delete</Btn>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </>
  )
}
