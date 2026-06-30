import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import { useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { IconLoader2, IconFileImport, IconUpload } from '@tabler/icons-react'
import {
  ChatCompletionRole,
  ContentType,
  MessageStatus,
  type Thread,
  type ThreadMessage,
} from '@janhq/core'

/**
 * Shape of a T3 Chat (t3.chat) history export.
 * Settings > History & Sync > Export produces:
 *   { threads: [...], messages: [...], version: "x.y.z" }
 */
type T3Thread = {
  threadId?: string
  id?: string
  title?: string
  model?: string
  created_at?: number
  createdAt?: number
  updated_at?: number
  lastMessageAt?: number
}
type T3Message = {
  threadId?: string
  role?: string
  content?: string
  created_at?: number
  createdAt?: number
  messageId?: string
  id?: string
  model?: string
  parts?: Array<{ type?: string; text?: string; reasoning?: string }>
}
type T3Export = {
  threads?: T3Thread[]
  messages?: T3Message[]
  version?: string
}

const toMs = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : Date.now()
}

/** Prefer the rendered `content`; fall back to reconstructing from `parts`. */
const messageText = (m: T3Message): string => {
  if (typeof m.content === 'string' && m.content.trim()) return m.content
  const chunks: string[] = []
  for (const p of m.parts ?? []) {
    if (p?.type === 'text' && typeof p.text === 'string') chunks.push(p.text)
    else if (p?.type === 'reasoning' && typeof p.reasoning === 'string')
      chunks.push(p.reasoning)
  }
  return chunks.join('\n\n').trim()
}

type ImportT3ChatsDialogProps = {
  trigger?: React.ReactNode
  onDropdownClose?: () => void
}

export const ImportT3ChatsDialog = ({
  trigger,
  onDropdownClose,
}: ImportT3ChatsDialogProps) => {
  const serviceHub = useServiceHub()
  const setThreads = useThreads((s) => s.setThreads)
  const [open, setOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [summary, setSummary] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const runImport = useCallback(
    async (file: File) => {
      setImporting(true)
      setProgress(0)
      setSummary(null)
      try {
        const data: T3Export = JSON.parse(await file.text())
        if (!Array.isArray(data.threads) || !Array.isArray(data.messages)) {
          throw new Error(
            'Not a T3 Chat export — expected a JSON file with "threads" and "messages".'
          )
        }

        // group messages by their T3 threadId
        const byThread = new Map<string, T3Message[]>()
        for (const m of data.messages) {
          const tid = m.threadId
          if (!tid) continue
          const arr = byThread.get(tid)
          if (arr) arr.push(m)
          else byThread.set(tid, [m])
        }

        const importable = data.threads.filter((t) => {
          const tid = t.threadId ?? t.id
          return tid && (byThread.get(tid)?.length ?? 0) > 0
        })

        let done = 0
        let msgCount = 0
        for (const t of importable) {
          const tid = (t.threadId ?? t.id) as string
          const msgs = (byThread.get(tid) ?? [])
            .slice()
            .sort((a, b) => toMs(a.created_at ?? a.createdAt) - toMs(b.created_at ?? b.createdAt))

          const updatedSec = toMs(t.updated_at ?? t.lastMessageAt) / 1000
          const thread = {
            id: tid,
            object: 'thread',
            title: t.title || 'Imported chat',
            assistants: [],
            created: toMs(t.created_at ?? t.createdAt) / 1000,
            updated: updatedSec,
            model: { id: t.model || 'imported', provider: 'openrouter' },
            metadata: { imported_from: 't3', t3_thread_id: tid },
          } as unknown as Thread

          await serviceHub.threads().createThread(thread)

          for (const m of msgs) {
            const ts = toMs(m.created_at ?? m.createdAt)
            const message = {
              id: String(m.messageId ?? m.id ?? `${tid}-${msgCount}`),
              object: 'thread.message',
              thread_id: tid,
              role:
                m.role === 'assistant'
                  ? ChatCompletionRole.Assistant
                  : ChatCompletionRole.User,
              status: MessageStatus.Ready,
              type: 'text',
              created_at: ts,
              completed_at: ts,
              content: [
                {
                  type: ContentType.Text,
                  text: { value: messageText(m), annotations: [] },
                },
              ],
              metadata: { imported_from: 't3', t3_model: m.model },
            } as unknown as ThreadMessage
            await serviceHub.messages().createMessage(message)
            msgCount++
          }

          done++
          setProgress(Math.round((done / importable.length) * 100))
        }

        // Refresh the in-memory thread list from disk so imports appear now.
        const refreshed = await serviceHub.threads().fetchThreads()
        setThreads(refreshed)

        setSummary(`Imported ${done} threads (${msgCount} messages).`)
        toast.success('T3 Chat history imported', {
          description: `${done} threads, ${msgCount} messages.`,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setSummary(null)
        toast.error('Import failed', { description: msg })
      } finally {
        setImporting(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [serviceHub, setThreads]
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) onDropdownClose?.()
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="link" size="sm" className="px-0">
            <IconFileImport size={16} className="mr-1.5" />
            Import T3 Chat history
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import T3 Chat history</DialogTitle>
          <DialogDescription>
            Select a T3 Chat export (Settings → History &amp; Sync → Export, a
            <code className="mx-1">threads-export-*.json</code>
            file). Each conversation becomes a native Jan thread.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void runImport(f)
          }}
        />

        {importing ? (
          <div className="flex flex-col gap-2 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconLoader2 size={16} className="animate-spin" />
              Importing… {progress}%
            </div>
            <Progress value={progress} />
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-1">
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
            >
              <IconUpload size={16} className="mr-1.5" />
              Choose export file…
            </Button>
            {summary && (
              <p className="text-sm text-main-view-fg/70">{summary}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default ImportT3ChatsDialog
