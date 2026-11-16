import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useAppState } from "@/App"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { put } from "@/lib/api"

const DEFAULT = "__default"
const CUSTOM = "__custom"

const PRESETS: Record<"claude" | "codex", { value: string; label: string }[]> = {
  claude: [
    { value: "opus", label: "Opus — лучшее качество" },
    { value: "sonnet", label: "Sonnet — быстрее и дешевле" },
    { value: "haiku", label: "Haiku — самый быстрый" },
    { value: "fable", label: "Fable" },
  ],
  codex: [],
}

const EFFORT_LABELS: Record<string, string> = {
  minimal: "Минимальный", low: "Низкий", medium: "Средний", high: "Высокий", xhigh: "Очень высокий", max: "Максимальный",
}

/** Model and reasoning effort for the selected agent; empty means the CLI's default for the account. */
export function ModelPicker() {
  const { data: state } = useAppState()
  const queryClient = useQueryClient()
  const agent = state?.agent
  const current = agent && agent !== "none" ? state?.agentModels[agent] : undefined
  const presets = agent && agent !== "none" ? PRESETS[agent] : []
  const [choice, setChoice] = useState(DEFAULT)
  const [custom, setCustom] = useState("")

  useEffect(() => {
    const model = current?.model ?? ""
    if (!model) setChoice(DEFAULT)
    else if (presets.some((p) => p.value === model)) setChoice(model)
    else { setChoice(CUSTOM); setCustom(model) }
  }, [agent, current?.model]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!agent || agent === "none" || !current) return null

  const save = async (entry: { model?: string; effort?: string }) => {
    try {
      await put("/api/settings", { agentModels: { [agent]: entry } })
      await queryClient.invalidateQueries({ queryKey: ["state"] })
      toast.success("Сохранено")
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  const onModel = (value: string) => {
    setChoice(value)
    if (value === DEFAULT) save({ model: "" })
    else if (value !== CUSTOM) save({ model: value })
  }

  return (
    <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
      <div className="grid content-start gap-2">
        <Label>Модель {state?.agentLabels[agent]}</Label>
        <Select value={choice} onValueChange={onModel}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>По умолчанию аккаунта</SelectItem>
            {presets.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            <SelectItem value={CUSTOM}>Указать название…</SelectItem>
          </SelectContent>
        </Select>
        {choice === CUSTOM && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save({ model: custom.trim() }) }}>
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={agent === "claude" ? "claude-opus-5-5" : "название модели Codex"} />
            <Button type="submit" variant="outline">Сохранить</Button>
          </form>
        )}
      </div>
      <div className="grid content-start gap-2">
        <Label>Уровень рассуждений</Label>
        <Select value={current.effort || DEFAULT} onValueChange={(value) => save({ effort: value === DEFAULT ? "" : value })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>По умолчанию</SelectItem>
            {state?.efforts[agent].map((e) => <SelectItem key={e} value={e}>{EFFORT_LABELS[e] ?? e}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        «По умолчанию» — модель, которую CLI выбирает для вашей подписки. Сильная модель и высокий уровень монтируют аккуратнее, но расходуют лимит подписки быстрее. Модель каждой версии видна в её строке.
      </p>
    </div>
  )
}
