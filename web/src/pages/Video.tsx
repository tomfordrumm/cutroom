import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft, Check, Download, FileJson, FileVideo, Maximize, MessageSquarePlus, Pause, Play, RotateCcw, ScrollText, Square,
  Upload, Volume2, VolumeX, Wand2,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { useAppState } from "@/App"
import { SpokenLine, Timeline } from "@/components/Timeline"
import { VideoAssets } from "@/components/VideoAssets"
import { VideoChat } from "@/components/VideoChat"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  api, fmtTime, isActive, patch, post, STAGE_LABEL, upload, vname, type Message, type Timeline as TimelineData, type VideoDetail,
} from "@/lib/api"
import { cn } from "@/lib/utils"

const STAGE_TONE: Record<string, string> = {
  draft: "",
  editing: "text-amber-600 dark:text-amber-400",
  review: "text-sky-600 dark:text-sky-400",
  accepted: "text-emerald-600 dark:text-emerald-400",
}

function typingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || !!el.closest(".xterm"))
}

function SourceUpload({ video, compact = false }: { video: VideoDetail; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [over, setOver] = useState(false)
  const queryClient = useQueryClient()
  const send = async (file: File) => {
    setProgress(0)
    try {
      await upload(`/api/videos/${video.id}/sources?name=${encodeURIComponent(file.name)}`, file, setProgress)
      await queryClient.invalidateQueries({ queryKey: ["video", video.id] })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setProgress(null)
    }
  }
  const picker = <input ref={input} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
  if (compact) {
    return (
      <>
        {picker}
        <Button size="sm" variant="outline" disabled={progress !== null} onClick={() => input.current?.click()}>
          <Upload /> {progress !== null ? `${progress}%` : "Заменить"}
        </Button>
      </>
    )
  }
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) send(f) }}
      className={cn("grid aspect-video w-full place-content-center justify-items-center gap-3 rounded-2xl border-2 border-dashed text-muted-foreground", over && "border-primary bg-primary/5")}
    >
      {picker}
      <Upload className="size-8" />
      <div>Перетащите запись сюда</div>
      {progress !== null ? <Progress value={progress} className="w-48" /> : <Button variant="outline" onClick={() => input.current?.click()}>Выбрать файл</Button>}
    </div>
  )
}

/** Popover for a comment pinned to one moment of a version. Enter adds it, Shift+Enter is a new line. */
function CommentComposer({ videoId, version, at, onDone }: { videoId: number; version: number; at: number; onDone: (added: boolean) => void }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const add = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await post(`/api/videos/${videoId}/messages`, { body: text, refVersion: version, atSeconds: at })
      onDone(true)
    } catch (error) {
      toast.error((error as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-2">
      <div className="text-xs text-muted-foreground">Правка к <span className="font-medium text-foreground tabular-nums">{fmtTime(at, true)}</span> · {vname(version)}</div>
      <Textarea
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add() }
          if (e.key === "Escape") onDone(false)
        }}
        placeholder="Что поправить в этом месте?"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Enter — добавить</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => onDone(false)}>Отмена</Button>
          <Button size="sm" disabled={!text.trim() || busy} onClick={add}>Добавить</Button>
        </div>
      </div>
    </div>
  )
}

function LogDialog({ videoId, version, open, onOpenChange }: { videoId: number; version: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const log = useQuery({ queryKey: ["log", videoId, version], queryFn: () => api<string>(`/api/videos/${videoId}/versions/${version}/log`), enabled: open })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader><DialogTitle>Лог агента {vname(version)}</DialogTitle></DialogHeader>
        <pre className="max-h-[65vh] overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{log.data ?? "Загружаю…"}</pre>
      </DialogContent>
    </Dialog>
  )
}

