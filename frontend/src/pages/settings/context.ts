import { useOutletContext } from 'react-router-dom'

export type SettingsMap = Record<string, string>

// Form context shared by every settings section: owned by SettingsLayout, read and written by child routes via useSettingsForm()
export interface SettingsFormContext {
  form: SettingsMap
  setForm: React.Dispatch<React.SetStateAction<SettingsMap>>
  /** Convenience binder: f('key') returns an input onChange handler */
  f: (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => void
  /** Convenience setter: set('key', value) */
  set: (key: string, value: string) => void
}

export function useSettingsForm() {
  return useOutletContext<SettingsFormContext>()
}

// Settings section route definitions — the single source the sidebar nav and the app routes both read from
export const SETTINGS_SECTIONS = [
  { key: 'status', label: 'Status', hint: 'System info and deployment diagnostics', form: false },
  { key: 'sync', label: 'Nodes and sync', hint: 'SSH, Xray logs, scheduler intervals', form: true },
  { key: 'subscription', label: 'Subscription and notifications', hint: 'Subscription links, Feishu bot', form: true },
  { key: 'backup', label: 'Backups', hint: 'Backup schedule and snapshots', form: true },
  { key: 'admins', label: 'Admin', hint: 'Panel sign-in accounts', form: false, superAdminOnly: true },
] as const

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]['key']
