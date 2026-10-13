import { type ReactNode, Fragment, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { systemApi } from '@/lib/api'
import { Drawer } from '@/components/ui/Drawer'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'

// ChangelogDrawer: version list on the left, release content on the right (newest first).
// Content is baked into the binary, so staleTime is Infinity to avoid refetching within a session.
export function ChangelogDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['release-notes'],
    queryFn: () => systemApi.getReleaseNotes().then((r) => r.data.data ?? []),
    enabled: open,
    staleTime: Infinity,
  })

  const [activeVersion, setActiveVersion] = useState<string | null>(null)
  const sectionRefs = useRef(new Map<string, HTMLElement>())

  // Scroll sync: highlight the matching version on the left (the section inside the top 20% of the viewport counts as current)
  useEffect(() => {
    if (!open || !data || data.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveVersion(entry.target.getAttribute('data-version'))
          }
        }
      },
      { rootMargin: '0px 0px -80% 0px' },
    )
    sectionRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [open, data])

  const jumpTo = (version: string) => {
    setActiveVersion(version)
    sectionRefs.current.get(version)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <Drawer open={open} onClose={onClose} title="Changelog" description="Release history built into the running version. Pick a version on the left to jump to it." width="xl">
      {isLoading && <p className="py-10 text-center text-sm text-soft">Loading…</p>}
      {error && <p className="py-10 text-center text-sm text-[var(--danger)]">{(error as Error).message}</p>}
      {data && data.length === 0 && <p className="py-10 text-center text-sm text-soft">No release notes yet</p>}
      {data && data.length > 0 && (
        <div className="grid gap-6 md:grid-cols-[150px_minmax(0,1fr)]">
          {/* Left: version navigation (sticks while the drawer body scrolls) */}
          <nav className="hidden self-start md:sticky md:top-0 md:block md:max-h-[calc(100dvh-180px)] md:overflow-y-auto md:pr-1">
            <div className="space-y-0.5">
              {data.map((note, index) => {
                const active = activeVersion ? activeVersion === note.version : index === 0
                return (
                  <button
                    key={note.version}
                    type="button"
                    onClick={() => jumpTo(note.version)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md border-l-2 px-3 py-1.5 text-left text-sm transition',
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                        : 'border-transparent text-soft hover:bg-[var(--panel-muted)] hover:text-[var(--text)]',
                    )}
                  >
                    <span>{note.version}</span>
                    {index === 0 && <span className="text-[10px] text-[var(--success)]">Latest</span>}
                  </button>
                )
              })}
            </div>
          </nav>

          {/* Right: release notes */}
          <div className="min-w-0 space-y-8">
            {data.map((note, index) => (
              <section
                key={note.version}
                data-version={note.version}
                ref={(el) => {
                  if (el) sectionRefs.current.set(note.version, el)
                  else sectionRefs.current.delete(note.version)
                }}
                className="scroll-mt-2"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-base font-semibold tracking-[-0.02em]">{note.version}</span>
                  {index === 0 && <Badge label="Latest" variant="green" />}
                </div>
                <MarkdownLite content={note.content} />
                {index < data.length - 1 && <div className="mt-8 h-px bg-[var(--border)]" />}
              </section>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  )
}

// MarkdownLite: minimal renderer covering only the syntax release-notes actually use
// (## / ### headings, - lists, **bold**, `inline code`, paragraphs) — no third-party renderer.
// The first line "# xray-pilot vX.Y.Z" repeats the version title, so it is skipped.
function MarkdownLite({ content }: { content: string }) {
  const lines = content.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let listItems: string[] = []

  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push(
      <ul key={blocks.length} className="ml-4 list-disc space-y-1 text-sm leading-6 text-soft">
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    )
    listItems = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const listMatch = /^\s*[-*]\s+(.*)$/.exec(line)
    if (listMatch) {
      listItems.push(listMatch[1])
      continue
    }
    flushList()
    if (line.trim() === '') continue
    if (line.startsWith('# ')) continue
    if (line.startsWith('### ')) {
      blocks.push(
        <h5 key={blocks.length} className="mt-4 text-sm font-semibold text-[var(--text)]">
          {renderInline(line.slice(4))}
        </h5>,
      )
      continue
    }
    if (line.startsWith('## ')) {
      blocks.push(
        <h4 key={blocks.length} className="mt-5 text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">
          {renderInline(line.slice(3))}
        </h4>,
      )
      continue
    }
    blocks.push(
      <p key={blocks.length} className="text-sm leading-6 text-soft">
        {renderInline(line)}
      </p>,
    )
  }
  flushList()

  return <div className="space-y-2.5">{blocks}</div>
}

// renderInline handles inline **bold** and `code`; everything else is emitted as plain text
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-[var(--text)]">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-[var(--panel-muted)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--text)]">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
