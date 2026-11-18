import { MessageSquare, Paperclip, Trash2 } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CommentFiles } from "@/components/CommentFiles"
import { fmtSpan, fmtTime, vname, type Message, type Range, type Timeline as TimelineData } from "@/lib/api"
import { cn } from "@/lib/utils"

type Props = {
  videoId: number
  timeline: TimelineData
  currentTime: number
  comments: Message[]
  /** The stretch selected for a comment; Shift + drag on the timeline makes one. */
  selection: Range | null
  onSelect: (range: Range | null) => void
  onSeek: (seconds: number) => void
  onDelete: (message: Message) => void
}

const OVERLAY_NAME: Record<string, string> = {
  title: "Плашка", fullscreen: "Полный экран", list: "Список", stat: "Цифра", lowerThird: "Подпись", callout: "Метка", zoom: "Наезд", custom: "Свой элемент",
}
const OVERLAY_COLOR: Record<string, string> = {
  title: "bg-sky-500", fullscreen: "bg-violet-500", list: "bg-indigo-500", stat: "bg-emerald-500", lowerThird: "bg-teal-500", callout: "bg-pink-500", zoom: "bg-zinc-500", custom: "bg-orange-500",
}

function tickStep(duration: number) {
  for (const step of [1, 2, 5, 10, 15, 30, 60, 120, 300]) if (duration / step <= 12) return step
  return 600
}

/** Words spoken around the playhead, the current one highlighted. One fixed-height line. */
export function SpokenLine({ timeline, currentTime }: { timeline: TimelineData; currentTime: number }) {
  const words = timeline.words.filter((w) => w.end >= currentTime - 2.2 && w.start <= currentTime + 2.2)
  return (
    <div className="h-5 min-w-0 overflow-hidden text-center text-sm leading-5 text-ellipsis whitespace-nowrap text-muted-foreground">
      {words.length ? (
        words.map((w, i) => (
          <span key={`${w.start}-${i}`} className={cn(currentTime >= w.start && currentTime <= w.end + 0.05 && "text-foreground")}>
            {i ? " " : ""}{w.text}
          </span>
        ))
      ) : (
        <span className="opacity-60">без слов</span>
      )}
    </div>
  )
}

