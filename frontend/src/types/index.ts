export interface User {
  id: number
  username: string
  real_name: string
  group_ids?: number[]
  group_names?: string[]
  groups?: Array<{ id: number; name: string }>
  active: boolean
  expires_at?: string  // ISO 8601; empty means no expiry
  remark: string
  subscribe_url: string
  feishu_enabled?: boolean
  feishu_email?: string
  feishu_open_id?: string
  feishu_union_id?: string
  feishu_chat_id?: string
  feishu_identity_ready?: boolean
  feishu_bound_at?: string
  created_at: string
  updated_at: string
  // Cumulative traffic counters (updated periodically by the backend TrafficPoller)
  traffic_up_bytes?: number
  traffic_down_bytes?: number
  traffic_last_updated_at?: string
}

export interface TrafficSummary {
  total_up_bytes: number
  total_down_bytes: number
  active_users_7d: number
  last_updated_at?: string
}

export interface Group {
  id: number
  name: string
  description: string
  active: boolean
  node_count: number
  node_ids: number[]
  created_at: string
  updated_at: string
}

export type SyncStatus = 'synced' | 'drifted' | 'failed' | 'pending'

export interface Node {
  id: number
  name: string
  region: string
  owner: string           // owner, identifies where the node came from
  ip: string
  domain: string          // client-facing domain (CDN / relay); blank falls back to the IP
  group_names?: string[]
  online_user_count: number
  ssh_port: number
  ssh_user: string
  ssh_key_path: string
  log_level: string       // node-level log level override; blank inherits the system setting
  active: boolean
  xray_active: boolean    // whether the xray process is running
  xray_version: string    // remote xray version
  sync_status: SyncStatus
  last_check_ok: boolean
  last_latency_ms: number
  last_sync_at?: string
  last_check_at?: string
  remark: string
  created_at: string
  updated_at: string
}

// InboundProfile — protocol template
// http / socks are proxy protocols for programs (IP allowlist + optional auth) and never appear in user subscriptions
export type Protocol = 'vless-reality' | 'vless-ws-tls' | 'trojan' | 'hysteria2' | 'http' | 'socks'

export interface InboundProfile {
  id: number
  name: string
  protocol: Protocol
  port: number
  settings: unknown   // JSON object (the backend returns json.RawMessage, already parsed into an object)
  active: boolean
  remark: string
  created_at: string
  updated_at: string
}

// Node key material
export interface NodeKey {
  node_id: number
  profile_id: number
  settings: unknown   // JSON object (the raw value to edit, returned when editing node keys)
  port: number        // node-level listen port override; 0 inherits the template port
  locked: boolean
  created_at: string
  updated_at: string
}

export interface SyncLog {
  id: number
  action: string
  target: string
  actor: string // admin:<username> / system:scheduler:<task> / system:install-token:<id> / system:feishu-webhook; empty for records from before v0.5.0
  success: boolean
  message: string
  duration_ms: number
  created_at: string
}

export type AdminRole = 'super_admin' | 'admin'

export interface Admin {
  id: number
  username: string
  role: AdminRole
  active: boolean
  last_login_at?: string
  created_at: string
}

export interface LoginResponse {
  token: string
  username: string
  role: AdminRole
}

export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data?: T
}

export interface PageResult<T> {
  total: number
  list: T[]
}

export type DiagnosticStatus = 'ok' | 'warning' | 'error'

export interface DiagnosticItem {
  key: string
  label: string
  status: DiagnosticStatus
  detail: string
  suggestion?: string
  value?: string
}

export interface DiagnosticsResult {
  summary: {
    ok: number
    warning: number
    error: number
  }
  items: DiagnosticItem[]
}

export interface SyncSummary {
  needs_sync: boolean
  drifted_count: number
  failed_count: number
  pending_count: number
  total_affected: number
}

export interface FeishuStatus {
  enabled: boolean
  configured: boolean
  missing_keys?: string[]
  webhook_url?: string
  bot_name?: string
}

export interface FeishuPushResult {
  total: number
  sent: number
  skipped: number
  failed: number
  errors?: string[]
}
