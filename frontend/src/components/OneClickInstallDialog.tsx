import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeftRight, Copy, PencilLine, Sparkles, Terminal } from 'lucide-react'
import { installApi, nodeApi, type InstallToken } from '@/lib/api'
import type { Node } from '@/types'
import { copyText } from '@/lib/clipboard'
import { Modal } from '@/components/ui/Modal'
import { Field, Btn, FieldGroup, SelectField } from '@/components/ui/Form'
import { pushToast } from '@/lib/notify'

type Step = 'mode' | 'ip' | 'form' | 'waiting' | 'success' | 'expired'

interface Props {
  open: boolean
  onClose: () => void
  // The parent refreshes the node list after a successful registration
  onRegistered?: (nodeId: number) => void
  // Replace-server mode: give this existing node a new machine (groups, protocol keys and overrides are all kept).
  // Omit it for regular one-click provisioning (creates a new node).
  replaceNode?: Node | null
}

const TTL_OPTIONS = [
  { value: '600', label: '10 minutes (default)' },
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '24 hours' },
]

// OneClickInstallDialog — one-click node provisioning dialog
// Flow: fill the form → backend issues a token → show the curl command with polling → node reports back to the panel → close
export function OneClickInstallDialog({ open, onClose, onRegistered, replaceNode }: Props) {
  const isReplace = !!replaceNode
  const [step, setStep] = useState<Step>('form')
  const [submitting, setSubmitting] = useState(false)
  const [token, setToken] = useState<InstallToken | null>(null)
  const [copied, setCopied] = useState(false)
  const successFiredRef = useRef(false)

  const [form, setForm] = useState({
    name: '',
    region: '',
    owner: '',
    remark: '',
    ssh_user: 'root',
    ssh_port: '22',
    ttl_seconds: '600',
  })
  const [newIP, setNewIP] = useState('')
  const [err, setErr] = useState('')

  // Reset: every time the dialog opens it returns to the first step (replace mode picks a method first, normal mode goes straight to the form)
  useEffect(() => {
    if (open) {
      setStep(replaceNode ? 'mode' : 'form')
      setToken(null)
      setCopied(false)
      setErr('')
      setNewIP('')
      successFiredRef.current = false
      if (replaceNode) {
        // SSH parameters prefill from the existing node as editable defaults
        setForm((p) => ({
          ...p,
          ssh_user: replaceNode.ssh_user || 'root',
          ssh_port: String(replaceNode.ssh_port || 22),
        }))
      }
    }
  }, [open, replaceNode])

  // Countdown display
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (step !== 'waiting') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [step])

  // Poll the token status (only while waiting)
  useQuery({
    queryKey: ['install-token-poll', token?.token],
    queryFn: async () => {
      if (!token) return null
      const r = await installApi.get(token.token)
      const latest = r.data.data!
      // Success
      if (latest.used && latest.node_id) {
        if (!successFiredRef.current) {
          successFiredRef.current = true
          setToken(latest) // keep fields such as reachable for the success state
          setStep('success')
          // Close automatically 3 seconds after a successful probe; if it fails, leave it open a bit longer
          const closeDelay = latest.reachable === false ? 7000 : 3000
          window.setTimeout(() => {
            onRegistered?.(latest.node_id!)
            onClose()
          }, closeDelay)
        }
      }
      return latest
    },
    enabled: open && step === 'waiting' && !!token,
    refetchInterval: 2000,
    // 404 / 410 mean the token was cleaned up or expired: let the countdown branch handle it
    retry: false,
  })

  // Token expiry detection while polling
  useEffect(() => {
    if (step !== 'waiting' || !token) return
    if (new Date(token.expires_at).getTime() <= now) {
      setStep('expired')
    }
  }, [step, token, now])

  const handleCreate = async () => {
    setErr('')
    if (!isReplace && !form.name.trim()) {
      setErr('Node name cannot be empty')
      return
    }
    setSubmitting(true)
    try {
      const res = await installApi.create({
        name: isReplace ? undefined : form.name.trim(),
        region: isReplace ? undefined : form.region.trim() || undefined,
        owner: isReplace ? undefined : form.owner.trim() || undefined,
        remark: isReplace ? undefined : form.remark.trim() || undefined,
        replace_node_id: replaceNode?.id,
        ssh_user: form.ssh_user.trim() || 'root',
        ssh_port: Number(form.ssh_port) || 22,
        ttl_seconds: Number(form.ttl_seconds) || 600,
        panel_url: window.location.origin,
      })
      setToken(res.data.data!)
      setStep('waiting')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // IP change only: update the node record directly (the backend clears the old known_hosts entry and marks it pending sync)
  const handleUpdateIP = async () => {
    if (!replaceNode) return
    setErr('')
    const ip = newIP.trim()
    if (!ip) {
      setErr('New IP cannot be empty')
      return
    }
    if (ip === replaceNode.ip) {
      setErr('The new IP is the same as the current one')
      return
    }
    setSubmitting(true)
    try {
      await nodeApi.update(replaceNode.id, { ip })
      pushToast({
        title: 'IP updated',
        description: replaceNode.domain
          ? `Point the DNS record for ${replaceNode.domain} to ${ip}, then press Sync in the node list to push the config.`
          : 'The node is marked pending sync. Press Sync in the node list to push the config.',
        variant: 'success',
      })
      onRegistered?.(replaceNode.id)
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopyCommand = async () => {
    if (!token?.curl_command) return
    const ok = await copyText(token.curl_command)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else {
      pushToast({
        title: 'Copy failed',
        description: 'Select the command and press Ctrl+C to copy',
        variant: 'warning',
      })
    }
  }

  const handleRegenerate = () => {
    setStep('form')
    setToken(null)
    setErr('')
  }

  const handleCancel = () => {
    // Close the dialog; unused tokens are cleaned up by the scheduled job or expire when regenerated
    onClose()
  }

  const remainingSec = token
    ? Math.max(0, Math.floor((new Date(token.expires_at).getTime() - now) / 1000))
    : 0
  const remainingLabel = remainingSec > 0
    ? `${Math.floor(remainingSec / 60).toString().padStart(2, '0')}:${(remainingSec % 60).toString().padStart(2, '0')}`
    : '00:00'

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={isReplace ? `Replace server · ${replaceNode!.name}` : 'One-click provision'}
      size="lg"
      footer={
        step === 'mode' ? (
          <Btn variant="secondary" onClick={handleCancel}>Cancel</Btn>
        ) : step === 'ip' ? (
          <>
            <Btn variant="secondary" onClick={() => { setStep('mode'); setErr('') }}>Back</Btn>
            <Btn loading={submitting} onClick={handleUpdateIP}>Save new IP</Btn>
          </>
        ) : step === 'form' ? (
          <>
            {isReplace ? (
              <Btn variant="secondary" onClick={() => { setStep('mode'); setErr('') }}>Back</Btn>
            ) : (
              <Btn variant="secondary" onClick={handleCancel}>Cancel</Btn>
            )}
            <Btn loading={submitting} onClick={handleCreate}>
              <Sparkles className="h-4 w-4" />Generate provisioning command</Btn>
          </>
        ) : step === 'waiting' ? (
          <>
            <Btn variant="secondary" onClick={handleCancel}>Close</Btn>
            <span className="text-xs text-soft">Run the command on the target machine — this dialog closes once the node registers back</span>
          </>
        ) : step === 'expired' ? (
          <>
            <Btn variant="secondary" onClick={handleCancel}>Close</Btn>
            <Btn onClick={handleRegenerate}>Regenerate</Btn>
          </>
        ) : (
          <Btn variant="secondary" onClick={handleCancel}>Close</Btn>
        )
      }
    >
      {step === 'mode' && replaceNode && (
        <div className="space-y-4">
          <p className="text-xs text-soft">Current node IP<code className="rounded bg-[var(--panel-strong)] px-1 font-mono">{replaceNode.ip}</code>
            {replaceNode.domain && <>, domain <code className="rounded bg-[var(--panel-strong)] px-1 font-mono">{replaceNode.domain}</code></>}.
            Both replacement options keep the node's groups, protocol keys and port/SNI overrides, so client subscriptions do not need to change.
          </p>
          <button
            type="button"
            onClick={() => { setStep('ip'); setErr('') }}
            className="flex w-full items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-muted)] p-4 text-left transition hover:border-[var(--accent)]"
          >
            <PencilLine className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
            <span>
              <span className="block text-sm font-semibold">IP change only</span>
              <span className="mt-1 block text-xs text-soft">The server itself is unchanged (for example after moving an elastic IP). Just update the node IP and mark it pending sync{replaceNode.domain ? ', and update the DNS record manually' : ''}.</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setStep('form'); setErr('') }}
            className="flex w-full items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-muted)] p-4 text-left transition hover:border-[var(--accent)]"
          >
            <ArrowLeftRight className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
            <span>
              <span className="block text-sm font-semibold">Replace server (re-provision)</span>
              <span className="mt-1 block text-xs text-soft">You have a new machine. Generate a one-time command and run it there: it installs xray, writes the panel public key, registers this node and syncs the config automatically.</span>
            </span>
          </button>
        </div>
      )}

      {step === 'ip' && replaceNode && (
        <div className="space-y-4">
          <Field label="Current IP" value={replaceNode.ip} disabled readOnly />
          <Field label="New IP *" value={newIP} onChange={(e) => setNewIP(e.target.value)} placeholder="e.g. 34.21.157.200" />
          {replaceNode.domain && (
            <p className="text-xs text-[var(--warning)]">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />This node uses the domain<code className="mx-1 rounded bg-[var(--panel-strong)] px-1 font-mono">{replaceNode.domain}</code>,
              after saving, point the DNS record at the new IP manually so client subscriptions keep working.</p>
          )}
          <p className="text-xs text-soft">After saving the node becomes pending sync — press Sync in the node list to push the config to the new IP.</p>
          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        </div>
      )}

      {step === 'form' && (
        <div className="space-y-4">
          {isReplace ? (
            <p className="text-xs text-soft">On <span className="font-semibold">the new machine</span>, run the generated command: the script installs xray, writes the panel public key, registers node
              "{replaceNode!.name}" and pushes the existing config (the Reality key is unchanged, and the node ID and subscription stay the same).</p>
          ) : (
            <p className="text-xs text-soft">Enter the node metadata. The backend issues a one-time token (10 minutes by default, bound to the first IP that uses it) and returns a complete curl command to run on the target machine.
              The script pulls the panel public key, installs xray and fills the node details back in.</p>
          )}
          {!isReplace && (
            <FieldGroup title="Node metadata" description="The script uses these values to create the node record.">
              <Field label="Node name *" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. tw03-lk" />
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Region" value={form.region} onChange={(e) => setForm((p) => ({ ...p, region: e.target.value }))} placeholder="e.g. Taipei" />
                <Field label="Owner" value={form.owner} onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))} placeholder="e.g. Provider A" />
              </div>
              <Field label="Notes" value={form.remark} onChange={(e) => setForm((p) => ({ ...p, remark: e.target.value }))} />
            </FieldGroup>
          )}

          <FieldGroup title="SSH parameters" description={isReplace ? 'SSH user and port for the new machine. The script writes the panel public key into that user\'s authorized_keys.' : 'The script writes the panel\'s own SSH public key into that user\'s authorized_keys.'}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="SSH user" value={form.ssh_user} onChange={(e) => setForm((p) => ({ ...p, ssh_user: e.target.value }))} />
              <Field label="SSH port" type="number" value={form.ssh_port} onChange={(e) => setForm((p) => ({ ...p, ssh_port: e.target.value }))} />
            </div>
          </FieldGroup>

          <FieldGroup title="Token lifetime">
            <SelectField
              label="Expires in"
              value={form.ttl_seconds}
              onChange={(v) => setForm((p) => ({ ...p, ttl_seconds: v }))}
              options={TTL_OPTIONS}
            />
          </FieldGroup>

          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
        </div>
      )}

      {step === 'waiting' && token && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-muted)] p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">Waiting for the node…</span>
              <span className="font-mono text-soft">{remainingLabel} left</span>
            </div>
            <p className="mt-2 text-xs text-soft">Run the line below as root on {isReplace ? 'the new machine' : 'the target machine'} (if you are a regular user, first run<code className="rounded bg-[var(--panel-strong)] px-1 font-mono">sudo su -</code> to switch). Once the script finishes its self-check it registers back with the panel, and this dialog closes and refreshes the node list.</p>
            <p className="mt-2 text-xs text-[var(--warning)]">
              ⚠️ Also make sure the node firewall lets the panel{token.panel_outbound_ip ? (
                <> IP <code className="mx-1 rounded bg-[var(--panel-strong)] px-1 font-mono text-[var(--warning)]">{token.panel_outbound_ip}</code></>
              ) : ' outbound IP'} reach it over SSH (a block at any layer — cloud security group, ufw, firewalld or iptables — makes every later sync fail)
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--code-bg)] p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-soft">
              <span className="inline-flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5" />Run on the target machine</span>
              <button
                type="button"
                onClick={handleCopyCommand}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white shadow-sm transition ${
                  copied
                    ? 'bg-[var(--success)]'
                    : 'bg-[var(--accent)] hover:brightness-110'
                }`}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied' : 'Copy command'}
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-[var(--code-text)]">
              {token.curl_command}
            </pre>
          </div>

          {token.used_by_ip && (
            <p className="text-xs text-soft">Bound to source IP: <span className="font-mono">{token.used_by_ip}</span> (rejected if run from another address)</p>
          )}
        </div>
      )}

      {step === 'success' && token && (
        <div className="space-y-3 py-6 text-center">
          <Sparkles className="mx-auto h-10 w-10 text-[var(--success)]" />
          <p className="text-base font-semibold">{isReplace ? 'New machine registered — server replacement complete' : 'Node registered successfully'}</p>
          {token.reachable === true && (
            <p className="text-xs text-[var(--success)]">
              ✅ The panel can reach the node over SSH{typeof token.reachable_latency_ms === 'number' && token.reachable_latency_ms > 0
                ? ` (latency ${token.reachable_latency_ms} ms)`
                : ''}
              {isReplace && ', config sync started automatically'}
            </p>
          )}
          {isReplace && replaceNode?.domain && (
            <p className="text-xs text-[var(--warning)]">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />Point the domain<code className="mx-1 rounded bg-[var(--panel-strong)] px-1 font-mono">{replaceNode.domain}</code> at the new IP</p>
          )}
          {token.reachable === false && (
            <div className="mx-auto max-w-md space-y-2 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3 text-left">
              <p className="text-xs font-semibold text-[var(--warning)]"><AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />The panel cannot reach the node over SSH yet</p>
              <p className="text-xs text-[var(--warning)]">
                {token.reachable_message || 'SSH port probe failed — the firewall may be blocking it.'}
              </p>
              <p className="text-[11px] text-soft">Once allowed, press Sync in the node list to apply the config.</p>
            </div>
          )}
          <p className="text-xs text-soft">Refreshing the node list, closing shortly…</p>
        </div>
      )}

      {step === 'expired' && (
        <div className="space-y-3 py-6 text-center">
          <p className="text-base font-semibold text-[var(--warning)]">Token expired</p>
          <p className="text-xs text-soft">If the script has not finished, generate a new token. Nodes that already succeeded are kept.</p>
        </div>
      )}
    </Modal>
  )
}

// PrecheckHook is called by the parent before opening the dialog to confirm the panel has an SSH key configured.
// The backend validates again on install create — this only warns early so admins do not fill in the whole form first.
export function notifyPanelSSHMissing(message: string) {
  pushToast({
    title: 'One-click provisioning unavailable',
    description: message,
    variant: 'warning',
  })
}
