import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useAppState } from "@/App"
import { Badge } from "@/components/ui/badge"
import { put } from "@/lib/api"
import { cn } from "@/lib/utils"

/** One edit after another, or several at once on a strong machine. */
export function QueueSettings() {
  const { data: state } = useAppState()
  const queryClient = useQueryClient()
  if (!state) return null
  const current = state.jobConcurrency
  const { cpus, memoryGb, suggested } = state.machine

  const choose = async (value: number) => {
    if (value === current) return
    try {
      await put("/api/settings", { jobConcurrency: value })
      await queryClient.invalidateQueries({ queryKey: ["state"] })
      toast.success(value === 1 ? "Ролики монтируются по очереди" : `Одновременно до ${value} роликов`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const options = Array.from({ length: state.maxConcurrency }, (_, i) => i + 1)
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => choose(1)}
          className={cn("grid gap-1 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50", current === 1 && "border-primary bg-primary/5 ring-1 ring-primary")}
        >
          <span className="flex items-center gap-2 font-medium">По очереди {current === 1 && <Badge>Выбрано</Badge>}</span>
          <span className="text-muted-foreground">Следующий ролик начинается, когда закончился предыдущий. Подходит для любого компьютера.</span>
        </button>
        <div
          className={cn("grid gap-2 rounded-lg border p-3 text-sm", current > 1 && "border-primary bg-primary/5 ring-1 ring-primary")}
        >
          <span className="flex items-center gap-2 font-medium">Одновременно {current > 1 && <Badge>Выбрано</Badge>}</span>
          <span className="text-muted-foreground">Несколько роликов монтируются параллельно. Быстрее для пачки, но нужен мощный компьютер.</span>
          <div className="flex flex-wrap gap-1.5">
            {options.slice(1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => choose(n)}
                className={cn("rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted", current === n && "border-primary bg-primary text-primary-foreground hover:bg-primary")}
              >
                до {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Серверу Cutroom доступно {cpus} {cpus === 1 ? "ядро" : cpus < 5 ? "ядра" : "ядер"} и {memoryGb} ГБ памяти.{" "}
        {suggested > 1 ? `Можно монтировать одновременно до ${suggested} роликов.` : "Лучше монтировать по очереди."}{" "}
        Каждый параллельный монтаж запускает распознавание речи, ffmpeg и рендер графики, примерно 4 ядра и 4 ГБ на ролик. Один ролик никогда не монтируется в двух задачах сразу.
      </p>
    </div>
  )
}
