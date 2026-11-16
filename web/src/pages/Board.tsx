import { useQuery } from "@tanstack/react-query"
import { FileVideo, Plus, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { JobStatus } from "@/components/JobStatus"
import { MEDIA_ACCEPT } from "@/components/MediaFiles"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { api, fmtDate, fmtUsage, fmtUsd, isActive, post, STAGES, upload, vname, type Video } from "@/lib/api"

function VideoCard({ video }: { video: Video }) {
  const showJob = isActive(video.job) || (video.job != null && video.job.status === "failed" && video.stage !== "accepted")
  return (
    <Link
      to={`/video/${video.id}`}
      className="block rounded-xl border bg-card p-3.5 shadow-xs transition-colors hover:border-foreground/30"
    >
      <div className="font-medium leading-snug">{video.title}</div>
      {video.brief && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{video.brief}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {video.latest_version && <Badge variant="secondary">{vname(video.latest_version)}</Badge>}
        {video.accepted_version && <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">принята {vname(video.accepted_version)}</Badge>}
        {video.usage?.runs > 0 && video.usage.costUsd != null && <span title={`Агент: ${fmtUsage(video.usage)}, по ценам API`}>{fmtUsd(video.usage.costUsd)}</span>}
        <span className="ml-auto">{fmtDate(video.updated_at)}</span>
      </div>
      {showJob && <JobStatus job={video.job} className="mt-3" />}
    </Link>
  )
}

const AUTO_EDIT_KEY = "cutroom:new-video-auto-edit"
function readAutoEdit() {
  try { return localStorage.getItem(AUTO_EDIT_KEY) !== "0" } catch { return true }
}

const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim()
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes > 1024 ** 3 ? 0 : 1)} МБ`

/** New video: the recording goes in right here, so the video page opens ready to edit. */
function NewVideoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [title, setTitle] = useState("")
  const [titleTouched, setTitleTouched] = useState(false)
  const [brief, setBrief] = useState("")
  const [recording, setRecording] = useState<File | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState<{ label: string; percent: number | null } | null>(null)
  const [over, setOver] = useState(false)
  // Remembered between videos: whoever starts editing right away usually always does.
  const [autoEdit, setAutoEdit] = useState(readAutoEdit)
  const toggleAutoEdit = (value: boolean) => {
    setAutoEdit(value)
    try { localStorage.setItem(AUTO_EDIT_KEY, value ? "1" : "0") } catch { /* private mode */ }
  }
  const picker = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const chooseRecording = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("video/") && !/\.(mov|mp4|m4v|mkv|webm|avi)$/i.test(file.name)) {
      toast.error("Нужен видеофайл записи: MOV, MP4, MKV, WebM.")
      return
    }
    setRecording(file)
    if (!titleTouched) setTitle(titleFromFile(file.name))
  }
  const reset = () => {
    setTitle(""); setTitleTouched(false); setBrief(""); setRecording(null); setFiles([])
  }
  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    let video: Video
    try {
      setBusy({ label: "Создаю ролик", percent: null })
      video = await post<Video>("/api/videos", { title, brief })
    } catch (error) {
      toast.error((error as Error).message)
      setBusy(null)
      return
    }
    let uploaded = false
    if (recording) {
      try {
        await upload(`/api/videos/${video.id}/sources?name=${encodeURIComponent(recording.name)}`, recording, (percent) => setBusy({ label: "Загружаю запись", percent }))
        uploaded = true
      } catch (error) {
        toast.error(`Запись не загрузилась: ${(error as Error).message}. Загрузите её на странице ролика.`, { duration: 10000 })
      }
    }
    for (const [index, file] of files.entries()) {
      try {
        await upload(`/api/videos/${video.id}/assets?name=${encodeURIComponent(file.name)}`, file, (percent) => setBusy({ label: `Материалы: ${index + 1} из ${files.length}`, percent }))
      } catch (error) {
        toast.error(`${file.name}: ${(error as Error).message}`)
      }
    }
    // Materials first, then editing: the agent sees everything attached.
    if (uploaded && autoEdit) {
      setBusy({ label: "Отправляю в монтаж", percent: null })
      await post(`/api/videos/${video.id}/edit`).catch((error: Error) => toast.error(`Не отправлено в монтаж: ${error.message}`, { duration: 10000 }))
    }
    setBusy(null)
    reset()
    onOpenChange(false)
    navigate(`/video/${video.id}`)
  }

  return (
    // While files are uploading the dialog stays open: closing it would lose the upload.
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent>
        <form onSubmit={create} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Новый ролик</DialogTitle>
            <DialogDescription>Запись, бриф и материалы — ролик откроется готовым к монтажу.</DialogDescription>
          </DialogHeader>
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); chooseRecording(e.dataTransfer.files[0]) }}
            onClick={() => !busy && picker.current?.click()}
            className={cn(
              "grid cursor-pointer justify-items-center gap-2 rounded-xl border-2 border-dashed p-5 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50",
              over && "border-primary bg-primary/5",
              recording && "border-solid",
            )}
          >
            <input ref={picker} type="file" accept="video/*,.mov,.mkv" hidden onChange={(e) => { chooseRecording(e.target.files?.[0]); e.target.value = "" }} />
            {recording ? (
              <>
                <FileVideo className="size-6 text-foreground" />
                <span className="max-w-full truncate font-medium text-foreground">{recording.name}</span>
                <span>{megabytes(recording.size)} · нажмите, чтобы заменить</span>
              </>
            ) : (
              <>
                <Upload className="size-6" />
                <span className="font-medium text-foreground">Перетащите запись сюда</span>
                <span>или нажмите, чтобы выбрать. Можно загрузить и позже.</span>
              </>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="title">Название</Label>
            <Input id="title" required value={title} onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }} placeholder="Почему ИИ не заменит монтажёра" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="brief">Бриф</Label>
            <Textarea id="brief" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Темп, что вырезать, длительность, формат…" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="assets">Материалы</Label>
            <Input id="assets" type="file" multiple accept={MEDIA_ACCEPT.any} onChange={(e) => setFiles([...(e.target.files ?? [])])} />
            <p className="text-xs text-muted-foreground">
              {files.length ? `Выбрано файлов: ${files.length}.` : "Картинки, видеовставки, звук для этого ролика. Можно добавить и позже."} Музыка и эффекты для всех роликов — в «Настройки → Библиотека».
            </p>
          </div>
          <label className={cn("flex items-center gap-2 text-sm", !recording && "text-muted-foreground")}>
            <input type="checkbox" className="size-4 accent-primary" checked={autoEdit} disabled={!recording || !!busy} onChange={(e) => toggleAutoEdit(e.target.checked)} />
            Сразу отправить в монтаж
            {!recording && <span className="text-xs">— когда есть запись</span>}
          </label>
          {busy && (
            <div className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">{busy.label}{busy.percent != null ? ` · ${busy.percent}%` : "…"}</span>
              <Progress value={busy.percent ?? 0} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={!!busy} onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={!!busy}>{recording ? (autoEdit ? "Создать и смонтировать" : "Создать и загрузить") : "Создать"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function BoardPage() {
  const [creating, setCreating] = useState(false)
  const { data } = useQuery({ queryKey: ["videos"], queryFn: () => api<{ videos: Video[] }>("/api/videos"), refetchInterval: 3000 })
  const videos = data?.videos ?? []
  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Ролики</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus /> Новый ролик
        </Button>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STAGES.map(([stage, label]) => {
          const items = videos.filter((v) => v.stage === stage)
          return (
            <section key={stage} className="min-h-60 rounded-2xl bg-muted/60 p-3">
              <h2 className="mb-3 flex justify-between px-1 text-sm font-medium text-muted-foreground">
                {label}
                <span>{items.length}</span>
              </h2>
              <div className="grid gap-2.5">
                {items.map((video) => <VideoCard key={video.id} video={video} />)}
                {!items.length && (
                  <p className="px-1 py-4 text-sm text-muted-foreground">{stage === "draft" ? "Нажмите «Новый ролик» и добавьте запись" : "Пусто"}</p>
                )}
              </div>
            </section>
          )
        })}
      </div>
      <NewVideoDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
