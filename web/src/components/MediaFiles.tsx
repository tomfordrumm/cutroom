import { FileAudio, FileImage, FileVideo, Pause, Play, Trash2, Upload } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { fmtTime, upload, type MediaFile } from "@/lib/api"
import { cn } from "@/lib/utils"

export const MEDIA_ACCEPT = {
  audio: ".mp3,.wav,.m4a,.aac,.ogg,.flac",
  any: ".mp3,.wav,.m4a,.aac,.ogg,.flac,.png,.jpg,.jpeg,.webp,.gif,.svg,.mp4,.mov,.m4v,.webm",
}

/** Upload several files one after another; `urlFor(file)` gives the PUT address. */
export function useUploads(urlFor: (file: File) => string, onDone: () => unknown) {
  const [state, setState] = useState<{ name: string; index: number; total: number; percent: number } | null>(null)
  const send = async (files: File[]) => {
    if (!files.length) return
    let failed = 0
    for (const [index, file] of files.entries()) {
      setState({ name: file.name, index, total: files.length, percent: 0 })
      try {
        await upload(urlFor(file), file, (percent) => setState({ name: file.name, index, total: files.length, percent }))
      } catch (error) {
        failed += 1
        toast.error(`${file.name}: ${(error as Error).message}`, { duration: 8000 })
      }
    }
    setState(null)
    await onDone()
    if (files.length - failed > 0) toast.success(files.length === 1 ? "Файл загружен" : `Загружено файлов: ${files.length - failed}`)
  }
  return { send, state }
}

export function UploadArea({ accept, onFiles, state, label }: {
  accept: string
  onFiles: (files: File[]) => void
  state: ReturnType<typeof useUploads>["state"]
  label: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]) }}
      className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground", over && "border-primary bg-primary/5")}
    >
      <input ref={input} type="file" multiple accept={accept} hidden onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = "" }} />
      {state ? (
        <div className="grid min-w-0 flex-1 gap-1">
          <span className="truncate">{state.total > 1 ? `${state.index + 1} из ${state.total}: ` : ""}{state.name} · {state.percent}%</span>
          <Progress value={((state.index + state.percent / 100) / state.total) * 100} />
        </div>
      ) : (
        <>
          <span className="min-w-0 flex-1">{label}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}><Upload /> Выбрать файлы</Button>
        </>
      )}
    </div>
  )
}

// One player for the whole page: starting a file stops the previous one.
let shared: HTMLAudioElement | null = null
const listeners = new Set<() => void>()

function useAudio(src: string) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const update = () => setPlaying(!!shared && shared.dataset.src === src && !shared.paused)
    listeners.add(update)
    return () => { listeners.delete(update) }
  }, [src])
  const toggle = () => {
    if (shared?.dataset.src === src && !shared.paused) { shared.pause(); return }
    shared?.pause()
    shared = new Audio(src)
    shared.dataset.src = src
    const notify = () => listeners.forEach((fn) => fn())
    shared.onplay = notify
    shared.onpause = notify
    shared.onended = notify
    shared.play().catch((error: Error) => toast.error(error.message))
  }
  return { playing, toggle }
}

const ICONS = { audio: FileAudio, image: FileImage, video: FileVideo }

export function MediaRow({ file, src, onDelete, children }: { file: MediaFile; src: string; onDelete?: () => void; children?: React.ReactNode }) {
  const audio = useAudio(src)
  const Icon = ICONS[file.kind]
  const details = [file.duration != null ? fmtTime(file.duration) : null, file.width ? `${file.width}×${file.height}` : null].filter(Boolean).join(" · ")
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      {file.kind === "image" ? (
        <a href={src} target="_blank" rel="noopener" className="shrink-0"><img src={src} alt="" className="size-9 rounded object-cover" /></a>
      ) : file.kind === "audio" ? (
        <Button type="button" size="icon" variant="ghost" className="size-9 shrink-0" aria-label={audio.playing ? "Пауза" : "Слушать"} onClick={audio.toggle}>
          {audio.playing ? <Pause /> : <Play />}
        </Button>
      ) : (
        <a href={src} target="_blank" rel="noopener" className="grid size-9 shrink-0 place-items-center rounded bg-muted"><Icon className="size-4" /></a>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{file.name}</span>
        {details && <span className="block text-xs text-muted-foreground">{details}</span>}
      </span>
      {children}
      {onDelete && (
        <Button type="button" size="icon" variant="ghost" aria-label="Удалить" onClick={onDelete}><Trash2 className="size-4" /></Button>
      )}
    </div>
  )
}
