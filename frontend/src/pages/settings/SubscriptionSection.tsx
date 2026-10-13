import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { systemApi } from '@/lib/api'
import { Btn, Field, Switch } from '@/components/ui/Form'
import { Badge } from '@/components/ui/Badge'
import { pushToast } from '@/lib/notify'
import { SecretField, Section } from './shared'
import { useSettingsForm } from './context'

// Subscription and notifications: subscription base URL / remark template plus the Feishu bot
export default function SubscriptionSection() {
  const { form, f, set } = useSettingsForm()
  const [secretVisibility, setSecretVisibility] = useState<Record<string, boolean>>({})
  const toggleSecretVisibility = (key: string) => setSecretVisibility((prev) => ({ ...prev, [key]: !prev[key] }))

  const { data: feishuStatus, refetch: refetchFeishuStatus, isFetching: feishuStatusLoading } = useQuery({
    queryKey: ['system-feishu-status'],
    queryFn: () => systemApi.getFeishuStatus().then((r) => r.data.data!),
  })

  const testFeishu = useMutation({
    mutationFn: () => systemApi.testFeishuConfig(),
    onSuccess: (res) => {
      const status = res.data.data
      pushToast({
        title: 'Feishu configuration check passed',
        description: status?.webhook_url ? `Webhook URL: ${status.webhook_url}` : 'Feishu base configuration is ready.',
        variant: 'success',
      })
      void refetchFeishuStatus()
    },
    onError: (e: Error) => {
      pushToast({ title: 'Feishu configuration check failed', description: e.message, variant: 'warning' })
      void refetchFeishuStatus()
    },
  })

  const feishuEnabled = (form['feishu.enabled'] ?? 'false') === 'true'

  return (
    <>
      <Section title="Subscription settings" description="Set the public URL and remark template explicitly so subscription links never depend on reverse-proxy inference.">
        <Field
          label="Subscription base URL (blank to derive it from the request host)"
          value={form['subscription.base_url'] ?? ''}
          onChange={f('subscription.base_url')}
          placeholder="https://your-domain.com"
        />
        <p className="text-xs text-soft">When the service runs behind Nginx, a CDN or an HTTPS reverse proxy, set the public URL explicitly.</p>
        <div>
          <Field
            label="Node remark format"
            value={form['subscription.remark_format'] ?? ''}
            onChange={f('subscription.remark_format')}
            placeholder="{node_name} ({username}) [{protocol} - {transport}]"
          />
          <p className="mt-2 text-xs text-soft">Available placeholders: {'{node_name}'} {'{username}'} {'{protocol}'} {'{transport}'} {'{region}'}</p>
        </div>
      </Section>

      <Section
        title="Feishu bot"
        description="Optional. When unset, subscription links, the subscription page and QR codes all keep working."
        actions={
          <div className="flex items-center gap-3 rounded-full border border-[var(--border)] bg-[var(--panel-strong)] px-3 py-2">
            <span className="text-sm font-medium text-soft">Enable Feishu</span>
            <Switch checked={feishuEnabled} onChange={(next) => set('feishu.enabled', next ? 'true' : 'false')} />
          </div>
        }
      >
        <div className="border-t border-[var(--border)]">
          <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Feishu integration</div>
              <p className="text-xs text-soft">Turning this off collapses the configuration block and disables Feishu messaging. Saved Feishu details are kept.</p>
            </div>
            <div className="flex items-center gap-3">
              <Btn variant="secondary" loading={testFeishu.isPending || feishuStatusLoading} onClick={() => testFeishu.mutate()}>Check configuration</Btn>
              {feishuEnabled ? <ChevronDown className="h-4 w-4 text-faint" /> : <ChevronRight className="h-4 w-4 text-faint" />}
            </div>
          </div>

          {feishuEnabled && (
            <div className="space-y-4 border-t border-[var(--border)] pt-4">
              <div className="grid gap-4 md:grid-cols-2">
                <SecretField
                  label="App ID"
                  value={form['feishu.app_id'] ?? ''}
                  onChange={f('feishu.app_id')}
                  placeholder="cli_xxx"
                  revealed={Boolean(secretVisibility['feishu.app_id'])}
                  onToggleReveal={() => toggleSecretVisibility('feishu.app_id')}
                />
                <SecretField
                  label="App Secret"
                  value={form['feishu.app_secret'] ?? ''}
                  onChange={f('feishu.app_secret')}
                  placeholder="Feishu app credentials"
                  revealed={Boolean(secretVisibility['feishu.app_secret'])}
                  onToggleReveal={() => toggleSecretVisibility('feishu.app_secret')}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <SecretField
                  label="Verification Token"
                  value={form['feishu.verification_token'] ?? ''}
                  onChange={f('feishu.verification_token')}
                  placeholder="Event subscription verification token"
                  revealed={Boolean(secretVisibility['feishu.verification_token'])}
                  onToggleReveal={() => toggleSecretVisibility('feishu.verification_token')}
                />
                <SecretField
                  label="Encrypt Key"
                  value={form['feishu.encrypt_key'] ?? ''}
                  onChange={f('feishu.encrypt_key')}
                  placeholder="Encrypt key (optional)"
                  revealed={Boolean(secretVisibility['feishu.encrypt_key'])}
                  onToggleReveal={() => toggleSecretVisibility('feishu.encrypt_key')}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Feishu callback base URL" value={form['feishu.base_url'] ?? ''} onChange={f('feishu.base_url')} placeholder="https://your-domain.com" />
                <Field label="Bot name" value={form['feishu.bot_name'] ?? ''} onChange={f('feishu.bot_name')} placeholder="xray-pilot" />
              </div>
              <div className="border-t border-[var(--border)] pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Current status</span>
                  <Badge
                    label={!feishuStatus?.enabled ? 'Disabled' : feishuStatus.configured ? 'Ready' : 'Incomplete'}
                    variant={!feishuStatus?.enabled ? 'gray' : feishuStatus.configured ? 'green' : 'yellow'}
                  />
                </div>
                <div className="mt-3 space-y-2 text-sm text-soft">
                  <p>Bot name: {feishuStatus?.bot_name || form['feishu.bot_name'] || 'xray-pilot'}</p>
                  <p>Webhook URL: {feishuStatus?.webhook_url || 'Set the Feishu callback base URL first'}</p>
                  {feishuStatus?.enabled && !feishuStatus.configured && (
                    <p>Missing settings: {(feishuStatus.missing_keys ?? []).join('、') || 'Complete the base configuration first'}</p>
                  )}
                </div>
              </div>
              <p className="text-xs text-soft">Expose a fixed HTTPS endpoint; the webhook path is <code>/api/feishu/events</code>.</p>
            </div>
          )}
        </div>
      </Section>
    </>
  )
}
