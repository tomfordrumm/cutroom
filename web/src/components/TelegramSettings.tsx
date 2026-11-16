import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, post, put, type NotifyEvent, type Telegram } from "@/lib/api"

/** The author's own Telegram bot writes when a video waits for them. */
export function TelegramSettings() {
  const queryClient = useQueryClient()
  const telegram = useQuery({ queryKey: ["telegram"], queryFn: () => api<Telegram>("/api/telegram") })
  const [token, setToken] = useState("")
  const [publicUrl, setPublicUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [bindError, setBindError] = useState<string | null>(null)
  const data = telegram.data
  const waiting = Boolean(data?.configured && !data.connected)

  useEffect(() => { if (data) setPublicUrl(data.publicUrl ?? "") }, [data?.publicUrl])

  // While the author opens the bot and presses Start, look for their /start.
  useEffect(() => {
    if (!waiting || bindError) return
    const timer = setInterval(async () => {
      try {
        const next = await post<Telegram>("/api/telegram/bind")
        queryClient.setQueryData(["telegram"], next)
        if (next.connected) toast.success("Telegram подключён")
      } catch (error) {
        setBindError((error as Error).message)
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [waiting, bindError, queryClient])

  const run = async (action: () => Promise<Telegram>, done?: string) => {
    setBusy(true)
    try {
      queryClient.setQueryData(["telegram"], await action())
      if (done) toast.success(done)
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveToken = async () => {
    if (await run(() => post<Telegram>("/api/telegram/token", { token, publicUrl: location.origin }))) setToken("")
  }
  const toggle = (event: NotifyEvent, value: boolean) => run(() => put<Telegram>("/api/telegram", { events: { [event]: value } }))
  const saveUrl = () => run(() => put<Telegram>("/api/telegram", { publicUrl: publicUrl || null }), "Адрес сохранён")

  if (!data) return null
  const local = !data.publicUrl || /^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0|10\.|192\.168\.)/.test(data.publicUrl)

  return (
    <div className="grid gap-5">
      {!data.configured && (
        <div className="grid gap-2">
          <Label htmlFor="tg-token">Токен бота</Label>
          <p className="text-sm text-muted-foreground">
            Создайте бота в{" "}
            <a className="underline underline-offset-2" href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>{" "}
            командой <code className="rounded bg-muted px-1">/newbot</code> и вставьте токен, который он пришлёт. Токен хранится на сервере Cutroom и в браузер не возвращается.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input id="tg-token" className="min-w-0 flex-1 font-mono" placeholder="123456789:AA…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
            <Button onClick={saveToken} disabled={!token.trim() || busy}>Подключить</Button>
          </div>
        </div>
      )}

      {waiting && (
        <div className="grid gap-2 rounded-lg border p-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin" /> Бот @{data.bot} найден. Осталось открыть его и нажать «Start»
          </span>
          <p className="text-muted-foreground">Ссылка одноразовая: так Cutroom узнает ваш чат и не примет чужой. Страница сама увидит, когда вы нажмёте «Start».</p>
          {bindError && (
            <p className="text-destructive">
              {bindError}{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => setBindError(null)}>Проверить снова</button>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {data.link && (
              <Button asChild>
                <a href={data.link} target="_blank" rel="noreferrer"><ExternalLink /> Открыть бота</a>
              </Button>
            )}
            <Button variant="ghost" onClick={() => run(() => api<Telegram>("/api/telegram", { method: "DELETE" }))} disabled={busy}>Другой бот</Button>
          </div>
        </div>
      )}

      {data.connected && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex flex-wrap items-center gap-2">
              <Badge>Подключено</Badge> @{data.bot} пишет в чат {data.chatName}
            </span>
            <span className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => run(() => post<Telegram>("/api/telegram/test"), "Тестовое сообщение отправлено")} disabled={busy}>Отправить тест</Button>
              <Button variant="ghost" size="sm" onClick={() => run(() => api<Telegram>("/api/telegram", { method: "DELETE" }), "Telegram отключён")} disabled={busy}>Отключить</Button>
            </span>
          </div>
          <div className="grid gap-2">
            <Label>Когда писать</Label>
            {(Object.keys(data.eventLabels) as NotifyEvent[]).map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={data.events[event]} disabled={busy} onChange={(e) => toggle(event, e.target.checked)} />
                {data.eventLabels[event]}
              </label>
            ))}
          </div>
        </>
      )}

      {data.configured && (
        <div className="grid gap-2">
          <Label htmlFor="tg-url">Адрес Cutroom для ссылок</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="tg-url" className="min-w-0 flex-1" placeholder="https://cutroom.example.com" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />
            <Button variant="outline" onClick={saveUrl} disabled={busy || publicUrl === (data.publicUrl ?? "")}>Сохранить</Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {local
              ? "Это адрес на этом компьютере: ссылка откроется здесь, но не с телефона. Если Telegram не примет его в кнопке, ссылка придёт текстом. Для телефона укажите адрес сервера с доменом."
              : "В сообщении будет кнопка «Открыть ролик» с этим адресом."}
          </p>
        </div>
      )}

      {data.lastError && <p className="text-sm text-destructive">Последнее уведомление не отправлено: {data.lastError.message}</p>}
    </div>
  )
}
