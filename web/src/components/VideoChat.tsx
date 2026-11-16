import { ArrowUp, BookA, Check, MapPin, Sparkles, X } from "lucide-react"
import { Link } from "react-router-dom"
import { useState } from "react"
import { toast } from "sonner"
import { JobStatus } from "@/components/JobStatus"
import { Button } from "@/components/ui/button"
import { ChatContainerContent, ChatContainerRoot } from "@/components/ui/chat-container"
import { Message, MessageContent } from "@/components/ui/message"
import { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input"
import { ScrollButton } from "@/components/ui/scroll-button"
import { fmtDate, fmtTime, isActive, post, vname, type Proposal, type VideoDetail } from "@/lib/api"
import { cn } from "@/lib/utils"

type Props = {
  video: VideoDetail
  onJump: (version: number, at: number) => void
  onSent: () => void
}

function TimeChip({ version, at, onClick, className }: { version: number; at: number; onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 tabular-nums hover:bg-amber-500/25 dark:text-amber-300", className)}
    >
      <MapPin className="size-3" />
      {vname(version)} · {fmtTime(at, true)}
    </button>
  )
}

/** A word for the dictionary or a line for the taste profile, answered with yes or no. */
function ProposalCard({ videoId, proposal, onDecided }: { videoId: number; proposal: Proposal; onDecided: () => void }) {
  const [busy, setBusy] = useState(false)
  const decide = async (accept: boolean) => {
    setBusy(true)
    try {
      await post(`/api/videos/${videoId}/proposals/${proposal.kind}/${proposal.id}`, { accept })
      onDecided()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const dictionary = proposal.kind === "dictionary"
  const Icon = dictionary ? BookA : Sparkles
  const done = proposal.status !== "proposed"
  const accepted = proposal.status === "accepted"
  const result = dictionary
    ? accepted ? "В словаре. Сработает со следующей версии." : "Не добавлено в словарь."
    : accepted ? "Записано в профиль вкуса." : "Не запоминаем."
  return (
    <div className={cn("grid gap-2 rounded-xl border p-3 text-sm [overflow-wrap:anywhere]", done ? "bg-transparent opacity-80" : "border-primary/30 bg-primary/5")}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        {dictionary ? `Словарь распознавания · ${proposal.scope === "all" ? "для всех роликов" : "только этот ролик"}` : "Профиль вкуса"}
        {proposal.version != null && <span className="font-normal">· {vname(proposal.version)}</span>}
      </div>
      {dictionary ? (
        <div className="font-medium">«{proposal.from}» → «{proposal.to}»</div>
      ) : (
        <div className="font-medium">{proposal.text}</div>
      )}
      {proposal.reason && <div className="text-xs text-muted-foreground">{proposal.reason}</div>}
      {done ? (
        <div className={cn("flex items-center gap-1.5 text-xs", accepted ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
          {accepted ? <Check className="size-3.5" /> : <X className="size-3.5" />}
          {result}
          {!dictionary && accepted && <Link to="/settings/style" className="underline underline-offset-2">Профиль</Link>}
          {dictionary && <Link to="/settings/speech" className="underline underline-offset-2">Словарь</Link>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-xs text-muted-foreground">{dictionary ? "Добавить в словарь?" : "Запомнить для следующих роликов?"}</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(false)}>Нет</Button>
          <Button size="sm" disabled={busy} onClick={() => decide(true)}>Да</Button>
        </div>
      )}
    </div>
  )
}

export function VideoChat({ video, onJump, onSent }: Props) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)

  const pending = video.messages.filter((m) => m.role === "user" && m.version == null).length
  // Proposals go after the last message of their version, where the agent's reply is.
  const proposals = video.proposals ?? []
  const lastOfVersion = new Map<number, number>()
  video.messages.forEach((m, index) => { if (m.version != null) lastOfVersion.set(m.version, index) })
  const placed = new Set<string>()
  const cardsAfter = (index: number) => {
    const list = proposals.filter((p) => p.version != null && lastOfVersion.get(p.version) === index)
    list.forEach((p) => placed.add(`${p.kind}:${p.id}`))
    return list
  }
  const proposalCard = (p: Proposal) => <ProposalCard key={`${p.kind}:${p.id}`} videoId={video.id} proposal={p} onDecided={onSent} />
  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await post(`/api/videos/${video.id}/messages`, { body: text })
      setText("")
      onSent()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full min-h-[480px] flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-4 py-3 text-sm font-medium">Монтажёр</div>
      <ChatContainerRoot className="relative flex-1">
        <ChatContainerContent className="gap-4 p-4">
          {!video.messages.length && (
            <p className="text-sm text-muted-foreground">
              Здесь переписка с монтажёром. Правки к конкретной секунде оставляйте кнопкой «Комментарий» под видео: они появятся точками на таймлайне.
            </p>
          )}
          {video.messages.map((m, index) => {
            const cards = cardsAfter(index)
            const after = cards.length ? <div className="grid gap-2">{cards.map(proposalCard)}</div> : null
            if (m.role === "system") {
              return <div key={m.id} className="grid gap-4"><div className="px-4 text-center text-xs text-muted-foreground">{m.body}</div>{after}</div>
            }
            const mine = m.role === "user"
            return (
              <Message key={m.id} className={cn("flex-col gap-1", mine ? "items-end" : "items-start")}>
                <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                  {mine ? "Вы" : "Монтажёр"}
                  {m.version && <span>· {vname(m.version)}</span>}
                  <span>· {fmtDate(m.created_at)}</span>
                </div>
                {mine ? (
                  <div className="max-w-[90%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                    {m.ref_version != null && m.at_seconds != null && (
                      <TimeChip version={m.ref_version} at={m.at_seconds} onClick={() => onJump(m.ref_version!, m.at_seconds!)} className="mb-1 bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25 dark:text-primary-foreground" />
                    )}
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  </div>
                ) : (
                  <MessageContent markdown className="prose prose-sm max-w-[95%] rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 dark:prose-invert prose-headings:mt-2 prose-headings:mb-1 prose-headings:text-sm prose-headings:font-semibold prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
                    {m.body}
                  </MessageContent>
                )}
                {after && <div className="w-full">{after}</div>}
              </Message>
            )
          })}
          {proposals.filter((p) => !placed.has(`${p.kind}:${p.id}`)).map(proposalCard)}
          {isActive(video.job) && video.job.kind === "edit" && (
            <div className="rounded-xl border border-dashed p-3"><JobStatus job={video.job} /></div>
          )}
        </ChatContainerContent>
        <div className="absolute right-4 bottom-3">
          <ScrollButton className="shadow-sm" />
        </div>
      </ChatContainerRoot>
      <div className="border-t p-3">
        <PromptInput value={text} onValueChange={setText} onSubmit={send} isLoading={sending} className="rounded-2xl">
          <PromptInputTextarea placeholder={video.latest_version ? "Общая правка к версии или пожелание…" : "Пожелание к монтажу…"} />
          <PromptInputActions className="justify-between px-1 pt-1">
            <span className="px-2 text-xs text-muted-foreground">{pending ? `${pending} в следующую версию` : ""}</span>
            <PromptInputAction tooltip="Отправить (Enter)">
              <Button size="icon" className="size-8 rounded-full" disabled={!text.trim() || sending} onClick={send} aria-label="Отправить">
                <ArrowUp />
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  )
}
