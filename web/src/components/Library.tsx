import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MEDIA_ACCEPT, MediaRow, UploadArea, useUploads } from "@/components/MediaFiles"
import { api, put, type BuiltinSounds, type Library as LibraryData } from "@/lib/api"
import { cn } from "@/lib/utils"

const HINTS: Record<string, string> = {
  music: "Ваши треки. Музыка по умолчанию идёт фоном в каждом ролике, пока вы не попросите иначе.",
  sfx: "Ваши звуковые эффекты. Агент выбирает их по названию файла, поэтому название должно говорить, что звучит: «Whoosh 1», «Mouse Click». Ниже — встроенный набор Cutroom: агент берёт из него, когда в вашей библиотеке нет подходящего звука.",
  other: "Логотипы, заставки, фоны — всё, что может пригодиться в любом ролике.",
}

/** The author's library: music, sound effects and other files shared by every video. */
export function Library() {
  const queryClient = useQueryClient()
  const library = useQuery({ queryKey: ["library"], queryFn: () => api<LibraryData>("/api/library") })
  const [tab, setTab] = useState<"music" | "sfx" | "other">("music")
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["library"] }), queryClient.invalidateQueries({ queryKey: ["state"] })])
  const uploads = useUploads((file) => `/api/library/${tab}?name=${encodeURIComponent(file.name)}`, refresh)
  const category = library.data?.categories.find((c) => c.id === tab)
  const files = category?.files ?? []

  const remove = async (name: string) => {
    if (!confirm(`Удалить «${name}» из библиотеки? Уже смонтированные версии сохранят свою копию.`)) return
    try {
      queryClient.setQueryData(["library"], await api<LibraryData>(`/api/library/${tab}/${encodeURIComponent(name)}`, { method: "DELETE" }))
      await queryClient.invalidateQueries({ queryKey: ["state"] })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  const setDefault = async (name: string | null) => {
    try {
      await put("/api/settings", { defaultMusic: name })
      await refresh()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
        {library.data?.categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setTab(c.id)}
            className={cn("rounded-md px-3 py-1.5 transition-colors", tab === c.id ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}
          >
            {c.label} <span className="text-xs text-muted-foreground">{c.files.length}</span>
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{HINTS[tab]}</p>
      <UploadArea
        accept={tab === "other" ? MEDIA_ACCEPT.any : MEDIA_ACCEPT.audio}
        onFiles={uploads.send}
        state={uploads.state}
        label="Перетащите файлы сюда — можно сразу всю папку выделить."
      />
      {files.length > 0 && (
        <div className="grid max-h-[28rem] divide-y overflow-y-auto rounded-lg border">
          {files.map((file) => {
            const isDefault = tab === "music" && library.data?.defaultMusic === file.name
            return (
              <MediaRow key={file.name} file={file} src={`/media/library/${tab}/${encodeURIComponent(file.name)}`} onDelete={() => remove(file.name)}>
                {tab === "music" && (isDefault
                  ? <button type="button" onClick={() => setDefault(null)} title="Снять"><Badge>По умолчанию</Badge></button>
                  : <Button type="button" size="sm" variant="ghost" onClick={() => setDefault(file.name)}>Сделать по умолчанию</Button>)}
              </MediaRow>
            )
          })}
        </div>
      )}
      {tab === "sfx" && library.data?.builtinSounds?.length ? <BuiltinSoundList roles={library.data.builtinSounds} /> : null}
    </div>
  )
}

/** Cutroom's built-in effects by role: listen only, they ship with the app. */
function BuiltinSoundList({ roles }: { roles: BuiltinSounds }) {
  const [open, setOpen] = useState<string | null>(null)
  const total = roles.reduce((sum, r) => sum + r.files.length, 0)
  return (
    <div className="grid gap-2">
      <div className="text-sm font-medium">Встроенные звуки Cutroom <span className="text-xs font-normal text-muted-foreground">· {total}, Kenney, CC0</span></div>
      <div className="grid divide-y rounded-lg border">
        {roles.map((r) => (
          <div key={r.role}>
            <button type="button" onClick={() => setOpen(open === r.role ? null : r.role)} className="flex w-full min-w-0 items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50">
              <span className="font-medium">{r.role}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{r.description}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{r.files.length}</span>
            </button>
            {open === r.role && (
              <div className="grid max-h-72 divide-y overflow-y-auto border-t bg-muted/20">
                {r.files.map((f) => (
                  <MediaRow key={f.name} file={{ name: f.name, kind: "audio", size: 0, duration: f.duration, width: null, height: null, hasAudio: true }} src={`/media/sounds/${r.role}/${encodeURIComponent(f.name)}`} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
