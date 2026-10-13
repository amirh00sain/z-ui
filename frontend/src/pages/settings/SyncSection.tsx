import { Field, SelectField, Switch } from '@/components/ui/Form'
import { Section } from './shared'
import { useSettingsForm } from './context'

const LOG_LEVEL_OPTIONS = [
  { value: 'warning', label: 'warning' },
  { value: 'info', label: 'info' },
  { value: 'debug', label: 'debug' },
  { value: 'error', label: 'error' },
]

// Nodes and sync: default SSH parameters, panel outbound IP, Xray runtime settings, scheduler intervals
export default function SyncSection() {
  const { form, f, set } = useSettingsForm()
  const liveApplyEnabled = (form['xray.live_apply_enabled'] ?? 'true') === 'true'

  return (
    <>
      <Section title="Default SSH parameters" description="Connection parameters used when a node has no override. They affect SSH tests, sync and known_hosts initialisation.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Default port" type="number" value={form['ssh.default_port'] ?? '22'} onChange={f('ssh.default_port')} />
          <Field label="Default user" value={form['ssh.default_user'] ?? 'root'} onChange={f('ssh.default_user')} />
        </div>
        <Field label="Default key path (a service-dedicated path is recommended)" value={form['ssh.default_key_path'] ?? ''} onChange={f('ssh.default_key_path')} placeholder="/etc/xray-pilot/ssh/id_ed25519" />
        <Field label="known_hosts path" value={form['ssh.known_hosts_path'] ?? ''} onChange={f('ssh.known_hosts_path')} placeholder="/var/lib/xray-pilot/known_hosts" />
        <p className="text-xs text-soft">Avoid using `/root/.ssh/*` directly. For a systemd deployment, keep the service-readable key under `/etc/xray-pilot/ssh/`.</p>
      </Section>

      <Section title="Panel outbound IP" description="The IP users must allow in the node firewall during one-click provisioning. Probed hourly; a manual override wins.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Auto-detected value (read-only)" value={form['panel.outbound_ip_auto'] ?? ''} onChange={() => {}} placeholder="Populated about 10 seconds after startup" readOnly />
          <Field label="Manual override (blank uses the auto-detected value)" value={form['panel.outbound_ip_manual'] ?? ''} onChange={f('panel.outbound_ip_manual')} placeholder="Set manually for multi-IP, NAT or container setups" />
        </div>
        <p className="text-xs text-soft">
          Detected through `https://api.ipify.org`; set `XRAY_PILOT_OUTBOUND_PROBE_URL` to switch to a private probe. Behind containers or reverse proxies the automatic value may be the ingress IP, so use the manual override instead.
        </p>
      </Section>

      <Section title="Xray runtime settings" description="How logs are written and how user changes take effect. Applies to every node; log level can be overridden per node.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Access log path (none disables it)" value={form['xray.log_access'] ?? ''} onChange={f('xray.log_access')} placeholder="none" />
          <Field label="Error log path (blank uses stderr)" value={form['xray.log_error'] ?? ''} onChange={f('xray.log_error')} placeholder="/var/log/xray/error.log" />
        </div>
        <SelectField label="Log level" value={form['xray.log_level'] ?? 'warning'} onChange={(v) => set('xray.log_level', v)} options={LOG_LEVEL_OPTIONS} />
        <div className="flex items-start justify-between gap-4 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">Instant via gRPC (no restart when users change)</p>
            <p className="mt-1 text-xs text-soft">With this on, user additions, edits, removals and expiries apply immediately over the xray gRPC API — no restart, and other users stay connected. On failure it falls back to marking drift and syncing with a restart.</p>
          </div>
          <Switch checked={liveApplyEnabled} onChange={(next) => set('xray.live_apply_enabled', next ? 'true' : 'false')} />
        </div>
      </Section>

      <Section title="Scheduler intervals" description="Background task intervals. Restart the service for a new interval to take effect.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Drift check interval (seconds, 0 disables)" type="number" value={form['scheduler.drift_check_interval'] ?? '300'} onChange={f('scheduler.drift_check_interval')} />
          <Field label="Health check interval (seconds, 0 disables)" type="number" value={form['scheduler.health_check_interval'] ?? '120'} onChange={f('scheduler.health_check_interval')} />
          <Field label="Traffic poll interval (seconds, 0 disables)" type="number" value={form['scheduler.traffic_poll_interval'] ?? '300'} onChange={f('scheduler.traffic_poll_interval')} />
          <Field label="Traffic detail retention in days (0 keeps everything; totals are never affected)" type="number" value={form['traffic.sample_retention_days'] ?? '90'} onChange={f('traffic.sample_retention_days')} />
        </div>
        <p className="text-xs text-soft">Expired users are removed on the drift-check interval; when drift detection is disabled it runs every 5 minutes.</p>
      </Section>
    </>
  )
}
