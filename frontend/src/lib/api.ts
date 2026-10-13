import request from './axios'
import type { ApiResponse, PageResult, User, Group, Node, InboundProfile, NodeKey, SyncLog, DiagnosticsResult, SyncSummary, FeishuStatus, FeishuPushResult, TrafficSummary, Admin, AdminRole, LoginResponse } from '@/types'

// ---- Shared pagination parameters ----
interface PageParams {
  page?: number
  page_size?: number
}

// ---- Users API ----
export const userApi = {
  list: (params?: PageParams) =>
    request.get<ApiResponse<PageResult<User>>>('/users', { params }),

  create: (data: {
    username: string
    real_name?: string
    group_ids?: number[]
    expires_at?: string | null
    remark?: string
    feishu_enabled?: boolean
    feishu_email?: string
    feishu_open_id?: string
    feishu_union_id?: string
    feishu_chat_id?: string
  }) => request.post<ApiResponse<User>>('/users', data),

  update: (id: number, data: {
    username?: string
    real_name?: string
    group_ids?: number[] | null
    active?: boolean
    expires_at?: string | null
    remark?: string
    feishu_enabled?: boolean
    feishu_email?: string
    feishu_open_id?: string
    feishu_union_id?: string
    feishu_chat_id?: string
  }) => request.put<ApiResponse<User>>(`/users/${id}`, data),

  toggle: (id: number) =>
    request.patch<ApiResponse<null>>(`/users/${id}/toggle`),

  remove: (id: number) =>
    request.delete<ApiResponse<null>>(`/users/${id}`),

  resetUUID: (id: number) =>
    request.post<ApiResponse<User>>(`/users/${id}/reset-uuid`),

  resetToken: (id: number) =>
    request.post<ApiResponse<User>>(`/users/${id}/reset-token`),

  pushFeishu: (id: number) =>
    request.post<ApiResponse<FeishuPushResult>>(`/users/${id}/feishu-push`),

  pushFeishuBatch: (user_ids: number[]) =>
    request.post<ApiResponse<FeishuPushResult>>('/users/feishu-push', { user_ids }),

  bindFeishu: (id: number, email: string) =>
    request.post<ApiResponse<User>>(`/users/${id}/feishu-bind`, { email }),

  unbindFeishu: (id: number) =>
    request.post<ApiResponse<User>>(`/users/${id}/feishu-unbind`),
}

// ---- Groups API ----
export const groupApi = {
  list: (params?: PageParams) =>
    request.get<ApiResponse<PageResult<Group>>>('/groups', { params }),

  create: (data: { name: string; description?: string; node_ids?: number[] }) =>
    request.post<ApiResponse<Group>>('/groups', data),

  update: (id: number, data: { name?: string; description?: string; node_ids?: number[]; active?: boolean }) =>
    request.put<ApiResponse<Group>>(`/groups/${id}`, data),

  remove: (id: number) =>
    request.delete<ApiResponse<null>>(`/groups/${id}`),
}

// ---- Nodes API ----
// Node list filter parameters — filtering happens server-side so it never only covers the current page
export interface NodeListParams extends PageParams {
  keyword?: string
  sync_status?: string
  region?: string
  owner?: string
  /** Health check filter: healthy / unhealthy / unchecked */
  health?: string
}

