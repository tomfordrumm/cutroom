import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUpCircle, Check, Copy, Hammer, Pause, RefreshCw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api, type VersionInfo } from "@/lib/api"

export const versionQuery = { queryKey: ["version"], queryFn: () => api<VersionInfo>("/api/version"), staleTime: 10 * 60 * 1000 }

/** Which Cutroom runs here, whether a newer one is out, and the command that updates it. */
export function VersionSettings() {
  const queryClient = useQueryClient()
  const { data } = useQuery(versionQuery)
  const [checking, setChecking] = useState(false)
  if (!data) return null

  const check = async () => {
    setChecking(true)
    try {
      const fresh = await api<VersionInfo>("/api/version?refresh=1")
      queryClient.setQueryData(["version"], fresh)
      if (fresh.checkError) toast.error(`Не удалось проверить: ${fresh.checkError}`)
      else toast.success(fresh.updateAvailable ? `Доступна версия ${fresh.latest}` : "Установлена последняя версия")
    } finally {
      setChecking(false)
    }
  }
  const dir = data.installDir ?? "/opt/cutroom"
  const command = `cd ${dir} && sudo ./update.sh`
  const copy = () => navigator.clipboard.writeText(command).then(() => toast.success("Команда скопирована"), () => toast.error("Не удалось скопировать"))

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">Cutroom {data.version}</span>
        {data.revision && <span className="font-mono text-xs text-muted-foreground">{data.revision.slice(0, 7)}</span>}
        {data.source === "local"
          ? <Badge variant="secondary"><Hammer className="size-3" />собран из исходников</Badge>
          : data.updateAvailable
            ? <Badge><ArrowUpCircle className="size-3" />доступна {data.latest}</Badge>
            : data.latest && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" />последняя версия</span>}
      </div>

      {data.paused && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <Pause className="size-4 shrink-0" />
          Идёт обновление: начатый монтаж доработает, новые ролики ждут в очереди и начнутся после перезапуска.
        </p>
      )}

      {data.source === "published" ? (
        <div className="grid gap-2 text-sm">
          <p className="text-muted-foreground">
            {data.updateAvailable
              ? `Вышла версия ${data.latest}. Обновите на сервере командой ниже.`
              : "Обновление ставится командой на сервере."}{" "}
            Скрипт скачает новую версию, дождётся конца идущего монтажа (новые ролики подождут в очереди) и перезапустит Cutroom. Ролики, версии, настройки и вход в агентов сохранятся.
          </p>
          <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">
            <span className="min-w-0 flex-1 truncate">{command}</span>
            <Button size="icon" variant="ghost" className="size-7" onClick={copy} aria-label="Скопировать команду"><Copy className="size-3.5" /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={check} disabled={checking}><RefreshCw className={checking ? "animate-spin" : ""} />Проверить сейчас</Button>
            {data.checkedAt && <span className="text-xs text-muted-foreground">Проверено {new Date(data.checkedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}{data.checkError ? ` · ошибка: ${data.checkError}` : ""}</span>}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Этот Cutroom собран из исходников. Обновление: получите новый код (git pull), затем <span className="font-mono text-xs">./update.sh</span> в папке checkout — он соберёт образ, дождётся конца монтажа и перезапустит.
        </p>
      )}
    </div>
  )
}
