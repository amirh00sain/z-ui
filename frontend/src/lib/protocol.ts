// Single source of truth for display metadata (labels and badge colours).
// Avoids maintaining the same map separately in the node list, profile list and node-profile drawer.
import type { Protocol } from '@/types'

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  'vless-reality': 'VLESS + Reality',
  'vless-ws-tls': 'VLESS + WS + TLS',
  trojan: 'Trojan + TLS',
  hysteria2: 'Hysteria2',
  http: 'HTTP',
  socks: 'SOCKS5',
}

export const PROTOCOL_BADGE_VARIANT: Record<Protocol, 'green' | 'blue' | 'yellow' | 'red' | 'gray'> = {
  'vless-reality': 'green',
  'vless-ws-tls': 'blue',
  trojan: 'yellow',
  hysteria2: 'red',
  http: 'gray',
  socks: 'gray',
}

export function protocolLabel(protocol: string) {
  return PROTOCOL_LABELS[protocol as Protocol] ?? protocol
}

export function protocolBadgeVariant(protocol: string): 'green' | 'blue' | 'yellow' | 'red' | 'gray' {
  return PROTOCOL_BADGE_VARIANT[protocol as Protocol] ?? 'gray'
}

// Protocol options for the create/edit dropdowns, in the same order as PROTOCOL_LABELS
export const PROTOCOL_OPTIONS = (Object.keys(PROTOCOL_LABELS) as Protocol[]).map((value) => ({
  value,
  label: PROTOCOL_LABELS[value],
}))