export const nodeApi = {
  list: (params?: NodeListParams) =>
    request.get<ApiResponse<PageResult<Node>>>('/nodes', { params }),

  filterOptions: () =>
    request.get<ApiResponse<{ regions: string[]; owners: string[] }>>('/nodes/filter-options'),

  get: (id: number) =>
    request.get<ApiResponse<Node>>(`/nodes/${id}`),

  create: (data: {
    name: string
    ip: string
    region?: string
    domain?: string
    ssh_port?: number
    ssh_user?: string
    ssh_key_path?: string
    remark?: string
  }) => request.post<ApiResponse<Node>>('/nodes', data),

  update: (id: number, data: Partial<{
    name: string
    region: string
    ip: string
    domain: string
    ssh_port: number
    ssh_user: string
    ssh_key_path: string
    remark: string
  }>) => request.put<ApiResponse<Node>>(`/nodes/${id}`, data),

  toggle: (id: number) =>
    request.patch<ApiResponse<null>>(`/nodes/${id}/toggle`),

  remove: (id: number) =>
    request.delete<ApiResponse<null>>(`/nodes/${id}`),

  sync: (id: number) =>
    request.post<ApiResponse<{ message: string }>>(`/nodes/${id}/sync`),

  syncAll: () =>
    request.post<ApiResponse<{ total: number; success: number; failed: number }>>('/nodes/sync-all'),

  syncDrifted: () =>
    request.post<ApiResponse<{ total: number; success: number; failed: number }>>('/nodes/sync-drifted'),

  keygen: () =>
    request.post<ApiResponse<{ private_key: string; public_key: string }>>('/nodes/keygen'),

  testSSH: (id: number) =>
    request.post<ApiResponse<{ ok: boolean; latency_ms: number; error?: string }>>(`/nodes/${id}/test-ssh`),

  // Node profile keys
  getKeys: (nodeId: number) =>
    request.get<ApiResponse<NodeKey[]>>(`/nodes/${nodeId}/keys`),

  upsertKey: (nodeId: number, profileId: number, settings: string, port?: number) =>
    request.put<ApiResponse<NodeKey>>(`/nodes/${nodeId}/keys/${profileId}`, { settings, port: port ?? 0 }),

  setKeyLock: (nodeId: number, profileId: number, locked: boolean) =>
    request.patch<ApiResponse<null>>(`/nodes/${nodeId}/keys/${profileId}/lock`, { locked }),

  deleteKey: (nodeId: number, profileId: number) =>
    request.delete<ApiResponse<null>>(`/nodes/${nodeId}/keys/${profileId}`),

  keygenForNode: (nodeId: number, profileId: number) =>
    request.post<ApiResponse<NodeKey>>(`/nodes/${nodeId}/keys/${profileId}/keygen`),

  previewConfig: (nodeId: number) =>
    request.get<ApiResponse<{ config: string; warnings: string[] }>>(`/nodes/${nodeId}/preview-config`),
}

// ---- Profiles API ----
export const profileApi = {
  list: (params?: PageParams) =>
    request.get<ApiResponse<PageResult<InboundProfile>>>('/profiles', { params }),

  create: (data: {
    name: string
    protocol: string
    port: number
    settings?: string
    active?: boolean
    remark?: string
  }) => request.post<ApiResponse<InboundProfile>>('/profiles', data),

  update: (id: number, data: {
    name?: string
    protocol?: string
    port?: number
    settings?: string
    active?: boolean
    remark?: string
  }) => request.put<ApiResponse<InboundProfile>>(`/profiles/${id}`, data),

  remove: (id: number) =>
    request.delete<ApiResponse<null>>(`/profiles/${id}`),
}

// ---- Activity log API ----
export const logApi = {
  // Actor is a prefix filter, e.g. "admin:" for human actions and "system:scheduler:" for the scheduler
  list: (params?: PageParams & { actor?: string }) =>
    request.get<ApiResponse<PageResult<SyncLog>>>('/logs', { params }),

  cleanup: (days: number) =>
    request.post<ApiResponse<{ deleted: number; before: string }>>('/logs/cleanup', { days }),
}

// ---- System API ----
export const systemApi = {
  getInfo: () =>
    request.get<ApiResponse<{
      server: { port: number; mode: string }
      database: { driver: string; dsn: string }
    }>>('/system/info'),

  getDiagnostics: () =>
    request.get<ApiResponse<DiagnosticsResult>>('/system/diagnostics'),

  getSyncSummary: () =>
    request.get<ApiResponse<SyncSummary>>('/system/sync-summary'),

  getFeishuStatus: () =>
    request.get<ApiResponse<FeishuStatus>>('/system/feishu-status'),

  testFeishuConfig: () =>
    request.post<ApiResponse<FeishuStatus>>('/system/feishu-test'),

  getSettings: () =>
    request.get<ApiResponse<Record<string, string>>>('/system/settings'),

  updateSettings: (data: Record<string, string>) =>
    request.put<ApiResponse<Record<string, string>>>('/system/settings', data),

  // Changelog: content is embedded in the binary at build time, returned newest version first
  getReleaseNotes: () =>
    request.get<ApiResponse<ReleaseNote[]>>('/system/release-notes'),
}

