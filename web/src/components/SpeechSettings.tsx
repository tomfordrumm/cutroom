import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Check, Plus, Trash2, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useAppState } from "@/App"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, patch, post, put, vname, type Dictionary, type DictionaryEntry } from "@/lib/api"
import { cn } from "@/lib/utils"

export const LANGUAGES: [string, string][] = [["ru", "Русский"], ["en", "English"], ["auto", "Определять автоматически"]]

/** Whisper model, recording language and the author's dictionary of terms. */
export function SpeechSettings() {
  const { data: state } = useAppState()
  const queryClient = useQueryClient()
  const dictionary = useQuery({ queryKey: ["dictionary"], queryFn: () => api<Dictionary>("/api/dictionary") })
  const [to, setTo] = useState("")
  const [from, setFrom] = useState("")

  const save = (data: Dictionary) => queryClient.setQueryData(["dictionary"], data)
  const run = async (action: () => Promise<Dictionary>, done?: string) => {
    try {
      save(await action())
      if (done) toast.success(done)
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    }
  }
  const chooseModel = async (id: string) => {
    try {
      await put("/api/settings", { whisperModel: id })
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["state"] }), queryClient.invalidateQueries({ queryKey: ["dictionary"] })])
      toast.success("Модель выбрана. Новые записи распознаются ею; уже разобранные — при следующей версии.")
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  const setLanguage = async (language: string) => {
    await put("/api/settings", { defaults: { language } })
    await queryClient.invalidateQueries({ queryKey: ["state"] })
    toast.success("Сохранено")
  }
  const add = async () => {
    if (await run(() => post<Dictionary>("/api/dictionary", { to, from: from || null }), "Добавлено в словарь")) {
      setTo("")
      setFrom("")
    }
  }

  const entries = dictionary.data?.entries ?? []
  const proposed = entries.filter((e) => e.status === "proposed")
  const active = entries.filter((e) => e.status === "active")

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Label>Модель</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {dictionary.data?.models.map((model) => {
            const current = dictionary.data?.model === model.id
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => !current && chooseModel(model.id)}
                className={cn(
                  "grid gap-1 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50",
                  current && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {model.label}
                  <span className="text-xs font-normal text-muted-foreground">{model.size}</span>
                  {current && <Badge>Выбрана</Badge>}
                  {!model.downloaded && <Badge variant="outline">скачается при первом монтаже</Badge>}
                </span>
                <span className="text-muted-foreground">{model.note}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid max-w-xs gap-2">
        <Label>Язык записей</Label>
        <Select value={state?.defaults.language ?? "ru"} onValueChange={setLanguage}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {LANGUAGES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        <div>
          <Label>Словарь</Label>
          <p className="mt-1 text-sm text-muted-foreground">
            Как вы пишете свои термины. Написание подсказывает Whisper на новых записях, а замена исправляет расшифровку и субтитры следующей версии каждого ролика. Агент предлагает замены сам; если вы назвали слово в правке, замена применяется сразу.
          </p>
        </div>

        {proposed.length > 0 && (
          <div className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="text-sm font-medium">Агент предлагает</p>
            {proposed.map((entry) => (
              <EntryRow key={entry.id} entry={entry}>
                <Button size="sm" onClick={() => run(() => patch<Dictionary>(`/api/dictionary/${entry.id}`, { status: "active" }), "Принято")}>
                  <Check className="size-4" /> Принять
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(() => patch<Dictionary>(`/api/dictionary/${entry.id}`, { status: "rejected" }))}>
                  <X className="size-4" /> Отклонить
                </Button>
              </EntryRow>
            ))}
          </div>
        )}

        <form
          className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end"
          onSubmit={(event) => { event.preventDefault(); if (to.trim()) add() }}
        >
          <div className="grid gap-1">
            <Label htmlFor="dict-from" className="text-xs text-muted-foreground">Whisper слышит (необязательно)</Label>
            <Input id="dict-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="клод код" />
          </div>
          <ArrowRight className="mx-auto mb-2 hidden size-4 text-muted-foreground sm:block" />
          <div className="grid gap-1">
            <Label htmlFor="dict-to" className="text-xs text-muted-foreground">Как пишется</Label>
            <Input id="dict-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Claude Code" />
          </div>
          <Button type="submit" disabled={!to.trim()}><Plus className="size-4" /> Добавить</Button>
        </form>

        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Словарь пока пуст.</p>
        ) : (
          <div className="grid divide-y rounded-lg border">
            {active.map((entry) => (
              <EntryRow key={entry.id} entry={entry} className="px-3 py-2">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Удалить"
                  onClick={() => run(() => api<Dictionary>(`/api/dictionary/${entry.id}`, { method: "DELETE" }))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </EntryRow>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EntryRow({ entry, className, children }: { entry: DictionaryEntry; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", className)}>
      <span className="min-w-0 flex-1">
        {entry.from && <><span className="text-muted-foreground line-through decoration-muted-foreground/50">{entry.from}</span> → </>}
        <span className="font-medium">{entry.to}</span>
        {entry.videoId && <span className="ml-2 text-xs text-muted-foreground">только «{entry.videoTitle ?? `ролик ${entry.videoId}`}»</span>}
        {entry.source === "agent" && <span className="ml-2 text-xs text-muted-foreground">агент{entry.version ? `, ${vname(entry.version)}` : ""}</span>}
        {entry.note && <span className="block text-xs text-muted-foreground">{entry.note}</span>}
      </span>
      <span className="flex gap-1">{children}</span>
    </div>
  )
}