export default function VideoPage() {
  const id = Number(useParams().id)
  const queryClient = useQueryClient()
  const { data: state } = useAppState()
  const video = useQuery({ queryKey: ["video", id], queryFn: () => api<VideoDetail>(`/api/videos/${id}`), refetchInterval: 2000 })
  const data = video.data

  const [selected, setSelected] = useState<number | null>(null)
  const [followLatest, setFollowLatest] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [commentAt, setCommentAt] = useState<number | null>(null)
  const [brief, setBrief] = useState<string | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingSeek = useRef<number | null>(null)

  const latest = data?.latest_version ?? null
  const versionNumber = followLatest || !data?.versions.some((v) => v.number === selected) ? latest : selected
  const version = data?.versions.find((v) => v.number === versionNumber) ?? null
  const timeline = useQuery({
    queryKey: ["timeline", id, versionNumber],
    queryFn: () => api<TimelineData>(`/api/videos/${id}/versions/${versionNumber}/timeline`),
    enabled: versionNumber != null,
    staleTime: Infinity,
  })

  // Smooth playhead while playing; `timeupdate` alone fires only ~4 times a second.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const seek = useCallback((t: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = t
    setCurrentTime(t)
  }, [])
  const togglePlay = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) el.play()
    else el.pause()
  }, [])
  const openComment = useCallback(() => {
    if (versionNumber == null) return
    videoRef.current?.pause()
    setCommentAt(Math.round((videoRef.current?.currentTime ?? 0) * 10) / 10)
  }, [versionNumber])
  const jump = useCallback((v: number, at: number) => {
    if (v === versionNumber) seek(at)
    else {
      pendingSeek.current = at
      setFollowLatest(v === latest)
      setSelected(v)
    }
  }, [versionNumber, latest, seek])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const el = videoRef.current
      if (!el) return
      if (e.key === " " || e.key === "k" || e.key === "л") { e.preventDefault(); togglePlay() }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(Math.max(0, el.currentTime - (e.shiftKey ? 5 : 1))) }
      else if (e.key === "ArrowRight") { e.preventDefault(); seek(Math.min(el.duration || 0, el.currentTime + (e.shiftKey ? 5 : 1))) }
      else if (e.key === "c" || e.key === "с") { e.preventDefault(); openComment() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [togglePlay, seek, openComment])

  if (!data) return null
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["video", id] })
  const act = (path: string) => post(`/api/videos/${id}/${path}`).then(refresh).catch((e: Error) => toast.error(e.message))
  const running = isActive(data.job)
  const base = version ? `/media/videos/${id}/versions/${version.number}` : null
  const src = version?.files.includes("preview.mp4") ? `${base}/preview.mp4` : data.sources[0] ? `/media/videos/${id}/sources/${encodeURIComponent(data.sources[0])}` : null
  const pins = data.messages.filter((m) => m.role === "user" && m.ref_version === versionNumber && m.at_seconds != null)
  const pendingPins = data.messages.filter((m) => m.role === "user" && m.version == null && m.at_seconds != null).length
  const deleteComment = (m: Message) =>
    api(`/api/videos/${id}/messages/${m.id}`, { method: "DELETE" }).then(refresh).catch((e: Error) => toast.error(e.message))
  const duration = timeline.data?.duration ?? videoRef.current?.duration ?? 0

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <Link to="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Ролики</Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
            <Badge variant="outline" className={STAGE_TONE[data.stage]}>{STAGE_LABEL[data.stage]}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button variant="outline" onClick={() => act("cancel")}><Square /> Остановить</Button>
          ) : (
            <>
              {data.stage !== "accepted" && (
                <Button variant={latest ? "outline" : "default"} disabled={!data.sources.length} onClick={() => act("edit")}>
                  <Wand2 /> {latest ? "Перемонтировать" : "Отправить в монтаж"}
                </Button>
              )}
              {data.stage === "review" && latest && <Button onClick={() => act("accept")}><Check /> Принять {vname(latest)}</Button>}
              {data.stage === "accepted" && <Button variant="outline" onClick={() => act("reopen")}><RotateCcw /> Вернуть на доработку</Button>}
            </>
          )}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid min-w-0 gap-4">
          {data.versions.length > 0 && (
            <Tabs value={String(versionNumber)} onValueChange={(v) => { const n = Number(v); setSelected(n); setFollowLatest(n === latest) }}>
              <TabsList>
                {data.versions.map((v) => (
                  <TabsTrigger key={v.number} value={String(v.number)} className="tabular-nums">
                    {vname(v.number)}{v.number === data.accepted_version && <Check className="size-3.5 text-emerald-500" />}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {src ? (
            <Card className="gap-0 overflow-hidden py-0">
              <div className="relative bg-black">
                <video
                  key={src}
                  ref={videoRef}
                  src={src}
                  muted={muted}
                  playsInline
                  preload="metadata"
                  className="mx-auto block max-h-[58vh] w-full cursor-pointer object-contain"
                  onClick={togglePlay}
                  onPlay={() => setPlaying(true)}
                  onPause={() => { setPlaying(false); setCurrentTime(videoRef.current?.currentTime ?? 0) }}
                  onTimeUpdate={() => !playing && setCurrentTime(videoRef.current?.currentTime ?? 0)}
                  onLoadedMetadata={() => {
                    if (pendingSeek.current != null) { seek(pendingSeek.current); pendingSeek.current = null }
                    else setCurrentTime(0)
                  }}
                />
              </div>
              <CardContent className="grid gap-3 p-3">
                {/* fixed widths: the row must not shift while the time and words change */}
                <div className="flex items-center gap-2">
                  <Button size="icon" variant="ghost" className="shrink-0" onClick={togglePlay} aria-label={playing ? "Пауза" : "Играть"}>{playing ? <Pause /> : <Play />}</Button>
                  <span className="w-[6.75rem] shrink-0 text-sm tabular-nums text-muted-foreground">{fmtTime(currentTime, true)} / {fmtTime(duration)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {pendingPins ? `${pendingPins} правок ждут перемонтажа` : ""}
                  </span>
                  {version && (
                    <Popover open={commentAt !== null} onOpenChange={(open) => !open && setCommentAt(null)}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <PopoverAnchor asChild>
                            <Button size="sm" className="shrink-0" onClick={openComment}><MessageSquarePlus /> Комментарий</Button>
                          </PopoverAnchor>
                        </TooltipTrigger>
                        <TooltipContent>Правка к текущей секунде · клавиша C</TooltipContent>
                      </Tooltip>
                      <PopoverContent align="end" className="w-80" onOpenAutoFocus={(e) => e.preventDefault()}>
                        {commentAt !== null && (
                          <CommentComposer
                            key={commentAt}
                            videoId={id}
                            version={version.number}
                            at={commentAt}
                            onDone={(added) => { setCommentAt(null); if (added) { refresh(); toast.success("Правка добавлена на таймлайн") } }}
                          />
                        )}
                      </PopoverContent>
                    </Popover>
                  )}
                  <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setMuted((m) => !m)} aria-label="Звук">{muted ? <VolumeX /> : <Volume2 />}</Button>
                  <Button size="icon" variant="ghost" className="shrink-0" onClick={() => videoRef.current?.requestFullscreen()} aria-label="Во весь экран"><Maximize /></Button>
                </div>
                {timeline.data && <SpokenLine timeline={timeline.data} currentTime={currentTime} />}
                {timeline.data && <Timeline timeline={timeline.data} currentTime={currentTime} comments={pins} onSeek={seek} onDelete={deleteComment} />}
                {!version && <p className="text-xs text-muted-foreground">Это исходник. Таймлайн и комментарии к секунде появятся у первой версии.</p>}
              </CardContent>
            </Card>
          ) : (
            <SourceUpload video={data} />
          )}

          {version && base && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-sm text-muted-foreground">
                {fmtTime(version.durationSeconds)} · вырезано {fmtTime(version.removedSeconds)} · {state?.agentLabels[version.agent ?? "none"] ?? version.agent}{version.model ? ` · ${version.model}` : ""}
              </span>
              {version.files.includes("final.mp4") && <Button size="sm" asChild><a href={`${base}/final.mp4?download`}><Download /> Финал</a></Button>}
              <Button size="sm" variant="outline" asChild><a href={`${base}/preview.mp4?download`}><FileVideo /> Превью</a></Button>
              {version.files.includes("cut.mp4") && (timeline.data?.overlays.length ?? 0) > 0 && (
                <Button size="sm" variant="outline" asChild><a href={`${base}/cut.mp4?download`}><FileVideo /> Без графики</a></Button>
              )}
              <Button size="sm" variant="ghost" asChild><a href={`${base}/edit.json`} target="_blank" rel="noopener"><FileJson /> edit.json</a></Button>
              {version.agent && version.agent !== "none" && <Button size="sm" variant="ghost" onClick={() => setLogOpen(true)}><ScrollText /> Лог агента</Button>}
              <LogDialog videoId={id} version={version.number} open={logOpen} onOpenChange={setLogOpen} />
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Исходник</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 text-sm">
                {data.sources.length ? <><span className="truncate">{data.sources[0]}</span><SourceUpload video={data} compact /></> : <span className="text-muted-foreground">Загрузите запись: один файл на ролик.</span>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Бриф</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                <Textarea rows={4} value={brief ?? data.brief} onChange={(e) => setBrief(e.target.value)} placeholder="Пожелания к монтажу этого ролика" />
                {brief !== null && brief !== data.brief && (
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => patch(`/api/videos/${id}`, { brief }).then(() => { setBrief(null); refresh(); toast.success("Бриф сохранён") }).catch((e: Error) => toast.error(e.message))}>
                      Сохранить бриф
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-sm">Материалы</CardTitle></CardHeader>
            <CardContent>
              <VideoAssets video={data} />
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:h-[calc(100svh-6.5rem)]">
          <VideoChat video={data} onJump={jump} onSent={refresh} />
        </div>
      </div>
    </div>
  )
}