export interface ReleaseNote {
  version: string
  content: string
}

// ---- Auth / current admin ----
export const authApi = {
  login: (username: string, password: string) =>
    request.post<ApiResponse<LoginResponse>>('/auth/login', { username, password }),
  me: () =>
    request.get<ApiResponse<{ id: number; username: string; role: AdminRole }>>('/me'),
  changePassword: (old_password: string, new_password: string) =>
    request.put<ApiResponse<null>>('/me/password', { old_password, new_password }),
}

// ---- Admin accounts (super admin only) ----
export const adminApi = {
  list: () =>
    request.get<ApiResponse<Admin[]>>('/admins'),
  create: (data: { username: string; password: string; role: AdminRole }) =>
    request.post<ApiResponse<Admin>>('/admins', data),
  update: (id: number, data: { role?: AdminRole; active?: boolean }) =>
    request.put<ApiResponse<Admin>>(`/admins/${id}`, data),
  remove: (id: number) =>
    request.delete<ApiResponse<null>>(`/admins/${id}`),
  setPassword: (id: number, password: string) =>
    request.put<ApiResponse<null>>(`/admins/${id}/password`, { password }),
}

// ---- Traffic stats ----
export const trafficApi = {
  summary: () =>
    request.get<ApiResponse<TrafficSummary>>('/traffic/summary'),
}

// ---- Database backups ----
export interface BackupFile {
  name: string
  size: number
  created_at: string
}

// ---- Node provisioning ----
export interface InstallToken {
  id: number
  token: string
  expires_at: string
  curl_command: string
  node_name: string
  used: boolean
  node_id?: number
  used_by_ip?: string
  /** Non-empty means this is a replace-server token */
  replace_node_id?: number
  /** Panel outbound IP; an empty string means the backend has not probed it yet (the UI degrades the copy) */
  panel_outbound_ip?: string
  /** Result of the panel's own SSH port probe after registration; undefined means not registered yet */
  reachable?: boolean
  reachable_latency_ms?: number
  reachable_message?: string
}

export interface CreateInstallTokenInput {
  name?: string            // required when creating; ignored in replace mode (keeps the existing node name)
  region?: string
  owner?: string
  remark?: string
  replace_node_id?: number // replace-server mode: give this node a new machine — registration updates instead of creating
  ssh_user?: string
  ssh_port?: number
  panel_url: string
  ttl_seconds?: number
}

export const installApi = {
  create: (data: CreateInstallTokenInput) =>
    request.post<ApiResponse<InstallToken>>('/nodes/install-tokens', data),
  list: () =>
    request.get<ApiResponse<InstallToken[]>>('/nodes/install-tokens'),
  get: (token: string) =>
    request.get<ApiResponse<InstallToken>>(`/nodes/install-tokens/${encodeURIComponent(token)}`),
  remove: (id: number) =>
    request.delete<ApiResponse<{ deleted_id: number }>>(`/nodes/install-tokens/${id}`),
}

export const backupApi = {
  list: () =>
    request.get<ApiResponse<BackupFile[]>>('/system/backups'),
  run: () =>
    request.post<ApiResponse<BackupFile>>('/system/backups'),
  // Fetch the blob through axios so the JWT header travels with the request;
  // a plain <a href download> skips the interceptor, and the missing Authorization header gets a 401 from the backend.
  download: async (name: string) => {
    const res = await request.get(`/system/backups/${encodeURIComponent(name)}/download`, {
      responseType: 'blob',
      // Backup files can reach tens of MB and a CDN or reverse proxy easily exceeds the default 10s instance timeout — downloads are sent without a timeout
      timeout: 0,
    })
    let filename = name
    const cd = String((res.headers as Record<string, unknown>)['content-disposition'] ?? '')
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
    if (m) {
      try { filename = decodeURIComponent(m[1]) } catch { filename = m[1] }
    }
    const blob = res.data as Blob
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
  remove: (name: string) =>
    request.delete<ApiResponse<{ deleted: string }>>(`/system/backups/${encodeURIComponent(name)}`),
}
