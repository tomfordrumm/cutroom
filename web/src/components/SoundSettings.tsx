import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useAppState } from "@/App"
import { Button } from "@/components/ui/button"
import { put, type Sound } from "@/lib/api"

const FIELDS: { key: keyof Sound; label: string; unit: string; hint: string }[] = [
  { key: "targetLufs", label: "Громкость голоса в готовом ролике", unit: "LUFS", hint: "Весь микс поднимается так, чтобы голос звучал на этом уровне, пики ограничиваются на −1 дБ. Reels, Shorts и TikTok выравнивают ролики примерно к −14." },
  { key: "sfxDb", label: "Звуковые эффекты", unit: "дБ от голоса", hint: "Каждый эффект измеряется и ставится на этот уровень, тихий щелчок и громкий стингер звучат одинаково относительно речи." },
  { key: "musicDb", label: "Музыка под голосом", unit: "дБ от голоса", hint: "Фон, пока вы говорите." },
  { key: "musicPauseDb", label: "Музыка в паузах", unit: "дБ от голоса", hint: "В паузах длиннее 0,8 с музыка плавно поднимается до этого уровня." },
]

const fmt = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 }).replace("-", "−")

/** Loudness targets: the voice, and music and effects relative to it. */
export function SoundSettings() {
  const { data: state } = useAppState()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Sound | null>(null)
  useEffect(() => { if (state) setDraft(state.sound) }, [state?.sound.targetLufs, state?.sound.sfxDb, state?.sound.musicDb, state?.sound.musicPauseDb])
  if (!state || !draft) return null

  const save = async (next: Sound | null, message = "Сохранено. Действует со следующей версии.") => {
    try {
      await put("/api/settings", { sound: next })
      await queryClient.invalidateQueries({ queryKey: ["state"] })
      toast.success(message)
    } catch (error) {
      toast.error((error as Error).message)
      setDraft(state.sound)
    }
  }
  const changed = FIELDS.some(({ key }) => draft[key] !== state.sound[key])
  const isDefault = FIELDS.every(({ key }) => state.sound[key] === state.soundDefaults[key])

  return (
    <div className="grid gap-6">
      {FIELDS.map(({ key, label, unit, hint }) => {
        const [min, max] = state.soundLimits[key]
        return (
          <label key={key} className="grid gap-2">
            <span className="flex items-baseline justify-between gap-3 text-sm font-medium">
              {label}
              <span className="shrink-0 tabular-nums">{fmt(draft[key])} {unit}</span>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={1}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <span className="text-sm text-muted-foreground">{hint}</span>
          </label>
        )
      })}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" disabled={isDefault && !changed} onClick={() => save(null, "Вернул значения по умолчанию")}>По умолчанию</Button>
        <Button disabled={!changed} onClick={() => save(draft)}>Сохранить</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Агент выбирает, где звучат музыка и эффекты, и может сделать отдельный звук тише, но не громче этих уровней. Версия запоминает настройки, с которыми собрана: финал звучит как её превью.
      </p>
    </div>
  )
}
