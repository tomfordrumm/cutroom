import { useQuery } from "@tanstack/react-query"
import { AudioLines, Bell, Bot, Layers, LogOut, Music, Palette, Volume2, type LucideIcon } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link, Navigate, NavLink, useParams } from "react-router-dom"
import { toast } from "sonner"
import { useAppState } from "@/App"
import { AgentPicker } from "@/components/AgentPicker"
import { Library } from "@/components/Library"
import { ModelPicker } from "@/components/ModelPicker"
import { PackPicker } from "@/components/PackPicker"
import { QueueSettings } from "@/components/QueueSettings"
import { SoundSettings } from "@/components/SoundSettings"
import { SpeechSettings } from "@/components/SpeechSettings"
import { TelegramSettings } from "@/components/TelegramSettings"
import { WebTerminal } from "@/components/WebTerminal"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { api, post, put, type Taste } from "@/lib/api"
import { cn } from "@/lib/utils"

type Section = { id: string; label: string; icon: LucideIcon; description: string; render: () => ReactNode }

const SECTIONS: Section[] = [
  { id: "agent", label: "Агент", icon: Bot, description: "Кто монтирует ролики и на какой модели.", render: () => <AgentSection /> },
  { id: "style", label: "Стиль монтажа", icon: Palette, description: "Пакет вкуса задаёт оформление, профиль — ваши постоянные правила.", render: () => <StyleSection /> },
  { id: "library", label: "Библиотека", icon: Music, description: "Файлы, общие для всех роликов.", render: () => <LibrarySection /> },
  { id: "sound", label: "Звук", icon: Volume2, description: "Громкость голоса, музыки и эффектов.", render: () => <SoundSection /> },
  { id: "speech", label: "Распознавание речи", icon: AudioLines, description: "Расшифровка, субтитры и словарь терминов.", render: () => <SpeechSection /> },
  { id: "queue", label: "Очередь монтажа", icon: Layers, description: "Сколько роликов монтировать одновременно.", render: () => <QueueSection /> },
  { id: "notifications", label: "Уведомления", icon: Bell, description: "Сообщения, когда ролик ждёт вас.", render: () => <NotificationsSection /> },
]

export default function SettingsPage() {
  const { tab } = useParams()
  const { data: state } = useAppState()
  const section = SECTIONS.find((s) => s.id === tab)
  const nav = useRef<HTMLElement>(null)

  // On narrow screens the sections are one scrolling row: keep the open one in view.
  useEffect(() => {
    const row = nav.current
    const active = row?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!row || !active || row.scrollWidth <= row.clientWidth) return
    const left = active.offsetLeft
    if (left < row.scrollLeft || left + active.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: left - 16, behavior: "smooth" })
  }, [tab])

  if (!section) return <Navigate to={`/settings/${SECTIONS[0].id}`} replace />

  const logout = () => post("/api/logout").then(() => { location.hash = "#/login" })

  return (
    <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
      <aside className="grid content-start gap-4 md:sticky md:top-6 md:self-start">
        <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
        <nav ref={nav} className="relative -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:overflow-visible md:p-0" aria-label="Разделы настроек">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <NavLink
              key={id}
              to={`/settings/${id}`}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  isActive && "bg-muted font-medium text-foreground",
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        {state?.authRequired && (
          <button type="button" onClick={logout} className="hidden items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex">
            <LogOut className="size-4" /> Выйти
          </button>
        )}
      </aside>
      <section className="grid min-w-0 content-start gap-6">
        <header className="grid gap-1">
          <h2 className="text-xl font-semibold tracking-tight">{section.label}</h2>
          <p className="text-sm text-muted-foreground">{section.description}</p>
        </header>
        {section.render()}
        {state?.authRequired && (
          <div className="md:hidden">
            <Button variant="outline" onClick={logout}><LogOut /> Выйти</Button>
          </div>
        )}
      </section>
    </div>
  )
}

function Block({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function AgentSection() {
  return (
    <>
      <Block title="Агент и модель" description="Cutroom запускает вашего агента по вашей подписке. Вход проходит в официальном CLI; приложение не видит ключи.">
        <div className="grid gap-5">
          <AgentPicker />
          <ModelPicker />
        </div>
      </Block>
      <Block
        title="Вход в подписку"
        description={
          <>
            Терминал внутри сервера Cutroom. Войдите: <code className="rounded bg-muted px-1">claude</code> → <code className="rounded bg-muted px-1">/login</code> или{" "}
            <code className="rounded bg-muted px-1">codex login --device-auth</code>. Ссылка для входа появится под терминалом кнопкой «Открыть».
          </>
        }
      >
        <WebTerminal />
      </Block>
    </>
  )
}

function StyleSection() {
  const taste = useQuery({ queryKey: ["taste"], queryFn: () => api<Taste>("/api/taste") })
  const [profile, setProfile] = useState("")
  useEffect(() => { if (taste.data) setProfile(taste.data.profile) }, [taste.data])

  const saveProfile = async () => {
    try {
      await put("/api/taste", { profile })
      await taste.refetch()
      toast.success("Профиль сохранён")
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <>
      <Block title="Пакет вкуса" description="Стиль монтажа по умолчанию: шрифты, цвета, субтитры, компоненты графики и правила для агента. Механика — поиск лица, безопасные зоны, проверка раскладки — работает с любым пакетом. Ваш профиль вкуса и правки важнее пакета.">
        <PackPicker />
      </Block>
      <Block title="Профиль вкуса" description="Постоянные правила для каждого ролика. Агент только предлагает изменения, сохраняете вы.">
        <div className="grid gap-3">
          <Textarea rows={14} className="font-mono text-[13px]" value={profile} onChange={(e) => setProfile(e.target.value)} />
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" asChild><Link to="/onboarding/1">Пройти онбординг заново</Link></Button>
            <Button onClick={saveProfile}>Сохранить профиль</Button>
          </div>
        </div>
      </Block>
    </>
  )
}

function LibrarySection() {
  return (
    <Block title="Музыка, эффекты и файлы" description="Агент видит их список и ставит по смыслу; версия хранит копию того, что использовала.">
      <Library />
    </Block>
  )
}

function SoundSection() {
  return (
    <Block title="Громкость" description="Cutroom измеряет громкость голоса после склейки и каждого звукового файла, ставит музыку и эффекты относительно голоса и выравнивает готовый ролик.">
      <SoundSettings />
    </Block>
  )
}

function SpeechSection() {
  return (
    <Block title="Whisper" description="Распознавание идёт на этом сервере: расшифровка, субтитры и поиск дублей. Модель и словарь влияют на текст субтитров.">
      <SpeechSettings />
    </Block>
  )
}

function QueueSection() {
  return (
    <Block title="Несколько роликов в монтаже" description="Что делать, когда в монтаж отправлено несколько роликов.">
      <QueueSettings />
    </Block>
  )
}

function NotificationsSection() {
  return (
    <Block title="Telegram" description="Ваш бот напишет, когда ролик смонтирован и ждёт ревью. Монтаж можно запустить и уйти.">
      <TelegramSettings />
    </Block>
  )
}
