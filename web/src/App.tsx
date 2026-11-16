import { useQuery } from "@tanstack/react-query"
import { Scissors } from "lucide-react"
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { api, type AppState } from "@/lib/api"
import { cn } from "@/lib/utils"
import BoardPage from "@/pages/Board"
import LoginPage from "@/pages/Login"
import OnboardingPage from "@/pages/Onboarding"
import SettingsPage from "@/pages/Settings"
import VideoPage from "@/pages/Video"

export function useAppState() {
  return useQuery({ queryKey: ["state"], queryFn: () => api<AppState>("/api/state"), refetchInterval: 5000 })
}

function AgentBadge({ state }: { state: AppState }) {
  const { agent } = state
  if (agent === "none") return <Badge variant="secondary">Без агента</Badge>
  const ok = state.agentStatus[agent]
  return (
    <Badge variant="outline" className={cn("gap-1.5", ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
      <span className={cn("size-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} />
      {state.agentLabels[agent]} · {ok ? "подключён" : "нужен вход"}
    </Badge>
  )
}

function TopBar({ state }: { state?: AppState }) {
  const link = ({ isActive }: { isActive: boolean }) =>
    cn("rounded-md px-3 py-1.5 text-sm transition-colors", isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 md:px-6">
        <NavLink to="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Scissors className="size-4" />
          </span>
          Cutroom
        </NavLink>
        <nav className="flex flex-1 gap-1">
          <NavLink to="/" end className={link}>Ролики</NavLink>
          <NavLink to="/settings" className={link}>Настройки</NavLink>
        </nav>
        {state && <AgentBadge state={state} />}
      </div>
    </header>
  )
}

export default function App() {
  const location = useLocation()
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ authenticated: boolean; authRequired: boolean }>("/api/session"),
  })
  const authenticated = session.data?.authenticated
  const state = useQuery({
    queryKey: ["state"],
    queryFn: () => api<AppState>("/api/state"),
    refetchInterval: 5000,
    enabled: !!authenticated,
  })

  if (location.pathname === "/login") return <LoginPage />
  if (session.isLoading) return null
  if (!authenticated) return <Navigate to="/login" replace />
  if (state.data && !state.data.onboarded && !location.pathname.startsWith("/onboarding") && !location.pathname.startsWith("/settings")) {
    return <Navigate to="/onboarding/1" replace />
  }

  return (
    <div className="min-h-svh bg-background">
      <TopBar state={state.data} />
      <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-6">
        <Routes>
          <Route path="/" element={<BoardPage />} />
          <Route path="/video/:id" element={<VideoPage />} />
          <Route path="/settings/:tab?" element={<SettingsPage />} />
          <Route path="/onboarding/:step" element={<OnboardingPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
