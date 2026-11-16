import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { api, fmtDate, fmtTokens, fmtUsd, STAGE_LABEL, type Usage, type UsageSummary } from "@/lib/api"

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]
const monthName = (key: string) => {
  const [year, month] = key.split("-").map(Number)
  return month ? `${MONTHS[month - 1]} ${year}` : key
}
const average = (u: Usage, count: number) => (u.costUsd != null && count ? u.costUsd / count : null)

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-1 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

/** What the editing agent spent: overall, per video, per model and per month. */
export function UsageStats() {
  const { data } = useQuery({ queryKey: ["usage"], queryFn: () => api<UsageSummary>("/api/usage"), refetchInterval: 10000 })
  if (!data) return null
  const { total, videos, byModel, byMonth } = data
  if (!total.runs) return <p className="text-sm text-muted-foreground">Агент ещё ничего не монтировал.</p>

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Всего по ценам API" value={fmtUsd(total.costUsd)} hint={total.unpricedRuns ? `без ${total.unpricedRuns} прогонов, где агент не сообщил цену` : undefined} />
        <Stat label="В среднем за ролик" value={fmtUsd(average(total, videos.length))} hint={`роликов ${videos.length}`} />
        <Stat label="Прогонов агента" value={String(total.runs)} hint={`${fmtTokens(total.tokens)} токенов`} />
      </div>

      <div className="grid gap-2">
        <h3 className="text-sm font-medium">По роликам</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Ролик</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Прогонов</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Токенов</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link to={`/video/${v.id}`} className="font-medium hover:underline">{v.title}</Link>
                    <div className="text-xs text-muted-foreground">{STAGE_LABEL[v.stage]}{v.lastRunAt ? ` · ${fmtDate(v.lastRunAt)}` : ""}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{v.runs}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtTokens(v.tokens)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtUsd(v.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <h3 className="text-sm font-medium">По моделям</h3>
          {byModel.map((m) => (
            <div key={`${m.agent}:${m.model}`} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{m.model ?? m.agent} <span className="text-xs text-muted-foreground">· прогонов {m.runs}</span></span>
              <span className="shrink-0 tabular-nums">{fmtUsd(m.costUsd)}</span>
            </div>
          ))}
        </div>
        <div className="grid content-start gap-2">
          <h3 className="text-sm font-medium">По месяцам</h3>
          {byMonth.map((m) => (
            <div key={m.month} className="flex items-baseline justify-between gap-3 text-sm">
              <span>{monthName(m.month)} <span className="text-xs text-muted-foreground">· прогонов {m.runs}</span></span>
              <span className="tabular-nums">{fmtUsd(m.costUsd)}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Стоимость считает сам Claude Code по ценам API. При входе по подписке это эквивалент: сколько стоил бы прогон через API, а не деньги, которые списались. Codex сообщает только токены. Учитываются все попытки агента, в том числе повторные после проверки; прогон, остановленный кнопкой, свой расход не сообщает. Ролики, удалённые из Cutroom, уходят из статистики вместе со своими прогонами.
      </p>
    </div>
  )
}
