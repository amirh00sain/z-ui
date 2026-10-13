import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// formatBytes turns a byte count into a human-readable string (binary units: KiB / MiB / GiB / TiB)
// 0 bytes returns "0 B"; negatives return "-" (defensive)
export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null) return '-'
  if (bytes < 0) return '-'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  // two decimals below 10, otherwise one
  const precision = value < 10 && i > 0 ? 2 : i === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[i]}`
}
