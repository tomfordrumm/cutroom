import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Package, Trash2, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api, put, upload, type Packs } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Taste packs: choose the active one, install a .zip, remove an installed one. */
export function PackPicker() {
  const queryClient = useQueryClient()
  const packs = useQuery({ queryKey: ["packs"], queryFn: () => api<Packs>("/api/packs") })
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["packs"] }), queryClient.invalidateQueries({ queryKey: ["state"] })])
  const choose = async (id: string) => {
    try {
      await put("/api/settings", { pack: id })
      await refresh()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  const install = async (file: File) => {
    setProgress(0)
    try {
      const result = await upload<Packs & { installed: { id: string; name: string } }>("/api/packs/upload", file, setProgress)
      await put("/api/settings", { pack: result.installed.id })
      await refresh()
      toast.success(`Пакет «${result.installed.name}» установлен и выбран`)
    } catch (error) {
      toast.error((error as Error).message, { duration: 10000 })
    } finally {
      setProgress(null)
      if (input.current) input.current.value = ""
    }
  }
  const remove = async (id: string, name: string) => {
    if (!confirm(`Удалить пакет «${name}»? Уже смонтированные версии сохранят свою копию.`)) return
    try {
      await api(`/api/packs/${id}`, { method: "DELETE" })
      await refresh()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {packs.data?.packs.map((pack) => {
          const active = packs.data?.active === pack.id
          return (
            <div
              key={pack.id}
              role="button"
              tabIndex={0}
              onClick={() => !pack.error && choose(pack.id)}
              onKeyDown={(e) => e.key === "Enter" && !pack.error && choose(pack.id)}
              className={cn(
                "grid gap-1.5 rounded-xl border bg-card p-4 text-left transition-colors",
                pack.error ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:border-foreground/30",
                active && "border-primary ring-1 ring-primary",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Package className="size-4 text-muted-foreground" />
                <span className="font-medium">{pack.name}</span>
                <span className="text-xs text-muted-foreground">{pack.version}</span>
                {pack.builtin && <Badge variant="secondary">встроенный</Badge>}
                {active && <Badge>выбран</Badge>}
                {!pack.builtin && (
                  <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label="Удалить пакет" onClick={(e) => { e.stopPropagation(); remove(pack.id, pack.name) }}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
              {pack.error ? (
                <span className="flex gap-1.5 whitespace-pre-line text-xs text-destructive"><AlertTriangle className="mt-0.5 size-3.5 flex-none" />{pack.error}</span>
              ) : (
                <>
                  {pack.description && <span className="text-sm text-muted-foreground">{pack.description}</span>}
                  {(pack.author || pack.license) && <span className="text-xs text-muted-foreground">{[pack.author, pack.license].filter(Boolean).join(" · ")}</span>}
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={(e) => e.target.files?.[0] && install(e.target.files[0])} />
        <Button type="button" variant="outline" disabled={progress !== null} onClick={() => input.current?.click()}>
          <Upload /> {progress === null ? "Установить пакет (.zip)" : `Загрузка ${progress}%`}
        </Button>
        <span className="text-xs text-muted-foreground">В пакете код компонентов и инструкции агенту — ставьте пакеты только из доверенных источников.</span>
      </div>
    </div>
  )
}
