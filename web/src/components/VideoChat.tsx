import { ArrowUp, MapPin } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { JobStatus } from "@/components/JobStatus"
import { Button } from "@/components/ui/button"
import { ChatContainerContent, ChatContainerRoot } from "@/components/ui/chat-container"
import { Message, MessageContent } from "@/components/ui/message"
import { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input"
import { ScrollButton } from "@/components/ui/scroll-button"
import { fmtDate, fmtTime, isActive, post, vname, type VideoDetail } from "@/lib/api"
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

export function VideoChat({ video, onJump, onSent }: Props) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)

  const pending = video.messages.filter((m) => m.role === "user" && m.version == null).length
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
          {video.messages.map((m) => {
            if (m.role === "system") {
              return <div key={m.id} className="px-4 text-center text-xs text-muted-foreground">{m.body}</div>
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
              </Message>
            )
          })}
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
