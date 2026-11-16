import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, CircleDashed } from "lucide-react"
import { toast } from "sonner"
import { useAppState } from "@/App"
import { put, type AgentId } from "@/lib/api"
import { cn } from "@/lib/utils"

const OPTIONS: { id: AgentId; label: string; hint: string }[] = [
  { id: "claude", label: "Claude Code", hint: "Подписка Claude Pro или Max. Вход: claude, затем /login." },
  { id: "codex", label: "Codex CLI", hint: "Подписка ChatGPT. Вход: codex login --device-auth." },
  { id: "none", label: "Без агента", hint: "Только автоматическая склейка: паузы, дубли и звуки без слов." },
]

export function AgentPicker() {
  const { data: state } = useAppState()
  const queryClient = useQueryClient()
  const choose = async (agent: AgentId) => {
    try {
      await put("/api/settings", { agent })
      await queryClient.invalidateQueries({ queryKey: ["state"] })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {OPTIONS.map(({ id, label, hint }) => {
        const active = state?.agent === id
        const signedIn = id !== "none" && state?.agentStatus[id]
        return (
          <button
            key={id}
            type="button"
            onClick={() => choose(id)}
            className={cn(
              "grid gap-1.5 rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/30",
              active && "border-primary ring-1 ring-primary",
            )}
          >
            <span className="font-medium">{label}</span>
            <span className="text-sm text-muted-foreground">{hint}</span>
            {id !== "none" && (
              <span className={cn("mt-1 flex items-center gap-1.5 text-xs", signedIn ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                {signedIn ? <CheckCircle2 className="size-3.5" /> : <CircleDashed className="size-3.5" />}
                {signedIn ? "Вход выполнен" : "Нужен вход"}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
