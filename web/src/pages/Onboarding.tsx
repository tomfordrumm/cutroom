import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Upload } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { useAppState } from "@/App"
import { AgentPicker } from "@/components/AgentPicker"
import { PackPicker } from "@/components/PackPicker"
import { WebTerminal } from "@/components/WebTerminal"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, put, upload, type Taste } from "@/lib/api"
import { cn } from "@/lib/utils"
import { LANGUAGES } from "@/components/SpeechSettings"

const STEPS = ["Агент", "Вкус", "Бренд", "Пожелания"]

function RefUploader({ refs }: { refs: string[] }) {
  const input = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<{ name: string; progress: number | null }[]>(refs.map((name) => ({ name, progress: null })))
  const send = async (files: FileList) => {
    for (const file of Array.from(files)) {
      setItems((list) => [...list, { name: file.name, progress: 0 }])
      try {
        await upload(`/api/taste/refs?name=${encodeURIComponent(file.name)}`, file, (progress) =>
          setItems((list) => list.map((item) => (item.name === file.name ? { ...item, progress } : item))))
        setItems((list) => list.map((item) => (item.name === file.name ? { ...item, progress: null } : item)))
      } catch (error) {
        toast.error((error as Error).message)
      }
    }
  }
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.name} className="flex items-center gap-2 text-sm">
          {item.progress === null ? <Check className="size-4 text-emerald-500" /> : <Upload className="size-4 animate-pulse" />}
          {item.name}
          {item.progress !== null && <span className="text-muted-foreground">{item.progress}%</span>}
        </div>
      ))}
      <input ref={input} type="file" accept="video/*" multiple hidden onChange={(e) => e.target.files && send(e.target.files)} />
      <div><Button type="button" variant="outline" onClick={() => input.current?.click()}><Upload /> Добавить видео</Button></div>
    </div>
  )
}

export default function OnboardingPage() {
  const step = Number(useParams().step ?? 1)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: state } = useAppState()
  const taste = useQuery({ queryKey: ["taste"], queryFn: () => api<Taste>("/api/taste") })
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [language, setLanguage] = useState("ru")
  useEffect(() => { if (taste.data) setAnswers(taste.data.answers ?? {}) }, [taste.data])
  useEffect(() => { if (state?.defaults.language) setLanguage(state.defaults.language) }, [state?.defaults.language])

  const field = (key: string) => ({ value: answers[key] ?? "", onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setAnswers((a) => ({ ...a, [key]: e.target.value })) })

  const next = async (save = true) => {
    try {
      if (save) await put("/api/taste", { answers })
      if (step === 4 && save) await put("/api/settings", { defaults: { language } })
      if (step < 4) navigate(`/onboarding/${step + 1}`)
      else {
        await put("/api/settings", { onboarded: true })
        await queryClient.invalidateQueries()
        navigate("/")
      }
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <Card className="mx-auto max-w-3xl">
      <CardContent className="grid gap-6 p-6 md:p-8">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((name, i) => (
            <li key={name} className={cn("rounded-full px-3 py-1 text-xs", i + 1 === step ? "bg-primary text-primary-foreground" : i + 1 < step ? "bg-muted text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
              {i + 1}. {name}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div className="grid gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Кто будет монтировать</h1>
              <p className="mt-1 text-muted-foreground">Cutroom запускает вашего агента по вашей подписке. Вход проходит в официальном CLI; приложение не видит и не хранит ключи.</p>
            </div>
            <AgentPicker />
            <WebTerminal />
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Как вы монтируете</h1>
              <p className="mt-1 text-muted-foreground">Это попадёт в постоянный профиль вкуса. Агент следует ему в каждом ролике и меняет только по вашему явному указанию.</p>
            </div>
            <div className="grid gap-2"><Label>Правила монтажа</Label><Textarea rows={6} placeholder="Темп, длина пауз, оставлять ли оговорки, как начинать и заканчивать ролик…" {...field("editing")} /></div>
            <div className="grid gap-2"><Label>Референсы — ваши или чужие ролики</Label><RefUploader refs={taste.data?.refs ?? []} key={taste.data?.refs.join("|")} /></div>
            <div className="grid gap-2"><Label>Что взять из референсов</Label><Textarea rows={3} placeholder="Темп, склейки, подачу…" {...field("refsNote")} /></div>
          </div>
        )}
        {step === 3 && (
          <div className="grid gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Бренд и оформление</h1>
              <p className="mt-1 text-muted-foreground">Выберите пакет вкуса — базовый стиль монтажа и графики. Ниже можно уточнить свой бренд: он важнее пакета. Цвета лучше указать кодами, например #22c55e.</p>
            </div>
            <PackPicker />
            <Label>Ваш бренд</Label>
            <Textarea rows={6} placeholder="Название канала, цвета, шрифты, стиль субтитров, плашки, логотип…" {...field("brand")} />
          </div>
        )}
        {step === 4 && (
          <div className="grid gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Пожелания по умолчанию</h1>
            <div className="grid max-w-xs gap-2">
              <Label>Язык речи</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LANGUAGES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2"><Label>Что обычно нужно</Label><Textarea rows={5} placeholder="Формат (вертикальный или горизонтальный), длительность, площадки…" {...field("defaults")} /></div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          {step > 1 ? <Button variant="ghost" asChild><Link to={`/onboarding/${step - 1}`}>Назад</Link></Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => next(false)}>Пропустить</Button>
            <Button onClick={() => next(true)}>{step < 4 ? "Дальше" : "Готово"}</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
