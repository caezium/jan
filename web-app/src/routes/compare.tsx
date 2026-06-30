/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState, useCallback } from 'react'
import { streamText } from 'ai'
import { ModelFactory } from '@/lib/model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  IconSend,
  IconLoader2,
  IconColumns,
  IconAlertTriangle,
} from '@tabler/icons-react'

export const Route = createFileRoute('/compare' as any)({
  component: ComparePage,
})

type ColumnKey = string // `${provider}::${modelId}`

type ColumnState = {
  provider: string
  modelId: string
  label: string
  text: string
  done: boolean
  error?: string
}

const keyOf = (provider: string, modelId: string): ColumnKey =>
  `${provider}::${modelId}`

function ComparePage() {
  const { providers } = useModelProvider()
  const [prompt, setPrompt] = useState('')
  const [selected, setSelected] = useState<Set<ColumnKey>>(new Set())
  const [columns, setColumns] = useState<ColumnState[]>([])
  const [running, setRunning] = useState(false)

  // Flat list of selectable models across all active providers.
  const options = useMemo(() => {
    const out: { key: ColumnKey; provider: string; modelId: string; label: string }[] = []
    for (const p of providers) {
      if (p.active === false) continue
      for (const m of p.models ?? []) {
        if (m.embedding) continue
        const modelId = m.id
        out.push({
          key: keyOf(p.provider, modelId),
          provider: p.provider,
          modelId,
          label: `${m.name || m.id}`,
        })
      }
    }
    return out
  }, [providers])

  const toggle = useCallback((key: ColumnKey) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const updateColumn = useCallback(
    (key: ColumnKey, patch: Partial<ColumnState>) => {
      setColumns((cols) =>
        cols.map((c) => (keyOf(c.provider, c.modelId) === key ? { ...c, ...patch } : c))
      )
    },
    []
  )

  const run = useCallback(async () => {
    const picks = options.filter((o) => selected.has(o.key))
    if (!prompt.trim() || picks.length === 0) return

    setRunning(true)
    setColumns(
      picks.map((o) => ({
        provider: o.provider,
        modelId: o.modelId,
        label: o.label,
        text: '',
        done: false,
      }))
    )

    const userPrompt = prompt
    await Promise.all(
      picks.map(async (o) => {
        const key = o.key
        try {
          const provider = providers.find((p) => p.provider === o.provider)
          if (!provider) throw new Error(`Provider "${o.provider}" not found`)
          const model = await ModelFactory.createModel(o.modelId, provider, {})
          const result = streamText({
            model,
            messages: [{ role: 'user', content: userPrompt }],
          })
          let acc = ''
          for await (const delta of result.textStream) {
            acc += delta
            updateColumn(key, { text: acc })
          }
          updateColumn(key, { done: true })
        } catch (err) {
          updateColumn(key, {
            done: true,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    )

    setRunning(false)
  }, [options, selected, prompt, providers, updateColumn])

  return (
    <div className="flex h-full w-full flex-col">
      <HeaderPage>
        <div className="flex items-center gap-2">
          <IconColumns size={18} />
          <span className="font-medium">Compare</span>
        </div>
      </HeaderPage>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {/* model picker */}
        <div className="flex flex-col gap-2">
          <span className="text-sm text-main-view-fg/70">
            Pick models to compare ({selected.size} selected)
          </span>
          {options.length === 0 ? (
            <p className="text-sm text-main-view-fg/60">
              No models available yet. Add a provider (e.g. OpenRouter) and an
              API key in Settings → Providers first.
            </p>
          ) : (
            <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {options.map((o) => {
                const isOn = selected.has(o.key)
                return (
                  <button
                    key={o.key}
                    onClick={() => toggle(o.key)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs transition-colors',
                      isOn
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-main-view-fg/15 text-main-view-fg/70 hover:bg-main-view-fg/5'
                    )}
                    title={`${o.provider} · ${o.modelId}`}
                  >
                    {o.label}
                    <span className="ml-1 opacity-50">· {o.provider}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* prompt input */}
        <div className="flex items-end gap-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask every selected model the same thing…"
            className="min-h-16 flex-1"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void run()
              }
            }}
          />
          <Button
            onClick={() => void run()}
            disabled={running || selected.size === 0 || !prompt.trim()}
          >
            {running ? (
              <IconLoader2 size={16} className="mr-1.5 animate-spin" />
            ) : (
              <IconSend size={16} className="mr-1.5" />
            )}
            Send
          </Button>
        </div>

        {/* result columns */}
        {columns.length > 0 && (
          <div
            className="grid min-h-0 flex-1 gap-3 overflow-hidden"
            style={{
              gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, minmax(0, 1fr))`,
            }}
          >
            {columns.map((c) => (
              <div
                key={keyOf(c.provider, c.modelId)}
                className="flex min-h-0 flex-col rounded-lg border border-main-view-fg/10"
              >
                <div className="flex items-center justify-between border-b border-main-view-fg/10 px-3 py-2">
                  <span className="truncate text-sm font-medium" title={c.modelId}>
                    {c.label}
                  </span>
                  <span className="ml-2 shrink-0 text-xs text-main-view-fg/50">
                    {c.error ? (
                      <IconAlertTriangle size={14} className="text-destructive" />
                    ) : c.done ? (
                      'done'
                    ) : (
                      <IconLoader2 size={14} className="animate-spin" />
                    )}
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-3 py-2 text-sm">
                  {c.error ? (
                    <span className="text-destructive">{c.error}</span>
                  ) : (
                    c.text || (
                      <span className="text-main-view-fg/40">…</span>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