function CommentMarker({ videoId, comment, left, onSeek, onDelete }: { videoId: number; comment: Message; left: string; onSeek: (s: number) => void; onDelete: (m: Message) => void }) {
  const pending = comment.version == null
  const files = comment.attachments ?? []
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onSeek(comment.at_seconds!)}
          aria-label={`Правка на ${fmtSpan(comment.at_seconds!, comment.end_seconds)}`}
          className={cn(
            "absolute bottom-1 z-10 grid size-6 -translate-x-1/2 place-items-center rounded-full text-white shadow ring-2 ring-background transition-transform hover:scale-110",
            pending ? "bg-amber-500" : "bg-zinc-400 dark:bg-zinc-600",
          )}
          style={{ left }}
        >
          {files.length ? <Paperclip className="size-3" /> : <MessageSquare className="size-3" />}
        </button>
      </PopoverTrigger>
      {/* React events bubble out of portals: keep the timeline from capturing this pointer */}
      <PopoverContent side="top" className="w-72 gap-2 text-sm" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">{fmtSpan(comment.at_seconds!, comment.end_seconds)}</span>
          <span>{pending ? "уйдёт в следующую версию" : `учтена в ${vname(comment.version!)}`}</span>
        </div>
        <p className="whitespace-pre-wrap break-words">{comment.body}</p>
        <CommentFiles videoId={videoId} names={files} />
        {pending && (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDelete(comment)}>
              <Trash2 /> Удалить
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function Timeline({ videoId, timeline, currentTime, comments, selection, onSelect, onSeek, onDelete }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef(false)
  // Where a Shift-drag started: the selection runs from here to the pointer.
  const anchor = useRef<number | null>(null)
  const duration = Math.max(timeline.duration, 0.001)
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`
  const ticks = useMemo(() => {
    const step = tickStep(duration)
    return Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step)
  }, [duration])

  const timeAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration))
  }

  return (
    <div className="grid min-w-0 select-none gap-1">
      {timeline.overlays.length > 0 && (
        <div className="relative h-5">
          {timeline.overlays.map((o) => (
            <Tooltip key={o.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSeek(o.start)}
                  className={cn("absolute inset-y-0.5 overflow-hidden rounded px-1 text-left text-[10px] leading-4 text-white whitespace-nowrap text-ellipsis", OVERLAY_COLOR[o.type] ?? "bg-violet-500")}
                  style={{ left: pct(o.start), width: pct(o.end - o.start) }}
                >
                  {o.label}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="font-medium">{OVERLAY_NAME[o.type] ?? o.type}{o.component ? ` · ${o.component}` : ""}</div>
                <div className="tabular-nums">{fmtTime(o.start, true)}–{fmtTime(o.end, true)}</div>
                {o.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
      <div
        ref={ref}
        className="relative h-20 cursor-pointer overflow-hidden rounded-lg border bg-muted/50"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          const t = timeAt(e.clientX)
          if (e.shiftKey) {
            anchor.current = t
            onSelect(null)
          }
          onSeek(t)
        }}
        onPointerMove={(e) => {
          const t = timeAt(e.clientX)
          setHover(t)
          if (!dragging.current) return
          if (anchor.current !== null) {
            onSelect({ start: Math.min(anchor.current, t), end: Math.max(anchor.current, t) })
            onSeek(Math.min(anchor.current, t))
          } else onSeek(t)
        }}
        onPointerUp={(e) => {
          if (anchor.current !== null) {
            const t = timeAt(e.clientX)
            const range = { start: Math.min(anchor.current, t), end: Math.max(anchor.current, t) }
            // A Shift-click without a drag selects nothing.
            onSelect(range.end - range.start >= 0.1 ? { start: Math.round(range.start * 10) / 10, end: Math.round(range.end * 10) / 10 } : null)
            onSeek(range.start)
          }
          anchor.current = null
          dragging.current = false
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* kept pieces of the recording, each a block; boundaries are cuts */}
        {timeline.segments.map((s, i) => (
          <div
            key={i}
            className={cn("absolute inset-y-0 border-r border-primary/40", i % 2 ? "bg-primary/[0.04]" : "bg-primary/[0.08]")}
            style={{ left: pct(s.programStart), width: pct(s.programEnd - s.programStart) }}
          />
        ))}
        {timeline.waveform && (
          <img src={timeline.waveform} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full object-fill opacity-70 dark:opacity-50 dark:invert" />
        )}
        {/* commented stretches: a band along the bottom, the marker sits at its start */}
        {comments.filter((c) => c.end_seconds != null).map((c) => (
          <div
            key={`band-${c.id}`}
            className={cn("pointer-events-none absolute bottom-0 h-1.5 rounded-t-sm", c.version == null ? "bg-amber-500/70" : "bg-zinc-400/70 dark:bg-zinc-600/70")}
            style={{ left: pct(c.at_seconds!), width: pct(c.end_seconds! - c.at_seconds!) }}
          />
        ))}
        {selection && (
          <div className="pointer-events-none absolute inset-y-0 border-x-2 border-amber-500 bg-amber-400/20" style={{ left: pct(selection.start), width: pct(selection.end - selection.start) }} />
        )}
        {hover !== null && (
          <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30" style={{ left: pct(hover) }}>
            <span className="absolute top-0 left-1 rounded bg-foreground px-1 text-[10px] text-background tabular-nums">{fmtTime(hover, true)}</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-500" style={{ left: pct(currentTime) }}>
          <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-red-500" />
        </div>
        {comments.map((c) => (
          <CommentMarker key={c.id} videoId={videoId} comment={c} left={pct(c.at_seconds!)} onSeek={onSeek} onDelete={onDelete} />
        ))}
      </div>
      <div className="relative h-4 overflow-hidden text-[10px] text-muted-foreground">
        {ticks.map((t, i) => (
          <span key={t} className={cn("absolute tabular-nums", i === 0 ? "" : "-translate-x-1/2")} style={{ left: pct(t) }}>{fmtTime(t)}</span>
        ))}
      </div>
    </div>
  )
}
