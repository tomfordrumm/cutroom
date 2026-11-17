import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Check, Download, ExternalLink, Loader2, Trash2, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api, post, put, upload, type Engines } from "@/lib/api"

/** Clip engines: HyperFrames ships with Cutroom, onetake is installed here after its licence. */
export function EngineSettings() {
  const queryClient = useQueryClient()
  const engines = useQuery({
    queryKey: ["engines"],
    queryFn: () => api<Engines>("/api/engines"),
    // While onetake installs, the step changes on the server.
    refetchInterval: (query) => (query.state.data?.engines.some((e) => e.installing) ? 2000 : false),
  })
  const [accepted, setAccepted] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const set = (data: Engines) => queryClient.setQueryData(["engines"], data)
  const act = async (fn: () => Promise<Engines>, done?: string) => {
    try {
      set(await fn())
      if (done) toast.success(done)
    } catch (error) {
      toast.error((error as Error).message, { duration: 10000 })
    }
  }

  const hyperframes = engines.data?.engines.find((e) => e.id === "hyperframes")
  const onetake = engines.data?.engines.find((e) => e.id === "onetake")
  if (!hyperframes || !onetake) return null

  const sendPro = async (file: File) => {
    setProgress(0)
    try {
      set(await upload<Engines>("/api/engines/onetake/pro", file, setProgress))
      toast.success("onetake Pro установлен")
    } catch (error) {
      toast.error((error as Error).message, { duration: 10000 })
    } finally {
      setProgress(null)
      if (input.current) input.current.value = ""
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Монтаж, субтитры и графика поверх автора делаются на Remotion. Движки клипов агент берёт для отдельной полноэкранной сцены с настоящей анимацией: собирает её как свой проект, рендерит в видео и ставит в ролик вставкой.
      </p>

      <div className="grid gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">HyperFrames</span>
          <Badge variant="secondary">{hyperframes.version}</Badge>
          <Badge variant="outline">{hyperframes.license}</Badge>
          <span className="text-xs text-muted-foreground">встроен в Cutroom</span>
        </div>
        <p className="text-sm text-muted-foreground">HTML, CSS и GSAP от HeyGen: каталог готовых блоков, графика с прозрачным фоном поверх автора. Бесплатно для любых роликов, в том числе коммерческих.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={hyperframes.enabled} disabled={!hyperframes.installed} onChange={(e) => act(() => put<Engines>("/api/engines/hyperframes", { enabled: e.target.checked }))} />
          Агент может делать клипы на HyperFrames
        </label>
        {!hyperframes.installed && <p className="text-sm text-destructive">Движок не найден в образе Cutroom.</p>}
      </div>

      <div className="grid gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">onetake</span>
          {onetake.installed && <Badge variant={onetake.edition === "pro" ? "default" : "secondary"}>{onetake.edition === "pro" ? "Pro" : "бесплатная версия"}</Badge>}
          <Badge variant="outline">{onetake.edition === "pro" ? "коммерческая лицензия" : onetake.license}</Badge>
          <a href={onetake.homepage} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">GitHub <ExternalLink className="size-3" /></a>
        </div>
        <p className="text-sm text-muted-foreground">Моушен-фильм из одной композиции: библиотека из 39 движений, камера, перенос между битами без слайдов, проверка ритма до показа, размытие в движении. Подходит для промо-вставки или объяснения на весь кадр.</p>

        {onetake.edition !== "pro" && (
          <div className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="grid gap-1">
              <span>Бесплатная версия onetake разрешена только для некоммерческого использования: личные ролики, учёба, исследования. Ролики для клиентов, бизнеса и монетизации требуют onetake Pro.</span>
              <span className="text-muted-foreground">Cutroom не распространяет onetake: он скачается из официального репозитория автора, и соблюдение лицензии — ваша ответственность. <a className="underline" href={onetake.licenseUrl} target="_blank" rel="noopener">Текст лицензии</a> · <a className="underline" href={onetake.proUrl} target="_blank" rel="noopener">купить onetake Pro</a></span>
            </div>
          </div>
        )}

        {onetake.installing ? (
          <div className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />{onetake.installing.step}… Это несколько минут: Python-библиотеки и браузер для рендера.</div>
        ) : !onetake.installed ? (
          <div className="grid gap-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              Я прочитал условия: бесплатную версию использую только некоммерчески, для коммерческих роликов куплю onetake Pro.
            </label>
            <div><Button disabled={!accepted} onClick={() => act(() => post<Engines>("/api/engines/onetake/install", { acceptLicense: true }))}><Download />Установить onetake</Button></div>
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={onetake.enabled} onChange={(e) => act(() => put<Engines>("/api/engines/onetake", { enabled: e.target.checked }))} />
              Агент может делать клипы на onetake
            </label>
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" />Установлен {onetake.installedAt ? new Date(onetake.installedAt).toLocaleDateString("ru") : ""}, версия {onetake.revision}{onetake.acceptedAt ? ` · условия приняты ${new Date(onetake.acceptedAt).toLocaleDateString("ru")}` : ""}</p>
            <div className="flex flex-wrap gap-2">
              {onetake.edition !== "pro" && (
                <>
                  <input ref={input} type="file" accept=".zip" hidden onChange={(e) => e.target.files?.[0] && sendPro(e.target.files[0])} />
                  <Button variant="outline" disabled={progress !== null} onClick={() => input.current?.click()}><Upload />{progress !== null ? `Загружаю ${progress}%` : "Установить onetake Pro из архива"}</Button>
                </>
              )}
              <Button variant="ghost" onClick={() => confirm("Удалить onetake? Уже отрендеренные клипы в версиях останутся.") && act(() => api<Engines>("/api/engines/onetake", { method: "DELETE" }), "onetake удалён")}><Trash2 />Удалить</Button>
            </div>
          </div>
        )}
        {onetake.error && <p className="text-sm text-destructive">Установка не удалась: {onetake.error}</p>}
      </div>
    </div>
  )
}
