// copyText writes text to the clipboard and works outside a secure context (HTTP / LAN IPs).
//
// The modern navigator.clipboard.writeText API only works over https or localhost;
// visiting the panel on something like http://192.168.x.x makes it reject silently,
// which shows up as the "button did not respond" problem.
//
// Try navigator.clipboard first, then fall back to a textarea + document.execCommand('copy'),
// so copying still works in mainstream browsers outside a secure context.
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall back
    }
  }

  return fallbackCopy(text)
}

function fallbackCopy(text: string): boolean {
  if (typeof document === 'undefined') return false

  const ta = document.createElement('textarea')
  ta.value = text
  // keep it out of the viewport so it never causes a scroll flicker
  ta.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;outline:0;opacity:0;pointer-events:none'
  ta.setAttribute('readonly', '')
  document.body.appendChild(ta)

  let ok = false
  try {
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(ta)
  }
  return ok
}
