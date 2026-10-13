import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Dices, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { adminApi } from '@/lib/api'
import type { Admin, AdminRole } from '@/types'
import { useAuthStore } from '@/store/auth'
import { Modal } from '@/components/ui/Modal'
import { Btn, Field, SelectField } from '@/components/ui/Form'
import { Badge } from '@/components/ui/Badge'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { HintTip } from '@/components/ui/HintTip'
import { Section } from '@/pages/settings/shared'
import { pushToast } from '@/lib/notify'
import { copyText } from '@/lib/clipboard'
import { generatePassword } from '@/lib/keygen'

const ROLE_OPTIONS: Array<{ value: AdminRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super admin' },
]

const roleLabel = (r: AdminRole) => (r === 'super_admin' ? 'Super admin' : 'Admin')

// Admin list with create / change role / enable-disable / reset password / delete. Super admins only (the Settings page renders by role).
// Guards (last super admin; no delete/disable/role-change/reset on yourself) are enforced by the backend — the UI only greys the action out.
export function AdminManager() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const selfID = useAuthStore((s) => s.username)
  const [createOpen, setCreateOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState<Admin | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admins'],
    queryFn: () => adminApi.list().then((r) => r.data.data ?? []),
  })
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admins'] })

  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: number; role?: AdminRole; active?: boolean }) => adminApi.update(id, patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: number) => adminApi.remove(id),
    onSuccess: () => {
      pushToast({ title: 'Admin removed', variant: 'success' })
      invalidate()
    },
  })

  const admins = data ?? []

  return (
    <Section
      title="Admin accounts"
      description="Administrators who can sign in to the panel. Seeded from the admins section of config.yaml on first boot; after that this list is the source of truth."
      actions={
        <>
          <HintTip content="Super admins can manage every account but may only change their own password. Regular admins have full operational access and can only change their own password. At least one enabled super admin must always remain." />
          <Btn variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />New admin</Btn>
        </>
      }
    >
      <div className="border-t border-[var(--border)]">
        {isLoading ? (
          <div className="py-6 text-sm text-soft">Loading…</div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {admins.map((a) => {
              const isSelf = a.username === selfID
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{a.username}</span>
                        {isSelf && <Badge label="Signed in now" variant="blue" />}
                        {!a.active && <Badge label="Disabled" variant="red" />}
                      </div>
                      <div className="mt-0.5 text-xs text-soft">{a.last_login_at ? `Last sign-in ${new Date(a.last_login_at).toLocaleString('en-US')}` : 'Never signed in'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={a.role}
                      disabled={isSelf || update.isPending}
                      onChange={(e) => update.mutate({ id: a.id, role: e.target.value as AdminRole })}
                      className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
                      title={isSelf ? 'You cannot change your own role' : 'Role'}
                    >
                      {ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <Btn
                      variant="ghost"
                      disabled={isSelf || update.isPending}
                      title={isSelf ? 'You cannot disable yourself' : a.active ? 'Disable' : 'Enable'}
                      onClick={() => update.mutate({ id: a.id, active: !a.active })}
                    >
                      {a.active ? 'Disable' : 'Enable'}
                    </Btn>
                    <Btn
                      variant="ghost"
                      disabled={isSelf}
                      title={isSelf ? 'Change your own password from the avatar menu' : 'Reset password'}
                      onClick={() => setResetTarget(a)}
                    >
                      <KeyRound className="h-4 w-4" />
                    </Btn>
                    <Btn
                      variant="ghost"
                      disabled={isSelf || remove.isPending}
                      title={isSelf ? 'You cannot delete yourself' : 'Delete'}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Delete admin "${a.username}"?`,
                          description: `This account (${roleLabel(a.role)}) will lose access immediately. Historical entries in the activity log are kept.`,
                          confirmText: 'Delete',
                          cancelText: 'Cancel',
                          tone: 'danger',
                        })
                        if (ok) remove.mutate(a.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-[var(--danger)]" />
                    </Btn>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <CreateAdminModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={invalidate} />
      <ResetPasswordModal target={resetTarget} onClose={() => setResetTarget(null)} />
    </Section>
  )
}

function CreateAdminModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AdminRole>('admin')
  // Keep the credentials visible after creation so they can be copied (the password is only available here)
  const [created, setCreated] = useState<{ username: string; password: string; role: AdminRole } | null>(null)

  const reset = () => {
    setUsername('')
    setPassword('')
    setRole('admin')
    setCreated(null)
  }
  const close = () => {
    reset()
    onClose()
  }

  const create = useMutation({
    mutationFn: () => adminApi.create({ username: username.trim(), password, role }),
    onSuccess: () => {
      setCreated({ username: username.trim(), password, role })
      onCreated()
    },
  })
  const canSubmit = username.trim() !== '' && password.length >= 6

  return (
    <Modal
      open={open}
      onClose={close}
      title={created ? 'Admin created' : 'New admin'}
      size="sm"
      footer={
        created ? (
          <Btn onClick={close}>Done</Btn>
        ) : (
          <>
            <Btn variant="secondary" onClick={close}>Cancel</Btn>
            <Btn loading={create.isPending} disabled={!canSubmit} onClick={() => create.mutate()}>Create</Btn>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-4">
          <p className="text-sm text-soft">
            {created.username} ({roleLabel(created.role)}) has been created. The initial password is visible here only — copy it now and hand it over; they can change it themselves after signing in.
          </p>
          <CredentialRow label="Username" value={created.username} />
          <CredentialRow label="Initial password" value={created.password} mono />
          <CopyAllButton text={`Username: ${created.username}\nPassword: ${created.password}`} />
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Initial password (min 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <Btn variant="secondary" className="shrink-0" title="Generate a 16-character random password" onClick={() => setPassword(generatePassword())}>
              <Dices className="h-4 w-4" />Random</Btn>
          </div>
          <SelectField label="Role" value={role} onChange={(v) => setRole(v as AdminRole)} options={ROLE_OPTIONS} />
        </div>
      )}
    </Modal>
  )
}

// One credential row: value plus copy button, which briefly turns into a checkmark on success
function CredentialRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const ok = await copyText(value)
    if (!ok) {
      pushToast({ title: 'Copy failed', description: 'Select the text and copy it manually.', variant: 'warning' })
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
        <div className={mono ? 'truncate font-mono text-sm' : 'truncate text-sm'}>{value}</div>
      </div>
      <Btn variant="ghost" className="shrink-0" title={`Copy ${label}`} onClick={() => void copy()}>
        {copied ? <Check className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4" />}
      </Btn>
    </div>
  )
}

function CopyAllButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Btn
      variant="secondary"
      className="w-full"
      onClick={async () => {
        const ok = await copyText(text)
        if (!ok) {
          pushToast({ title: 'Copy failed', description: 'Select the text and copy it manually.', variant: 'warning' })
          return
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4" />}
      {copied ? 'Copied' : 'Copy username and password'}
    </Btn>
  )
}

function ResetPasswordModal({ target, onClose }: { target: Admin | null; onClose: () => void }) {
  const [password, setPassword] = useState('')
  // Keep the credentials after a successful reset so they can be copied; closing clears them
  const [done, setDone] = useState<{ username: string; password: string } | null>(null)
  const close = () => {
    setPassword('')
    setDone(null)
    onClose()
  }
  const reset = useMutation({
    mutationFn: () => adminApi.setPassword(target!.id, password),
    onSuccess: () => setDone({ username: target!.username, password }),
  })
  return (
    <Modal
      open={target !== null}
      onClose={close}
      title={done ? 'Password reset' : `Reset password · ${target?.username ?? ''}`}
      size="sm"
      footer={
        done ? (
          <Btn onClick={close}>Done</Btn>
        ) : (
          <>
            <Btn variant="secondary" onClick={close}>Cancel</Btn>
            <Btn loading={reset.isPending} disabled={password.length < 6} onClick={() => reset.mutate()}>Reset</Btn>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-soft">The password for {done.username} has been updated. The new password is visible here only — copy it now and hand it over. Their existing sessions stay valid until the token expires.</p>
          <CredentialRow label="Username" value={done.username} />
          <CredentialRow label="New password" value={done.password} mono />
          <CopyAllButton text={`Username: ${done.username}\nPassword: ${done.password}`} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-soft">Super admins can reset a password without the old one.</p>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="New password (min 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <Btn variant="secondary" className="shrink-0" title="Generate a 16-character random password" onClick={() => setPassword(generatePassword())}>
              <Dices className="h-4 w-4" />Random</Btn>
          </div>
        </div>
      )}
    </Modal>
  )
}
